use pfcm_domain::{
    Amount, CalendarDate, Category, CurrencyCode, ExchangeRate, MonthlyItem, PlanItem,
    RecognitionMode, YearMonth,
};
use uuid::Uuid;

use crate::infrastructure::{Store, open_database, open_memory_database};

use super::{
    automatic::{AutomaticPolicyInputDto, ResolveAutomaticEntryConflictInputDto},
    dto::{
        ActualEntryInputDto, EnsureActualOnlyInputDto, InitializeMonthInputDto, SettingsInputDto,
    },
    service::FinanceService,
};

const FIXTURE_TIMESTAMP: &str = "2026-10-07T00:00:00Z";

fn date(value: &str) -> CalendarDate {
    value.parse().unwrap()
}
fn month(value: &str) -> YearMonth {
    value.parse().unwrap()
}
fn amount(value: &str) -> Amount {
    value.parse().unwrap()
}
fn currency(value: &str) -> CurrencyCode {
    CurrencyCode::new(value).unwrap()
}

async fn service_with_store(store: Store) -> FinanceService {
    let service = FinanceService::new(store).unwrap();
    service
        .save_settings(SettingsInputDto {
            base_currency: "CNY".to_owned(),
            auto_update_exchange_rates: false,
        })
        .await
        .unwrap();
    service
}

async fn service() -> FinanceService {
    service_with_store(open_memory_database().await.unwrap()).await
}

fn plan(
    name: &str,
    value: &str,
    code: &str,
    period: u32,
    mode: RecognitionMode,
    start: &str,
    end: Option<&str>,
) -> PlanItem {
    PlanItem::new(
        Uuid::new_v4(),
        name,
        Category::EssentialExpense,
        amount(value),
        currency(code),
        period,
        date(start),
        end.map(date),
        mode,
        Some("frozen rule note".to_owned()),
    )
    .unwrap()
}

async fn insert_plan(service: &FinanceService, plan: &PlanItem) {
    service
        .current_store()
        .await
        .insert_plan_item(plan, FIXTURE_TIMESTAMP)
        .await
        .unwrap();
}

async fn save_policy(
    service: &FinanceService,
    plan: &PlanItem,
    enabled: bool,
    first: Option<&str>,
    today: &str,
) -> super::automatic::AutomaticPolicyDto {
    let _operation = service.operation_gate.write().await;
    service
        .save_automatic_entry_policy_at_unlocked(
            AutomaticPolicyInputDto {
                plan_item_id: plan.id().to_string(),
                enabled,
                first_date: first.map(str::to_owned),
            },
            date(today),
        )
        .await
        .unwrap()
}

async fn set_rate(service: &FinanceService, code: &str, value: &str, observed_on: Option<&str>) {
    service
        .current_store()
        .await
        .upsert_exchange_rate(
            &ExchangeRate::from_str(currency(code), currency("CNY"), value).unwrap(),
            "MANUAL",
            observed_on.map(date),
            FIXTURE_TIMESTAMP,
        )
        .await
        .unwrap();
}

async fn count(service: &FinanceService, query: &'static str) -> i64 {
    sqlx::query_scalar(query)
        .fetch_one(service.current_store().await.pool())
        .await
        .unwrap()
}

fn actual_input(container: &str, occurred_on: &str, value: &str) -> ActualEntryInputDto {
    ActualEntryInputDto {
        id: None,
        monthly_item_id: container.to_owned(),
        occurred_on: occurred_on.to_owned(),
        effect: "INCREASE".to_owned(),
        amount: value.to_owned(),
        currency: "CNY".to_owned(),
        exchange_rate: "1".to_owned(),
        exchange_rate_source: "BASE_CURRENCY".to_owned(),
        exchange_rate_observed_on: occurred_on.to_owned(),
        note: Some("manual note".to_owned()),
        detail_group: None,
    }
}

async fn manual_entry(
    service: &FinanceService,
    plan: &PlanItem,
    occurred_on: &str,
) -> super::dto::ActualEntryDto {
    let container = service
        .ensure_actual_only(EnsureActualOnlyInputDto {
            plan_item_id: plan.id().to_string(),
            month: date(occurred_on).year_month().to_string(),
        })
        .await
        .unwrap();
    service
        .create_actual_entry(actual_input(&container.id, occurred_on, "37.00"))
        .await
        .unwrap()
}

async fn resolve(
    service: &FinanceService,
    id: &str,
    action: &str,
    actual_id: Option<&str>,
    today: &str,
) -> super::automatic::AutomaticOccurrenceDto {
    let _operation = service.operation_gate.write().await;
    service
        .resolve_automatic_entry_conflict_at_unlocked(
            ResolveAutomaticEntryConflictInputDto {
                id: id.to_owned(),
                action: action.to_owned(),
                actual_entry_id: actual_id.map(str::to_owned),
            },
            date(today),
        )
        .await
        .unwrap()
}

