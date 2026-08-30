import { describe, expect, it } from "vitest";

import {
  currencyName,
  formatMoney,
  formatPercentagePoints,
  formatPercent,
  monthLabel,
} from "./finance";

describe("financial presentation formatting", () => {
  it("groups currency values without losing their decimal-string sign", () => {
    expect(formatMoney("128450", "CNY")).toBe("¥ 128,450.00");
    expect(formatMoney("-3240.5", "CNY")).toBe("−¥ 3,240.50");
    expect(formatMoney(null, "CNY")).toBe("—");
  });

  it("presents financial context without ambiguous missing values", () => {
    expect(formatPercent(null)).toBe("—");
    expect(formatPercent("-3.26")).toBe("−3.26%");
    expect(formatPercentagePoints("-3.26")).toBe("−3.26 个百分点");
    expect(currencyName("CNY")).toBe("人民币（CNY）");
    expect(monthLabel("2026-08")).toBe("2026 年 8 月");
  });
});
