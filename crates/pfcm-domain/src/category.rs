use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum Category {
    FixedIncome,
    VariableIncome,
    EssentialExpense,
    FixedCommitment,
    DiscretionaryBudget,
}

impl Category {
    pub const ALL: [Self; 5] = [
        Self::FixedIncome,
        Self::VariableIncome,
        Self::EssentialExpense,
        Self::FixedCommitment,
        Self::DiscretionaryBudget,
    ];

    pub const fn flow_type(self) -> FlowType {
        match self {
            Self::FixedIncome | Self::VariableIncome => FlowType::Income,
            Self::EssentialExpense | Self::FixedCommitment | Self::DiscretionaryBudget => {
                FlowType::Expense
            }
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
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum RecognitionMode {
    Amortized,
    Payment,
}

impl RecognitionMode {
    pub const ALL: [Self; 2] = [Self::Amortized, Self::Payment];
}
