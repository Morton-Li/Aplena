use chrono::{Datelike, Local};
use pfcm_domain::{Amount, Category, CurrencyCode, PlanItem, RecognitionMode, Settings, YearMonth};
use sqlx::Row;
use std::str::FromStr;
use uuid::Uuid;

use crate::infrastructure::{create_version_two_fixture, open_database, open_memory_database};

use super::{
    dto::{
        ActualEntryInputDto, ConfirmActualsInputDto, ConfirmMonthlyItemInputDto,
        EnsureActualOnlyInputDto, ExchangeRateUpsertDto, InitializeMonthInputDto,
        ManualMonthlyItemInputDto, NextMonthGoalInputDto, PlanItemInputDto, RateOverrideDto,
        ReferenceRateImportDto, ReferenceRateObservationDto, SettingsInputDto,
    },
    service::FinanceService,
};

async fn test_service() -> FinanceService {
    let service = FinanceService::new(open_memory_database().await.unwrap()).unwrap();
    service
        .save_settings(SettingsInputDto {
            base_currency: "CNY".to_owned(),
        })
        .await
        .unwrap();
    service
}

fn current_month() -> YearMonth {
    let now = Local::now();
    YearMonth::new(now.year(), u8::try_from(now.month()).unwrap()).unwrap()
}

#[allow(clippy::too_many_arguments)]
fn plan(
    name: &str,
    category: &str,
    amount: &str,
    currency: &str,
    period_months: u32,
    mode: &str,
    start: YearMonth,
    end: Option<YearMonth>,
) -> PlanItemInputDto {
    PlanItemInputDto {
        id: None,
        name: name.to_owned(),
        category: category.to_owned(),
        planned_amount: amount.to_owned(),
        currency: currency.to_owned(),
        period_months,
        start_date: format!("{start}-01"),
        end_date: end.map(|month| format!("{month}-01")),
        recognition_mode: mode.to_owned(),
        note: None,
    }
}

fn init(month: YearMonth) -> InitializeMonthInputDto {
    InitializeMonthInputDto {
        month: month.to_string(),
        confirmed: true,
        rate_overrides: Vec::new(),
    }
}

#[tokio::test]
async fn migration_creates_only_strict_core_tables_constraints_and_indexes() {
    let store = open_memory_database().await.unwrap();
    let foreign_keys: i64 = sqlx::query_scalar("PRAGMA foreign_keys")
        .fetch_one(store.pool())
        .await
        .unwrap();
    assert_eq!(foreign_keys, 1);

    let tables = sqlx::query("PRAGMA table_list")
        .fetch_all(store.pool())
        .await
        .unwrap();
    let business_tables = tables
        .iter()
        .filter_map(|row| {
            let name: String = row.try_get("name").ok()?;
            matches!(
                name.as_str(),
                "settings"
                    | "next_month_goal"
                    | "exchange_rates"
                    | "plan_items"
                    | "monthly_items"
                    | "actual_entries"
            )
            .then(|| (name, row.try_get::<i64, _>("strict").unwrap()))
        })
        .collect::<Vec<_>>();
    assert_eq!(business_tables.len(), 6);
    assert!(business_tables.iter().all(|(_, strict)| *strict == 1));

    let names: Vec<String> =
        sqlx::query_scalar("SELECT name FROM sqlite_schema WHERE type = 'table' ORDER BY name")
            .fetch_all(store.pool())
            .await
            .unwrap();
    for forbidden in [
        "monthly_reports",
        "dashboard",
        "trends",
        "category_summaries",
        "capacity_results",
    ] {
        assert!(!names.iter().any(|name| name == forbidden));
    }

    let indexes: Vec<String> = sqlx::query_scalar(
        "SELECT name FROM sqlite_schema WHERE type = 'index' AND name LIKE 'idx_%'",
    )
    .fetch_all(store.pool())
    .await
    .unwrap();
    assert!(indexes.contains(&"idx_plan_items_active_dates".to_owned()));
    assert!(indexes.contains(&"idx_monthly_items_month_category_flow".to_owned()));

    let strict_error = sqlx::query(
        "INSERT INTO exchange_rates (currency_code, rate_scaled, updated_at) \
         VALUES ('USD', 'not-an-integer', '2026-01-01T00:00:00Z')",
    )
    .execute(store.pool())
    .await
    .unwrap_err();
    assert!(strict_error.to_string().contains("INTEGER"));

    let foreign_key_error = sqlx::query(
        "INSERT INTO plan_items (id, name, category, planned_amount_scaled, currency_code, \
         period_months, recognition_mode, start_date, end_date, note, created_at, updated_at) \
         VALUES ('00000000-0000-0000-0000-000000000001', '无汇率项目', 'ESSENTIAL_EXPENSE', \
         10000, 'USD', 1, 'AMORTIZED', '2026-01-01', NULL, NULL, \
         '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
    )
    .execute(store.pool())
    .await
    .unwrap_err();
    assert!(foreign_key_error.to_string().contains("FOREIGN KEY"));
}

