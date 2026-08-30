import { describe, expect, it } from "vitest";

import type { MonthlyItem } from "../../shared/api/finance";
import {
  defaultMonthlyWorkspaceFilters,
  filterAndSortMonthlyItems,
  hasActiveMonthlyFilters,
  monthlyStatusCounts,
} from "./monthlyWorkspace";

function item(overrides: Partial<MonthlyItem>): MonthlyItem {
  return {
    id: overrides.id ?? "item",
    source_plan_item_id: "plan",
    item_name: "项目",
    month: "2026-08",
    category: "ESSENTIAL_EXPENSE",
    flow_type: "EXPENSE",
    recognition_mode: "AMORTIZED",
    item_source: "PLANNED",
    item_origin: "PLAN_LINKED",
    scheduled_date: null,
    planned_amount: "100.00",
    actual_amount: null,
    actual_entry_count: 0,
    actual_confirmed_at: null,
    variance_amount: null,
    completion_rate_percent: null,
    data_status: "MISSING",
    variance_effect: "UNKNOWN",
    currency: "CNY",
    note: null,
    created_at: "2026-08-01T00:00:00Z",
    updated_at: "2026-08-01T00:00:00Z",
    ...overrides,
  };
}

const items = [
  item({ id: "final", item_name: "房租", data_status: "FINAL", actual_amount: "3000", variance_amount: "0", completion_rate_percent: "100" }),
  item({ id: "progress", item_name: "餐饮", data_status: "IN_PROGRESS", actual_amount: "240", note: "工作餐", variance_amount: "-760", completion_rate_percent: "24", variance_effect: "FAVORABLE" }),
  item({ id: "missing", item_name: "水电费", data_status: "MISSING" }),
  item({ id: "manual", item_name: "临时维修", data_status: "FINAL", item_origin: "MANUAL", item_source: "ACTUAL_ONLY", actual_amount: "500", variance_amount: null }),
];

describe("monthly workspace filtering and ordering", () => {
  it("puts missing and in-progress items before confirmed items by default", () => {
    expect(filterAndSortMonthlyItems(items, defaultMonthlyWorkspaceFilters).map(({ id }) => id))
      .toEqual(["missing", "progress", "final", "manual"]);
  });

  it("searches names, localized categories and notes", () => {
    expect(filterAndSortMonthlyItems(items, { ...defaultMonthlyWorkspaceFilters, search: "工作餐" }).map(({ id }) => id))
      .toEqual(["progress"]);
    expect(filterAndSortMonthlyItems(items, { ...defaultMonthlyWorkspaceFilters, search: "必要支出" })).toHaveLength(4);
  });

  it("supports status, flow, variance and absolute-variance sorting", () => {
    expect(filterAndSortMonthlyItems(items, { ...defaultMonthlyWorkspaceFilters, status: "ACTUAL_ONLY" }).map(({ id }) => id))
      .toEqual(["manual"]);
    expect(filterAndSortMonthlyItems(items, { ...defaultMonthlyWorkspaceFilters, variance: "FAVORABLE" }).map(({ id }) => id))
      .toEqual(["progress"]);
    expect(filterAndSortMonthlyItems(items, { ...defaultMonthlyWorkspaceFilters, sort: "VARIANCE" }).map(({ id }) => id)[0])
      .toBe("progress");
  });

  it("counts mutually meaningful workflow states and detects resettable controls", () => {
    expect(monthlyStatusCounts(items)).toEqual({ total: 4, missing: 1, inProgress: 1, confirmed: 2, actualOnly: 1 });
    expect(hasActiveMonthlyFilters(defaultMonthlyWorkspaceFilters)).toBe(false);
    expect(hasActiveMonthlyFilters({ ...defaultMonthlyWorkspaceFilters, category: "ESSENTIAL_EXPENSE" })).toBe(true);
  });
});
