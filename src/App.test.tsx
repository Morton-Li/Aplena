import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { App, ApplicationErrorBoundary } from "./App";
import { defaultActualEntryDate } from "./features/monthly/monthlyWorkspace";
import type { Invoke } from "./shared/api/domain";
import type {
  ActualEntry,
  BudgetProjection,
  InitializeMonthResult,
  ExchangeRate,
  MonthAnalytics,
  MonthPreview,
  MonthlyItem,
  PlanItem,
  Settings,
} from "./shared/api/finance";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

vi.mock("./shared/components/AnalyticsChart", () => ({
  AnalyticsChart: ({ label, option }: { label: string; option: unknown }) => (
    <div role="img" aria-label={label} data-chart-option={JSON.stringify(option)} />
  ),
}));

vi.mock("./shared/components/PieAnalyticsChart", () => ({
  PieAnalyticsChart: ({ label, option }: { label: string; option: unknown }) => (
    <div role="img" aria-label={label} data-chart-option={JSON.stringify(option)} />
  ),
}));

function BrokenScreen(): never {
  throw new Error("sensitive diagnostic must not reach the UI");
}

it("replaces unexpected render failures with a path-safe recovery message", () => {
  const errorOutput = vi.spyOn(console, "error").mockImplementation(() => undefined);
  render(
    <ApplicationErrorBoundary>
      <BrokenScreen />
    </ApplicationErrorBoundary>,
  );

  expect(screen.getByRole("heading", { name: "界面资源加载失败" })).toBeInTheDocument();
  expect(screen.queryByText(/sensitive diagnostic/)).not.toBeInTheDocument();
  errorOutput.mockRestore();
});

it("defaults actual-entry dates to today when today belongs to the active month", () => {
  expect(defaultActualEntryDate("2026-08", new Date(2026, 7, 31, 23, 30))).toBe("2026-08-31");
  expect(defaultActualEntryDate("2026-07", new Date(2026, 7, 31, 23, 30))).toBe("2026-07-01");
});

const contract = {
  categories: [
    { code: "FIXED_INCOME", label: "固定收入" },
    { code: "VARIABLE_INCOME", label: "浮动收入" },
    { code: "ESSENTIAL_EXPENSE", label: "必要支出" },
    { code: "FIXED_COMMITMENT_EXPENSE", label: "固定承诺支出" },
    { code: "DISCRETIONARY_BUDGET", label: "自主性预算" },
  ],
  flow_types: [
    { code: "INCOME", label: "收入" },
    { code: "EXPENSE", label: "支出" },
  ],
  recognition_modes: [
    { code: "AMORTIZED", label: "按月均摊" },
    { code: "PAYMENT", label: "按支付月份确认" },
  ],
  amount_decimal_places: 2,
  exchange_rate_decimal_places: 8,
};

const settings: Settings = {
  base_currency: "CNY",
  auto_update_exchange_rates: false,
  created_at: "2026-08-01T00:00:00Z",
  updated_at: "2026-08-01T00:00:00Z",
};

const baseRate = {
  currency: "CNY",
  base_currency: "CNY",
  rate: "1.00000000",
  is_base_currency: true,
  source: "BASE_CURRENCY" as const,
  observed_on: "2026-08-01",
  plan_reference_count: 0,
  updated_at: "2026-08-01T00:00:00Z",
};

const cachedUsdRate: ExchangeRate = {
  currency: "USD",
  base_currency: "CNY",
  rate: "7.10000000",
  is_base_currency: false,
  source: "MANUAL",
  observed_on: "2026-08-01",
  plan_reference_count: 0,
  updated_at: "2026-08-01T00:00:00Z",
};

function actualEntry(overrides: Partial<ActualEntry> = {}): ActualEntry {
  return {
    id: "00000000-0000-0000-0000-000000000501",
    monthly_item_id: "00000000-0000-0000-0000-000000000201",
    occurred_on: "2026-08-10",
    effect: "INCREASE",
    amount: "120.00",
    source_amount: "120.00",
    source_currency: "CNY",
    exchange_rate: "1.00000000",
    exchange_rate_source: "BASE_CURRENCY",
    exchange_rate_observed_on: "2026-08-10",
    origin: "USER",
    note: "首笔记录",
    created_at: "2026-08-10T00:00:00Z",
    updated_at: "2026-08-10T00:00:00Z",
    ...overrides,
  };
}

const examplePlan: PlanItem = {
  id: "00000000-0000-0000-0000-000000000101",
  name: "年度保险",
  category: "ESSENTIAL_EXPENSE",
  flow_type: "EXPENSE",
  planned_amount: "1200.00",
  currency: "CNY",
  period_months: 12,
  start_date: "2026-08-31",
  end_date: null,
  recognition_mode: "PAYMENT",
  note: null,
  created_at: "2026-08-01T00:00:00Z",
  updated_at: "2026-08-01T00:00:00Z",
  history_month_count: 1,
};

function monthlyItem(overrides: Partial<MonthlyItem> = {}): MonthlyItem {
  return {
    id: "00000000-0000-0000-0000-000000000201",
    source_plan_item_id: examplePlan.id,
    item_name: "电费",
    month: "2026-08",
    category: "ESSENTIAL_EXPENSE",
    flow_type: "EXPENSE",
    recognition_mode: "AMORTIZED",
    item_source: "PLANNED",
    item_origin: "PLAN_LINKED",
    scheduled_date: null,
    planned_amount: "300.00",
    actual_amount: null,
    actual_entry_count: 0,
    variance_amount: null,
    completion_rate_percent: null,
    variance_effect: "UNKNOWN",
    currency: "CNY",
    note: null,
    created_at: "2026-08-01T00:00:00Z",
    updated_at: "2026-08-01T00:00:00Z",
    ...overrides,
  };
}

function monthAnalytics(overrides: Partial<MonthAnalytics> = {}): MonthAnalytics {
  return {
    month: "2026-08",
    currency: "CNY",
    total_item_count: 3,
    planned_item_count: 3,
    income: {
      planned: "30000.00",
      actual_to_date: "28700.00",
      variance: "-1300.00",
      completion_percent: "95.67",
      variance_effect: "UNFAVORABLE",
    },
    expense: {
      planned: "9300.00",
      actual_to_date: "8427.00",
      variance: "-873.00",
      completion_percent: "90.61",
      variance_effect: "FAVORABLE",
    },
    net_balance: {
      planned: "20700.00",
      actual_to_date: "20273.00",
      variance: "-427.00",
      completion_percent: "97.94",
      variance_effect: "UNFAVORABLE",
    },
    planned_savings_rate_percent: "69.00",
    actual_savings_rate_percent: "70.64",
    savings_rate_percentage_point_variance: "1.64",
    savings_rate_plan_completion_percent: "102.38",
    categories: [
      {
        category: "FIXED_INCOME",
        flow_type: "INCOME",
        planned_amount: "30000.00",
        actual_to_date: "28700.00",
        planned_share_percent: "100.00",
        actual_share_percent: "100.00",
      },
      {
        category: "VARIABLE_INCOME",
        flow_type: "INCOME",
        planned_amount: "0.00",
        actual_to_date: null,
        planned_share_percent: "0.00",
        actual_share_percent: null,
      },
      {
        category: "ESSENTIAL_EXPENSE",
        flow_type: "EXPENSE",
        planned_amount: "6300.00",
        actual_to_date: "6427.00",
        planned_share_percent: "67.74",
        actual_share_percent: "76.27",
      },
      {
        category: "FIXED_COMMITMENT_EXPENSE",
        flow_type: "EXPENSE",
        planned_amount: "2000.00",
        actual_to_date: "2000.00",
        planned_share_percent: "21.51",
        actual_share_percent: "23.73",
      },
      {
        category: "DISCRETIONARY_BUDGET",
        flow_type: "EXPENSE",
        planned_amount: "1000.00",
        actual_to_date: null,
        planned_share_percent: "10.75",
        actual_share_percent: null,
      },
    ],
    projects: [
      {
        monthly_item_id: "salary",
        name: "工资",
        category: "FIXED_INCOME",
        flow_type: "INCOME",
        planned_amount: "30000.00",
        actual_amount: "28700.00",
        variance_amount: "-1300.00",
        variance_effect: "UNFAVORABLE",
        planned_share_percent: "100.00",
        actual_share_percent: "100.00",
        planned_rank: 1,
        actual_rank: 1,
      },
      {
        monthly_item_id: "rent",
        name: "房租",
        category: "ESSENTIAL_EXPENSE",
        flow_type: "EXPENSE",
        planned_amount: "6000.00",
        actual_amount: null,
        variance_amount: null,
        variance_effect: "UNKNOWN",
        planned_share_percent: "64.52",
        actual_share_percent: null,
        planned_rank: 1,
        actual_rank: null,
      },
      {
        monthly_item_id: "electricity",
        name: "电费",
        category: "ESSENTIAL_EXPENSE",
        flow_type: "EXPENSE",
        planned_amount: "300.00",
        actual_amount: "427.00",
        variance_amount: "127.00",
        variance_effect: "UNFAVORABLE",
        planned_share_percent: "3.23",
        actual_share_percent: "5.07",
        planned_rank: 2,
        actual_rank: 1,
      },
    ],
    important_variances: [
      {
        monthly_item_id: "electricity",
        name: "电费",
        category: "ESSENTIAL_EXPENSE",
        flow_type: "EXPENSE",
        planned_amount: "300.00",
        actual_amount: "427.00",
        variance_amount: "127.00",
        variance_effect: "UNFAVORABLE",
        planned_share_percent: "3.23",
        actual_share_percent: "5.07",
        planned_rank: 2,
        actual_rank: 1,
      },
    ],
    ...overrides,
  };
}

