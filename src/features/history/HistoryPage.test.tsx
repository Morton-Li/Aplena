import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ActualEntryInput, MonthAnalytics, MonthlyItem } from "../../shared/api/finance";
import { MonthlyPage } from "../monthly/MonthlyPage";
import { HistoryPage } from "./HistoryPage";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("../../shared/components/AnalyticsChart", () => ({ AnalyticsChart: () => null }));
beforeEach(() => { vi.mocked(invoke).mockReset(); });

const metric = { planned: "0.00", actual_to_date: "0.00", variance: null, completion_percent: null, variance_effect: "UNKNOWN" as const };
const previous: MonthAnalytics = {
  month: "2026-01", currency: "CNY", total_item_count: 1, planned_item_count: 0,
  income: metric, expense: metric, net_balance: metric, planned_savings_rate_percent: null,
  actual_savings_rate_percent: null, savings_rate_percentage_point_variance: null, savings_rate_plan_completion_percent: null,
  categories: [], projects: [], important_variances: [],
};
const monthly: MonthlyItem = {
  id: "historical-item", source_plan_item_id: null, item_name: "历史维修", month: "2026-02",
  category: "ESSENTIAL_EXPENSE", flow_type: "EXPENSE", recognition_mode: "AMORTIZED",
  item_source: "ACTUAL_ONLY", item_origin: "MANUAL", scheduled_date: null, planned_amount: "0.00",
  actual_amount: null, actual_entry_count: 0, variance_amount: null, completion_rate_percent: null,
  variance_effect: "UNKNOWN", currency: "CNY", note: null, created_at: "", updated_at: "",
};

function Location() {
  const location = useLocation();
  return <output aria-label="当前地址">{location.pathname}{location.search}</output>;
}

function setup({ existing = false, route = "/history", needsInitialization = false } = {}) {
  let items: MonthlyItem[] = [];
  let initialized = false;
  const entries: object[] = [];
  vi.mocked(invoke).mockImplementation(async (command, args) => {
    switch (command) {
      case "get_history_analytics": return { months: existing ? [previous] : [] } as never;
      case "get_startup_status": return { current_month: "2026-11", initialization: null, error: null } as never;
      case "get_loan_month_summary": return { has_loans: false } as never;
      case "list_exchange_rates": return [{ currency: "CNY", base_currency: "CNY", rate: "1.00000000", is_base_currency: true, source: "BASE_CURRENCY", observed_on: null, plan_reference_count: 0, updated_at: "" }] as never;
      case "list_monthly_items": return items as never;
      case "list_actual_entries": return entries as never;
      case "list_automatic_occurrences": return [] as never;
      case "get_domain_contract": return { categories: [{ code: "ESSENTIAL_EXPENSE", label: "必要支出" }] } as never;
      case "preview_month": return {
        month: "2026-02", direction: "HISTORICAL", requires_confirmation: true, existing_count: initialized ? 1 : 0,
        candidate_count: 0, excluded_count: 0, missing_currencies: needsInitialization && !initialized ? ["USD"] : [], warnings: [], items: [],
      } as never;
      case "initialize_month": {
        const { input } = args as { input: { rateOverrides: { rate: string }[] } };
        if (input.rateOverrides[0]?.rate === "0") throw { error_code: "INVALID_EXCHANGE_RATE", message_key: "error.invalid_exchange_rate" };
        initialized = true;
        items = [{ ...monthly, item_source: "PLANNED", item_origin: "PLAN_LINKED", source_plan_item_id: "rule", planned_amount: "700.00" }];
        return { month: "2026-02", created_count: 1, skipped_existing_count: 0, excluded_count: 0, warnings: [] } as never;
      }
      case "create_manual_monthly_item": items = [monthly]; return monthly as never;
      case "create_actual_entry": {
        const input = (args as { input: ActualEntryInput }).input;
        const entry = { id: "actual", monthly_item_id: input.monthlyItemId, occurred_on: input.occurredOn, effect: input.effect,
          amount: input.amount, source_amount: input.amount, source_currency: input.currency, exchange_rate: input.exchangeRate,
          exchange_rate_source: input.exchangeRateSource, exchange_rate_observed_on: input.exchangeRateObservedOn, origin: "USER", note: null, detail_group: null, created_at: "", updated_at: "" };
        entries.push(entry);
        return entry as never;
      }
      default: throw new Error(`Unexpected command: ${command}`);
    }
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[route]}><Location /><Routes>
    <Route path="/history" element={<HistoryPage />} /><Route path="/history/:month" element={<HistoryPage />} />
    <Route path="/monthly" element={<MonthlyPage />} />
  </Routes></MemoryRouter></QueryClientProvider>);
}

function writes() {
  return vi.mocked(invoke).mock.calls.filter(([command]) => !/^(get_|list_|preview_)/.test(command));
}

