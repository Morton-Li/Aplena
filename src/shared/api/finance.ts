import { invoke } from "@tauri-apps/api/core";

import type { AppError, DomainContract, Invoke } from "./domain";

export interface Settings {
  target_month: string;
  base_currency: string;
  minimum_savings_rate_basis_points: number;
  created_at: string;
  updated_at: string;
}

export interface SettingsInput {
  targetMonth: string;
  baseCurrency: string;
  minimumSavingsRateBasisPoints: number;
}

export interface ExchangeRate {
  currency: string;
  base_currency: string;
  rate: string;
  is_base_currency: boolean;
  plan_reference_count: number;
  updated_at: string;
}

export interface PlanItemInput {
  id?: string;
  name: string;
  category: string;
  plannedAmount: string;
  currency: string;
  periodMonths: number;
  startDate: string;
  endDate?: string;
  recognitionMode: string;
  note?: string;
}

export interface PlanItem {
  id: string;
  name: string;
  category: string;
  flow_type: string;
  planned_amount: string;
  currency: string;
  period_months: number;
  start_date: string;
  end_date: string | null;
  recognition_mode: string;
  note: string | null;
  created_at: string;
  updated_at: string;
  history_month_count: number;
}

export interface MonthlyItem {
  id: string;
  source_plan_item_id: string | null;
  item_name: string;
  month: string;
  category: string;
  flow_type: string;
  recognition_mode: string;
  item_source: "PLANNED" | "ACTUAL_ONLY";
  scheduled_date: string | null;
  planned_amount: string;
  actual_amount: string | null;
  actual_entry_count: number;
  actual_confirmed_at: string | null;
  variance_amount: string | null;
  completion_rate_percent: string | null;
  data_status: "MISSING" | "IN_PROGRESS" | "CONFIRMED_ZERO" | "FINAL";
  variance_effect: "UNKNOWN" | "ON_PLAN" | "FAVORABLE" | "UNFAVORABLE";
  currency: string;
  note: string | null;
  created_at: string;
  updated_at: string;
}

export interface PlanPreview {
  effective: boolean;
  recognized_in_target_month: boolean;
  monthly_equivalent: string | null;
  recognized_amount: string | null;
  scheduled_date: string | null;
  base_currency: string;
}

export interface ActualEntryInput {
  id?: string;
  monthlyItemId: string;
  occurredOn: string;
  effect: "INCREASE" | "DECREASE";
  amount: string;
  note?: string;
}

export interface ActualEntry {
  id: string;
  monthly_item_id: string;
  occurred_on: string;
  effect: "INCREASE" | "DECREASE";
  amount: string;
  origin: "USER" | "MIGRATED_AGGREGATE";
  note: string | null;
  created_at: string;
  updated_at: string;
}

export interface RateOverrideInput {
  currency: string;
  rate: string;
}

export interface InitializeMonthInput {
  month: string;
  confirmed?: boolean;
  rateOverrides?: RateOverrideInput[];
}

export interface MonthPreviewItem {
  source_plan_item_id: string;
  name: string;
  category: string;
  recognition_mode: string;
  status: "EXISTING" | "EXCLUDED" | "READY" | "MISSING_RATE";
  planned_amount: string | null;
  currency: string;
}

export interface MonthPreview {
  month: string;
  direction: "HISTORICAL" | "CURRENT" | "FUTURE";
  requires_confirmation: boolean;
  existing_count: number;
  candidate_count: number;
  excluded_count: number;
  missing_currencies: string[];
  warnings: string[];
  items: MonthPreviewItem[];
}

export interface InitializeMonthResult {
  month: string;
  created_count: number;
  skipped_existing_count: number;
  excluded_count: number;
  warnings: string[];
}

export interface PlanMutationResult {
  plan_item: PlanItem;
  current_month_initialization: InitializeMonthResult | null;
}

export interface StartupStatus {
  current_month: string;
  initialization: InitializeMonthResult | null;
  error: AppError | null;
}