const projection: BudgetProjection = {
  target_month: "2026-09",
  base_currency: "CNY",
  stable_income: "30000.00",
  variable_income: "3000.00",
  essential_expenses: "6000.00",
  fixed_commitments: "3000.00",
  discretionary_budget: "2000.00",
  projected_income: "33000.00",
  projected_expenses: "11000.00",
  projected_savings: "22000.00",
  projected_savings_rate_percent: "66.67",
  fixed_commitment_ratio_percent: "10.00",
  stable_income_coverage_ratio: "3.33",
};

interface HarnessOptions {
  settings?: Settings | null;
  rates?: ExchangeRate[];
  plans?: PlanItem[];
  monthly?: Record<string, MonthlyItem[]>;
  startupCreated?: number;
  missingCurrency?: string;
  rejectCommand?: { command: string; error: unknown };
  analytics?: MonthAnalytics;
  history?: MonthAnalytics[];
  projection?: BudgetProjection;
  actualEntries?: Record<string, ActualEntry[]>;
}

function installHarness(options: HarnessOptions = {}) {
  let storedSettings = options.settings === undefined ? settings : options.settings;
  let storedRates = [...(options.rates ?? [baseRate])];
  const plans = [...(options.plans ?? [])];
  const monthly = { ...(options.monthly ?? {}) };
  const actualEntries = Object.fromEntries(
    Object.entries(options.actualEntries ?? {}).map(([itemId, entries]) => [itemId, [...entries]]),
  );
  const initialized = new Set<string>();
  const invoke: Invoke = async <T,>(command: string, args?: Record<string, unknown>) => {
    if (options.rejectCommand?.command === command) {
      throw options.rejectCommand.error;
    }
    switch (command) {
      case "get_domain_contract":
        return contract as T;
      case "get_settings":
        return storedSettings as T;
      case "ensure_default_settings": {
        if (!storedSettings) {
          storedSettings = {
            base_currency: "CNY",
            auto_update_exchange_rates: false,
            created_at: "2026-08-01T00:00:00Z",
            updated_at: "2026-08-01T00:00:00Z",
          };
        }
        return storedSettings as T;
      }
      case "save_settings": {
        const input = args?.input as { baseCurrency: string; autoUpdateExchangeRates: boolean };
        storedSettings = {
          base_currency: input.baseCurrency,
          auto_update_exchange_rates: input.autoUpdateExchangeRates,
          created_at: "2026-08-01T00:00:00Z",
          updated_at: "2026-08-01T00:00:00Z",
        };
        return storedSettings as T;
      }
      case "get_startup_status":
        return {
          current_month: "2026-08",
          initialization: {
            month: "2026-08",
            created_count: options.startupCreated ?? 0,
            skipped_existing_count: 1,
            excluded_count: 0,
            warnings: [],
          },
          error: null,
        } as T;
      case "list_exchange_rates":
        return storedRates as T;
      case "import_reference_rates": {
        const input = args?.input as { observations: { currency: string; euroRate: string; observedOn: string }[]; currencies: string[] };
        const baseCurrency = storedSettings?.base_currency ?? "CNY";
        const baseObservation = input.observations.find((observation) => observation.currency === baseCurrency);
        for (const currency of input.currencies) {
          const observation = input.observations.find((candidate) => candidate.currency === currency);
          if (!baseObservation || !observation) continue;
          const rate = (Number(baseObservation.euroRate) / Number(observation.euroRate)).toFixed(8);
          storedRates = storedRates.filter((candidate) => candidate.currency !== currency);
          storedRates.push({
            currency,
            base_currency: baseCurrency,
            rate,
            is_base_currency: false,
            source: "ECB_REFERENCE",
            observed_on: observation.observedOn,
            plan_reference_count: 0,
            updated_at: "2026-08-28T00:00:00Z",
          });
        }
        return storedRates as T;
      }
      case "list_existing_months":
        return Object.keys(monthly) as T;
      case "list_plan_items":
        return plans as T;
      case "get_month_analytics": {
        const requestedMonth = args?.month as string;
        return {
          ...(options.analytics ?? monthAnalytics()),
          month: requestedMonth,
        } as T;
      }
      case "get_history_analytics":
        return { months: options.history ?? [options.analytics ?? monthAnalytics()] } as T;
      case "get_budget_projection":
        return (options.projection ?? projection) as T;
      case "preview_plan_item": {
        const request = args?.request as {
          planItem: { recognitionMode: string };
        };
        return {
          effective: true,
          recognized_in_target_month: request.planItem.recognitionMode === "AMORTIZED",
          monthly_equivalent: "100.00",
          recognized_amount:
            request.planItem.recognitionMode === "AMORTIZED" ? "100.00" : null,
          scheduled_date: request.planItem.recognitionMode === "PAYMENT" ? "2026-08-31" : null,
          base_currency: "CNY",
        } as T;
      }
      case "create_plan_item": {
        const input = args?.input as {
          name: string;
          category: string;
          recognitionMode: string;
        };
        const created = {
          ...examplePlan,
          id: "00000000-0000-0000-0000-000000000301",
          name: input.name,
          category: input.category,
          recognition_mode: input.recognitionMode,
        };
        plans.push(created);
        return created as T;
      }
      case "update_plan_item":
        return examplePlan as T;
      case "preview_month": {
        const input = args?.input as { month: string };
        const direction =
          input.month < "2026-08" ? "HISTORICAL" : input.month > "2026-08" ? "FUTURE" : "CURRENT";
        const missing = options.missingCurrency ? [options.missingCurrency] : [];
        return {
          month: input.month,
          direction,
          requires_confirmation: direction !== "CURRENT",
          existing_count: monthly[input.month]?.length ?? 0,
          candidate_count: missing.length ? 0 : 1,
          excluded_count: 0,
          missing_currencies: missing,
          warnings: direction === "HISTORICAL" ? ["BACKFILL_RATE_MAY_NOT_REPRESENT_HISTORY"] : [],
          items: [],
        } satisfies MonthPreview as T;
      }
      case "initialize_month": {
        const input = args?.input as { month: string };
        initialized.add(input.month);
        return {
          month: input.month,
          created_count: 1,
          skipped_existing_count: 0,
          excluded_count: 0,
          warnings: [],
        } satisfies InitializeMonthResult as T;
      }
      case "list_monthly_items": {
        const month = args?.month as string;
        return (monthly[month] ?? (initialized.has(month) ? [monthlyItem({ month })] : [])) as T;
      }
      case "list_actual_entries": {
        const monthlyItemId = args?.monthlyItemId as string;
        return (actualEntries[monthlyItemId] ?? []) as T;
      }
      case "ensure_actual_only_monthly_item":
        return monthlyItem({ item_source: "ACTUAL_ONLY", planned_amount: "0.00" }) as T;
      case "create_manual_monthly_item": {
        const input = args?.input as { name: string; month: string; category: string; note?: string };
        const created = monthlyItem({
          id: "00000000-0000-0000-0000-000000000698",
          source_plan_item_id: null,
          item_name: input.name,
          month: input.month,
          category: input.category,
          flow_type: ["FIXED_INCOME", "VARIABLE_INCOME"].includes(input.category) ? "INCOME" : "EXPENSE",
          item_source: "ACTUAL_ONLY",
          item_origin: "MANUAL",
          planned_amount: "0.00",
          note: input.note ?? null,
        });
        monthly[input.month] = [...(monthly[input.month] ?? []), created];
        return created as T;
      }
      case "create_actual_entry":
      case "update_actual_entry": {
        const input = args?.input as { id?: string; monthlyItemId: string; occurredOn: string; effect: string; amount: string; currency: string; exchangeRate: string; exchangeRateSource: "BASE_CURRENCY" | "ECB_REFERENCE" | "MANUAL"; exchangeRateObservedOn: string; note?: string };
        const saved = { id: input.id ?? "00000000-0000-0000-0000-000000000599", monthly_item_id: input.monthlyItemId, occurred_on: input.occurredOn, effect: input.effect, amount: input.amount, source_amount: input.amount, source_currency: input.currency, exchange_rate: input.exchangeRate, exchange_rate_source: input.exchangeRateSource, exchange_rate_observed_on: input.exchangeRateObservedOn, origin: "USER", note: input.note ?? null, created_at: "2026-08-01T00:00:00Z", updated_at: "2026-08-01T00:00:00Z" } as ActualEntry;
        const entries = actualEntries[input.monthlyItemId] ?? [];
        actualEntries[input.monthlyItemId] = input.id
          ? entries.map((entry) => entry.id === input.id ? saved : entry)
          : [...entries, saved];
        return saved as T;
      }
      case "delete_actual_entry": {
        const id = args?.id as string;
        for (const [itemId, entries] of Object.entries(actualEntries)) {
          actualEntries[itemId] = entries.filter((entry) => entry.id !== id);
        }
        return undefined as T;
      }
      case "update_monthly_note":
        return monthlyItem() as T;
      case "delete_manual_monthly_item": {
        const id = (args?.input as { id: string }).id;
        for (const month of Object.keys(monthly)) {
          monthly[month] = monthly[month].filter((item) => item.id !== id);
        }
        delete actualEntries[id];
        return undefined as T;
      }
      case "delete_plan_item":
        return undefined as T;
      case "stop_plan_item":
        return examplePlan as T;
      default:
        throw new Error("Unhandled command in test: " + command);
    }
  };
  invokeMock.mockImplementation(invoke);
}

