use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct EnumOptionDto {
    pub code: String,
    pub label: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct DomainContractDto {
    pub categories: Vec<EnumOptionDto>,
    pub flow_types: Vec<EnumOptionDto>,
    pub recognition_modes: Vec<EnumOptionDto>,
    pub amount_decimal_places: u8,
    pub exchange_rate_decimal_places: u8,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanItemInputDto {
    pub id: Option<String>,
    pub name: String,
    pub category: String,
    pub planned_amount: String,
    pub currency: String,
    pub period_months: u32,
    pub start_month: String,
    pub end_month: Option<String>,
    pub recognition_mode: String,
    pub note: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExchangeRateInputDto {
    pub source_currency: String,
    pub base_currency: String,
    pub rate: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanPreviewRequestDto {
    pub target_month: String,
    pub plan_item: PlanItemInputDto,
    pub exchange_rate: ExchangeRateInputDto,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct PlanPreviewDto {
    pub effective: bool,
    pub recognized_in_target_month: bool,
    pub monthly_equivalent: Option<String>,
    pub recognized_amount: Option<String>,
    pub base_currency: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CapacityItemInputDto {
    pub plan_item: PlanItemInputDto,
    pub exchange_rate: ExchangeRateInputDto,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CapacityRequestDto {
    pub target_month: String,
    pub base_currency: String,
    pub target_savings_rate_basis_points: u16,
    pub items: Vec<CapacityItemInputDto>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct CapacityDto {
    pub base_currency: String,
    pub stable_income: String,
    pub variable_income: String,
    pub essential_expenses: String,
    pub fixed_commitments: String,
    pub discretionary_budget: String,
    pub preserved_capacity: String,
    pub maximum_capacity: String,
    pub fixed_commitment_ratio: Option<String>,
    pub stable_income_coverage_ratio: Option<String>,
}
