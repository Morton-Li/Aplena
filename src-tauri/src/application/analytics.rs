use std::cmp::Ordering;

use pfcm_domain::{
    Category, FlowType, MonthlyItem, MonthlyItemOrigin, MonthlyItemSource, SignedAmount, YearMonth,
};
use rust_decimal::{Decimal, RoundingStrategy};

use super::dto::{
    AmountComparisonDto, CategoryBreakdownDto, MonthAnalyticsDto, ProjectBreakdownDto,
};

const CATEGORIES: [Category; 5] = [
    Category::FixedIncome,
    Category::VariableIncome,
    Category::EssentialExpense,
    Category::FixedCommitmentExpense,
    Category::DiscretionaryBudget,
];

pub fn build_month_analytics(
    month: YearMonth,
    currency: &str,
    items: &[MonthlyItem],
) -> MonthAnalyticsDto {
    let planned_income = sum_planned(items, FlowType::Income);
    let planned_expense = sum_planned(items, FlowType::Expense);
    let actual_income = sum_actual(items, FlowType::Income);
    let actual_expense = sum_actual(items, FlowType::Expense);
    let recorded_count = items
        .iter()
        .filter(|item| {
            matches!(
                item.actual_data_status(),
                pfcm_domain::ActualDataStatus::ConfirmedZero | pfcm_domain::ActualDataStatus::Final
            )
        })
        .count();
    let any_actual = items.iter().any(|item| item.actual_amount().is_some());
    let total_count = items.len();
    let planned_count = items
        .iter()
        .filter(|item| item.item_source() == MonthlyItemSource::Planned)
        .count();
    let actual_status = if total_count == 0 || (!any_actual && recorded_count == 0) {
        "EMPTY"
    } else if recorded_count == total_count {
        "COMPLETE"
    } else {
        "PARTIAL"
    };
    let any_recorded = any_actual || recorded_count > 0;
    let planned_net = planned_income - planned_expense;
    let actual_net = any_recorded
        .then(|| actual_income.unwrap_or(Decimal::ZERO) - actual_expense.unwrap_or(Decimal::ZERO));
    let planned_savings_rate = savings_rate(planned_income, planned_net);
    let actual_savings_rate =
        actual_net.and_then(|net| savings_rate(actual_income.unwrap_or(Decimal::ZERO), net));
    let savings_rate_variance = actual_savings_rate
        .zip(planned_savings_rate)
        .map(|(actual, planned)| actual - planned);
    let savings_rate_plan_completion =
        actual_savings_rate
            .zip(planned_savings_rate)
            .and_then(|(actual, planned)| {
                (planned > Decimal::ZERO).then(|| actual / planned * Decimal::ONE_HUNDRED)
            });
    let categories = CATEGORIES
        .into_iter()
        .map(|category| {
            let category_items = items
                .iter()
                .filter(|item| item.category() == category)
                .collect::<Vec<_>>();
            let planned = category_items
                .iter()
                .map(|item| item.planned_amount().as_decimal())
                .sum::<Decimal>();
            let actual_values = category_items
                .iter()
                .filter_map(|item| item.actual_amount().map(SignedAmount::as_decimal))
                .collect::<Vec<_>>();
            let actual = (!actual_values.is_empty()).then(|| actual_values.into_iter().sum());
            let flow_total = match category.flow_type() {
                FlowType::Income => planned_income,
                FlowType::Expense => planned_expense,
            };
            let actual_flow_total = match category.flow_type() {
                FlowType::Income => actual_income,
                FlowType::Expense => actual_expense,
            };
            CategoryBreakdownDto {
                category: category.code().to_owned(),
                flow_type: category.flow_type().code().to_owned(),
                planned_amount: format_amount(planned),
                actual_to_date: actual.map(format_amount),
                planned_share_percent: share_percent(planned, Some(flow_total)),
                actual_share_percent: actual
                    .and_then(|actual| share_percent(actual, actual_flow_total)),
                missing_actual_count: u64::try_from(
                    category_items
                        .iter()
                        .filter(|item| {
                            !matches!(
                                item.actual_data_status(),
                                pfcm_domain::ActualDataStatus::ConfirmedZero
                                    | pfcm_domain::ActualDataStatus::Final
                            )
                        })
                        .count(),
                )
                .unwrap_or(u64::MAX),
            }
        })
        .collect();

    let mut planned_ranks = vec![0_u64; items.len()];
    let mut actual_ranks = vec![None; items.len()];
    for flow_type in [FlowType::Income, FlowType::Expense] {
        let mut planned_order = items
            .iter()
            .enumerate()
            .filter_map(|(index, item)| (item.flow_type() == flow_type).then_some(index))
            .collect::<Vec<_>>();
        planned_order.sort_by(|left, right| {
            items[*right]
                .planned_amount()
                .cmp(&items[*left].planned_amount())
                .then_with(|| items[*left].item_name().cmp(items[*right].item_name()))
        });
        for (rank, index) in planned_order.into_iter().enumerate() {
            planned_ranks[index] = u64::try_from(rank + 1).unwrap_or(u64::MAX);
        }

        let mut actual_order = items
            .iter()
            .enumerate()
            .filter(|(_, item)| item.flow_type() == flow_type)
            .filter_map(|(index, item)| item.actual_amount().map(|actual| (index, actual)))
            .collect::<Vec<_>>();
        actual_order.sort_by(|(left_index, left), (right_index, right)| {
            right.cmp(left).then_with(|| {
                items[*left_index]
                    .item_name()
                    .cmp(items[*right_index].item_name())
            })
        });
        for (rank, (index, _)) in actual_order.into_iter().enumerate() {
            actual_ranks[index] = Some(u64::try_from(rank + 1).unwrap_or(u64::MAX));
        }
    }

    let mut projects = items
        .iter()
        .enumerate()
        .map(|(index, item)| {
            let planned = item.planned_amount().as_decimal();
            let actual = item.actual_amount().map(SignedAmount::as_decimal);
            let flow_planned_total = match item.flow_type() {
                FlowType::Income => planned_income,
                FlowType::Expense => planned_expense,
            };
            let flow_actual_total = match item.flow_type() {
                FlowType::Income => actual_income,
                FlowType::Expense => actual_expense,
            };
            let variance = (item.item_origin() != MonthlyItemOrigin::Manual)
                .then(|| actual.map(|actual| actual - planned))
                .flatten();
            ProjectBreakdownDto {
                monthly_item_id: item.id().to_string(),
                name: item.item_name().to_owned(),
                category: item.category().code().to_owned(),
                flow_type: item.flow_type().code().to_owned(),
                planned_amount: format_amount(planned),
                actual_amount: actual.map(format_amount),
                variance_amount: variance.map(format_amount),
                variance_effect: variance_effect(item.flow_type(), variance).to_owned(),
                planned_share_percent: share_percent(planned, Some(flow_planned_total)),
                actual_share_percent: actual
                    .and_then(|actual| share_percent(actual, flow_actual_total)),
                planned_rank: planned_ranks[index],
                actual_rank: actual_ranks[index],
            }
        })
        .collect::<Vec<_>>();
    projects.sort_by_key(|project| project.planned_rank);
    let mut important_variances = projects
        .iter()
        .filter(|project| {
            project
                .variance_amount
                .as_deref()
                .is_some_and(|variance| variance != "0.00")
        })
        .cloned()
        .collect::<Vec<_>>();
    important_variances.sort_by(|left, right| {
        decimal_abs(&right.variance_amount)
            .partial_cmp(&decimal_abs(&left.variance_amount))
            .unwrap_or(Ordering::Equal)
            .then_with(|| left.name.cmp(&right.name))
    });
    important_variances.truncate(5);

    MonthAnalyticsDto {
        month: month.to_string(),
        currency: currency.to_owned(),
        actual_status: actual_status.to_owned(),
        total_item_count: u64::try_from(total_count).unwrap_or(u64::MAX),
        planned_item_count: u64::try_from(planned_count).unwrap_or(u64::MAX),
        recorded_item_count: u64::try_from(recorded_count).unwrap_or(u64::MAX),
        completeness_percent: (total_count > 0).then(|| {
            format_percent(
                Decimal::from(recorded_count) / Decimal::from(total_count) * Decimal::ONE_HUNDRED,
            )
        }),
        income: comparison(planned_income, actual_income, true),
        expense: comparison(planned_expense, actual_expense, false),
        net_balance: comparison(planned_net, actual_net, true),
        planned_savings_rate_percent: planned_savings_rate.map(format_percent),
        actual_savings_rate_percent: actual_savings_rate.map(format_percent),
        savings_rate_percentage_point_variance: savings_rate_variance.map(format_percent),
        savings_rate_plan_completion_percent: savings_rate_plan_completion.map(format_percent),
        categories,
        projects,
        important_variances,
    }
}