export interface AmountComparison {
  planned: string;
  actual_to_date: string | null;
  variance: string | null;
  completion_percent: string | null;
  variance_effect: "UNKNOWN" | "ON_PLAN" | "FAVORABLE" | "UNFAVORABLE";
}

export interface CategoryBreakdown {
  category: string;
  flow_type: string;
  planned_amount: string;
  actual_to_date: string | null;
  planned_share_percent: string | null;
  actual_share_percent: string | null;
  missing_actual_count: number;
}

export interface ProjectBreakdown {
  monthly_item_id: string;
  name: string;
  category: string;
  flow_type: string;
  planned_amount: string;
  actual_amount: string | null;
  variance_amount: string | null;
  variance_effect: "UNKNOWN" | "ON_PLAN" | "FAVORABLE" | "UNFAVORABLE";
  planned_share_percent: string | null;
  actual_share_percent: string | null;
  planned_rank: number;
  actual_rank: number | null;
}

export interface MonthAnalytics {
  month: string;
  currency: string;
  actual_status: "EMPTY" | "PARTIAL" | "COMPLETE";
  total_item_count: number;
  recorded_item_count: number;
  completeness_percent: string | null;
  income: AmountComparison;
  expense: AmountComparison;
  net_balance: AmountComparison;
  planned_savings_rate_percent: string | null;
  actual_savings_rate_percent: string | null;
  savings_rate_percentage_point_variance: string | null;
  savings_rate_target_completion_percent: string | null;
  savings_rate_relative_deviation_percent: string | null;
  minimum_savings_rate_percent: string;
  categories: CategoryBreakdown[];
  projects: ProjectBreakdown[];
  important_variances: ProjectBreakdown[];
}

export interface HistoryAnalytics {
  months: MonthAnalytics[];
}

export interface FinancialCapacity {
  target_month: string;
  base_currency: string;
  minimum_savings_rate_percent: string;
  stable_income: string;
  variable_income: string;
  essential_expenses: string;
  fixed_commitments: string;
  discretionary_budget: string;
  minimum_savings_amount: string;
  preserved_capacity: string;
  maximum_capacity: string;
  fixed_commitment_ratio_percent: string | null;
  stable_income_coverage_ratio: string | null;
}

export interface DataSummary {
  settings: {
    target_month: string;
    base_currency: string;
    minimum_savings_rate_basis_points: number;
  } | null;
  settings_count: number;
  exchange_rate_count: number;
  plan_item_count: number;
  monthly_item_count: number;
  actual_entry_count: number;
  first_month: string | null;
  last_month: string | null;
}

export interface BackupResult {
  status: "CREATED" | "CANCELLED";
  file_name: string | null;
  created_at: string | null;
  summary: DataSummary | null;
}

export interface RestoreInspection {
  status: "READY" | "CANCELLED";
  token: string | null;
  file_name: string | null;
  backup_created_at: string | null;
  backup_app_version: string | null;
  schema_version: number | null;
  migrations_applied: boolean;
  summary: DataSummary | null;
  current_summary: DataSummary | null;
}

export interface RestoreResult {
  restored: boolean;
  recovery_point_name: string;
  restored_at: string;
  summary: DataSummary;
}

export interface CsvExportResult {
  status: "CREATED" | "CANCELLED";
  folder_name: string | null;
  created_at: string | null;
  file_count: number;
}

export const queryKeys = {
  domain: ["domain-contract"] as const,
  settings: ["settings"] as const,
  startup: ["startup-status"] as const,
  rates: ["exchange-rates"] as const,
  plans: ["plan-items"] as const,
  existingMonths: ["existing-months"] as const,
  monthly: (month: string) => ["monthly-items", month] as const,
  actualEntries: (monthlyItemId: string) => ["actual-entries", monthlyItemId] as const,
  monthAnalytics: (month: string) => ["month-analytics", month] as const,
  historyAnalytics: ["history-analytics"] as const,
  capacity: (month: string) => ["financial-capacity", month] as const,
  monthPreview: (month: string, overrides: RateOverrideInput[] = []) =>
    ["month-preview", month, overrides] as const,
};

