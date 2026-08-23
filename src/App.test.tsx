import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

describe("App", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("loads the real domain contract through the Tauri command adapter", async () => {
    invokeMock.mockResolvedValue({
      categories: [
        { code: "FIXED_INCOME", label: "固定收入" },
        { code: "VARIABLE_INCOME", label: "浮动收入" },
        { code: "ESSENTIAL_EXPENSE", label: "必要支出" },
        { code: "FIXED_COMMITMENT", label: "固定承诺支出" },
        { code: "DISCRETIONARY_BUDGET", label: "自主性预算" },
      ],
      flow_types: [
        { code: "INCOME", label: "收入" },
        { code: "EXPENSE", label: "支出" },
      ],
      recognition_modes: [
        { code: "AMORTIZED", label: "按月均摊" },
        { code: "PAYMENT", label: "按支付月份确认" },
      ],
      amount_decimal_places: 4,
      exchange_rate_decimal_places: 8,
    });

    render(<App />);

    expect(await screen.findByText("领域内核已连接")).toBeInTheDocument();
    expect(screen.getByText("固定承诺支出")).toBeInTheDocument();
    expect(screen.getByText("按支付月份确认")).toBeInTheDocument();
    expect(invokeMock).toHaveBeenCalledOnce();
    expect(invokeMock).toHaveBeenCalledWith("get_domain_contract");
  });

  it("shows a stable connection failure instead of fabricated data", async () => {
    invokeMock.mockRejectedValue({
      error_code: "DOMAIN_UNAVAILABLE",
      message_key: "error.domain_unavailable",
    });

    render(<App />);

    expect(await screen.findByText("本地领域服务暂不可用")).toBeInTheDocument();
    expect(screen.getByText("领域服务返回错误（DOMAIN_UNAVAILABLE）")).toBeInTheDocument();
    expect(screen.queryByText("固定收入")).not.toBeInTheDocument();
  });
});