#[tokio::test]
async fn migration_reopens_existing_database_without_losing_data_and_uses_wal() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("existing.sqlite3");
    let store = open_database(&path).await.unwrap();
    store
        .create_settings(
            &Settings::new(CurrencyCode::new("CNY").unwrap()).unwrap(),
            "2026-01-01T00:00:00Z",
        )
        .await
        .unwrap();
    let journal_mode: String = sqlx::query_scalar("PRAGMA journal_mode")
        .fetch_one(store.pool())
        .await
        .unwrap();
    assert_eq!(journal_mode.to_ascii_lowercase(), "wal");
    store.pool().close().await;

    let reopened = open_database(&path).await.unwrap();
    assert_eq!(
        reopened
            .get_settings()
            .await
            .unwrap()
            .unwrap()
            .value
            .base_currency()
            .as_str(),
        "CNY"
    );
}

#[tokio::test]
async fn legacy_four_decimal_database_migrates_to_cents_entries_and_confirmation_states() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("legacy.sqlite3");
    create_version_two_fixture(&path).await.unwrap();
    let url = format!("sqlite://{}", path.display());
    let pool = sqlx::SqlitePool::connect(&url).await.unwrap();
    sqlx::query("INSERT INTO exchange_rates VALUES ('CNY', 100000000, 't')")
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("INSERT INTO settings VALUES (1, '2026-01-01', 'CNY', 2000, 't', 't')")
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query(
        "INSERT INTO plan_items VALUES \
         ('11111111-1111-4111-8111-111111111111', '迁移计划', 'ESSENTIAL_EXPENSE', 12345, \
          'CNY', 1, 'PAYMENT', '2026-01-01', NULL, NULL, 't', 't')",
    )
    .execute(&pool)
    .await
    .unwrap();
    for (id, month, actual) in [
        ("22222222-2222-4222-8222-222222222221", "2026-01-01", None),
        (
            "22222222-2222-4222-8222-222222222222",
            "2026-02-01",
            Some(0_i64),
        ),
        (
            "22222222-2222-4222-8222-222222222223",
            "2026-03-01",
            Some(10055_i64),
        ),
    ] {
        sqlx::query(
            "INSERT INTO monthly_items (id, source_plan_item_id, month, snapshot_name, category, \
             flow_type, recognition_mode, planned_amount_scaled, actual_amount_scaled, currency_code, \
             note, created_at, updated_at) VALUES (?, '11111111-1111-4111-8111-111111111111', ?, \
             '迁移计划', 'ESSENTIAL_EXPENSE', 'EXPENSE', 'PAYMENT', 12345, ?, 'CNY', NULL, 't', 't')",
        ).bind(id).bind(month).bind(actual).execute(&pool).await.unwrap();
    }
    pool.close().await;

    let store = open_database(&path).await.unwrap();
    let plans = store.list_plan_items().await.unwrap();
    assert_eq!(plans[0].value.amount().decimal_string(), "1.23");
    assert_eq!(plans[0].value.start_date().to_string(), "2026-01-01");
    let migrated_goal = store.get_next_month_goal().await.unwrap().unwrap();
    assert_eq!(
        migrated_goal.value.minimum_savings_rate().basis_points(),
        2_000
    );
    assert_eq!(
        migrated_goal.value.target_month(),
        current_month().next_month().unwrap()
    );
    let january = store
        .list_monthly_items(YearMonth::from_str("2026-01").unwrap())
        .await
        .unwrap();
    let february = store
        .list_monthly_items(YearMonth::from_str("2026-02").unwrap())
        .await
        .unwrap();
    let march = store
        .list_monthly_items(YearMonth::from_str("2026-03").unwrap())
        .await
        .unwrap();
    assert_eq!(january[0].value.actual_data_status().code(), "MISSING");
    assert_eq!(
        february[0].value.actual_data_status().code(),
        "CONFIRMED_ZERO"
    );
    assert_eq!(march[0].value.actual_data_status().code(), "FINAL");
    assert_eq!(
        march[0].value.actual_amount().unwrap().decimal_string(),
        "1.01"
    );
    let entries = store
        .list_actual_entries(march[0].value.id())
        .await
        .unwrap();
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0].value.origin().code(), "MIGRATED_AGGREGATE");
    assert_eq!(entries[0].value.amount().decimal_string(), "1.01");
    assert_eq!(
        entries[0].exchange_snapshot.source_amount.decimal_string(),
        "1.01"
    );
    assert_eq!(entries[0].exchange_snapshot.source_currency.as_str(), "CNY");
    assert_eq!(
        entries[0].exchange_snapshot.exchange_rate.decimal_string(),
        "1.00000000"
    );
    assert_eq!(entries[0].exchange_snapshot.source, "MIGRATED_BASE");
    assert_eq!(
        entries[0].exchange_snapshot.observed_on.to_string(),
        entries[0].value.occurred_on().to_string()
    );
}

#[tokio::test]
async fn startup_automatically_initializes_only_the_current_natural_month() {
    let store = open_memory_database().await.unwrap();
    let current = current_month();
    store
        .create_settings(
            &Settings::new(CurrencyCode::new("CNY").unwrap()).unwrap(),
            "2026-01-01T00:00:00Z",
        )
        .await
        .unwrap();
    store
        .insert_plan_item(
            &PlanItem::new(
                Uuid::new_v4(),
                "启动时计划",
                Category::FixedIncome,
                Amount::from_str("10000").unwrap(),
                CurrencyCode::new("CNY").unwrap(),
                1,
                current.first_date(),
                None,
                RecognitionMode::Amortized,
                None,
            )
            .unwrap(),
            "2026-01-01T00:00:00Z",
        )
        .await
        .unwrap();
    let service = FinanceService::new(store).unwrap();

    service.initialize_on_startup().await;

    let status = service.startup_status().await;
    assert_eq!(status.current_month, current.to_string());
    assert_eq!(status.initialization.unwrap().created_count, 1);
    assert!(status.error.is_none());
    assert_eq!(
        service.list_existing_months().await.unwrap(),
        vec![current.to_string()]
    );
}

