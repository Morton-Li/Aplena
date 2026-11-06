use std::str::FromStr;

use pfcm_domain::{
    ActualEntry, ActualEntryEffect, ActualEntryOrigin, Amount, CalendarDate, Category,
    CurrencyCode, ExchangeRate, LoanFrequency, LoanScheduleMethod, LoanScheduleRow, MonthlyItem,
    SignedAmount, YearMonth, generate_loan_schedule,
};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::{Row, SqliteConnection};
use tauri::State;
use uuid::Uuid;

use super::{
    error::AppError,
    service::{FinanceService, current_natural_date, parse_uuid, timestamp},
};
use crate::infrastructure::{ActualEntryExchangeSnapshot, Store, StoreError};

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoanInput {
    pub id: String,
    pub name: String,
    pub counterparty: String,
    pub direction: String,
    pub principal: String,
    pub started_on: String,
    pub opening_only: bool,
    pub note: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoanMetadataInput {
    pub id: String,
    pub name: String,
    pub counterparty: String,
    pub note: Option<String>,
    pub archived: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct LoanDto {
    pub id: String,
    pub name: String,
    pub counterparty: String,
    pub direction: String,
    pub currency: String,
    pub principal: String,
    pub total_principal: String,
    pub started_on: String,
    pub opening_only: bool,
    pub archived: bool,
    pub note: Option<String>,
    pub paid_principal: String,
    pub remaining_principal: String,
    pub remaining_charges: String,
    pub scheduled_remaining_principal: String,
    pub plan_review_required: bool,
    pub overdue_total: String,
    pub next_due_on: Option<String>,
    pub status: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct LoanInstallmentDto {
    pub id: String,
    pub version_id: String,
    pub position: i64,
    pub due_on: String,
    pub principal: String,
    pub interest: String,
    pub fees: String,
    pub paid_principal: String,
    pub paid_interest: String,
    pub paid_fees: String,
    pub remaining_principal: String,
    pub remaining_interest: String,
    pub remaining_fees: String,
    pub remaining_total: String,
    pub state: String,
    pub superseded: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LoanAllocation {
    pub installment_id: Option<String>,
    pub principal: String,
    pub interest: String,
    pub fees: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoanPaymentInput {
    pub id: String,
    pub loan_id: String,
    pub expected_updated_at: Option<String>,
    pub occurred_on: String,
    pub principal: String,
    pub interest: String,
    pub fees: String,
    pub note: Option<String>,
    /// Empty means oldest installments first, independently for each component.
    pub allocations: Vec<LoanAllocation>,
}

#[derive(Debug, Clone, Serialize)]
pub struct LoanPaymentDto {
    pub id: String,
    pub occurred_on: String,
    pub principal: String,
    pub interest: String,
    pub fees: String,
    pub total: String,
    pub note: Option<String>,
    pub updated_at: String,
    pub allocations: Vec<LoanAllocation>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoanAdvanceInput {
    pub id: String,
    pub loan_id: String,
    pub expected_updated_at: Option<String>,
    pub occurred_on: String,
    pub principal: String,
    pub note: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct LoanAdvanceDto {
    pub id: String,
    pub occurred_on: String,
    pub principal: String,
    pub note: Option<String>,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct LoanScheduleVersionDto {
    pub id: String,
    pub frequency: String,
    pub interval_count: i64,
    pub method: String,
    pub period_rate_percent: String,
    pub note: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct LoanDetailDto {
    pub loan: LoanDto,
    pub installments: Vec<LoanInstallmentDto>,
    pub payments: Vec<LoanPaymentDto>,
    pub advances: Vec<LoanAdvanceDto>,
    pub versions: Vec<LoanScheduleVersionDto>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoanScheduleInput {
    pub loan_id: String,
    pub frequency: LoanFrequency,
    pub interval_count: u32,
    pub first_date: String,
    pub count: u32,
    pub method: String,
    pub period_rate_percent: String,
    pub note: Option<String>,
    pub rows: Vec<LoanScheduleRow>,
    #[serde(default)]
    pub correct_past_installments: bool,
    pub expected_correction_revision: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct LoanSchedulePreview {
    pub principal_to_schedule: String,
    pub preserved_count: usize,
    pub corrected_past_count: usize,
    pub correction_revision: Option<String>,
    pub rows: Vec<LoanScheduleRow>,
}

struct PreparedLoanSchedule {
    preview: LoanSchedulePreview,
    corrected_past_ids: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteLoanActualInput {
    pub id: String,
    pub expected_updated_at: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct LoanMonthSummary {
    pub month: String,
    pub currency: String,
    pub has_loans: bool,
    pub plan_review_required_count: i64,
    pub actual_principal_in: String,
    pub actual_principal_out: String,
    pub actual_cash_net: Option<String>,
    pub planned_borrow_principal: String,
    pub planned_borrow_charges: String,
    pub planned_borrow_total: String,
    pub planned_lent_principal: String,
    pub planned_lent_charges: String,
    pub planned_lent_total: String,
}

fn invalid(code: &str) -> AppError {
    AppError::business(code, format!("error.{}", code.to_lowercase()))
}
fn db(error: sqlx::Error) -> AppError {
    AppError::from(StoreError::Database(error))
}
fn amount(value: &str) -> Result<Amount, AppError> {
    Amount::from_str(value).map_err(|e| AppError::from_domain(e, Some("amount")))
}
fn date(value: &str) -> Result<CalendarDate, AppError> {
    value
        .parse()
        .map_err(|e| AppError::from_domain(e, Some("date")))
}
fn money(value: i64) -> Result<String, AppError> {
    Amount::from_scaled_i64(value)
        .map(|v| v.to_string())
        .map_err(|e| AppError::from_domain(e, None))
}
fn normalized(value: Option<String>) -> Option<String> {
    value.map(|v| v.trim().to_owned()).filter(|v| !v.is_empty())
}
fn sum(mut values: impl Iterator<Item = i64>) -> Result<i64, AppError> {
    values.try_fold(0_i64, |a, b| {
        a.checked_add(b)
            .ok_or_else(|| invalid("AMOUNT_OUT_OF_RANGE"))
    })
}
fn components(principal: &str, interest: &str, fees: &str) -> Result<[i64; 3], AppError> {
    Ok([
        amount(principal)?.scaled_i64(),
        amount(interest)?.scaled_i64(),
        amount(fees)?.scaled_i64(),
    ])
}

impl FinanceService {
    pub async fn create_loan(&self, input: LoanInput) -> Result<LoanDto, AppError> {
        let _operation = self.operation_gate.write().await;
        let id = parse_uuid(&input.id, "id")?.to_string();
        if input.name.trim().is_empty() || input.counterparty.trim().is_empty() {
            return Err(invalid("LOAN_NAME_REQUIRED"));
        }
        if !["BORROWED", "LENT"].contains(&input.direction.as_str()) {
            return Err(invalid("LOAN_DIRECTION_INVALID"));
        }
        let principal = amount(&input.principal)?;
        let started = date(&input.started_on)?;
        if principal == Amount::zero() || started > current_natural_date()? {
            return Err(invalid("LOAN_DATE_OR_AMOUNT_INVALID"));
        }
        let settings = self.ensure_default_settings_unlocked().await?;
        let store = self.current_store().await;
        let mut tx = store.pool().begin().await.map_err(db)?;
        let existing = sqlx::query("SELECT * FROM loans WHERE id = ?")
            .bind(&id)
            .fetch_optional(&mut *tx)
            .await
            .map_err(db)?;
        if let Some(row) = existing {
            if row.get::<String, _>("name") != input.name.trim()
                || row.get::<String, _>("counterparty") != input.counterparty.trim()
                || row.get::<String, _>("direction") != input.direction
                || row.get::<i64, _>("principal_scaled") != principal.scaled_i64()
                || row.get::<String, _>("started_on") != started.to_string()
                || row.get::<i64, _>("opening_only") != i64::from(input.opening_only)
                || row.get::<Option<String>, _>("note") != normalized(input.note.clone())
            {
                return Err(invalid("LOAN_DUPLICATE_REQUEST"));
            }
        } else {
            let now = timestamp();
            sqlx::query("INSERT INTO loans (id,name,counterparty,direction,currency_code,principal_scaled,started_on,opening_only,note,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)")
                .bind(&id).bind(input.name.trim()).bind(input.counterparty.trim()).bind(&input.direction)
                .bind(settings.value.base_currency().as_str()).bind(principal.scaled_i64()).bind(started.to_string())
                .bind(input.opening_only).bind(normalized(input.note)).bind(&now).bind(&now).execute(&mut *tx).await.map_err(db)?;
        }
        let result = detail_on(&mut tx, &id, current_natural_date()?).await?.loan;
        tx.commit().await.map_err(db)?;
        Ok(result)
    }

    pub async fn list_loans(&self) -> Result<Vec<LoanDto>, AppError> {
        let _operation = self.operation_gate.read().await;
        let store = self.current_store().await;
        let mut tx = store.pool().begin().await.map_err(db)?;
        let ids: Vec<String> =
            sqlx::query_scalar("SELECT id FROM loans ORDER BY archived, created_at DESC, id")
                .fetch_all(&mut *tx)
                .await
                .map_err(db)?;
        let today = current_natural_date()?;
        let mut loans = Vec::new();
        for id in ids {
            loans.push(detail_on(&mut tx, &id, today).await?.loan);
        }
        tx.commit().await.map_err(db)?;
        Ok(loans)
    }

    pub async fn get_loan(&self, id: String) -> Result<LoanDetailDto, AppError> {
        let _operation = self.operation_gate.read().await;
        parse_uuid(&id, "id")?;
        let store = self.current_store().await;
        let mut tx = store.pool().begin().await.map_err(db)?;
        let result = detail_on(&mut tx, &id, current_natural_date()?).await?;
        tx.commit().await.map_err(db)?;
        Ok(result)
    }

    pub async fn update_loan_metadata(&self, input: LoanMetadataInput) -> Result<(), AppError> {
        let _operation = self.operation_gate.write().await;
        if input.name.trim().is_empty() || input.counterparty.trim().is_empty() {
            return Err(invalid("LOAN_NAME_REQUIRED"));
        }
        let store = self.current_store().await;
        let mut tx = store.pool().begin().await.map_err(db)?;
        let detail = detail_on(&mut tx, &input.id, current_natural_date()?).await?;
        if input.archived && detail.loan.status != "SETTLED" {
            return Err(invalid("LOAN_NOT_SETTLED"));
        }
        sqlx::query(
            "UPDATE loans SET name=?,counterparty=?,note=?,archived=?,updated_at=? WHERE id=?",
        )
        .bind(input.name.trim())
        .bind(input.counterparty.trim())
        .bind(normalized(input.note))
        .bind(input.archived)
        .bind(timestamp())
        .bind(&input.id)
        .execute(&mut *tx)
        .await
        .map_err(db)?;
        tx.commit().await.map_err(db)?;
        Ok(())
    }

    pub async fn preview_loan_schedule(
        &self,
        input: LoanScheduleInput,
    ) -> Result<LoanSchedulePreview, AppError> {
        let _operation = self.operation_gate.read().await;
        let store = self.current_store().await;
        let mut tx = store.pool().begin().await.map_err(db)?;
        let result = schedule_on(&mut tx, &input, current_natural_date()?).await?;
        tx.commit().await.map_err(db)?;
        Ok(result.preview)
    }

    pub async fn save_loan_schedule(&self, input: LoanScheduleInput) -> Result<(), AppError> {
        self.save_loan_schedule_at(input, current_natural_date()?)
            .await
    }

    pub(crate) async fn save_loan_schedule_at(
        &self,
        input: LoanScheduleInput,
        today: CalendarDate,
    ) -> Result<(), AppError> {
        let _operation = self.operation_gate.write().await;
        let store = self.current_store().await;
        let mut tx = store.pool().begin().await.map_err(db)?;
        let PreparedLoanSchedule {
            preview,
            corrected_past_ids,
        } = schedule_on(&mut tx, &input, today).await?;
        if input.correct_past_installments
            && preview.correction_revision != input.expected_correction_revision
        {
            return Err(invalid("LOAN_STALE_RECORD"));
        }
        let now = timestamp();
        let version = Uuid::new_v4().to_string();
        sqlx::query("UPDATE loan_installments SET superseded=1 WHERE loan_id=? AND superseded=0 AND due_on>=?")
            .bind(&input.loan_id).bind(today.to_string()).execute(&mut *tx).await.map_err(db)?;
        for id in corrected_past_ids {
            sqlx::query("UPDATE loan_installments SET superseded=1 WHERE id=?")
                .bind(id)
                .execute(&mut *tx)
                .await
                .map_err(db)?;
        }
        sqlx::query("INSERT INTO loan_schedule_versions (id,loan_id,frequency,interval_count,method,period_rate_percent,note,created_at) VALUES (?,?,?,?,?,?,?,?)")
            .bind(&version).bind(&input.loan_id).bind(frequency_code(input.frequency)).bind(i64::from(input.interval_count))
            .bind(&input.method).bind(&input.period_rate_percent).bind(normalized(input.note)).bind(&now).execute(&mut *tx).await.map_err(db)?;
        for (index, row) in preview.rows.into_iter().enumerate() {
            sqlx::query("INSERT INTO loan_installments (id,loan_id,version_id,position,due_on,principal_scaled,interest_scaled,fees_scaled) VALUES (?,?,?,?,?,?,?,?)")
                .bind(Uuid::new_v4().to_string()).bind(&input.loan_id).bind(&version).bind(index as i64 + 1).bind(row.due_on.to_string())
                .bind(row.principal.scaled_i64()).bind(row.interest.scaled_i64()).bind(row.fees.scaled_i64()).execute(&mut *tx).await.map_err(db)?;
        }
        tx.commit().await.map_err(db)?;
        Ok(())
    }

    pub async fn preview_loan_payment(
        &self,
        input: LoanPaymentInput,
    ) -> Result<Vec<LoanAllocation>, AppError> {
        let _operation = self.operation_gate.read().await;
        let store = self.current_store().await;
        let mut tx = store.pool().begin().await.map_err(db)?;
        let editing = prepare_payment_on(&mut tx, &input).await?;
        let original_allocations = payment_allocations_for_on(&mut tx, &input.id).await?;
        if !editing {
            let existing =
                sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM loan_payments WHERE id=?")
                    .bind(&input.id)
                    .fetch_one(&mut *tx)
                    .await
                    .map_err(db)?;
            if existing > 0 {
                tx.rollback().await.map_err(db)?;
                return Ok(original_allocations);
            }
        }
        if editing {
            detach_payment_on(&mut tx, &input.id).await?;
        }
        let allocations = payment_allocations_on(&mut tx, &input, &original_allocations).await?;
        // Preview never commits the temporary removal of an existing payment.
        tx.rollback().await.map_err(db)?;
        Ok(allocations)
    }

    pub async fn save_loan_payment(&self, input: LoanPaymentInput) -> Result<(), AppError> {
        let _operation = self.operation_gate.write().await;
        let store = self.current_store().await;
        let mut tx = store.pool().begin().await.map_err(db)?;
        let editing = prepare_payment_on(&mut tx, &input).await?;
        let original_allocations = payment_allocations_for_on(&mut tx, &input.id).await?;
        if editing {
            detach_payment_on(&mut tx, &input.id).await?;
        } else if sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM loan_payments WHERE id=?")
            .bind(&input.id)
            .fetch_one(&mut *tx)
            .await
            .map_err(db)?
            > 0
        {
            // A retry of an identical creation is already committed.
            return Ok(());
        }
        let allocations = payment_allocations_on(&mut tx, &input, &original_allocations).await?;
        let parts = components(&input.principal, &input.interest, &input.fees)?;
        let now = timestamp();
        sqlx::query("INSERT INTO loan_payments (id,loan_id,occurred_on,principal_scaled,interest_scaled,fees_scaled,note,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET occurred_on=excluded.occurred_on,principal_scaled=excluded.principal_scaled,interest_scaled=excluded.interest_scaled,fees_scaled=excluded.fees_scaled,note=excluded.note,updated_at=excluded.updated_at")
            .bind(&input.id).bind(&input.loan_id).bind(&input.occurred_on).bind(parts[0]).bind(parts[1]).bind(parts[2])
            .bind(normalized(input.note)).bind(&now).bind(&now).execute(&mut *tx).await.map_err(db)?;
        for allocation in allocations {
            let values = components(
                &allocation.principal,
                &allocation.interest,
                &allocation.fees,
            )?;
            sqlx::query("INSERT INTO loan_payment_allocations (id,payment_id,installment_id,principal_scaled,interest_scaled,fees_scaled) VALUES (?,?,?,?,?,?)")
                .bind(Uuid::new_v4().to_string()).bind(&input.id).bind(allocation.installment_id).bind(values[0]).bind(values[1]).bind(values[2])
                .execute(&mut *tx).await.map_err(db)?;
        }
        let charge = sum(parts[1..].iter().copied())?;
        if charge > 0 {
            post_charges_on(
                &mut tx,
                &input.loan_id,
                &input.id,
                date(&input.occurred_on)?,
                charge,
                &now,
            )
            .await?;
        }
        // A correction to an archived contract makes it visible again.
        sqlx::query("UPDATE loans SET archived=0,updated_at=? WHERE id=?")
            .bind(&now)
            .bind(&input.loan_id)
            .execute(&mut *tx)
            .await
            .map_err(db)?;
        tx.commit().await.map_err(db)?;
        Ok(())
    }

    pub async fn delete_loan_payment(&self, input: DeleteLoanActualInput) -> Result<(), AppError> {
        let _operation = self.operation_gate.write().await;
        let store = self.current_store().await;
        let mut tx = store.pool().begin().await.map_err(db)?;
        let row = sqlx::query("SELECT loan_id,updated_at FROM loan_payments WHERE id=?")
            .bind(&input.id)
            .fetch_one(&mut *tx)
            .await
            .map_err(db)?;
        if row.get::<String, _>("updated_at") != input.expected_updated_at {
            return Err(invalid("LOAN_STALE_RECORD"));
        }
        detach_payment_on(&mut tx, &input.id).await?;
        sqlx::query("DELETE FROM loan_payments WHERE id=?")
            .bind(&input.id)
            .execute(&mut *tx)
            .await
            .map_err(db)?;
        sqlx::query("UPDATE loans SET archived=0,updated_at=? WHERE id=?")
            .bind(timestamp())
            .bind(row.get::<String, _>("loan_id"))
            .execute(&mut *tx)
            .await
            .map_err(db)?;
        tx.commit().await.map_err(db)?;
        Ok(())
    }

    pub async fn save_loan_advance(&self, input: LoanAdvanceInput) -> Result<(), AppError> {
        let _operation = self.operation_gate.write().await;
        let id = parse_uuid(&input.id, "id")?.to_string();
        let loan_id = parse_uuid(&input.loan_id, "loanId")?.to_string();
        let occurred_on = date(&input.occurred_on)?;
        let principal = amount(&input.principal)?.scaled_i64();
        let note = normalized(input.note);
        let store = self.current_store().await;
        let mut tx = store
            .pool()
            .begin_with("BEGIN IMMEDIATE")
            .await
            .map_err(db)?;
        let loan = sqlx::query("SELECT started_on,principal_scaled FROM loans WHERE id=?")
            .bind(&loan_id)
            .fetch_one(&mut *tx)
            .await
            .map_err(db)?;
        if principal == 0
            || occurred_on < date(&loan.get::<String, _>("started_on"))?
            || occurred_on > current_natural_date()?
        {
            return Err(invalid("LOAN_ADVANCE_DATE_OR_AMOUNT_INVALID"));
        }
        let occurred_on = occurred_on.to_string();
        let existing = sqlx::query("SELECT * FROM loan_advances WHERE id=?")
            .bind(&id)
            .fetch_optional(&mut *tx)
            .await
            .map_err(db)?;
        if let Some(row) = existing {
            if row.get::<String, _>("loan_id") != loan_id {
                return Err(invalid("LOAN_DUPLICATE_REQUEST"));
            }
            if let Some(revision) = &input.expected_updated_at {
                if *revision != row.get::<String, _>("updated_at") {
                    return Err(invalid("LOAN_STALE_RECORD"));
                }
            } else {
                if row.get::<String, _>("occurred_on") != occurred_on
                    || row.get::<i64, _>("principal_scaled") != principal
                    || row.get::<Option<String>, _>("note") != note
                {
                    return Err(invalid("LOAN_DUPLICATE_REQUEST"));
                }
                return Ok(());
            }
        } else if input.expected_updated_at.is_some() {
            return Err(invalid("LOAN_STALE_RECORD"));
        }
        let other_advances: i64 = sqlx::query_scalar(
            "SELECT COALESCE(SUM(principal_scaled),0) FROM loan_advances WHERE loan_id=? AND id!=?",
        )
        .bind(&loan_id)
        .bind(&id)
        .fetch_one(&mut *tx)
        .await
        .map_err(db)?;
        sum([loan.get("principal_scaled"), other_advances, principal].into_iter())?;
        let now = timestamp();
        sqlx::query(
            "INSERT INTO loan_advances (id,loan_id,occurred_on,principal_scaled,note,created_at,updated_at)
             VALUES (?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET occurred_on=excluded.occurred_on,
             principal_scaled=excluded.principal_scaled,note=excluded.note,updated_at=excluded.updated_at",
        )
        .bind(&id).bind(&loan_id).bind(occurred_on).bind(principal).bind(note).bind(&now).bind(&now)
        .execute(&mut *tx).await.map_err(db)?;
        sqlx::query("UPDATE loans SET archived=0,updated_at=? WHERE id=?")
            .bind(now)
            .bind(loan_id)
            .execute(&mut *tx)
            .await
            .map_err(db)?;
        tx.commit().await.map_err(db)?;
        Ok(())
    }

    pub async fn delete_loan_advance(&self, input: DeleteLoanActualInput) -> Result<(), AppError> {
        let _operation = self.operation_gate.write().await;
        let id = parse_uuid(&input.id, "id")?.to_string();
        let store = self.current_store().await;
        let mut tx = store
            .pool()
            .begin_with("BEGIN IMMEDIATE")
            .await
            .map_err(db)?;
        let loan_id: Option<String> = sqlx::query_scalar(
            "DELETE FROM loan_advances WHERE id=? AND updated_at=? RETURNING loan_id",
        )
        .bind(id)
        .bind(input.expected_updated_at)
        .fetch_optional(&mut *tx)
        .await
        .map_err(db)?;
        let loan_id = loan_id.ok_or_else(|| invalid("LOAN_STALE_RECORD"))?;
        sqlx::query("UPDATE loans SET archived=0,updated_at=? WHERE id=?")
            .bind(timestamp())
            .bind(loan_id)
            .execute(&mut *tx)
            .await
            .map_err(db)?;
        tx.commit().await.map_err(db)?;
        Ok(())
    }

    pub async fn loan_month_summary(&self, month: String) -> Result<LoanMonthSummary, AppError> {
        let _operation = self.operation_gate.read().await;
        let month: YearMonth = month
            .parse()
            .map_err(|e| AppError::from_domain(e, Some("month")))?;
        self.loan_month_summary_unlocked(month).await
    }

    pub(crate) async fn loan_month_summary_unlocked(
        &self,
        month: YearMonth,
    ) -> Result<LoanMonthSummary, AppError> {
        let store = self.current_store().await;
        let mut tx = store.pool().begin().await.map_err(db)?;
        let currency: String =
            sqlx::query_scalar("SELECT base_currency_code FROM settings WHERE id=1")
                .fetch_one(&mut *tx)
                .await
                .map_err(db)?;
        let loans: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM loans")
            .fetch_one(&mut *tx)
            .await
            .map_err(db)?;
        let plan_review_required_count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM loans l WHERE EXISTS (SELECT 1 FROM loan_schedule_versions v WHERE v.loan_id=l.id) AND
             (SELECT SUM(m.delta_scaled) FROM loan_principal_movements m WHERE m.loan_id=l.id)
             != (SELECT COALESCE(SUM(i.principal_scaled),0) FROM loan_installments i WHERE i.loan_id=l.id AND i.superseded=0)
                - (SELECT COALESCE(SUM(a.principal_scaled),0) FROM loan_payment_allocations a JOIN loan_installments i ON i.id=a.installment_id WHERE i.loan_id=l.id AND i.superseded=0)"
        ).fetch_one(&mut *tx).await.map_err(db)?;
        let mut principal_in = 0;
        let mut principal_out = 0;
        let mut cash_count = 0_i64;
        let rows = sqlx::query(
            "SELECT l.direction,m.delta_scaled FROM loan_principal_movements m
             JOIN loans l ON l.id=m.loan_id WHERE m.is_cash=1 AND substr(m.occurred_on,1,7)=?",
        )
        .bind(month.to_string())
        .fetch_all(&mut *tx)
        .await
        .map_err(db)?;
        for row in rows {
            let delta: i64 = row.get("delta_scaled");
            let borrowed = row.get::<String, _>("direction") == "BORROWED";
            if (borrowed && delta > 0) || (!borrowed && delta < 0) {
                principal_in = sum([principal_in, delta.abs()].into_iter())?;
            } else {
                principal_out = sum([principal_out, delta.abs()].into_iter())?;
            }
            cash_count += 1;
        }
        let mut borrowed = [0_i64; 3];
        let mut lent = [0_i64; 3];
        let rows = sqlx::query("SELECT l.direction,i.principal_scaled-COALESCE(SUM(a.principal_scaled),0) AS principal,i.interest_scaled-COALESCE(SUM(a.interest_scaled),0) AS interest,i.fees_scaled-COALESCE(SUM(a.fees_scaled),0) AS fees FROM loan_installments i JOIN loans l ON l.id=i.loan_id LEFT JOIN loan_payment_allocations a ON a.installment_id=i.id WHERE i.superseded=0 AND substr(i.due_on,1,7)=? GROUP BY i.id")
            .bind(month.to_string()).fetch_all(&mut *tx).await.map_err(db)?;
        for row in rows {
            let totals = if row.get::<String, _>("direction") == "BORROWED" {
                &mut borrowed
            } else {
                &mut lent
            };
            for (index, field) in ["principal", "interest", "fees"].iter().enumerate() {
                totals[index] = sum([totals[index], row.get::<i64, _>(*field)].into_iter())?;
            }
        }
        let actual = sqlx::query("SELECT COUNT(*) AS count,COALESCE(SUM(CASE WHEN m.flow_type='INCOME' THEN CASE e.effect WHEN 'INCREASE' THEN e.amount_scaled ELSE -e.amount_scaled END ELSE CASE e.effect WHEN 'INCREASE' THEN -e.amount_scaled ELSE e.amount_scaled END END),0) AS net FROM actual_entries e JOIN monthly_items m ON m.id=e.monthly_item_id WHERE substr(e.occurred_on,1,7)=?")
            .bind(month.to_string()).fetch_one(&mut *tx).await.map_err(db)?;
        let cash = Decimal::new(actual.get("net"), 2) + Decimal::new(principal_in, 2)
            - Decimal::new(principal_out, 2);
        let actual_cash_net = if actual.get::<i64, _>("count") + cash_count > 0 {
            Some(
                SignedAmount::from_decimal(cash)
                    .map_err(|e| AppError::from_domain(e, None))?
                    .decimal_string(),
            )
        } else {
            None
        };
        let result = LoanMonthSummary {
            month: month.to_string(),
            currency,
            has_loans: loans > 0,
            plan_review_required_count,
            actual_principal_in: money(principal_in)?,
            actual_principal_out: money(principal_out)?,
            actual_cash_net,
            planned_borrow_principal: money(borrowed[0])?,
            planned_borrow_charges: money(sum(borrowed[1..].iter().copied())?)?,
            planned_borrow_total: money(sum(borrowed.into_iter())?)?,
            planned_lent_principal: money(lent[0])?,
            planned_lent_charges: money(sum(lent[1..].iter().copied())?)?,
            planned_lent_total: money(sum(lent.into_iter())?)?,
        };
        tx.commit().await.map_err(db)?;
        Ok(result)
    }

    pub(crate) async fn reject_loan_monthly_write(&self, id: Uuid) -> Result<(), AppError> {
        let store = self.current_store().await;
        let count: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM loan_monthly_items WHERE monthly_item_id=?")
                .bind(id.to_string())
                .fetch_one(store.pool())
                .await
                .map_err(db)?;
        if count > 0 {
            return Err(invalid("LOAN_MANAGED_ENTRY"));
        }
        Ok(())
    }
}

fn frequency_code(value: LoanFrequency) -> &'static str {
    match value {
        LoanFrequency::Day => "DAY",
        LoanFrequency::Month => "MONTH",
        LoanFrequency::Quarter => "QUARTER",
        LoanFrequency::Year => "YEAR",
    }
}

async fn detail_on(
    connection: &mut SqliteConnection,
    id: &str,
    today: CalendarDate,
) -> Result<LoanDetailDto, AppError> {
    let loan = sqlx::query("SELECT * FROM loans WHERE id=?")
        .bind(id)
        .fetch_one(&mut *connection)
        .await
        .map_err(db)?;
    let mut installments = Vec::new();
    let rows = sqlx::query("SELECT i.*,COALESCE(SUM(a.principal_scaled),0) AS paid_principal,COALESCE(SUM(a.interest_scaled),0) AS paid_interest,COALESCE(SUM(a.fees_scaled),0) AS paid_fees FROM loan_installments i LEFT JOIN loan_payment_allocations a ON a.installment_id=i.id WHERE i.loan_id=? GROUP BY i.id ORDER BY i.due_on,i.position,i.id").bind(id).fetch_all(&mut *connection).await.map_err(db)?;
    let mut overdue = 0;
    let mut charges = 0;
    let mut scheduled_remaining_principal = 0;
    let mut next_due: Option<String> = None;
    for row in rows {
        let original = [
            row.get::<i64, _>("principal_scaled"),
            row.get("interest_scaled"),
            row.get("fees_scaled"),
        ];
        let paid = [
            row.get::<i64, _>("paid_principal"),
            row.get("paid_interest"),
            row.get("paid_fees"),
        ];
        let remaining = [
            original[0] - paid[0],
            original[1] - paid[1],
            original[2] - paid[2],
        ];
        let total = sum(remaining.into_iter())?;
        let due: String = row.get("due_on");
        let superseded = row.get::<i64, _>("superseded") != 0;
        let state = if superseded {
            "SUPERSEDED"
        } else if total == 0 {
            "PAID"
        } else if due < today.to_string() {
            "OVERDUE"
        } else if sum(paid.into_iter())? > 0 {
            "PARTIAL"
        } else {
            "PENDING"
        };
        if !superseded {
            scheduled_remaining_principal =
                sum([scheduled_remaining_principal, remaining[0]].into_iter())?;
            charges = sum([charges, remaining[1], remaining[2]].into_iter())?;
            if total > 0 && due < today.to_string() {
                overdue = sum([overdue, total].into_iter())?;
            }
            if total > 0 && next_due.as_ref().is_none_or(|v| due < *v) {
                next_due = Some(due.clone());
            }
        }
        installments.push(LoanInstallmentDto {
            id: row.get("id"),
            version_id: row.get("version_id"),
            position: row.get("position"),
            due_on: due,
            principal: money(original[0])?,
            interest: money(original[1])?,
            fees: money(original[2])?,
            paid_principal: money(paid[0])?,
            paid_interest: money(paid[1])?,
            paid_fees: money(paid[2])?,
            remaining_principal: money(remaining[0])?,
            remaining_interest: money(remaining[1])?,
            remaining_fees: money(remaining[2])?,
            remaining_total: money(total)?,
            state: state.to_owned(),
            superseded,
        });
    }
    let mut payments = Vec::new();
    let rows = sqlx::query(
        "SELECT * FROM loan_payments WHERE loan_id=? ORDER BY occurred_on DESC,created_at DESC,id",
    )
    .bind(id)
    .fetch_all(&mut *connection)
    .await
    .map_err(db)?;
    let mut repaid = 0;
    for row in rows {
        let payment_id: String = row.get("id");
        let parts = [
            row.get::<i64, _>("principal_scaled"),
            row.get("interest_scaled"),
            row.get("fees_scaled"),
        ];
        repaid = sum([repaid, parts[0]].into_iter())?;
        let allocations = payment_allocations_for_on(connection, &payment_id).await?;
        payments.push(LoanPaymentDto {
            id: payment_id,
            occurred_on: row.get("occurred_on"),
            principal: money(parts[0])?,
            interest: money(parts[1])?,
            fees: money(parts[2])?,
            total: money(sum(parts.into_iter())?)?,
            note: row.get("note"),
            updated_at: row.get("updated_at"),
            allocations,
        });
    }
    let principal: i64 = loan.get("principal_scaled");
    let mut total_principal = principal;
    let mut advances = Vec::new();
    let rows = sqlx::query(
        "SELECT * FROM loan_advances WHERE loan_id=? ORDER BY occurred_on DESC,created_at DESC,id",
    )
    .bind(id)
    .fetch_all(&mut *connection)
    .await
    .map_err(db)?;
    for row in rows {
        let advance = row.get("principal_scaled");
        total_principal = sum([total_principal, advance].into_iter())?;
        advances.push(LoanAdvanceDto {
            id: row.get("id"),
            occurred_on: row.get("occurred_on"),
            principal: money(advance)?,
            note: row.get("note"),
            updated_at: row.get("updated_at"),
        });
    }
    let remaining = total_principal - repaid;
    let versions: Vec<_> = sqlx::query(
        "SELECT * FROM loan_schedule_versions WHERE loan_id=? ORDER BY created_at DESC,id",
    )
    .bind(id)
    .fetch_all(&mut *connection)
    .await
    .map_err(db)?
    .into_iter()
    .map(|v| LoanScheduleVersionDto {
        id: v.get("id"),
        frequency: v.get("frequency"),
        interval_count: v.get("interval_count"),
        method: v.get("method"),
        period_rate_percent: v.get("period_rate_percent"),
        note: v.get("note"),
        created_at: v.get("created_at"),
    })
    .collect();
    let plan_review_required = !versions.is_empty() && scheduled_remaining_principal != remaining;
    Ok(LoanDetailDto {
        loan: LoanDto {
            id: id.to_owned(),
            name: loan.get("name"),
            counterparty: loan.get("counterparty"),
            direction: loan.get("direction"),
            currency: loan.get("currency_code"),
            principal: money(principal)?,
            total_principal: money(total_principal)?,
            started_on: loan.get("started_on"),
            opening_only: loan.get::<i64, _>("opening_only") != 0,
            archived: loan.get::<i64, _>("archived") != 0,
            note: loan.get("note"),
            paid_principal: money(repaid)?,
            remaining_principal: money(remaining)?,
            remaining_charges: money(charges)?,
            scheduled_remaining_principal: money(scheduled_remaining_principal)?,
            plan_review_required,
            overdue_total: money(overdue)?,
            next_due_on: next_due,
            status: if remaining == 0 && charges == 0 && !plan_review_required {
                "SETTLED"
            } else {
                "ACTIVE"
            }
            .to_owned(),
        },
        installments,
        payments,
        advances,
        versions,
    })
}

async fn schedule_on(
    connection: &mut SqliteConnection,
    input: &LoanScheduleInput,
    today: CalendarDate,
) -> Result<PreparedLoanSchedule, AppError> {
    let rate = Decimal::from_str_exact(&input.period_rate_percent)
        .map_err(|_| invalid("INVALID_RATIO"))?;
    if rate < Decimal::ZERO || rate > Decimal::ONE_HUNDRED || rate.scale() > 8 {
        return Err(invalid("INVALID_RATIO"));
    }
    let detail = detail_on(connection, &input.loan_id, today).await?;
    if detail.loan.archived {
        return Err(invalid("LOAN_ARCHIVED"));
    }
    if input.interval_count == 0 || input.interval_count > 10_000 {
        return Err(invalid("INVALID_PERIOD"));
    }
    let has_existing = !detail.versions.is_empty();
    let today_text = today.to_string();
    let remaining = amount(&detail.loan.remaining_principal)?.scaled_i64();
    let mut past_principal = 0;
    let mut preserved_count = 0;
    let mut correctable = Vec::new();
    for row in detail
        .installments
        .iter()
        .filter(|row| !row.superseded && row.due_on < today_text)
    {
        preserved_count += 1;
        let unpaid = amount(&row.remaining_principal)?.scaled_i64();
        if unpaid > 0 {
            past_principal = sum([past_principal, unpaid].into_iter())?;
            correctable.push(row);
        }
    }
    // Remaining principal already excludes all paid principal, including amounts
    // allocated to superseded installments and unassigned payments.
    let available = match (past_principal > remaining, input.correct_past_installments) {
        (true, false) => return Err(invalid("LOAN_PAST_INSTALLMENTS_CORRECTION_REQUIRED")),
        (false, true) => return Err(invalid("LOAN_STALE_RECORD")),
        (true, true) => remaining,
        (false, false) => {
            correctable.clear();
            remaining - past_principal
        }
    };
    let rows = match input.method.as_str() {
        "MANUAL" => input.rows.clone(),
        "EQUAL_PRINCIPAL" | "ANNUITY" => {
            let rate = Decimal::from_str_exact(&input.period_rate_percent)
                .map_err(|_| invalid("INVALID_RATIO"))?;
            generate_loan_schedule(
                Amount::from_scaled_i64(available).map_err(|e| AppError::from_domain(e, None))?,
                date(&input.first_date)?,
                input.frequency,
                input.interval_count,
                input.count,
                if input.method == "ANNUITY" {
                    LoanScheduleMethod::Annuity
                } else {
                    LoanScheduleMethod::EqualPrincipal
                },
                rate,
            )
            .map_err(|e| AppError::from_domain(e, None))?
        }
        _ => return Err(invalid("LOAN_SCHEDULE_METHOD_INVALID")),
    };
    if rows.len() > 10_000 {
        return Err(invalid("INVALID_PERIOD"));
    }
    let started = date(&detail.loan.started_on)?;
    let earliest = if let Some(first) = correctable.first() {
        date(&first.due_on)?.max(started)
    } else if has_existing {
        today.max(started)
    } else {
        started
    };
    let mut total = 0;
    let mut previous = None;
    for row in &rows {
        if row.due_on < earliest
            || previous.is_some_and(|v| row.due_on <= v)
            || row
                .principal
                .checked_add(row.interest)
                .and_then(|v| v.checked_add(row.fees))
                .map_err(|e| AppError::from_domain(e, None))?
                == Amount::zero()
        {
            return Err(invalid("LOAN_SCHEDULE_DATE_INVALID"));
        }
        total = sum([total, row.principal.scaled_i64()].into_iter())?;
        previous = Some(row.due_on);
    }
    if total != available {
        return Err(invalid("LOAN_SCHEDULE_PRINCIPAL_MISMATCH"));
    }
    let correction_revision = if correctable.is_empty() {
        None
    } else {
        // Include all installments being replaced so a payment between preview
        // and save cannot put newly paid amounts back into the plan.
        let future = detail
            .installments
            .iter()
            .filter(|row| !row.superseded && row.due_on >= today_text)
            .collect::<Vec<_>>();
        let reviewed = serde_json::to_vec(&(&correctable, &future, &rows))
            .map_err(|_| invalid("LOAN_STALE_RECORD"))?;
        Some(format!("{:x}", Sha256::digest(reviewed)))
    };
    Ok(PreparedLoanSchedule {
        preview: LoanSchedulePreview {
            principal_to_schedule: money(available)?,
            preserved_count: preserved_count - correctable.len(),
            corrected_past_count: correctable.len(),
            correction_revision,
            rows,
        },
        corrected_past_ids: correctable.iter().map(|row| row.id.clone()).collect(),
    })
}

async fn prepare_payment_on(
    connection: &mut SqliteConnection,
    input: &LoanPaymentInput,
) -> Result<bool, AppError> {
    parse_uuid(&input.id, "id")?;
    let row = sqlx::query("SELECT * FROM loan_payments WHERE id=?")
        .bind(&input.id)
        .fetch_optional(&mut *connection)
        .await
        .map_err(db)?;
    if let Some(row) = row {
        if row.get::<String, _>("loan_id") != input.loan_id {
            return Err(invalid("LOAN_ALLOCATION_MISMATCH"));
        }
        if let Some(revision) = &input.expected_updated_at {
            if *revision != row.get::<String, _>("updated_at") {
                return Err(invalid("LOAN_STALE_RECORD"));
            }
            return Ok(true);
        }
        let parts = components(&input.principal, &input.interest, &input.fees)?;
        if row.get::<String, _>("occurred_on") != input.occurred_on
            || row.get::<i64, _>("principal_scaled") != parts[0]
            || row.get::<i64, _>("interest_scaled") != parts[1]
            || row.get::<i64, _>("fees_scaled") != parts[2]
            || row.get::<Option<String>, _>("note") != normalized(input.note.clone())
        {
            return Err(invalid("LOAN_DUPLICATE_REQUEST"));
        }
        if !input.allocations.is_empty() {
            let stored = sqlx::query("SELECT installment_id,principal_scaled,interest_scaled,fees_scaled FROM loan_payment_allocations WHERE payment_id=?")
                .bind(&input.id).fetch_all(&mut *connection).await.map_err(db)?;
            let mut existing: Vec<(Option<String>, [i64; 3])> = stored
                .into_iter()
                .map(|row| {
                    (
                        row.get("installment_id"),
                        [
                            row.get("principal_scaled"),
                            row.get("interest_scaled"),
                            row.get("fees_scaled"),
                        ],
                    )
                })
                .collect();
            let mut requested = input
                .allocations
                .iter()
                .map(|row| {
                    Ok((
                        row.installment_id.clone(),
                        components(&row.principal, &row.interest, &row.fees)?,
                    ))
                })
                .collect::<Result<Vec<_>, AppError>>()?;
            existing.sort();
            requested.sort();
            if existing != requested {
                return Err(invalid("LOAN_DUPLICATE_REQUEST"));
            }
        }
        return Ok(false);
    }
    if input.expected_updated_at.is_some() {
        return Err(invalid("LOAN_STALE_RECORD"));
    }
    Ok(false)
}

async fn payment_allocations_for_on(
    connection: &mut SqliteConnection,
    payment_id: &str,
) -> Result<Vec<LoanAllocation>, AppError> {
    sqlx::query(
        "SELECT * FROM loan_payment_allocations WHERE payment_id=? ORDER BY installment_id,id",
    )
    .bind(payment_id)
    .fetch_all(&mut *connection)
    .await
    .map_err(db)?
    .into_iter()
    .map(|row| {
        Ok(LoanAllocation {
            installment_id: row.get("installment_id"),
            principal: money(row.get("principal_scaled"))?,
            interest: money(row.get("interest_scaled"))?,
            fees: money(row.get("fees_scaled"))?,
        })
    })
    .collect()
}

async fn detach_payment_on(connection: &mut SqliteConnection, id: &str) -> Result<(), AppError> {
    let actual: Option<String> =
        sqlx::query_scalar("SELECT actual_entry_id FROM loan_actual_links WHERE payment_id=?")
            .bind(id)
            .fetch_optional(&mut *connection)
            .await
            .map_err(db)?;
    sqlx::query("DELETE FROM loan_actual_links WHERE payment_id=?")
        .bind(id)
        .execute(&mut *connection)
        .await
        .map_err(db)?;
    if let Some(actual) = actual {
        sqlx::query("DELETE FROM actual_entries WHERE id=?")
            .bind(actual)
            .execute(&mut *connection)
            .await
            .map_err(db)?;
    }
    sqlx::query("DELETE FROM loan_payment_allocations WHERE payment_id=?")
        .bind(id)
        .execute(&mut *connection)
        .await
        .map_err(db)?;
    // Keep the header until its replacement has been validated, but exclude it from principal checks.
    Ok(())
}

async fn payment_allocations_on(
    connection: &mut SqliteConnection,
    input: &LoanPaymentInput,
    original_allocations: &[LoanAllocation],
) -> Result<Vec<LoanAllocation>, AppError> {
    let today = current_natural_date()?;
    let detail = detail_on(connection, &input.loan_id, today).await?;
    let occurred = date(&input.occurred_on)?;
    if occurred < date(&detail.loan.started_on)? || occurred > today {
        return Err(invalid("LOAN_PAYMENT_DATE_INVALID"));
    }
    let parts = components(&input.principal, &input.interest, &input.fees)?;
    if sum(parts.into_iter())? == 0 {
        return Err(invalid("ZERO_ACTUAL_ENTRY_AMOUNT"));
    }
    let previous: Option<i64> =
        sqlx::query_scalar("SELECT principal_scaled FROM loan_payments WHERE id=?")
            .bind(&input.id)
            .fetch_optional(&mut *connection)
            .await
            .map_err(db)?;
    if parts[0] > amount(&detail.loan.remaining_principal)?.scaled_i64() + previous.unwrap_or(0) {
        return Err(invalid("LOAN_PRINCIPAL_OVERPAYMENT"));
    }
    if parts[0] > 0 {
        let overpaid: bool = sqlx::query_scalar(
            "WITH movements AS (
               SELECT occurred_on,delta_scaled FROM loan_principal_movements
               WHERE loan_id=? AND (payment_id IS NULL OR payment_id!=?)
               UNION ALL SELECT ?,?
             ), balances AS (
               SELECT SUM(SUM(delta_scaled)) OVER (ORDER BY occurred_on) AS balance_scaled
               FROM movements GROUP BY occurred_on
             )
             SELECT EXISTS(SELECT 1 FROM balances WHERE balance_scaled<0)",
        )
        .bind(&input.loan_id)
        .bind(&input.id)
        .bind(occurred.to_string())
        .bind(-parts[0])
        .fetch_one(&mut *connection)
        .await
        .map_err(db)?;
        if overpaid {
            return Err(invalid("LOAN_PRINCIPAL_OVERPAYMENT"));
        }
    }
    let mut allocations = input.allocations.clone();
    if allocations.is_empty() {
        let mut remaining = parts;
        // Later plans have already deducted these historical amounts from their
        // principal basis. Reassigning them to the new plan would count them twice.
        for original in original_allocations {
            if original.installment_id.as_ref().is_some_and(|id| {
                detail
                    .installments
                    .iter()
                    .any(|row| &row.id == id && !row.superseded)
            }) {
                continue;
            }
            let prior = components(&original.principal, &original.interest, &original.fees)?;
            let mut retained = [0; 3];
            for index in 0..3 {
                retained[index] = remaining[index].min(prior[index]);
                remaining[index] -= retained[index];
            }
            if sum(retained.into_iter())? > 0 {
                allocations.push(LoanAllocation {
                    installment_id: original.installment_id.clone(),
                    principal: money(retained[0])?,
                    interest: money(retained[1])?,
                    fees: money(retained[2])?,
                });
            }
        }
        for row in detail.installments.iter().filter(|v| !v.superseded) {
            let available = components(
                &row.remaining_principal,
                &row.remaining_interest,
                &row.remaining_fees,
            )?;
            let mut allocated = [0; 3];
            for index in 0..3 {
                allocated[index] = remaining[index].min(available[index]);
                remaining[index] -= allocated[index];
            }
            if sum(allocated.into_iter())? > 0 {
                allocations.push(LoanAllocation {
                    installment_id: Some(row.id.clone()),
                    principal: money(allocated[0])?,
                    interest: money(allocated[1])?,
                    fees: money(allocated[2])?,
                });
            }
        }
        if sum(remaining.into_iter())? > 0 {
            if let Some(unassigned) = allocations
                .iter_mut()
                .find(|row| row.installment_id.is_none())
            {
                let retained = components(
                    &unassigned.principal,
                    &unassigned.interest,
                    &unassigned.fees,
                )?;
                unassigned.principal = money(sum([retained[0], remaining[0]].into_iter())?)?;
                unassigned.interest = money(sum([retained[1], remaining[1]].into_iter())?)?;
                unassigned.fees = money(sum([retained[2], remaining[2]].into_iter())?)?;
            } else {
                allocations.push(LoanAllocation {
                    installment_id: None,
                    principal: money(remaining[0])?,
                    interest: money(remaining[1])?,
                    fees: money(remaining[2])?,
                });
            }
        }
    }
    let mut totals = [0; 3];
    let mut allocated_active_principal = 0;
    let mut unassigned_principal = 0;
    let mut seen = std::collections::HashSet::new();
    for allocation in &allocations {
        let values = components(
            &allocation.principal,
            &allocation.interest,
            &allocation.fees,
        )?;
        if sum(values.into_iter())? == 0 || !seen.insert(allocation.installment_id.clone()) {
            return Err(invalid("LOAN_ALLOCATION_MISMATCH"));
        }
        if let Some(id) = &allocation.installment_id {
            let row = detail
                .installments
                .iter()
                .find(|v| &v.id == id && (!v.superseded || input.expected_updated_at.is_some()))
                .ok_or_else(|| invalid("LOAN_ALLOCATION_MISMATCH"))?;
            let available = components(
                &row.remaining_principal,
                &row.remaining_interest,
                &row.remaining_fees,
            )?;
            if (0..3).any(|i| values[i] > available[i]) {
                return Err(invalid("LOAN_ALLOCATION_OVERPAYMENT"));
            }
            if !row.superseded {
                allocated_active_principal =
                    sum([allocated_active_principal, values[0]].into_iter())?;
            }
        } else {
            unassigned_principal = values[0];
        }
        for index in 0..3 {
            totals[index] = sum([totals[index], values[index]].into_iter())?;
        }
    }
    if totals != parts {
        return Err(invalid("LOAN_ALLOCATION_MISMATCH"));
    }
    let planned_principal = sum(detail
        .installments
        .iter()
        .filter(|v| !v.superseded)
        .map(|v| amount(&v.remaining_principal).map(|a| a.scaled_i64()))
        .collect::<Result<Vec<_>, _>>()?
        .into_iter())?;
    let original_unassigned_principal = sum(original_allocations
        .iter()
        .filter(|row| row.installment_id.is_none())
        .map(|row| amount(&row.principal).map(|value| value.scaled_i64()))
        .collect::<Result<Vec<_>, _>>()?
        .into_iter())?;
    if unassigned_principal > original_unassigned_principal
        && planned_principal > allocated_active_principal
    {
        return Err(invalid("LOAN_ALLOCATION_MISMATCH"));
    }
    Ok(allocations)
}

async fn post_charges_on(
    connection: &mut SqliteConnection,
    loan_id: &str,
    payment_id: &str,
    occurred: CalendarDate,
    charge: i64,
    now: &str,
) -> Result<(), AppError> {
    let loan = sqlx::query("SELECT name,direction,currency_code FROM loans WHERE id=?")
        .bind(loan_id)
        .fetch_one(&mut *connection)
        .await
        .map_err(db)?;
    let month = occurred.year_month();
    let currency = CurrencyCode::new(loan.get::<String, _>("currency_code"))
        .map_err(|e| AppError::from_domain(e, None))?;
    let linked: Option<String> = sqlx::query_scalar(
        "SELECT monthly_item_id FROM loan_monthly_items WHERE loan_id=? AND month=?",
    )
    .bind(loan_id)
    .bind(month.database_anchor())
    .fetch_optional(&mut *connection)
    .await
    .map_err(db)?;
    let monthly_id = if let Some(id) = &linked {
        parse_uuid(id, "id")?
    } else {
        let category = if loan.get::<String, _>("direction") == "BORROWED" {
            Category::FixedCommitmentExpense
        } else {
            Category::VariableIncome
        };
        let monthly = MonthlyItem::manual(
            Uuid::new_v4(),
            format!("{} · 借贷利息及费用", loan.get::<String, _>("name")),
            month,
            category,
            currency.clone(),
            Some("本金独立统计；请从借贷详情调整实际收付。".to_owned()),
        )
        .map_err(|e| AppError::from_domain(e, None))?;
        Store::insert_monthly_item_on(connection, &monthly, now)
            .await
            .map_err(AppError::from)?;
        monthly.id()
    };
    // Temporarily remove the insert guard inside this transaction, then restore it.
    sqlx::query("DELETE FROM loan_monthly_items WHERE monthly_item_id=?")
        .bind(monthly_id.to_string())
        .execute(&mut *connection)
        .await
        .map_err(db)?;
    let charge = Amount::from_scaled_i64(charge).map_err(|e| AppError::from_domain(e, None))?;
    let entry = ActualEntry::new(
        Uuid::new_v4(),
        monthly_id,
        month,
        occurred,
        ActualEntryEffect::Increase,
        charge,
        ActualEntryOrigin::User,
        Some("借贷利息及费用；本金不计入收支。".to_owned()),
    )
    .map_err(|e| AppError::from_domain(e, None))?;
    let snapshot = ActualEntryExchangeSnapshot {
        source_amount: charge,
        source_currency: currency.clone(),
        exchange_rate: ExchangeRate::new(currency.clone(), currency, Decimal::ONE)
            .map_err(|e| AppError::from_domain(e, None))?,
        source: "BASE_CURRENCY".to_owned(),
        observed_on: occurred,
        derivation: None,
    };
    Store::insert_actual_entry_on(connection, &entry, &snapshot, now)
        .await
        .map_err(AppError::from)?;
    sqlx::query("INSERT INTO loan_monthly_items (monthly_item_id,loan_id,month) VALUES (?,?,?)")
        .bind(monthly_id.to_string())
        .bind(loan_id)
        .bind(month.database_anchor())
        .execute(&mut *connection)
        .await
        .map_err(db)?;
    sqlx::query("INSERT INTO loan_actual_links (payment_id,actual_entry_id) VALUES (?,?)")
        .bind(payment_id)
        .bind(entry.id().to_string())
        .execute(&mut *connection)
        .await
        .map_err(db)?;
    Ok(())
}

#[tauri::command]
pub async fn create_loan(
    service: State<'_, FinanceService>,
    input: LoanInput,
) -> Result<LoanDto, AppError> {
    service.create_loan(input).await
}
#[tauri::command]
pub async fn list_loans(service: State<'_, FinanceService>) -> Result<Vec<LoanDto>, AppError> {
    service.list_loans().await
}
#[tauri::command]
pub async fn get_loan(
    service: State<'_, FinanceService>,
    id: String,
) -> Result<LoanDetailDto, AppError> {
    service.get_loan(id).await
}
#[tauri::command]
pub async fn update_loan_metadata(
    service: State<'_, FinanceService>,
    input: LoanMetadataInput,
) -> Result<(), AppError> {
    service.update_loan_metadata(input).await
}
#[tauri::command]
pub async fn preview_loan_schedule(
    service: State<'_, FinanceService>,
    input: LoanScheduleInput,
) -> Result<LoanSchedulePreview, AppError> {
    service.preview_loan_schedule(input).await
}
#[tauri::command]
pub async fn save_loan_schedule(
    service: State<'_, FinanceService>,
    input: LoanScheduleInput,
) -> Result<(), AppError> {
    service.save_loan_schedule(input).await
}
#[tauri::command]
pub async fn preview_loan_payment(
    service: State<'_, FinanceService>,
    input: LoanPaymentInput,
) -> Result<Vec<LoanAllocation>, AppError> {
    service.preview_loan_payment(input).await
}
#[tauri::command]
pub async fn save_loan_payment(
    service: State<'_, FinanceService>,
    input: LoanPaymentInput,
) -> Result<(), AppError> {
    service.save_loan_payment(input).await
}
#[tauri::command]
pub async fn delete_loan_payment(
    service: State<'_, FinanceService>,
    input: DeleteLoanActualInput,
) -> Result<(), AppError> {
    service.delete_loan_payment(input).await
}

#[tauri::command]
pub async fn save_loan_advance(
    service: State<'_, FinanceService>,
    input: LoanAdvanceInput,
) -> Result<(), AppError> {
    service.save_loan_advance(input).await
}

#[tauri::command]
pub async fn delete_loan_advance(
    service: State<'_, FinanceService>,
    input: DeleteLoanActualInput,
) -> Result<(), AppError> {
    service.delete_loan_advance(input).await
}
#[tauri::command]
pub async fn get_loan_month_summary(
    service: State<'_, FinanceService>,
    month: String,
) -> Result<LoanMonthSummary, AppError> {
    service.loan_month_summary(month).await
}