#[tokio::test]
async fn default_off_enable_next_month_and_repeat_check_are_safe() {
    let service = service().await;
    let rule = plan(
        "Rent",
        "1800.00",
        "CNY",
        1,
        RecognitionMode::Amortized,
        "2026-01-01",
        None,
    );
    insert_plan(&service, &rule).await;
    let off = service.list_automatic_entry_policies().await.unwrap();
    assert_eq!(off.len(), 1);
    assert!(!off[0].enabled);
    assert_eq!(off[0].effective_month, None);
    assert_eq!(
        service
            .check_automatic_entries_at(date("2026-10-31"))
            .await
            .unwrap()
            .created_count,
        0
    );
    let saved = save_policy(&service, &rule, true, None, "2026-10-07").await;
    assert_eq!(saved.effective_month.as_deref(), Some("2026-11"));
    assert_eq!(saved.first_date.as_deref(), Some("2026-11-01"));
    assert_eq!(saved.amount.as_deref(), Some("1800.00"));
    assert_eq!(
        service
            .check_automatic_entries_at(date("2026-10-31"))
            .await
            .unwrap()
            .created_count,
        0
    );
    let posted = service
        .check_automatic_entries_at(date("2026-11-01"))
        .await
        .unwrap();
    assert_eq!(posted.created_count, 1);
    let occurrence = &posted.occurrences[0];
    assert_eq!(occurrence.state, "POSTED");
    assert_eq!(occurrence.occurred_on, "2026-11-01");
    let entries = service
        .list_actual_entries(occurrence.monthly_item_id.clone().unwrap())
        .await
        .unwrap();
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0].origin, "AUTOMATIC");
    assert_eq!(entries[0].amount, "1800.00");
    assert_eq!(entries[0].note.as_deref(), Some("frozen rule note"));
    assert_eq!(
        service
            .check_automatic_entries_at(date("2026-11-30"))
            .await
            .unwrap()
            .created_count,
        0
    );
    assert_eq!(
        count(&service, "SELECT COUNT(*) FROM actual_entries").await,
        1
    );
    assert_eq!(
        count(&service, "SELECT COUNT(*) FROM automatic_occurrences").await,
        1
    );
}

#[tokio::test]
async fn full_cash_period_is_distinct_from_amortized_monthly_plan() {
    let service = service().await;
    let rule = plan(
        "Quarterly fee",
        "300.00",
        "CNY",
        3,
        RecognitionMode::Amortized,
        "2026-10-31",
        None,
    );
    insert_plan(&service, &rule).await;
    let error = service
        .save_automatic_entry_policy_at_unlocked(
            AutomaticPolicyInputDto {
                plan_item_id: rule.id().to_string(),
                enabled: true,
                first_date: None,
            },
            date("2026-10-07"),
        )
        .await
        .unwrap_err();
    assert_eq!(error.error_code, "AUTOMATIC_FIRST_DATE_REQUIRED");
    assert_eq!(
        count(&service, "SELECT COUNT(*) FROM automatic_entry_policies").await,
        0
    );
    save_policy(&service, &rule, true, Some("2026-10-31"), "2026-10-07").await;
    assert_eq!(
        service
            .check_automatic_entries_at(date("2026-11-30"))
            .await
            .unwrap()
            .created_count,
        0
    );
    assert_eq!(
        service
            .check_automatic_entries_at(date("2026-12-31"))
            .await
            .unwrap()
            .created_count,
        0
    );
    let planned = MonthlyItem::snapshot(
        Uuid::new_v4(),
        &rule,
        month("2027-01"),
        None,
        amount("100.00"),
        currency("CNY"),
    );
    service
        .current_store()
        .await
        .insert_monthly_item(&planned, FIXTURE_TIMESTAMP)
        .await
        .unwrap();
    assert_eq!(
        service
            .check_automatic_entries_at(date("2027-01-30"))
            .await
            .unwrap()
            .created_count,
        0
    );
    let posted = service
        .check_automatic_entries_at(date("2027-01-31"))
        .await
        .unwrap();
    assert_eq!(posted.created_count, 1);
    assert_eq!(
        posted.occurrences[0].monthly_item_id.as_deref(),
        Some(planned.id().to_string().as_str())
    );
    let monthly = service
        .list_monthly_items("2027-01".to_owned())
        .await
        .unwrap();
    assert_eq!(monthly[0].planned_amount, "100.00");
    assert_eq!(monthly[0].actual_amount.as_deref(), Some("300.00"));
    assert_eq!(
        count(
            &service,
            "SELECT COUNT(*) FROM automatic_occurrences WHERE month < '2027-01-01'"
        )
        .await,
        0
    );
}

