import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { queryKeys, type ExchangeRate, type MonthlyItem } from "../../shared/api/finance";
import { MonthlyPage } from "./MonthlyPage";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const item: MonthlyItem = {
  id: "manual", source_plan_item_id: null, item_name: "日常支出", month: "2026-11",
  category: "ESSENTIAL_EXPENSE", flow_type: "EXPENSE", recognition_mode: "AMORTIZED",
  item_source: "ACTUAL_ONLY", item_origin: "MANUAL", scheduled_date: null, planned_amount: "0.00",
  actual_amount: null, actual_entry_count: 0, variance_amount: null, completion_rate_percent: null,
  variance_effect: "UNKNOWN", currency: "CNY", note: null, created_at: "", updated_at: "",
};
const baseRate: ExchangeRate = {
  currency: "CNY", base_currency: "CNY", rate: "1.00000000", is_base_currency: true,
  source: "BASE_CURRENCY", observed_on: "2026-11-01", plan_reference_count: 0, updated_at: "",
};

function setup(rates: ExchangeRate[] | Promise<ExchangeRate[]>, cachedRates?: ExchangeRate[]) {
  vi.mocked(invoke).mockImplementation(async (command) => {
    switch (command) {
      case "get_startup_status": return { current_month: item.month, initialization: null, error: null } as never;
      case "list_monthly_items": return [item] as never;
      case "list_actual_entries": case "list_automatic_occurrences": return [] as never;
      case "preview_month": return { month: item.month, direction: "CURRENT", requires_confirmation: false, existing_count: 1, candidate_count: 0, excluded_count: 0, missing_currencies: [], warnings: [], items: [] } as never;
      case "list_exchange_rates": return rates as never;
      case "create_actual_entry": return { id: "saved" } as never;
      default: throw new Error(`Unexpected command: ${command}`);
    }
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  if (cachedRates) client.setQueryData(queryKeys.rates, cachedRates);
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={["/monthly?item=manual"]}><MonthlyPage /></MemoryRouter></QueryClientProvider>);
  return client;
}

afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.mocked(invoke).mockReset(); });

it("uses the category's base when the rate cache still holds the previous base", async () => {
  let finish!: (rates: ExchangeRate[]) => void;
  const pendingRates = new Promise<ExchangeRate[]>((resolve) => { finish = resolve; });
  const client = setup(pendingRates, [{ ...baseRate, currency: "EUR", base_currency: "EUR" }]);
  fireEvent.click(await screen.findByRole("button", { name: "添加支出或退款" }));

  expect(screen.getByRole("combobox", { name: "实际条目币种" })).toHaveTextContent("人民币（CNY）");
  fireEvent.change(screen.getByLabelText("原币金额"), { target: { value: "12.50" } });
  fireEvent.click(screen.getByRole("button", { name: "保存条目" }));
  await waitFor(() => expect(invoke).toHaveBeenCalledWith("create_actual_entry", { input: expect.objectContaining({
    monthlyItemId: item.id, currency: "CNY", exchangeRate: "1.00000000", exchangeRateSource: "BASE_CURRENCY",
  }) }));
  await act(async () => { finish([baseRate]); });
  client.clear();
});

describe("monthly saving after an ECB body timeout", () => {
  it.each(["manual", "rebased", null])("releases saving and preserves the correct outcome with cache=%s", async (cache) => {
    const derived = cache === "rebased" ? { rebased_from_currency: "EUR", rebased_on: "2026-11-04" } : null;
    const client = setup([
      baseRate,
      ...(cache ? [{ ...baseRate, currency: "USD", rate: "7.20000000", is_base_currency: false, source: "MANUAL" as const, observed_on: derived ? null : "2026-10-30", ...derived }] : []),
    ]);
    fireEvent.click(await screen.findByRole("button", { name: "添加支出或退款" }));
    fireEvent.change(screen.getByLabelText("原币金额"), { target: { value: "12.50" } });
    fireEvent.change(screen.getByLabelText("备注（可选）"), { target: { value: "保留这份草稿" } });
    let signal!: AbortSignal;
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (_url, options) => {
      signal = options!.signal!;
      return { ok: true, text: () => new Promise<never>((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
      }) } as unknown as Response;
    });
    vi.stubGlobal("fetch", fetcher);
    vi.useFakeTimers();
    fireEvent.click(screen.getByRole("combobox", { name: "实际条目币种" }));
    fireEvent.click(screen.getByRole("option", { name: /美元/ }));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    if (derived) expect(screen.getByText(/本位币切换换算 · 原本位币 EUR · 换算日 2026-11-04/)).toBeInTheDocument();
    const save = screen.getByRole("button", { name: "保存条目" });
    fireEvent.click(save);
    fireEvent.click(save);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(screen.getByRole("button", { name: "保存中…" })).toBeDisabled();
    await act(async () => { await vi.advanceTimersByTimeAsync(10_001); });
    expect(signal.aborted).toBe(true);
    const writes = vi.mocked(invoke).mock.calls.filter(([command]) => command === "create_actual_entry");
    if (cache) {
      expect(writes).toHaveLength(1);
      expect(writes[0][1]).toEqual({ input: expect.objectContaining({
        amount: "12.50", currency: "USD", exchangeRate: "7.20000000", exchangeRateSource: "MANUAL",
        exchangeRateObservedOn: derived?.rebased_on ?? "2026-10-30",
        ...(derived && { exchangeRateRebasedFromCurrency: derived.rebased_from_currency, exchangeRateRebasedOn: derived.rebased_on }),
      }) });
      expect(screen.queryByRole("dialog", { name: "添加支出或退款" })).not.toBeInTheDocument();
    } else {
      expect(writes).toHaveLength(0);
      expect(screen.getByRole("alert")).toHaveTextContent(/超时/);
      expect(screen.getByLabelText("原币金额")).toHaveValue("12.50");
      expect(screen.getByLabelText("备注（可选）")).toHaveValue("保留这份草稿");
      expect(screen.getByRole("button", { name: "保存条目" })).toBeEnabled();
      expect(screen.getByRole("button", { name: "取消" })).toBeEnabled();
      fireEvent.click(screen.getByRole("button", { name: "取消" }));
      expect(screen.queryByRole("dialog", { name: "添加支出或退款" })).not.toBeInTheDocument();
    }
    expect(fetcher).toHaveBeenCalledTimes(1);
    client.clear();
  });
});
