import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";
import { GoalsPage } from "../goals/GoalsPage";
import { LoanMonthCard } from "./LoanMonthCard";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
function wrap(content: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><MemoryRouter>{content}</MemoryRouter></QueryClientProvider>);
}
beforeEach(() => { vi.mocked(invoke).mockReset(); });

it("withholds unreconciled plan totals while preserving recorded principal cash flow", async () => {
  vi.mocked(invoke).mockResolvedValue({
    month: "2026-10", currency: "CNY", has_loans: true, plan_review_required_count: 1,
    actual_principal_in: "0.00", actual_principal_out: "1000.00", actual_cash_net: "-1000.00",
    planned_borrow_total: "500.00", planned_lent_total: "200.00",
  });
  wrap(<LoanMonthCard month="2026-10" />);
  expect(await screen.findByRole("alert")).toHaveTextContent("计划本金与剩余本金不一致");
  expect(screen.getByText("本月计划尚待偿还").parentElement).toHaveTextContent("—");
  expect(screen.getByText("本月约定尚待收回").parentElement).toHaveTextContent("—");
  expect(screen.getByText("含借贷的现金净结余").parentElement).toHaveTextContent("1,000.00");
});

it("provides a repair path when a loan plan prevents a reliable budget forecast", async () => {
  vi.mocked(invoke).mockImplementation(async (command) => {
    if (command === "list_plan_items") return [];
    throw { error_code: "LOAN_PLAN_REVIEW_REQUIRED", message_key: "error.loan_plan_review_required" };
  });
  wrap(<GoalsPage />);
  expect(await screen.findByRole("alert")).toHaveTextContent("先核对还款分配或调整后续计划");
  expect(screen.getByRole("link", { name: "核对借贷计划" })).toHaveAttribute("href", "/loans");
});
