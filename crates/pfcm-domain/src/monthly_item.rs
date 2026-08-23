use uuid::Uuid;

use crate::{Amount, Category, CurrencyCode, FlowType, PlanItem, RecognitionMode, YearMonth};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MonthlyItem {
    id: Uuid,
    source_plan_item_id: Uuid,
    item_name: String,
    month: YearMonth,
    category: Category,
    flow_type: FlowType,
    recognition_mode: RecognitionMode,
    planned_amount: Amount,
    actual_amount: Option<Amount>,
    currency: CurrencyCode,
    note: Option<String>,
}

impl MonthlyItem {
    pub fn snapshot(
        id: Uuid,
        source: &PlanItem,
        month: YearMonth,
        planned_amount: Amount,
        base_currency: CurrencyCode,
    ) -> Self {
        Self {
            id,
            source_plan_item_id: source.id(),
            item_name: source.name().to_owned(),
            month,
            category: source.category(),
            flow_type: source.flow_type(),
            recognition_mode: source.recognition_mode(),
            planned_amount,
            actual_amount: None,
            currency: base_currency,
            note: source.note().map(str::to_owned),
        }
    }

    pub const fn id(&self) -> Uuid {
        self.id
    }

    pub const fn source_plan_item_id(&self) -> Uuid {
        self.source_plan_item_id
    }

    pub fn item_name(&self) -> &str {
        &self.item_name
    }

    pub const fn month(&self) -> YearMonth {
        self.month
    }

    pub const fn category(&self) -> Category {
        self.category
    }

    pub const fn flow_type(&self) -> FlowType {
        self.flow_type
    }

    pub const fn recognition_mode(&self) -> RecognitionMode {
        self.recognition_mode
    }

    pub const fn planned_amount(&self) -> Amount {
        self.planned_amount
    }

    pub const fn actual_amount(&self) -> Option<Amount> {
        self.actual_amount
    }

    pub fn currency(&self) -> &CurrencyCode {
        &self.currency
    }

    pub fn note(&self) -> Option<&str> {
        self.note.as_deref()
    }

    pub fn set_actual_amount(&mut self, actual_amount: Option<Amount>) {
        self.actual_amount = actual_amount;
    }

    pub fn set_note(&mut self, note: Option<String>) {
        self.note = note
            .map(|value| value.trim().to_owned())
            .filter(|value| !value.is_empty());
    }
}
