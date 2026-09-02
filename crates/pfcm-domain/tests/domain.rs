use std::str::FromStr;

use pfcm_domain::{
    ActualEntry, ActualEntryEffect, ActualEntryOrigin, Amount, CalendarDate, Category,
    CurrencyCode, DomainError, ExchangeRate, MonthlyItem, MonthlyItemSource, PlanItem,
    ProjectionInput, RecognitionMode, YearMonth, aggregate_actual_entries,
    calculate_budget_projection, create_monthly_snapshot, is_effective_in, monthly_equivalent,
    recognized_amount, scheduled_date_for_month,
};
use rust_decimal::Decimal;
use uuid::Uuid;

fn month(value: &str) -> YearMonth {
    value.parse().unwrap()
}
fn date(value: &str) -> CalendarDate {
    value.parse().unwrap()
}
fn currency(value: &str) -> CurrencyCode {
    CurrencyCode::new(value).unwrap()
}
fn amount(value: &str) -> Amount {
    value.parse().unwrap()
}
fn rate(source: &str, base: &str, value: &str) -> ExchangeRate {
    ExchangeRate::from_str(currency(source), currency(base), value).unwrap()
}

#[allow(clippy::too_many_arguments)]
fn plan(
    name: &str,
    category: Category,
    planned_amount: &str,
    source_currency: &str,
    period_months: u32,
    start_date: &str,
    end_date: Option<&str>,
    mode: RecognitionMode,
) -> PlanItem {
    PlanItem::new(
        Uuid::new_v4(),
        name,
        category,
        amount(planned_amount),
        currency(source_currency),
        period_months,
        date(start_date),
        end_date.map(date),
        mode,
        None,
    )
    .unwrap()
}

#[test]
fn year_month_and_calendar_date_are_canonical_and_leap_safe() {
    assert_eq!(month("2026-12").next_month().unwrap(), month("2027-01"));
    assert_eq!(month("2024-02").last_day(), 29);
    assert_eq!(month("2025-02").last_day(), 28);
    assert_eq!(month("2025-02").date_clamped_to_day(31), date("2025-02-28"));
    assert_eq!(date("2026-06-17").year_month(), month("2026-06"));
    assert_eq!(
        CalendarDate::from_str("2026-02-29"),
        Err(DomainError::InvalidDate)
    );
    assert_eq!(
        YearMonth::from_str("2026-6"),
        Err(DomainError::InvalidYearMonth)
    );
}

#[test]
fn authoritative_amounts_are_cents_and_calculations_round_half_up_once() {
    assert_eq!(amount("1.23").scaled_i64(), 123);
    assert_eq!(amount("0").decimal_string(), "0.00");
    assert_eq!(
        Amount::from_str("1.234"),
        Err(DomainError::AmountTooPrecise)
    );
    assert_eq!(
        Amount::from_decimal(Decimal::new(1235, 3))
            .unwrap()
            .decimal_string(),
        "1.24"
    );
    assert_eq!(
        Amount::from_decimal(Decimal::new(1225, 3))
            .unwrap()
            .decimal_string(),
        "1.23"
    );
    assert_eq!(
        Amount::from_str("92233720368547758.08"),
        Err(DomainError::AmountOutOfRange)
    );
}

#[test]
fn plan_dates_validate_exact_days_and_amortized_months_use_interval_intersection() {
    assert_eq!(
        PlanItem::new(
            Uuid::new_v4(),
            "错误",
            Category::EssentialExpense,
            amount("1"),
            currency("CNY"),
            1,
            date("2026-06-02"),
            Some(date("2026-06-01")),
            RecognitionMode::Amortized,
            None,
        ),
        Err(DomainError::EndDateBeforeStart),
    );
    let item = plan(
        "短期保障",
        Category::EssentialExpense,
        "120",
        "CNY",
        12,
        "2026-01-31",
        Some("2026-02-02"),
        RecognitionMode::Amortized,
    );
    assert!(is_effective_in(&item, month("2026-01")));
    assert!(is_effective_in(&item, month("2026-02")));
    assert!(!is_effective_in(&item, month("2026-03")));
    assert_eq!(
        recognized_amount(
            &item,
            month("2026-02"),
            &rate("CNY", "CNY", "1"),
            &currency("CNY")
        )
        .unwrap()
        .unwrap()
        .decimal_string(),
        "10.00",
    );
}

#[test]
fn payment_schedule_keeps_original_day_anchor_after_clamping() {
    let item = plan(
        "月末支付",
        Category::FixedCommitmentExpense,
        "99.99",
        "CNY",
        1,
        "2024-01-31",
        None,
        RecognitionMode::Payment,
    );
    assert_eq!(
        scheduled_date_for_month(&item, month("2024-01")),
        Some(date("2024-01-31"))
    );
    assert_eq!(
        scheduled_date_for_month(&item, month("2024-02")),
        Some(date("2024-02-29"))
    );
    assert_eq!(
        scheduled_date_for_month(&item, month("2024-03")),
        Some(date("2024-03-31"))
    );

    let ended = plan(
        "结束边界",
        Category::EssentialExpense,
        "10",
        "CNY",
        1,
        "2025-01-31",
        Some("2025-02-27"),
        RecognitionMode::Payment,
    );
    assert_eq!(scheduled_date_for_month(&ended, month("2025-02")), None);
}