#[tokio::test]
async fn payment_cash_date_clamps_at_month_end_and_leap_day() {
    let service = service().await;
    let rule = plan(
        "Monthly payment",
        "90.00",
        "CNY",
        1,
        RecognitionMode::Payment,
        "2027-01-31",
        None,
    );
    insert_plan(&service, &rule).await;
    let policy = save_policy(&service, &rule, true, None, "2026-12-07").await;
    assert_eq!(policy.first_date.as_deref(), Some("2027-01-31"));
    assert_eq!(
        service
            .check_automatic_entries_at(date("2027-01-30"))
            .await
            .unwrap()
            .created_count,
        0
    );
    assert_eq!(
        service
            .check_automatic_entries_at(date("2027-01-31"))
            .await
            .unwrap()
            .created_count,
        1
    );
    assert_eq!(
        service
            .check_automatic_entries_at(date("2027-02-27"))
            .await
            .unwrap()
            .created_count,
        0
    );
    let february = service
        .check_automatic_entries_at(date("2027-02-28"))
        .await
        .unwrap();
    assert_eq!(february.created_count, 1);
    assert_eq!(february.occurrences[0].occurred_on, "2027-02-28");
    assert_eq!(
        service
            .check_automatic_entries_at(date("2028-02-28"))
            .await
            .unwrap()
            .created_count,
        0
    );
    let leap = service
        .check_automatic_entries_at(date("2028-02-29"))
        .await
        .unwrap();
    assert_eq!(leap.created_count, 1);
    assert_eq!(leap.occurrences[0].occurred_on, "2028-02-29");
    // A long closed-app gap generates only this current month, not every past cash event.
    assert_eq!(
        count(&service, "SELECT COUNT(*) FROM actual_entries").await,
        3
    );
}

#[tokio::test]
async fn independent_service_checks_share_atomic_database_idempotency() {
    let fixture = tempfile::tempdir().unwrap();
    let store = open_database(&fixture.path().join("automatic-concurrency.sqlite3"))
        .await
        .unwrap();
    let first = service_with_store(store.clone()).await;
    let second = FinanceService::new(store.clone()).unwrap();
    let rule = plan(
        "Concurrent salary",
        "5000.00",
        "CNY",
        1,
        RecognitionMode::Amortized,
        "2026-01-01",
        None,
    );
    insert_plan(&first, &rule).await;
    save_policy(&first, &rule, true, None, "2026-10-07").await;
    let (a, b) = tokio::join!(
        first.check_automatic_entries_at(date("2026-11-01")),
        second.check_automatic_entries_at(date("2026-11-01"))
    );
    assert_eq!(a.unwrap().created_count + b.unwrap().created_count, 1);
    assert_eq!(
        count(&first, "SELECT COUNT(*) FROM actual_entries").await,
        1
    );
    assert_eq!(count(&first, "SELECT COUNT(*) FROM monthly_items").await, 1);
    assert_eq!(
        count(&first, "SELECT COUNT(*) FROM automatic_occurrences").await,
        1
    );
    store.close().await;
}

#[tokio::test]
async fn occurrence_failure_rolls_back_container_and_actual_together() {
    let service = service().await;
    let rule = plan(
        "Atomic fee",
        "80.00",
        "CNY",
        1,
        RecognitionMode::Amortized,
        "2026-01-01",
        None,
    );
    insert_plan(&service, &rule).await;
    save_policy(&service, &rule, true, None, "2026-10-07").await;
    sqlx::query("CREATE TRIGGER fixture_reject_occurrence BEFORE INSERT ON automatic_occurrences BEGIN SELECT RAISE(ABORT, 'fixture failure'); END")
        .execute(service.current_store().await.pool()).await.unwrap();
    assert!(
        service
            .check_automatic_entries_at(date("2026-11-01"))
            .await
            .is_err()
    );
    assert_eq!(
        count(&service, "SELECT COUNT(*) FROM actual_entries").await,
        0
    );
    assert_eq!(
        count(&service, "SELECT COUNT(*) FROM monthly_items").await,
        0
    );
    sqlx::query("DROP TRIGGER fixture_reject_occurrence")
        .execute(service.current_store().await.pool())
        .await
        .unwrap();
    assert_eq!(
        service
            .check_automatic_entries_at(date("2026-11-01"))
            .await
            .unwrap()
            .created_count,
        1
    );
}