export function getSettings(invokeCommand: Invoke = invoke): Promise<Settings | null> {
  return invokeCommand<Settings | null>("get_settings");
}

export function ensureDefaultSettings(invokeCommand: Invoke = invoke): Promise<Settings> {
  return invokeCommand<Settings>("ensure_default_settings");
}

export function saveSettings(
  input: SettingsInput,
  invokeCommand: Invoke = invoke,
): Promise<Settings> {
  return invokeCommand<Settings>("save_settings", { input });
}

export function getStartupStatus(invokeCommand: Invoke = invoke): Promise<StartupStatus> {
  return invokeCommand<StartupStatus>("get_startup_status");
}

export function listExchangeRates(invokeCommand: Invoke = invoke): Promise<ExchangeRate[]> {
  return invokeCommand<ExchangeRate[]>("list_exchange_rates");
}

export function upsertExchangeRate(
  input: { currency: string; rate: string },
  invokeCommand: Invoke = invoke,
): Promise<ExchangeRate[]> {
  return invokeCommand<ExchangeRate[]>("upsert_exchange_rate", { input });
}

export function deleteExchangeRate(
  currency: string,
  invokeCommand: Invoke = invoke,
): Promise<void> {
  return invokeCommand<void>("delete_exchange_rate", { currency });
}

export function listPlanItems(invokeCommand: Invoke = invoke): Promise<PlanItem[]> {
  return invokeCommand<PlanItem[]>("list_plan_items");
}

export function createPlanItem(
  input: PlanItemInput,
  invokeCommand: Invoke = invoke,
): Promise<PlanMutationResult> {
  return invokeCommand<PlanMutationResult>("create_plan_item", { input });
}

export function updatePlanItem(
  input: PlanItemInput,
  invokeCommand: Invoke = invoke,
): Promise<PlanItem> {
  return invokeCommand<PlanItem>("update_plan_item", { input });
}

export function stopPlanItem(
  input: { id: string; endDate: string },
  invokeCommand: Invoke = invoke,
): Promise<PlanItem> {
  return invokeCommand<PlanItem>("stop_plan_item", { input });
}

export function deletePlanItem(id: string, invokeCommand: Invoke = invoke): Promise<void> {
  return invokeCommand<void>("delete_plan_item", { id });
}

export function previewPlanItem(
  contract: DomainContract,
  settings: Settings,
  rates: ExchangeRate[],
  targetMonth: string,
  planItem: PlanItemInput,
  invokeCommand: Invoke = invoke,
): Promise<PlanPreview> {
  const rate = rates.find((candidate) => candidate.currency === planItem.currency);
  if (!rate) {
    return Promise.reject({
      error_code: "MISSING_EXCHANGE_RATE",
      field: "currency",
      message_key: "error.missing_exchange_rate",
      params: { currency: planItem.currency },
    } satisfies AppError);
  }
  if (!contract.categories.some((category) => category.code === planItem.category)) {
    return Promise.reject({
      error_code: "INVALID_CATEGORY",
      field: "category",
      message_key: "error.invalid_category",
    } satisfies AppError);
  }
  return invokeCommand<PlanPreview>("preview_plan_item", {
    request: {
      targetMonth,
      planItem,
      exchangeRate: {
        sourceCurrency: rate.currency,
        baseCurrency: settings.base_currency,
        rate: rate.rate,
      },
    },
  });
}

export function listMonthlyItems(
  month: string,
  invokeCommand: Invoke = invoke,
): Promise<MonthlyItem[]> {
  return invokeCommand<MonthlyItem[]>("list_monthly_items", { month });
}