#[tokio::test]
async fn startup_creates_default_cny_settings_idempotently() {
    let service = FinanceService::new(open_memory_database().await.unwrap()).unwrap();

    service.initialize_on_startup().await;
    service.initialize_on_startup().await;

    let settings = service.get_settings().await.unwrap().unwrap();
    assert_eq!(settings.base_currency, "CNY");
    let goal = service.get_next_month_goal().await.unwrap();
    assert_eq!(
        goal.target_month,
        current_month().next_month().unwrap().to_string()
    );
    assert_eq!(goal.minimum_savings_rate_basis_points, 2_000);
    assert!(service.startup_status().await.error.is_none());

    let store = service.test_store().await;
    let settings_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM settings")
        .fetch_one(store.pool())
        .await
        .unwrap();
    let base_rate: i64 =
        sqlx::query_scalar("SELECT rate_scaled FROM exchange_rates WHERE currency_code = 'CNY'")
            .fetch_one(store.pool())
            .await
            .unwrap();
    assert_eq!(settings_count, 1);
    assert_eq!(base_rate, 100_000_000);
}

#[tokio::test]
async fn goal_and_rule_changes_stay_forward_looking_and_do_not_mutate_current_snapshots() {
    let service = test_service().await;
    let current = current_month();
    let created = service
        .create_plan_item(plan(
            "下月工资",
            "FIXED_INCOME",
            "30000",
            "CNY",
            1,
            "AMORTIZED",
            current,
            None,
        ))
        .await
        .unwrap();

    assert_eq!(
        service
            .list_monthly_items(current.to_string())
            .await
            .unwrap()
            .len(),
        0,
        "saving a rule must not initialize the current month"
    );

    service.initialize_month(init(current)).await.unwrap();
    let before = service
        .list_monthly_items(current.to_string())
        .await
        .unwrap();
    let goal = service
        .save_next_month_goal(NextMonthGoalInputDto {
            minimum_savings_rate_basis_points: 3_500,
        })
        .await
        .unwrap();
    assert_eq!(goal.target_month, current.next_month().unwrap().to_string());
    assert_eq!(goal.minimum_savings_rate_basis_points, 3_500);
    let after = service
        .list_monthly_items(current.to_string())
        .await
        .unwrap();
    assert_eq!(before, after);
    assert_eq!(
        after[0].source_plan_item_id.as_deref(),
        Some(created.id.as_str())
    );
}

#[tokio::test]
async fn plan_names_are_normalized_unique_and_currency_is_validated() {
    let service = test_service().await;
    let current = current_month();
    service
        .create_plan_item(plan(
            "  ＣｈａｔＧＰＴ  ",
            "FIXED_COMMITMENT_EXPENSE",
            "20",
            "CNY",
            1,
            "AMORTIZED",
            current,
            None,
        ))
        .await
        .unwrap();
    let duplicate = service
        .create_plan_item(plan(
            "ChatGPT",
            "FIXED_COMMITMENT_EXPENSE",
            "30",
            "CNY",
            1,
            "AMORTIZED",
            current,
            None,
        ))
        .await
        .unwrap_err();
    assert_eq!(duplicate.error_code, "DUPLICATE_PLAN_ITEM_NAME");

    let missing = service
        .create_plan_item(plan(
            "美元服务",
            "FIXED_COMMITMENT_EXPENSE",
            "10",
            "USD",
            1,
            "AMORTIZED",
            current,
            None,
        ))
        .await
        .unwrap_err();
    assert_eq!(missing.error_code, "MISSING_EXCHANGE_RATE");
}

#[tokio::test]
async fn initialization_is_idempotent_concurrency_safe_and_requires_noncurrent_confirmation() {
    let service = test_service().await;
    let current = current_month();
    service
        .create_plan_item(plan(
            "工资",
            "FIXED_INCOME",
            "30000",
            "CNY",
            1,
            "AMORTIZED",
            current,
            None,
        ))
        .await
        .unwrap();

    let first = service.initialize_month(init(current)).await.unwrap();
    assert_eq!(first.created_count, 1);
    let repeated = service.initialize_month(init(current)).await.unwrap();
    assert_eq!(repeated.created_count, 0);
    assert_eq!(repeated.skipped_existing_count, 1);

    let future = current.next_month().unwrap();
    let not_confirmed = service
        .initialize_month(InitializeMonthInputDto {
            month: future.to_string(),
            confirmed: false,
            rate_overrides: Vec::new(),
        })
        .await
        .unwrap_err();
    assert_eq!(
        not_confirmed.error_code,
        "MONTH_INITIALIZATION_CONFIRMATION_REQUIRED"
    );

    let left = service.clone();
    let right = service.clone();
    let (left_result, right_result) = tokio::join!(
        left.initialize_month(init(future)),
        right.initialize_month(init(future))
    );
    let left_result = left_result.unwrap();
    let right_result = right_result.unwrap();
    assert_eq!(left_result.created_count + right_result.created_count, 1);
    assert_eq!(
        service
            .list_monthly_items(future.to_string())
            .await
            .unwrap()
            .len(),
        1
    );
}

