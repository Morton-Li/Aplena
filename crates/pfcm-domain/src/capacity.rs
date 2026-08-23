use rust_decimal::Decimal;

use crate::{
    Amount, Category, CurrencyCode, DomainError, ExchangeRate, PlanItem, Ratio, SavingsRate,
    YearMonth, monthly_equivalent,
};

#[derive(Debug, Clone, Copy)]
pub struct CapacityInput<'a> {
    pub plan_item: &'a PlanItem,
    pub exchange_rate: &'a ExchangeRate,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FinancialCapacity {
    base_currency: CurrencyCode,
    stable_income: Amount,
    variable_income: Amount,
    essential_expenses: Amount,
    fixed_commitments: Amount,
    discretionary_budget: Amount,
    preserved_capacity: Amount,
    maximum_capacity: Amount,
    fixed_commitment_ratio: Option<Ratio>,
    stable_income_coverage_ratio: Option<Ratio>,
}

impl FinancialCapacity {
    pub fn base_currency(&self) -> &CurrencyCode {
        &self.base_currency
    }

    pub const fn stable_income(&self) -> Amount {
        self.stable_income
    }

    pub const fn variable_income(&self) -> Amount {
        self.variable_income
    }

    pub const fn essential_expenses(&self) -> Amount {
        self.essential_expenses
    }

    pub const fn fixed_commitments(&self) -> Amount {
        self.fixed_commitments
    }

    pub const fn discretionary_budget(&self) -> Amount {
        self.discretionary_budget
    }

    pub const fn preserved_capacity(&self) -> Amount {
        self.preserved_capacity
    }

    pub const fn maximum_capacity(&self) -> Amount {
        self.maximum_capacity
    }

    pub const fn fixed_commitment_ratio(&self) -> Option<Ratio> {
        self.fixed_commitment_ratio
    }

    pub const fn stable_income_coverage_ratio(&self) -> Option<Ratio> {
        self.stable_income_coverage_ratio
    }
}

pub fn calculate_financial_capacity(
    month: YearMonth,
    target_savings_rate: SavingsRate,
    base_currency: CurrencyCode,
    inputs: &[CapacityInput<'_>],
) -> Result<FinancialCapacity, DomainError> {
    let mut stable_income = Amount::zero();
    let mut variable_income = Amount::zero();
    let mut essential_expenses = Amount::zero();
    let mut fixed_commitments = Amount::zero();
    let mut discretionary_budget = Amount::zero();

    for input in inputs {
        if input.exchange_rate.base_currency() != &base_currency {
            return Err(DomainError::BaseCurrencyMismatch);
        }
        let Some(amount) =
            monthly_equivalent(input.plan_item, month, input.exchange_rate, &base_currency)?
        else {
            continue;
        };

        match input.plan_item.category() {
            Category::FixedIncome => stable_income = stable_income.checked_add(amount)?,
            Category::VariableIncome => variable_income = variable_income.checked_add(amount)?,
            Category::EssentialExpense => {
                essential_expenses = essential_expenses.checked_add(amount)?
            }
            Category::FixedCommitmentExpense => {
                fixed_commitments = fixed_commitments.checked_add(amount)?
            }
            Category::DiscretionaryBudget => {
                discretionary_budget = discretionary_budget.checked_add(amount)?
            }
        }
    }

    let retained_income = stable_income
        .as_decimal()
        .checked_mul(Decimal::ONE - target_savings_rate.factor())
        .ok_or(DomainError::ArithmeticOverflow)?;
    let preserved_capacity = non_negative_difference(
        retained_income,
        &[
            essential_expenses.as_decimal(),
            fixed_commitments.as_decimal(),
            discretionary_budget.as_decimal(),
        ],
    )?;
    let maximum_capacity = non_negative_difference(
        retained_income,
        &[
            essential_expenses.as_decimal(),
            fixed_commitments.as_decimal(),
        ],
    )?;

    let fixed_commitment_ratio = ratio(fixed_commitments.as_decimal(), stable_income.as_decimal())?;
    let committed_costs = essential_expenses
        .as_decimal()
        .checked_add(fixed_commitments.as_decimal())
        .ok_or(DomainError::ArithmeticOverflow)?;
    let stable_income_coverage_ratio = ratio(stable_income.as_decimal(), committed_costs)?;

    Ok(FinancialCapacity {
        base_currency,
        stable_income,
        variable_income,
        essential_expenses,
        fixed_commitments,
        discretionary_budget,
        preserved_capacity,
        maximum_capacity,
        fixed_commitment_ratio,
        stable_income_coverage_ratio,
    })
}

fn non_negative_difference(value: Decimal, deductions: &[Decimal]) -> Result<Amount, DomainError> {
    let remaining = deductions.iter().try_fold(value, |current, deduction| {
        current
            .checked_sub(*deduction)
            .ok_or(DomainError::ArithmeticOverflow)
    })?;
    Amount::from_decimal(remaining.max(Decimal::ZERO))
}

fn ratio(numerator: Decimal, denominator: Decimal) -> Result<Option<Ratio>, DomainError> {
    if denominator.is_zero() {
        return Ok(None);
    }
    let value = numerator
        .checked_div(denominator)
        .ok_or(DomainError::ArithmeticOverflow)?;
    Ratio::from_decimal(value).map(Some)
}
