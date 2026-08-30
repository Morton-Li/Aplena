use std::str::FromStr;

use pfcm_domain::{
    Amount, CalendarDate, CapacityInput, Category, CurrencyCode, ExchangeRate, PlanItem,
    RecognitionMode, SavingsRate, YearMonth, calculate_financial_capacity, is_effective_in,
    monthly_equivalent, recognized_amount, scheduled_date_for_month,
};
use uuid::Uuid;

use tauri::State;

use super::{
    dto::{
        ActualEntryDto, ActualEntryInputDto, CapacityDto, CapacityRequestDto, ConfirmActualsDto,
        ConfirmActualsInputDto, ConfirmMonthlyItemInputDto, DeletePlanItemDto, DomainContractDto,
        EnsureActualOnlyInputDto, EnumOptionDto, ExchangeRateDto, ExchangeRateInputDto,
        ExchangeRateUpsertDto, FinancialCapacityDto, HistoryAnalyticsDto, InitializeMonthDto,
        InitializeMonthInputDto, ManualMonthlyItemInputDto, MonthAnalyticsDto,
        MonthInitializationStatusDto, MonthPreviewDto, MonthlyItemDto, MonthlyNoteInputDto,
        PlanItemDto, PlanItemInputDto, PlanMutationDto, PlanPreviewDto, PlanPreviewRequestDto,
        SettingsDto, SettingsInputDto, StartupStatusDto, StopPlanItemRequestDto,
    },
    error::AppError,
    service::FinanceService,
};

#[tauri::command]
pub async fn get_startup_status(
    service: State<'_, FinanceService>,
) -> Result<StartupStatusDto, AppError> {
    Ok(service.startup_status().await)
}

#[tauri::command]
pub async fn get_settings(
    service: State<'_, FinanceService>,
) -> Result<Option<SettingsDto>, AppError> {
    service.get_settings().await
}

#[tauri::command]
pub async fn ensure_default_settings(
    service: State<'_, FinanceService>,
) -> Result<SettingsDto, AppError> {
    service.ensure_default_settings().await
}

#[tauri::command]
pub async fn save_settings(
    service: State<'_, FinanceService>,
    input: SettingsInputDto,
) -> Result<SettingsDto, AppError> {
    service.save_settings(input).await
}

#[tauri::command]
pub async fn list_exchange_rates(
    service: State<'_, FinanceService>,
) -> Result<Vec<ExchangeRateDto>, AppError> {
    service.list_exchange_rates().await
}

#[tauri::command]
pub async fn upsert_exchange_rate(
    service: State<'_, FinanceService>,
    input: ExchangeRateUpsertDto,
) -> Result<Vec<ExchangeRateDto>, AppError> {
    service.upsert_exchange_rate(input).await
}

#[tauri::command]
pub async fn delete_exchange_rate(
    service: State<'_, FinanceService>,
    currency: String,
) -> Result<(), AppError> {
    service.delete_exchange_rate(currency).await
}

#[tauri::command]
pub async fn list_plan_items(
    service: State<'_, FinanceService>,
) -> Result<Vec<PlanItemDto>, AppError> {
    service.list_plan_items().await
}

#[tauri::command]
pub async fn create_plan_item(
    service: State<'_, FinanceService>,
    input: PlanItemInputDto,
) -> Result<PlanMutationDto, AppError> {
    service.create_plan_item(input).await
}

#[tauri::command]
pub async fn update_plan_item(
    service: State<'_, FinanceService>,
    input: PlanItemInputDto,
) -> Result<PlanItemDto, AppError> {
    service.update_plan_item(input).await
}

#[tauri::command]
pub async fn stop_plan_item(
    service: State<'_, FinanceService>,
    input: StopPlanItemRequestDto,
) -> Result<PlanItemDto, AppError> {
    service.stop_plan_item(input).await
}

#[tauri::command]
pub async fn delete_plan_item(
    service: State<'_, FinanceService>,
    id: String,
) -> Result<DeletePlanItemDto, AppError> {
    service.delete_plan_item(id).await
}

#[tauri::command]
pub async fn list_monthly_items(
    service: State<'_, FinanceService>,
    month: String,
) -> Result<Vec<MonthlyItemDto>, AppError> {
    service.list_monthly_items(month).await
}

#[tauri::command]
pub async fn ensure_actual_only_monthly_item(
    service: State<'_, FinanceService>,
    input: EnsureActualOnlyInputDto,
) -> Result<MonthlyItemDto, AppError> {
    service.ensure_actual_only(input).await
}

#[tauri::command]
pub async fn create_manual_monthly_item(
    service: State<'_, FinanceService>,
    input: ManualMonthlyItemInputDto,
) -> Result<MonthlyItemDto, AppError> {
    service.create_manual_monthly_item(input).await
}

