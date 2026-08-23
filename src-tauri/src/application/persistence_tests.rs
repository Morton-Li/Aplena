use chrono::{Datelike, Local};
use pfcm_domain::{Amount, Category, CurrencyCode, PlanItem, RecognitionMode, Settings, YearMonth};
use sqlx::Row;
use std::str::FromStr;
use uuid::Uuid;

use crate::infrastructure::{open_database, open_memory_database};

use super::{
    dto::{
        ConfirmActualsInputDto, ExchangeRateUpsertDto, InitializeMonthInputDto,
        MonthlyActualInputDto, PlanItemInputDto, RateOverrideDto, SettingsInputDto,
    },
    service::FinanceService,
};

async fn test_service() -> FinanceService {
    let service = FinanceService::new(open_memory_database().await.unwrap()).unwrap();
    service
        .save_settings(SettingsInputDto {
            target_month: current_month().to_string(),
            base_currency: "CNY".to_owned(),
            minimum_savings_rate_basis_points: 2000,
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
        start_month: start.to_string(),
        end_month: end.map(|month| month.to_string()),
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
                "settings" | "exchange_rates" | "plan_items" | "monthly_items"
            )
            .then(|| (name, row.try_get::<i64, _>("strict").unwrap()))
        })
        .collect::<Vec<_>>();
    assert_eq!(business_tables.len(), 4);
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
    assert!(indexes.contains(&"idx_plan_items_active_months".to_owned()));
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
         period_months, recognition_mode, start_month, end_month, note, created_at, updated_at) \
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
    let month = YearMonth::new(2026, 1).unwrap();
    store
        .create_settings(
            &Settings::new(month, CurrencyCode::new("CNY").unwrap(), 2500).unwrap(),
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
            .target_month(),
        month
    );
}

#[tokio::test]
async fn startup_automatically_initializes_only_the_current_natural_month() {
    let store = open_memory_database().await.unwrap();
    let current = current_month();
    store
        .create_settings(
            &Settings::new(current, CurrencyCode::new("CNY").unwrap(), 2000).unwrap(),
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
                current,
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
    assert_eq!(snapshots[0].planned_amount, "65.0000");
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
        "100.0000"
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
    changed.id = Some(created.plan_item.id.clone());
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
    assert_eq!(before_delete[0].planned_amount, "7.0000");
    assert_eq!(
        service.list_plan_items().await.unwrap()[0].history_month_count,
        1
    );

    let deleted = service
        .delete_plan_item(created.plan_item.id)
        .await
        .unwrap();
    assert_eq!(deleted.detached_monthly_items, 1);
    let after_delete = service
        .list_monthly_items(historical.to_string())
        .await
        .unwrap();
    assert_eq!(after_delete[0].source_plan_item_id, None);
    assert_eq!(after_delete[0].planned_amount, "7.0000");
}

#[tokio::test]
async fn actual_null_zero_batch_confirmation_and_base_currency_lock_are_distinct_and_safe() {
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
        .update_monthly_actual(MonthlyActualInputDto {
            id: item.id.clone(),
            actual_amount: Some("0".to_owned()),
        })
        .await
        .unwrap();
    assert_eq!(zero.actual_amount.as_deref(), Some("0.0000"));
    assert_eq!(zero.variance_amount.as_deref(), Some("-300.0000"));
    assert_eq!(zero.completion_rate_percent.as_deref(), Some("0.00"));
    assert_eq!(zero.data_status, "CONFIRMED_ZERO");
    assert_eq!(zero.variance_effect, "FAVORABLE");
    let after_zero = service.month_analytics(current.to_string()).await.unwrap();
    assert_eq!(after_zero.actual_status, "COMPLETE");
    assert_eq!(after_zero.expense.actual_to_date.as_deref(), Some("0.0000"));
    assert_eq!(after_zero.expense.variance.as_deref(), Some("-300.0000"));
    service
        .update_monthly_actual(MonthlyActualInputDto {
            id: item.id,
            actual_amount: None,
        })
        .await
        .unwrap();
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
    assert_eq!(confirmed_item.actual_amount.as_deref(), Some("300.0000"));
    assert_eq!(
        confirmed_item.completion_rate_percent.as_deref(),
        Some("100.00")
    );
    assert_eq!(confirmed_item.variance_effect, "ON_PLAN");

    let error = service
        .save_settings(SettingsInputDto {
            target_month: current.to_string(),
            base_currency: "USD".to_owned(),
            minimum_savings_rate_basis_points: 2000,
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

    let capacity = service
        .financial_capacity(Some("2026-02".to_owned()))
        .await
        .unwrap();
    assert_eq!(capacity.stable_income, "30000.0000");
    assert_eq!(capacity.fixed_commitments, "3000.0000");
    assert_eq!(capacity.preserved_capacity, "21000.0000");
    assert_eq!(
        capacity.fixed_commitment_ratio_percent.as_deref(),
        Some("10.00")
    );
}