fn sum_planned(items: &[MonthlyItem], flow_type: FlowType) -> Decimal {
    items
        .iter()
        .filter(|item| item.flow_type() == flow_type)
        .map(|item| item.planned_amount().as_decimal())
        .sum()
}

fn sum_actual(items: &[MonthlyItem], flow_type: FlowType) -> Option<Decimal> {
    let values = items
        .iter()
        .filter(|item| item.flow_type() == flow_type)
        .filter_map(|item| item.actual_amount().map(SignedAmount::as_decimal))
        .collect::<Vec<_>>();
    (!values.is_empty()).then(|| values.into_iter().sum())
}

fn savings_rate(income: Decimal, net_balance: Decimal) -> Option<Decimal> {
    (!income.is_zero()).then(|| net_balance / income * Decimal::ONE_HUNDRED)
}

fn comparison(
    planned: Decimal,
    actual: Option<Decimal>,
    greater_is_favorable: bool,
) -> AmountComparisonDto {
    let variance = actual.map(|actual| actual - planned);
    let completion_percent = (planned > Decimal::ZERO)
        .then(|| actual.map(|actual| format_percent(actual / planned * Decimal::ONE_HUNDRED)))
        .flatten();
    let variance_effect = match variance {
        None => "UNKNOWN",
        Some(variance) if variance.is_zero() => "ON_PLAN",
        Some(variance)
            if (variance > Decimal::ZERO && greater_is_favorable)
                || (variance < Decimal::ZERO && !greater_is_favorable) =>
        {
            "FAVORABLE"
        }
        Some(_) => "UNFAVORABLE",
    };
    AmountComparisonDto {
        planned: format_amount(planned),
        actual_to_date: actual.map(format_amount),
        variance: variance.map(format_amount),
        completion_percent,
        variance_effect: variance_effect.to_owned(),
    }
}

