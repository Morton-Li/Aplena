use std::{
    collections::{BTreeSet, HashMap, HashSet},
    str::FromStr,
    sync::Arc,
};

use chrono::{Datelike, Local, Utc};
use pfcm_domain::{
    ActualEntry, ActualEntryEffect, ActualEntryOrigin, Amount, CalendarDate, CapacityInput,
    Category, CurrencyCode, ExchangeRate, MonthlyItem, PlanItem, RecognitionMode, Settings,
    YearMonth, calculate_financial_capacity, create_monthly_snapshot, is_recognized_in,
};
use rust_decimal::{Decimal, RoundingStrategy};
use sqlx::Executor;
use tokio::sync::RwLock;
use uuid::Uuid;

use crate::infrastructure::{
    DeletePlanResult, Store, StoredActualEntry, StoredExchangeRate, StoredMonthlyItem,
    StoredPlanItem, StoredSettings,
};

use super::{
    analytics::build_month_analytics,
    dto::{
        ActualEntryDto, ActualEntryInputDto, ConfirmActualsDto, ConfirmActualsInputDto,
        ConfirmMonthlyItemInputDto, DeletePlanItemDto, EnsureActualOnlyInputDto, ExchangeRateDto,
        ExchangeRateUpsertDto, FinancialCapacityDto, HistoryAnalyticsDto, InitializeMonthDto,
        InitializeMonthInputDto, ManualMonthlyItemInputDto, MonthAnalyticsDto,
        MonthInitializationStatusDto, MonthPreviewDto, MonthPreviewItemDto, MonthlyItemDto,
        MonthlyNoteInputDto, PlanItemDto, PlanItemInputDto, PlanMutationDto, RateOverrideDto,
        SettingsDto, SettingsInputDto, StartupStatusDto, StopPlanItemRequestDto,
    },
    error::AppError,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum InitializationTrigger {
    AppStartup,
    PlanCreated,
    Explicit,
}

#[derive(Debug, Clone)]
pub struct FinanceService {
    pub(crate) store: Arc<RwLock<Store>>,
    pub(crate) operation_gate: Arc<RwLock<()>>,
    pub(crate) startup_status: Arc<RwLock<StartupStatusDto>>,
}

impl FinanceService {
    pub fn new(store: Store) -> Result<Self, AppError> {
        let current_month = current_natural_month()?;
        Ok(Self {
            store: Arc::new(RwLock::new(store)),
            operation_gate: Arc::new(RwLock::new(())),
            startup_status: Arc::new(RwLock::new(StartupStatusDto {
                current_month: current_month.to_string(),
                initialization: None,
                error: None,
            })),
        })
    }

    #[cfg(test)]
    pub async fn test_store(&self) -> Store {
        self.current_store().await
    }

    pub(crate) async fn current_store(&self) -> Store {
        self.store.read().await.clone()
    }

    pub async fn initialize_on_startup(&self) {
        let _operation = self.operation_gate.read().await;
        let result = async {
            self.ensure_default_settings_unlocked().await?;
            self.ensure_month_initialized(
                current_natural_month().expect("local calendar month must be valid"),
                InitializationTrigger::AppStartup,
                Vec::new(),
            )
            .await
        }
        .await;

        let mut status = self.startup_status.write().await;
        match result {
            Ok(initialization) => {
                status.initialization = initialization;
                status.error = None;
            }
            Err(error) => {
                status.initialization = None;
                status.error = Some(error);
            }
        }
    }

    pub async fn startup_status(&self) -> StartupStatusDto {
        self.startup_status.read().await.clone()
    }

    pub async fn get_settings(&self) -> Result<Option<SettingsDto>, AppError> {
        let _operation = self.operation_gate.read().await;
        self.current_store()
            .await
            .get_settings()
            .await
            .map_err(AppError::from)
            .map(|value| value.map(settings_dto))
    }

    pub async fn ensure_default_settings(&self) -> Result<SettingsDto, AppError> {
        let _operation = self.operation_gate.read().await;
        self.ensure_default_settings_unlocked()
            .await
            .map(settings_dto)
    }

    async fn ensure_default_settings_unlocked(&self) -> Result<StoredSettings, AppError> {
        let store = self.current_store().await;
        if let Some(settings) = store.get_settings().await.map_err(AppError::from)? {
            return Ok(settings);
        }

        let settings = Settings::new(
            current_natural_month()?,
            CurrencyCode::new("CNY")
                .map_err(|error| AppError::from_domain(error, Some("baseCurrency")))?,
            2_000,
        )
        .map_err(|error| AppError::from_domain(error, None))?;
        store
            .create_settings(&settings, &timestamp())
            .await
            .map_err(AppError::from)
    }

    pub async fn save_settings(&self, input: SettingsInputDto) -> Result<SettingsDto, AppError> {
        let _operation = self.operation_gate.read().await;
        let settings = parse_settings(input)?;
        let timestamp = timestamp();
        let stored = if self
            .current_store()
            .await
            .get_settings()
            .await
            .map_err(AppError::from)?
            .is_some()
        {
            self.current_store()
                .await
                .update_settings(&settings, &timestamp)
                .await
        } else {
            self.current_store()
                .await
                .create_settings(&settings, &timestamp)
                .await
        }
        .map_err(AppError::from)?;

        let _ = self
            .ensure_month_initialized(
                current_natural_month()?,
                InitializationTrigger::AppStartup,
                Vec::new(),
            )
            .await?;
        Ok(settings_dto(stored))
    }

    pub async fn list_exchange_rates(&self) -> Result<Vec<ExchangeRateDto>, AppError> {
        let _operation = self.operation_gate.read().await;
        self.list_exchange_rates_unlocked().await
    }

    async fn list_exchange_rates_unlocked(&self) -> Result<Vec<ExchangeRateDto>, AppError> {
        let settings = self.require_settings().await?;
        let base = settings.value.base_currency().clone();
        self.current_store()
            .await
            .list_exchange_rates()
            .await
            .map_err(AppError::from)
            .map(|rates| {
                rates
                    .into_iter()
                    .map(|rate| exchange_rate_dto(rate, &base))
                    .collect()
            })
    }

    pub async fn upsert_exchange_rate(
        &self,
        input: ExchangeRateUpsertDto,
    ) -> Result<Vec<ExchangeRateDto>, AppError> {
        let _operation = self.operation_gate.read().await;
        let settings = self.require_settings().await?;
        let source = CurrencyCode::new(&input.currency)
            .map_err(|error| AppError::from_domain(error, Some("currency")))?;
        let exchange_rate =
            ExchangeRate::from_str(source, settings.value.base_currency().clone(), &input.rate)
                .map_err(|error| AppError::from_domain(error, Some("rate")))?;
        self.current_store()
            .await
            .upsert_exchange_rate(&exchange_rate, &timestamp())
            .await
            .map_err(AppError::from)?;
        self.list_exchange_rates_unlocked().await
    }

    pub async fn delete_exchange_rate(&self, currency: String) -> Result<(), AppError> {
        let _operation = self.operation_gate.read().await;
        let currency = CurrencyCode::new(currency)
            .map_err(|error| AppError::from_domain(error, Some("currency")))?;
        self.current_store()
            .await
            .delete_exchange_rate(&currency)
            .await
            .map_err(AppError::from)
    }

    pub async fn list_plan_items(&self) -> Result<Vec<PlanItemDto>, AppError> {
        let _operation = self.operation_gate.read().await;
        self.current_store()
            .await
            .list_plan_items()
            .await
            .map_err(AppError::from)
            .map(|items| items.into_iter().map(plan_item_dto).collect())
    }

    pub async fn create_plan_item(
        &self,
        input: PlanItemInputDto,
    ) -> Result<PlanMutationDto, AppError> {
        let _operation = self.operation_gate.read().await;
        self.require_settings().await?;
        let plan_item = parse_plan_item(input, false)?;
        self.require_currency_rate(plan_item.currency()).await?;
        let stored = self
            .current_store()
            .await
            .insert_plan_item(&plan_item, &timestamp())
            .await
            .map_err(AppError::from)?;
        let initialization = self
            .ensure_month_initialized(
                current_natural_month()?,
                InitializationTrigger::PlanCreated,
                Vec::new(),
            )
            .await?;
        Ok(PlanMutationDto {
            plan_item: plan_item_dto(stored),
            current_month_initialization: initialization,
        })
    }

    pub async fn update_plan_item(&self, input: PlanItemInputDto) -> Result<PlanItemDto, AppError> {
        let _operation = self.operation_gate.read().await;
        self.require_settings().await?;
        let plan_item = parse_plan_item(input, true)?;
        self.require_currency_rate(plan_item.currency()).await?;
        self.current_store()
            .await
            .update_plan_item(&plan_item, &timestamp())
            .await
            .map_err(AppError::from)
            .map(plan_item_dto)
    }

    pub async fn stop_plan_item(
        &self,
        input: StopPlanItemRequestDto,
    ) -> Result<PlanItemDto, AppError> {
        let _operation = self.operation_gate.read().await;
        let id = parse_uuid(&input.id, "id")?;
        let stored = self
            .current_store()
            .await
            .get_plan_item(id)
            .await
            .map_err(AppError::from)?;
        let end_date = parse_date(&input.end_date, "endDate")?;
        let value = &stored.value;
        let stopped = PlanItem::new(
            value.id(),
            value.name(),
            value.category(),
            value.amount(),
            value.currency().clone(),
            value.period_months(),
            value.start_date(),
            Some(end_date),
            value.recognition_mode(),
            value.note().map(str::to_owned),
        )
        .map_err(|error| AppError::from_domain(error, Some("endMonth")))?;
        self.current_store()
            .await
            .update_plan_item(&stopped, &timestamp())
            .await
            .map_err(AppError::from)
            .map(plan_item_dto)
    }

    pub async fn delete_plan_item(&self, id: String) -> Result<DeletePlanItemDto, AppError> {
        let _operation = self.operation_gate.read().await;
        let result = self
            .current_store()
            .await
            .delete_plan_item(parse_uuid(&id, "id")?)
            .await
            .map_err(AppError::from)?;
        Ok(delete_plan_item_dto(result))
    }

    pub async fn list_monthly_items(&self, month: String) -> Result<Vec<MonthlyItemDto>, AppError> {
        let _operation = self.operation_gate.read().await;
        let month = parse_month(&month, "month")?;
        self.current_store()
            .await
            .list_monthly_items(month)
            .await
            .map_err(AppError::from)
            .map(|items| items.into_iter().map(monthly_item_dto).collect())
    }

    pub async fn ensure_actual_only(
        &self,
        input: EnsureActualOnlyInputDto,
    ) -> Result<MonthlyItemDto, AppError> {
        let _operation = self.operation_gate.read().await;
        let plan_id = parse_uuid(&input.plan_item_id, "planItemId")?;
        let month = parse_month(&input.month, "month")?;
        let store = self.current_store().await;
        if let Some(existing) = store
            .get_monthly_item_by_source_month(plan_id, month)
            .await
            .map_err(AppError::from)?
        {
            return Ok(monthly_item_dto(existing));
        }
        let plan = store.get_plan_item(plan_id).await.map_err(AppError::from)?;
        let settings = self.require_settings().await?;
        let monthly = MonthlyItem::actual_only(
            Uuid::new_v4(),
            &plan.value,
            month,
            settings.value.base_currency().clone(),
        );
        store
            .insert_monthly_item(&monthly, &timestamp())
            .await
            .map_err(AppError::from)
            .map(monthly_item_dto)
    }

    pub async fn create_manual_monthly_item(
        &self,
        input: ManualMonthlyItemInputDto,
    ) -> Result<MonthlyItemDto, AppError> {
        let _operation = self.operation_gate.read().await;
        let month = parse_month(&input.month, "month")?;
        let category = Category::from_str(&input.category)
            .map_err(|error| AppError::from_domain(error, Some("category")))?;
        let settings = self.require_settings().await?;
        let monthly = MonthlyItem::manual(
            Uuid::new_v4(),
            input.name,
            month,
            category,
            settings.value.base_currency().clone(),
            input.note,
        )
        .map_err(|error| AppError::from_domain(error, Some("name")))?;
        self.current_store()
            .await
            .insert_monthly_item(&monthly, &timestamp())
            .await
            .map_err(AppError::from)
            .map(monthly_item_dto)
    }

    pub async fn list_actual_entries(
        &self,
        monthly_item_id: String,
    ) -> Result<Vec<ActualEntryDto>, AppError> {
        let _operation = self.operation_gate.read().await;
        self.current_store()
            .await
            .list_actual_entries(parse_uuid(&monthly_item_id, "monthlyItemId")?)
            .await
            .map_err(AppError::from)
            .map(|entries| entries.into_iter().map(actual_entry_dto).collect())
    }

    pub async fn create_actual_entry(
        &self,
        input: ActualEntryInputDto,
    ) -> Result<ActualEntryDto, AppError> {
        let _operation = self.operation_gate.read().await;
        let monthly_item_id = parse_uuid(&input.monthly_item_id, "monthlyItemId")?;
        let monthly = self
            .current_store()
            .await
            .get_monthly_item(monthly_item_id)
            .await
            .map_err(AppError::from)?;
        if monthly.value.source_plan_item_id().is_none()
            && monthly.value.item_origin() != pfcm_domain::MonthlyItemOrigin::Manual
        {
            return Err(AppError::business(
                "DELETED_PLAN_CANNOT_ACCEPT_ENTRY",
                "error.deleted_plan_cannot_accept_entry",
            ));
        }
        let entry = parse_actual_entry(input, Uuid::new_v4(), monthly.value.month())?;
        self.current_store()
            .await
            .insert_actual_entry(&entry, &timestamp())
            .await
            .map_err(AppError::from)
            .map(actual_entry_dto)
    }

    pub async fn update_actual_entry(
        &self,
        input: ActualEntryInputDto,
    ) -> Result<ActualEntryDto, AppError> {
        let _operation = self.operation_gate.read().await;
        let id = input
            .id
            .as_deref()
            .map(|value| parse_uuid(value, "id"))
            .transpose()?
            .ok_or_else(|| AppError::validation("ID_REQUIRED", "id", "error.id_required"))?;
        let monthly_item_id = parse_uuid(&input.monthly_item_id, "monthlyItemId")?;
        let existing = self
            .current_store()
            .await
            .get_actual_entry(id)
            .await
            .map_err(AppError::from)?;
        if existing.value.monthly_item_id() != monthly_item_id {
            return Err(AppError::validation(
                "ACTUAL_ENTRY_REPARENT_FORBIDDEN",
                "monthlyItemId",
                "error.actual_entry_reparent_forbidden",
            ));
        }
        let monthly = self
            .current_store()
            .await
            .get_monthly_item(monthly_item_id)
            .await
            .map_err(AppError::from)?;
        let entry = parse_actual_entry(input, id, monthly.value.month())?;
        self.current_store()
            .await
            .update_actual_entry(&entry, &timestamp())
            .await
            .map_err(AppError::from)
            .map(actual_entry_dto)
    }

    pub async fn delete_actual_entry(&self, id: String) -> Result<(), AppError> {
        let _operation = self.operation_gate.read().await;
        self.current_store()
            .await
            .delete_actual_entry(parse_uuid(&id, "id")?)
            .await
            .map_err(AppError::from)
    }

    pub async fn confirm_monthly_item(
        &self,
        input: ConfirmMonthlyItemInputDto,
    ) -> Result<MonthlyItemDto, AppError> {
        let _operation = self.operation_gate.read().await;
        self.current_store()
            .await
            .confirm_monthly_item(parse_uuid(&input.id, "id")?, &timestamp())
            .await
            .map_err(AppError::from)
            .map(monthly_item_dto)
    }

    pub async fn update_monthly_note(
        &self,
        input: MonthlyNoteInputDto,
    ) -> Result<MonthlyItemDto, AppError> {
        let _operation = self.operation_gate.read().await;
        self.current_store()
            .await
            .update_monthly_note(
                parse_uuid(&input.id, "id")?,
                input.note.as_deref(),
                &timestamp(),
            )
            .await
            .map_err(AppError::from)
            .map(monthly_item_dto)
    }

    pub async fn confirm_actuals(
        &self,
        input: ConfirmActualsInputDto,
    ) -> Result<ConfirmActualsDto, AppError> {
        let _operation = self.operation_gate.read().await;
        let month = parse_month(&input.month, "month")?;
        let category = input
            .category
            .as_deref()
            .map(Category::from_str)
            .transpose()
            .map_err(|error| AppError::from_domain(error, Some("category")))?;
        let updated_count = self
            .current_store()
            .await
            .confirm_actuals(month, category, &timestamp())
            .await
            .map_err(AppError::from)?;
        Ok(ConfirmActualsDto { updated_count })
    }

    pub async fn list_existing_months(&self) -> Result<Vec<String>, AppError> {
        let _operation = self.operation_gate.read().await;
        self.current_store()
            .await
            .list_existing_months()
            .await
            .map_err(AppError::from)
            .map(|months| months.into_iter().map(|month| month.to_string()).collect())
    }

    pub async fn month_analytics(&self, month: String) -> Result<MonthAnalyticsDto, AppError> {
        let _operation = self.operation_gate.read().await;
        let month = parse_month(&month, "month")?;
        let settings = self.require_settings().await?;
        let items = self
            .current_store()
            .await
            .list_monthly_items(month)
            .await
            .map_err(AppError::from)?
            .into_iter()
            .map(|stored| stored.value)
            .collect::<Vec<_>>();
        Ok(build_month_analytics(
            month,
            settings.value.base_currency().as_str(),
            settings.value.minimum_savings_rate(),
            &items,
        ))
    }

    pub async fn history_analytics(&self) -> Result<HistoryAnalyticsDto, AppError> {
        let _operation = self.operation_gate.read().await;
        let settings = self.require_settings().await?;
        let mut months = self
            .current_store()
            .await
            .list_existing_months()
            .await
            .map_err(AppError::from)?;
        months.sort_unstable();
        let mut analytics = Vec::with_capacity(months.len());
        for month in months {
            let items = self
                .current_store()
                .await
                .list_monthly_items(month)
                .await
                .map_err(AppError::from)?
                .into_iter()
                .map(|stored| stored.value)
                .collect::<Vec<_>>();
            analytics.push(build_month_analytics(
                month,
                settings.value.base_currency().as_str(),
                settings.value.minimum_savings_rate(),
                &items,
            ));
        }
        Ok(HistoryAnalyticsDto { months: analytics })
    }

    pub async fn financial_capacity(
        &self,
        target_month: Option<String>,
    ) -> Result<FinancialCapacityDto, AppError> {
        let _operation = self.operation_gate.read().await;
        let settings = self.require_settings().await?;
        let target_month = target_month
            .as_deref()
            .map(|month| parse_month(month, "targetMonth"))
            .transpose()?
            .unwrap_or(settings.value.target_month());
        let plans = self
            .current_store()
            .await
            .list_plan_items()
            .await
            .map_err(AppError::from)?;
        let mut connection = self
            .current_store()
            .await
            .acquire()
            .await
            .map_err(AppError::from)?;
        let mut parsed = Vec::with_capacity(plans.len());
        for stored in plans {
            let plan = stored.value;
            let rate = Store::get_exchange_rate_on(
                &mut connection,
                plan.currency(),
                settings.value.base_currency(),
            )
            .await
            .map_err(AppError::from)?
            .ok_or_else(|| missing_rate_error(plan.currency()))?;
            parsed.push((plan, rate));
        }
        let inputs = parsed
            .iter()
            .map(|(plan_item, exchange_rate)| CapacityInput {
                plan_item,
                exchange_rate,
            })
            .collect::<Vec<_>>();
        let result = calculate_financial_capacity(
            target_month,
            settings.value.minimum_savings_rate(),
            settings.value.base_currency().clone(),
            &inputs,
        )
        .map_err(|error| AppError::from_domain(error, None))?;
        Ok(FinancialCapacityDto {
            target_month: target_month.to_string(),
            base_currency: result.base_currency().to_string(),
            minimum_savings_rate_percent: format_decimal(
                settings.value.minimum_savings_rate().factor() * Decimal::ONE_HUNDRED,
                2,
            ),
            stable_income: result.stable_income().decimal_string(),
            variable_income: result.variable_income().decimal_string(),
            essential_expenses: result.essential_expenses().decimal_string(),
            fixed_commitments: result.fixed_commitments().decimal_string(),
            discretionary_budget: result.discretionary_budget().decimal_string(),
            minimum_savings_amount: result.minimum_savings_amount().decimal_string(),
            preserved_capacity: result.preserved_capacity().decimal_string(),
            maximum_capacity: result.maximum_capacity().decimal_string(),
            fixed_commitment_ratio_percent: result
                .fixed_commitment_ratio()
                .map(|ratio| format_decimal(ratio.as_decimal() * Decimal::ONE_HUNDRED, 2)),
            stable_income_coverage_ratio: result
                .stable_income_coverage_ratio()
                .map(|ratio| format_decimal(ratio.as_decimal(), 2)),
        })
    }

    pub async fn initialization_status(
        &self,
        month: String,
    ) -> Result<MonthInitializationStatusDto, AppError> {
        let _operation = self.operation_gate.read().await;
        let month = parse_month(&month, "month")?;
        let item_count = self
            .current_store()
            .await
            .count_monthly_items(month)
            .await
            .map_err(AppError::from)?;
        Ok(MonthInitializationStatusDto {
            month: month.to_string(),
            initialized: item_count > 0,
            item_count,
        })
    }

    pub async fn preview_month(
        &self,
        input: InitializeMonthInputDto,
    ) -> Result<MonthPreviewDto, AppError> {
        let _operation = self.operation_gate.read().await;
        let month = parse_month(&input.month, "month")?;
        let settings = self.require_settings().await?;
        let overrides = parse_rate_overrides(input.rate_overrides, settings.value.base_currency())?;
        let existing = self
            .current_store()
            .await
            .list_monthly_items(month)
            .await
            .map_err(AppError::from)?;
        let existing_ids = existing
            .iter()
            .filter_map(|item| item.value.source_plan_item_id())
            .collect::<HashSet<_>>();
        let actual_only_ids = existing
            .iter()
            .filter(|item| item.value.item_source() == pfcm_domain::MonthlyItemSource::ActualOnly)
            .filter_map(|item| item.value.source_plan_item_id())
            .collect::<HashSet<_>>();
        let plans = self
            .current_store()
            .await
            .list_plan_items()
            .await
            .map_err(AppError::from)?;
        let mut missing_currencies = BTreeSet::new();
        let mut candidate_count = 0_u64;
        let mut excluded_count = 0_u64;
        let mut items = Vec::with_capacity(plans.len());

        for stored in plans {
            let plan = stored.value;
            let (status, planned_amount) =
                if existing_ids.contains(&plan.id()) && !actual_only_ids.contains(&plan.id()) {
                    ("EXISTING", None)
                } else if !is_recognized_in(&plan, month) {
                    excluded_count += 1;
                    ("EXCLUDED", None)
                } else {
                    match self
                        .rate_for(plan.currency(), settings.value.base_currency(), &overrides)
                        .await?
                    {
                        Some(rate) => {
                            let snapshot = create_monthly_snapshot(
                                Uuid::new_v4(),
                                &plan,
                                month,
                                &rate,
                                settings.value.base_currency(),
                            )
                            .map_err(|error| AppError::from_domain(error, None))?
                            .expect("recognized plan produces a snapshot");
                            candidate_count += 1;
                            ("READY", Some(snapshot.planned_amount().decimal_string()))
                        }
                        None => {
                            missing_currencies.insert(plan.currency().to_string());
                            ("MISSING_RATE", None)
                        }
                    }
                };
            items.push(MonthPreviewItemDto {
                source_plan_item_id: plan.id().to_string(),
                name: plan.name().to_owned(),
                category: plan.category().code().to_owned(),
                recognition_mode: plan.recognition_mode().code().to_owned(),
                status: status.to_owned(),
                planned_amount,
                currency: settings.value.base_currency().to_string(),
            });
        }

        Ok(MonthPreviewDto {
            month: month.to_string(),
            direction: month_direction(month)?.to_owned(),
            requires_confirmation: month != current_natural_month()?,
            existing_count: u64::try_from(existing_ids.len()).unwrap_or(u64::MAX),
            candidate_count,
            excluded_count,
            missing_currencies: missing_currencies.into_iter().collect(),
            warnings: initialization_warnings(month)?,
            items,
        })
    }

    pub async fn initialize_month(
        &self,
        input: InitializeMonthInputDto,
    ) -> Result<InitializeMonthDto, AppError> {
        let _operation = self.operation_gate.read().await;
        let month = parse_month(&input.month, "month")?;
        if month != current_natural_month()? && !input.confirmed {
            return Err(AppError::business(
                "MONTH_INITIALIZATION_CONFIRMATION_REQUIRED",
                "error.month_initialization_confirmation_required",
            )
            .with_param("month", month.to_string()));
        }
        self.ensure_month_initialized(month, InitializationTrigger::Explicit, input.rate_overrides)
            .await?
            .ok_or_else(|| AppError::business("SETUP_REQUIRED", "error.setup_required"))
    }

    async fn require_settings(&self) -> Result<StoredSettings, AppError> {
        self.current_store()
            .await
            .get_settings()
            .await
            .map_err(AppError::from)?
            .ok_or_else(|| AppError::business("SETUP_REQUIRED", "error.setup_required"))
    }

    async fn require_currency_rate(&self, currency: &CurrencyCode) -> Result<(), AppError> {
        let settings = self.require_settings().await?;
        let mut connection = self
            .current_store()
            .await
            .acquire()
            .await
            .map_err(AppError::from)?;
        let rate =
            Store::get_exchange_rate_on(&mut connection, currency, settings.value.base_currency())
                .await
                .map_err(AppError::from)?;
        if rate.is_none() {
            return Err(missing_rate_error(currency));
        }
        Ok(())
    }

    async fn rate_for(
        &self,
        source: &CurrencyCode,
        base: &CurrencyCode,
        overrides: &HashMap<CurrencyCode, ExchangeRate>,
    ) -> Result<Option<ExchangeRate>, AppError> {
        if let Some(rate) = overrides.get(source) {
            return Ok(Some(rate.clone()));
        }
        let mut connection = self
            .current_store()
            .await
            .acquire()
            .await
            .map_err(AppError::from)?;
        Store::get_exchange_rate_on(&mut connection, source, base)
            .await
            .map_err(AppError::from)
    }

    async fn ensure_month_initialized(
        &self,
        month: YearMonth,
        trigger: InitializationTrigger,
        rate_overrides: Vec<RateOverrideDto>,
    ) -> Result<Option<InitializeMonthDto>, AppError> {
        let current = current_natural_month()?;
        if trigger != InitializationTrigger::Explicit && month != current {
            return Err(AppError::business(
                "AUTOMATIC_INITIALIZATION_CURRENT_MONTH_ONLY",
                "error.automatic_initialization_current_month_only",
            ));
        }

        let mut connection = self
            .current_store()
            .await
            .acquire()
            .await
            .map_err(AppError::from)?;
        connection
            .execute("BEGIN IMMEDIATE")
            .await
            .map_err(|error| AppError::from(crate::infrastructure::StoreError::from(error)))?;

        let result = async {
            let Some(settings) = Store::get_settings_on(&mut connection)
                .await
                .map_err(AppError::from)?
            else {
                return Ok(None);
            };
            let overrides = parse_rate_overrides(rate_overrides, settings.value.base_currency())?;
            let plans = Store::list_plan_items_on(&mut connection)
                .await
                .map_err(AppError::from)?;
            let existing = Store::existing_source_ids_on(&mut connection, month)
                .await
                .map_err(AppError::from)?
                .into_iter()
                .collect::<HashSet<_>>();
            let actual_only = Store::actual_only_source_ids_on(&mut connection, month)
                .await
                .map_err(AppError::from)?
                .into_iter()
                .collect::<HashSet<_>>();
            let mut snapshots = Vec::new();
            let mut skipped_existing_count = 0_u64;
            let mut excluded_count = 0_u64;

            for stored in plans {
                let plan = stored.value;
                if existing.contains(&plan.id()) && !actual_only.contains(&plan.id()) {
                    skipped_existing_count += 1;
                    continue;
                }
                if !is_recognized_in(&plan, month) {
                    excluded_count += 1;
                    continue;
                }
                let rate = if let Some(rate) = overrides.get(plan.currency()) {
                    Some(rate.clone())
                } else {
                    Store::get_exchange_rate_on(
                        &mut connection,
                        plan.currency(),
                        settings.value.base_currency(),
                    )
                    .await
                    .map_err(AppError::from)?
                }
                .ok_or_else(|| missing_rate_error(plan.currency()))?;
                let snapshot = create_monthly_snapshot(
                    Uuid::new_v4(),
                    &plan,
                    month,
                    &rate,
                    settings.value.base_currency(),
                )
                .map_err(|error| AppError::from_domain(error, None))?
                .expect("recognized plan produces a snapshot");
                snapshots.push(snapshot);
            }

            let timestamp = timestamp();
            let mut created_count = 0_u64;
            for snapshot in &snapshots {
                if Store::insert_monthly_item_on(&mut connection, snapshot, &timestamp)
                    .await
                    .map_err(AppError::from)?
                {
                    created_count += 1;
                } else {
                    skipped_existing_count += 1;
                }
            }
            Ok(Some(InitializeMonthDto {
                month: month.to_string(),
                created_count,
                skipped_existing_count,
                excluded_count,
                warnings: initialization_warnings(month)?,
            }))
        }
        .await;

        match result {
            Ok(value) => {
                connection.execute("COMMIT").await.map_err(|error| {
                    AppError::from(crate::infrastructure::StoreError::from(error))
                })?;
                Ok(value)
            }
            Err(error) => {
                let _ = connection.execute("ROLLBACK").await;
                Err(error)
            }
        }
    }
}

fn parse_settings(input: SettingsInputDto) -> Result<Settings, AppError> {
    Settings::new(
        parse_month(&input.target_month, "targetMonth")?,
        CurrencyCode::new(&input.base_currency)
            .map_err(|error| AppError::from_domain(error, Some("baseCurrency")))?,
        input.minimum_savings_rate_basis_points,
    )
    .map_err(|error| AppError::from_domain(error, None))
}

fn parse_plan_item(input: PlanItemInputDto, id_required: bool) -> Result<PlanItem, AppError> {
    let id = match input.id.as_deref() {
        Some(id) => parse_uuid(id, "id")?,
        None if id_required => {
            return Err(AppError::validation(
                "ID_REQUIRED",
                "id",
                "error.id_required",
            ));
        }
        None => Uuid::new_v4(),
    };
    PlanItem::new(
        id,
        input.name,
        Category::from_str(&input.category)
            .map_err(|error| AppError::from_domain(error, Some("category")))?,
        Amount::from_str(&input.planned_amount)
            .map_err(|error| AppError::from_domain(error, Some("plannedAmount")))?,
        CurrencyCode::new(&input.currency)
            .map_err(|error| AppError::from_domain(error, Some("currency")))?,
        input.period_months,
        parse_date(&input.start_date, "startDate")?,
        input
            .end_date
            .as_deref()
            .map(|date| parse_date(date, "endDate"))
            .transpose()?,
        RecognitionMode::from_str(&input.recognition_mode)
            .map_err(|error| AppError::from_domain(error, Some("recognitionMode")))?,
        input.note,
    )
    .map_err(|error| AppError::from_domain(error, None))
}

fn parse_actual_entry(
    input: ActualEntryInputDto,
    id: Uuid,
    month: YearMonth,
) -> Result<ActualEntry, AppError> {
    ActualEntry::new(
        id,
        parse_uuid(&input.monthly_item_id, "monthlyItemId")?,
        month,
        parse_date(&input.occurred_on, "occurredOn")?,
        ActualEntryEffect::from_str(&input.effect)
            .map_err(|error| AppError::from_domain(error, Some("effect")))?,
        Amount::from_str(&input.amount)
            .map_err(|error| AppError::from_domain(error, Some("amount")))?,
        ActualEntryOrigin::User,
        input.note,
    )
    .map_err(|error| AppError::from_domain(error, None))
}

fn parse_rate_overrides(
    inputs: Vec<RateOverrideDto>,
    base: &CurrencyCode,
) -> Result<HashMap<CurrencyCode, ExchangeRate>, AppError> {
    let mut overrides = HashMap::new();
    for input in inputs {
        let currency = CurrencyCode::new(&input.currency)
            .map_err(|error| AppError::from_domain(error, Some("currency")))?;
        let rate = ExchangeRate::from_str(currency.clone(), base.clone(), &input.rate)
            .map_err(|error| AppError::from_domain(error, Some("rate")))?;
        overrides.insert(currency, rate);
    }
    Ok(overrides)
}

fn parse_month(value: &str, field: &str) -> Result<YearMonth, AppError> {
    YearMonth::from_str(value).map_err(|error| AppError::from_domain(error, Some(field)))
}

fn parse_date(value: &str, field: &str) -> Result<CalendarDate, AppError> {
    CalendarDate::from_str(value).map_err(|error| AppError::from_domain(error, Some(field)))
}

fn parse_uuid(value: &str, field: &str) -> Result<Uuid, AppError> {
    Uuid::parse_str(value)
        .map_err(|_| AppError::validation("INVALID_UUID", field, "error.invalid_uuid"))
}

fn current_natural_month() -> Result<YearMonth, AppError> {
    let now = Local::now();
    YearMonth::new(now.year(), u8::try_from(now.month()).unwrap_or_default())
        .map_err(|error| AppError::from_domain(error, None))
}

fn month_direction(month: YearMonth) -> Result<&'static str, AppError> {
    let current = current_natural_month()?;
    Ok(if month < current {
        "HISTORICAL"
    } else if month > current {
        "FUTURE"
    } else {
        "CURRENT"
    })
}

