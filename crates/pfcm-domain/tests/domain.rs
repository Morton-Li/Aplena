use std::str::FromStr;

use pfcm_domain::{
    Amount, CapacityInput, Category, CurrencyCode, DomainError, ExchangeRate, FlowType, PlanItem,
    RecognitionMode, SavingsRate, YearMonth, calculate_financial_capacity, create_monthly_snapshot,
    is_effective_in, monthly_equivalent, recognized_amount,
};
use uuid::Uuid;

fn month(value: &str) -> YearMonth {
    value.parse().expect("test month must be valid")
}

fn currency(value: &str) -> CurrencyCode {
    CurrencyCode::new(value).expect("test currency must be valid")
}

fn amount(value: &str) -> Amount {
    value.parse().expect("test amount must be valid")
}

fn rate(source: &str, base: &str, value: &str) -> ExchangeRate {
    ExchangeRate::from_str(currency(source), currency(base), value)
        .expect("test rate must be valid")
}

#[allow(clippy::too_many_arguments)]
fn plan(
    name: &str,
    category: Category,
    planned_amount: &str,
    source_currency: &str,
    period_months: u32,
    start_month: &str,
    end_month: Option<&str>,
    mode: RecognitionMode,
) -> PlanItem {
    PlanItem::new(
        Uuid::new_v4(),
        name,
        category,
        amount(planned_amount),
        currency(source_currency),
        period_months,
        month(start_month),
        end_month.map(month),
        mode,
        None,
    )
    .expect("test plan must be valid")
}

#[test]
fn year_month_parses_formats_and_crosses_year_boundaries() {
    let december = month("2026-12");
    assert_eq!(december.to_string(), "2026-12");
    assert_eq!(december.database_anchor(), "2026-12-01");
    assert_eq!(december.next_month().unwrap(), month("2027-01"));
    assert_eq!(month("2027-02").months_since(december), Some(2));
    assert_eq!(december.months_since(month("2027-01")), None);
    assert_eq!(month("2026-01").add_months(-1).unwrap(), month("2025-12"));
}

#[test]
fn year_month_rejects_non_canonical_or_out_of_range_values() {
    for invalid in ["2026-6", "2026/06", "0000-01", "2026-00", "2026-13"] {
        assert_eq!(
            YearMonth::from_str(invalid),
            Err(DomainError::InvalidYearMonth)
        );
    }
    assert_eq!(
        month("9999-12").next_month(),
        Err(DomainError::InvalidYearMonth)
    );
}

#[test]
fn currency_codes_are_trimmed_uppercased_and_serialized_as_strings() {
    let code = currency(" usd ");
    assert_eq!(code.as_str(), "USD");
    assert_eq!(serde_json::to_string(&code).unwrap(), "\"USD\"");
    assert_eq!(
        serde_json::from_str::<CurrencyCode>("\"cny\"").unwrap(),
        currency("CNY")
    );
    assert_eq!(
        CurrencyCode::new("US1"),
        Err(DomainError::InvalidCurrencyCode)
    );
}

#[test]
fn amounts_use_four_decimals_half_up_and_an_i64_scaled_value() {
    let rounded = amount("1.23445");
    assert_eq!(rounded.decimal_string(), "1.2345");
    assert_eq!(rounded.scaled_i64(), 12_345);
    assert_eq!(amount("1.23444").decimal_string(), "1.2344");
    assert_eq!(amount("0").decimal_string(), "0.0000");
    assert_eq!(Amount::from_str("-0.01"), Err(DomainError::NegativeAmount));
    assert_eq!(
        Amount::from_str("922337203685477.5808"),
        Err(DomainError::AmountOutOfRange)
    );
    assert_eq!(serde_json::to_string(&rounded).unwrap(), "\"1.2345\"");
}

#[test]
fn exchange_and_savings_rates_validate_their_ranges() {
    let exchange = rate("USD", "CNY", "7.123456785");
    assert_eq!(exchange.decimal_string(), "7.12345679");
    assert_eq!(
        ExchangeRate::from_str(currency("USD"), currency("CNY"), "0"),
        Err(DomainError::InvalidExchangeRate)
    );
    assert_eq!(
        ExchangeRate::from_str(currency("USD"), currency("CNY"), "0.000000004"),
        Err(DomainError::InvalidExchangeRate)
    );
    assert_eq!(
        ExchangeRate::from_str(currency("CNY"), currency("CNY"), "1.01"),
        Err(DomainError::InvalidBaseCurrencyRate)
    );
    assert_eq!(
        SavingsRate::from_basis_points(10_000)
            .unwrap()
            .basis_points(),
        10_000
    );
    assert_eq!(
        SavingsRate::from_basis_points(10_001),
        Err(DomainError::InvalidSavingsRate)
    );
}