fn share_percent(value: Decimal, total: Option<Decimal>) -> Option<String> {
    total
        .filter(|total| !total.is_zero())
        .map(|total| format_percent(value / total * Decimal::ONE_HUNDRED))
}

fn variance_effect(flow_type: FlowType, variance: Option<Decimal>) -> &'static str {
    match variance {
        None => "UNKNOWN",
        Some(variance) if variance.is_zero() => "ON_PLAN",
        Some(variance) if flow_type == FlowType::Income && variance > Decimal::ZERO => "FAVORABLE",
        Some(variance) if flow_type == FlowType::Expense && variance < Decimal::ZERO => "FAVORABLE",
        Some(_) => "UNFAVORABLE",
    }
}

fn decimal_abs(value: &Option<String>) -> Decimal {
    value
        .as_deref()
        .and_then(|value| value.parse::<Decimal>().ok())
        .map(|value| value.abs())
        .unwrap_or(Decimal::ZERO)
}

fn format_amount(value: Decimal) -> String {
    format_decimal(value, 2)
}

fn format_percent(value: Decimal) -> String {
    format_decimal(value, 2)
}

fn format_decimal(mut value: Decimal, scale: u32) -> String {
    value = value.round_dp_with_strategy(scale, RoundingStrategy::MidpointAwayFromZero);
    value.rescale(scale);
    value.to_string()
}

#[cfg(test)]
mod tests {
    use pfcm_domain::{
        CurrencyCode, MonthlyItem, MonthlyItemOrigin, MonthlyItemSource, RecognitionMode,
        SignedAmount,
    };
    use uuid::Uuid;

    use super::*;

    fn item(name: &str, category: Category, planned: &str, actual: Option<&str>) -> MonthlyItem {
        MonthlyItem::rehydrate(
            Uuid::new_v4(),
            Some(Uuid::new_v4()),
            name.to_owned(),
            YearMonth::new(2026, 6).unwrap(),
            category,
            category.flow_type(),
            RecognitionMode::Amortized,
            MonthlyItemSource::Planned,
            MonthlyItemOrigin::PlanLinked,
            None,
            planned.parse().unwrap(),
            actual.map(|value| SignedAmount::from_decimal(value.parse().unwrap()).unwrap()),
            u64::from(actual.is_some()),
            actual.map(|_| "2026-07-01T00:00:00Z".to_owned()),
            CurrencyCode::new("CNY").unwrap(),
            None,
        )
    }

