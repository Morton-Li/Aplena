import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { queryKeys, type MonthlyItem, type PlanItem } from "../../shared/api/finance";
import { MonthlyPage } from "./MonthlyPage";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
beforeEach(() => { vi.mocked(invoke).mockReset(); });

const rule: PlanItem = {
  id: "quarterly", name: "季度网络费", category: "ESSENTIAL_EXPENSE", flow_type: "EXPENSE", planned_amount: "300.00",
  currency: "USD", period_months: 3, start_date: "2026-01-01", end_date: null, recognition_mode: "PAYMENT",
  note: null, created_at: "", updated_at: "", history_month_count: 0,
};
const ended: PlanItem = { ...rule, id: "ended", name: "已结束的订阅", end_date: "2026-01-31" };
const canonical: MonthlyItem = {
  id: "canonical-container", source_plan_item_id: rule.id, item_name: "季度网络费（原快照）", month: "2026-02",
  category: "ESSENTIAL_EXPENSE", flow_type: "EXPENSE", recognition_mode: "PAYMENT", item_source: "ACTUAL_ONLY",
  item_origin: "PLAN_LINKED", scheduled_date: null, planned_amount: "0.00", actual_amount: null, actual_entry_count: 0,
  variance_amount: null, completion_rate_percent: null, variance_effect: "UNKNOWN", currency: "CNY", note: null, created_at: "", updated_at: "",
};

