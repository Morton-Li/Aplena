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
  startMonth: string;
  endMonth?: string;
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
  start_month: string;
  end_month: string | null;
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
  planned_amount: string;
  actual_amount: string | null;
  variance_amount: string | null;
  completion_rate_percent: string | null;
  data_status: "MISSING" | "CONFIRMED_ZERO" | "RECORDED";
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
  base_currency: string;
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

export const queryKeys = {
  domain: ["domain-contract"] as const,
  settings: ["settings"] as const,
  startup: ["startup-status"] as const,
  rates: ["exchange-rates"] as const,
  plans: ["plan-items"] as const,
  existingMonths: ["existing-months"] as const,
  monthly: (month: string) => ["monthly-items", month] as const,
  monthPreview: (month: string, overrides: RateOverrideInput[] = []) =>
    ["month-preview", month, overrides] as const,
};

export function getSettings(invokeCommand: Invoke = invoke): Promise<Settings | null> {
  return invokeCommand<Settings | null>("get_settings");
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
  input: { id: string; endMonth: string },
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

export function updateMonthlyActual(
  input: { id: string; actualAmount: string | null },
  invokeCommand: Invoke = invoke,
): Promise<MonthlyItem> {
  return invokeCommand<MonthlyItem>("update_monthly_actual", { input });
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
