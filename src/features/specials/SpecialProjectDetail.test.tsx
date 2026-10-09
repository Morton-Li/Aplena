import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import type { SpecialProjectDetail as ProjectDetail } from "../../shared/api/specials";
import { SpecialProjectDetail } from "./SpecialProjectDetail";
import { specialAllocation, specialDetail, specialEntry, specialProject } from "./testFixtures";

function renderDetail(detail: ProjectDetail) {
  const onAddEntry = vi.fn();
  render(<MemoryRouter><SpecialProjectDetail detail={detail} currentMonth="2026-10" archiving={false} onEditProject={vi.fn()} onArchive={vi.fn()} onAddAllocation={vi.fn()} onEditAllocation={vi.fn()} onDeleteAllocation={vi.fn()} onAddEntry={onAddEntry} onEditEntry={vi.fn()} onDeleteEntry={vi.fn()} /></MemoryRouter>);
  return { onAddEntry };
}

describe("special project detail", () => {
  it("displays unallocated and net remaining separately using backend totals", () => {
    renderDetail(specialDetail({ allocations: [specialAllocation()], entries: [specialEntry()] }));
    const budget = screen.getByRole("region", { name: "专项预算摘要" });
    expect(within(budget).getByText("未分配预算").parentElement).toHaveTextContent("¥ 700.00");
    expect(within(budget).getByText("净剩余预算").parentElement).toHaveTextContent("¥ 349.99");
    expect(screen.getByRole("region", { name: "专项月份分析" })).toHaveTextContent("¥ 650.01");
    expect(screen.getByRole("region", { name: "专项明细组分析" })).toHaveTextContent("¥ 650.01");
  });

  it("keeps frozen future snapshots read only and offers controls only for unfrozen future allocations", () => {
    renderDetail(specialDetail({ allocations: [specialAllocation(), specialAllocation({ id: "frozen", month: "2026-12", frozen: true, monthly_item_id: "future-item" }), specialAllocation({ id: "historical", month: "2026-09" })] }));
    expect(screen.getAllByRole("button", { name: "编辑分配" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "删除分配" })).toHaveLength(1);
    expect(screen.getByText("已冻结快照")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "查看月度" })).toHaveAttribute("href", "/monthly?month=2026-12&item=future-item");
  });

  it("allows explicit late adjustments after archive and retains the existing facts", async () => {
    const { onAddEntry } = renderDetail(specialDetail({ project: specialProject({ archived: true }), allocations: [specialAllocation()], entries: [specialEntry()] }));
    expect(screen.getByRole("button", { name: "添加月分配" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "编辑分配" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "编辑条目" })).toBeEnabled();
    await userEvent.setup().click(screen.getByRole("button", { name: "补录支出或退款" }));
    expect(onAddEntry).toHaveBeenCalledOnce();
  });

  it("supports arbitrary detail group names without colliding with the all-groups filter", async () => {
    const user = userEvent.setup();
    renderDetail(specialDetail({ entries: [specialEntry({ detail_group: "ALL" }), specialEntry({ id: "ungrouped", detail_group: null })] }));
    await user.click(screen.getByRole("combobox", { name: "实际条目明细组" }));
    await user.click(screen.getByRole("option", { name: "ALL" }));
    expect(screen.getAllByRole("button", { name: "编辑条目" })).toHaveLength(1);
  });
});
