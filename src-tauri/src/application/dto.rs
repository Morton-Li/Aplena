use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsInputDto {
    pub target_month: String,
    pub base_currency: String,
    pub minimum_savings_rate_basis_points: u16,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct SettingsDto {
    pub target_month: String,
    pub base_currency: String,
    pub minimum_savings_rate_basis_points: u16,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExchangeRateUpsertDto {
    pub currency: String,
    pub rate: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ExchangeRateDto {
    pub currency: String,
    pub base_currency: String,
    pub rate: String,
    pub is_base_currency: bool,
    pub plan_reference_count: i64,
    pub updated_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct PlanItemDto {
    pub id: String,
    pub name: String,
    pub category: String,
    pub flow_type: String,
    pub planned_amount: String,
    pub currency: String,
    pub period_months: u32,
    pub start_month: String,
    pub end_month: Option<String>,
    pub recognition_mode: String,
    pub note: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub history_month_count: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct MonthlyItemDto {
    pub id: String,
    pub source_plan_item_id: Option<String>,
    pub item_name: String,
    pub month: String,
    pub category: String,
    pub flow_type: String,
    pub recognition_mode: String,
    pub planned_amount: String,
    pub actual_amount: Option<String>,
    pub variance_amount: Option<String>,
    pub completion_rate_percent: Option<String>,
    pub data_status: String,
    pub variance_effect: String,
    pub currency: String,
    pub note: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StopPlanItemRequestDto {
    pub id: String,
    pub end_month: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct DeletePlanItemDto {
    pub plan_item_id: String,
    pub detached_monthly_items: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MonthlyActualInputDto {
    pub id: String,
    pub actual_amount: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MonthlyNoteInputDto {
    pub id: String,
    pub note: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfirmActualsInputDto {
    pub month: String,
    pub category: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ConfirmActualsDto {
    pub updated_count: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RateOverrideDto {
    pub currency: String,
    pub rate: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InitializeMonthInputDto {
    pub month: String,
    #[serde(default)]
    pub confirmed: bool,
    #[serde(default)]
    pub rate_overrides: Vec<RateOverrideDto>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct MonthInitializationStatusDto {
    pub month: String,
    pub initialized: bool,
    pub item_count: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct MonthPreviewItemDto {
    pub source_plan_item_id: String,
    pub name: String,
    pub category: String,
    pub recognition_mode: String,
    pub status: String,
    pub planned_amount: Option<String>,
    pub currency: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct MonthPreviewDto {
    pub month: String,
    pub direction: String,
    pub requires_confirmation: bool,
    pub existing_count: u64,
    pub candidate_count: u64,
    pub excluded_count: u64,
    pub missing_currencies: Vec<String>,
    pub warnings: Vec<String>,
    pub items: Vec<MonthPreviewItemDto>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct InitializeMonthDto {
    pub month: String,
    pub created_count: u64,
    pub skipped_existing_count: u64,
    pub excluded_count: u64,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct PlanMutationDto {
    pub plan_item: PlanItemDto,
    pub current_month_initialization: Option<InitializeMonthDto>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct StartupStatusDto {
    pub current_month: String,
    pub initialization: Option<InitializeMonthDto>,
    pub error: Option<crate::application::error::AppError>,
}

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