    #[test]
    fn aggregates_income_expense_savings_completeness_and_variance_semantics() {
        let items = vec![
            item("工资", Category::FixedIncome, "10000", Some("11000")),
            item("奖金", Category::VariableIncome, "1000", None),
            item("房租", Category::EssentialExpense, "3000", Some("3200")),
            item("订阅", Category::FixedCommitmentExpense, "500", Some("400")),
        ];
        let analytics = build_month_analytics(YearMonth::new(2026, 6).unwrap(), "CNY", &items);

        assert_eq!(analytics.income.planned, "11000.00");
        assert_eq!(analytics.income.actual_to_date.as_deref(), Some("11000.00"));
        assert_eq!(
            analytics.income.completion_percent.as_deref(),
            Some("100.00")
        );
        assert_eq!(analytics.expense.planned, "3500.00");
        assert_eq!(analytics.expense.actual_to_date.as_deref(), Some("3600.00"));
        assert_eq!(analytics.net_balance.planned, "7500.00");
        assert_eq!(
            analytics.net_balance.actual_to_date.as_deref(),
            Some("7400.00")
        );
        assert_eq!(
            analytics.planned_savings_rate_percent.as_deref(),
            Some("68.18")
        );
        assert_eq!(analytics.actual_status, "PARTIAL");
        assert_eq!(analytics.completeness_percent.as_deref(), Some("75.00"));
        assert_eq!(analytics.important_variances[0].name, "工资");
        assert_eq!(
            analytics.important_variances[0].variance_effect,
            "FAVORABLE"
        );
        assert_eq!(
            analytics
                .important_variances
                .iter()
                .find(|item| item.name == "房租")
                .unwrap()
                .variance_effect,
            "UNFAVORABLE"
        );
        assert_eq!(analytics.projects[0].name, "工资");
        assert_eq!(analytics.projects[0].planned_rank, 1);
        assert_eq!(analytics.projects[0].actual_rank, Some(1));
        let bonus = analytics
            .projects
            .iter()
            .find(|project| project.name == "奖金")
            .unwrap();
        assert_eq!(bonus.actual_rank, None);
        assert_eq!(bonus.actual_share_percent, None);
        let variable_income = analytics
            .categories
            .iter()
            .find(|category| category.category == "VARIABLE_INCOME")
            .unwrap();
        assert_eq!(variable_income.actual_to_date, None);
        assert_eq!(variable_income.actual_share_percent, None);
        let rent = analytics
            .projects
            .iter()
            .find(|project| project.name == "房租")
            .unwrap();
        assert_eq!(rent.planned_rank, 1);
        assert_eq!(rent.actual_rank, Some(1));
    }

    #[test]
    fn handles_zero_income_zero_plan_and_empty_month_without_invalid_ratios() {
        let zero_plan = vec![item(
            "零预算",
            Category::DiscretionaryBudget,
            "0",
            Some("0"),
        )];
        let analytics = build_month_analytics(YearMonth::new(2026, 6).unwrap(), "CNY", &zero_plan);
        assert_eq!(analytics.actual_status, "COMPLETE");
        assert_eq!(analytics.planned_savings_rate_percent, None);
        assert_eq!(analytics.actual_savings_rate_percent, None);
        assert_eq!(analytics.projects[0].planned_share_percent, None);
        assert_eq!(analytics.projects[0].actual_share_percent, None);
        assert_eq!(analytics.income.completion_percent, None);

        let empty = build_month_analytics(YearMonth::new(2026, 7).unwrap(), "CNY", &[]);
        assert_eq!(empty.actual_status, "EMPTY");
        assert_eq!(empty.completeness_percent, None);
        assert!(empty.projects.is_empty());

        let missing_actual = vec![item("未录入", Category::FixedIncome, "100", None)];
        let no_actuals =
            build_month_analytics(YearMonth::new(2026, 8).unwrap(), "CNY", &missing_actual);
        assert_eq!(no_actuals.actual_status, "EMPTY");
        assert_eq!(no_actuals.completeness_percent.as_deref(), Some("0.00"));
        assert_eq!(no_actuals.income.actual_to_date, None);
    }

    #[test]
    fn manual_items_contribute_actuals_without_creating_plan_variances() {
        let manual = MonthlyItem::rehydrate(
            Uuid::new_v4(),
            None,
            "本月房租".to_owned(),
            YearMonth::new(2026, 6).unwrap(),
            Category::EssentialExpense,
            FlowType::Expense,
            RecognitionMode::Amortized,
            MonthlyItemSource::ActualOnly,
            MonthlyItemOrigin::Manual,
            None,
            "0".parse().unwrap(),
            Some(SignedAmount::from_decimal("3200".parse().unwrap()).unwrap()),
            1,
            Some("2026-07-01T00:00:00Z".to_owned()),
            CurrencyCode::new("CNY").unwrap(),
            None,
        );
        let analytics = build_month_analytics(YearMonth::new(2026, 6).unwrap(), "CNY", &[manual]);

        assert_eq!(analytics.planned_item_count, 0);
        assert_eq!(analytics.expense.actual_to_date.as_deref(), Some("3200.00"));
        assert_eq!(analytics.projects[0].variance_amount, None);
        assert_eq!(analytics.projects[0].variance_effect, "UNKNOWN");
        assert!(analytics.important_variances.is_empty());
    }
}