#[test]
fn plan_item_normalizes_name_derives_flow_and_enforces_invariants() {
    let item = plan(
        "  ＣｈａｔＧＰＴ  ",
        Category::FixedCommitmentExpense,
        "20",
        "USD",
        1,
        "2026-06",
        None,
        RecognitionMode::Payment,
    );
    assert_eq!(item.name(), "ChatGPT");
    assert_eq!(item.flow_type(), FlowType::Expense);
    assert_eq!(Category::FixedIncome.flow_type(), FlowType::Income);

    assert_eq!(
        PlanItem::new(
            Uuid::new_v4(),
            " ",
            Category::FixedIncome,
            amount("1"),
            currency("CNY"),
            1,
            month("2026-06"),
            None,
            RecognitionMode::Amortized,
            None,
        ),
        Err(DomainError::EmptyPlanItemName)
    );
    assert_eq!(
        PlanItem::new(
            Uuid::new_v4(),
            "工资",
            Category::FixedIncome,
            amount("1"),
            currency("CNY"),
            0,
            month("2026-06"),
            None,
            RecognitionMode::Amortized,
            None,
        ),
        Err(DomainError::InvalidPeriod)
    );
    assert_eq!(
        PlanItem::new(
            Uuid::new_v4(),
            "时间错误",
            Category::EssentialExpense,
            amount("1"),
            currency("CNY"),
            1,
            month("2026-06"),
            Some(month("2026-05")),
            RecognitionMode::Payment,
            None,
        ),
        Err(DomainError::EndBeforeStart)
    );
}

#[test]
fn amortized_mode_recognizes_every_effective_month_and_rounds_only_final_result() {
    let item = plan(
        "年度服务",
        Category::FixedCommitmentExpense,
        "1.0000",
        "USD",
        6,
        "2026-01",
        Some("2026-06"),
        RecognitionMode::Amortized,
    );
    let exchange = rate("USD", "CNY", "1.00000000");
    let cny = currency("CNY");

    assert_eq!(
        recognized_amount(&item, month("2026-01"), &exchange, &cny)
            .unwrap()
            .unwrap()
            .decimal_string(),
        "0.1667"
    );
    assert!(is_effective_in(&item, month("2026-06")));
    assert_eq!(
        recognized_amount(&item, month("2026-07"), &exchange, &cny).unwrap(),
        None
    );
}

#[test]
fn payment_mode_emits_only_on_start_anchored_payment_months() {
    let item = plan(
        "年度保险",
        Category::EssentialExpense,
        "1200",
        "CNY",
        12,
        "2026-03",
        None,
        RecognitionMode::Payment,
    );
    let exchange = rate("CNY", "CNY", "1");
    let cny = currency("CNY");

    assert_eq!(
        recognized_amount(&item, month("2026-03"), &exchange, &cny)
            .unwrap()
            .unwrap()
            .decimal_string(),
        "1200.0000"
    );
    assert_eq!(
        recognized_amount(&item, month("2027-02"), &exchange, &cny).unwrap(),
        None
    );
    assert_eq!(
        recognized_amount(&item, month("2027-03"), &exchange, &cny)
            .unwrap()
            .unwrap()
            .decimal_string(),
        "1200.0000"
    );
    assert_eq!(
        monthly_equivalent(&item, month("2027-02"), &exchange, &cny)
            .unwrap()
            .unwrap()
            .decimal_string(),
        "100.0000"
    );
}

#[test]
fn monthly_quarterly_half_year_and_one_time_schedules_cross_year_correctly() {
    let cny = currency("CNY");
    let exchange = rate("CNY", "CNY", "1");
    let cases = [
        (1, "2026-12", None),
        (3, "2027-02", Some("2027-01")),
        (6, "2027-05", Some("2027-04")),
    ];

    for (period, due_month, not_due_month) in cases {
        let item = plan(
            "周期项目",
            Category::FixedCommitmentExpense,
            "600",
            "CNY",
            period,
            "2026-11",
            None,
            RecognitionMode::Payment,
        );
        assert!(
            recognized_amount(&item, month(due_month), &exchange, &cny)
                .unwrap()
                .is_some()
        );
        if let Some(not_due_month) = not_due_month {
            assert_eq!(
                recognized_amount(&item, month(not_due_month), &exchange, &cny).unwrap(),
                None
            );
        }
    }

    let one_time = plan(
        "一次性支出",
        Category::DiscretionaryBudget,
        "500",
        "CNY",
        1,
        "2026-11",
        Some("2026-11"),
        RecognitionMode::Payment,
    );
    assert!(
        recognized_amount(&one_time, month("2026-11"), &exchange, &cny)
            .unwrap()
            .is_some()
    );
    assert_eq!(
        recognized_amount(&one_time, month("2026-12"), &exchange, &cny).unwrap(),
        None
    );
}

#[test]
fn conversion_validates_the_currency_pair() {
    let item = plan(
        "订阅",
        Category::FixedCommitmentExpense,
        "20",
        "USD",
        1,
        "2026-01",
        None,
        RecognitionMode::Amortized,
    );
    let wrong_rate = rate("EUR", "CNY", "7.25");
    assert_eq!(
        recognized_amount(&item, month("2026-01"), &wrong_rate, &currency("CNY")),
        Err(DomainError::CurrencyMismatch)
    );
}

