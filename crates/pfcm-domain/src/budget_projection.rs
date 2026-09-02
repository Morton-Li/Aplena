use crate::{
    Amount, Category, CurrencyCode, DomainError, ExchangeRate, PlanItem, Ratio, SignedAmount,
    SignedRatio, YearMonth, monthly_equivalent,
};

#[derive(Debug, Clone, Copy)]
pub struct ProjectionInput<'a> {
    pub plan_item: &'a PlanItem,
    pub exchange_rate: &'a ExchangeRate,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BudgetProjection {
    base_currency: CurrencyCode,
    stable_income: Amount,
    variable_income: Amount,
    essential_expenses: Amount,
    fixed_commitments: Amount,
    discretionary_budget: Amount,
    projected_income: Amount,
    projected_expenses: Amount,
    projected_savings: SignedAmount,
    projected_savings_rate: Option<SignedRatio>,
    fixed_commitment_ratio: Option<Ratio>,
    stable_income_coverage_ratio: Option<Ratio>,
}

impl BudgetProjection {
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

    pub const fn projected_income(&self) -> Amount {
        self.projected_income
    }

    pub const fn projected_expenses(&self) -> Amount {
        self.projected_expenses
    }

    pub const fn projected_savings(&self) -> SignedAmount {
        self.projected_savings
    }

    pub const fn projected_savings_rate(&self) -> Option<SignedRatio> {
        self.projected_savings_rate
    }

    pub const fn fixed_commitment_ratio(&self) -> Option<Ratio> {
        self.fixed_commitment_ratio
    }

    pub const fn stable_income_coverage_ratio(&self) -> Option<Ratio> {
        self.stable_income_coverage_ratio
    }
}

pub fn calculate_budget_projection(
    month: YearMonth,
    base_currency: CurrencyCode,
    inputs: &[ProjectionInput<'_>],
) -> Result<BudgetProjection, DomainError> {
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

    let projected_income = stable_income.checked_add(variable_income)?;
    let projected_expenses = essential_expenses
        .checked_add(fixed_commitments)?
        .checked_add(discretionary_budget)?;
    let projected_savings = SignedAmount::from_decimal(
        projected_income
            .as_decimal()
            .checked_sub(projected_expenses.as_decimal())
            .ok_or(DomainError::ArithmeticOverflow)?,
    )?;
    let projected_savings_rate = signed_ratio(
        projected_savings.as_decimal(),
        projected_income.as_decimal(),
    )?;
    let fixed_commitment_ratio = ratio(fixed_commitments.as_decimal(), stable_income.as_decimal())?;
    let committed_costs = essential_expenses
        .as_decimal()
        .checked_add(fixed_commitments.as_decimal())
        .ok_or(DomainError::ArithmeticOverflow)?;
    let stable_income_coverage_ratio = ratio(stable_income.as_decimal(), committed_costs)?;

    Ok(BudgetProjection {
        base_currency,
        stable_income,
        variable_income,
        essential_expenses,
        fixed_commitments,
        discretionary_budget,
        projected_income,
        projected_expenses,
        projected_savings,
        projected_savings_rate,
        fixed_commitment_ratio,
        stable_income_coverage_ratio,
    })
}

fn ratio(
    numerator: rust_decimal::Decimal,
    denominator: rust_decimal::Decimal,
) -> Result<Option<Ratio>, DomainError> {
    if denominator.is_zero() {
        return Ok(None);
    }
    numerator
        .checked_div(denominator)
        .ok_or(DomainError::ArithmeticOverflow)
        .and_then(Ratio::from_decimal)
        .map(Some)
}

fn signed_ratio(
    numerator: rust_decimal::Decimal,
    denominator: rust_decimal::Decimal,
) -> Result<Option<SignedRatio>, DomainError> {
    if denominator.is_zero() {
        return Ok(None);
    }
    numerator
        .checked_div(denominator)
        .ok_or(DomainError::ArithmeticOverflow)
        .and_then(SignedRatio::from_decimal)
        .map(Some)
}