#[tokio::test]
async fn disabling_is_immediate_and_reenabling_waits_until_next_month() {
    let service = service().await;
    let rule = plan(
        "Late monthly fee",
        "50.00",
        "CNY",
        1,
        RecognitionMode::Amortized,
        "2026-01-01",
        None,
    );
    insert_plan(&service, &rule).await;
    save_policy(&service, &rule, true, Some("2026-11-25"), "2026-10-07").await;
    save_policy(&service, &rule, false, None, "2026-11-10").await;
    assert_eq!(
        service
            .check_automatic_entries_at(date("2026-11-25"))
            .await
            .unwrap()
            .created_count,
        0
    );
    save_policy(&service, &rule, true, None, "2026-11-26").await;
    assert_eq!(
        service
            .check_automatic_entries_at(date("2026-11-30"))
            .await
            .unwrap()
            .created_count,
        0
    );
    assert_eq!(
        service
            .check_automatic_entries_at(date("2026-12-24"))
            .await
            .unwrap()
            .created_count,
        0
    );
    assert_eq!(
        service
            .check_automatic_entries_at(date("2026-12-25"))
            .await
            .unwrap()
            .created_count,
        1
    );
    save_policy(&service, &rule, false, None, "2026-12-26").await;
    assert_eq!(
        service
            .check_automatic_entries_at(date("2027-01-25"))
            .await
            .unwrap()
            .created_count,
        0
    );
    assert_eq!(
        count(&service, "SELECT COUNT(*) FROM actual_entries").await,
        1
    );
}

#[tokio::test]
async fn rule_edits_freeze_current_version_and_replace_only_future_version() {
    let service = service().await;
    let rule = plan(
        "Versioned fee",
        "100.00",
        "CNY",
        1,
        RecognitionMode::Amortized,
        "2026-01-01",
        None,
    );
    insert_plan(&service, &rule).await;
    save_policy(&service, &rule, true, Some("2026-11-25"), "2026-10-07").await;
    let revised = PlanItem::new(
        rule.id(),
        "Revised name",
        rule.category(),
        amount("200.00"),
        currency("CNY"),
        1,
        rule.start_date(),
        None,
        rule.recognition_mode(),
        Some("revised note".to_owned()),
    )
    .unwrap();
    service
        .current_store()
        .await
        .update_plan_item(&revised, FIXTURE_TIMESTAMP)
        .await
        .unwrap();
    service
        .refresh_automatic_policy_version_at_unlocked(rule.id(), date("2026-11-10"))
        .await
        .unwrap();
    let november = service
        .check_automatic_entries_at(date("2026-11-25"))
        .await
        .unwrap();
    assert_eq!(
        november.occurrences[0].rule_name.as_deref(),
        Some("Versioned fee")
    );
    let entry = service
        .list_actual_entries(november.occurrences[0].monthly_item_id.clone().unwrap())
        .await
        .unwrap();
    assert_eq!(entry[0].source_amount, "100.00");
    assert_eq!(entry[0].note.as_deref(), Some("frozen rule note"));
    save_policy(&service, &revised, true, Some("2026-12-15"), "2026-11-27").await;
    assert_eq!(
        service
            .check_automatic_entries_at(date("2026-12-14"))
            .await
            .unwrap()
            .created_count,
        0
    );
    let december = service
        .check_automatic_entries_at(date("2026-12-15"))
        .await
        .unwrap();
    assert_eq!(
        december.occurrences[0].rule_name.as_deref(),
        Some("Revised name")
    );
    let entry = service
        .list_actual_entries(december.occurrences[0].monthly_item_id.clone().unwrap())
        .await
        .unwrap();
    assert_eq!(entry[0].source_amount, "200.00");
    assert_eq!(
        count(&service, "SELECT COUNT(*) FROM automatic_policy_versions").await,
        2
    );
}

