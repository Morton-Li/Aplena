import { describe, expect, it } from "vitest";

import type { MonthAnalytics } from "../../shared/api/finance";
import { defaultExpandedHistoryYears, groupHistoryByYear } from "./historyYearGroups";

function month(monthValue: string, income: string | null, expense: string | null, net: string | null): MonthAnalytics {
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
    total_item_count: 1,
    planned_item_count: 0,
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
      month("2026-01", "200.00", "80.00", "120.00"),
      month("2026-03", "300.00", "100.00", "200.00"),
    ]);

    expect(groups.map(({ year }) => year)).toEqual(["2026", "2025"]);
    expect(groups[0].months.map(({ month: value }) => value)).toEqual(["2026-03", "2026-01"]);
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
    const [empty] = groupHistoryByYear([month("2026-01", null, null, null)]);
    expect(empty.actualIncome).toBeNull();
    expect(empty.actualSavingsRatePercent).toBeNull();

    const [zeroIncome] = groupHistoryByYear([month("2025-01", "0.00", "10.00", "-10.00")]);
    expect(zeroIncome.actualSavingsRatePercent).toBeNull();
    expect(defaultExpandedHistoryYears([])).toEqual([]);
  });

  it("sums frozen plans and category amounts, deriving shares from annual totals rather than monthly percentages", () => {
    const january = month("2026-01", "100.00", "50.00", "50.00");
    const february = month("2026-02", "900.00", "810.00", "90.00");
    for (const item of [january, february]) {
      item.planned_item_count = 2;
      item.income.planned = "1000.00";
      item.expense.planned = "600.00";
      item.net_balance.planned = "400.00";
    }
    january.categories = [
      { category: "ESSENTIAL_EXPENSE", flow_type: "EXPENSE", planned_amount: "400.00", actual_to_date: "40.00", planned_share_percent: "66.67", actual_share_percent: "80.00" },
      { category: "DISCRETIONARY_BUDGET", flow_type: "EXPENSE", planned_amount: "200.00", actual_to_date: "10.00", planned_share_percent: "33.33", actual_share_percent: "20.00" },
    ];
    february.categories = [
      { ...january.categories[0], actual_to_date: "720.00", actual_share_percent: "88.89" },
      { ...january.categories[1], actual_to_date: "90.00", actual_share_percent: "11.11" },
    ];
    const [group] = groupHistoryByYear([january, february]);
    expect(group.plannedMonthCount).toBe(2);
    expect(group.actualMonthCount).toBe(2);
    expect(group.plannedIncome).toBe("2000.00");
    expect(group.plannedExpense).toBe("1200.00");
    expect(group.plannedNetBalance).toBe("800.00");
    expect(group.plannedSavingsRatePercent).toBe("40.00");
    expect(group.categories[0]).toMatchObject({ planned_amount: "800.00", actual_to_date: "760.00", actual_share_percent: "88.37" });
    expect(group.categories[1]).toMatchObject({ planned_amount: "400.00", actual_to_date: "100.00", actual_share_percent: "11.63" });
  });

  it("preserves cents beyond floating point precision and signed refund totals", () => {
    const [group] = groupHistoryByYear([
      month("2026-01", "90071992547409.91", "10.01", "90071992547399.90"),
      month("2026-02", "0.01", "-2.00", "2.01"),
      month("2026-03", null, null, null),
    ]);
    expect(group.actualIncome).toBe("90071992547409.92");
    expect(group.actualExpense).toBe("8.01");
    expect(group.actualNetBalance).toBe("90071992547401.91");
    expect(group.actualMonthCount).toBe(2);
  });
});
