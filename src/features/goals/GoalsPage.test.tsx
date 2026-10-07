import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getBudgetProjection, listPlanItems, type BudgetProjection } from "../../shared/api/finance";
import { GoalsPage } from "./GoalsPage";

vi.mock("../../shared/api/finance", () => ({ getBudgetProjection: vi.fn(), listPlanItems: vi.fn(), queryKeys: { budgetProjection: ["budget-projection"], plans: ["plan-items"] } }));
vi.mock("../../shared/components/AnalyticsChart", () => ({ AnalyticsChart: () => <div>预算图表</div> }));
vi.mock("../../shared/components/PieAnalyticsChart", () => ({ PieAnalyticsChart: () => <div>分类图表</div> }));
vi.mock("./RecurringRulesPanel", () => ({ RecurringRulesPanel: () => <div>周期规则</div> }));

const projection: BudgetProjection = {
  target_month: "2026-11", base_currency: "CNY", stable_income: "1200.00", variable_income: "0.00",
  essential_expenses: "100.00", fixed_commitments: "0.00", discretionary_budget: "250.00",
  projected_income: "1200.00", projected_expenses: "350.00", recurring_expenses: "100.00", special_expenses: "250.00",
  projected_savings: "850.00", projected_savings_rate_percent: "70.83", fixed_commitment_ratio_percent: "0.00", stable_income_coverage_ratio: "3.43",
};

describe("budget projection sources", () => {
  beforeEach(() => { vi.mocked(listPlanItems).mockResolvedValue([]); });

  it("shows special nominal allocations and recurring budget separately, using backend combined totals", async () => {
    vi.mocked(getBudgetProjection).mockResolvedValue(projection);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><MemoryRouter><GoalsPage /></MemoryRouter></QueryClientProvider>);
    const sources = await screen.findByRole("region", { name: "下月支出预算来源" });
    expect(within(sources).getByText("周期规则月度预算").parentElement).toHaveTextContent("¥ 100.00");
    expect(within(sources).getByText("专项月分配").parentElement).toHaveTextContent("¥ 250.00");
    expect(within(sources).getByText("预计支出合计").parentElement).toHaveTextContent("¥ 350.00");
    expect(within(sources).getByRole("link", { name: "管理专项" })).toHaveAttribute("href", "/specials");
    expect(screen.getByText("预算图表")).toBeInTheDocument();
    expect(screen.queryByText("添加周期规则或专项月分配后，这里会汇总下月预计收入、支出与储蓄。")).not.toBeInTheDocument();
  });
});