async function chooseHistoricalMonth(month = "2026-02") {
  const button = await screen.findByRole("button", { name: "补录历史月份" });
  await waitFor(() => expect(button).toBeEnabled());
  fireEvent.click(button);
  fireEvent.change(screen.getByLabelText("补录月份"), { target: { value: month } });
  fireEvent.click(screen.getByRole("button", { name: "补录这个历史月份" }));
  await waitFor(() => expect(screen.getByLabelText("当前地址")).toHaveTextContent(`/monthly?month=${month}`));
}

describe("historical month backfill", () => {
  it.each([false, true])("chooses a missing past month from the normal UI and records an expense with existing history=%s", async (existing) => {
    setup({ existing });
    await chooseHistoricalMonth();
    await screen.findByRole("heading", { name: "2026 年 2 月" });
    expect(writes()).toHaveLength(0);
    expect(vi.mocked(invoke).mock.calls.some(([command]) => command === "check_automatic_entries")).toBe(false);
    fireEvent.click(screen.getAllByRole("button", { name: "添加临时类目" })[0]);
    fireEvent.change(screen.getByLabelText("类目名称"), { target: { value: "历史维修" } });
    fireEvent.click(screen.getByRole("button", { name: "创建临时类目" }));
    fireEvent.click(await screen.findByRole("button", { name: "添加支出或退款" }));
    fireEvent.change(screen.getByLabelText("原币金额"), { target: { value: "12.50" } });
    fireEvent.click(screen.getByRole("button", { name: "保存条目" }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("create_actual_entry", { input: expect.objectContaining({ monthlyItemId: monthly.id, occurredOn: "2026-02-01", amount: "12.50", effect: "INCREASE" }) }));
    expect(writes().map(([command]) => command)).toEqual(["create_manual_monthly_item", "create_actual_entry"]);
  });

  it("validates the month, rejects current/future dates and cancels without writes", async () => {
    setup();
    const button = await screen.findByRole("button", { name: "补录历史月份" });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
    for (const value of ["", "0000-01", "2026-13", "2026-11", "2026-12"]) {
      fireEvent.change(screen.getByLabelText("补录月份"), { target: { value } });
      fireEvent.click(screen.getByRole("button", { name: "补录这个历史月份" }));
      expect(screen.getByRole("alert")).toHaveTextContent("请选择当前自然月之前的有效月份");
      expect(screen.getByLabelText("当前地址")).toHaveTextContent("/history");
    }
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(writes()).toHaveLength(0);
  });

  it("opens an existing month through the picker and retains its report adjustment link", async () => {
    setup({ existing: true });
    expect(await screen.findByRole("link", { name: /查看 2026 年 1 月 详细报告/ })).toHaveAttribute("href", "/history/2026-01");
    await chooseHistoricalMonth("2026-01");
    expect(writes()).toHaveLength(0);
  });

  it("keeps the existing report adjustment path", async () => {
    setup({ existing: true, route: "/history/2026-01" });
    expect(await screen.findByRole("link", { name: "调整该月数据" })).toHaveAttribute("href", "/monthly?month=2026-01");
  });

  it("offers backfill directly from a missing report", async () => {
    setup({ route: "/history/2026-02" });
    fireEvent.click(await screen.findByRole("link", { name: "补录这个历史月份" }));
    await screen.findByRole("heading", { name: "2026 年 2 月" });
    expect(writes()).toHaveLength(0);
  });

  it.each(["2026-13", "0000-01", "2026-12"])("does not offer historical backfill for invalid or future report %s", async (month) => {
    setup({ route: `/history/${month}` });
    await screen.findByRole("heading", { name: "没有找到这个月份" });
    expect(screen.queryByRole("link", { name: "补录这个历史月份" })).not.toBeInTheDocument();
    expect(writes()).toHaveLength(0);
  });

  it("retains explicit initialization confirmation, historical warning and temporary rate validation", async () => {
    setup({ needsInitialization: true });
    await chooseHistoricalMonth();
    fireEvent.click(await screen.findByRole("button", { name: "初始化该月" }));
    const dialog = screen.getByRole("dialog", { name: "初始化 2026-02" });
    expect(dialog).toHaveTextContent("当前汇率不一定代表当时汇率");
    const confirm = within(dialog).getByRole("button", { name: "确认创建月度快照" });
    expect(confirm).toBeDisabled();
    expect(writes()).toHaveLength(0);
    fireEvent.click(within(dialog).getByRole("checkbox"));
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByLabelText("USD 临时汇率（必填）"), { target: { value: "0" } });
    fireEvent.click(confirm);
    await within(dialog).findByRole("alert");
    expect(dialog).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("USD 临时汇率（必填）"), { target: { value: "7" } });
    fireEvent.click(confirm);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(invoke).toHaveBeenCalledWith("initialize_month", { input: { month: "2026-02", confirmed: true, rateOverrides: [{ currency: "USD", rate: "7" }] } });
    expect(writes().every(([command]) => command === "initialize_month")).toBe(true);
  });
});
