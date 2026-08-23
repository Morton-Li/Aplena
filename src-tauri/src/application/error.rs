use pfcm_domain::DomainError;
use serde::Serialize;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct AppError {
    pub error_code: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub field: Option<String>,
    pub message_key: String,
}

impl AppError {
    pub fn validation(
        error_code: impl Into<String>,
        field: impl Into<String>,
        message_key: impl Into<String>,
    ) -> Self {
        Self {
            error_code: error_code.into(),
            field: Some(field.into()),
            message_key: message_key.into(),
        }
    }

    pub fn from_domain(error: DomainError, field: Option<&str>) -> Self {
        let (error_code, message_key) = match error {
            DomainError::InvalidYearMonth => ("INVALID_YEAR_MONTH", "error.invalid_year_month"),
            DomainError::InvalidCurrencyCode => {
                ("INVALID_CURRENCY_CODE", "error.invalid_currency_code")
            }
            DomainError::InvalidAmount => ("INVALID_AMOUNT", "error.invalid_amount"),
            DomainError::NegativeAmount => ("NEGATIVE_AMOUNT", "error.negative_amount"),
            DomainError::AmountOutOfRange => ("AMOUNT_OUT_OF_RANGE", "error.amount_out_of_range"),
            DomainError::InvalidExchangeRate => {
                ("INVALID_EXCHANGE_RATE", "error.invalid_exchange_rate")
            }
            DomainError::InvalidSavingsRate => {
                ("INVALID_SAVINGS_RATE", "error.invalid_savings_rate")
            }
            DomainError::InvalidRatio => ("INVALID_RATIO", "error.invalid_ratio"),
            DomainError::EmptyPlanItemName => {
                ("EMPTY_PLAN_ITEM_NAME", "error.empty_plan_item_name")
            }
            DomainError::InvalidPeriod => ("INVALID_PERIOD", "error.invalid_period"),
            DomainError::EndBeforeStart => ("END_BEFORE_START", "error.end_before_start"),
            DomainError::CurrencyMismatch => ("CURRENCY_MISMATCH", "error.currency_mismatch"),
            DomainError::BaseCurrencyMismatch => {
                ("BASE_CURRENCY_MISMATCH", "error.base_currency_mismatch")
            }
            DomainError::ArithmeticOverflow => ("ARITHMETIC_OVERFLOW", "error.arithmetic_overflow"),
        };

        Self {
            error_code: error_code.to_owned(),
            field: field.map(str::to_owned),
            message_key: message_key.to_owned(),
        }
    }
}
