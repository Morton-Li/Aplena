use chrono::{Datelike, Local};
use pfcm_domain::{Amount, Category, CurrencyCode, PlanItem, RecognitionMode, Settings, YearMonth};
use sqlx::{
    Row,
    sqlite::{SqliteConnectOptions, SqlitePoolOptions},
};
use std::str::FromStr;
use uuid::Uuid;

use crate::infrastructure::{StoreError, open_database, open_memory_database};

use super::{
    dto::{
        ActualEntryInputDto, DeleteManualMonthlyItemInputDto, EnsureActualOnlyInputDto,
        ExchangeRateUpsertDto, InitializeMonthInputDto, ManualMonthlyItemInputDto,
        PlanItemInputDto, RateOverrideDto, ReferenceRateImportDto, ReferenceRateObservationDto,
        SettingsInputDto,
    },
    service::FinanceService,
};

async fn test_service() -> FinanceService {
    let service = FinanceService::new(open_memory_database().await.unwrap()).unwrap();
    service
        .save_settings(SettingsInputDto {
            base_currency: "CNY".to_owned(),
            auto_update_exchange_rates: false,
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

#[derive(Debug, PartialEq, Eq)]
struct SchemaSnapshot {
    objects: Vec<(String, String, String, String)>,
    tables: Vec<String>,
    columns: Vec<String>,
    foreign_keys: Vec<String>,
    indexes: Vec<String>,
    index_columns: Vec<String>,
}

async fn schema_snapshot(pool: &sqlx::SqlitePool) -> SchemaSnapshot {
    let objects = sqlx::query(
        "SELECT type, name, tbl_name, sql FROM sqlite_schema \
         WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' AND name != '_sqlx_migrations' \
         ORDER BY type, name",
    )
    .fetch_all(pool)
    .await
    .unwrap()
    .into_iter()
    .map(|row| {
        let sql: String = row.get("sql");
        (
            row.get("type"),
            row.get("name"),
            row.get("tbl_name"),
            sql.chars()
                .filter(|character| !character.is_whitespace())
                .collect(),
        )
    })
    .collect();

    async fn text_rows(pool: &sqlx::SqlitePool, query: &'static str) -> Vec<String> {
        sqlx::query_scalar(query).fetch_all(pool).await.unwrap()
    }

    let tables = text_rows(
        pool,
        "SELECT name || '|' || strict || '|' || wr FROM pragma_table_list \
         WHERE schema = 'main' AND name NOT LIKE 'sqlite_%' AND name != '_sqlx_migrations' \
         ORDER BY name",
    )
    .await;
    let columns = text_rows(
        pool,
        "SELECT m.name || '|' || p.cid || '|' || p.name || '|' || p.type || '|' || \
         p.[notnull] || '|' || COALESCE(p.dflt_value, '<NULL>') || '|' || p.pk || '|' || p.hidden \
         FROM sqlite_schema AS m, pragma_table_xinfo(m.name) AS p \
         WHERE m.type = 'table' AND m.name NOT LIKE 'sqlite_%' AND m.name != '_sqlx_migrations' \
         ORDER BY m.name, p.cid",
    )
    .await;
    let foreign_keys = text_rows(
        pool,
        "SELECT m.name || '|' || f.id || '|' || f.seq || '|' || f.[table] || '|' || \
         f.[from] || '|' || f.[to] || '|' || f.on_update || '|' || f.on_delete || '|' || f.match \
         FROM sqlite_schema AS m, pragma_foreign_key_list(m.name) AS f \
         WHERE m.type = 'table' AND m.name NOT LIKE 'sqlite_%' AND m.name != '_sqlx_migrations' \
         ORDER BY m.name, f.id, f.seq",
    )
    .await;
    let indexes = text_rows(
        pool,
        "SELECT m.name || '|' || i.name || '|' || i.[unique] || '|' || i.origin || '|' || \
         i.partial FROM sqlite_schema AS m, pragma_index_list(m.name) AS i \
         WHERE m.type = 'table' AND m.name NOT LIKE 'sqlite_%' AND m.name != '_sqlx_migrations' \
         ORDER BY m.name, i.name",
    )
    .await;
    let index_columns = text_rows(
        pool,
        "SELECT m.name || '|' || i.name || '|' || x.seqno || '|' || x.cid || '|' || \
         COALESCE(x.name, '<NULL>') || '|' || x.[desc] || '|' || x.coll || '|' || x.[key] \
         FROM sqlite_schema AS m, pragma_index_list(m.name) AS i, pragma_index_xinfo(i.name) AS x \
         WHERE m.type = 'table' AND m.name NOT LIKE 'sqlite_%' AND m.name != '_sqlx_migrations' \
         ORDER BY m.name, i.name, x.seqno",
    )
    .await;

    SchemaSnapshot {
        objects,
        tables,
        columns,
        foreign_keys,
        indexes,
        index_columns,
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

    let migration_history: Vec<(i64, String, i64)> = sqlx::query_as(
        "SELECT version, description, success FROM _sqlx_migrations ORDER BY version",
    )
    .fetch_all(store.pool())
    .await
    .unwrap();
    assert_eq!(
        migration_history,
        vec![
            (1, "initial release".to_owned(), 1),
            (2, "remove monthly item status".to_owned(), 1),
            (3, "remove next month goal".to_owned(), 1),
            (4, "add automatic rate refresh".to_owned(), 1),
        ]
    );

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
                "settings" | "exchange_rates" | "plan_items" | "monthly_items" | "actual_entries"
            )
            .then(|| (name, row.try_get::<i64, _>("strict").unwrap()))
        })
        .collect::<Vec<_>>();
    assert_eq!(business_tables.len(), 5);
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

    let monthly_columns: Vec<String> =
        sqlx::query_scalar("SELECT name FROM pragma_table_info('monthly_items')")
            .fetch_all(store.pool())
            .await
            .unwrap();
    assert!(
        !monthly_columns
            .iter()
            .any(|name| name == "actual_confirmed_at")
    );
    let status_triggers: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM sqlite_schema WHERE type = 'trigger' AND name LIKE 'actual_entry_reopens_%'",
    )
    .fetch_one(store.pool())
    .await
    .unwrap();
    assert_eq!(status_triggers, 0);

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
async fn current_schema_matches_the_frozen_pre_release_schema_after_public_migrations() {
    let baseline = open_memory_database().await.unwrap();
    let options = SqliteConnectOptions::from_str("sqlite::memory:")
        .unwrap()
        .foreign_keys(true);
    let pre_release = SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(options)
        .await
        .unwrap();
    sqlx::raw_sql(include_str!(
        "../../tests/fixtures/pre_release_final_schema.sql"
    ))
    .execute(&pre_release)
    .await
    .unwrap();
    sqlx::raw_sql(include_str!(
        "../../migrations/0002_remove_monthly_item_status.sql"
    ))
    .execute(&pre_release)
    .await
    .unwrap();
    sqlx::raw_sql(include_str!(
        "../../migrations/0003_remove_next_month_goal.sql"
    ))
    .execute(&pre_release)
    .await
    .unwrap();
    sqlx::raw_sql(include_str!(
        "../../migrations/0004_add_automatic_rate_refresh.sql"
    ))
    .execute(&pre_release)
    .await
    .unwrap();

    assert_eq!(
        schema_snapshot(baseline.pool()).await,
        schema_snapshot(&pre_release).await
    );
}

#[tokio::test]
async fn automatic_rate_refresh_migration_preserves_existing_settings() {
    let options = SqliteConnectOptions::from_str("sqlite::memory:")
        .unwrap()
        .foreign_keys(true);
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(options)
        .await
        .unwrap();
    sqlx::raw_sql(include_str!("../../migrations/0001_initial_release.sql"))
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query(
        "INSERT INTO exchange_rates (currency_code, rate_scaled, source, observed_on, updated_at) \
         VALUES ('CNY', 100000000, 'BASE_CURRENCY', '2026-09-01', '2026-09-01T00:00:00Z')",
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO settings (id, base_currency_code, created_at, updated_at) \
         VALUES (1, 'CNY', '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z')",
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::raw_sql(include_str!(
        "../../migrations/0004_add_automatic_rate_refresh.sql"
    ))
    .execute(&pool)
    .await
    .unwrap();

    let stored: (String, i64) = sqlx::query_as(
        "SELECT base_currency_code, auto_update_exchange_rates FROM settings WHERE id = 1",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(stored, ("CNY".to_owned(), 0));
}

#[tokio::test]
async fn pre_release_database_is_refused_without_modification() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("pre-release.sqlite3");
    let options = SqliteConnectOptions::from_str(&format!("sqlite://{}", path.display()))
        .unwrap()
        .create_if_missing(true)
        .foreign_keys(true);
    let pre_release = SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(options)
        .await
        .unwrap();
    sqlx::raw_sql(include_str!(
        "../../tests/fixtures/pre_release_final_schema.sql"
    ))
    .execute(&pre_release)
    .await
    .unwrap();
    sqlx::query(
        "CREATE TABLE _sqlx_migrations (version BIGINT PRIMARY KEY, success BOOLEAN NOT NULL)",
    )
    .execute(&pre_release)
    .await
    .unwrap();
    sqlx::query("INSERT INTO _sqlx_migrations (version, success) VALUES (6, TRUE)")
        .execute(&pre_release)
        .await
        .unwrap();
    sqlx::query("CREATE TABLE preservation_marker (value TEXT NOT NULL)")
        .execute(&pre_release)
        .await
        .unwrap();
    sqlx::query("INSERT INTO preservation_marker VALUES ('unchanged')")
        .execute(&pre_release)
        .await
        .unwrap();
    pre_release.close().await;

    let result = open_database(&path).await;
    assert!(matches!(result, Err(StoreError::FutureSchema)));

    let verification = sqlx::SqlitePool::connect(&format!("sqlite://{}", path.display()))
        .await
        .unwrap();
    let marker: String = sqlx::query_scalar("SELECT value FROM preservation_marker")
        .fetch_one(&verification)
        .await
        .unwrap();
    let applied_version: i64 =
        sqlx::query_scalar("SELECT version FROM _sqlx_migrations WHERE success = TRUE")
            .fetch_one(&verification)
            .await
            .unwrap();
    assert_eq!(marker, "unchanged");
    assert_eq!(applied_version, 6);
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
    assert!(!settings.auto_update_exchange_rates);
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
    let goal_table_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM sqlite_schema WHERE type = 'table' AND name = 'next_month_goal'",
    )
    .fetch_one(store.pool())
    .await
    .unwrap();
    assert_eq!(goal_table_count, 0);
}

#[tokio::test]
async fn automatic_rate_refresh_preference_is_persisted() {
    let service = FinanceService::new(open_memory_database().await.unwrap()).unwrap();
    let saved = service
        .save_settings(SettingsInputDto {
            base_currency: "CNY".to_owned(),
            auto_update_exchange_rates: true,
        })
        .await
        .unwrap();

    assert!(saved.auto_update_exchange_rates);
    assert!(
        service
            .get_settings()
            .await
            .unwrap()
            .unwrap()
            .auto_update_exchange_rates
    );
}

#[tokio::test]
async fn rule_changes_stay_forward_looking_and_do_not_mutate_current_snapshots() {
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
    let mut updated = plan(
        "下月工资",
        "FIXED_INCOME",
        "32000",
        "CNY",
        1,
        "AMORTIZED",
        current,
        None,
    );
    updated.id = Some(created.id.clone());
    service.update_plan_item(updated).await.unwrap();
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

    let entry = service
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

    service
        .delete_manual_monthly_item(DeleteManualMonthlyItemInputDto {
            id: item.id.clone(),
        })
        .await
        .unwrap();
    assert!(
        service
            .list_monthly_items(current.to_string())
            .await
            .unwrap()
            .iter()
            .all(|candidate| candidate.id != item.id)
    );
    assert!(
        service
            .list_actual_entries(item.id)
            .await
            .unwrap()
            .is_empty()
    );
    let stored_entry_count: i64 = {
        let store = service.test_store().await;
        sqlx::query_scalar("SELECT COUNT(*) FROM actual_entries WHERE id = ?")
            .bind(entry.id)
            .fetch_one(store.pool())
            .await
            .unwrap()
    };
    assert_eq!(stored_entry_count, 0);
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
async fn actual_entries_aggregate_without_status_and_base_currency_lock_remains_safe() {
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
    assert_eq!(item.variance_amount, None);
    let protected_plan_item = service
        .delete_manual_monthly_item(DeleteManualMonthlyItemInputDto {
            id: item.id.clone(),
        })
        .await
        .unwrap_err();
    assert_eq!(protected_plan_item.error_code, "NOT_FOUND");
    let before_actual = service.month_analytics(current.to_string()).await.unwrap();
    assert_eq!(before_actual.expense.actual_to_date, None);

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
    let with_expense = service
        .list_monthly_items(current.to_string())
        .await
        .unwrap()
        .remove(0);
    assert_eq!(with_expense.actual_amount.as_deref(), Some("427.00"));
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
    service.delete_actual_entry(refund_entry.id).await.unwrap();
    let after_delete = service
        .list_monthly_items(current.to_string())
        .await
        .unwrap()
        .remove(0);
    assert_eq!(after_delete.actual_amount.as_deref(), Some("427.00"));
    let entries = service.list_actual_entries(item.id).await.unwrap();
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0].id, expense_entry.id);

    let error = service
        .save_settings(SettingsInputDto {
            base_currency: "USD".to_owned(),
            auto_update_exchange_rates: false,
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
async fn persisted_projection_uses_payment_items_monthly_equivalent_even_between_payment_months() {
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

    let projection = service.budget_projection().await.unwrap();
    assert_eq!(projection.stable_income, "30000.00");
    assert_eq!(projection.fixed_commitments, "3000.00");
    assert_eq!(projection.projected_income, "30000.00");
    assert_eq!(projection.projected_expenses, "3000.00");
    assert_eq!(projection.projected_savings, "27000.00");
    assert_eq!(
        projection.projected_savings_rate_percent.as_deref(),
        Some("90.00")
    );
    assert_eq!(
        projection.fixed_commitment_ratio_percent.as_deref(),
        Some("10.00")
    );
}
