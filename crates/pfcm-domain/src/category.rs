use std::{fmt, str::FromStr};

use serde::{Deserialize, Serialize};

use crate::DomainError;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum Category {
    #[serde(rename = "FIXED_INCOME")]
    FixedIncome,
    #[serde(rename = "VARIABLE_INCOME")]
    VariableIncome,
    #[serde(rename = "ESSENTIAL_EXPENSE")]
    EssentialExpense,
    #[serde(rename = "FIXED_COMMITMENT_EXPENSE")]
    FixedCommitmentExpense,
    #[serde(rename = "DISCRETIONARY_BUDGET")]
    DiscretionaryBudget,
}

impl Category {
    pub const ALL: [Self; 5] = [
        Self::FixedIncome,
        Self::VariableIncome,
        Self::EssentialExpense,
        Self::FixedCommitmentExpense,
        Self::DiscretionaryBudget,
    ];

    pub const fn flow_type(self) -> FlowType {
        match self {
            Self::FixedIncome | Self::VariableIncome => FlowType::Income,
            Self::EssentialExpense | Self::FixedCommitmentExpense | Self::DiscretionaryBudget => {
                FlowType::Expense
            }
        }
    }

    pub const fn code(self) -> &'static str {
        match self {
            Self::FixedIncome => "FIXED_INCOME",
            Self::VariableIncome => "VARIABLE_INCOME",
            Self::EssentialExpense => "ESSENTIAL_EXPENSE",
            Self::FixedCommitmentExpense => "FIXED_COMMITMENT_EXPENSE",
            Self::DiscretionaryBudget => "DISCRETIONARY_BUDGET",
        }
    }
}

impl fmt::Display for Category {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.code())
    }
}

impl FromStr for Category {
    type Err = DomainError;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value {
            "FIXED_INCOME" => Ok(Self::FixedIncome),
            "VARIABLE_INCOME" => Ok(Self::VariableIncome),
            "ESSENTIAL_EXPENSE" => Ok(Self::EssentialExpense),
            "FIXED_COMMITMENT_EXPENSE" => Ok(Self::FixedCommitmentExpense),
            "DISCRETIONARY_BUDGET" => Ok(Self::DiscretionaryBudget),
            _ => Err(DomainError::InvalidCategory),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum FlowType {
    Income,
    Expense,
}

impl FlowType {
    pub const ALL: [Self; 2] = [Self::Income, Self::Expense];

    pub const fn code(self) -> &'static str {
        match self {
            Self::Income => "INCOME",
            Self::Expense => "EXPENSE",
        }
    }
}

impl FromStr for FlowType {
    type Err = DomainError;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value {
            "INCOME" => Ok(Self::Income),
            "EXPENSE" => Ok(Self::Expense),
            _ => Err(DomainError::InvalidFlowType),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum RecognitionMode {
    Amortized,
    Payment,
}

impl RecognitionMode {
    pub const ALL: [Self; 2] = [Self::Amortized, Self::Payment];

    pub const fn code(self) -> &'static str {
        match self {
            Self::Amortized => "AMORTIZED",
            Self::Payment => "PAYMENT",
        }
    }
}

impl FromStr for RecognitionMode {
    type Err = DomainError;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value {
            "AMORTIZED" => Ok(Self::Amortized),
            "PAYMENT" => Ok(Self::Payment),
            _ => Err(DomainError::InvalidRecognitionMode),
        }
    }
}
