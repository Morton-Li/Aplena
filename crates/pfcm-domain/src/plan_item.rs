use unicode_normalization::UnicodeNormalization;
use uuid::Uuid;

use crate::{Amount, CalendarDate, Category, CurrencyCode, DomainError, FlowType, RecognitionMode};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PlanItem {
    id: Uuid,
    name: String,
    category: Category,
    amount: Amount,
    currency: CurrencyCode,
    period_months: u32,
    start_date: CalendarDate,
    end_date: Option<CalendarDate>,
    recognition_mode: RecognitionMode,
    note: Option<String>,
}

impl PlanItem {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        id: Uuid,
        name: impl AsRef<str>,
        category: Category,
        amount: Amount,
        currency: CurrencyCode,
        period_months: u32,
        start_date: CalendarDate,
        end_date: Option<CalendarDate>,
        recognition_mode: RecognitionMode,
        note: Option<String>,
    ) -> Result<Self, DomainError> {
        let name = name.as_ref().nfkc().collect::<String>();
        let name = name.trim().to_owned();
        if name.is_empty() {
            return Err(DomainError::EmptyPlanItemName);
        }
        if period_months == 0 {
            return Err(DomainError::InvalidPeriod);
        }
        if end_date.is_some_and(|end| end < start_date) {
            return Err(DomainError::EndDateBeforeStart);
        }

        Ok(Self {
            id,
            name,
            category,
            amount,
            currency,
            period_months,
            start_date,
            end_date,
            recognition_mode,
            note: note
                .map(|value| value.trim().to_owned())
                .filter(|value| !value.is_empty()),
        })
    }

    pub const fn id(&self) -> Uuid {
        self.id
    }

    pub fn name(&self) -> &str {
        &self.name
    }

    pub const fn category(&self) -> Category {
        self.category
    }

    pub const fn flow_type(&self) -> FlowType {
        self.category.flow_type()
    }

    pub const fn amount(&self) -> Amount {
        self.amount
    }

    pub fn currency(&self) -> &CurrencyCode {
        &self.currency
    }

    pub const fn period_months(&self) -> u32 {
        self.period_months
    }

    pub const fn start_date(&self) -> CalendarDate {
        self.start_date
    }

    pub const fn end_date(&self) -> Option<CalendarDate> {
        self.end_date
    }

    pub const fn recognition_mode(&self) -> RecognitionMode {
        self.recognition_mode
    }

    pub fn note(&self) -> Option<&str> {
        self.note.as_deref()
    }
}
