use crate::{CurrencyCode, DomainError, SavingsRate, YearMonth};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Settings {
    target_month: YearMonth,
    base_currency: CurrencyCode,
    minimum_savings_rate: SavingsRate,
}

impl Settings {
    pub fn new(
        target_month: YearMonth,
        base_currency: CurrencyCode,
        minimum_savings_rate_basis_points: u16,
    ) -> Result<Self, DomainError> {
        Ok(Self {
            target_month,
            base_currency,
            minimum_savings_rate: SavingsRate::from_basis_points(
                minimum_savings_rate_basis_points,
            )?,
        })
    }

    pub const fn target_month(&self) -> YearMonth {
        self.target_month
    }

    pub fn base_currency(&self) -> &CurrencyCode {
        &self.base_currency
    }

    pub const fn minimum_savings_rate(&self) -> SavingsRate {
        self.minimum_savings_rate
    }
}