#[tokio::test]
async fn actual_only_item_promotes_in_place_keeps_entries_and_deleted_plan_rejects_new_entries() {
    let service = test_service().await;
    let current = current_month();
    let next = current.next_month().unwrap();
    let created = service
        .create_plan_item(plan(
            "年付后续退款",
            "ESSENTIAL_EXPENSE",
            "1200",
            "CNY",
            12,
            "PAYMENT",
            current,
            None,
        ))
        .await
        .unwrap();
    let actual_only = service
        .ensure_actual_only(EnsureActualOnlyInputDto {
            plan_item_id: created.id.clone(),
            month: next.to_string(),
        })
        .await
        .unwrap();
    assert_eq!(actual_only.item_source, "ACTUAL_ONLY");
    assert_eq!(actual_only.planned_amount, "0.00");
    assert_eq!(actual_only.scheduled_date, None);
    service
        .create_actual_entry(ActualEntryInputDto {
            id: None,
            monthly_item_id: actual_only.id.clone(),
            occurred_on: format!("{next}-01"),
            effect: "DECREASE".to_owned(),
            amount: "25.00".to_owned(),
            currency: "CNY".to_owned(),
            exchange_rate: "1.00000000".to_owned(),
            exchange_rate_source: "BASE_CURRENCY".to_owned(),
            exchange_rate_observed_on: format!("{next}-01"),
            note: Some("迟到退款".to_owned()),
        })
        .await
        .unwrap();

    service
        .update_plan_item(PlanItemInputDto {
            id: Some(created.id.clone()),
            name: created.name.clone(),
            category: created.category.clone(),
            planned_amount: created.planned_amount.clone(),
            currency: created.currency.clone(),
            period_months: 1,
            start_date: created.start_date.clone(),
            end_date: None,
            recognition_mode: "PAYMENT".to_owned(),
            note: None,
        })
        .await
        .unwrap();
    let promoted = service.initialize_month(init(next)).await.unwrap();
    assert_eq!(promoted.created_count, 1);
    let item = service
        .list_monthly_items(next.to_string())
        .await
        .unwrap()
        .remove(0);
    assert_eq!(item.id, actual_only.id);
    assert_eq!(item.item_source, "PLANNED");
    assert_eq!(item.planned_amount, "1200.00");
    assert!(item.scheduled_date.is_some());
    assert_eq!(item.actual_amount.as_deref(), Some("-25.00"));
    assert_eq!(
        service
            .list_actual_entries(item.id.clone())
            .await
            .unwrap()
            .len(),
        1
    );
    let repeated = service.initialize_month(init(next)).await.unwrap();
    assert_eq!(repeated.created_count, 0);
    assert_eq!(repeated.skipped_existing_count, 1);

    service.delete_plan_item(created.id).await.unwrap();
    let error = service
        .create_actual_entry(ActualEntryInputDto {
            id: None,
            monthly_item_id: item.id,
            occurred_on: format!("{next}-02"),
            effect: "INCREASE".to_owned(),
            amount: "1.00".to_owned(),
            currency: "CNY".to_owned(),
            exchange_rate: "1.00000000".to_owned(),
            exchange_rate_source: "BASE_CURRENCY".to_owned(),
            exchange_rate_observed_on: format!("{next}-02"),
            note: None,
        })
        .await
        .unwrap_err();
    assert_eq!(error.error_code, "DELETED_PLAN_CANNOT_ACCEPT_ENTRY");
}

#[tokio::test]
async fn manual_monthly_item_accepts_actual_entries_without_a_plan() {
    let service = test_service().await;
    let current = current_month();
    let item = service
        .create_manual_monthly_item(ManualMonthlyItemInputDto {
            name: "  本月房租  ".to_owned(),
            month: current.to_string(),
            category: "ESSENTIAL_EXPENSE".to_owned(),
            note: None,
        })
        .await
        .unwrap();

    assert_eq!(item.source_plan_item_id, None);
    assert_eq!(item.item_name, "本月房租");
    assert_eq!(item.item_source, "ACTUAL_ONLY");
    assert_eq!(item.item_origin, "MANUAL");
    assert_eq!(item.variance_effect, "UNKNOWN");

    service
        .create_actual_entry(ActualEntryInputDto {
            id: None,
            monthly_item_id: item.id.clone(),
            occurred_on: format!("{current}-02"),
            effect: "INCREASE".to_owned(),
            amount: "3200.00".to_owned(),
            currency: "CNY".to_owned(),
            exchange_rate: "1.00000000".to_owned(),
            exchange_rate_source: "BASE_CURRENCY".to_owned(),
            exchange_rate_observed_on: format!("{current}-02"),
            note: Some("月租".to_owned()),
        })
        .await
        .unwrap();

    let refreshed = service
        .list_monthly_items(current.to_string())
        .await
        .unwrap()
        .into_iter()
        .find(|candidate| candidate.id == item.id)
        .unwrap();
    assert_eq!(refreshed.actual_amount.as_deref(), Some("3200.00"));
    assert_eq!(refreshed.variance_amount, None);
    assert_eq!(refreshed.variance_effect, "UNKNOWN");
}