describe("planning workflows", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    invokeMock.mockReset();
    window.location.hash = "";
  });

  it("creates the default CNY baseline and opens the dashboard without a setup screen", async () => {
    installHarness({ settings: null });
    render(<App />);

    await screen.findByRole("heading", { name: "2026 年 8 月" });
    const navigation = screen.getByRole("navigation");
    expect(within(navigation).getAllByRole("link").map((link) => link.textContent)).toEqual([
      "总览",
      "月度执行",
      "历史报表",
      "配置预算",
      "设置",
    ]);
    expect(screen.queryByRole("link", { name: /长期规划/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "财务分析" })).not.toBeInTheDocument();
    expect(screen.queryByText("建立你的财务基准")).not.toBeInTheDocument();
    expect(screen.queryByText("实际数据完成度")).not.toBeInTheDocument();
    expect(document.querySelector("[data-tauri-drag-region]")).toHaveClass("window-drag-region");
    expect(invokeMock).toHaveBeenCalledWith("ensure_default_settings");
  });

  it("keeps settings limited to financial configuration", async () => {
    installHarness();
    window.location.hash = "#/settings";
    render(<App />);

    expect(await screen.findByRole("heading", { name: "系统设置" })).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "本位币" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "当前汇率" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "更新官方汇率" })).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "启动时自动更新汇率" })).not.toBeChecked();
    expect(screen.getByText(/欧洲央行每日参考汇率通常在工作日更新/)).toBeInTheDocument();
    expect(screen.queryByText(/尚无月度快照时可以直接切换/)).not.toBeInTheDocument();
    expect(document.querySelectorAll(".base-currency-setting")).toHaveLength(1);
    expect(document.querySelectorAll(".settings-card")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "保存" })).toBeDisabled();
    expect(screen.queryByLabelText("下月目标储蓄率")).not.toBeInTheDocument();
  });

  it("persists the automatic exchange-rate update preference", async () => {
    installHarness();
    const user = userEvent.setup();
    window.location.hash = "#/settings";
    render(<App />);

    const toggle = await screen.findByRole("switch", { name: "启动时自动更新汇率" });
    await user.click(toggle);

    await waitFor(() => expect(toggle).toBeChecked());
    expect(invokeMock).toHaveBeenCalledWith("save_settings", {
      input: { baseCurrency: "CNY", autoUpdateExchangeRates: true },
    });
  });

  it("updates official exchange rates once during startup when enabled", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response([
      "KEY,FREQ,CURRENCY,CURRENCY_DENOM,EXR_TYPE,EXR_SUFFIX,TIME_PERIOD,OBS_VALUE",
      "EXR.D.CNY.EUR.SP00.A,D,CNY,EUR,SP00,A,2026-08-28,7.8251",
      "EXR.D.USD.EUR.SP00.A,D,USD,EUR,SP00,A,2026-08-28,1.1643",
      "EXR.D.HKD.EUR.SP00.A,D,HKD,EUR,SP00,A,2026-08-28,9.1000",
      "EXR.D.JPY.EUR.SP00.A,D,JPY,EUR,SP00,A,2026-08-28,172.0000",
      "EXR.D.GBP.EUR.SP00.A,D,GBP,EUR,SP00,A,2026-08-28,0.8600",
    ].join("\n"), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    installHarness({ settings: { ...settings, auto_update_exchange_rates: true } });
    render(<App />);

    await screen.findByRole("heading", { name: "2026 年 8 月" });
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("import_reference_rates", expect.anything()));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not block the application when an automatic startup update fails", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("offline"));
    vi.stubGlobal("fetch", fetchMock);
    installHarness({ settings: { ...settings, auto_update_exchange_rates: true } });
    render(<App />);

    expect(await screen.findByRole("heading", { name: "2026 年 8 月" })).toBeInTheDocument();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("heading", { name: "本地财务服务暂不可用" })).not.toBeInTheDocument();
  });

  it("updates saved and rule currencies from the latest ECB observation date", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response([
      "KEY,FREQ,CURRENCY,CURRENCY_DENOM,EXR_TYPE,EXR_SUFFIX,TIME_PERIOD,OBS_VALUE",
      "EXR.D.USD.EUR.SP00.A,D,USD,EUR,SP00,A,2026-08-28,1.1643",
      "EXR.D.CNY.EUR.SP00.A,D,CNY,EUR,SP00,A,2026-08-28,7.8251",
      "EXR.D.EUR.EUR.SP00.A,D,EUR,EUR,SP00,A,2026-08-28,1",
    ].join("\n"), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    installHarness({
      rates: [baseRate, cachedUsdRate],
      plans: [{ ...examplePlan, currency: "EUR" }],
    });
    const user = userEvent.setup();
    window.location.hash = "#/settings";
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "更新官方汇率" }));
    expect(await screen.findByText(/已更新 2 个币种的欧洲央行每日参考汇率.*参考日期 2026-08-28.*既有费用的汇率快照未作修改/)).toBeInTheDocument();
    expect(invokeMock).toHaveBeenCalledWith("import_reference_rates", {
      input: expect.objectContaining({ currencies: ["USD", "EUR"] }),
    });
  });

  it("imports every supported foreign currency on a fresh database", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response([
      "KEY,FREQ,CURRENCY,CURRENCY_DENOM,EXR_TYPE,EXR_SUFFIX,TIME_PERIOD,OBS_VALUE",
      "EXR.D.CNY.EUR.SP00.A,D,CNY,EUR,SP00,A,2026-08-28,7.8251",
      "EXR.D.USD.EUR.SP00.A,D,USD,EUR,SP00,A,2026-08-28,1.1643",
      "EXR.D.HKD.EUR.SP00.A,D,HKD,EUR,SP00,A,2026-08-28,9.1000",
      "EXR.D.JPY.EUR.SP00.A,D,JPY,EUR,SP00,A,2026-08-28,172.0000",
      "EXR.D.GBP.EUR.SP00.A,D,GBP,EUR,SP00,A,2026-08-28,0.8600",
    ].join("\n"), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    installHarness({ rates: [baseRate], plans: [] });
    const user = userEvent.setup();
    window.location.hash = "#/settings";
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "更新官方汇率" }));
    expect(await screen.findByText(/已更新 5 个币种.*参考日期 2026-08-28/)).toBeInTheDocument();
    expect(invokeMock).toHaveBeenCalledWith("import_reference_rates", {
      input: expect.objectContaining({ currencies: ["USD", "EUR", "HKD", "JPY", "GBP"] }),
    });
    for (const currency of ["USD", "EUR", "HKD", "JPY", "GBP"]) {
      expect(screen.getByText(currency)).toBeInTheDocument();
    }
  });

  it("derives the next-month budget projection and expense mix from recurring rules", async () => {
    installHarness({ plans: [examplePlan] });
    const user = userEvent.setup();
    window.location.hash = "#/goals";
    render(<App />);

    await screen.findByRole("heading", { name: "配置预算" });
    await screen.findByText("2026-09", { selector: ".goal-month-badge strong" });
    expect(screen.getByRole("heading", { name: "配置预算" }).parentElement).toHaveTextContent("2026 年 9 月");
    expect(screen.getByRole("heading", { name: "下月预算概览" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "支出类型占比" })).toBeInTheDocument();
    expect(screen.queryByLabelText("下月目标储蓄率")).not.toBeInTheDocument();
    expect(screen.queryByText("剩余能力")).not.toBeInTheDocument();
    const rulesTable = screen.getByRole("table", { name: "周期规则" });
    const ruleRow = within(rulesTable).getByRole("row", { name: /年度保险/ });
    expect(ruleRow).toHaveTextContent("¥ 1,200.00");
    expect(ruleRow).toHaveTextContent("12 个月");
    expect(ruleRow).toHaveTextContent("按支付月份确认");
    expect(ruleRow).toHaveTextContent("2026-08-31");
    expect(ruleRow).toHaveTextContent("长期有效");
    expect(within(ruleRow).getByRole("button", { name: "编辑" })).toBeInTheDocument();
    expect(within(ruleRow).getByRole("button", { name: "删除" })).toBeInTheDocument();
    expect(within(ruleRow).queryByRole("button", { name: "停止" })).not.toBeInTheDocument();
    const projectionChart = screen.getByRole("img", { name: "2026-09预计收入、支出与储蓄柱状图" });
    const projectionOption = JSON.parse(projectionChart.dataset.chartOption ?? "{}") as {
      series: Array<{ data: number[] }>;
    };
    expect(projectionOption.series[0].data).toEqual([33000, 11000, 22000]);
    const categoryChart = screen.getByRole("img", { name: "2026-09支出类型金额占比饼图" });
    const categoryOption = JSON.parse(categoryChart.dataset.chartOption ?? "{}") as {
      series: Array<{ data: Array<{ name: string; value: number }> }>;
    };
    expect(categoryOption.series[0].data.map(({ name, value }) => [name, value])).toEqual([
      ["必要支出", 6000],
      ["固定承诺", 3000],
      ["自主预算", 2000],
    ]);
    const overviewCard = screen.getByRole("heading", { name: "下月预算概览" }).closest("section");
    expect(overviewCard).not.toBeNull();
    await user.click(within(overviewCard!).getByRole("button", { name: "查看精确数据" }));
    expect(within(overviewCard!).getByRole("table", { name: "2026-09预算测算明细" })).toBeInTheDocument();
    expect(invokeMock).not.toHaveBeenCalledWith("get_next_month_goal");
    expect(invokeMock).not.toHaveBeenCalledWith("save_next_month_goal", expect.anything());
  });

  it("previews and creates an AMORTIZED plan without frontend financial arithmetic", async () => {
    installHarness();
    const user = userEvent.setup();
    window.location.hash = "#/goals";
    render(<App />);
    await user.click(await screen.findByRole("button", { name: "新建周期规则" }));
    await user.type(screen.getByLabelText("项目名称"), "云服务器");
    await user.type(screen.getByLabelText("计划金额"), "1200");
    await user.click(screen.getByRole("button", { name: "预览并检查" }));

    expect((await screen.findAllByText("¥ 100.00")).length).toBeGreaterThan(0);
    await user.click(screen.getByRole("button", { name: "确认保存" }));
    expect(await screen.findByText(/周期规则已保存/)).toBeInTheDocument();
    expect(invokeMock).toHaveBeenCalledWith(
      "create_plan_item",
      expect.objectContaining({
        input: expect.objectContaining({ recognitionMode: "AMORTIZED" }),
      }),
    );
  });

  it("explains PAYMENT mode and displays a payment-month preview before save", async () => {
    installHarness();
    const user = userEvent.setup();
    window.location.hash = "#/goals";
    render(<App />);
    await user.click(await screen.findByRole("button", { name: "新建周期规则" }));
    await user.type(screen.getByLabelText("项目名称"), "年度保险");
    await user.type(screen.getByLabelText("计划金额"), "1200");
    await user.click(screen.getByRole("radio", { name: /按支付月份确认/ }));
    expect(screen.getByText("只在以开始日期为锚点的支付月计入完整金额。")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "预览并检查" }));
    expect(await screen.findByText("不会")).toBeInTheDocument();
    expect(screen.getByText("无论哪种模式，下月预算概览都按月均等价金额计算。")).toBeInTheDocument();
  });

  it("keeps the detail drawer open while a new entry defaults to today", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    installHarness({
      plans: [examplePlan],
      startupCreated: 2,
      monthly: {
        "2026-08": [
          monthlyItem(),
        ],
      },
    });
    const user = userEvent.setup();
    window.location.hash = "#/monthly";
    render(<App />);

    expect(await screen.findByText(/当前月已自动检查：新增 2 项/)).toBeInTheDocument();
    await user.click(await screen.findByRole("button", { name: "查看 电费 详情" }));
    expect(await screen.findByRole("dialog", { name: "电费" })).toBeInTheDocument();
    expect(await screen.findByText("还没有实际条目")).toBeInTheDocument();
    expect(screen.getAllByText("¥ 300.00").length).toBeGreaterThan(0);
    await user.click(screen.getByRole("button", { name: "添加支出或退款" }));
    expect(screen.getByRole("dialog", { name: "电费" })).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "添加支出或退款" })).toBeInTheDocument();
    const expectedDate = defaultActualEntryDate("2026-08");
    expect(screen.getByLabelText("日期")).toHaveValue(expectedDate);
    const amountInput = screen.getByLabelText("原币金额");
    expect(amountInput).toHaveFocus();
    await user.type(amountInput, "427.25");
    await user.click(screen.getByLabelText("类型"));
    await user.click(screen.getByRole("option", { name: "退款" }));
    await user.click(screen.getByRole("button", { name: "保存条目" }));
    expect(invokeMock).toHaveBeenCalledWith("create_actual_entry", {
      input: expect.objectContaining({ amount: "427.25", effect: "DECREASE", occurredOn: expectedDate }),
    });
    expect(await screen.findByRole("dialog", { name: "电费" })).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refreshes the official reference rate before saving a new foreign-currency entry", async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(new Response([
      "KEY,FREQ,CURRENCY,CURRENCY_DENOM,EXR_TYPE,EXR_SUFFIX,TIME_PERIOD,OBS_VALUE",
      "EXR.D.USD.EUR.SP00.A,D,USD,EUR,SP00,A,2026-08-28,1.1643",
      "EXR.D.CNY.EUR.SP00.A,D,CNY,EUR,SP00,A,2026-08-28,7.8251",
    ].join("\n"), { status: 200 })));
    vi.stubGlobal("fetch", fetchMock);
    installHarness({
      rates: [baseRate, cachedUsdRate],
      monthly: { "2026-08": [monthlyItem()] },
    });
    const user = userEvent.setup();
    window.location.hash = "#/monthly";
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "查看 电费 详情" }));
    await user.click(await screen.findByRole("button", { name: "添加支出或退款" }));
    await user.click(screen.getByLabelText("实际条目币种"));
    await user.click(screen.getByRole("option", { name: /USD/ }));
    expect(await screen.findByText(/欧洲央行每日参考汇率 · 2026-08-28 · 保存后固定/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("原币金额"), { target: { value: "100.00" } });
    await user.click(screen.getByRole("button", { name: "保存条目" }));

    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("create_actual_entry", {
      input: expect.objectContaining({
        amount: "100.00",
        currency: "USD",
        exchangeRate: "6.72086232",
        exchangeRateSource: "ECB_REFERENCE",
        exchangeRateObservedOn: "2026-08-28",
      }),
    }));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("keeps the dated cached rate as a visible fallback when ECB is unavailable", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("offline"));
    vi.stubGlobal("fetch", fetchMock);
    installHarness({
      rates: [baseRate, cachedUsdRate],
      monthly: { "2026-08": [monthlyItem()] },
    });
    const user = userEvent.setup();
    window.location.hash = "#/monthly";
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "查看 电费 详情" }));
    await user.click(await screen.findByRole("button", { name: "添加支出或退款" }));
    await user.click(screen.getByLabelText("实际条目币种"));
    await user.click(screen.getByRole("option", { name: /USD/ }));
    expect(await screen.findByText(/备用手动汇率 · 2026-08-01 · 保存后固定/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("原币金额"), { target: { value: "25.00" } });
    await user.click(screen.getByRole("button", { name: "保存条目" }));

    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("create_actual_entry", {
      input: expect.objectContaining({
        amount: "25.00",
        currency: "USD",
        exchangeRate: "7.10000000",
        exchangeRateSource: "MANUAL",
        exchangeRateObservedOn: "2026-08-01",
      }),
    }));
  });

  it("creates a temporary category without synthesizing an actual entry", async () => {
    installHarness({ plans: [], monthly: { "2026-08": [] } });
    const user = userEvent.setup();
    window.location.hash = "#/monthly";
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "添加临时类目" }));
    await user.type(screen.getByLabelText("类目名称"), "本月房租");
    await user.click(screen.getByRole("button", { name: "创建临时类目" }));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("create_manual_monthly_item", {
        input: {
          name: "本月房租",
          month: "2026-08",
          category: "ESSENTIAL_EXPENSE",
        },
      });
    });
    expect(await screen.findByRole("dialog", { name: "本月房租" })).toBeInTheDocument();
    expect(invokeMock.mock.calls.some(([command]) => command === "create_actual_entry")).toBe(false);
    expect(invokeMock.mock.calls.some(([command]) => command === "ensure_actual_only_monthly_item")).toBe(false);
  });

  it("deletes a temporary category only after explicit confirmation", async () => {
    const temporary = monthlyItem({
      source_plan_item_id: null,
      item_name: "临时维修",
      item_origin: "MANUAL",
      item_source: "ACTUAL_ONLY",
      planned_amount: "0.00",
      actual_entry_count: 1,
    });
    installHarness({ monthly: { "2026-08": [temporary] }, actualEntries: { [temporary.id]: [actualEntry()] } });
    const user = userEvent.setup();
    window.location.hash = "#/monthly";
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "查看 临时维修 详情" }));
    await user.click(screen.getByRole("button", { name: "删除临时类目" }));
    expect(screen.getByRole("dialog", { name: "临时维修" })).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "确认删除“临时维修”？" })).toHaveTextContent("1 条实际记录");
    await user.click(screen.getByRole("button", { name: "取消" }));
    expect(invokeMock.mock.calls.some(([command]) => command === "delete_manual_monthly_item")).toBe(false);
    await user.click(screen.getByRole("button", { name: "删除临时类目" }));
    await user.click(screen.getByRole("button", { name: "确认删除临时类目" }));
    expect(invokeMock).toHaveBeenCalledWith("delete_manual_monthly_item", { input: { id: temporary.id } });
  });

  it("adds refunds to an existing manual expense even when an income rule exists", async () => {
    const manualExpense = monthlyItem({
      source_plan_item_id: null,
      item_name: "临时维修",
      item_origin: "MANUAL",
      item_source: "ACTUAL_ONLY",
      planned_amount: "0.00",
    });
    installHarness({
      plans: [{ ...examplePlan, category: "FIXED_INCOME", flow_type: "INCOME" }],
      monthly: { "2026-08": [manualExpense] },
      actualEntries: { [manualExpense.id]: [actualEntry()] },
    });
    const user = userEvent.setup();
    window.location.hash = "#/monthly";
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "查看 临时维修 详情" }));
    await user.click(await screen.findByRole("button", { name: "添加支出或退款" }));
    await user.click(screen.getByLabelText("类型"));
    expect(screen.getByRole("option", { name: "退款" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "冲减" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("option", { name: "退款" }));
    const refundAmount = screen.getByLabelText("原币金额");
    fireEvent.change(refundAmount, { target: { value: "20.00" } });
    expect(refundAmount).toHaveValue("20.00");
    const save = screen.getByRole("button", { name: "保存条目" });
    expect(save).toBeEnabled();
    await user.click(save);

    expect(invokeMock).toHaveBeenCalledWith("create_actual_entry", {
      input: expect.objectContaining({
        monthlyItemId: manualExpense.id,
        effect: "DECREASE",
        amount: "20.00",
      }),
    });
  });

  it("uses an existing manual income flow and edits its amount and note without a plan", async () => {
    const manualIncome = monthlyItem({
      source_plan_item_id: null,
      item_name: "临时收入",
      category: "VARIABLE_INCOME",
      flow_type: "INCOME",
      item_origin: "MANUAL",
      item_source: "ACTUAL_ONLY",
      planned_amount: "0.00",
      actual_amount: "120.00",
      actual_entry_count: 1,
    });
    const incomeEntry = actualEntry({ monthly_item_id: manualIncome.id });
    installHarness({
      plans: [],
      monthly: { "2026-08": [manualIncome] },
      actualEntries: { [manualIncome.id]: [incomeEntry] },
    });
    const user = userEvent.setup();
    window.location.hash = "#/monthly";
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "查看 临时收入 详情" }));
    await user.click((await screen.findAllByRole("button", { name: "编辑" }))[0]);
    await user.click(screen.getByLabelText("类型"));
    expect(screen.getByRole("option", { name: "冲减" })).toBeInTheDocument();
    await user.click(screen.getByRole("option", { name: "冲减" }));
    const editedAmount = screen.getByLabelText("原币金额");
    fireEvent.change(editedAmount, { target: { value: "135.50" } });
    expect(editedAmount).toHaveValue("135.50");
    const editedNote = screen.getByLabelText("备注（可选）");
    fireEvent.change(editedNote, { target: { value: "核对后调整" } });
    expect(editedNote).toHaveValue("核对后调整");
    expect(screen.getByRole("button", { name: "保存条目" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "保存条目" }));

    expect(invokeMock).toHaveBeenCalledWith("update_actual_entry", {
      input: expect.objectContaining({
        id: incomeEntry.id,
        amount: "135.50",
        note: "核对后调整",
        exchangeRate: "1.00000000",
      }),
    });
  });

  it("shows supported foreign currencies on a fresh database and resolves the selected rate", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response([
      "KEY,FREQ,CURRENCY,CURRENCY_DENOM,EXR_TYPE,EXR_SUFFIX,TIME_PERIOD,OBS_VALUE",
      "EXR.D.USD.EUR.SP00.A,D,USD,EUR,SP00,A,2026-08-28,1.1643",
      "EXR.D.CNY.EUR.SP00.A,D,CNY,EUR,SP00,A,2026-08-28,7.8251",
    ].join("\n"), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    installHarness({ rates: [baseRate], monthly: { "2026-08": [monthlyItem()] } });
    const user = userEvent.setup();
    window.location.hash = "#/monthly";
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "查看 电费 详情" }));
    await user.click(await screen.findByRole("button", { name: "添加支出或退款" }));
    await user.click(screen.getByLabelText("实际条目币种"));
    await user.click(screen.getByRole("option", { name: /USD/ }));
    expect(await screen.findByText(/1 USD = 6\.72086232 CNY/)).toBeInTheDocument();
  });

  it("confirms actual-entry deletion in-app and keeps cancel and Escape non-destructive", async () => {
    const item = monthlyItem({ actual_amount: "120.00", actual_entry_count: 1 });
    const entry = actualEntry({ monthly_item_id: item.id });
    installHarness({
      monthly: { "2026-08": [item] },
      actualEntries: { [item.id]: [entry] },
    });
    const user = userEvent.setup();
    window.location.hash = "#/monthly";
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "查看 电费 详情" }));
    await user.click((await screen.findAllByRole("button", { name: "删除" }))[0]);
    expect(await screen.findByRole("dialog", { name: "确认删除这条记录？" })).toHaveTextContent("2026-08-10");
    expect(screen.getByRole("dialog", { name: "电费" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "取消" }));
    expect(invokeMock.mock.calls.some(([command]) => command === "delete_actual_entry")).toBe(false);

    await user.click(screen.getByRole("button", { name: "删除" }));
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "确认删除这条记录？" })).not.toBeInTheDocument();
    expect(invokeMock.mock.calls.some(([command]) => command === "delete_actual_entry")).toBe(false);

    await user.click(screen.getByRole("button", { name: "删除" }));
    const confirmDelete = screen.getByRole("button", { name: "确认删除" });
    confirmDelete.focus();
    await user.keyboard("{Enter}");
    await waitFor(() => expect(invokeMock.mock.calls.filter(([command]) => command === "delete_actual_entry")).toHaveLength(1));
    expect(await screen.findByText("还没有实际条目")).toBeInTheDocument();
  });

  it("keeps monthly execution fixed to the current natural month", async () => {
    installHarness({
      settings,
      monthly: { "2026-08": [monthlyItem()] },
    });
    window.location.hash = "#/monthly";
    render(<App />);
    expect(await screen.findByRole("heading", { name: "2026 年 8 月" })).toBeInTheDocument();
    expect(screen.queryByLabelText("查看月份")).not.toBeInTheDocument();
    expect(invokeMock).toHaveBeenCalledWith("list_monthly_items", { month: "2026-08" });
    expect(invokeMock.mock.calls.some(([command, args]) => command === "list_monthly_items" && (args as { month?: string })?.month === "2026-01")).toBe(false);
  });

  it("redirects the legacy plans route into the next-month goals page", async () => {
    installHarness();
    window.location.hash = "#/plans";
    render(<App />);
    expect(await screen.findByRole("heading", { name: "配置预算" })).toBeInTheDocument();
    expect(await screen.findByText("2026-09", { selector: ".goal-month-badge strong" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "周期规则" })).toBeInTheDocument();
  });

  it("redirects the legacy analysis route to the current month report", async () => {
    installHarness();
    window.location.hash = "#/analysis";
    render(<App />);

    expect(await screen.findByRole("heading", { name: "2026 年 8 月" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "月度执行结果" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "← 返回历史报表" })).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "相邻月份" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "财务分析" })).not.toBeInTheDocument();
  });

  it("does not expose category status or completion confirmation controls", async () => {
    installHarness({ monthly: { "2026-08": [monthlyItem()] } });
    window.location.hash = "#/monthly";
    render(<App />);
    const table = await screen.findByRole("table", { name: "本月类目、计划金额、实际金额、偏差、完成率和实际条目数量" });
    expect(within(table).queryByRole("columnheader", { name: "状态" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /确认.*完成/ })).not.toBeInTheDocument();
    expect(screen.getByLabelText("本月类目摘要")).toHaveTextContent("预算类目");
  });

  it("searches and filters monthly projects, then opens an accessible lazy detail drawer", async () => {
    installHarness({
      monthly: {
        "2026-08": [
          monthlyItem(),
          monthlyItem({
            id: "00000000-0000-0000-0000-000000000202",
            item_name: "餐饮",
            note: "工作餐",
            actual_amount: "240.00",
            actual_entry_count: 2,
            variance_amount: "-60.00",
            completion_rate_percent: "80.00",
            variance_effect: "FAVORABLE",
          }),
          monthlyItem({
            id: "00000000-0000-0000-0000-000000000203",
            item_name: "房租",
            actual_amount: "300.00",
            actual_entry_count: 1,
            variance_amount: "0.00",
            completion_rate_percent: "100.00",
            variance_effect: "ON_PLAN",
          }),
        ],
      },
    });
    const user = userEvent.setup();
    window.location.hash = "#/monthly";
    render(<App />);

    const search = await screen.findByLabelText("搜索项目、分类或备注");
    await user.type(search, "工作餐");
    expect(screen.getByRole("button", { name: "查看 餐饮 详情" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "查看 电费 详情" })).not.toBeInTheDocument();

    await user.clear(search);
    await user.click(screen.getByRole("button", { name: "查看 电费 详情" }));
    const drawer = await screen.findByRole("dialog", { name: "电费" });
    expect(invokeMock).toHaveBeenCalledWith("list_actual_entries", {
      monthlyItemId: "00000000-0000-0000-0000-000000000201",
    });
    await waitFor(() => expect(screen.getByRole("button", { name: "关闭项目详情" })).toHaveFocus());
    await user.keyboard("{Escape}");
    expect(drawer).not.toBeInTheDocument();
    expect(search).toHaveValue("");
  });

  it("keeps vertical table scrolling chained to the page at both boundaries", async () => {
    installHarness({ monthly: { "2026-08": [monthlyItem()] } });
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole("link", { name: "月度执行" }));

    const tableFrame = (await screen.findByRole("table", { name: "本月类目、计划金额、实际金额、偏差、完成率和实际条目数量" })).parentElement;
    expect(tableFrame).toHaveStyle({ overflow: "auto" });
    expect(tableFrame).toHaveStyle({ overscrollBehaviorY: "auto" });
    expect(tableFrame).toHaveStyle({ overscrollBehaviorX: "contain" });
  });

  it("displays stable Rust structured errors instead of raw transport details", async () => {
    installHarness({
      rejectCommand: {
        command: "ensure_default_settings",
        error: {
          error_code: "BASE_CURRENCY_LOCKED",
          message_key: "error.base_currency_locked",
        },
      },
    });
    render(<App />);
    expect((await screen.findAllByText("已有月度数据，本位币已锁定。")).length).toBeGreaterThan(0);
  });

});

