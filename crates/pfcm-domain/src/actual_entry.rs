use std::str::FromStr;

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{Amount, CalendarDate, DomainError, SignedAmount, YearMonth};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ActualEntryEffect {
    Increase,
    Decrease,
}

impl ActualEntryEffect {
    pub const fn code(self) -> &'static str {
        match self {
            Self::Increase => "INCREASE",
            Self::Decrease => "DECREASE",
        }
    }
}

impl FromStr for ActualEntryEffect {
    type Err = DomainError;
    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value {
            "INCREASE" => Ok(Self::Increase),
            "DECREASE" => Ok(Self::Decrease),
            _ => Err(DomainError::InvalidActualEntryEffect),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ActualEntryOrigin {
    User,
    MigratedAggregate,
}

impl ActualEntryOrigin {
    pub const fn code(self) -> &'static str {
        match self {
            Self::User => "USER",
            Self::MigratedAggregate => "MIGRATED_AGGREGATE",
        }
    }
}

impl FromStr for ActualEntryOrigin {
    type Err = DomainError;
    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value {
            "USER" => Ok(Self::User),
            "MIGRATED_AGGREGATE" => Ok(Self::MigratedAggregate),
            _ => Err(DomainError::InvalidActualEntryOrigin),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ActualEntry {
    id: Uuid,
    monthly_item_id: Uuid,
    occurred_on: CalendarDate,
    effect: ActualEntryEffect,
    amount: Amount,
    origin: ActualEntryOrigin,
    note: Option<String>,
}

impl ActualEntry {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        id: Uuid,
        monthly_item_id: Uuid,
        monthly_item_month: YearMonth,
        occurred_on: CalendarDate,
        effect: ActualEntryEffect,
        amount: Amount,
        origin: ActualEntryOrigin,
        note: Option<String>,
    ) -> Result<Self, DomainError> {
        if amount == Amount::zero() {
            return Err(DomainError::ZeroActualEntryAmount);
        }
        if occurred_on.year_month() != monthly_item_month {
            return Err(DomainError::ActualEntryDateOutsideMonth);
        }
        Ok(Self {
            id,
            monthly_item_id,
            occurred_on,
            effect,
            amount,
            origin,
            note: note
                .map(|value| value.trim().to_owned())
                .filter(|value| !value.is_empty()),
        })
    }

    pub const fn id(&self) -> Uuid {
        self.id
    }
    pub const fn monthly_item_id(&self) -> Uuid {
        self.monthly_item_id
    }
    pub const fn occurred_on(&self) -> CalendarDate {
        self.occurred_on
    }
    pub const fn effect(&self) -> ActualEntryEffect {
        self.effect
    }
    pub const fn amount(&self) -> Amount {
        self.amount
    }
    pub const fn origin(&self) -> ActualEntryOrigin {
        self.origin
    }
    pub fn note(&self) -> Option<&str> {
        self.note.as_deref()
    }

    pub fn signed_amount(&self) -> SignedAmount {
        let value = match self.effect {
            ActualEntryEffect::Increase => self.amount.as_decimal(),
            ActualEntryEffect::Decrease => -self.amount.as_decimal(),
        };
        SignedAmount::from_decimal(value).expect("entry amount is in signed amount range")
    }
}

pub fn aggregate_actual_entries(entries: &[ActualEntry]) -> Result<SignedAmount, DomainError> {
    entries.iter().try_fold(SignedAmount::zero(), |sum, entry| {
        sum.checked_add(entry.signed_amount())
    })
}