#[tokio::test]
async fn missing_rate_observation_retries_then_auto_edits_keep_frozen_exchange_metadata() {
    let service = service().await;
    set_rate(&service, "USD", "7.10", None).await;
    let rule = plan(
        "Foreign subscription",
        "12.00",
        "USD",
        1,
        RecognitionMode::Amortized,
        "2026-01-01",
        None,
    );
    insert_plan(&service, &rule).await;
    save_policy(&service, &rule, true, None, "2026-10-07").await;
    let failed = service
        .check_automatic_entries_at(date("2026-11-01"))
        .await
        .unwrap();
    assert_eq!(failed.failed_count, 1);
    assert_eq!(
        failed.occurrences[0].error_code.as_deref(),
        Some("AUTOMATIC_EXCHANGE_RATE_DATE_REQUIRED")
    );
    assert_eq!(
        count(&service, "SELECT COUNT(*) FROM actual_entries").await,
        0
    );
    assert_eq!(
        count(&service, "SELECT COUNT(*) FROM monthly_items").await,
        0
    );
    set_rate(&service, "USD", "7.10", Some("2026-11-04")).await;
    let posted = service
        .check_automatic_entries_at(date("2026-11-05"))
        .await
        .unwrap();
    assert_eq!(posted.created_count, 1);
    assert_eq!(posted.failed_count, 0);
    assert_eq!(posted.occurrences[0].id, failed.occurrences[0].id);
    assert_eq!(posted.occurrences[0].occurred_on, "2026-11-01");
    let container = posted.occurrences[0].monthly_item_id.clone().unwrap();
    let entry = service
        .list_actual_entries(container.clone())
        .await
        .unwrap()
        .remove(0);
    assert_eq!(entry.amount, "85.20");
    assert_eq!(entry.source_amount, "12.00");
    assert_eq!(entry.exchange_rate, "7.10000000");
    assert_eq!(entry.exchange_rate_observed_on, "2026-11-04");
    set_rate(&service, "USD", "8.00", Some("2026-11-10")).await;
    let edited = service
        .update_actual_entry(ActualEntryInputDto {
            id: Some(entry.id.clone()),
            monthly_item_id: container,
            occurred_on: "2026-11-02".to_owned(),
            effect: "INCREASE".to_owned(),
            amount: "13.00".to_owned(),
            currency: "EUR".to_owned(),
            exchange_rate: "9".to_owned(),
            exchange_rate_source: "ECB_REFERENCE".to_owned(),
            exchange_rate_observed_on: "2026-11-12".to_owned(),
            note: Some("adjusted by user".to_owned()),
            detail_group: Some("membership".to_owned()),
        })
        .await
        .unwrap();
    assert_eq!(edited.origin, "AUTOMATIC");
    assert_eq!(edited.source_currency, "USD");
    assert_eq!(edited.exchange_rate, entry.exchange_rate);
    assert_eq!(edited.exchange_rate_source, entry.exchange_rate_source);
    assert_eq!(
        edited.exchange_rate_observed_on,
        entry.exchange_rate_observed_on
    );
    assert_eq!(edited.amount, "92.30");
    assert_eq!(edited.detail_group.as_deref(), Some("membership"));
    assert_eq!(
        service
            .check_automatic_entries_at(date("2026-11-15"))
            .await
            .unwrap()
            .created_count,
        0
    );
    service.delete_actual_entry(entry.id).await.unwrap();
    let restart = FinanceService::new(service.current_store().await).unwrap();
    let checked = restart
        .check_automatic_entries_at(date("2026-11-30"))
        .await
        .unwrap();
    assert_eq!(checked.created_count, 0);
    assert_eq!(checked.occurrences[0].state, "DELETED");
    assert_eq!(checked.occurrences[0].actual_entry_id, None);
    assert_eq!(
        count(&service, "SELECT COUNT(*) FROM actual_entries").await,
        0
    );
}

#[tokio::test]
async fn manual_conflicts_require_explicit_link_skip_or_separate_creation() {
    let service = service().await;
    for (index, action) in ["LINK_EXISTING", "SKIP", "CREATE_SEPARATE"]
        .into_iter()
        .enumerate()
    {
        let rule = plan(
            &format!("Conflict {index}"),
            "99.00",
            "CNY",
            1,
            RecognitionMode::Amortized,
            "2026-01-01",
            None,
        );
        insert_plan(&service, &rule).await;
        save_policy(&service, &rule, true, None, "2026-10-07").await;
        let manual = manual_entry(&service, &rule, "2026-11-01").await;
        let check = service
            .check_automatic_entries_at(date("2026-11-02"))
            .await
            .unwrap();
        let occurrence = check
            .occurrences
            .iter()
            .find(|entry| entry.rule_key == rule.id().to_string())
            .unwrap();
        assert_eq!(occurrence.state, "CONFLICT");
        assert_eq!(check.created_count, 0);
        let actual_id = (action == "LINK_EXISTING").then_some(manual.id.as_str());
        let resolved = resolve(&service, &occurrence.id, action, actual_id, "2026-11-03").await;
        assert_eq!(
            resolved.state,
            if action == "SKIP" {
                "SKIPPED"
            } else {
                "POSTED"
            }
        );
        let repeated = resolve(&service, &occurrence.id, action, actual_id, "2026-11-03").await;
        assert_eq!(resolved, repeated);
        let entries = service
            .list_actual_entries(manual.monthly_item_id.clone())
            .await
            .unwrap();
        assert_eq!(
            entries.len(),
            if action == "CREATE_SEPARATE" { 2 } else { 1 }
        );
        assert_eq!(
            entries
                .iter()
                .find(|entry| entry.id == manual.id)
                .unwrap()
                .origin,
            "USER"
        );
        if action == "LINK_EXISTING" {
            assert_eq!(
                resolved.actual_entry_id.as_deref(),
                Some(manual.id.as_str())
            );
            // Deleting an explicitly linked user entry also consumes the automatic token.
            service
                .delete_actual_entry(manual.id.clone())
                .await
                .unwrap();
            let checked = service
                .check_automatic_entries_at(date("2026-11-30"))
                .await
                .unwrap();
            assert_eq!(
                checked
                    .occurrences
                    .iter()
                    .find(|entry| entry.id == occurrence.id)
                    .unwrap()
                    .state,
                "DELETED"
            );
        }
        assert_eq!(
            service
                .check_automatic_entries_at(date("2026-11-30"))
                .await
                .unwrap()
                .created_count,
            0
        );
    }
}

