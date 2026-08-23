use std::{fmt, str::FromStr};

use rust_decimal::{Decimal, RoundingStrategy};
use serde::{Deserialize, Deserializer, Serialize, Serializer, de};

use crate::{CurrencyCode, DomainError};

const AMOUNT_SCALE: u32 = 2;
const RATE_SCALE: u32 = 8;

fn rounded(mut value: Decimal, scale: u32) -> Result<Decimal, DomainError> {
    value = value.round_dp_with_strategy(scale, RoundingStrategy::MidpointAwayFromZero);
    value.rescale(scale);
    Ok(value)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub struct Amount(Decimal);

impl Amount {
    pub fn from_decimal(value: Decimal) -> Result<Self, DomainError> {
        if value.is_sign_negative() {
            return Err(DomainError::NegativeAmount);
        }

        let value = rounded(value, AMOUNT_SCALE)?;
        i64::try_from(value.mantissa()).map_err(|_| DomainError::AmountOutOfRange)?;
        Ok(Self(value))
    }

    pub fn zero() -> Self {
        Self(Decimal::new(0, AMOUNT_SCALE))
    }

    pub fn from_scaled_i64(value: i64) -> Result<Self, DomainError> {
        if value < 0 {
            return Err(DomainError::NegativeAmount);
        }
        Self::from_decimal(Decimal::new(value, AMOUNT_SCALE))
    }

    pub const fn as_decimal(self) -> Decimal {
        self.0
    }

    pub fn scaled_i64(self) -> i64 {
        i64::try_from(self.0.mantissa()).expect("Amount invariant guarantees i64 range")
    }

    pub fn checked_add(self, other: Self) -> Result<Self, DomainError> {
        let sum = self
            .0
            .checked_add(other.0)
            .ok_or(DomainError::ArithmeticOverflow)?;
        Self::from_decimal(sum)
    }

    pub fn decimal_string(self) -> String {
        format!("{:.2}", self.0)
    }
}

impl fmt::Display for Amount {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.decimal_string())
    }
}

impl FromStr for Amount {
    type Err = DomainError;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        let parsed =
            Decimal::from_str_exact(value.trim()).map_err(|_| DomainError::InvalidAmount)?;
        if parsed.scale() > AMOUNT_SCALE {
            return Err(DomainError::AmountTooPrecise);
        }
        Self::from_decimal(parsed)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub struct SignedAmount(Decimal);

impl SignedAmount {
    pub fn zero() -> Self {
        Self(Decimal::new(0, AMOUNT_SCALE))
    }

    pub fn from_decimal(value: Decimal) -> Result<Self, DomainError> {
        let value = rounded(value, AMOUNT_SCALE)?;
        i64::try_from(value.mantissa()).map_err(|_| DomainError::AmountOutOfRange)?;
        Ok(Self(value))
    }

    pub fn from_scaled_i64(value: i64) -> Result<Self, DomainError> {
        Self::from_decimal(Decimal::new(value, AMOUNT_SCALE))
    }

    pub const fn as_decimal(self) -> Decimal {
        self.0
    }

    pub fn scaled_i64(self) -> i64 {
        i64::try_from(self.0.mantissa()).expect("SignedAmount invariant guarantees i64 range")
    }

    pub fn checked_add(self, other: Self) -> Result<Self, DomainError> {
        Self::from_decimal(
            self.0
                .checked_add(other.0)
                .ok_or(DomainError::ArithmeticOverflow)?,
        )
    }

    pub fn decimal_string(self) -> String {
        format!("{:.2}", self.0)
    }
}

impl From<Amount> for SignedAmount {
    fn from(value: Amount) -> Self {
        Self(value.as_decimal())
    }
}

impl Serialize for Amount {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(&self.decimal_string())
    }
}

impl<'de> Deserialize<'de> for Amount {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        value.parse().map_err(de::Error::custom)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExchangeRate {
    source_currency: CurrencyCode,
    base_currency: CurrencyCode,
    value: Decimal,
}

impl ExchangeRate {
    pub fn new(
        source_currency: CurrencyCode,
        base_currency: CurrencyCode,
        value: Decimal,
    ) -> Result<Self, DomainError> {
        if value <= Decimal::ZERO {
            return Err(DomainError::InvalidExchangeRate);
        }

        let value = rounded(value, RATE_SCALE)?;
        if value <= Decimal::ZERO {
            return Err(DomainError::InvalidExchangeRate);
        }
        i64::try_from(value.mantissa()).map_err(|_| DomainError::ExchangeRateOutOfRange)?;
        if source_currency == base_currency && value != Decimal::ONE {
            return Err(DomainError::InvalidBaseCurrencyRate);
        }

        Ok(Self {
            source_currency,
            base_currency,
            value,
        })
    }

    pub fn from_str(
        source_currency: CurrencyCode,
        base_currency: CurrencyCode,
        value: &str,
    ) -> Result<Self, DomainError> {
        let value =
            Decimal::from_str_exact(value.trim()).map_err(|_| DomainError::InvalidExchangeRate)?;
        Self::new(source_currency, base_currency, value)
    }

    pub fn source_currency(&self) -> &CurrencyCode {
        &self.source_currency
    }

    pub fn base_currency(&self) -> &CurrencyCode {
        &self.base_currency
    }

    pub const fn value(&self) -> Decimal {
        self.value
    }

    pub fn decimal_string(&self) -> String {
        format!("{:.8}", self.value)
    }

    pub fn scaled_i64(&self) -> i64 {
        i64::try_from(self.value.mantissa()).expect("ExchangeRate invariant guarantees i64 range")
    }

    pub fn from_scaled_i64(
        source_currency: CurrencyCode,
        base_currency: CurrencyCode,
        value: i64,
    ) -> Result<Self, DomainError> {
        Self::new(
            source_currency,
            base_currency,
            Decimal::new(value, RATE_SCALE),
        )
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub struct SavingsRate(u16);

impl SavingsRate {
    pub fn from_basis_points(value: u16) -> Result<Self, DomainError> {
        if value > 10_000 {
            return Err(DomainError::InvalidSavingsRate);
        }
        Ok(Self(value))
    }

    pub const fn basis_points(self) -> u16 {
        self.0
    }

    pub fn factor(self) -> Decimal {
        Decimal::from(self.0) / Decimal::from(10_000_u16)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub struct Ratio(Decimal);

impl Ratio {
    pub fn from_decimal(value: Decimal) -> Result<Self, DomainError> {
        if value.is_sign_negative() {
            return Err(DomainError::InvalidRatio);
        }
        Ok(Self(rounded(value, RATE_SCALE)?))
    }

    pub const fn as_decimal(self) -> Decimal {
        self.0
    }

    pub fn decimal_string(self) -> String {
        format!("{:.8}", self.0)
    }
}
