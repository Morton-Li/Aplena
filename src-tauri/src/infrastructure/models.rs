use pfcm_domain::{CurrencyCode, ExchangeRate, MonthlyItem, PlanItem, Settings};
use uuid::Uuid;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StoredSettings {
    pub value: Settings,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StoredExchangeRate {
    pub currency: CurrencyCode,
    pub exchange_rate: ExchangeRate,
    pub updated_at: String,
    pub plan_reference_count: i64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StoredPlanItem {
    pub value: PlanItem,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StoredMonthlyItem {
    pub value: MonthlyItem,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DeletePlanResult {
    pub plan_item_id: Uuid,
    pub detached_monthly_items: u64,
}