#[tokio::test]
async fn linking_to_other_container_is_rejected_without_resolving_conflict() {
    let service = service().await;
    let rule = plan(
        "First source",
        "100.00",
        "CNY",
        1,
        RecognitionMode::Amortized,
        "2026-01-01",
        None,
    );
    let other = plan(
        "Other source",
        "100.00",
        "CNY",
        1,
        RecognitionMode::Amortized,
        "2026-01-01",
        None,
    );
    insert_plan(&service, &rule).await;
    insert_plan(&service, &other).await;
    save_policy(&service, &rule, true, None, "2026-10-07").await;
    manual_entry(&service, &rule, "2026-11-01").await;
    let unrelated = manual_entry(&service, &other, "2026-11-01").await;
    let checked = service
        .check_automatic_entries_at(date("2026-11-01"))
        .await
        .unwrap();
    let error = service
        .resolve_automatic_entry_conflict_at_unlocked(
            ResolveAutomaticEntryConflictInputDto {
                id: checked.occurrences[0].id.clone(),
                action: "LINK_EXISTING".to_owned(),
                actual_entry_id: Some(unrelated.id),
            },
            date("2026-11-02"),
        )
        .await
        .unwrap_err();
    assert_eq!(error.error_code, "AUTOMATIC_LINK_ENTRY_MISMATCH");
    assert_eq!(
        service
            .check_automatic_entries_at(date("2026-11-02"))
            .await
            .unwrap()
            .conflict_count,
        1
    );
}

#[tokio::test]
async fn source_deletion_keeps_audit_and_prevents_new_events() {
    let service = service().await;
    let rule = plan(
        "Removed source",
        "60.00",
        "CNY",
        1,
        RecognitionMode::Amortized,
        "2026-01-01",
        None,
    );
    insert_plan(&service, &rule).await;
    save_policy(&service, &rule, true, None, "2026-10-07").await;
    let posted = service
        .check_automatic_entries_at(date("2026-11-01"))
        .await
        .unwrap();
    service
        .delete_plan_item(rule.id().to_string())
        .await
        .unwrap();
    let history = service
        .list_automatic_occurrences(Some("2026-11".to_owned()))
        .await
        .unwrap();
    assert_eq!(history[0], posted.occurrences[0]);
    assert_eq!(
        count(
            &service,
            "SELECT COUNT(*) FROM automatic_policy_versions WHERE plan_item_id IS NULL"
        )
        .await,
        1
    );
    assert_eq!(
        count(&service, "SELECT COUNT(*) FROM automatic_entry_policies").await,
        0
    );
    assert_eq!(
        service
            .check_automatic_entries_at(date("2026-12-01"))
            .await
            .unwrap()
            .created_count,
        0
    );
    assert_eq!(
        count(&service, "SELECT COUNT(*) FROM actual_entries").await,
        1
    );
}

#[tokio::test]
async fn zero_amount_is_skipped_and_rule_end_cuts_off_future_due_date() {
    let service = service().await;
    let zero = plan(
        "Zero",
        "0.00",
        "CNY",
        1,
        RecognitionMode::Amortized,
        "2026-01-01",
        None,
    );
    let ending = plan(
        "Ending",
        "40.00",
        "CNY",
        1,
        RecognitionMode::Payment,
        "2026-01-25",
        Some("2026-11-20"),
    );
    insert_plan(&service, &zero).await;
    insert_plan(&service, &ending).await;
    save_policy(&service, &zero, true, None, "2026-10-07").await;
    save_policy(&service, &ending, true, None, "2026-10-07").await;
    let checked = service
        .check_automatic_entries_at(date("2026-11-30"))
        .await
        .unwrap();
    assert_eq!(checked.created_count, 0);
    assert_eq!(checked.occurrences.len(), 1);
    assert_eq!(checked.occurrences[0].state, "SKIPPED");
    assert_eq!(checked.occurrences[0].rule_key, zero.id().to_string());
    assert_eq!(
        count(&service, "SELECT COUNT(*) FROM actual_entries").await,
        0
    );
}

