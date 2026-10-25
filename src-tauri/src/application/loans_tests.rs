use pfcm_domain::{LoanFrequency, LoanScheduleRow};
use rust_decimal::Decimal;
use uuid::Uuid;

use super::{
    loans::*,
    service::{FinanceService, current_natural_date},
};
use crate::{
    application::dto::{ActualEntryInputDto, DeleteManualMonthlyItemInputDto, SettingsInputDto},
    infrastructure::open_memory_database,
};

async fn service() -> FinanceService {
    let service = FinanceService::new(open_memory_database().await.unwrap()).unwrap();
    service.ensure_default_settings().await.unwrap();
    service
}
fn creation(direction: &str, opening_only: bool) -> LoanInput {
    LoanInput {
        id: Uuid::new_v4().to_string(),
        name: "测试借贷".into(),
        counterparty: "对方".into(),
        direction: direction.into(),
        principal: "1000.00".into(),
        started_on: "2000-01-01".into(),
        opening_only,
        note: None,
    }
}
fn schedule(loan: &LoanDto, frequency: LoanFrequency) -> LoanScheduleInput {
    LoanScheduleInput {
        loan_id: loan.id.clone(),
        frequency,
        interval_count: 1,
        first_date: "2000-01-31".into(),
        count: 4,
        method: "EQUAL_PRINCIPAL".into(),
        period_rate_percent: "1".into(),
        note: None,
        rows: vec![],
    }
}
fn payment(loan: &LoanDto, principal: &str, interest: &str, fees: &str) -> LoanPaymentInput {
    LoanPaymentInput {
        id: Uuid::new_v4().to_string(),
        loan_id: loan.id.clone(),
        expected_updated_at: None,
        occurred_on: "2000-02-10".into(),
        principal: principal.into(),
        interest: interest.into(),
        fees: fees.into(),
        note: None,
        allocations: vec![],
    }
}

#[tokio::test]
async fn full_principal_payment_can_be_corrected_without_bypassing_the_database_limit() {
    let service = service().await;
    let loan = service
        .create_loan(creation("BORROWED", true))
        .await
        .unwrap();
    let mut input = payment(&loan, "1000", "0", "0");
    service.save_loan_payment(input.clone()).await.unwrap();
    let recorded = service
        .get_loan(loan.id.clone())
        .await
        .unwrap()
        .payments
        .remove(0);
    input.expected_updated_at = Some(recorded.updated_at);
    input.note = Some("修正备注".into());
    service.save_loan_payment(input).await.unwrap();
    assert_eq!(
        service
            .get_loan(loan.id)
            .await
            .unwrap()
            .loan
            .remaining_principal,
        "0.00"
    );
}

#[tokio::test]
async fn schema_seven_preserves_existing_schema_six_financial_rows() {
    let pool = sqlx::sqlite::SqlitePoolOptions::new()
        .max_connections(1)
        .connect("sqlite::memory:")
        .await
        .unwrap();
    sqlx::raw_sql("PRAGMA foreign_keys=ON;")
        .execute(&pool)
        .await
        .unwrap();
    for sql in [
        include_str!("../../migrations/0001_initial_release.sql"),
        include_str!("../../migrations/0002_remove_monthly_item_status.sql"),
        include_str!("../../migrations/0003_remove_next_month_goal.sql"),
        include_str!("../../migrations/0004_add_automatic_rate_refresh.sql"),
        include_str!("../../migrations/0005_add_software_update_preferences.sql"),
        include_str!("../../tests/fixtures/schema5_budget_specials.sql"),
        include_str!("../../migrations/0006_budget_specials.sql"),
    ] {
        sqlx::raw_sql(sql).execute(&pool).await.unwrap();
    }
    let before: Vec<(String, i64, i64, i64, String)> = sqlx::query_as("SELECT id,amount_scaled,source_amount_scaled,exchange_rate_scaled,note FROM actual_entries ORDER BY id").fetch_all(&pool).await.unwrap();
    let snapshots: Vec<(String, String, i64)> = sqlx::query_as(
        "SELECT id,snapshot_name,planned_amount_scaled FROM monthly_items ORDER BY id",
    )
    .fetch_all(&pool)
    .await
    .unwrap();
    sqlx::raw_sql(include_str!("../../migrations/0007_loans.sql"))
        .execute(&pool)
        .await
        .unwrap();
    let after: Vec<(String, i64, i64, i64, String)> = sqlx::query_as("SELECT id,amount_scaled,source_amount_scaled,exchange_rate_scaled,note FROM actual_entries ORDER BY id").fetch_all(&pool).await.unwrap();
    assert_eq!(before, after);
    assert_eq!(
        snapshots,
        sqlx::query_as::<_, (String, String, i64)>(
            "SELECT id,snapshot_name,planned_amount_scaled FROM monthly_items ORDER BY id"
        )
        .fetch_all(&pool)
        .await
        .unwrap()
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM loans")
            .fetch_one(&pool)
            .await
            .unwrap(),
        0
    );
    assert!(
        sqlx::query("PRAGMA foreign_key_check")
            .fetch_all(&pool)
            .await
            .unwrap()
            .is_empty()
    );
}