export function previewMonth(
  input: InitializeMonthInput,
  invokeCommand: Invoke = invoke,
): Promise<MonthPreview> {
  return invokeCommand<MonthPreview>("preview_month", {
    input: {
      month: input.month,
      confirmed: input.confirmed ?? false,
      rateOverrides: input.rateOverrides ?? [],
    },
  });
}

export function initializeMonth(
  input: InitializeMonthInput,
  invokeCommand: Invoke = invoke,
): Promise<InitializeMonthResult> {
  return invokeCommand<InitializeMonthResult>("initialize_month", {
    input: {
      month: input.month,
      confirmed: input.confirmed ?? false,
      rateOverrides: input.rateOverrides ?? [],
    },
  });
}

export function listExistingMonths(invokeCommand: Invoke = invoke): Promise<string[]> {
  return invokeCommand<string[]>("list_existing_months");
}

export function ensureActualOnlyMonthlyItem(
  input: { planItemId: string; month: string },
  invokeCommand: Invoke = invoke,
): Promise<MonthlyItem> {
  return invokeCommand<MonthlyItem>("ensure_actual_only_monthly_item", { input });
}

export function listActualEntries(
  monthlyItemId: string,
  invokeCommand: Invoke = invoke,
): Promise<ActualEntry[]> {
  return invokeCommand<ActualEntry[]>("list_actual_entries", { monthlyItemId });
}

export function createActualEntry(
  input: ActualEntryInput,
  invokeCommand: Invoke = invoke,
): Promise<ActualEntry> {
  return invokeCommand<ActualEntry>("create_actual_entry", { input });
}

export function updateActualEntry(
  input: ActualEntryInput & { id: string },
  invokeCommand: Invoke = invoke,
): Promise<ActualEntry> {
  return invokeCommand<ActualEntry>("update_actual_entry", { input });
}

export function deleteActualEntry(
  id: string,
  invokeCommand: Invoke = invoke,
): Promise<void> {
  return invokeCommand<void>("delete_actual_entry", { id });
}

export function confirmMonthlyItem(
  id: string,
  invokeCommand: Invoke = invoke,
): Promise<MonthlyItem> {
  return invokeCommand<MonthlyItem>("confirm_monthly_item", { input: { id } });
}

export function updateMonthlyNote(
  input: { id: string; note: string | null },
  invokeCommand: Invoke = invoke,
): Promise<MonthlyItem> {
  return invokeCommand<MonthlyItem>("update_monthly_note", { input });
}

export function confirmMonthlyActuals(
  input: { month: string; category: string | null },
  invokeCommand: Invoke = invoke,
): Promise<{ updated_count: number }> {
  return invokeCommand<{ updated_count: number }>("confirm_monthly_actuals", { input });
}

export function getMonthAnalytics(
  month: string,
  invokeCommand: Invoke = invoke,
): Promise<MonthAnalytics> {
  return invokeCommand<MonthAnalytics>("get_month_analytics", { month });
}

export function getHistoryAnalytics(invokeCommand: Invoke = invoke): Promise<HistoryAnalytics> {
  return invokeCommand<HistoryAnalytics>("get_history_analytics");
}

export function getFinancialCapacity(
  targetMonth: string,
  invokeCommand: Invoke = invoke,
): Promise<FinancialCapacity> {
  return invokeCommand<FinancialCapacity>("get_financial_capacity", { targetMonth });
}

export function createBackup(invokeCommand: Invoke = invoke): Promise<BackupResult> {
  return invokeCommand<BackupResult>("create_backup");
}

export function inspectBackup(invokeCommand: Invoke = invoke): Promise<RestoreInspection> {
  return invokeCommand<RestoreInspection>("inspect_backup");
}

export function restoreBackup(
  input: { token: string; confirmed: boolean; confirmationPhrase: string },
  invokeCommand: Invoke = invoke,
): Promise<RestoreResult> {
  return invokeCommand<RestoreResult>("restore_backup", { input });
}

export function exportCsv(invokeCommand: Invoke = invoke): Promise<CsvExportResult> {
  return invokeCommand<CsvExportResult>("export_csv");
}