#[tokio::test]
async fn official_cross_rates_and_actual_entry_snapshots_stay_fixed_and_atomic() {
    let service = test_service().await;
    let current = current_month();
    let observations = vec![
        ReferenceRateObservationDto {
            currency: "CNY".to_owned(),
            euro_rate: "7.8251".to_owned(),
            observed_on: "2026-08-28".to_owned(),
        },
        ReferenceRateObservationDto {
            currency: "USD".to_owned(),
            euro_rate: "1.1643".to_owned(),
            observed_on: "2026-08-28".to_owned(),
        },
    ];
    let imported = service
        .import_reference_rates(ReferenceRateImportDto {
            observations: observations.clone(),
            currencies: vec!["USD".to_owned()],
        })
        .await
        .unwrap();
    let usd = imported.iter().find(|rate| rate.currency == "USD").unwrap();
    assert_eq!(usd.rate, "6.72086232");
    assert_eq!(usd.source, "ECB_REFERENCE");
    assert_eq!(usd.observed_on.as_deref(), Some("2026-08-28"));

    let item = service
        .create_manual_monthly_item(ManualMonthlyItemInputDto {
            name: "美元费用".to_owned(),
            month: current.to_string(),
            category: "ESSENTIAL_EXPENSE".to_owned(),
            note: None,
        })
        .await
        .unwrap();
    let created = service
        .create_actual_entry(ActualEntryInputDto {
            id: None,
            monthly_item_id: item.id.clone(),
            occurred_on: format!("{current}-18"),
            effect: "INCREASE".to_owned(),
            amount: "100.00".to_owned(),
            currency: "USD".to_owned(),
            exchange_rate: usd.rate.clone(),
            exchange_rate_source: usd.source.clone(),
            exchange_rate_observed_on: usd.observed_on.clone().unwrap(),
            note: None,
        })
        .await
        .unwrap();
    assert_eq!(created.source_amount, "100.00");
    assert_eq!(created.source_currency, "USD");
    assert_eq!(created.amount, "672.09");
    assert_eq!(created.exchange_rate, "6.72086232");
    assert_eq!(created.exchange_rate_source, "ECB_REFERENCE");

    service
        .import_reference_rates(ReferenceRateImportDto {
            observations: vec![
                ReferenceRateObservationDto {
                    currency: "CNY".to_owned(),
                    euro_rate: "8".to_owned(),
                    observed_on: "2026-08-29".to_owned(),
                },
                ReferenceRateObservationDto {
                    currency: "USD".to_owned(),
                    euro_rate: "2".to_owned(),
                    observed_on: "2026-08-29".to_owned(),
                },
            ],
            currencies: vec!["USD".to_owned()],
        })
        .await
        .unwrap();
    let unchanged = service
        .list_actual_entries(item.id.clone())
        .await
        .unwrap()
        .remove(0);
    assert_eq!(unchanged.amount, "672.09");
    assert_eq!(unchanged.exchange_rate, "6.72086232");
    assert_eq!(unchanged.exchange_rate_observed_on, "2026-08-28");

    let edited = service
        .update_actual_entry(ActualEntryInputDto {
            id: Some(created.id.clone()),
            monthly_item_id: item.id.clone(),
            occurred_on: format!("{current}-19"),
            effect: "INCREASE".to_owned(),
            amount: "200.00".to_owned(),
            currency: "EUR".to_owned(),
            exchange_rate: "99".to_owned(),
            exchange_rate_source: "MANUAL".to_owned(),
            exchange_rate_observed_on: "2026-08-29".to_owned(),
            note: Some("编辑金额但保留基准".to_owned()),
        })
        .await
        .unwrap();
    assert_eq!(edited.source_amount, "200.00");
    assert_eq!(edited.source_currency, "USD");
    assert_eq!(edited.amount, "1344.17");
    assert_eq!(edited.exchange_rate, "6.72086232");
    assert_eq!(edited.exchange_rate_source, "ECB_REFERENCE");
    assert_eq!(edited.exchange_rate_observed_on, "2026-08-28");

    service
        .delete_exchange_rate("USD".to_owned())
        .await
        .unwrap_err();
    let rates_before_failure = service.list_exchange_rates().await.unwrap();
    let usd_before_failure = rates_before_failure
        .iter()
        .find(|rate| rate.currency == "USD")
        .unwrap()
        .rate
        .clone();
    service
        .import_reference_rates(ReferenceRateImportDto {
            observations,
            currencies: vec!["USD".to_owned(), "ZZZ".to_owned()],
        })
        .await
        .unwrap_err();
    let rates_after_failure = service.list_exchange_rates().await.unwrap();
    assert_eq!(
        rates_after_failure
            .iter()
            .find(|rate| rate.currency == "USD")
            .unwrap()
            .rate,
        usd_before_failure
    );
}