fn initialization_warnings(month: YearMonth) -> Result<Vec<String>, AppError> {
    Ok(match month_direction(month)? {
        "HISTORICAL" => vec!["BACKFILL_RATE_MAY_NOT_REPRESENT_HISTORY".to_owned()],
        "FUTURE" => vec!["FUTURE_SNAPSHOT_WILL_BE_FROZEN".to_owned()],
        _ => Vec::new(),
    })
}

fn timestamp() -> String {
    Utc::now().to_rfc3339()
}

fn missing_rate_error(currency: &CurrencyCode) -> AppError {
    AppError::business("MISSING_EXCHANGE_RATE", "error.missing_exchange_rate")
        .with_param("currency", currency.to_string())
}

fn settings_dto(stored: StoredSettings) -> SettingsDto {
    SettingsDto {
        target_month: stored.value.target_month().to_string(),
        base_currency: stored.value.base_currency().to_string(),
        minimum_savings_rate_basis_points: stored.value.minimum_savings_rate().basis_points(),
        created_at: stored.created_at,
        updated_at: stored.updated_at,
    }
}

fn exchange_rate_dto(stored: StoredExchangeRate, base: &CurrencyCode) -> ExchangeRateDto {
    ExchangeRateDto {
        currency: stored.currency.to_string(),
        base_currency: base.to_string(),
        rate: stored.exchange_rate.decimal_string(),
        is_base_currency: &stored.currency == base,
        plan_reference_count: stored.plan_reference_count,
        updated_at: stored.updated_at,
    }
}

