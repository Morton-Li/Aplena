import { describe, expect, it } from "vitest";

import type { MonthAnalytics } from "../../shared/api/finance";
import { defaultExpandedHistoryYears, groupHistoryByYear } from "./historyYearGroups";

function month(monthValue: string, income: string | null, expense: string | null, net: string | null, actualStatus: MonthAnalytics["actual_status"] = "COMPLETE"): MonthAnalytics {
  const comparison = (actual: string | null) => ({
    planned: "0.00",
    actual_to_date: actual,
    variance: null,
    completion_percent: null,
    variance_effect: "UNKNOWN" as const,
  });
  return {
    month: monthValue,
    currency: "CNY",
    actual_status: actualStatus,
    total_item_count: 1,
    planned_item_count: 0,
    confirmed_item_count: income === null && expense === null && net === null ? 0 : 1,
    income: comparison(income),
    expense: comparison(expense),
    net_balance: comparison(net),
    planned_savings_rate_percent: null,
    actual_savings_rate_percent: income === null || net === null ? null : "0.00",
    savings_rate_percentage_point_variance: null,
    savings_rate_plan_completion_percent: null,
    categories: [],
    projects: [],
    important_variances: [],
  };
}

describe("history year groups", () => {
  it("sorts years and months newest first and expands only the latest year by default", () => {
    const groups = groupHistoryByYear([
      month("2025-12", "100.00", "40.00", "60.00"),
      month("2026-01", "200.00", "80.00", "120.00", "PARTIAL"),
      month("2026-03", "300.00", "100.00", "200.00"),
    ]);

    expect(groups.map(({ year }) => year)).toEqual(["2026", "2025"]);
    expect(groups[0].months.map(({ month: value }) => value)).toEqual(["2026-03", "2026-01"]);
    expect(groups[0].confirmedMonthCount).toBe(1);
    expect(defaultExpandedHistoryYears(groups)).toEqual(["2026"]);
  });

  it("aggregates exact amounts and derives the annual savings rate from totals", () => {
    const [group] = groupHistoryByYear([
      month("2026-01", "100.00", "50.00", "50.00"),
      month("2026-02", "900.00", "810.00", "90.00"),
    ]);

    expect(group.actualIncome).toBe("1000.00");
    expect(group.actualExpense).toBe("860.00");
    expect(group.actualNetBalance).toBe("140.00");
    expect(group.actualSavingsRatePercent).toBe("14.00");
  });

  it("keeps unavailable totals and zero-income savings rates explicit", () => {
    const [empty] = groupHistoryByYear([month("2026-01", null, null, null, "EMPTY")]);
    expect(empty.actualIncome).toBeNull();
    expect(empty.actualSavingsRatePercent).toBeNull();

    const [zeroIncome] = groupHistoryByYear([month("2025-01", "0.00", "10.00", "-10.00")]);
    expect(zeroIncome.actualSavingsRatePercent).toBeNull();
    expect(defaultExpandedHistoryYears([])).toEqual([]);
  });
});
