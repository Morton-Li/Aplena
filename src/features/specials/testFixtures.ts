import type { ExchangeRate } from "../../shared/api/finance";
import type { SpecialActualEntry, SpecialAllocation, SpecialProject, SpecialProjectDetail } from "../../shared/api/specials";

export function specialProject(overrides: Partial<SpecialProject> = {}): SpecialProject {
  return {
    id: "trip", name: "旅行", total_budget: "1000.00", allocated_budget: "300.00",
    unallocated_budget: "700.00", actual_net_amount: "650.01", remaining_budget: "349.99",
    currency: "CNY", archived: false, note: null, created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z",
    ...overrides,
  };
}

export function specialAllocation(overrides: Partial<SpecialAllocation> = {}): SpecialAllocation {
  return { id: "allocation", project_id: "trip", month: "2026-11", category: "DISCRETIONARY_BUDGET", amount: "300.00", frozen: false, monthly_item_id: null, ...overrides };
}

export function specialEntry(overrides: Partial<SpecialActualEntry> = {}): SpecialActualEntry {
  return {
    id: "expense", monthly_item_id: "monthly-trip", month: "2026-10", category: "DISCRETIONARY_BUDGET",
    occurred_on: "2026-10-02", effect: "INCREASE", amount: "210.00", source_amount: "30.00", source_currency: "USD",
    exchange_rate: "7.00000000", exchange_rate_source: "ECB_REFERENCE", exchange_rate_observed_on: "2026-10-01",
    origin: "USER", detail_group: "住宿", note: null, created_at: "2026-10-02T00:00:00Z", updated_at: "2026-10-02T00:00:00Z",
    ...overrides,
  };
}

export function specialDetail(overrides: Partial<SpecialProjectDetail> = {}): SpecialProjectDetail {
  return {
    project: specialProject(), allocations: [], entries: [],
    monthly_totals: [{ month: "2026-10", planned_amount: "0.00", actual_net_amount: "650.01" }],
    detail_group_totals: [{ detail_group: "住宿", actual_net_amount: "650.01", entry_count: 2 }],
    ...overrides,
  };
}

export const specialRates: ExchangeRate[] = [
  { currency: "CNY", base_currency: "CNY", rate: "1.00000000", is_base_currency: true, source: "BASE_CURRENCY", observed_on: null, plan_reference_count: 0, updated_at: "2026-10-07T00:00:00Z" },
  { currency: "USD", base_currency: "CNY", rate: "8.00000000", is_base_currency: false, source: "MANUAL", observed_on: "2026-10-07", plan_reference_count: 0, updated_at: "2026-10-07T00:00:00Z" },
];
