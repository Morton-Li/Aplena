import { describe, expect, it } from "vitest";

import type { MonthlyItem } from "../../shared/api/finance";
import {
  defaultMonthlyWorkspaceFilters,
  filterAndSortMonthlyItems,
  hasActiveMonthlyFilters,
  monthlyItemCounts,
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
    variance_amount: null,
    completion_rate_percent: null,
    variance_effect: "UNKNOWN",
    currency: "CNY",
    note: null,
    created_at: "2026-08-01T00:00:00Z",
    updated_at: "2026-08-01T00:00:00Z",
    ...overrides,
  };
}

const items = [
  item({ id: "rent", item_name: "房租", actual_amount: "3000", actual_entry_count: 1, variance_amount: "0", completion_rate_percent: "100", updated_at: "2026-08-04T00:00:00Z" }),
  item({ id: "food", item_name: "餐饮", actual_amount: "240", actual_entry_count: 2, note: "工作餐", variance_amount: "-760", completion_rate_percent: "24", variance_effect: "FAVORABLE", updated_at: "2026-08-03T00:00:00Z" }),
  item({ id: "utilities", item_name: "水电费", updated_at: "2026-08-02T00:00:00Z" }),
  item({ id: "temporary", item_name: "临时维修", item_origin: "MANUAL", item_source: "ACTUAL_ONLY", source_plan_item_id: null, actual_amount: "500", actual_entry_count: 1, variance_amount: null, updated_at: "2026-08-05T00:00:00Z" }),
];

describe("monthly workspace filtering and ordering", () => {
  it("puts most recently updated items first by default", () => {
    expect(filterAndSortMonthlyItems(items, defaultMonthlyWorkspaceFilters).map(({ id }) => id))
      .toEqual(["temporary", "rent", "food", "utilities"]);
  });

  it("searches names, localized categories and notes", () => {
    expect(filterAndSortMonthlyItems(items, { ...defaultMonthlyWorkspaceFilters, search: "工作餐" }).map(({ id }) => id))
      .toEqual(["food"]);
    expect(filterAndSortMonthlyItems(items, { ...defaultMonthlyWorkspaceFilters, search: "必要支出" })).toHaveLength(4);
  });

  it("supports flow, variance and absolute-variance sorting", () => {
    expect(filterAndSortMonthlyItems(items, { ...defaultMonthlyWorkspaceFilters, variance: "FAVORABLE" }).map(({ id }) => id))
      .toEqual(["food"]);
    expect(filterAndSortMonthlyItems(items, { ...defaultMonthlyWorkspaceFilters, sort: "VARIANCE" }).map(({ id }) => id)[0])
      .toBe("food");
  });

  it("counts class origins and actual entries and detects resettable controls", () => {
    expect(monthlyItemCounts(items)).toEqual({ total: 4, planned: 3, temporary: 1, entries: 4 });
    expect(hasActiveMonthlyFilters(defaultMonthlyWorkspaceFilters)).toBe(false);
    expect(hasActiveMonthlyFilters({ ...defaultMonthlyWorkspaceFilters, category: "ESSENTIAL_EXPENSE" })).toBe(true);
  });
});