#[tauri::command]
pub async fn list_actual_entries(
    service: State<'_, FinanceService>,
    monthly_item_id: String,
) -> Result<Vec<ActualEntryDto>, AppError> {
    service.list_actual_entries(monthly_item_id).await
}

#[tauri::command]
pub async fn create_actual_entry(
    service: State<'_, FinanceService>,
    input: ActualEntryInputDto,
) -> Result<ActualEntryDto, AppError> {
    service.create_actual_entry(input).await
}

#[tauri::command]
pub async fn update_actual_entry(
    service: State<'_, FinanceService>,
    input: ActualEntryInputDto,
) -> Result<ActualEntryDto, AppError> {
    service.update_actual_entry(input).await
}

#[tauri::command]
pub async fn delete_actual_entry(
    service: State<'_, FinanceService>,
    id: String,
) -> Result<(), AppError> {
    service.delete_actual_entry(id).await
}

#[tauri::command]
pub async fn confirm_monthly_item(
    service: State<'_, FinanceService>,
    input: ConfirmMonthlyItemInputDto,
) -> Result<MonthlyItemDto, AppError> {
    service.confirm_monthly_item(input).await
}

#[tauri::command]
pub async fn update_monthly_note(
    service: State<'_, FinanceService>,
    input: MonthlyNoteInputDto,
) -> Result<MonthlyItemDto, AppError> {
    service.update_monthly_note(input).await
}

#[tauri::command]
pub async fn confirm_monthly_actuals(
    service: State<'_, FinanceService>,
    input: ConfirmActualsInputDto,
) -> Result<ConfirmActualsDto, AppError> {
    service.confirm_actuals(input).await
}

#[tauri::command]
pub async fn list_existing_months(
    service: State<'_, FinanceService>,
) -> Result<Vec<String>, AppError> {
    service.list_existing_months().await
}

#[tauri::command]
pub async fn get_month_initialization_status(
    service: State<'_, FinanceService>,
    month: String,
) -> Result<MonthInitializationStatusDto, AppError> {
    service.initialization_status(month).await
}

#[tauri::command]
pub async fn preview_month(
    service: State<'_, FinanceService>,
    input: InitializeMonthInputDto,
) -> Result<MonthPreviewDto, AppError> {
    service.preview_month(input).await
}

#[tauri::command]
pub async fn initialize_month(
    service: State<'_, FinanceService>,
    input: InitializeMonthInputDto,
) -> Result<InitializeMonthDto, AppError> {
    service.initialize_month(input).await
}

#[tauri::command]
pub async fn get_month_analytics(
    service: State<'_, FinanceService>,
    month: String,
) -> Result<MonthAnalyticsDto, AppError> {
    service.month_analytics(month).await
}

#[tauri::command]
pub async fn get_history_analytics(
    service: State<'_, FinanceService>,
) -> Result<HistoryAnalyticsDto, AppError> {
    service.history_analytics().await
}

#[tauri::command]
pub async fn get_financial_capacity(
    service: State<'_, FinanceService>,
    target_month: Option<String>,
) -> Result<FinancialCapacityDto, AppError> {
    service.financial_capacity(target_month).await
}

#[tauri::command]
pub fn get_domain_contract() -> DomainContractDto {
    DomainContractDto {
        categories: vec![
            option("FIXED_INCOME", "固定收入"),
            option("VARIABLE_INCOME", "浮动收入"),
            option("ESSENTIAL_EXPENSE", "必要支出"),
            option("FIXED_COMMITMENT_EXPENSE", "固定承诺支出"),
            option("DISCRETIONARY_BUDGET", "自主性预算"),
        ],
        flow_types: vec![option("INCOME", "收入"), option("EXPENSE", "支出")],
        recognition_modes: vec![
            option("AMORTIZED", "按月均摊"),
            option("PAYMENT", "按支付月份确认"),
        ],
        amount_decimal_places: 2,
        exchange_rate_decimal_places: 8,
    }
}

#[tauri::command]
pub fn preview_plan_item(request: PlanPreviewRequestDto) -> Result<PlanPreviewDto, AppError> {
    let target_month = parse_month(&request.target_month, "targetMonth")?;
    let plan_item = parse_plan_item(request.plan_item)?;
    let exchange_rate = parse_exchange_rate(request.exchange_rate)?;
    let base_currency = exchange_rate.base_currency().clone();
    let equivalent = monthly_equivalent(&plan_item, target_month, &exchange_rate, &base_currency)
        .map_err(|error| AppError::from_domain(error, None))?;
    let recognized = recognized_amount(&plan_item, target_month, &exchange_rate, &base_currency)
        .map_err(|error| AppError::from_domain(error, None))?;

    Ok(PlanPreviewDto {
        effective: is_effective_in(&plan_item, target_month),
        recognized_in_target_month: recognized.is_some(),
        monthly_equivalent: equivalent.map(Amount::decimal_string),
        recognized_amount: recognized.map(Amount::decimal_string),
        scheduled_date: scheduled_date_for_month(&plan_item, target_month)
            .map(|date| date.to_string()),
        base_currency: base_currency.to_string(),
    })
}