function setup({ existing = false, deletedOnConfirm = false, link }: { existing?: boolean; deletedOnConfirm?: boolean; link?: () => Promise<MonthlyItem> } = {}) {
  let items: MonthlyItem[] = existing ? [canonical] : [];
  vi.mocked(invoke).mockImplementation(async (command, args) => {
    switch (command) {
      case "get_startup_status": return { current_month: "2026-11", initialization: null, error: null } as never;
      case "list_monthly_items": return items as never;
      case "list_actual_entries": case "list_automatic_occurrences": return [] as never;
      case "list_plan_items": return [rule, ended] as never;
      case "list_exchange_rates": return [{ currency: "CNY", base_currency: "CNY", rate: "1.00000000", is_base_currency: true, source: "BASE_CURRENCY", observed_on: null, plan_reference_count: 0, updated_at: "" }] as never;
      case "get_domain_contract": return { categories: [{ code: "ESSENTIAL_EXPENSE", label: "必要支出" }] } as never;
      case "preview_month": return { month: "2026-02", direction: "HISTORICAL", requires_confirmation: true, existing_count: items.length, candidate_count: 0, excluded_count: 2, missing_currencies: [], warnings: [], items: [] } as never;
      case "ensure_actual_only_monthly_item": {
        if (deletedOnConfirm) throw { error_code: "NOT_FOUND", message_key: "error.not_found" };
        const planItemId = (args as { input: { planItemId: string } }).input.planItemId;
        const result = link ? await link() : { ...canonical, source_plan_item_id: planItemId };
        items = [result];
        return result as never;
      }
      case "create_actual_entry": return { id: "refund" } as never;
      case "create_manual_monthly_item": {
        const result: MonthlyItem = { ...canonical, id: "manual", source_plan_item_id: null, item_origin: "MANUAL", item_name: "临时维修" };
        items.push(result);
        return result as never;
      }
      default: throw new Error(`Unexpected command: ${command}`);
    }
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={["/monthly?month=2026-02"]}><MonthlyPage /></MemoryRouter></QueryClientProvider>);
  return client;
}

const calls = (command: string) => vi.mocked(invoke).mock.calls.filter(([name]) => name === command);

async function openRule(name = rule.name) {
  const button = await screen.findByRole("button", { name: "关联规则录入实际" });
  await waitFor(() => expect(button).toBeEnabled());
  fireEvent.click(button);
  const picker = await screen.findByRole("combobox", { name: "关联规则" });
  await waitFor(() => expect(picker).toBeEnabled());
  fireEvent.click(picker);
  fireEvent.click(await screen.findByRole("option", { name: new RegExp(name) }));
}

describe("linked actual-only monthly entry flow", () => {
  it.each([false, true])("reuses the canonical container and saves one refund in a non-payment month, existing=%s", async (existing) => {
    const client = setup({ existing });
    await openRule();
    expect(calls("ensure_actual_only_monthly_item")).toHaveLength(0);
    expect(calls("create_actual_entry")).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "关联并录入实际" }));
    const dialog = await screen.findByRole("dialog", { name: "添加支出或退款" });
    expect(dialog).toHaveTextContent(canonical.item_name);
    expect(invoke).toHaveBeenCalledWith("ensure_actual_only_monthly_item", { input: { planItemId: rule.id, month: "2026-02" } });
    fireEvent.click(within(dialog).getByRole("combobox", { name: "类型" }));
    fireEvent.click(screen.getByRole("option", { name: "退款" }));
    fireEvent.change(screen.getByLabelText("原币金额"), { target: { value: "25.00" } });
    const save = screen.getByRole("button", { name: "保存条目" });
    fireEvent.click(save);
    fireEvent.click(save);
    await waitFor(() => expect(calls("create_actual_entry")).toHaveLength(1));
    expect(invoke).toHaveBeenCalledWith("create_actual_entry", { input: expect.objectContaining({ monthlyItemId: canonical.id, occurredOn: "2026-02-01", effect: "DECREASE", amount: "25.00", exchangeRate: "1.00000000", exchangeRateSource: "BASE_CURRENCY" }) });
    const items = client.getQueryData<MonthlyItem[]>(queryKeys.monthly("2026-02"));
    expect(items).toHaveLength(1);
    expect(items?.[0]).toMatchObject({ id: canonical.id, source_plan_item_id: rule.id, item_source: "ACTUAL_ONLY", planned_amount: "0.00" });
    expect(calls("initialize_month")).toHaveLength(0);
    expect(calls("create_manual_monthly_item")).toHaveLength(0);
  });

  it("keeps ended but undeleted rules available for late refunds", async () => {
    setup();
    await openRule(ended.name);
    expect(screen.getByRole("dialog", { name: "关联规则录入实际" })).toHaveTextContent("已结束");
    fireEvent.click(screen.getByRole("button", { name: "关联并录入实际" }));
    const dialog = await screen.findByRole("dialog", { name: "添加支出或退款" });
    fireEvent.click(within(dialog).getByRole("combobox", { name: "类型" }));
    fireEvent.click(screen.getByRole("option", { name: "退款" }));
    fireEvent.change(screen.getByLabelText("原币金额"), { target: { value: "10" } });
    fireEvent.click(screen.getByRole("button", { name: "保存条目" }));
    await waitFor(() => expect(calls("create_actual_entry")).toHaveLength(1));
    expect(invoke).toHaveBeenCalledWith("ensure_actual_only_monthly_item", { input: { planItemId: ended.id, month: "2026-02" } });
  });

  it("guards repeated linking and cannot close before the canonical container returns", async () => {
    let complete!: (item: MonthlyItem) => void;
    setup({ link: () => new Promise((resolve) => { complete = resolve; }) });
    await openRule();
    const confirm = screen.getByRole("button", { name: "关联并录入实际" });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    await waitFor(() => expect(calls("ensure_actual_only_monthly_item")).toHaveLength(1));
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(screen.getByRole("dialog", { name: "关联规则录入实际" })).toBeInTheDocument();
    await act(async () => { complete(canonical); });
    await screen.findByRole("dialog", { name: "添加支出或退款" });
    expect(calls("create_actual_entry")).toHaveLength(0);
  });

  it("browses and cancels the picker without creating containers or actuals", async () => {
    setup();
    await openRule();
    fireEvent.click(screen.getByRole("combobox", { name: "关联规则" }));
    expect(screen.getAllByRole("option")).toHaveLength(2);
    expect(screen.queryByRole("option", { name: /已删除的规则/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("option", { name: new RegExp(rule.name) }));
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(calls("ensure_actual_only_monthly_item")).toHaveLength(0);
    expect(calls("create_actual_entry")).toHaveLength(0);
  });

  it("preserves backend rejection if a selected rule is deleted before confirmation", async () => {
    setup({ deletedOnConfirm: true });
    await openRule();
    fireEvent.click(screen.getByRole("button", { name: "关联并录入实际" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("记录已不存在");
    expect(screen.getByRole("dialog", { name: "关联规则录入实际" })).toBeInTheDocument();
    expect(calls("create_actual_entry")).toHaveLength(0);
  });

  it("keeps independent temporary categories unlinked", async () => {
    setup();
    fireEvent.click((await screen.findAllByRole("button", { name: "添加临时类目" }))[0]);
    fireEvent.change(screen.getByLabelText("类目名称"), { target: { value: "临时维修" } });
    fireEvent.click(screen.getByRole("button", { name: "创建临时类目" }));
    await screen.findByRole("button", { name: "添加支出或退款" });
    expect(invoke).toHaveBeenCalledWith("create_manual_monthly_item", { input: expect.objectContaining({ name: "临时维修", month: "2026-02" }) });
    expect(calls("ensure_actual_only_monthly_item")).toHaveLength(0);
  });
});