#[tokio::test]
async fn preview_is_read_only_and_temporary_backfill_rate_is_not_persisted() {
    let service = test_service().await;
    service
        .upsert_exchange_rate(ExchangeRateUpsertDto {
            currency: "USD".to_owned(),
            rate: "7.25000000".to_owned(),
        })
        .await
        .unwrap();
    let historical = YearMonth::new(2024, 1).unwrap();
    service
        .create_plan_item(plan(
            "历史美元订阅",
            "FIXED_COMMITMENT_EXPENSE",
            "10",
            "USD",
            1,
            "AMORTIZED",
            historical,
            Some(historical),
        ))
        .await
        .unwrap();
    let request = InitializeMonthInputDto {
        month: historical.to_string(),
        confirmed: true,
        rate_overrides: vec![RateOverrideDto {
            currency: "USD".to_owned(),
            rate: "6.50000000".to_owned(),
        }],
    };
    let preview = service.preview_month(request.clone()).await.unwrap();
    assert_eq!(preview.direction, "HISTORICAL");
    assert_eq!(preview.candidate_count, 1);
    assert!(
        service
            .list_monthly_items(historical.to_string())
            .await
            .unwrap()
            .is_empty()
    );

    service.initialize_month(request).await.unwrap();
    let snapshots = service
        .list_monthly_items(historical.to_string())
        .await
        .unwrap();
    assert_eq!(snapshots[0].planned_amount, "65.00");
    let rates = service.list_exchange_rates().await.unwrap();
    assert_eq!(
        rates
            .iter()
            .find(|rate| rate.currency == "USD")
            .unwrap()
            .rate,
        "7.25000000"
    );
}

#[tokio::test]
async fn missing_rate_rolls_back_the_entire_month() {
    let service = test_service().await;
    service
        .upsert_exchange_rate(ExchangeRateUpsertDto {
            currency: "USD".to_owned(),
            rate: "7.00000000".to_owned(),
        })
        .await
        .unwrap();
    let historical = YearMonth::new(2023, 5).unwrap();
    for (name, currency) in [("人民币项目", "CNY"), ("美元项目", "USD")] {
        service
            .create_plan_item(plan(
                name,
                "ESSENTIAL_EXPENSE",
                "100",
                currency,
                1,
                "AMORTIZED",
                historical,
                Some(historical),
            ))
            .await
            .unwrap();
    }

    let test_store = service.test_store().await;
    sqlx::query("PRAGMA foreign_keys = OFF")
        .execute(test_store.pool())
        .await
        .unwrap();
    sqlx::query("DELETE FROM exchange_rates WHERE currency_code = 'USD'")
        .execute(test_store.pool())
        .await
        .unwrap();
    sqlx::query("PRAGMA foreign_keys = ON")
        .execute(test_store.pool())
        .await
        .unwrap();

    let error = service
        .initialize_month(init(historical))
        .await
        .unwrap_err();
    assert_eq!(error.error_code, "MISSING_EXCHANGE_RATE");
    assert!(
        service
            .list_monthly_items(historical.to_string())
            .await
            .unwrap()
            .is_empty()
    );
}

#[tokio::test]
async fn payment_and_amortized_schedules_cover_periods_boundaries_and_cross_years() {
    let service = test_service().await;
    let start = YearMonth::new(2025, 11).unwrap();
    let end = YearMonth::new(2026, 12).unwrap();
    for (name, period) in [("月付", 1), ("季付", 3), ("半年付", 6), ("年付", 12)] {
        service
            .create_plan_item(plan(
                name,
                "ESSENTIAL_EXPENSE",
                "1200",
                "CNY",
                period,
                "PAYMENT",
                start,
                Some(end),
            ))
            .await
            .unwrap();
    }
    service
        .create_plan_item(plan(
            "均摊",
            "FIXED_COMMITMENT_EXPENSE",
            "1200",
            "CNY",
            12,
            "AMORTIZED",
            start,
            Some(end),
        ))
        .await
        .unwrap();
    let one_time = YearMonth::new(2024, 4).unwrap();
    service
        .create_plan_item(plan(
            "一次性",
            "DISCRETIONARY_BUDGET",
            "500",
            "CNY",
            1,
            "PAYMENT",
            one_time,
            Some(one_time),
        ))
        .await
        .unwrap();

    service.initialize_month(init(start)).await.unwrap();
    assert_eq!(
        service
            .list_monthly_items(start.to_string())
            .await
            .unwrap()
            .len(),
        5
    );
    let december = YearMonth::new(2025, 12).unwrap();
    service.initialize_month(init(december)).await.unwrap();
    let december_items = service
        .list_monthly_items(december.to_string())
        .await
        .unwrap();
    assert_eq!(december_items.len(), 2);
    assert!(december_items.iter().any(|item| item.item_name == "月付"));
    assert!(december_items.iter().any(|item| item.item_name == "均摊"));
    assert_eq!(
        december_items
            .iter()
            .find(|item| item.item_name == "均摊")
            .unwrap()
            .planned_amount,
        "100.00"
    );

    let quarterly = YearMonth::new(2026, 2).unwrap();
    service.initialize_month(init(quarterly)).await.unwrap();
    let quarterly_names = service
        .list_monthly_items(quarterly.to_string())
        .await
        .unwrap()
        .into_iter()
        .map(|item| item.item_name)
        .collect::<Vec<_>>();
    assert!(quarterly_names.contains(&"季付".to_owned()));
    assert!(!quarterly_names.contains(&"半年付".to_owned()));

    let cross_year_annual = YearMonth::new(2026, 11).unwrap();
    service
        .initialize_month(init(cross_year_annual))
        .await
        .unwrap();
    let annual_names = service
        .list_monthly_items(cross_year_annual.to_string())
        .await
        .unwrap()
        .into_iter()
        .map(|item| item.item_name)
        .collect::<Vec<_>>();
    assert!(annual_names.contains(&"年付".to_owned()));

    service.initialize_month(init(one_time)).await.unwrap();
    assert_eq!(
        service
            .list_monthly_items(one_time.to_string())
            .await
            .unwrap()
            .len(),
        1
    );
    let after_one_time = one_time.next_month().unwrap();
    service
        .initialize_month(init(after_one_time))
        .await
        .unwrap();
    assert!(
        service
            .list_monthly_items(after_one_time.to_string())
            .await
            .unwrap()
            .is_empty()
    );
}

