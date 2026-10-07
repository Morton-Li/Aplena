import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { listAutomaticOccurrences } from "../../shared/api/automatic";
import { createActualEntry, getStartupStatus, importReferenceRates, listActualEntries, listExchangeRates, listMonthlyItems, previewMonth, updateActualEntry, type ActualEntry, type MonthlyItem } from "../../shared/api/finance";
import { fetchEcbReferenceRates } from "../../shared/api/referenceRates";
import { MonthlyPage } from "./MonthlyPage";

vi.mock("../../shared/api/automatic", async () => ({
  ...await vi.importActual<typeof import("../../shared/api/automatic")>("../../shared/api/automatic"),
  listAutomaticOccurrences: vi.fn(),
}));
vi.mock("../../shared/api/finance", async () => ({
  ...await vi.importActual<typeof import("../../shared/api/finance")>("../../shared/api/finance"),
  createActualEntry: vi.fn(), getStartupStatus: vi.fn(), importReferenceRates: vi.fn(), listActualEntries: vi.fn(),
  listExchangeRates: vi.fn(), listMonthlyItems: vi.fn(), previewMonth: vi.fn(), updateActualEntry: vi.fn(),
}));
vi.mock("../../shared/api/referenceRates", async () => ({
  ...await vi.importActual<typeof import("../../shared/api/referenceRates")>("../../shared/api/referenceRates"),
  fetchEcbReferenceRates: vi.fn(),
}));

const item: MonthlyItem = {
  id: "monthly-1", source_plan_item_id: null, source_special_project_id: "trip", source_special_allocation_id: "allocation",
  item_name: "旅行", month: "2026-11", category: "DISCRETIONARY_BUDGET", flow_type: "EXPENSE",
  recognition_mode: "AMORTIZED", item_source: "PLANNED", item_origin: "SPECIAL_PROJECT", scheduled_date: null,
  planned_amount: "2000.00", actual_amount: "700.00", actual_entry_count: 1, variance_amount: "-1300.00",
  completion_rate_percent: "35.00", variance_effect: "FAVORABLE", currency: "CNY", note: null, created_at: "", updated_at: "",
};
const entry: ActualEntry = {
  id: "entry-1", monthly_item_id: item.id, occurred_on: "2026-11-02", effect: "INCREASE", amount: "700.00",
  source_amount: "100.00", source_currency: "USD", exchange_rate: "7.00000000", exchange_rate_source: "ECB_REFERENCE",
  exchange_rate_observed_on: "2026-11-01", origin: "AUTOMATIC", note: "交通费", detail_group: "交通", created_at: "", updated_at: "",
};

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[`/monthly?item=${item.id}`]}><MonthlyPage /></MemoryRouter></QueryClientProvider>);
  return client;
}

beforeEach(() => {
  vi.mocked(getStartupStatus).mockReset().mockResolvedValue({ current_month: "2026-11", initialization: null, error: null });
  vi.mocked(listMonthlyItems).mockReset().mockResolvedValue([item]);
  vi.mocked(listAutomaticOccurrences).mockReset().mockResolvedValue([]);
  vi.mocked(listActualEntries).mockReset().mockResolvedValue([entry]);
  vi.mocked(listExchangeRates).mockReset().mockResolvedValue([
    { currency: "CNY", base_currency: "CNY", rate: "1.00000000", is_base_currency: true, source: "BASE_CURRENCY", observed_on: "2026-11-01", plan_reference_count: 0, updated_at: "" },
    { currency: "USD", base_currency: "CNY", rate: "9.00000000", is_base_currency: false, source: "MANUAL", observed_on: "2026-11-03", plan_reference_count: 0, updated_at: "" },
  ]);
  vi.mocked(previewMonth).mockReset().mockResolvedValue({ month: "2026-11", direction: "CURRENT", requires_confirmation: false, existing_count: 1, candidate_count: 0, excluded_count: 0, missing_currencies: [], warnings: [], items: [] });
  vi.mocked(updateActualEntry).mockReset().mockResolvedValue(entry);
  vi.mocked(createActualEntry).mockReset().mockResolvedValue({ ...entry, origin: "USER" });
  vi.mocked(importReferenceRates).mockReset();
  vi.mocked(fetchEcbReferenceRates).mockReset();
});
afterEach(cleanup);

describe("monthly actual editing and saving", () => {
  it("preserves detail groups and the original foreign-currency snapshot when editing automatic records", async () => {
    const user = userEvent.setup();
    const client = setup();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    await user.click(await screen.findByRole("button", { name: "编辑" }));
    expect(screen.getByLabelText("明细分组（可选）")).toHaveValue("交通");
    expect(screen.getByRole("combobox", { name: "实际条目币种" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("原币金额"), { target: { value: "120.00" } });
    await user.click(screen.getByRole("button", { name: "保存条目" }));
    await waitFor(() => expect(updateActualEntry).toHaveBeenCalledWith(expect.objectContaining({
      id: entry.id, monthlyItemId: item.id, amount: "120.00", currency: "USD", exchangeRate: "7.00000000",
      exchangeRateSource: "ECB_REFERENCE", exchangeRateObservedOn: "2026-11-01", detailGroup: "交通",
    })));
    expect(fetchEcbReferenceRates).not.toHaveBeenCalled();
    expect(importReferenceRates).not.toHaveBeenCalled();
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ["special-project"] }));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["automatic-occurrences"] });
  });

  it("creates one actual under repeated clicks and keeps the entry dialog open while saving", async () => {
    let complete!: (value: ActualEntry) => void;
    vi.mocked(createActualEntry).mockReturnValue(new Promise((resolve) => { complete = resolve; }));
    setup();
    fireEvent.click(await screen.findByRole("button", { name: "添加支出或退款" }));
    fireEvent.change(screen.getByLabelText("原币金额"), { target: { value: "50.00" } });
    fireEvent.change(screen.getByLabelText("明细分组（可选）"), { target: { value: "住宿" } });
    const button = screen.getByRole("button", { name: "保存条目" });
    fireEvent.click(button);
    fireEvent.click(button);
    await waitFor(() => expect(createActualEntry).toHaveBeenCalledTimes(1));
    expect(createActualEntry).toHaveBeenCalledWith(expect.objectContaining({ monthlyItemId: item.id, amount: "50.00", detailGroup: "住宿" }));
    const dialog = screen.getByRole("dialog", { name: "添加支出或退款" });
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(dialog).toBeInTheDocument();
    await act(async () => { complete({ ...entry, origin: "USER", source_currency: "CNY", detail_group: "住宿" }); });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "添加支出或退款" })).not.toBeInTheDocument());
  });
});
