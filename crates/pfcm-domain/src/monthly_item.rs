use unicode_normalization::UnicodeNormalization;
use uuid::Uuid;

use crate::{
    Amount, CalendarDate, Category, CurrencyCode, DomainError, FlowType, MonthlyItemOrigin,
    MonthlyItemSource, PlanItem, RecognitionMode, SignedAmount, YearMonth,
};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MonthlyItem {
    id: Uuid,
    source_plan_item_id: Option<Uuid>,
    source_special_project_id: Option<Uuid>,
    source_special_allocation_id: Option<Uuid>,
    item_name: String,
    month: YearMonth,
    category: Category,
    flow_type: FlowType,
    recognition_mode: RecognitionMode,
    item_source: MonthlyItemSource,
    item_origin: MonthlyItemOrigin,
    scheduled_date: Option<CalendarDate>,
    planned_amount: Amount,
    actual_amount: Option<SignedAmount>,
    actual_entry_count: u64,
    currency: CurrencyCode,
    note: Option<String>,
}

impl MonthlyItem {
    pub fn snapshot(
        id: Uuid,
        source: &PlanItem,
        month: YearMonth,
        scheduled_date: Option<CalendarDate>,
        planned_amount: Amount,
        base_currency: CurrencyCode,
    ) -> Self {
        Self::from_plan(
            id,
            source,
            month,
            MonthlyItemSource::Planned,
            scheduled_date,
            planned_amount,
            base_currency,
        )
    }

    pub fn actual_only(
        id: Uuid,
        source: &PlanItem,
        month: YearMonth,
        base_currency: CurrencyCode,
    ) -> Self {
        Self::from_plan(
            id,
            source,
            month,
            MonthlyItemSource::ActualOnly,
            None,
            Amount::zero(),
            base_currency,
        )
    }

    fn from_plan(
        id: Uuid,
        source: &PlanItem,
        month: YearMonth,
        item_source: MonthlyItemSource,
        scheduled_date: Option<CalendarDate>,
        planned_amount: Amount,
        base_currency: CurrencyCode,
    ) -> Self {
        Self {
            id,
            source_plan_item_id: Some(source.id()),
            source_special_project_id: None,
            source_special_allocation_id: None,
            item_name: source.name().to_owned(),
            month,
            category: source.category(),
            flow_type: source.flow_type(),
            recognition_mode: source.recognition_mode(),
            item_source,
            scheduled_date,
            planned_amount,
            actual_amount: None,
            actual_entry_count: 0,
            currency: base_currency,
            note: source.note().map(str::to_owned),
            item_origin: MonthlyItemOrigin::PlanLinked,
        }
    }

    pub fn manual(
        id: Uuid,
        name: impl AsRef<str>,
        month: YearMonth,
        category: Category,
        base_currency: CurrencyCode,
        note: Option<String>,
    ) -> Result<Self, DomainError> {
        let name = name.as_ref().nfkc().collect::<String>();
        let name = name.trim().to_owned();
        if name.is_empty() {
            return Err(DomainError::EmptyMonthlyItemName);
        }
        Ok(Self {
            id,
            source_plan_item_id: None,
            source_special_project_id: None,
            source_special_allocation_id: None,
            item_name: name,
            month,
            category,
            flow_type: category.flow_type(),
            recognition_mode: RecognitionMode::Amortized,
            item_source: MonthlyItemSource::ActualOnly,
            item_origin: MonthlyItemOrigin::Manual,
            scheduled_date: None,
            planned_amount: Amount::zero(),
            actual_amount: None,
            actual_entry_count: 0,
            currency: base_currency,
            note: note
                .map(|value| value.trim().to_owned())
                .filter(|value| !value.is_empty()),
        })
    }

    #[allow(clippy::too_many_arguments)]
    pub fn special_project(
        id: Uuid,
        project_id: Uuid,
        allocation_id: Option<Uuid>,
        name: impl AsRef<str>,
        month: YearMonth,
        category: Category,
        planned_amount: Amount,
        base_currency: CurrencyCode,
        note: Option<String>,
    ) -> Result<Self, DomainError> {
        if category.flow_type() != FlowType::Expense {
            return Err(DomainError::InvalidCategory);
        }
        if allocation_id.is_none() && planned_amount != Amount::zero() {
            return Err(DomainError::InvalidMonthlyItemSource);
        }
        let mut value = Self::manual(id, name, month, category, base_currency, note)?;
        value.item_origin = MonthlyItemOrigin::SpecialProject;
        value.source_special_project_id = Some(project_id);
        value.source_special_allocation_id = allocation_id;
        value.item_source = if allocation_id.is_some() {
            MonthlyItemSource::Planned
        } else {
            MonthlyItemSource::ActualOnly
        };
        value.planned_amount = planned_amount;
        Ok(value)
    }

    #[allow(clippy::too_many_arguments)]
    pub fn rehydrate(
        id: Uuid,
        source_plan_item_id: Option<Uuid>,
        item_name: String,
        month: YearMonth,
        category: Category,
        flow_type: FlowType,
        recognition_mode: RecognitionMode,
        item_source: MonthlyItemSource,
        item_origin: MonthlyItemOrigin,
        scheduled_date: Option<CalendarDate>,
        planned_amount: Amount,
        actual_amount: Option<SignedAmount>,
        actual_entry_count: u64,
        currency: CurrencyCode,
        note: Option<String>,
    ) -> Self {
        Self {
            id,
            source_plan_item_id,
            source_special_project_id: None,
            source_special_allocation_id: None,
            item_name,
            month,
            category,
            flow_type,
            recognition_mode,
            item_source,
            item_origin,
            scheduled_date,
            planned_amount,
            actual_amount,
            actual_entry_count,
            currency,
            note,
        }
    }

    pub const fn id(&self) -> Uuid {
        self.id
    }
    pub const fn source_plan_item_id(&self) -> Option<Uuid> {
        self.source_plan_item_id
    }
    pub const fn source_special_project_id(&self) -> Option<Uuid> {
        self.source_special_project_id
    }
    pub const fn source_special_allocation_id(&self) -> Option<Uuid> {
        self.source_special_allocation_id
    }

    pub fn with_special_sources(
        mut self,
        project_id: Option<Uuid>,
        allocation_id: Option<Uuid>,
    ) -> Self {
        self.source_special_project_id = project_id;
        self.source_special_allocation_id = allocation_id;
        self
    }

    pub const fn has_plan_baseline(&self) -> bool {
        match self.item_origin {
            MonthlyItemOrigin::PlanLinked => true,
            MonthlyItemOrigin::Manual => false,
            MonthlyItemOrigin::SpecialProject => {
                matches!(self.item_source, MonthlyItemSource::Planned)
            }
        }
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
    pub const fn item_source(&self) -> MonthlyItemSource {
        self.item_source
    }
    pub const fn item_origin(&self) -> MonthlyItemOrigin {
        self.item_origin
    }
    pub const fn scheduled_date(&self) -> Option<CalendarDate> {
        self.scheduled_date
    }
    pub const fn planned_amount(&self) -> Amount {
        self.planned_amount
    }
    pub const fn actual_amount(&self) -> Option<SignedAmount> {
        self.actual_amount
    }
    pub const fn actual_entry_count(&self) -> u64 {
        self.actual_entry_count
    }
    pub fn currency(&self) -> &CurrencyCode {
        &self.currency
    }
    pub fn note(&self) -> Option<&str> {
        self.note.as_deref()
    }
}
