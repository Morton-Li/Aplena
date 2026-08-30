use crate::{CurrencyCode, DomainError};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Settings {
    base_currency: CurrencyCode,
}

impl Settings {
    pub fn new(base_currency: CurrencyCode) -> Result<Self, DomainError> {
        Ok(Self { base_currency })
    }

    pub fn base_currency(&self) -> &CurrencyCode {
        &self.base_currency
    }
}
