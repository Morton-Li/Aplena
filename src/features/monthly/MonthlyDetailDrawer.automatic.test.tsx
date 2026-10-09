import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { deleteActualEntry, listActualEntries, type ActualEntry, type MonthlyItem } from "../../shared/api/finance";
import { MonthlyDetailDrawer } from "./MonthlyDetailDrawer";

vi.mock("../../shared/api/finance", async () => ({
  ...await vi.importActual<typeof import("../../shared/api/finance")>("../../shared/api/finance"),
  deleteActualEntry: vi.fn(), listActualEntries: vi.fn(),
}));

const item: MonthlyItem = {
  id: "monthly-1", source_plan_item_id: "rule-1", item_name: "工资", month: "2026-11",
  category: "FIXED_INCOME", flow_type: "INCOME", recognition_mode: "AMORTIZED", item_source: "PLANNED",
  item_origin: "PLAN_LINKED", scheduled_date: null, planned_amount: "1200.00", actual_amount: "1200.00",
  actual_entry_count: 2, variance_amount: "0.00", completion_rate_percent: "100.00", variance_effect: "ON_PLAN",
  currency: "CNY", note: null, created_at: "", updated_at: "",
};
const automatic: ActualEntry = {
  id: "entry-automatic", monthly_item_id: item.id, occurred_on: "2026-11-01", effect: "INCREASE",
  amount: "1200.00", source_amount: "1200.00", source_currency: "CNY", exchange_rate: "1.00000000",
  exchange_rate_source: "BASE_CURRENCY", exchange_rate_observed_on: "2026-11-01", origin: "AUTOMATIC",
  note: "规则自动入账", detail_group: "固定工资", created_at: "", updated_at: "",
};
const migrated: ActualEntry = { ...automatic, id: "entry-migrated", origin: "MIGRATED_AGGREGATE", note: "旧版实际总额迁移", detail_group: null };

function setup(monthlyItem = item) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const onClose = vi.fn();
  const onSaved = vi.fn().mockResolvedValue(undefined);
  const onEditEntry = vi.fn();
  render(<QueryClientProvider client={client}><MemoryRouter><MonthlyDetailDrawer item={monthlyItem} onClose={onClose} onSaved={onSaved} onDeleted={vi.fn()} onAddEntry={vi.fn()} onEditEntry={onEditEntry} /></MemoryRouter></QueryClientProvider>);
  return { onClose, onSaved, onEditEntry };
}

beforeEach(() => {
  vi.mocked(listActualEntries).mockReset().mockResolvedValue([automatic, migrated]);
  vi.mocked(deleteActualEntry).mockReset().mockResolvedValue(undefined);
});
afterEach(cleanup);

describe("automatic actual records in monthly details", () => {
  it("identifies automatic entries and allows editing without unlocking migrated aggregates", async () => {
    const user = userEvent.setup();
    const { onEditEntry } = setup();
    expect(await screen.findByText("自动入账")).toBeInTheDocument();
    expect(screen.getByText("分组：固定工资")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "编辑" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "删除" })).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: "编辑" }));
    expect(onEditEntry).toHaveBeenCalledWith(item, automatic);
  });

  it("guards repeated deletion and keeps its confirmation open until the operation finishes", async () => {
    let complete!: () => void;
    vi.mocked(deleteActualEntry).mockReturnValue(new Promise<void>((resolve) => { complete = resolve; }));
    const { onClose, onSaved } = setup();
    fireEvent.click(await screen.findByRole("button", { name: "删除" }));
    const confirmation = screen.getByRole("dialog", { name: "确认删除这条记录？" });
    expect(confirmation).toHaveTextContent("不会在再次检查或重启时重新生成");
    const confirm = screen.getByRole("button", { name: "确认删除" });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    await waitFor(() => expect(deleteActualEntry).toHaveBeenCalledTimes(1));
    expect(deleteActualEntry).toHaveBeenCalledWith(automatic.id);
    fireEvent.keyDown(confirmation, { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "关闭项目详情" }));
    expect(onClose).not.toHaveBeenCalled();
    expect(confirmation).toBeInTheDocument();
    vi.mocked(listActualEntries).mockResolvedValue([migrated]);
    await act(async () => { complete(); });
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("dialog", { name: "确认删除这条记录？" })).not.toBeInTheDocument();
    expect(screen.queryByText("自动入账")).not.toBeInTheDocument();
  });

  it("keeps special actual-only rows distinct from planned amounts and links the owning special", async () => {
    setup({ ...item, item_origin: "SPECIAL_PROJECT", item_source: "ACTUAL_ONLY", source_plan_item_id: null, source_special_project_id: "trip /1", source_special_allocation_id: null, planned_amount: "0.00" });
    await screen.findByText("自动入账");
    expect(screen.getByText("专项计划外实际")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "查看专项" })).toHaveAttribute("href", "/specials?id=trip%20%2F1");
    expect(screen.queryByRole("button", { name: "删除临时类目" })).not.toBeInTheDocument();
  });
});