#[test]
fn payment_snapshot_carries_scheduled_date_and_projection_uses_monthly_equivalent() {
    let item = plan(
        "年付保险",
        Category::EssentialExpense,
        "1200",
        "CNY",
        12,
        "2026-03-15",
        None,
        RecognitionMode::Payment,
    );
    let exchange = rate("CNY", "CNY", "1");
    let cny = currency("CNY");
    assert_eq!(
        recognized_amount(&item, month("2026-04"), &exchange, &cny).unwrap(),
        None
    );
    assert_eq!(
        monthly_equivalent(&item, month("2026-04"), &exchange, &cny)
            .unwrap()
            .unwrap()
            .decimal_string(),
        "100.00"
    );
    let snapshot =
        create_monthly_snapshot(Uuid::new_v4(), &item, month("2026-03"), &exchange, &cny)
            .unwrap()
            .unwrap();
    assert_eq!(snapshot.scheduled_date(), Some(date("2026-03-15")));
    assert_eq!(snapshot.item_source(), MonthlyItemSource::Planned);
}

#[test]
fn actual_entries_are_positive_effects_and_can_aggregate_to_a_negative_net() {
    let monthly_id = Uuid::new_v4();
    let spend = ActualEntry::new(
        Uuid::new_v4(),
        monthly_id,
        month("2026-06"),
        date("2026-06-02"),
        ActualEntryEffect::Increase,
        amount("20.00"),
        ActualEntryOrigin::User,
        None,
    )
    .unwrap();
    let refund = ActualEntry::new(
        Uuid::new_v4(),
        monthly_id,
        month("2026-06"),
        date("2026-06-30"),
        ActualEntryEffect::Decrease,
        amount("30.00"),
        ActualEntryOrigin::User,
        Some("退款".into()),
    )
    .unwrap();
    assert_eq!(
        aggregate_actual_entries(&[spend, refund])
            .unwrap()
            .decimal_string(),
        "-10.00"
    );
    assert_eq!(
        ActualEntry::new(
            Uuid::new_v4(),
            monthly_id,
            month("2026-06"),
            date("2026-07-01"),
            ActualEntryEffect::Increase,
            amount("1"),
            ActualEntryOrigin::User,
            None,
        ),
        Err(DomainError::ActualEntryDateOutsideMonth),
    );
    assert_eq!(
        ActualEntry::new(
            Uuid::new_v4(),
            monthly_id,
            month("2026-06"),
            date("2026-06-01"),
            ActualEntryEffect::Increase,
            amount("0"),
            ActualEntryOrigin::User,
            None,
        ),
        Err(DomainError::ZeroActualEntryAmount),
    );
}

#[test]
fn manual_monthly_item_is_independent_from_a_plan_and_normalizes_its_name() {
    let item = MonthlyItem::manual(
        Uuid::new_v4(),
        "  本月房租  ",
        month("2026-06"),
        Category::EssentialExpense,
        currency("CNY"),
        Some("  手动录入  ".to_owned()),
    )
    .unwrap();

    assert_eq!(item.source_plan_item_id(), None);
    assert_eq!(item.item_name(), "本月房租");
    assert_eq!(item.item_source(), MonthlyItemSource::ActualOnly);
    assert_eq!(item.item_origin(), pfcm_domain::MonthlyItemOrigin::Manual);
    assert_eq!(item.planned_amount(), Amount::zero());
    assert_eq!(item.note(), Some("手动录入"));
}

#[test]
fn budget_projection_uses_plan_monthly_equivalents_with_two_decimal_outputs() {
    let income = plan(
        "工资",
        Category::FixedIncome,
        "30000",
        "CNY",
        1,
        "2026-01-01",
        None,
        RecognitionMode::Payment,
    );
    let commitment = plan(
        "年付服务",
        Category::FixedCommitmentExpense,
        "36000",
        "CNY",
        12,
        "2026-01-31",
        None,
        RecognitionMode::Payment,
    );
    let one = rate("CNY", "CNY", "1");
    let result = calculate_budget_projection(
        month("2026-02"),
        currency("CNY"),
        &[
            ProjectionInput {
                plan_item: &income,
                exchange_rate: &one,
            },
            ProjectionInput {
                plan_item: &commitment,
                exchange_rate: &one,
            },
        ],
    )
    .unwrap();
    assert_eq!(result.stable_income().decimal_string(), "30000.00");
    assert_eq!(result.fixed_commitments().decimal_string(), "3000.00");
    assert_eq!(result.projected_income().decimal_string(), "30000.00");
    assert_eq!(result.projected_expenses().decimal_string(), "3000.00");
    assert_eq!(result.projected_savings().decimal_string(), "27000.00");
    assert_eq!(
        result.projected_savings_rate().unwrap().decimal_string(),
        "0.90000000"
    );
}

#[test]
fn budget_projection_preserves_a_negative_savings_result() {
    let income = plan(
        "工资",
        Category::FixedIncome,
        "10000",
        "CNY",
        1,
        "2026-01-01",
        None,
        RecognitionMode::Amortized,
    );
    let expense = plan(
        "必要支出",
        Category::EssentialExpense,
        "12000",
        "CNY",
        1,
        "2026-01-01",
        None,
        RecognitionMode::Amortized,
    );
    let one = rate("CNY", "CNY", "1");
    let result = calculate_budget_projection(
        month("2026-02"),
        currency("CNY"),
        &[
            ProjectionInput {
                plan_item: &income,
                exchange_rate: &one,
            },
            ProjectionInput {
                plan_item: &expense,
                exchange_rate: &one,
            },
        ],
    )
    .unwrap();

    assert_eq!(result.projected_savings().decimal_string(), "-2000.00");
    assert_eq!(
        result.projected_savings_rate().unwrap().decimal_string(),
        "-0.20000000"
    );
}