#[test]
fn monthly_snapshot_copies_plan_facts_and_distinguishes_missing_from_zero_actual() {
    let id = Uuid::new_v4();
    let original = PlanItem::new(
        id,
        "旧名称",
        Category::FixedCommitmentExpense,
        amount("20"),
        currency("USD"),
        1,
        month("2026-01"),
        None,
        RecognitionMode::Payment,
        Some("生成时备注".to_owned()),
    )
    .unwrap();
    let exchange = rate("USD", "CNY", "7.25");
    let mut snapshot = create_monthly_snapshot(
        Uuid::new_v4(),
        &original,
        month("2026-01"),
        &exchange,
        &currency("CNY"),
    )
    .unwrap()
    .unwrap();
    drop(original);

    assert_eq!(snapshot.item_name(), "旧名称");
    assert_eq!(snapshot.planned_amount().decimal_string(), "145.0000");
    assert_eq!(snapshot.currency(), &currency("CNY"));
    assert_eq!(snapshot.actual_amount(), None);
    snapshot.set_actual_amount(Some(Amount::zero()));
    assert_eq!(snapshot.actual_amount(), Some(Amount::zero()));
}

#[test]
fn financial_capacity_uses_monthly_equivalents_and_excludes_variable_income_from_capacity() {
    let fixed_income = plan(
        "工资",
        Category::FixedIncome,
        "30000",
        "CNY",
        1,
        "2026-01",
        None,
        RecognitionMode::Payment,
    );
    let variable_income = plan(
        "奖金",
        Category::VariableIncome,
        "5000",
        "CNY",
        1,
        "2026-01",
        None,
        RecognitionMode::Payment,
    );
    let essential = plan(
        "生活",
        Category::EssentialExpense,
        "10000",
        "CNY",
        1,
        "2026-01",
        None,
        RecognitionMode::Amortized,
    );
    let commitment = plan(
        "年度承诺",
        Category::FixedCommitmentExpense,
        "36000",
        "CNY",
        12,
        "2026-01",
        None,
        RecognitionMode::Payment,
    );
    let discretionary = plan(
        "自主预算",
        Category::DiscretionaryBudget,
        "2000",
        "CNY",
        1,
        "2026-01",
        None,
        RecognitionMode::Amortized,
    );
    let cny_rate = rate("CNY", "CNY", "1");
    let inputs = [
        CapacityInput {
            plan_item: &fixed_income,
            exchange_rate: &cny_rate,
        },
        CapacityInput {
            plan_item: &variable_income,
            exchange_rate: &cny_rate,
        },
        CapacityInput {
            plan_item: &essential,
            exchange_rate: &cny_rate,
        },
        CapacityInput {
            plan_item: &commitment,
            exchange_rate: &cny_rate,
        },
        CapacityInput {
            plan_item: &discretionary,
            exchange_rate: &cny_rate,
        },
    ];

    let result = calculate_financial_capacity(
        month("2026-02"),
        SavingsRate::from_basis_points(2000).unwrap(),
        currency("CNY"),
        &inputs,
    )
    .unwrap();

    assert_eq!(result.stable_income().decimal_string(), "30000.0000");
    assert_eq!(result.variable_income().decimal_string(), "5000.0000");
    assert_eq!(result.essential_expenses().decimal_string(), "10000.0000");
    assert_eq!(result.fixed_commitments().decimal_string(), "3000.0000");
    assert_eq!(result.discretionary_budget().decimal_string(), "2000.0000");
    assert_eq!(result.preserved_capacity().decimal_string(), "9000.0000");
    assert_eq!(result.maximum_capacity().decimal_string(), "11000.0000");
    assert_eq!(
        result.fixed_commitment_ratio().unwrap().decimal_string(),
        "0.10000000"
    );
    assert_eq!(
        result
            .stable_income_coverage_ratio()
            .unwrap()
            .decimal_string(),
        "2.30769231"
    );
}

#[test]
fn financial_capacity_floors_negative_capacity_and_handles_zero_denominators() {
    let expense = plan(
        "必要支出",
        Category::EssentialExpense,
        "100",
        "CNY",
        1,
        "2026-01",
        None,
        RecognitionMode::Amortized,
    );
    let cny_rate = rate("CNY", "CNY", "1");
    let inputs = [CapacityInput {
        plan_item: &expense,
        exchange_rate: &cny_rate,
    }];
    let result = calculate_financial_capacity(
        month("2026-01"),
        SavingsRate::from_basis_points(0).unwrap(),
        currency("CNY"),
        &inputs,
    )
    .unwrap();

    assert_eq!(result.preserved_capacity(), Amount::zero());
    assert_eq!(result.maximum_capacity(), Amount::zero());
    assert_eq!(result.fixed_commitment_ratio(), None);
    assert_eq!(
        result
            .stable_income_coverage_ratio()
            .unwrap()
            .decimal_string(),
        "0.00000000"
    );
}
