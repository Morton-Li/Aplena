import { describe, expect, it } from "vitest";

import { canEditSpecialAllocation, nextSpecialMonth, specialActualInput, specialEntryRateSnapshot, specialEntryValidation, validSpecialBudget, validSpecialEntryDate, type SpecialEntryValues } from "./specialForms";
import { specialAllocation, specialEntry, specialRates } from "./testFixtures";

const values: SpecialEntryValues = {
  month: "2026-10", occurredOn: "2026-10-03", category: "ESSENTIAL_EXPENSE", effect: "DECREASE", currency: "USD", note: "  晚到退款  ", detailGroup: "  住宿  ",
};

describe("special forms retain financial ownership and snapshots", () => {
  it("uses the saved FX snapshot when an actual entry is edited after current rates change", () => {
    const existing = specialEntry();
    expect(specialEntryRateSnapshot("USD", "CNY", "2026-10-07", specialRates, existing)).toEqual({
      rate: "7.00000000", source: "ECB_REFERENCE", observedOn: "2026-10-01",
    });
    expect(specialEntryRateSnapshot("USD", "CNY", "2026-10-07", specialRates)).toEqual({
      rate: "8.00000000", source: "MANUAL", observedOn: "2026-10-07",
    });
  });

  it("requires a rate for the correct base and records an explicit base currency snapshot", () => {
    expect(specialEntryRateSnapshot("USD", "EUR", "2026-10-07", specialRates)).toBeNull();
    expect(specialEntryRateSnapshot("JPY", "CNY", "2026-10-07", specialRates)).toBeNull();
    expect(specialEntryRateSnapshot("CNY", "CNY", "2026-10-07", [])).toEqual({ rate: "1.00000000", source: "BASE_CURRENCY", observedOn: "2026-10-07" });
  });

  it("only offers edit/delete for unfrozen future allocations on active projects", () => {
    expect(canEditSpecialAllocation(specialAllocation(), "2026-10")).toBe(true);
    expect(canEditSpecialAllocation(specialAllocation({ frozen: true }), "2026-10")).toBe(false);
    expect(canEditSpecialAllocation(specialAllocation({ month: "2026-10" }), "2026-10")).toBe(false);
    expect(canEditSpecialAllocation(specialAllocation({ month: "2026-09" }), "2026-10")).toBe(false);
    expect(canEditSpecialAllocation(specialAllocation(), "2026-10", true)).toBe(false);
  });

  it("validates calendar dates and preserves the refund month in the canonical create input", () => {
    expect(validSpecialEntryDate("2028-02-29", "2028-02")).toBe(true);
    expect(validSpecialEntryDate("2026-02-29", "2026-02")).toBe(false);
    expect(validSpecialEntryDate("2026-11-01", "2026-10")).toBe(false);
    expect(nextSpecialMonth("2026-12")).toBe("2027-01");
    expect(specialEntryValidation(values)).toBeNull();
    expect(specialActualInput("trip", values, "20.25", { rate: "7.00000000", source: "ECB_REFERENCE", observedOn: "2026-10-01" })).toEqual({
      projectId: "trip", month: "2026-10", category: "ESSENTIAL_EXPENSE", occurredOn: "2026-10-03", effect: "DECREASE", amount: "20.25", currency: "USD",
      exchangeRate: "7.00000000", exchangeRateSource: "ECB_REFERENCE", exchangeRateObservedOn: "2026-10-01", note: "晚到退款", detailGroup: "住宿",
    });
  });

  it("allows zero budget without treating it as an actual entry and clears empty grouping", () => {
    expect(validSpecialBudget("0.00")).toBe(true);
    expect(validSpecialBudget("-1")).toBe(false);
    expect(validSpecialBudget("10.001")).toBe(false);
    expect(specialActualInput("trip", { ...values, detailGroup: " " }, "10.00", { rate: "1", source: "BASE_CURRENCY", observedOn: "2026-10-03" }).detailGroup).toBeUndefined();
  });
});