#[tokio::test]
async fn both_directions_and_all_four_periods_separate_principal_from_income_and_expense() {
    for direction in ["BORROWED", "LENT"] {
        for unit in [
            LoanFrequency::Day,
            LoanFrequency::Month,
            LoanFrequency::Quarter,
            LoanFrequency::Year,
        ] {
            let service = service().await;
            let loan = service
                .create_loan(creation(direction, false))
                .await
                .unwrap();
            let input = schedule(&loan, unit);
            let preview = service.preview_loan_schedule(input.clone()).await.unwrap();
            assert_eq!(preview.rows.len(), 4);
            assert_eq!(preview.principal_to_schedule, "1000.00");
            service.save_loan_schedule(input).await.unwrap();
            let actual = payment(&loan, "400.00", "10.00", "2.00");
            service.save_loan_payment(actual.clone()).await.unwrap();
            service.save_loan_payment(actual).await.unwrap(); // retry cannot post twice
            let detail = service.get_loan(loan.id.clone()).await.unwrap();
            assert_eq!(detail.loan.remaining_principal, "600.00");
            assert_eq!(detail.payments.len(), 1);
            assert_eq!(detail.payments[0].total, "412.00");
            assert!(detail.payments[0].allocations.len() >= 2); // crosses multiple installments
            let report = service.month_analytics("2000-02".into()).await.unwrap();
            if direction == "BORROWED" {
                assert_eq!(report.expense.actual_to_date.as_deref(), Some("12.00"));
                assert_eq!(report.income.actual_to_date, None);
            } else {
                assert_eq!(report.income.actual_to_date.as_deref(), Some("12.00"));
                assert_eq!(report.expense.actual_to_date, None);
            }
            let cash = service.loan_month_summary("2000-02".into()).await.unwrap();
            assert_eq!(
                cash.actual_cash_net.as_deref(),
                Some(if direction == "BORROWED" {
                    "-412.00"
                } else {
                    "412.00"
                })
            );
            let initial = service.loan_month_summary("2000-01".into()).await.unwrap();
            assert_eq!(
                initial.actual_cash_net.as_deref(),
                Some(if direction == "BORROWED" {
                    "1000.00"
                } else {
                    "-1000.00"
                })
            );
            assert_eq!(
                service.list_monthly_items("2000-02".into()).await.unwrap()[0]
                    .source_loan_id
                    .as_deref(),
                Some(loan.id.as_str())
            );
        }
    }
}

#[tokio::test]
async fn opening_balance_and_partial_repayments_keep_absence_and_cross_month_corrections_atomic() {
    let service = service().await;
    let loan = service
        .create_loan(creation("BORROWED", true))
        .await
        .unwrap();
    assert_eq!(
        service
            .loan_month_summary("2000-01".into())
            .await
            .unwrap()
            .actual_cash_net,
        None
    );
    service
        .save_loan_schedule(schedule(&loan, LoanFrequency::Month))
        .await
        .unwrap();
    let first = payment(&loan, "100.00", "5.00", "0.00");
    service.save_loan_payment(first.clone()).await.unwrap();
    let detail = service.get_loan(loan.id.clone()).await.unwrap();
    assert_eq!(detail.installments[0].paid_principal, "100.00");
    assert_eq!(detail.installments[0].paid_interest, "5.00");
    assert_eq!(detail.installments[0].remaining_total, "155.00");
    assert_eq!(detail.installments[0].state, "OVERDUE");
    let revision = detail.payments[0].updated_at.clone();
    let mut edit = first.clone();
    edit.expected_updated_at = Some(revision.clone());
    edit.occurred_on = "2000-03-10".into();
    edit.principal = "300.00".into();
    edit.interest = "15.00".into();
    let preview = service.preview_loan_payment(edit.clone()).await.unwrap();
    assert!(!preview.is_empty());
    assert_eq!(
        service
            .month_analytics("2000-02".into())
            .await
            .unwrap()
            .expense
            .actual_to_date
            .as_deref(),
        Some("5.00")
    );
    service.save_loan_payment(edit.clone()).await.unwrap();
    assert_eq!(
        service
            .month_analytics("2000-02".into())
            .await
            .unwrap()
            .expense
            .actual_to_date,
        None
    );
    assert_eq!(
        service
            .month_analytics("2000-03".into())
            .await
            .unwrap()
            .expense
            .actual_to_date
            .as_deref(),
        Some("15.00")
    );
    assert_eq!(
        service
            .get_loan(loan.id.clone())
            .await
            .unwrap()
            .loan
            .remaining_principal,
        "700.00"
    );
    assert_eq!(
        service
            .save_loan_payment(edit)
            .await
            .unwrap_err()
            .error_code,
        "LOAN_STALE_RECORD"
    );
    let updated = service.get_loan(loan.id.clone()).await.unwrap().payments[0].clone();
    service
        .delete_loan_payment(DeleteLoanPaymentInput {
            id: first.id,
            expected_updated_at: updated.updated_at,
        })
        .await
        .unwrap();
    assert_eq!(
        service
            .get_loan(loan.id)
            .await
            .unwrap()
            .loan
            .remaining_principal,
        "1000.00"
    );
    assert_eq!(
        service
            .month_analytics("2000-03".into())
            .await
            .unwrap()
            .expense
            .actual_to_date,
        None
    );
}

