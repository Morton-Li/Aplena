use std::collections::BTreeMap;

use pfcm_domain::DomainError;
use serde::Serialize;

use crate::infrastructure::StoreError;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct AppError {
    pub error_code: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub field: Option<String>,
    pub message_key: String,
    #[serde(skip_serializing_if = "BTreeMap::is_empty")]
    pub params: BTreeMap<String, String>,
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
            params: BTreeMap::new(),
        }
    }

    pub fn business(error_code: impl Into<String>, message_key: impl Into<String>) -> Self {
        Self {
            error_code: error_code.into(),
            field: None,
            message_key: message_key.into(),
            params: BTreeMap::new(),
        }
    }

    pub fn with_param(mut self, key: impl Into<String>, value: impl Into<String>) -> Self {
        self.params.insert(key.into(), value.into());
        self
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
            DomainError::ExchangeRateOutOfRange => (
                "EXCHANGE_RATE_OUT_OF_RANGE",
                "error.exchange_rate_out_of_range",
            ),
            DomainError::InvalidSavingsRate => {
                ("INVALID_SAVINGS_RATE", "error.invalid_savings_rate")
            }
            DomainError::InvalidRatio => ("INVALID_RATIO", "error.invalid_ratio"),
            DomainError::EmptyPlanItemName => {
                ("EMPTY_PLAN_ITEM_NAME", "error.empty_plan_item_name")
            }
            DomainError::InvalidCategory => ("INVALID_CATEGORY", "error.invalid_category"),
            DomainError::InvalidFlowType => ("INVALID_FLOW_TYPE", "error.invalid_flow_type"),
            DomainError::InvalidRecognitionMode => {
                ("INVALID_RECOGNITION_MODE", "error.invalid_recognition_mode")
            }
            DomainError::InvalidPeriod => ("INVALID_PERIOD", "error.invalid_period"),
            DomainError::EndBeforeStart => ("END_BEFORE_START", "error.end_before_start"),
            DomainError::CurrencyMismatch => ("CURRENCY_MISMATCH", "error.currency_mismatch"),
            DomainError::BaseCurrencyMismatch => {
                ("BASE_CURRENCY_MISMATCH", "error.base_currency_mismatch")
            }
            DomainError::InvalidBaseCurrencyRate => (
                "INVALID_BASE_CURRENCY_RATE",
                "error.invalid_base_currency_rate",
            ),
            DomainError::ArithmeticOverflow => ("ARITHMETIC_OVERFLOW", "error.arithmetic_overflow"),
        };

        Self {
            error_code: error_code.to_owned(),
            field: field.map(str::to_owned),
            message_key: message_key.to_owned(),
            params: BTreeMap::new(),
        }
    }

    pub fn from_store(error: StoreError) -> Self {
        match error {
            StoreError::Domain(error) => Self::from_domain(error, None),
            StoreError::InvalidUuid => {
                Self::business("INVALID_PERSISTED_UUID", "error.invalid_persisted_uuid")
            }
            StoreError::Migration(_) => Self::business(
                "DATABASE_MIGRATION_FAILED",
                "error.database_migration_failed",
            ),
            StoreError::Database(sqlx::Error::RowNotFound) => {
                Self::business("NOT_FOUND", "error.not_found")
            }
            StoreError::Database(sqlx::Error::Database(error)) => {
                let message = error.message();
                if message.contains("plan_items.name") {
                    Self::validation(
                        "DUPLICATE_PLAN_ITEM_NAME",
                        "name",
                        "error.duplicate_plan_item_name",
                    )
                } else if message.contains("APLENA_BASE_CURRENCY_LOCKED") {
                    Self::business("BASE_CURRENCY_LOCKED", "error.base_currency_locked")
                } else if message.contains("APLENA_BASE_RATE_MUST_EQUAL_ONE") {
                    Self::validation(
                        "INVALID_BASE_CURRENCY_RATE",
                        "rate",
                        "error.invalid_base_currency_rate",
                    )
                } else if message.contains("FOREIGN KEY constraint failed") {
                    Self::business("RECORD_IS_REFERENCED", "error.record_is_referenced")
                } else {
                    Self::business(
                        "DATABASE_CONSTRAINT_FAILED",
                        "error.database_constraint_failed",
                    )
                }
            }
            StoreError::Database(_) => Self::business(
                "DATABASE_OPERATION_FAILED",
                "error.database_operation_failed",
            ),
        }
    }
}

impl From<StoreError> for AppError {
    fn from(error: StoreError) -> Self {
        Self::from_store(error)
    }
}

impl std::fmt::Display for AppError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.error_code)
    }
}

impl std::error::Error for AppError {}
