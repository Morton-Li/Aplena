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
    pub start_date: String,
    pub end_date: Option<String>,
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
    pub item_source: String,
    pub item_origin: String,
    pub scheduled_date: Option<String>,
    pub planned_amount: String,
    pub actual_amount: Option<String>,
    pub actual_entry_count: u64,
    pub actual_confirmed_at: Option<String>,
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
    pub end_date: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct DeletePlanItemDto {
    pub plan_item_id: String,
    pub detached_monthly_items: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActualEntryInputDto {
    pub id: Option<String>,
    pub monthly_item_id: String,
    pub occurred_on: String,
    pub effect: String,
    pub amount: String,
    pub note: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ActualEntryDto {
    pub id: String,
    pub monthly_item_id: String,
    pub occurred_on: String,
    pub effect: String,
    pub amount: String,
    pub origin: String,
    pub note: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnsureActualOnlyInputDto {
    pub plan_item_id: String,
    pub month: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManualMonthlyItemInputDto {
    pub name: String,
    pub month: String,
    pub category: String,
    pub note: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfirmMonthlyItemInputDto {
    pub id: String,
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
pub struct AmountComparisonDto {
    pub planned: String,
    pub actual_to_date: Option<String>,
    pub variance: Option<String>,
    pub completion_percent: Option<String>,
    pub variance_effect: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct CategoryBreakdownDto {
    pub category: String,
    pub flow_type: String,
    pub planned_amount: String,
    pub actual_to_date: Option<String>,
    pub planned_share_percent: Option<String>,
    pub actual_share_percent: Option<String>,
    pub missing_actual_count: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ProjectBreakdownDto {
    pub monthly_item_id: String,
    pub name: String,
    pub category: String,
    pub flow_type: String,
    pub planned_amount: String,
    pub actual_amount: Option<String>,
    pub variance_amount: Option<String>,
    pub variance_effect: String,
    pub planned_share_percent: Option<String>,
    pub actual_share_percent: Option<String>,
    pub planned_rank: u64,
    pub actual_rank: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct MonthAnalyticsDto {
    pub month: String,
    pub currency: String,
    pub actual_status: String,
    pub total_item_count: u64,
    pub planned_item_count: u64,
    pub recorded_item_count: u64,
    pub completeness_percent: Option<String>,
    pub income: AmountComparisonDto,
    pub expense: AmountComparisonDto,
    pub net_balance: AmountComparisonDto,
    pub planned_savings_rate_percent: Option<String>,
    pub actual_savings_rate_percent: Option<String>,
    pub savings_rate_percentage_point_variance: Option<String>,
    pub savings_rate_target_completion_percent: Option<String>,
    pub savings_rate_relative_deviation_percent: Option<String>,
    pub minimum_savings_rate_percent: String,
    pub categories: Vec<CategoryBreakdownDto>,
    pub projects: Vec<ProjectBreakdownDto>,
    pub important_variances: Vec<ProjectBreakdownDto>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct HistoryAnalyticsDto {
    pub months: Vec<MonthAnalyticsDto>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct FinancialCapacityDto {
    pub target_month: String,
    pub base_currency: String,
    pub minimum_savings_rate_percent: String,
    pub stable_income: String,
    pub variable_income: String,
    pub essential_expenses: String,
    pub fixed_commitments: String,
    pub discretionary_budget: String,
    pub minimum_savings_amount: String,
    pub preserved_capacity: String,
    pub maximum_capacity: String,
    pub fixed_commitment_ratio_percent: Option<String>,
    pub stable_income_coverage_ratio: Option<String>,
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
    pub start_date: String,
    pub end_date: Option<String>,
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
    pub scheduled_date: Option<String>,
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