#[tauri::command]
pub fn calculate_capacity(request: CapacityRequestDto) -> Result<CapacityDto, AppError> {
    let target_month = parse_month(&request.target_month, "targetMonth")?;
    let base_currency = CurrencyCode::new(&request.base_currency)
        .map_err(|error| AppError::from_domain(error, Some("baseCurrency")))?;
    let savings_rate = SavingsRate::from_basis_points(request.target_savings_rate_basis_points)
        .map_err(|error| AppError::from_domain(error, Some("targetSavingsRateBasisPoints")))?;

    let parsed = request
        .items
        .into_iter()
        .map(|item| {
            Ok((
                parse_plan_item(item.plan_item)?,
                parse_exchange_rate(item.exchange_rate)?,
            ))
        })
        .collect::<Result<Vec<_>, AppError>>()?;
    let inputs = parsed
        .iter()
        .map(|(plan_item, exchange_rate)| CapacityInput {
            plan_item,
            exchange_rate,
        })
        .collect::<Vec<_>>();
    let result = calculate_financial_capacity(target_month, savings_rate, base_currency, &inputs)
        .map_err(|error| AppError::from_domain(error, None))?;

    Ok(CapacityDto {
        base_currency: result.base_currency().to_string(),
        stable_income: result.stable_income().decimal_string(),
        variable_income: result.variable_income().decimal_string(),
        essential_expenses: result.essential_expenses().decimal_string(),
        fixed_commitments: result.fixed_commitments().decimal_string(),
        discretionary_budget: result.discretionary_budget().decimal_string(),
        preserved_capacity: result.preserved_capacity().decimal_string(),
        maximum_capacity: result.maximum_capacity().decimal_string(),
        fixed_commitment_ratio: result
            .fixed_commitment_ratio()
            .map(|ratio| ratio.decimal_string()),
        stable_income_coverage_ratio: result
            .stable_income_coverage_ratio()
            .map(|ratio| ratio.decimal_string()),
    })
}

fn option(code: &str, label: &str) -> EnumOptionDto {
    EnumOptionDto {
        code: code.to_owned(),
        label: label.to_owned(),
    }
}

fn parse_plan_item(input: PlanItemInputDto) -> Result<PlanItem, AppError> {
    let id = input
        .id
        .as_deref()
        .map(Uuid::parse_str)
        .transpose()
        .map_err(|_| AppError::validation("INVALID_UUID", "id", "error.invalid_uuid"))?
        .unwrap_or_else(Uuid::new_v4);
    let category = parse_category(&input.category)?;
    let amount = Amount::from_str(&input.planned_amount)
        .map_err(|error| AppError::from_domain(error, Some("plannedAmount")))?;
    let currency = CurrencyCode::new(&input.currency)
        .map_err(|error| AppError::from_domain(error, Some("currency")))?;
    let start_date = parse_date(&input.start_date, "startDate")?;
    let end_date = input
        .end_date
        .as_deref()
        .map(|date| parse_date(date, "endDate"))
        .transpose()?;
    let recognition_mode = parse_recognition_mode(&input.recognition_mode)?;

    PlanItem::new(
        id,
        input.name,
        category,
        amount,
        currency,
        input.period_months,
        start_date,
        end_date,
        recognition_mode,
        input.note,
    )
    .map_err(|error| AppError::from_domain(error, None))
}

fn parse_exchange_rate(input: ExchangeRateInputDto) -> Result<ExchangeRate, AppError> {
    let source = CurrencyCode::new(&input.source_currency)
        .map_err(|error| AppError::from_domain(error, Some("sourceCurrency")))?;
    let base = CurrencyCode::new(&input.base_currency)
        .map_err(|error| AppError::from_domain(error, Some("baseCurrency")))?;
    ExchangeRate::from_str(source, base, &input.rate)
        .map_err(|error| AppError::from_domain(error, Some("rate")))
}

fn parse_month(value: &str, field: &str) -> Result<YearMonth, AppError> {
    YearMonth::from_str(value).map_err(|error| AppError::from_domain(error, Some(field)))
}

fn parse_date(value: &str, field: &str) -> Result<CalendarDate, AppError> {
    CalendarDate::from_str(value).map_err(|error| AppError::from_domain(error, Some(field)))
}

