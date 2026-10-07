import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import type { MonthlyItem } from "../../shared/api/finance";
import { MonthlyWorkspace } from "./MonthlyWorkspaceView";
import { defaultMonthlyWorkspaceFilters } from "./monthlyWorkspace";

const special: MonthlyItem = {
  id: "special", source_plan_item_id: null, source_special_project_id: "trip", source_special_allocation_id: null,
  item_name: "旅行", month: "2026-10", category: "DISCRETIONARY_BUDGET", flow_type: "EXPENSE", recognition_mode: "AMORTIZED",
  item_source: "ACTUAL_ONLY", item_origin: "SPECIAL_PROJECT", scheduled_date: null, planned_amount: "0.00", actual_amount: "80.00", actual_entry_count: 1,
  variance_amount: "80.00", completion_rate_percent: "100.00", variance_effect: "UNFAVORABLE", currency: "CNY", note: null,
  created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-02T00:00:00Z",
};

function renderWorkspace(item: MonthlyItem) {
  const onSelectItem = vi.fn();
  render(<MemoryRouter><MonthlyWorkspace month="2026-10" items={[item]} visibleItems={[item]} filters={defaultMonthlyWorkspaceFilters} onFiltersChange={vi.fn()} onSelectItem={onSelectItem} selectedItemId={null} /></MemoryRouter>);
  return onSelectItem;
}

describe("special project monthly workspace rows", () => {
  it("shows no budget baseline for actual-only containers and opens the owning project independently", async () => {
    const onSelectItem = renderWorkspace(special);
    const row = screen.getByRole("row", { name: "打开 旅行 详情" });
    expect(within(row).getAllByText("—")).toHaveLength(3);
    expect(within(row).getByText("暂无预算基准")).toBeInTheDocument();
    const link = within(row).getByRole("link", { name: "打开专项" });
    expect(link).toHaveAttribute("href", "/specials?id=trip");
    await userEvent.setup().click(link);
    expect(onSelectItem).not.toHaveBeenCalled();
  });

  it("preserves a legitimate zero nominal allocation as a planned baseline", () => {
    renderWorkspace({ ...special, item_source: "PLANNED", source_special_allocation_id: "allocation", variance_amount: "80.00", completion_rate_percent: null });
    const row = screen.getByRole("row", { name: "打开 旅行 详情" });
    expect(within(row).getByText("¥ 0.00")).toBeInTheDocument();
    expect(within(row).queryByText("暂无预算基准")).not.toBeInTheDocument();
  });
});