#[tokio::test]
async fn plan_rate_changes_and_deletion_never_rewrite_history() {
    let service = test_service().await;
    service
        .upsert_exchange_rate(ExchangeRateUpsertDto {
            currency: "USD".to_owned(),
            rate: "7.00000000".to_owned(),
        })
        .await
        .unwrap();
    let historical = YearMonth::new(2022, 1).unwrap();
    let created = service
        .create_plan_item(plan(
            "旧名称",
            "FIXED_COMMITMENT_EXPENSE",
            "12",
            "USD",
            12,
            "AMORTIZED",
            historical,
            Some(historical),
        ))
        .await
        .unwrap();
    service.initialize_month(init(historical)).await.unwrap();

    let mut changed = plan(
        "新名称",
        "DISCRETIONARY_BUDGET",
        "1200",
        "USD",
        1,
        "PAYMENT",
        historical,
        Some(historical),
    );
    changed.id = Some(created.id.clone());
    service.update_plan_item(changed).await.unwrap();
    service
        .upsert_exchange_rate(ExchangeRateUpsertDto {
            currency: "USD".to_owned(),
            rate: "8.00000000".to_owned(),
        })
        .await
        .unwrap();
    service.initialize_month(init(historical)).await.unwrap();
    let before_delete = service
        .list_monthly_items(historical.to_string())
        .await
        .unwrap();
    assert_eq!(before_delete.len(), 1);
    assert_eq!(before_delete[0].item_name, "旧名称");
    assert_eq!(before_delete[0].category, "FIXED_COMMITMENT_EXPENSE");
    assert_eq!(before_delete[0].recognition_mode, "AMORTIZED");
    assert_eq!(before_delete[0].planned_amount, "7.00");
    assert_eq!(
        service.list_plan_items().await.unwrap()[0].history_month_count,
        1
    );

    let deleted = service.delete_plan_item(created.id).await.unwrap();
    assert_eq!(deleted.detached_monthly_items, 1);
    let after_delete = service
        .list_monthly_items(historical.to_string())
        .await
        .unwrap();
    assert_eq!(after_delete[0].source_plan_item_id, None);
    assert_eq!(after_delete[0].planned_amount, "7.00");
}

