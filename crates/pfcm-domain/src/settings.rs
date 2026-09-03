use crate::{CurrencyCode, DomainError};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Settings {
    base_currency: CurrencyCode,
    auto_update_exchange_rates: bool,
}

impl Settings {
    pub fn new(base_currency: CurrencyCode) -> Result<Self, DomainError> {
        Self::with_auto_update_exchange_rates(base_currency, false)
    }

    pub fn with_auto_update_exchange_rates(
        base_currency: CurrencyCode,
        auto_update_exchange_rates: bool,
    ) -> Result<Self, DomainError> {
        Ok(Self {
            base_currency,
            auto_update_exchange_rates,
        })
    }

    pub fn base_currency(&self) -> &CurrencyCode {
        &self.base_currency
    }

    pub fn auto_update_exchange_rates(&self) -> bool {
        self.auto_update_exchange_rates
    }
}
