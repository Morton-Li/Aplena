import { describe, expect, it } from "vitest";

import {
  currencyName,
  formatExchangeRate,
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

  it("shows exchange rates to at least two decimals without trailing zero noise", () => {
    expect(formatExchangeRate("1.00000000")).toBe("1.00");
    expect(formatExchangeRate("7.10000000")).toBe("7.10");
    expect(formatExchangeRate("7.12340000")).toBe("7.1234");
    expect(formatExchangeRate("6.72086232")).toBe("6.72086232");
  });
});