#[tokio::test]
async fn actual_entries_confirmation_reopening_and_base_currency_lock_are_distinct_and_safe() {
    let service = test_service().await;
    let current = current_month();
    service
        .create_plan_item(plan(
            "电费",
            "ESSENTIAL_EXPENSE",
            "300",
            "CNY",
            1,
            "AMORTIZED",
            current,
            None,
        ))
        .await
        .unwrap();
    service.initialize_month(init(current)).await.unwrap();
    let item = service
        .list_monthly_items(current.to_string())
        .await
        .unwrap()
        .remove(0);
    assert_eq!(item.actual_amount, None);
    assert_eq!(item.data_status, "MISSING");
    assert_eq!(item.variance_amount, None);
    let before_actual = service.month_analytics(current.to_string()).await.unwrap();
    assert_eq!(before_actual.actual_status, "EMPTY");
    assert_eq!(before_actual.expense.actual_to_date, None);

    let zero = service
        .confirm_monthly_item(ConfirmMonthlyItemInputDto {
            id: item.id.clone(),
        })
        .await
        .unwrap();
    assert_eq!(zero.actual_amount.as_deref(), Some("0.00"));
    assert_eq!(zero.variance_amount.as_deref(), Some("-300.00"));
    assert_eq!(zero.completion_rate_percent.as_deref(), Some("0.00"));
    assert_eq!(zero.data_status, "CONFIRMED_ZERO");
    assert_eq!(zero.variance_effect, "FAVORABLE");
    let after_zero = service.month_analytics(current.to_string()).await.unwrap();
    assert_eq!(after_zero.actual_status, "COMPLETE");
    assert_eq!(after_zero.expense.actual_to_date.as_deref(), Some("0.00"));
    assert_eq!(after_zero.expense.variance.as_deref(), Some("-300.00"));

    let expense_entry = service
        .create_actual_entry(ActualEntryInputDto {
            id: None,
            monthly_item_id: item.id.clone(),
            occurred_on: format!("{current}-15"),
            effect: "INCREASE".to_owned(),
            amount: "427.00".to_owned(),
            currency: "CNY".to_owned(),
            exchange_rate: "1.00000000".to_owned(),
            exchange_rate_source: "BASE_CURRENCY".to_owned(),
            exchange_rate_observed_on: format!("{current}-15"),
            note: None,
        })
        .await
        .unwrap();
    let reopened = service
        .list_monthly_items(current.to_string())
        .await
        .unwrap()
        .remove(0);
    assert_eq!(reopened.data_status, "IN_PROGRESS");
    assert_eq!(reopened.actual_amount.as_deref(), Some("427.00"));
    let refund_entry = service
        .create_actual_entry(ActualEntryInputDto {
            id: None,
            monthly_item_id: item.id.clone(),
            occurred_on: format!("{current}-16"),
            effect: "DECREASE".to_owned(),
            amount: "500.00".to_owned(),
            currency: "CNY".to_owned(),
            exchange_rate: "1.00000000".to_owned(),
            exchange_rate_source: "BASE_CURRENCY".to_owned(),
            exchange_rate_observed_on: format!("{current}-16"),
            note: Some("退款超过本月支出".to_owned()),
        })
        .await
        .unwrap();
    let negative = service
        .list_monthly_items(current.to_string())
        .await
        .unwrap()
        .remove(0);
    assert_eq!(negative.actual_amount.as_deref(), Some("-73.00"));
    let confirmed = service
        .confirm_actuals(ConfirmActualsInputDto {
            month: current.to_string(),
            category: None,
        })
        .await
        .unwrap();
    assert_eq!(confirmed.updated_count, 1);
    let confirmed_item = service
        .list_monthly_items(current.to_string())
        .await
        .unwrap()
        .remove(0);
    assert_eq!(confirmed_item.actual_amount.as_deref(), Some("-73.00"));
    assert_eq!(confirmed_item.data_status, "FINAL");

    let wrong_month = current.next_month().unwrap();
    let wrong_date = service
        .update_actual_entry(ActualEntryInputDto {
            id: Some(refund_entry.id.clone()),
            monthly_item_id: item.id.clone(),
            occurred_on: format!("{wrong_month}-01"),
            effect: "DECREASE".to_owned(),
            amount: "400.00".to_owned(),
            currency: "CNY".to_owned(),
            exchange_rate: "1.00000000".to_owned(),
            exchange_rate_source: "BASE_CURRENCY".to_owned(),
            exchange_rate_observed_on: format!("{wrong_month}-01"),
            note: Some("调整退款".to_owned()),
        })
        .await
        .unwrap_err();
    assert_eq!(wrong_date.error_code, "ACTUAL_ENTRY_DATE_OUTSIDE_MONTH");

    let updated = service
        .update_actual_entry(ActualEntryInputDto {
            id: Some(refund_entry.id.clone()),
            monthly_item_id: item.id.clone(),
            occurred_on: format!("{current}-17"),
            effect: "DECREASE".to_owned(),
            amount: "400.00".to_owned(),
            currency: "CNY".to_owned(),
            exchange_rate: "1.00000000".to_owned(),
            exchange_rate_source: "BASE_CURRENCY".to_owned(),
            exchange_rate_observed_on: format!("{current}-17"),
            note: Some("调整退款".to_owned()),
        })
        .await
        .unwrap();
    assert_eq!(updated.amount, "400.00");
    assert_eq!(updated.note.as_deref(), Some("调整退款"));
    let after_edit = service
        .list_monthly_items(current.to_string())
        .await
        .unwrap()
        .remove(0);
    assert_eq!(after_edit.actual_amount.as_deref(), Some("27.00"));
    assert_eq!(after_edit.data_status, "IN_PROGRESS");

    service
        .confirm_monthly_item(ConfirmMonthlyItemInputDto {
            id: item.id.clone(),
        })
        .await
        .unwrap();
    service.delete_actual_entry(refund_entry.id).await.unwrap();
    let after_delete = service
        .list_monthly_items(current.to_string())
        .await
        .unwrap()
        .remove(0);
    assert_eq!(after_delete.actual_amount.as_deref(), Some("427.00"));
    assert_eq!(after_delete.data_status, "IN_PROGRESS");
    let entries = service.list_actual_entries(item.id).await.unwrap();
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0].id, expense_entry.id);

    let error = service
        .save_settings(SettingsInputDto {
            base_currency: "USD".to_owned(),
        })
        .await
        .unwrap_err();
    assert_eq!(error.error_code, "BASE_CURRENCY_LOCKED");
    assert_eq!(
        service.get_settings().await.unwrap().unwrap().base_currency,
        "CNY"
    );
    assert!(
        !service
            .list_exchange_rates()
            .await
            .unwrap()
            .iter()
            .any(|rate| rate.currency == "USD")
    );
}

#[tokio::test]
async fn persisted_capacity_uses_payment_items_monthly_equivalent_even_between_payment_months() {
    let service = test_service().await;
    let start = YearMonth::new(2026, 1).unwrap();
    let end = YearMonth::new(2026, 12).unwrap();
    service
        .create_plan_item(plan(
            "固定工资",
            "FIXED_INCOME",
            "30000",
            "CNY",
            1,
            "AMORTIZED",
            start,
            Some(end),
        ))
        .await
        .unwrap();
    service
        .create_plan_item(plan(
            "年度承诺",
            "FIXED_COMMITMENT_EXPENSE",
            "36000",
            "CNY",
            12,
            "PAYMENT",
            start,
            Some(end),
        ))
        .await
        .unwrap();

    let capacity = service.financial_capacity().await.unwrap();
    assert_eq!(capacity.stable_income, "30000.00");
    assert_eq!(capacity.fixed_commitments, "3000.00");
    assert_eq!(capacity.preserved_capacity, "21000.00");
    assert_eq!(
        capacity.fixed_commitment_ratio_percent.as_deref(),
        Some("10.00")
    );
}