#[tokio::test]
async fn rejects_overpayments_wrong_contract_allocations_and_partial_linked_edits() {
    let service = service().await;
    let loan = service.create_loan(creation("LENT", true)).await.unwrap();
    let other = service.create_loan(creation("LENT", true)).await.unwrap();
    service
        .save_loan_schedule(schedule(&loan, LoanFrequency::Month))
        .await
        .unwrap();
    service
        .save_loan_schedule(schedule(&other, LoanFrequency::Month))
        .await
        .unwrap();
    assert_eq!(
        service
            .save_loan_payment(payment(&loan, "1000.01", "0", "0"))
            .await
            .unwrap_err()
            .error_code,
        "LOAN_PRINCIPAL_OVERPAYMENT"
    );
    let mut wrong = payment(&loan, "100", "0", "0");
    wrong.allocations = vec![LoanAllocation {
        installment_id: Some(
            service.get_loan(other.id).await.unwrap().installments[0]
                .id
                .clone(),
        ),
        principal: "100".into(),
        interest: "0".into(),
        fees: "0".into(),
    }];
    assert_eq!(
        service
            .save_loan_payment(wrong)
            .await
            .unwrap_err()
            .error_code,
        "LOAN_ALLOCATION_MISMATCH"
    );
    service
        .save_loan_payment(payment(&loan, "100", "10", "0"))
        .await
        .unwrap();
    let monthly = service
        .list_monthly_items("2000-02".into())
        .await
        .unwrap()
        .remove(0);
    let entry = service
        .list_actual_entries(monthly.id.clone())
        .await
        .unwrap()
        .remove(0);
    assert_eq!(
        service
            .delete_actual_entry(entry.id.clone())
            .await
            .unwrap_err()
            .error_code,
        "LOAN_MANAGED_ENTRY"
    );
    assert_eq!(
        service
            .delete_manual_monthly_item(DeleteManualMonthlyItemInputDto {
                id: monthly.id.clone()
            })
            .await
            .unwrap_err()
            .error_code,
        "LOAN_MANAGED_ENTRY"
    );
    let input = ActualEntryInputDto {
        id: None,
        monthly_item_id: monthly.id.clone(),
        occurred_on: "2000-02-11".into(),
        effect: "INCREASE".into(),
        amount: "1".into(),
        currency: "CNY".into(),
        exchange_rate: "1".into(),
        exchange_rate_source: "BASE_CURRENCY".into(),
        exchange_rate_observed_on: "2000-02-11".into(),
        note: None,
        detail_group: None,
    };
    assert_eq!(
        service
            .create_actual_entry(input)
            .await
            .unwrap_err()
            .error_code,
        "LOAN_MANAGED_ENTRY"
    );
    let store = service.test_store().await;
    assert!(
        sqlx::query("UPDATE actual_entries SET amount_scaled=1 WHERE id=?")
            .bind(&entry.id)
            .execute(store.pool())
            .await
            .is_err()
    );
    assert_eq!(
        service
            .get_loan(loan.id)
            .await
            .unwrap()
            .loan
            .remaining_principal,
        "900.00"
    );
}

