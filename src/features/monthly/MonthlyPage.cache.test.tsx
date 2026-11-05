import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Link, MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ActualEntry, MonthlyItem } from "../../shared/api/finance";
import { loanQueryKeys, type LoanMonthSummary } from "../../shared/api/loans";
import { LoanMonthCard } from "../loans/LoanMonthCard";
import { MonthlyPage } from "./MonthlyPage";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
beforeEach(() => { vi.mocked(invoke).mockReset(); });

describe("monthly writes refresh loan cash balances immediately", () => {
  it.each([
    ["2026-11", "edit"], ["2026-02", "add"], ["2026-02", "refund"],
    ["2026-02", "delete"], ["2026-02", "container"],
  ])("invalidates and refetches %s after %s", async (month, operation) => {
    const item: MonthlyItem = {
      id: "monthly", source_plan_item_id: null, item_name: "日常支出", month,
      category: "ESSENTIAL_EXPENSE", flow_type: "EXPENSE", recognition_mode: "AMORTIZED",
      item_source: "ACTUAL_ONLY", item_origin: "MANUAL", scheduled_date: null, planned_amount: "0.00",
      actual_amount: "100.00", actual_entry_count: 1, variance_amount: null, completion_rate_percent: null,
      variance_effect: "UNKNOWN", currency: "CNY", note: null, created_at: "", updated_at: "",
    };
    const entry: ActualEntry = {
      id: "actual", monthly_item_id: item.id, occurred_on: `${month}-01`, effect: "INCREASE",
      amount: "100.00", source_amount: "100.00", source_currency: "CNY", exchange_rate: "1.00000000",
      exchange_rate_source: "BASE_CURRENCY", exchange_rate_observed_on: `${month}-01`, origin: "USER",
      note: null, detail_group: null, created_at: "", updated_at: "",
    };
    const summary: LoanMonthSummary = {
      month, currency: "CNY", has_loans: true, actual_principal_in: "0.00", actual_principal_out: "0.00",
      plan_review_required_count: 0, actual_cash_net: "-100.00", planned_borrow_principal: "0.00", planned_borrow_charges: "0.00",
      planned_borrow_total: "0.00", planned_lent_principal: "0.00", planned_lent_charges: "0.00", planned_lent_total: "0.00",
    };
    let written = false;
    vi.mocked(invoke).mockImplementation(async (command) => {
      switch (command) {
        case "get_startup_status": return { current_month: "2026-11", initialization: null, error: null } as never;
        case "list_monthly_items": return operation === "container" && written ? [] : [item] as never;
        case "list_actual_entries": return written && operation === "delete" ? [] : [entry] as never;
        case "list_automatic_occurrences": return [] as never;
        case "list_exchange_rates": return [{ currency: "CNY", base_currency: "CNY", rate: "1.00000000", is_base_currency: true, source: "BASE_CURRENCY", observed_on: null, plan_reference_count: 0, updated_at: "" }] as never;
        case "preview_month": return { month, direction: month === "2026-11" ? "CURRENT" : "HISTORICAL", requires_confirmation: true, existing_count: 1, candidate_count: 0, excluded_count: 0, missing_currencies: [], warnings: [], items: [] } as never;
        case "create_actual_entry": case "update_actual_entry": case "delete_actual_entry": case "delete_manual_monthly_item": written = true; return entry as never;
        case "get_loan_month_summary": return { ...summary, actual_cash_net: "-150.00" } as never;
        default: throw new Error(`Unexpected command: ${command}`);
      }
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 15_000 }, mutations: { retry: false } } });
    client.setQueryData(loanQueryKeys.month(month), summary);
    render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[`/monthly?month=${month}&item=monthly`]}>
      <Link to="/overview">查看现金结余</Link>
      <Routes><Route path="/monthly" element={<MonthlyPage />} /><Route path="/overview" element={<LoanMonthCard month={month} />} /></Routes>
    </MemoryRouter></QueryClientProvider>);
    await screen.findByRole("button", { name: "添加支出或退款" });
    if (operation === "delete") {
      fireEvent.click(await screen.findByRole("button", { name: "删除" }));
      fireEvent.click(screen.getByRole("button", { name: "确认删除" }));
    } else if (operation === "container") {
      fireEvent.click(screen.getByRole("button", { name: "删除临时类目" }));
      fireEvent.click(screen.getByRole("button", { name: "确认删除临时类目" }));
    } else {
      fireEvent.click(await screen.findByRole("button", { name: operation === "edit" ? "编辑" : "添加支出或退款" }));
      if (operation === "refund") {
        fireEvent.click(screen.getByRole("combobox", { name: "类型" }));
        fireEvent.click(screen.getByRole("option", { name: "退款" }));
      }
      fireEvent.change(screen.getByLabelText("原币金额"), { target: { value: "50.00" } });
      fireEvent.click(screen.getByRole("button", { name: "保存条目" }));
    }
    await waitFor(() => expect(client.getQueryState(loanQueryKeys.month(month))?.isInvalidated).toBe(true));
    fireEvent.click(screen.getByRole("link", { name: "查看现金结余" }));
    await waitFor(() => expect(screen.getByText("含借贷的现金净结余").parentElement).toHaveTextContent("150.00"));
    expect(vi.mocked(invoke).mock.calls.filter(([command]) => command === "get_loan_month_summary")).toHaveLength(1);
  });
});
