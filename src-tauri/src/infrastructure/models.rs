use pfcm_domain::{
    ActualEntry, Amount, CalendarDate, CurrencyCode, ExchangeRate, MonthlyItem, NextMonthGoal,
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
pub struct StoredNextMonthGoal {
    pub value: NextMonthGoal,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StoredExchangeRate {
    pub currency: CurrencyCode,
    pub exchange_rate: ExchangeRate,
    pub source: String,
    pub observed_on: Option<CalendarDate>,
    pub updated_at: String,
    pub plan_reference_count: i64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ActualEntryExchangeSnapshot {
    pub source_amount: Amount,
    pub source_currency: CurrencyCode,
    pub exchange_rate: ExchangeRate,
    pub source: String,
    pub observed_on: CalendarDate,
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