fn parse_category(value: &str) -> Result<Category, AppError> {
    match value {
        "FIXED_INCOME" => Ok(Category::FixedIncome),
        "VARIABLE_INCOME" => Ok(Category::VariableIncome),
        "ESSENTIAL_EXPENSE" => Ok(Category::EssentialExpense),
        "FIXED_COMMITMENT_EXPENSE" => Ok(Category::FixedCommitmentExpense),
        "DISCRETIONARY_BUDGET" => Ok(Category::DiscretionaryBudget),
        _ => Err(AppError::validation(
            "INVALID_CATEGORY",
            "category",
            "error.invalid_category",
        )),
    }
}

fn parse_recognition_mode(value: &str) -> Result<RecognitionMode, AppError> {
    match value {
        "AMORTIZED" => Ok(RecognitionMode::Amortized),
        "PAYMENT" => Ok(RecognitionMode::Payment),
        _ => Err(AppError::validation(
            "INVALID_RECOGNITION_MODE",
            "recognitionMode",
            "error.invalid_recognition_mode",
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::application::dto::{CapacityItemInputDto, CapacityRequestDto};

    fn plan_input(
        name: &str,
        category: &str,
        amount: &str,
        period_months: u32,
        mode: &str,
    ) -> PlanItemInputDto {
        PlanItemInputDto {
            id: None,
            name: name.to_owned(),
            category: category.to_owned(),
            planned_amount: amount.to_owned(),
            currency: "CNY".to_owned(),
            period_months,
            start_date: "2026-01-01".to_owned(),
            end_date: None,
            recognition_mode: mode.to_owned(),
            note: None,
        }
    }

    fn cny_rate() -> ExchangeRateInputDto {
        ExchangeRateInputDto {
            source_currency: "CNY".to_owned(),
            base_currency: "CNY".to_owned(),
            rate: "1".to_owned(),
        }
    }

    #[test]
    fn domain_contract_exposes_stable_codes_and_precision() {
        let contract = get_domain_contract();
        assert_eq!(contract.categories.len(), 5);
        assert_eq!(contract.recognition_modes.len(), 2);
        assert_eq!(contract.categories[0].code, "FIXED_INCOME");
        assert_eq!(contract.amount_decimal_places, 2);
        assert_eq!(contract.exchange_rate_decimal_places, 8);
    }

    #[test]
    fn preview_returns_decimal_strings_and_payment_month_semantics() {
        let request = PlanPreviewRequestDto {
            target_month: "2026-02".to_owned(),
            plan_item: plan_input("年度保险", "ESSENTIAL_EXPENSE", "1200", 12, "PAYMENT"),
            exchange_rate: cny_rate(),
        };

        let preview = preview_plan_item(request).unwrap();
        assert!(preview.effective);
        assert!(!preview.recognized_in_target_month);
        assert_eq!(preview.recognized_amount, None);
        assert_eq!(preview.monthly_equivalent.as_deref(), Some("100.00"));
        assert_eq!(preview.base_currency, "CNY");
    }

    #[test]
    fn capacity_command_uses_monthly_equivalent_for_payment_mode() {
        let request = CapacityRequestDto {
            target_month: "2026-02".to_owned(),
            base_currency: "CNY".to_owned(),
            target_savings_rate_basis_points: 2000,
            items: vec![
                CapacityItemInputDto {
                    plan_item: plan_input("工资", "FIXED_INCOME", "30000", 1, "PAYMENT"),
                    exchange_rate: cny_rate(),
                },
                CapacityItemInputDto {
                    plan_item: plan_input(
                        "年度承诺",
                        "FIXED_COMMITMENT_EXPENSE",
                        "36000",
                        12,
                        "PAYMENT",
                    ),
                    exchange_rate: cny_rate(),
                },
            ],
        };

        let result = calculate_capacity(request).unwrap();
        assert_eq!(result.stable_income, "30000.00");
        assert_eq!(result.fixed_commitments, "3000.00");
        assert_eq!(result.maximum_capacity, "21000.00");
        assert_eq!(result.fixed_commitment_ratio.as_deref(), Some("0.10000000"));
    }

    #[test]
    fn invalid_category_returns_a_stable_structured_error() {
        let request = PlanPreviewRequestDto {
            target_month: "2026-02".to_owned(),
            plan_item: plan_input("未知", "CUSTOM", "1", 1, "AMORTIZED"),
            exchange_rate: cny_rate(),
        };

        let error = preview_plan_item(request).unwrap_err();
        assert_eq!(error.error_code, "INVALID_CATEGORY");
        assert_eq!(error.field.as_deref(), Some("category"));
        assert_eq!(error.message_key, "error.invalid_category");
    }
}
