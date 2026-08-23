use unicode_normalization::UnicodeNormalization;
use uuid::Uuid;

use crate::{Amount, Category, CurrencyCode, DomainError, FlowType, RecognitionMode, YearMonth};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PlanItem {
    id: Uuid,
    name: String,
    category: Category,
    amount: Amount,
    currency: CurrencyCode,
    period_months: u32,
    start_month: YearMonth,
    end_month: Option<YearMonth>,
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
        start_month: YearMonth,
        end_month: Option<YearMonth>,
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
        if end_month.is_some_and(|end| end < start_month) {
            return Err(DomainError::EndBeforeStart);
        }

        Ok(Self {
            id,
            name,
            category,
            amount,
            currency,
            period_months,
            start_month,
            end_month,
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

    pub const fn start_month(&self) -> YearMonth {
        self.start_month
    }

    pub const fn end_month(&self) -> Option<YearMonth> {
        self.end_month
    }

    pub const fn recognition_mode(&self) -> RecognitionMode {
        self.recognition_mode
    }

    pub fn note(&self) -> Option<&str> {
        self.note.as_deref()
    }
}