describe("dashboard and budget projection analytics", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    window.location.hash = "";
  });

  it("keeps partial actual chart values available without a dashboard completeness metric", async () => {
    installHarness({ plans: [examplePlan] });
    render(<App />);

    expect(await screen.findByRole("heading", { name: "2026 年 8 月" })).toBeInTheDocument();
    expect(screen.queryByText("66.67%")).not.toBeInTheDocument();
    expect(screen.getAllByText("当前实际").length).toBeGreaterThan(0);
    expect(
      screen.getByRole("img", {
        name: "2026-08收入、支出与净结余计划实际分组柱状图",
      }),
    ).toBeInTheDocument();
    const comparisonTable = screen.getByRole("table", { name: "本月计划执行表" });
    expect(within(comparisonTable).getByText("¥ 28,700.00")).toBeInTheDocument();
    expect(within(comparisonTable).getByText("¥ 8,427.00")).toBeInTheDocument();
    expect(screen.getAllByText("需关注").length).toBeGreaterThan(0);
    expect(screen.queryByText("¥ 13,000.00")).not.toBeInTheDocument();
  });

  it("plots missing bars as zero while completed trend months use zero and the current month stays disconnected", async () => {
    installHarness({
      analytics: monthAnalytics({
        income: {
          planned: "30000.00",
          actual_to_date: null,
          variance: null,
          completion_percent: null,
          variance_effect: "UNKNOWN",
        },
      }),
      history: [
        monthAnalytics({
          month: "2026-06",
        }),
        monthAnalytics({
          month: "2026-07",
          income: {
            planned: "30000.00",
            actual_to_date: null,
            variance: null,
            completion_percent: null,
            variance_effect: "UNKNOWN",
          },
          expense: {
            planned: "10000.00",
            actual_to_date: null,
            variance: null,
            completion_percent: null,
            variance_effect: "UNKNOWN",
          },
          net_balance: {
            planned: "20000.00",
            actual_to_date: null,
            variance: null,
            completion_percent: null,
            variance_effect: "UNKNOWN",
          },
          planned_savings_rate_percent: null,
          actual_savings_rate_percent: null,
        }),
        monthAnalytics({
          month: "2026-08",
          income: {
            planned: "30000.00",
            actual_to_date: null,
            variance: null,
            completion_percent: null,
            variance_effect: "UNKNOWN",
          },
          expense: {
            planned: "10000.00",
            actual_to_date: null,
            variance: null,
            completion_percent: null,
            variance_effect: "UNKNOWN",
          },
          net_balance: {
            planned: "20000.00",
            actual_to_date: null,
            variance: null,
            completion_percent: null,
            variance_effect: "UNKNOWN",
          },
          planned_savings_rate_percent: null,
          actual_savings_rate_percent: null,
        }),
      ],
    });
    render(<App />);

    const chart = await screen.findByRole("img", {
      name: "2026-08收入、支出与净结余计划实际分组柱状图",
    });
    const option = JSON.parse(chart.dataset.chartOption ?? "{}") as {
      series: Array<{ name: string; data: number[] }>;
    };
    expect(option.series.find((series) => series.name === "实际")?.data).toEqual([0, 8427, 20273]);
    const categoryChart = screen.getByRole("img", {
      name: "2026-08支出分类计划与实际横向条形图",
    });
    const categoryOption = JSON.parse(categoryChart.dataset.chartOption ?? "{}") as {
      series: Array<{ name: string; data: number[] }>;
    };
    expect(categoryOption.series.find((series) => series.name === "实际")?.data).toEqual([6427, 2000, 0]);
    const trendChart = screen.getByRole("img", {
      name: "近八个月实际收入、支出与净结余趋势图",
    });
    const trendOption = JSON.parse(trendChart.dataset.chartOption ?? "{}") as {
      series: Array<{ name: string; data: Array<number | null> }>;
    };
    expect(trendOption.series.find((series) => series.name === "收入")?.data).toEqual([28700, 0, null]);
    expect(trendOption.series.find((series) => series.name === "支出")?.data).toEqual([8427, 0, null]);
    expect(trendOption.series.find((series) => series.name === "净结余")?.data).toEqual([20273, 0, null]);
    const savingsChart = screen.getByRole("img", {
      name: "近八个月计划储蓄率与实际储蓄率趋势图",
    });
    const savingsOption = JSON.parse(savingsChart.dataset.chartOption ?? "{}") as {
      series: Array<{ name: string; data: Array<number | null> }>;
    };
    expect(savingsOption.series.find((series) => series.name === "计划储蓄率")?.data).toEqual([69, 0, null]);
    expect(savingsOption.series.find((series) => series.name === "实际储蓄率")?.data).toEqual([70.64, 0, null]);
    expect(screen.getByText("灰蓝代表计划，蓝色代表当前实际；没有实际数据的指标按 0 绘制。")).toBeInTheDocument();
  });

  it("does not present an unknown variance as a currency-only amount", async () => {
    installHarness({
      analytics: monthAnalytics({
        important_variances: [{
          ...monthAnalytics().projects[1],
          variance_amount: null,
          variance_effect: "UNKNOWN",
        }],
      }),
    });
    render(<App />);

    expect(await screen.findByRole("table", { name: "重要偏差与待处理项目" })).toBeInTheDocument();
    expect(screen.getByText("待录入")).toBeInTheDocument();
  });

  it("uses a truthful empty report state instead of zero cards and N/A charts", async () => {
    const emptyComparison = {
      planned: "0.00",
      actual_to_date: null,
      variance: null,
      completion_percent: null,
      variance_effect: "UNKNOWN" as const,
    };
    installHarness({
      analytics: monthAnalytics({
        total_item_count: 0,
        planned_item_count: 0,
        income: emptyComparison,
        expense: emptyComparison,
        net_balance: emptyComparison,
        planned_savings_rate_percent: null,
        actual_savings_rate_percent: null,
        savings_rate_percentage_point_variance: null,
        savings_rate_plan_completion_percent: null,
        important_variances: [],
      }),
      projection: {
        ...projection,
        stable_income: "0.00",
        fixed_commitment_ratio_percent: null,
        stable_income_coverage_ratio: null,
      },
    });
    render(<App />);

    expect(await screen.findByRole("heading", { name: "从本月第一项收入或支出开始" })).toBeInTheDocument();
    expect(screen.queryByText("N/A")).not.toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("moves savings history to the dashboard and removes duplicate charts from history", async () => {
    installHarness({
      history: [
        monthAnalytics({
          month: "2026-07",
        }),
        monthAnalytics(),
      ],
    });
    const user = userEvent.setup();
    render(<App />);

    const savingsHeading = await screen.findByRole("heading", { name: "计划与实际储蓄率趋势" });
    const savingsCard = savingsHeading.closest("section");
    expect(savingsCard).not.toBeNull();
    expect(within(savingsCard!).getByRole("img", { name: "近八个月计划储蓄率与实际储蓄率趋势图" })).toBeInTheDocument();
    await user.click(within(savingsCard!).getByText("查看精确数据"));
    const savingsTable = within(savingsCard!).getByRole("table", { name: "储蓄率趋势精确数据" });
    expect(within(savingsTable).getByText("2026-07")).toBeInTheDocument();

    await user.click(await screen.findByRole("link", { name: "历史报表" }));

    expect(await screen.findByRole("heading", { name: "历史报表" })).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.queryByRole("table", { name: "财务趋势图对应数值" })).not.toBeInTheDocument();
    expect(screen.queryByRole("table", { name: "储蓄率趋势对应数值" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "收入、支出与净结余" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "储蓄率" })).not.toBeInTheDocument();
  });

  it("groups monthly reports by year with newest periods expanded first", async () => {
    installHarness({
      history: [
        monthAnalytics({ month: "2025-12" }),
        monthAnalytics({ month: "2026-07" }),
        monthAnalytics({ month: "2026-08" }),
      ],
    });
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole("link", { name: "历史报表" }));

    const latestYear = await screen.findByRole("button", { name: "收起 2026 年报表" });
    const olderYear = screen.getByRole("button", { name: "展开 2025 年报表" });
    expect(latestYear).toHaveAttribute("aria-expanded", "true");
    expect(olderYear).toHaveAttribute("aria-expanded", "false");

    const latestTable = screen.getByRole("table", { name: "2026 年月度详细报告" });
    const latestHeaders = within(latestTable).getAllByRole("columnheader");
    expect(latestHeaders.slice(1, 5).every((header) => header.classList.contains("numeric-column"))).toBe(true);
    expect(within(latestTable).getAllByText("3 个类目").length).toBeGreaterThan(0);
    expect(latestYear.querySelector(".history-year-chevron")).toBeEmptyDOMElement();
    const latestMonthLinks = within(latestTable).getAllByRole("link").filter((link) => link.classList.contains("history-month-link"));
    expect(latestMonthLinks.map((link) => link.textContent)).toEqual(["2026 年 8 月", "2026 年 7 月"]);
    expect(screen.queryByRole("table", { name: "2025 年月度详细报告" })).not.toBeInTheDocument();

    olderYear.focus();
    await user.keyboard("{Enter}");
    expect(screen.getByRole("table", { name: "2025 年月度详细报告" })).toBeInTheDocument();
    expect(olderYear).toHaveTextContent("1 个月");

    latestYear.focus();
    await user.keyboard(" ");
    expect(screen.queryByRole("table", { name: "2026 年月度详细报告" })).not.toBeInTheDocument();
  });

  it("keeps the history empty state truthful", async () => {
    installHarness({ history: [] });
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole("link", { name: "历史报表" }));

    expect(await screen.findByRole("heading", { name: "还没有可查看的月份" })).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("shows planned and actual project rankings together without a ranking mode switch", async () => {
    installHarness({ plans: [examplePlan] });
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole("link", { name: "历史报表" }));
    await user.click(await screen.findByText("2026 年 8 月"));

    expect(await screen.findByRole("heading", { name: "月度执行结果" })).toBeInTheDocument();
    expect(screen.getByText("3 个类目")).toBeInTheDocument();
    expect(screen.getAllByText("固定承诺支出").length).toBeGreaterThan(0);
    expect(screen.getByText("房租")).toBeInTheDocument();
    const categoryTable = screen.getByRole("table", { name: "分类结构图对应数据" });
    expect(within(categoryTable).queryByRole("columnheader", { name: "未确认" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("排名依据")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "支出项目" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("计划、实际、占比与排名同屏")).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: /支出项目.*金额对照图/ })).not.toBeInTheDocument();

    const rankingTable = screen.getByRole("table", { name: "项目计划与实际对照数据" });
    const electricityRow = within(rankingTable).getByRole("row", { name: /电费/ });
    expect(electricityRow).toHaveTextContent("#1");
    expect(electricityRow).toHaveTextContent("计划 #2 · ↑1");
    expect(electricityRow).toHaveTextContent(/¥\s?300\.00/);
    expect(electricityRow).toHaveTextContent(/¥\s?427\.00/);
    expect(electricityRow).toHaveTextContent(/¥\s?127\.00/);
    expect(electricityRow).toHaveTextContent("5.07%");

    const rentRow = within(rankingTable).getByRole("row", { name: /房租/ });
    expect(rentRow).toHaveTextContent("计划 #1 · 未录入");
    expect(rentRow).toHaveTextContent(/¥\s?6,000\.00/);
    expect(rentRow).toHaveTextContent("未录入");
    expect(rentRow).toHaveTextContent("不按零参与排名");
    expect(within(rankingTable).getAllByRole("row")[1]).toHaveTextContent("电费");

    await user.click(within(rankingTable).getByRole("button", { name: "计划金额" }));
    expect(within(rankingTable).getAllByRole("row")[1]).toHaveTextContent("房租");

    await user.click(screen.getByRole("button", { name: "收入项目" }));
    expect(screen.queryByRole("img", { name: /收入项目.*金额对照图/ })).not.toBeInTheDocument();
    expect(within(rankingTable).getByText("工资")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "← 返回历史报表" })).toBeInTheDocument();
  });

  it("opens a historical project for adjustment and explains invalid amounts before saving", async () => {
    const historicalItem = monthlyItem({ month: "2026-07" });
    installHarness({
      history: [monthAnalytics({
        month: "2026-07",
        projects: [{
          ...monthAnalytics().projects[2],
          monthly_item_id: historicalItem.id,
        }],
      })],
      monthly: { "2026-07": [historicalItem] },
    });
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("link", { name: "历史报表" }));
    await user.click(await screen.findByText("2026 年 7 月"));
    expect(screen.getByRole("link", { name: "调整该月数据" })).toHaveAttribute("href", "#/monthly?month=2026-07");

    const rankingTable = screen.getByRole("table", { name: "项目计划与实际对照数据" });
    const electricityRow = within(rankingTable).getByRole("row", { name: /电费/ });
    await user.click(within(electricityRow).getByRole("link", { name: "调整条目" }));

    expect(await screen.findByText("历史月调整")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "← 返回该月报表" })).toHaveAttribute("href", "#/history/2026-07");
    expect(invokeMock).toHaveBeenCalledWith("list_monthly_items", { month: "2026-07" });
    expect(await screen.findByRole("dialog", { name: "电费" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "添加支出或退款" }));
    const save = screen.getByRole("button", { name: "保存条目" });
    expect(save).toBeEnabled();
    await user.click(save);
    expect(screen.getByRole("alert")).toHaveTextContent("请输入大于 0、最多两位小数的金额");
    expect(invokeMock.mock.calls.some(([command]) => command === "create_actual_entry")).toBe(false);

    await user.type(screen.getByLabelText("原币金额"), "20.00");
    await user.click(screen.getByLabelText("类型"));
    await user.click(screen.getByRole("option", { name: "退款" }));
    await user.click(save);

    expect(invokeMock).toHaveBeenCalledWith("create_actual_entry", {
      input: expect.objectContaining({
        monthlyItemId: historicalItem.id,
        occurredOn: "2026-07-01",
        effect: "DECREASE",
        amount: "20.00",
      }),
    });
  });

  it("degrades project comparison to actual-only when the month has no plan baseline", async () => {
    installHarness({
      analytics: monthAnalytics({
        planned_item_count: 0,
        projects: [{
          monthly_item_id: "manual-coffee",
          name: "临时餐饮",
          category: "DISCRETIONARY_BUDGET",
          flow_type: "EXPENSE",
          planned_amount: "0.00",
          actual_amount: "88.00",
          variance_amount: null,
          variance_effect: "UNKNOWN",
          planned_share_percent: null,
          actual_share_percent: "100.00",
          planned_rank: 1,
          actual_rank: 1,
        }],
      }),
    });
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole("link", { name: "历史报表" }));
    await user.click(await screen.findByText("2026 年 8 月"));

    expect(screen.queryByRole("img", { name: /支出项目.*金额对照图/ })).not.toBeInTheDocument();
    const rankingTable = screen.getByRole("table", { name: "项目计划与实际对照数据" });
    expect(within(rankingTable).queryByRole("button", { name: "计划金额" })).not.toBeInTheDocument();
    expect(within(rankingTable).queryByRole("columnheader", { name: "偏差" })).not.toBeInTheDocument();
    expect(within(rankingTable).getByRole("row", { name: /临时餐饮/ })).toHaveTextContent(/¥\s?88\.00/);
  });

  it("invalidates month analytics after an actual entry is added", async () => {
    installHarness({ monthly: { "2026-08": [monthlyItem()] } });
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("heading", { name: "2026 年 8 月" });
    const analyticsCallCount = () =>
      invokeMock.mock.calls.filter(([command]) => command === "get_month_analytics").length;
    expect(analyticsCallCount()).toBe(1);

    await user.click(screen.getByRole("link", { name: "月度执行" }));
    await user.click(await screen.findByRole("button", { name: "查看 电费 详情" }));
    await user.click(await screen.findByRole("button", { name: "添加支出或退款" }));
    await user.type(screen.getByLabelText("原币金额"), "427");
    await user.click(screen.getByRole("button", { name: "保存条目" }));
    await user.click(screen.getByRole("link", { name: "总览" }));
    await screen.findByRole("heading", { name: "2026 年 8 月" });
    await waitFor(() => expect(analyticsCallCount()).toBe(2));
  });
});
