use std::str::FromStr;

use pfcm_domain::{
    ActualEntry, ActualEntryEffect, ActualEntryOrigin, Amount, CalendarDate, Category,
    CurrencyCode, ExchangeRate, MonthlyItem, PlanItem, RecognitionMode, YearMonth,
};
use serde::{Deserialize, Serialize};
use sqlx::{QueryBuilder, Row, Sqlite, SqliteConnection, sqlite::SqliteRow};
use uuid::Uuid;

use crate::infrastructure::{ActualEntryExchangeSnapshot, Store, StoreError};

use super::{
    error::AppError,
    service::{FinanceService, current_natural_date, timestamp},
};

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutomaticPolicyInputDto {
    pub plan_item_id: String,
    pub enabled: bool,
    #[serde(default)]
    pub first_date: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct AutomaticPolicyDto {
    pub plan_item_id: String,
    pub enabled: bool,
    pub effective_month: Option<String>,
    pub first_date: Option<String>,
    pub period_months: Option<u32>,
    pub amount: Option<String>,
    pub currency: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct AutomaticOccurrenceDto {
    pub id: String,
    pub rule_key: String,
    pub rule_name: Option<String>,
    pub month: String,
    pub state: String,
    pub occurred_on: String,
    pub actual_entry_id: Option<String>,
    pub monthly_item_id: Option<String>,
    pub error_code: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct AutomaticCheckDto {
    pub current_month: String,
    pub created_count: u64,
    pub conflict_count: u64,
    pub failed_count: u64,
    pub occurrences: Vec<AutomaticOccurrenceDto>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolveAutomaticEntryConflictInputDto {
    pub id: String,
    pub action: String,
    #[serde(default)]
    pub actual_entry_id: Option<String>,
}

#[derive(Debug)]
struct PolicyVersion {
    id: Uuid,
    effective_month: YearMonth,
    first_date: CalendarDate,
    plan: PlanItem,
}

#[derive(Debug)]
struct Occurrence {
    dto: AutomaticOccurrenceDto,
    policy_version_id: Uuid,
}

const PLAN_SELECT: &str = "SELECT id AS rule_key, name AS snapshot_name, category, \
    planned_amount_scaled AS amount_scaled, currency_code, period_months, \
    recognition_mode, start_date, end_date, note FROM plan_items WHERE id = ?";

const OCCURRENCE_SELECT: &str = "SELECT o.id, o.rule_key, v.snapshot_name AS rule_name, \
    o.month, o.state, o.policy_version_id, o.occurred_on, o.actual_entry_id, \
    o.monthly_item_id, o.error_code FROM automatic_occurrences o \
    JOIN automatic_policy_versions v ON v.id = o.policy_version_id";

impl FinanceService {
    pub async fn list_automatic_entry_policies(&self) -> Result<Vec<AutomaticPolicyDto>, AppError> {
        let _operation = self.operation_gate.read().await;
        let store = self.current_store().await;
        let mut connection = store.acquire().await.map_err(AppError::from)?;
        let rule_ids: Vec<String> =
            sqlx::query_scalar("SELECT id FROM plan_items ORDER BY category, name, id")
                .fetch_all(&mut *connection)
                .await
                .map_err(database_error)?;
        let mut result = Vec::with_capacity(rule_ids.len());
        for rule_id in rule_ids {
            result.push(policy_dto_on(&mut connection, parse_id(&rule_id, "planItemId")?).await?);
        }
        Ok(result)
    }

    pub async fn save_automatic_entry_policy(
        &self,
        input: AutomaticPolicyInputDto,
    ) -> Result<AutomaticPolicyDto, AppError> {
        let _operation = self.operation_gate.write().await;
        self.save_automatic_entry_policy_at_unlocked(input, current_natural_date()?)
            .await
    }

    pub(crate) async fn save_automatic_entry_policy_at_unlocked(
        &self,
        input: AutomaticPolicyInputDto,
        today: CalendarDate,
    ) -> Result<AutomaticPolicyDto, AppError> {
        let rule_id = parse_id(&input.plan_item_id, "planItemId")?;
        let store = self.current_store().await;
        let mut transaction = store
            .pool()
            .begin_with("BEGIN IMMEDIATE")
            .await
            .map_err(database_error)?;
        let plan = live_plan_on(&mut transaction, rule_id).await?;
        let previous_policy = policy_on(&mut transaction, rule_id).await?;
        let enabled_from = if input.enabled {
            let next_month = today.year_month().next_month().map_err(domain_error)?;
            let previous_version = latest_version_on(&mut transaction, rule_id, None).await?;
            let first_date = select_first_date(
                &plan,
                previous_version.as_ref(),
                input.first_date.as_deref(),
                next_month,
            )?;
            save_version_on(
                &mut transaction,
                &plan,
                first_date,
                next_month,
                today.year_month(),
            )
            .await?;
            if previous_policy
                .as_ref()
                .is_some_and(|(enabled, _)| *enabled)
            {
                previous_policy.and_then(|(_, from)| from)
            } else {
                Some(next_month.database_anchor())
            }
        } else {
            previous_policy.and_then(|(_, from)| from)
        };
        let now = timestamp();
        sqlx::query(
            "INSERT INTO automatic_entry_policies \
                (plan_item_id, enabled, enabled_from_month, created_at, updated_at) VALUES (?, ?, ?, ?, ?) \
             ON CONFLICT(plan_item_id) DO UPDATE SET enabled = excluded.enabled, \
                enabled_from_month = excluded.enabled_from_month, updated_at = excluded.updated_at",
        )
        .bind(rule_id.to_string())
        .bind(input.enabled)
        .bind(enabled_from)
        .bind(&now)
        .bind(&now)
        .execute(&mut *transaction)
        .await
        .map_err(database_error)?;
        let result = policy_dto_on(&mut transaction, rule_id).await?;
        transaction.commit().await.map_err(database_error)?;
        Ok(result)
    }

    pub(crate) async fn refresh_automatic_policy_version_unlocked(
        &self,
        plan_item_id: Uuid,
    ) -> Result<(), AppError> {
        self.refresh_automatic_policy_version_at_unlocked(plan_item_id, current_natural_date()?)
            .await
    }

    pub(crate) async fn refresh_automatic_policy_version_at_unlocked(
        &self,
        plan_item_id: Uuid,
        today: CalendarDate,
    ) -> Result<(), AppError> {
        let store = self.current_store().await;
        let mut transaction = store
            .pool()
            .begin_with("BEGIN IMMEDIATE")
            .await
            .map_err(database_error)?;
        if !policy_on(&mut transaction, plan_item_id)
            .await?
            .is_some_and(|(enabled, _)| enabled)
        {
            transaction.commit().await.map_err(database_error)?;
            return Ok(());
        }
        let plan = live_plan_on(&mut transaction, plan_item_id).await?;
        let prior = latest_version_on(&mut transaction, plan_item_id, None)
            .await?
            .ok_or_else(|| {
                AppError::business(
                    "AUTOMATIC_POLICY_VERSION_MISSING",
                    "error.automatic_policy_version_missing",
                )
            })?;
        // Keep the cash anchor independent of recognition. An ended rule may have
        // no remaining occurrence; recording its next version still preserves audit.
        let first_date = prior.first_date.max(plan.start_date());
        let next_month = today.year_month().next_month().map_err(domain_error)?;
        save_version_on(
            &mut transaction,
            &plan,
            first_date,
            next_month,
            today.year_month(),
        )
        .await?;
        transaction.commit().await.map_err(database_error)?;
        Ok(())
    }

    pub async fn check_automatic_entries(&self) -> Result<AutomaticCheckDto, AppError> {
        let _operation = self.operation_gate.write().await;
        let today = current_natural_date()?;
        self.ensure_current_month_context_at_unlocked(today).await?;
        self.check_automatic_entries_at_unlocked(today).await
    }

    #[cfg(test)]
    pub(crate) async fn check_automatic_entries_at(
        &self,
        today: CalendarDate,
    ) -> Result<AutomaticCheckDto, AppError> {
        let _operation = self.operation_gate.read().await;
        self.check_automatic_entries_at_unlocked(today).await
    }

    pub(crate) async fn check_automatic_entries_at_unlocked(
        &self,
        today: CalendarDate,
    ) -> Result<AutomaticCheckDto, AppError> {
        let store = self.current_store().await;
        let rule_ids: Vec<String> = sqlx::query_scalar(
            "SELECT plan_item_id FROM automatic_entry_policies \
             WHERE enabled = 1 AND enabled_from_month <= ? ORDER BY plan_item_id",
        )
        .bind(today.year_month().database_anchor())
        .fetch_all(store.pool())
        .await
        .map_err(database_error)?;
        let mut created_count = 0;
        for rule_id in rule_ids {
            if post_due_occurrence(&store, parse_id(&rule_id, "planItemId")?, today).await? {
                created_count += 1;
            }
        }
        let mut connection = store.acquire().await.map_err(AppError::from)?;
        let occurrences = list_occurrences_on(&mut connection, Some(today.year_month())).await?;
        Ok(AutomaticCheckDto {
            current_month: today.year_month().to_string(),
            created_count,
            conflict_count: occurrences
                .iter()
                .filter(|entry| entry.state == "CONFLICT")
                .count() as u64,
            failed_count: occurrences
                .iter()
                .filter(|entry| entry.state == "FAILED")
                .count() as u64,
            occurrences,
        })
    }

    pub async fn list_automatic_occurrences(
        &self,
        month: Option<String>,
    ) -> Result<Vec<AutomaticOccurrenceDto>, AppError> {
        let month = month.as_deref().map(parse_month).transpose()?;
        let _operation = self.operation_gate.read().await;
        let store = self.current_store().await;
        let mut connection = store.acquire().await.map_err(AppError::from)?;
        list_occurrences_on(&mut connection, month).await
    }

    pub async fn resolve_automatic_entry_conflict(
        &self,
        input: ResolveAutomaticEntryConflictInputDto,
    ) -> Result<AutomaticOccurrenceDto, AppError> {
        let _operation = self.operation_gate.write().await;
        self.resolve_automatic_entry_conflict_at_unlocked(input, current_natural_date()?)
            .await
    }

    pub(crate) async fn resolve_automatic_entry_conflict_at_unlocked(
        &self,
        input: ResolveAutomaticEntryConflictInputDto,
        today: CalendarDate,
    ) -> Result<AutomaticOccurrenceDto, AppError> {
        let id = parse_id(&input.id, "id")?;
        if !matches!(
            input.action.as_str(),
            "LINK_EXISTING" | "SKIP" | "CREATE_SEPARATE"
        ) {
            return Err(AppError::validation(
                "INVALID_AUTOMATIC_CONFLICT_ACTION",
                "action",
                "error.invalid_automatic_conflict_action",
            ));
        }
        let store = self.current_store().await;
        let mut transaction = store
            .pool()
            .begin_with("BEGIN IMMEDIATE")
            .await
            .map_err(database_error)?;
        let occurrence = occurrence_by_id_on(&mut transaction, id).await?;
        if occurrence.dto.state != "CONFLICT" {
            // Repeated button clicks are safe, but never revive a deletion/skip.
            let is_repeat = (input.action == "SKIP" && occurrence.dto.state == "SKIPPED")
                || (occurrence.dto.state == "POSTED"
                    && ((input.action == "LINK_EXISTING"
                        && input.actual_entry_id == occurrence.dto.actual_entry_id)
                        || (input.action == "CREATE_SEPARATE"
                            && is_automatic_actual_on(
                                &mut transaction,
                                occurrence.dto.actual_entry_id.as_deref(),
                            )
                            .await?)));
            if !is_repeat {
                return Err(AppError::business(
                    "AUTOMATIC_OCCURRENCE_ALREADY_RESOLVED",
                    "error.automatic_occurrence_already_resolved",
                ));
            }
            transaction.commit().await.map_err(database_error)?;
            return Ok(occurrence.dto);
        }
        let mut actual_entry_id = None;
        let mut monthly_item_id = occurrence.dto.monthly_item_id.clone();
        match input.action.as_str() {
            "SKIP" => {}
            "LINK_EXISTING" => {
                let entry_id = input.actual_entry_id.as_deref().ok_or_else(|| {
                    AppError::validation(
                        "AUTOMATIC_ACTUAL_ENTRY_REQUIRED",
                        "actualEntryId",
                        "error.automatic_actual_entry_required",
                    )
                })?;
                let entry = Store::get_actual_entry_on(
                    &mut transaction,
                    parse_id(entry_id, "actualEntryId")?,
                )
                .await
                .map_err(AppError::from)?;
                if entry.value.origin() != ActualEntryOrigin::User
                    || Some(entry.value.monthly_item_id().to_string()) != monthly_item_id
                {
                    return Err(AppError::validation(
                        "AUTOMATIC_LINK_ENTRY_MISMATCH",
                        "actualEntryId",
                        "error.automatic_link_entry_mismatch",
                    ));
                }
                let already_linked: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM automatic_occurrences WHERE actual_entry_id = ? AND id != ?)")
                    .bind(entry.value.id().to_string()).bind(id.to_string()).fetch_one(&mut *transaction).await.map_err(database_error)?;
                if already_linked {
                    return Err(AppError::business(
                        "AUTOMATIC_ENTRY_ALREADY_LINKED",
                        "error.automatic_entry_already_linked",
                    ));
                }
                actual_entry_id = Some(entry.value.id().to_string());
            }
            "CREATE_SEPARATE" => {
                let version =
                    version_by_id_on(&mut transaction, occurrence.policy_version_id).await?;
                live_plan_on(&mut transaction, version.plan.id()).await?;
                let occurred_on = parse_date(&occurrence.dto.occurred_on, "occurredOn")?;
                if occurred_on > today {
                    return Err(AppError::business(
                        "AUTOMATIC_OCCURRENCE_NOT_DUE",
                        "error.automatic_occurrence_not_due",
                    ));
                }
                let base_currency = base_currency_on(&mut transaction).await?;
                // Explicit resolution may add beside manual records; exchange-rate
                // failure rolls back and keeps the unresolved conflict available.
                let (amount, snapshot) =
                    exchange_snapshot_on(&mut transaction, &version.plan, &base_currency, today)
                        .await?;
                let container_id = ensure_container_on(
                    &mut transaction,
                    &version.plan,
                    occurred_on.year_month(),
                    base_currency,
                )
                .await?;
                let actual = automatic_actual(&version.plan, container_id, occurred_on, amount)?;
                Store::insert_actual_entry_on(&mut transaction, &actual, &snapshot, &timestamp())
                    .await
                    .map_err(AppError::from)?;
                actual_entry_id = Some(actual.id().to_string());
                monthly_item_id = Some(container_id.to_string());
            }
            _ => unreachable!("validated conflict action"),
        }
        sqlx::query("UPDATE automatic_occurrences SET state = ?, actual_entry_id = ?, monthly_item_id = ?, error_code = NULL, updated_at = ? WHERE id = ? AND state = 'CONFLICT'")
            .bind(if input.action == "SKIP" { "SKIPPED" } else { "POSTED" })
            .bind(actual_entry_id).bind(monthly_item_id).bind(timestamp()).bind(id.to_string())
            .execute(&mut *transaction).await.map_err(database_error)?;
        let result = occurrence_by_id_on(&mut transaction, id).await?.dto;
        transaction.commit().await.map_err(database_error)?;
        Ok(result)
    }
}

async fn post_due_occurrence(
    store: &Store,
    rule_id: Uuid,
    today: CalendarDate,
) -> Result<bool, AppError> {
    let month = today.year_month();
    let mut transaction = store
        .pool()
        .begin_with("BEGIN IMMEDIATE")
        .await
        .map_err(database_error)?;
    let policy = policy_on(&mut transaction, rule_id).await?;
    if !policy.is_some_and(|(enabled, from)| {
        enabled && from.is_some_and(|from| from <= month.database_anchor())
    }) {
        transaction.commit().await.map_err(database_error)?;
        return Ok(false);
    }
    let existing = occurrence_for_month_on(&mut transaction, rule_id, month).await?;
    if existing
        .as_ref()
        .is_some_and(|entry| entry.dto.state != "FAILED")
    {
        transaction.commit().await.map_err(database_error)?;
        return Ok(false);
    }
    let version = if let Some(existing) = &existing {
        Some(version_by_id_on(&mut transaction, existing.policy_version_id).await?)
    } else {
        latest_version_on(&mut transaction, rule_id, Some(month)).await?
    };
    let Some(version) = version else {
        transaction.commit().await.map_err(database_error)?;
        return Ok(false);
    };
    let live_plan = live_plan_on(&mut transaction, rule_id).await?;
    let Some(occurred_on) = due_date(&version, month) else {
        transaction.commit().await.map_err(database_error)?;
        return Ok(false);
    };
    if occurred_on > today || live_plan.end_date().is_some_and(|end| occurred_on > end) {
        transaction.commit().await.map_err(database_error)?;
        return Ok(false);
    }
    let mut occurrence = existing.unwrap_or_else(|| Occurrence {
        dto: AutomaticOccurrenceDto {
            id: Uuid::new_v4().to_string(),
            rule_key: rule_id.to_string(),
            rule_name: Some(version.plan.name().to_owned()),
            month: month.to_string(),
            state: "FAILED".to_owned(),
            occurred_on: occurred_on.to_string(),
            actual_entry_id: None,
            monthly_item_id: None,
            error_code: None,
        },
        policy_version_id: version.id,
    });
    if version.plan.amount() == Amount::zero() {
        occurrence.dto.state = "SKIPPED".to_owned();
        occurrence.dto.error_code = Some("ZERO_ACTUAL_ENTRY_AMOUNT".to_owned());
    } else {
        let base_currency = base_currency_on(&mut transaction).await?;
        let container = container_on(&mut transaction, rule_id, month).await?;
        let mismatch = container
            .as_ref()
            .is_some_and(|(_, category)| category != version.plan.category().code());
        let has_manual = if let Some((id, _)) = &container {
            sqlx::query_scalar::<_, bool>("SELECT EXISTS(SELECT 1 FROM actual_entries WHERE monthly_item_id = ? AND origin != 'AUTOMATIC')")
                .bind(id.to_string()).fetch_one(&mut *transaction).await.map_err(database_error)?
        } else {
            false
        };
        if mismatch || has_manual {
            occurrence.dto.state = "CONFLICT".to_owned();
            occurrence.dto.monthly_item_id = container.map(|(id, _)| id.to_string());
            occurrence.dto.error_code = Some(
                if mismatch {
                    "AUTOMATIC_RULE_SNAPSHOT_MISMATCH"
                } else {
                    "AUTOMATIC_MANUAL_ENTRY_CONFLICT"
                }
                .to_owned(),
            );
        } else {
            match exchange_snapshot_on(&mut transaction, &version.plan, &base_currency, today).await
            {
                Ok((amount, snapshot)) => {
                    let container_id =
                        ensure_container_on(&mut transaction, &version.plan, month, base_currency)
                            .await?;
                    let actual =
                        automatic_actual(&version.plan, container_id, occurred_on, amount)?;
                    Store::insert_actual_entry_on(
                        &mut transaction,
                        &actual,
                        &snapshot,
                        &timestamp(),
                    )
                    .await
                    .map_err(AppError::from)?;
                    occurrence.dto.state = "POSTED".to_owned();
                    occurrence.dto.actual_entry_id = Some(actual.id().to_string());
                    occurrence.dto.monthly_item_id = Some(container_id.to_string());
                    occurrence.dto.error_code = None;
                }
                Err(error) if retryable_financial_error(&error) => {
                    occurrence.dto.state = "FAILED".to_owned();
                    occurrence.dto.monthly_item_id = container.map(|(id, _)| id.to_string());
                    occurrence.dto.error_code = Some(error.error_code);
                }
                Err(error) => return Err(error),
            }
        }
    }
    write_occurrence_on(&mut transaction, &occurrence).await?;
    let created = occurrence.dto.state == "POSTED";
    transaction.commit().await.map_err(database_error)?;
    Ok(created)
}

fn due_date(version: &PolicyVersion, month: YearMonth) -> Option<CalendarDate> {
    if month < version.effective_month {
        return None;
    }
    let elapsed = month.months_since(version.first_date.year_month())?;
    if !elapsed.is_multiple_of(version.plan.period_months()) {
        return None;
    }
    let date = month.date_clamped_to_day(version.first_date.day());
    (date >= version.first_date
        && date >= version.plan.start_date()
        && version.plan.end_date().is_none_or(|end| date <= end))
    .then_some(date)
}

fn select_first_date(
    plan: &PlanItem,
    prior: Option<&PolicyVersion>,
    explicit: Option<&str>,
    effective_month: YearMonth,
) -> Result<CalendarDate, AppError> {
    let date = if let Some(value) = explicit {
        parse_date(value, "firstDate")?
    } else if let Some(prior) = prior {
        prior.first_date.max(plan.start_date())
    } else if plan.recognition_mode() == RecognitionMode::Payment {
        plan.start_date()
    } else if plan.period_months() > 1 {
        return Err(AppError::validation(
            "AUTOMATIC_FIRST_DATE_REQUIRED",
            "firstDate",
            "error.automatic_first_date_required",
        ));
    } else if effective_month.first_date() >= plan.start_date() {
        effective_month.first_date()
    } else {
        let month = plan.start_date().year_month();
        if plan.start_date().day() == 1 {
            month.first_date()
        } else {
            month.next_month().map_err(domain_error)?.first_date()
        }
    };
    if date < plan.start_date() || plan.end_date().is_some_and(|end| date > end) {
        return Err(AppError::validation(
            "AUTOMATIC_FIRST_DATE_OUTSIDE_RULE",
            "firstDate",
            "error.automatic_first_date_outside_rule",
        ));
    }
    Ok(date)
}

async fn save_version_on(
    connection: &mut SqliteConnection,
    plan: &PlanItem,
    first_date: CalendarDate,
    effective_month: YearMonth,
    current_month: YearMonth,
) -> Result<(), AppError> {
    let result = sqlx::query(
        "INSERT INTO automatic_policy_versions (id, plan_item_id, rule_key, effective_month, \
            snapshot_name, category, recognition_mode, start_date, amount_scaled, currency_code, \
            period_months, first_date, end_date, note, created_at) \
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) \
         ON CONFLICT(rule_key, effective_month) DO UPDATE SET snapshot_name = excluded.snapshot_name, \
            category = excluded.category, recognition_mode = excluded.recognition_mode, \
            start_date = excluded.start_date, amount_scaled = excluded.amount_scaled, \
            currency_code = excluded.currency_code, period_months = excluded.period_months, \
            first_date = excluded.first_date, end_date = excluded.end_date, note = excluded.note \
         WHERE automatic_policy_versions.effective_month > ? AND NOT EXISTS (\
            SELECT 1 FROM automatic_occurrences WHERE policy_version_id = automatic_policy_versions.id)",
    )
    .bind(Uuid::new_v4().to_string()).bind(plan.id().to_string()).bind(plan.id().to_string())
    .bind(effective_month.database_anchor()).bind(plan.name()).bind(plan.category().code())
    .bind(plan.recognition_mode().code()).bind(plan.start_date().to_string())
    .bind(plan.amount().scaled_i64()).bind(plan.currency().as_str()).bind(i64::from(plan.period_months()))
    .bind(first_date.to_string()).bind(plan.end_date().map(|date| date.to_string()))
    .bind(plan.note()).bind(timestamp()).bind(current_month.database_anchor())
    .execute(&mut *connection).await.map_err(database_error)?;
    if result.rows_affected() == 0 {
        return Err(AppError::business(
            "AUTOMATIC_POLICY_VERSION_FROZEN",
            "error.automatic_policy_version_frozen",
        ));
    }
    Ok(())
}

async fn live_plan_on(connection: &mut SqliteConnection, id: Uuid) -> Result<PlanItem, AppError> {
    let row = sqlx::query(PLAN_SELECT)
        .bind(id.to_string())
        .fetch_optional(&mut *connection)
        .await
        .map_err(database_error)?
        .ok_or_else(|| AppError::business("NOT_FOUND", "error.not_found"))?;
    plan_from_row(&row)
}

fn plan_from_row(row: &SqliteRow) -> Result<PlanItem, AppError> {
    let category: String = row.try_get("category").map_err(database_error)?;
    let mode: String = row.try_get("recognition_mode").map_err(database_error)?;
    let start: String = row.try_get("start_date").map_err(database_error)?;
    let end: Option<String> = row.try_get("end_date").map_err(database_error)?;
    let period: i64 = row.try_get("period_months").map_err(database_error)?;
    PlanItem::new(
        parse_id(
            &row.try_get::<String, _>("rule_key")
                .map_err(database_error)?,
            "planItemId",
        )?,
        row.try_get::<String, _>("snapshot_name")
            .map_err(database_error)?,
        Category::from_str(&category).map_err(domain_error)?,
        Amount::from_scaled_i64(row.try_get("amount_scaled").map_err(database_error)?)
            .map_err(domain_error)?,
        CurrencyCode::new(
            row.try_get::<String, _>("currency_code")
                .map_err(database_error)?,
        )
        .map_err(domain_error)?,
        u32::try_from(period)
            .map_err(|_| AppError::business("INVALID_PERIOD", "error.invalid_period"))?,
        parse_date(&start, "startDate")?,
        end.as_deref()
            .map(|date| parse_date(date, "endDate"))
            .transpose()?,
        RecognitionMode::from_str(&mode).map_err(domain_error)?,
        row.try_get("note").map_err(database_error)?,
    )
    .map_err(domain_error)
}

async fn policy_on(
    connection: &mut SqliteConnection,
    id: Uuid,
) -> Result<Option<(bool, Option<String>)>, AppError> {
    sqlx::query(
        "SELECT enabled, enabled_from_month FROM automatic_entry_policies WHERE plan_item_id = ?",
    )
    .bind(id.to_string())
    .fetch_optional(&mut *connection)
    .await
    .map_err(database_error)?
    .as_ref()
    .map(|row| {
        Ok((
            row.try_get("enabled").map_err(database_error)?,
            row.try_get("enabled_from_month").map_err(database_error)?,
        ))
    })
    .transpose()
}

async fn latest_version_on(
    connection: &mut SqliteConnection,
    id: Uuid,
    month: Option<YearMonth>,
) -> Result<Option<PolicyVersion>, AppError> {
    let anchor = month.map(YearMonth::database_anchor);
    sqlx::query("SELECT * FROM automatic_policy_versions WHERE rule_key = ? AND (? IS NULL OR effective_month <= ?) ORDER BY effective_month DESC LIMIT 1")
        .bind(id.to_string()).bind(&anchor).bind(&anchor).fetch_optional(&mut *connection).await.map_err(database_error)?
        .as_ref().map(version_from_row).transpose()
}

async fn version_by_id_on(
    connection: &mut SqliteConnection,
    id: Uuid,
) -> Result<PolicyVersion, AppError> {
    let row = sqlx::query("SELECT * FROM automatic_policy_versions WHERE id = ?")
        .bind(id.to_string())
        .fetch_one(&mut *connection)
        .await
        .map_err(database_error)?;
    version_from_row(&row)
}

fn version_from_row(row: &SqliteRow) -> Result<PolicyVersion, AppError> {
    Ok(PolicyVersion {
        id: parse_id(
            &row.try_get::<String, _>("id").map_err(database_error)?,
            "id",
        )?,
        effective_month: YearMonth::from_database_anchor(
            &row.try_get::<String, _>("effective_month")
                .map_err(database_error)?,
        )
        .map_err(domain_error)?,
        first_date: parse_date(
            &row.try_get::<String, _>("first_date")
                .map_err(database_error)?,
            "firstDate",
        )?,
        plan: plan_from_row(row)?,
    })
}

async fn policy_dto_on(
    connection: &mut SqliteConnection,
    id: Uuid,
) -> Result<AutomaticPolicyDto, AppError> {
    let enabled = policy_on(connection, id)
        .await?
        .is_some_and(|(enabled, _)| enabled);
    let version = latest_version_on(connection, id, None).await?;
    Ok(AutomaticPolicyDto {
        plan_item_id: id.to_string(),
        enabled,
        effective_month: version
            .as_ref()
            .map(|version| version.effective_month.to_string()),
        first_date: version
            .as_ref()
            .map(|version| version.first_date.to_string()),
        period_months: version.as_ref().map(|version| version.plan.period_months()),
        amount: version
            .as_ref()
            .map(|version| version.plan.amount().decimal_string()),
        currency: version
            .as_ref()
            .map(|version| version.plan.currency().to_string()),
    })
}

async fn base_currency_on(connection: &mut SqliteConnection) -> Result<CurrencyCode, AppError> {
    Store::get_settings_on(connection)
        .await
        .map_err(AppError::from)?
        .map(|settings| settings.value.base_currency().clone())
        .ok_or_else(|| AppError::business("SETTINGS_REQUIRED", "error.settings_required"))
}

async fn container_on(
    connection: &mut SqliteConnection,
    rule_id: Uuid,
    month: YearMonth,
) -> Result<Option<(Uuid, String)>, AppError> {
    sqlx::query(
        "SELECT id, category FROM monthly_items WHERE source_plan_item_id = ? AND month = ?",
    )
    .bind(rule_id.to_string())
    .bind(month.database_anchor())
    .fetch_optional(&mut *connection)
    .await
    .map_err(database_error)?
    .as_ref()
    .map(|row| {
        Ok((
            parse_id(
                &row.try_get::<String, _>("id").map_err(database_error)?,
                "monthlyItemId",
            )?,
            row.try_get("category").map_err(database_error)?,
        ))
    })
    .transpose()
}

async fn ensure_container_on(
    connection: &mut SqliteConnection,
    plan: &PlanItem,
    month: YearMonth,
    base: CurrencyCode,
) -> Result<Uuid, AppError> {
    if let Some((id, category)) = container_on(connection, plan.id(), month).await? {
        if category != plan.category().code() {
            return Err(AppError::business(
                "AUTOMATIC_RULE_SNAPSHOT_MISMATCH",
                "error.automatic_rule_snapshot_mismatch",
            ));
        }
        return Ok(id);
    }
    let container = MonthlyItem::actual_only(Uuid::new_v4(), plan, month, base);
    Store::insert_monthly_item_on(connection, &container, &timestamp())
        .await
        .map_err(AppError::from)?;
    // Insert/promotion always retains the canonical id. Never assume a candidate
    // UUID was inserted when a source/month uniqueness constraint was reached.
    container_on(connection, plan.id(), month)
        .await?
        .map(|(id, _)| id)
        .ok_or_else(|| AppError::business("NOT_FOUND", "error.not_found"))
}

async fn exchange_snapshot_on(
    connection: &mut SqliteConnection,
    plan: &PlanItem,
    base: &CurrencyCode,
    today: CalendarDate,
) -> Result<(Amount, ActualEntryExchangeSnapshot), AppError> {
    let (rate, source, observed_on) = if plan.currency() == base {
        (
            ExchangeRate::from_str(base.clone(), base.clone(), "1").map_err(domain_error)?,
            "BASE_CURRENCY".to_owned(),
            today,
        )
    } else {
        let row = sqlx::query(
            "SELECT rate_scaled, source, observed_on FROM exchange_rates WHERE currency_code = ?",
        )
        .bind(plan.currency().as_str())
        .fetch_optional(&mut *connection)
        .await
        .map_err(database_error)?
        .ok_or_else(|| {
            AppError::business("MISSING_EXCHANGE_RATE", "error.missing_exchange_rate")
        })?;
        let rate = ExchangeRate::from_scaled_i64(
            plan.currency().clone(),
            base.clone(),
            row.try_get("rate_scaled").map_err(database_error)?,
        )
        .map_err(domain_error)?;
        let date: Option<String> = row.try_get("observed_on").map_err(database_error)?;
        let observed_on = date
            .as_deref()
            .map(|date| parse_date(date, "exchangeRateObservedOn"))
            .transpose()?
            .ok_or_else(|| {
                AppError::business(
                    "AUTOMATIC_EXCHANGE_RATE_DATE_REQUIRED",
                    "error.automatic_exchange_rate_date_required",
                )
            })?;
        if observed_on > today {
            return Err(AppError::business(
                "AUTOMATIC_EXCHANGE_RATE_DATE_IN_FUTURE",
                "error.automatic_exchange_rate_date_in_future",
            ));
        }
        (
            rate,
            row.try_get("source").map_err(database_error)?,
            observed_on,
        )
    };
    let converted = plan
        .amount()
        .as_decimal()
        .checked_mul(rate.value())
        .ok_or_else(|| AppError::business("ARITHMETIC_OVERFLOW", "error.arithmetic_overflow"))?;
    let amount = Amount::from_decimal(converted).map_err(domain_error)?;
    if amount == Amount::zero() {
        return Err(AppError::business(
            "ZERO_ACTUAL_ENTRY_AMOUNT",
            "error.zero_actual_entry_amount",
        ));
    }
    Ok((
        amount,
        ActualEntryExchangeSnapshot {
            source_amount: plan.amount(),
            source_currency: plan.currency().clone(),
            exchange_rate: rate,
            source,
            observed_on,
        },
    ))
}

fn retryable_financial_error(error: &AppError) -> bool {
    matches!(
        error.error_code.as_str(),
        "MISSING_EXCHANGE_RATE"
            | "AUTOMATIC_EXCHANGE_RATE_DATE_REQUIRED"
            | "AUTOMATIC_EXCHANGE_RATE_DATE_IN_FUTURE"
            | "INVALID_EXCHANGE_RATE"
            | "EXCHANGE_RATE_OUT_OF_RANGE"
            | "AMOUNT_OUT_OF_RANGE"
            | "ARITHMETIC_OVERFLOW"
            | "ZERO_ACTUAL_ENTRY_AMOUNT"
    )
}

fn automatic_actual(
    plan: &PlanItem,
    monthly_item_id: Uuid,
    occurred_on: CalendarDate,
    amount: Amount,
) -> Result<ActualEntry, AppError> {
    ActualEntry::new(
        Uuid::new_v4(),
        monthly_item_id,
        occurred_on.year_month(),
        occurred_on,
        ActualEntryEffect::Increase,
        amount,
        ActualEntryOrigin::Automatic,
        plan.note().map(str::to_owned),
    )
    .map_err(domain_error)
}

async fn occurrence_for_month_on(
    connection: &mut SqliteConnection,
    rule_id: Uuid,
    month: YearMonth,
) -> Result<Option<Occurrence>, AppError> {
    let mut query = QueryBuilder::<Sqlite>::new(OCCURRENCE_SELECT);
    query.push(" WHERE o.rule_key = ? AND o.month = ?");
    query
        .build()
        .bind(rule_id.to_string())
        .bind(month.database_anchor())
        .fetch_optional(&mut *connection)
        .await
        .map_err(database_error)?
        .as_ref()
        .map(occurrence_from_row)
        .transpose()
}

async fn occurrence_by_id_on(
    connection: &mut SqliteConnection,
    id: Uuid,
) -> Result<Occurrence, AppError> {
    let mut query = QueryBuilder::<Sqlite>::new(OCCURRENCE_SELECT);
    query.push(" WHERE o.id = ?");
    let row = query
        .build()
        .bind(id.to_string())
        .fetch_one(&mut *connection)
        .await
        .map_err(database_error)?;
    occurrence_from_row(&row)
}

fn occurrence_from_row(row: &SqliteRow) -> Result<Occurrence, AppError> {
    let anchor: String = row.try_get("month").map_err(database_error)?;
    Ok(Occurrence {
        dto: AutomaticOccurrenceDto {
            id: row.try_get("id").map_err(database_error)?,
            rule_key: row.try_get("rule_key").map_err(database_error)?,
            rule_name: row.try_get("rule_name").map_err(database_error)?,
            month: YearMonth::from_database_anchor(&anchor)
                .map_err(domain_error)?
                .to_string(),
            state: row.try_get("state").map_err(database_error)?,
            occurred_on: row.try_get("occurred_on").map_err(database_error)?,
            actual_entry_id: row.try_get("actual_entry_id").map_err(database_error)?,
            monthly_item_id: row.try_get("monthly_item_id").map_err(database_error)?,
            error_code: row.try_get("error_code").map_err(database_error)?,
        },
        policy_version_id: parse_id(
            &row.try_get::<String, _>("policy_version_id")
                .map_err(database_error)?,
            "policyVersionId",
        )?,
    })
}

async fn list_occurrences_on(
    connection: &mut SqliteConnection,
    month: Option<YearMonth>,
) -> Result<Vec<AutomaticOccurrenceDto>, AppError> {
    let anchor = month.map(YearMonth::database_anchor);
    let mut query = QueryBuilder::<Sqlite>::new(OCCURRENCE_SELECT);
    query
        .push(" WHERE (? IS NULL OR o.month = ?) ORDER BY o.month DESC, o.occurred_on, o.rule_key");
    let rows = query
        .build()
        .bind(&anchor)
        .bind(&anchor)
        .fetch_all(&mut *connection)
        .await
        .map_err(database_error)?;
    rows.iter()
        .map(|row| occurrence_from_row(row).map(|entry| entry.dto))
        .collect()
}

async fn write_occurrence_on(
    connection: &mut SqliteConnection,
    occurrence: &Occurrence,
) -> Result<(), AppError> {
    let dto = &occurrence.dto;
    let month = parse_month(&dto.month)?;
    let now = timestamp();
    sqlx::query(
        "INSERT INTO automatic_occurrences (id, rule_key, month, state, policy_version_id, occurred_on, \
            actual_entry_id, monthly_item_id, error_code, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) \
         ON CONFLICT(rule_key, month) DO UPDATE SET state = excluded.state, actual_entry_id = excluded.actual_entry_id, \
            monthly_item_id = excluded.monthly_item_id, error_code = excluded.error_code, updated_at = excluded.updated_at \
         WHERE automatic_occurrences.state = 'FAILED'",
    ).bind(&dto.id).bind(&dto.rule_key).bind(month.database_anchor()).bind(&dto.state)
        .bind(occurrence.policy_version_id.to_string()).bind(&dto.occurred_on).bind(&dto.actual_entry_id)
        .bind(&dto.monthly_item_id).bind(&dto.error_code).bind(&now).bind(&now)
        .execute(&mut *connection).await.map_err(database_error)?;
    Ok(())
}

async fn is_automatic_actual_on(
    connection: &mut SqliteConnection,
    id: Option<&str>,
) -> Result<bool, AppError> {
    let Some(id) = id else {
        return Ok(false);
    };
    sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM actual_entries WHERE id = ? AND origin = 'AUTOMATIC')",
    )
    .bind(id)
    .fetch_one(&mut *connection)
    .await
    .map_err(database_error)
}

fn parse_id(value: &str, field: &str) -> Result<Uuid, AppError> {
    Uuid::parse_str(value)
        .map_err(|_| AppError::validation("INVALID_UUID", field, "error.invalid_uuid"))
}

fn parse_date(value: &str, field: &str) -> Result<CalendarDate, AppError> {
    if !value.is_ascii() {
        return Err(AppError::validation(
            "INVALID_DATE",
            field,
            "error.invalid_date",
        ));
    }
    value
        .parse()
        .map_err(|error| AppError::from_domain(error, Some(field)))
}

fn parse_month(value: &str) -> Result<YearMonth, AppError> {
    if !value.is_ascii() {
        return Err(AppError::validation(
            "INVALID_YEAR_MONTH",
            "month",
            "error.invalid_year_month",
        ));
    }
    value
        .parse()
        .map_err(|error| AppError::from_domain(error, Some("month")))
}

fn domain_error(error: pfcm_domain::DomainError) -> AppError {
    AppError::from_domain(error, None)
}

fn database_error(error: sqlx::Error) -> AppError {
    AppError::from(StoreError::from(error))
}