#[tokio::test]
async fn invalid_cash_dates_do_not_leave_enabled_policy_or_version() {
    let service = service().await;
    let rule = plan(
        "Bounded",
        "120.00",
        "CNY",
        3,
        RecognitionMode::Amortized,
        "2026-10-10",
        Some("2027-01-31"),
    );
    insert_plan(&service, &rule).await;
    for (first, expected) in [
        ("2026-10-09", "AUTOMATIC_FIRST_DATE_OUTSIDE_RULE"),
        ("2027-02-01", "AUTOMATIC_FIRST_DATE_OUTSIDE_RULE"),
        ("2026-11-31", "INVALID_DATE"),
        ("2026-é1-01", "INVALID_DATE"),
    ] {
        let error = service
            .save_automatic_entry_policy_at_unlocked(
                AutomaticPolicyInputDto {
                    plan_item_id: rule.id().to_string(),
                    enabled: true,
                    first_date: Some(first.to_owned()),
                },
                date("2026-10-07"),
            )
            .await
            .unwrap_err();
        assert_eq!(error.error_code, expected);
    }
    assert_eq!(
        count(&service, "SELECT COUNT(*) FROM automatic_entry_policies").await,
        0
    );
    assert_eq!(
        count(&service, "SELECT COUNT(*) FROM automatic_policy_versions").await,
        0
    );
}

#[tokio::test]
async fn auto_actual_only_container_promotes_without_losing_its_id_or_cash_entry() {
    let service = service().await;
    let rule = plan(
        "Promoted cash fee",
        "300.00",
        "CNY",
        3,
        RecognitionMode::Amortized,
        "2026-11-01",
        None,
    );
    insert_plan(&service, &rule).await;
    save_policy(&service, &rule, true, Some("2026-11-01"), "2026-10-07").await;
    let checked = service
        .check_automatic_entries_at(date("2026-11-01"))
        .await
        .unwrap();
    let container_id = checked.occurrences[0].monthly_item_id.clone().unwrap();
    let before = service
        .list_monthly_items("2026-11".to_owned())
        .await
        .unwrap();
    assert_eq!(before[0].item_source, "ACTUAL_ONLY");
    assert_eq!(before[0].planned_amount, "0.00");
    service
        .initialize_month(InitializeMonthInputDto {
            month: "2026-11".to_owned(),
            confirmed: true,
            rate_overrides: Vec::new(),
        })
        .await
        .unwrap();
    let after = service
        .list_monthly_items("2026-11".to_owned())
        .await
        .unwrap();
    assert_eq!(after.len(), 1);
    assert_eq!(after[0].id, container_id);
    assert_eq!(after[0].item_source, "PLANNED");
    assert_eq!(after[0].planned_amount, "100.00");
    assert_eq!(after[0].actual_amount.as_deref(), Some("300.00"));
    assert_eq!(after[0].actual_entry_count, 1);
    assert_eq!(
        service
            .check_automatic_entries_at(date("2026-11-30"))
            .await
            .unwrap()
            .created_count,
        0
    );
}