#[tokio::test]
async fn plan_replacement_keeps_history_and_paid_facts_and_can_remove_unearned_future_interest() {
    let service = service().await;
    let loan = service
        .create_loan(creation("BORROWED", true))
        .await
        .unwrap();
    let mut initial = schedule(&loan, LoanFrequency::Month);
    initial.first_date = "2000-01-31".into();
    service
        .save_loan_schedule_at(initial, "2000-01-01".parse().unwrap())
        .await
        .unwrap();
    let mut actual = payment(&loan, "1000", "10", "0");
    actual.occurred_on = "2000-01-15".into();
    service.save_loan_payment(actual).await.unwrap();
    let mut replacement = schedule(&loan, LoanFrequency::Month);
    replacement.method = "MANUAL".into();
    replacement.rows = vec![];
    replacement.note = Some("提前结清，取消后续未发生利息".into());
    service
        .save_loan_schedule_at(replacement, "2000-01-20".parse().unwrap())
        .await
        .unwrap();
    let detail = service.get_loan(loan.id.clone()).await.unwrap();
    assert_eq!(detail.loan.status, "SETTLED");
    assert_eq!(detail.payments.len(), 1);
    assert_eq!(detail.installments.len(), 4);
    assert!(detail.installments.iter().all(|row| row.superseded));
    assert_eq!(detail.versions.len(), 2);
    assert_eq!(
        service
            .month_analytics("2000-01".into())
            .await
            .unwrap()
            .expense
            .actual_to_date
            .as_deref(),
        Some("10.00")
    );
    service
        .update_loan_metadata(LoanMetadataInput {
            id: loan.id.clone(),
            name: loan.name.clone(),
            counterparty: loan.counterparty.clone(),
            note: None,
            archived: true,
        })
        .await
        .unwrap();
}

#[tokio::test]
async fn daily_schedules_aggregate_due_dates_into_months_and_budget_includes_only_charges_as_expense()
 {
    let service = service().await;
    let loan = service
        .create_loan(creation("BORROWED", true))
        .await
        .unwrap();
    let next = current_natural_date()
        .unwrap()
        .year_month()
        .next_month()
        .unwrap();
    let mut input = schedule(&loan, LoanFrequency::Day);
    input.first_date = next.first_date().to_string();
    input.count = 4;
    service.save_loan_schedule(input).await.unwrap();
    let month = service.loan_month_summary(next.to_string()).await.unwrap();
    assert_eq!(month.planned_borrow_principal, "1000.00");
    assert_eq!(month.planned_borrow_charges, "25.00");
    let projection = service.budget_projection().await.unwrap();
    assert_eq!(projection.projected_expenses, "25.00");
    assert_eq!(projection.loan_principal_due, "1000.00");
    assert_eq!(projection.projected_cash_net, "-1025.00");
    assert_eq!(projection.projected_savings, "-25.00");
}

#[tokio::test]
async fn loan_only_cash_months_appear_in_history_and_currency_is_locked_even_with_no_monthly_items()
{
    let service = service().await;
    let loan = service.create_loan(creation("LENT", false)).await.unwrap();
    service
        .upsert_exchange_rate(super::dto::ExchangeRateUpsertDto {
            currency: "USD".into(),
            rate: "7.00".into(),
        })
        .await
        .unwrap();
    assert!(
        service
            .list_existing_months()
            .await
            .unwrap()
            .contains(&"2000-01".into())
    );
    let error = service
        .save_settings(SettingsInputDto {
            base_currency: "USD".into(),
            auto_update_exchange_rates: false,
        })
        .await
        .unwrap_err();
    assert_eq!(error.error_code, "BASE_CURRENCY_LOCKED");
    assert_eq!(
        service
            .get_loan(loan.id)
            .await
            .unwrap()
            .loan
            .remaining_principal,
        "1000.00"
    );
}

#[tokio::test]
async fn manual_plan_checks_principal_sum_and_preserves_past_unpaid_installments() {
    let service = service().await;
    let loan = service.create_loan(creation("LENT", true)).await.unwrap();
    service
        .save_loan_schedule_at(
            schedule(&loan, LoanFrequency::Month),
            "2000-01-01".parse().unwrap(),
        )
        .await
        .unwrap();
    let mut replacement = schedule(&loan, LoanFrequency::Quarter);
    replacement.first_date = "2000-04-30".into();
    replacement.count = 3;
    replacement.period_rate_percent = Decimal::ZERO.to_string();
    service
        .save_loan_schedule_at(replacement, "2000-02-01".parse().unwrap())
        .await
        .unwrap();
    let detail = service.get_loan(loan.id.clone()).await.unwrap();
    assert_eq!(
        detail.installments.iter().filter(|v| !v.superseded).count(),
        4
    );
    let preserved = detail
        .installments
        .iter()
        .find(|v| v.due_on == "2000-01-31")
        .unwrap();
    assert!(!preserved.superseded);
    let mut manual = schedule(&loan, LoanFrequency::Year);
    manual.method = "MANUAL".into();
    manual.rows = vec![LoanScheduleRow {
        due_on: "2001-01-01".parse().unwrap(),
        principal: "1".parse().unwrap(),
        interest: "0".parse().unwrap(),
        fees: "0".parse().unwrap(),
    }];
    assert_eq!(
        service
            .save_loan_schedule_at(manual, "2000-02-01".parse().unwrap())
            .await
            .unwrap_err()
            .error_code,
        "LOAN_SCHEDULE_PRINCIPAL_MISMATCH"
    );
}
