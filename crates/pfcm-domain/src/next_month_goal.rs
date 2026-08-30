use crate::{DomainError, SavingsRate, YearMonth};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NextMonthGoal {
    target_month: YearMonth,
    minimum_savings_rate: SavingsRate,
}

impl NextMonthGoal {
    pub fn new(
        target_month: YearMonth,
        minimum_savings_rate_basis_points: u16,
    ) -> Result<Self, DomainError> {
        Ok(Self {
            target_month,
            minimum_savings_rate: SavingsRate::from_basis_points(
                minimum_savings_rate_basis_points,
            )?,
        })
    }

    pub const fn target_month(&self) -> YearMonth {
        self.target_month
    }

    pub const fn minimum_savings_rate(&self) -> SavingsRate {
        self.minimum_savings_rate
    }
}
