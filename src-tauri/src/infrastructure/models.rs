use pfcm_domain::{
    ActualEntry, Amount, CalendarDate, CurrencyCode, DomainError, ExchangeRate, MonthlyItem,
    PlanItem, Settings,
};
use uuid::Uuid;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StoredSettings {
    pub value: Settings,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StoredSoftwareUpdatePreferences {
    pub auto_check_updates: bool,
    pub last_checked_at: Option<String>,
    pub last_check_status: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StoredExchangeRate {
    pub currency: CurrencyCode,
    pub exchange_rate: ExchangeRate,
    pub source: String,
    pub observed_on: Option<CalendarDate>,
    pub derivation: Option<ExchangeRateDerivation>,
    pub updated_at: String,
    pub plan_reference_count: i64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExchangeRateDerivation {
    pub from_base_currency: CurrencyCode,
    pub rebased_on: CalendarDate,
}

impl ExchangeRateDerivation {
    pub(crate) fn from_parts(
        from_base_currency: Option<String>,
        rebased_on: Option<String>,
    ) -> Result<Option<Self>, DomainError> {
        match (from_base_currency, rebased_on) {
            (None, None) => Ok(None),
            (Some(currency), Some(date)) => Ok(Some(Self {
                from_base_currency: CurrencyCode::new(currency)?,
                rebased_on: date.parse()?,
            })),
            _ => Err(DomainError::InvalidExchangeRate),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ActualEntryExchangeSnapshot {
    pub source_amount: Amount,
    pub source_currency: CurrencyCode,
    pub exchange_rate: ExchangeRate,
    pub source: String,
    // The required legacy snapshot date is the calculation date for a derived rate.
    pub observed_on: CalendarDate,
    pub derivation: Option<ExchangeRateDerivation>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StoredPlanItem {
    pub value: PlanItem,
    pub created_at: String,
    pub updated_at: String,
    pub history_month_count: i64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StoredMonthlyItem {
    pub value: MonthlyItem,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StoredActualEntry {
    pub value: ActualEntry,
    pub exchange_snapshot: ActualEntryExchangeSnapshot,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DeletePlanResult {
    pub plan_item_id: Uuid,
    pub detached_monthly_items: u64,
}
