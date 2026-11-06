import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ExchangeRate, SettingsInput } from "../../shared/api/finance";
import { SettingsPage } from "./SettingsPage";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("../software-updates/SoftwareUpdateCard", () => ({ SoftwareUpdateCard: () => null }));
beforeEach(() => { vi.mocked(invoke).mockReset(); });

function setup(options: { rates?: string[]; beforeSave?: (input: SettingsInput) => Promise<void> } = {}) {
  let settings = { base_currency: "CNY", auto_update_exchange_rates: false, created_at: "", updated_at: "" };
  const rates: ExchangeRate[] = [{ currency: "CNY", base_currency: "CNY", rate: "1.00000000", is_base_currency: true, source: "BASE_CURRENCY", observed_on: null, plan_reference_count: 0, updated_at: "" }];
  for (const currency of options.rates ?? []) {
    rates.push({ ...rates[0], currency, rate: "7.2", is_base_currency: false, source: "MANUAL" });
  }
  let settingsWrites = Promise.resolve();
  vi.mocked(invoke).mockImplementation(async (command, args) => {
    if (command === "get_settings") return settings as never;
    if (command === "list_exchange_rates") return rates.map((rate) => ({ ...rate, base_currency: settings.base_currency, is_base_currency: rate.currency === settings.base_currency })) as never;
    if (command === "save_settings") {
      const input = (args as { input: SettingsInput }).input;
      const write = settingsWrites.then(async () => {
        await options.beforeSave?.(input);
        if (!rates.some((rate) => rate.currency === input.baseCurrency)) throw { error_code: "MISSING_EXCHANGE_RATE", message_key: "error.missing_exchange_rate", params: { currency: input.baseCurrency } };
        settings = { ...settings, base_currency: input.baseCurrency, auto_update_exchange_rates: input.autoUpdateExchangeRates };
        return settings;
      });
      settingsWrites = write.then(() => undefined, () => undefined);
      return write as Promise<never>;
    }
    if (command === "upsert_exchange_rate") {
      const input = (args as { input: { currency: string; rate: string } }).input;
      rates.push({ ...rates[0], currency: input.currency, rate: input.rate, is_base_currency: false, source: "MANUAL" });
      return [...rates] as never;
    }
    throw new Error(`Unexpected command: ${command}`);
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(<QueryClientProvider client={client}><SettingsPage /></QueryClientProvider>);
  return () => settings;
}

async function selectUsd() {
  fireEvent.click(await screen.findByRole("combobox", { name: "本位币" }));
  fireEvent.click(screen.getByRole("option", { name: /美元/ }));
}

describe("base currency settings", () => {
  it("provides the missing-rate recovery path and lets an empty ledger switch after supplying the basis", async () => {
    setup();
    fireEvent.click(await screen.findByRole("combobox", { name: "本位币" }));
    fireEvent.click(screen.getByRole("option", { name: /美元/ }));
    expect(screen.getByText(/1 单位目标币 = N CNY/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("缺少 USD 汇率");
    fireEvent.change(screen.getByLabelText("汇率币种"), { target: { value: "USD" } });
    fireEvent.change(screen.getByLabelText("汇率值"), { target: { value: "7.2" } });
    fireEvent.click(screen.getByRole("button", { name: "添加汇率" }));
    await waitFor(() => expect(screen.getByText("USD", { selector: "strong" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(await screen.findByRole("status")).toHaveTextContent("本位币已保存");
    expect(invoke).toHaveBeenCalledWith("save_settings", { input: { baseCurrency: "USD", autoUpdateExchangeRates: false } });
    expect(vi.mocked(invoke).mock.calls.filter(([command]) => command === "upsert_exchange_rate")).toHaveLength(1);
  });

  it("saves the automatic-rate preference using the unchanged base", async () => {
    setup();
    fireEvent.click(await screen.findByRole("switch", { name: "启动时自动更新汇率" }));
    await waitFor(() => expect(screen.getByRole("switch", { name: "启动时自动更新汇率" })).toBeChecked());
    expect(invoke).toHaveBeenCalledWith("save_settings", { input: { baseCurrency: "CNY", autoUpdateExchangeRates: true } });
    expect(vi.mocked(invoke).mock.calls.filter(([command]) => command === "upsert_exchange_rate")).toHaveLength(0);
  });

  it("keeps both changes when the rate preference is toggled during a base currency save", async () => {
    let resolve!: () => void;
    const promise = new Promise<void>((done) => { resolve = done; });
    const saved = setup({ rates: ["USD"], beforeSave: async (input) => {
      if (input.baseCurrency === "USD" && !input.autoUpdateExchangeRates) await promise;
    } });
    await selectUsd();
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("save_settings", { input: { baseCurrency: "USD", autoUpdateExchangeRates: false } }));
    fireEvent.click(screen.getByRole("switch", { name: "启动时自动更新汇率" }));
    resolve();
    await waitFor(() => expect(screen.getByRole("switch", { name: "启动时自动更新汇率" })).toBeChecked());
    expect(saved()).toMatchObject({ base_currency: "USD", auto_update_exchange_rates: true });
    expect(invoke).toHaveBeenLastCalledWith("save_settings", { input: { baseCurrency: "USD", autoUpdateExchangeRates: true } });
  });

  it("requires re-entry of a rate draft in the new unit after changing the base currency", async () => {
    setup({ rates: ["USD", "EUR"] });
    const eurRow = (await screen.findByText("EUR", { selector: "strong" })).closest<HTMLElement>(".rate-row")!;
    fireEvent.click(within(eurRow).getByRole("button", { name: "编辑" }));
    fireEvent.change(screen.getByLabelText("汇率值"), { target: { value: "8" } });
    await selectUsd();
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(await screen.findByRole("status")).toHaveTextContent("本位币已保存");
    const rate = screen.getByLabelText("汇率值");
    expect(rate).toHaveValue("8");
    expect(screen.getByRole("button", { name: "更新汇率" })).toBeDisabled();
    fireEvent.submit(rate.closest("form")!);
    expect(await screen.findByRole("alert")).toHaveTextContent("请按新的本位币重新输入汇率");
    expect(vi.mocked(invoke).mock.calls.some(([command]) => command === "upsert_exchange_rate")).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "取消编辑" }));
    expect(rate).toHaveValue("");
    fireEvent.change(screen.getByLabelText("汇率币种"), { target: { value: "GBP" } });
    fireEvent.change(rate, { target: { value: "1.25" } });
    fireEvent.click(screen.getByRole("button", { name: "添加汇率" }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("upsert_exchange_rate", { input: { currency: "GBP", rate: "1.25" } }));
  });
});
