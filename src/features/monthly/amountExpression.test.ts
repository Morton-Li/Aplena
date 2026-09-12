import { describe, expect, it } from "vitest";

import { evaluateAmountExpression } from "./amountExpression";

describe("monthly actual-entry amount expressions", () => {
  it("evaluates decimal arithmetic with standard precedence", () => {
    expect(evaluateAmountExpression("100 + 25.5")).toEqual({ ok: true, amount: "125.50" });
    expect(evaluateAmountExpression("100 - 20 * 3")).toEqual({ ok: true, amount: "40.00" });
    expect(evaluateAmountExpression("(100 - 20) / 3")).toEqual({ ok: true, amount: "26.67" });
  });

  it("accepts common display operators and rounds the final result half up", () => {
    expect(evaluateAmountExpression("（10＋2.5）×3÷2")).toEqual({ ok: true, amount: "18.75" });
    expect(evaluateAmountExpression("2.01 / 2")).toEqual({ ok: true, amount: "1.01" });
  });

  it("rejects invalid, non-positive, zero-divisor, and out-of-range results", () => {
    expect(evaluateAmountExpression("10 / 0")).toEqual({ ok: false, error: "DIVISION_BY_ZERO" });
    expect(evaluateAmountExpression("10 - 10")).toEqual({ ok: false, error: "NON_POSITIVE" });
    expect(evaluateAmountExpression("0.01 / 3")).toEqual({ ok: false, error: "RESULT_TOO_SMALL" });
    expect(evaluateAmountExpression("1.005")).toEqual({ ok: false, error: "INVALID_EXPRESSION" });
    expect(evaluateAmountExpression("2 +")).toEqual({ ok: false, error: "INVALID_EXPRESSION" });
    expect(evaluateAmountExpression("92233720368547758.08")).toEqual({ ok: false, error: "RESULT_OUT_OF_RANGE" });
  });
});