fn plan_item_dto(stored: StoredPlanItem) -> PlanItemDto {
    let value = stored.value;
    PlanItemDto {
        id: value.id().to_string(),
        name: value.name().to_owned(),
        category: value.category().code().to_owned(),
        flow_type: value.flow_type().code().to_owned(),
        planned_amount: value.amount().decimal_string(),
        currency: value.currency().to_string(),
        period_months: value.period_months(),
        start_date: value.start_date().to_string(),
        end_date: value.end_date().map(|date| date.to_string()),
        recognition_mode: value.recognition_mode().code().to_owned(),
        note: value.note().map(str::to_owned),
        created_at: stored.created_at,
        updated_at: stored.updated_at,
        history_month_count: stored.history_month_count,
    }
}

fn monthly_item_dto(stored: StoredMonthlyItem) -> MonthlyItemDto {
    let value = stored.value;
    let actual = value.actual_amount();
    let has_plan_baseline = value.item_origin() != pfcm_domain::MonthlyItemOrigin::Manual;
    let variance_amount = actual.filter(|_| has_plan_baseline).map(|actual| {
        format_decimal(
            actual
                .as_decimal()
                .checked_sub(value.planned_amount().as_decimal())
                .expect("two valid i64-scaled amounts have a representable decimal difference"),
            2,
        )
    });
    let completion_rate_percent = actual.filter(|_| has_plan_baseline).and_then(|actual| {
        let planned = value.planned_amount().as_decimal();
        if planned.is_zero() {
            None
        } else {
            Some(format_decimal(
                actual
                    .as_decimal()
                    .checked_div(planned)?
                    .checked_mul(Decimal::ONE_HUNDRED)?,
                2,
            ))
        }
    });
    let data_status = value.actual_data_status().code();
    let variance_effect = match actual.filter(|_| has_plan_baseline) {
        None => "UNKNOWN",
        Some(actual) if actual.as_decimal() == value.planned_amount().as_decimal() => "ON_PLAN",
        Some(actual) if value.flow_type() == pfcm_domain::FlowType::Income => {
            if actual.as_decimal() > value.planned_amount().as_decimal() {
                "FAVORABLE"
            } else {
                "UNFAVORABLE"
            }
        }
        Some(actual) => {
            if actual.as_decimal() < value.planned_amount().as_decimal() {
                "FAVORABLE"
            } else {
                "UNFAVORABLE"
            }
        }
    };
    MonthlyItemDto {
        id: value.id().to_string(),
        source_plan_item_id: value.source_plan_item_id().map(|id| id.to_string()),
        item_name: value.item_name().to_owned(),
        month: value.month().to_string(),
        category: value.category().code().to_owned(),
        flow_type: value.flow_type().code().to_owned(),
        recognition_mode: value.recognition_mode().code().to_owned(),
        item_source: value.item_source().code().to_owned(),
        item_origin: value.item_origin().code().to_owned(),
        scheduled_date: value.scheduled_date().map(|date| date.to_string()),
        planned_amount: value.planned_amount().decimal_string(),
        actual_amount: actual.map(pfcm_domain::SignedAmount::decimal_string),
        actual_entry_count: value.actual_entry_count(),
        actual_confirmed_at: value.actual_confirmed_at().map(str::to_owned),
        variance_amount,
        completion_rate_percent,
        data_status: data_status.to_owned(),
        variance_effect: variance_effect.to_owned(),
        currency: value.currency().to_string(),
        note: value.note().map(str::to_owned),
        created_at: stored.created_at,
        updated_at: stored.updated_at,
    }
}

fn actual_entry_dto(stored: StoredActualEntry) -> ActualEntryDto {
    let value = stored.value;
    ActualEntryDto {
        id: value.id().to_string(),
        monthly_item_id: value.monthly_item_id().to_string(),
        occurred_on: value.occurred_on().to_string(),
        effect: value.effect().code().to_owned(),
        amount: value.amount().decimal_string(),
        origin: value.origin().code().to_owned(),
        note: value.note().map(str::to_owned),
        created_at: stored.created_at,
        updated_at: stored.updated_at,
    }
}

fn format_decimal(mut value: Decimal, scale: u32) -> String {
    value = value.round_dp_with_strategy(scale, RoundingStrategy::MidpointAwayFromZero);
    value.rescale(scale);
    value.to_string()
}

fn delete_plan_item_dto(result: DeletePlanResult) -> DeletePlanItemDto {
    DeletePlanItemDto {
        plan_item_id: result.plan_item_id.to_string(),
        detached_monthly_items: result.detached_monthly_items,
    }
}
