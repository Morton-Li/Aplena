use thiserror::Error;

#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub enum DomainError {
    #[error("year-month must use YYYY-MM with a year from 1 to 9999")]
    InvalidYearMonth,
    #[error("currency code must contain exactly three ASCII letters")]
    InvalidCurrencyCode,
    #[error("amount must be a finite decimal number")]
    InvalidAmount,
    #[error("amount can have at most two decimal places")]
    AmountTooPrecise,
    #[error("amount cannot be negative")]
    NegativeAmount,
    #[error("amount is outside the supported i64 scaled range")]
    AmountOutOfRange,
    #[error("exchange rate must be greater than zero")]
    InvalidExchangeRate,
    #[error("exchange rate is outside the supported i64 scaled range")]
    ExchangeRateOutOfRange,
    #[error("ratio cannot be negative")]
    InvalidRatio,
    #[error("plan item name cannot be empty")]
    EmptyPlanItemName,
    #[error("monthly item name cannot be empty")]
    EmptyMonthlyItemName,
    #[error("category code is invalid")]
    InvalidCategory,
    #[error("flow type code is invalid")]
    InvalidFlowType,
    #[error("recognition mode code is invalid")]
    InvalidRecognitionMode,
    #[error("period must be a positive number of months")]
    InvalidPeriod,
    #[error("end month cannot be earlier than start month")]
    EndBeforeStart,
    #[error("date must use YYYY-MM-DD with a year from 1 to 9999")]
    InvalidDate,
    #[error("end date cannot be earlier than start date")]
    EndDateBeforeStart,
    #[error("actual entry amount must be greater than zero")]
    ZeroActualEntryAmount,
    #[error("actual entry date must fall inside its monthly item month")]
    ActualEntryDateOutsideMonth,
    #[error("actual entry effect is invalid")]
    InvalidActualEntryEffect,
    #[error("actual entry origin is invalid")]
    InvalidActualEntryOrigin,
    #[error("monthly item source is invalid")]
    InvalidMonthlyItemSource,
    #[error("monthly item origin is invalid")]
    InvalidMonthlyItemOrigin,
    #[error("exchange rate currency pair does not match the requested conversion")]
    CurrencyMismatch,
    #[error("all projection inputs must use the same base currency")]
    BaseCurrencyMismatch,
    #[error("base currency exchange rate must equal one")]
    InvalidBaseCurrencyRate,
    #[error("decimal arithmetic overflow")]
    ArithmeticOverflow,
}