#[tokio::test]
async fn monthly_category_mismatch_preserves_frozen_plan_and_requires_resolution() {
    let service = service().await;
    let rule = plan(
        "Old category",
        "100.00",
        "CNY",
        1,
        RecognitionMode::Amortized,
        "2026-01-01",
        None,
    );
    insert_plan(&service, &rule).await;
    save_policy(&service, &rule, true, None, "2026-10-07").await;
    let revised = PlanItem::new(
        rule.id(),
        "Changed category",
        Category::FixedIncome,
        amount("250.00"),
        currency("CNY"),
        1,
        rule.start_date(),
        None,
        RecognitionMode::Amortized,
        None,
    )
    .unwrap();
    let frozen_monthly = MonthlyItem::snapshot(
        Uuid::new_v4(),
        &revised,
        month("2026-11"),
        None,
        amount("250.00"),
        currency("CNY"),
    );
    service
        .current_store()
        .await
        .insert_monthly_item(&frozen_monthly, FIXTURE_TIMESTAMP)
        .await
        .unwrap();
    let checked = service
        .check_automatic_entries_at(date("2026-11-01"))
        .await
        .unwrap();
    assert_eq!(checked.created_count, 0);
    assert_eq!(checked.conflict_count, 1);
    assert_eq!(
        checked.occurrences[0].error_code.as_deref(),
        Some("AUTOMATIC_RULE_SNAPSHOT_MISMATCH")
    );
    let after = service
        .list_monthly_items("2026-11".to_owned())
        .await
        .unwrap();
    assert_eq!(after[0].planned_amount, "250.00");
    assert_eq!(after[0].category, "FIXED_INCOME");
    assert_eq!(after[0].actual_entry_count, 0);
    let rejected = service
        .resolve_automatic_entry_conflict_at_unlocked(
            ResolveAutomaticEntryConflictInputDto {
                id: checked.occurrences[0].id.clone(),
                action: "CREATE_SEPARATE".to_owned(),
                actual_entry_id: None,
            },
            date("2026-11-02"),
        )
        .await
        .unwrap_err();
    assert_eq!(rejected.error_code, "AUTOMATIC_RULE_SNAPSHOT_MISMATCH");
    assert_eq!(
        count(&service, "SELECT COUNT(*) FROM actual_entries").await,
        0
    );
    assert_eq!(
        service
            .list_automatic_occurrences(Some("2026-11".to_owned()))
            .await
            .unwrap()[0]
            .state,
        "CONFLICT"
    );
    resolve(
        &service,
        &checked.occurrences[0].id,
        "SKIP",
        None,
        "2026-11-02",
    )
    .await;
    assert_eq!(
        service
            .check_automatic_entries_at(date("2026-11-30"))
            .await
            .unwrap()
            .created_count,
        0
    );
}

#[tokio::test]
async fn automatic_income_is_recorded_as_increase_under_income_category() {
    let service = service().await;
    let salary = PlanItem::new(
        Uuid::new_v4(),
        "Monthly salary",
        Category::FixedIncome,
        amount("8000.00"),
        currency("CNY"),
        1,
        date("2026-01-01"),
        None,
        RecognitionMode::Amortized,
        None,
    )
    .unwrap();
    insert_plan(&service, &salary).await;
    save_policy(&service, &salary, true, Some("2026-11-15"), "2026-10-07").await;
    let checked = service
        .check_automatic_entries_at(date("2026-11-15"))
        .await
        .unwrap();
    assert_eq!(checked.created_count, 1);
    let monthly = service
        .list_monthly_items("2026-11".to_owned())
        .await
        .unwrap();
    assert_eq!(monthly[0].category, "FIXED_INCOME");
    assert_eq!(monthly[0].flow_type, "INCOME");
    assert_eq!(monthly[0].actual_amount.as_deref(), Some("8000.00"));
    let actual = service
        .list_actual_entries(monthly[0].id.clone())
        .await
        .unwrap();
    assert_eq!(actual[0].effect, "INCREASE");
    assert_eq!(actual[0].origin, "AUTOMATIC");
}

#[tokio::test]
async fn running_month_rollover_initializes_budget_before_posting_automatic_actual() {
    let service = service().await;
    let rule = plan(
        "Running app rent",
        "1800.00",
        "CNY",
        1,
        RecognitionMode::Amortized,
        "2026-01-01",
        None,
    );
    insert_plan(&service, &rule).await;
    save_policy(&service, &rule, true, None, "2026-10-07").await;
    let operation = service.operation_gate.write().await;
    service
        .ensure_current_month_context_at_unlocked(date("2026-10-31"))
        .await
        .unwrap();
    service
        .check_automatic_entries_at_unlocked(date("2026-10-31"))
        .await
        .unwrap();
    service
        .ensure_current_month_context_at_unlocked(date("2026-11-01"))
        .await
        .unwrap();
    let checked = service
        .check_automatic_entries_at_unlocked(date("2026-11-01"))
        .await
        .unwrap();
    assert_eq!(checked.created_count, 1);
    service
        .ensure_current_month_context_at_unlocked(date("2026-11-01"))
        .await
        .unwrap();
    assert_eq!(
        service
            .check_automatic_entries_at_unlocked(date("2026-11-01"))
            .await
            .unwrap()
            .created_count,
        0
    );
    drop(operation);
    let monthly = service
        .list_monthly_items("2026-11".to_owned())
        .await
        .unwrap();
    assert_eq!(monthly.len(), 1);
    assert_eq!(monthly[0].item_source, "PLANNED");
    assert_eq!(monthly[0].planned_amount, "1800.00");
    assert_eq!(monthly[0].actual_amount.as_deref(), Some("1800.00"));
    assert_eq!(monthly[0].actual_entry_count, 1);
}
