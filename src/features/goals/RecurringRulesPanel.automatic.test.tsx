import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { listAutomaticEntryPolicies, saveAutomaticEntryPolicy } from "../../shared/api/automatic";
import { getDomainContract, type DomainContract } from "../../shared/api/domain";
import { createPlanItem, getSettings, listExchangeRates, listPlanItems, previewPlanItem, updatePlanItem, type PlanItem, type Settings } from "../../shared/api/finance";
import { RecurringRulesPanel } from "./RecurringRulesPanel";

vi.mock("../../shared/api/automatic", async () => ({
  ...await vi.importActual<typeof import("../../shared/api/automatic")>("../../shared/api/automatic"),
  listAutomaticEntryPolicies: vi.fn(), saveAutomaticEntryPolicy: vi.fn(),
}));
vi.mock("../../shared/api/domain", async () => ({
  ...await vi.importActual<typeof import("../../shared/api/domain")>("../../shared/api/domain"),
  getDomainContract: vi.fn(),
}));
vi.mock("../../shared/api/finance", async () => ({
  ...await vi.importActual<typeof import("../../shared/api/finance")>("../../shared/api/finance"),
  createPlanItem: vi.fn(), updatePlanItem: vi.fn(), getSettings: vi.fn(), listExchangeRates: vi.fn(), listPlanItems: vi.fn(), previewPlanItem: vi.fn(),
}));

const contract: DomainContract = { categories: [{ code: "FIXED_INCOME", label: "固定收入" }], flow_types: [{ code: "INCOME", label: "收入" }], recognition_modes: [{ code: "AMORTIZED", label: "按月均摊" }, { code: "PAYMENT", label: "按支付月份确认" }], amount_decimal_places: 2, exchange_rate_decimal_places: 8 };
const settings: Settings = { base_currency: "CNY", auto_update_exchange_rates: false, created_at: "", updated_at: "" };
const plan: PlanItem = { id: "rule-1", name: "工资", category: "FIXED_INCOME", flow_type: "INCOME", planned_amount: "1200.00", currency: "CNY", period_months: 1, start_date: "2026-11-01", end_date: null, recognition_mode: "AMORTIZED", note: null, created_at: "", updated_at: "", history_month_count: 0 };

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(<QueryClientProvider client={client}><RecurringRulesPanel targetMonth="2026-11" /></QueryClientProvider>);
}

async function newRule() {
  const user = userEvent.setup();
  setup();
  await screen.findByText("暂未配置周期规则");
  await user.click(screen.getByRole("button", { name: "新建周期规则" }));
  fireEvent.change(screen.getByLabelText("项目名称"), { target: { value: "工资" } });
  fireEvent.change(screen.getByLabelText("计划金额"), { target: { value: "1200.00" } });
  return user;
}

beforeEach(() => {
  vi.mocked(getDomainContract).mockReset().mockResolvedValue(contract);
  vi.mocked(getSettings).mockReset().mockResolvedValue(settings);
  vi.mocked(listExchangeRates).mockReset().mockResolvedValue([{ currency: "CNY", base_currency: "CNY", rate: "1.00000000", is_base_currency: true, source: "BASE_CURRENCY", observed_on: "2026-11-01", plan_reference_count: 0, updated_at: "" }]);
  vi.mocked(listPlanItems).mockReset().mockResolvedValue([]);
  vi.mocked(listAutomaticEntryPolicies).mockReset().mockResolvedValue([]);
  vi.mocked(createPlanItem).mockReset().mockResolvedValue(plan);
  vi.mocked(updatePlanItem).mockReset().mockResolvedValue(plan);
  vi.mocked(previewPlanItem).mockReset().mockResolvedValue({ effective: true, recognized_in_target_month: true, monthly_equivalent: "100.00", recognized_amount: "100.00", scheduled_date: null, base_currency: "CNY" });
  vi.mocked(saveAutomaticEntryPolicy).mockReset().mockResolvedValue({ plan_item_id: plan.id, enabled: true, first_date: "2026-11-01", effective_month: "2026-11", period_months: 1, amount: "1200.00", currency: "CNY" });
});
afterEach(cleanup);

