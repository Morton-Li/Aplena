import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import type { MonthPreview, MonthlyItem } from "../../shared/api/finance";
import { MonthlyPage } from "./MonthlyPage";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

describe("supplementing monthly rules", () => {
  it("explains missing budgets, confirms supplementation and preserves existing actuals", async () => {
    let supplemented = false;
    const existing: MonthlyItem = {
      id: "existing", source_plan_item_id: "existing-rule", item_name: "房租", month: "2026-11",
      category: "ESSENTIAL_EXPENSE", flow_type: "EXPENSE", recognition_mode: "PAYMENT",
      item_source: "PLANNED", item_origin: "PLAN_LINKED", scheduled_date: "2026-11-01",
      planned_amount: "2000.00", actual_amount: "1900.00", actual_entry_count: 1,
      variance_amount: "-100.00", completion_rate_percent: "95.00", variance_effect: "FAVORABLE",
      currency: "CNY", note: null, created_at: "", updated_at: "",
    };
    const preview: MonthPreview = {
      month: "2026-11", direction: "CURRENT", requires_confirmation: false,
      existing_count: 1, candidate_count: 1, excluded_count: 0, missing_currencies: ["USD"], warnings: [],
      items: [
        { source_plan_item_id: "ready", name: "水电", category: "ESSENTIAL_EXPENSE", recognition_mode: "PAYMENT", status: "READY", planned_amount: "100.00", currency: "CNY" },
        { source_plan_item_id: "missing", name: "订阅", category: "FIXED_COMMITMENT_EXPENSE", recognition_mode: "PAYMENT", status: "MISSING_RATE", planned_amount: null, currency: "CNY" },
      ],
    };
    vi.mocked(invoke).mockReset().mockImplementation(async (command) => {
      switch (command) {
        case "get_startup_status": return { current_month: "2026-11", initialization: null, error: null } as never;
        case "list_exchange_rates": return [{ currency: "CNY", is_base_currency: true, rate: "1" }] as never;
        case "list_monthly_items": return [existing] as never;
        case "preview_month": return (supplemented ? { ...preview, candidate_count: 0, missing_currencies: [], items: [] } : preview) as never;
        case "initialize_month": supplemented = true; return { created_count: 2 } as never;
        case "list_automatic_occurrences": return [] as never;
        default: throw new Error(`Unexpected command ${command}`);
      }
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><MemoryRouter><MonthlyPage /></MemoryRouter></QueryClientProvider>);
    expect(await screen.findByText("有 2 项预算尚未加入该月，补齐后即可记录实际收支。")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "关联规则录入实际" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "补齐该月规则" }));
    const dialog = screen.getByRole("dialog", { name: "补齐 2026-11 规则" });
    expect(dialog).toHaveTextContent("已有计划金额和实际记录均会保留");
    expect(dialog).not.toHaveTextContent("初始化");
    const confirm = within(dialog).getByRole("button", { name: "确认补齐规则" });
    expect(confirm).toBeDisabled();
    fireEvent.click(within(dialog).getByRole("checkbox", { name: "确认补充缺少的预算，保留已有计划和实际记录。" }));
    expect(confirm).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText("USD 临时汇率（必填）"), { target: { value: "7.1" } });
    fireEvent.click(confirm);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(invoke).toHaveBeenCalledWith("initialize_month", { input: { month: "2026-11", confirmed: true, rateOverrides: [{ currency: "USD", rate: "7.1" }] } });
    expect(client.getQueryData(["monthly-items", "2026-11"])).toEqual([existing]);
    expect(screen.queryByText(/项预算尚未加入/)).not.toBeInTheDocument();
    const writes = vi.mocked(invoke).mock.calls.filter(([command]) => !/^(get_|list_|preview_)/.test(command));
    expect(writes.map(([command]) => command)).toEqual(["initialize_month"]);
  });
});