describe("automatic recording rule configuration", () => {
  it("starts disabled and saves an ordinary rule without enabling automatic actuals", async () => {
    const user = await newRule();
    expect(screen.getByRole("checkbox", { name: "新月份自动记录实际条目" })).not.toBeChecked();
    await user.click(screen.getByRole("button", { name: "预览并检查" }));
    await user.click(await screen.findByRole("button", { name: "确认保存" }));
    await waitFor(() => expect(createPlanItem).toHaveBeenCalledTimes(1));
    expect(saveAutomaticEntryPolicy).not.toHaveBeenCalled();
  });

  it("requires an explicit date for multi-month amortized rules and records the full payment amount", async () => {
    const user = await newRule();
    fireEvent.change(screen.getByLabelText("周期（月）"), { target: { value: "12" } });
    await user.click(screen.getByRole("checkbox", { name: "新月份自动记录实际条目" }));
    expect(screen.getByLabelText("首次实际收支日")).toHaveValue("");
    expect(screen.getByText(/完整原币金额/)).toHaveTextContent("1,200.00");
    await user.click(screen.getByRole("button", { name: "预览并检查" }));
    expect(await screen.findByText("请选择首次实际收支日。")).toBeInTheDocument();
    expect(previewPlanItem).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("首次实际收支日"), { target: { value: "2026-12-01" } });
    await user.click(screen.getByRole("button", { name: "预览并检查" }));
    await user.click(await screen.findByRole("button", { name: "确认保存" }));
    await waitFor(() => expect(saveAutomaticEntryPolicy).toHaveBeenCalledWith({ planItemId: plan.id, enabled: true, firstDate: "2026-12-01" }));
    expect(createPlanItem).toHaveBeenCalledWith(expect.objectContaining({ periodMonths: 12, plannedAmount: "1200.00", recognitionMode: "AMORTIZED" }));
  });

  it("retries a failed policy save without creating the rule twice", async () => {
    vi.mocked(saveAutomaticEntryPolicy).mockRejectedValueOnce(new Error("policy unavailable"));
    const user = await newRule();
    await user.click(screen.getByRole("checkbox", { name: "新月份自动记录实际条目" }));
    expect(screen.getByLabelText("首次实际收支日")).toHaveValue("2026-11-01");
    await user.click(screen.getByRole("button", { name: "预览并检查" }));
    await user.click(await screen.findByRole("button", { name: "确认保存" }));
    expect(await screen.findByText("周期规则已保存，自动入账设置尚未保存。")).toBeInTheDocument();
    const retry = await screen.findByRole("button", { name: "确认保存" });
    await waitFor(() => expect(retry).toBeEnabled());
    fireEvent.click(retry);
    fireEvent.click(retry);
    await waitFor(() => expect(saveAutomaticEntryPolicy).toHaveBeenCalledTimes(2));
    expect(createPlanItem).toHaveBeenCalledTimes(1);
    expect(updatePlanItem).toHaveBeenCalledTimes(1);
    expect(updatePlanItem).toHaveBeenCalledWith(expect.objectContaining({ id: plan.id }));
  });

  it("keeps a PAYMENT rule's payment anchor even when its one-month recognition control is hidden", async () => {
    vi.mocked(listPlanItems).mockResolvedValue([{ ...plan, recognition_mode: "PAYMENT", start_date: "2026-11-20" }]);
    vi.mocked(listAutomaticEntryPolicies).mockResolvedValue([{ plan_item_id: plan.id, enabled: true, first_date: "2026-11-20", effective_month: "2026-11", period_months: 1, amount: "1200.00", currency: "CNY" }]);
    const user = userEvent.setup();
    setup();
    const edit = await screen.findByRole("button", { name: "编辑" });
    await waitFor(() => expect(edit).toBeEnabled());
    await user.click(edit);
    expect(screen.getByRole("checkbox", { name: "新月份自动记录实际条目" })).toBeChecked();
    expect(screen.getByLabelText("首次实际收支日")).toHaveValue("2026-11-20");
    expect(screen.getByLabelText("首次实际收支日")).toHaveAttribute("readonly");
    await user.click(screen.getByRole("button", { name: "预览并检查" }));
    await user.click(await screen.findByRole("button", { name: "确认保存" }));
    await waitFor(() => expect(saveAutomaticEntryPolicy).toHaveBeenCalledWith({ planItemId: plan.id, enabled: true, firstDate: "2026-11-20" }));
  });
});
