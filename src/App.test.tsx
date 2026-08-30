import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { App, ApplicationErrorBoundary } from "./App";
import type { Invoke } from "./shared/api/domain";
import type {
  InitializeMonthResult,
  FinancialCapacity,
  MonthAnalytics,
  MonthPreview,
  MonthlyItem,
  NextMonthGoal,
  PlanItem,
  Settings,
} from "./shared/api/finance";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

vi.mock("./shared/components/AnalyticsChart", () => ({
  AnalyticsChart: ({ label }: { label: string }) => <div role="img" aria-label={label} />,
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
  created_at: "2026-08-01T00:00:00Z",
  updated_at: "2026-08-01T00:00:00Z",
};

const nextMonthGoal: NextMonthGoal = {
  target_month: "2026-09",
  minimum_savings_rate_basis_points: 2000,
  created_at: "2026-08-01T00:00:00Z",
  updated_at: "2026-08-01T00:00:00Z",
};

const baseRate = {
  currency: "CNY",
  base_currency: "CNY",
  rate: "1.00000000",
  is_base_currency: true,
  plan_reference_count: 0,
  updated_at: "2026-08-01T00:00:00Z",
};

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
    actual_confirmed_at: null,
    variance_amount: null,
    completion_rate_percent: null,
    data_status: "MISSING",
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
    actual_status: "PARTIAL",
    total_item_count: 3,
    planned_item_count: 3,
    recorded_item_count: 2,
    completeness_percent: "66.67",
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
        missing_actual_count: 0,
      },
      {
        category: "VARIABLE_INCOME",
        flow_type: "INCOME",
        planned_amount: "0.00",
        actual_to_date: null,
        planned_share_percent: "0.00",
        actual_share_percent: null,
        missing_actual_count: 0,
      },
      {
        category: "ESSENTIAL_EXPENSE",
        flow_type: "EXPENSE",
        planned_amount: "6300.00",
        actual_to_date: "6427.00",
        planned_share_percent: "67.74",
        actual_share_percent: "76.27",
        missing_actual_count: 1,
      },
      {
        category: "FIXED_COMMITMENT_EXPENSE",
        flow_type: "EXPENSE",
        planned_amount: "2000.00",
        actual_to_date: "2000.00",
        planned_share_percent: "21.51",
        actual_share_percent: "23.73",
        missing_actual_count: 0,
      },
      {
        category: "DISCRETIONARY_BUDGET",
        flow_type: "EXPENSE",
        planned_amount: "1000.00",
        actual_to_date: null,
        planned_share_percent: "10.75",
        actual_share_percent: null,
        missing_actual_count: 1,
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

const capacity: FinancialCapacity = {
  target_month: "2026-09",
  base_currency: "CNY",
  minimum_savings_rate_percent: "20.00",
  stable_income: "30000.00",
  variable_income: "3000.00",
  essential_expenses: "6000.00",
  fixed_commitments: "3000.00",
  discretionary_budget: "2000.00",
  minimum_savings_amount: "6000.00",
  preserved_capacity: "13000.00",
  maximum_capacity: "15000.00",
  fixed_commitment_ratio_percent: "10.00",
  stable_income_coverage_ratio: "3.33",
};

interface HarnessOptions {
  settings?: Settings | null;
  plans?: PlanItem[];
  monthly?: Record<string, MonthlyItem[]>;
  startupCreated?: number;
  missingCurrency?: string;
  rejectCommand?: { command: string; error: unknown };
  analytics?: MonthAnalytics;
  history?: MonthAnalytics[];
  capacity?: FinancialCapacity;
  goal?: NextMonthGoal;
}

function installHarness(options: HarnessOptions = {}) {
  let storedSettings = options.settings === undefined ? settings : options.settings;
  let storedGoal = options.goal ?? nextMonthGoal;
  const plans = [...(options.plans ?? [])];
  const monthly = { ...(options.monthly ?? {}) };
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
            created_at: "2026-08-01T00:00:00Z",
            updated_at: "2026-08-01T00:00:00Z",
          };
        }
        return storedSettings as T;
      }
      case "save_settings": {
        const input = args?.input as { baseCurrency: string };
        storedSettings = {
          base_currency: input.baseCurrency,
          created_at: "2026-08-01T00:00:00Z",
          updated_at: "2026-08-01T00:00:00Z",
        };
        return storedSettings as T;
      }
      case "get_next_month_goal":
        return storedGoal as T;
      case "save_next_month_goal": {
        const input = args?.input as { minimumSavingsRateBasisPoints: number };
        storedGoal = { ...storedGoal, minimum_savings_rate_basis_points: input.minimumSavingsRateBasisPoints };
        return storedGoal as T;
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
        return [baseRate] as T;
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
      case "get_financial_capacity":
        return (options.capacity ?? capacity) as T;
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
      case "list_actual_entries":
        return [] as T;
      case "ensure_actual_only_monthly_item":
        return monthlyItem({ item_source: "ACTUAL_ONLY", planned_amount: "0.00" }) as T;
      case "create_manual_monthly_item":
        return monthlyItem({
          source_plan_item_id: null,
          item_name: (args?.input as { name: string }).name,
          category: (args?.input as { category: string }).category,
          flow_type: ["FIXED_INCOME", "VARIABLE_INCOME"].includes((args?.input as { category: string }).category) ? "INCOME" : "EXPENSE",
          item_source: "ACTUAL_ONLY",
          item_origin: "MANUAL",
          planned_amount: "0.00",
        }) as T;
      case "create_actual_entry":
      case "update_actual_entry": {
        const input = args?.input as { id?: string; monthlyItemId: string; occurredOn: string; effect: string; amount: string; note?: string };
        return { id: input.id ?? "00000000-0000-0000-0000-000000000501", monthly_item_id: input.monthlyItemId, occurred_on: input.occurredOn, effect: input.effect, amount: input.amount, origin: "USER", note: input.note ?? null, created_at: "2026-08-01T00:00:00Z", updated_at: "2026-08-01T00:00:00Z" } as T;
      }
      case "delete_actual_entry":
        return undefined as T;
      case "confirm_monthly_item":
        return monthlyItem({ actual_amount: "0.00", actual_confirmed_at: "2026-08-31T00:00:00Z", data_status: "CONFIRMED_ZERO" }) as T;
      case "update_monthly_note":
        return monthlyItem() as T;
      case "confirm_monthly_actuals":
        return { updated_count: 1 } as T;
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
      "目标",
      "设置",
    ]);
    expect(screen.queryByRole("link", { name: /长期规划/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "财务分析" })).not.toBeInTheDocument();
    expect(screen.queryByText("建立你的财务基准")).not.toBeInTheDocument();
    expect(invokeMock).toHaveBeenCalledWith("ensure_default_settings");
  });

  it("keeps settings limited to financial configuration", async () => {
    installHarness();
    window.location.hash = "#/settings";
    render(<App />);

    expect(await screen.findByRole("heading", { name: "系统设置" })).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "本位币" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "当前汇率" })).toBeInTheDocument();
    expect(document.querySelectorAll(".settings-card")).toHaveLength(2);
    expect(screen.queryByLabelText("下月目标储蓄率")).not.toBeInTheDocument();
  });

  it("keeps the goal isolated to the next natural month and saves its policy", async () => {
    installHarness({ plans: [examplePlan] });
    const user = userEvent.setup();
    window.location.hash = "#/goals";
    render(<App />);

    expect(await screen.findByRole("heading", { name: "2026 年 9 月" })).toBeInTheDocument();
    expect(screen.getByText("不联动")).toBeInTheDocument();
    expect(screen.getByText("不回溯")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "2026-09稳定收入分配与剩余承载力瀑布图" })).toBeInTheDocument();
    const input = screen.getByLabelText("下月目标储蓄率");
    await user.clear(input);
    await user.type(input, "25");
    await user.click(screen.getByRole("button", { name: "保存下月目标" }));
    await screen.findByText("下月目标已保存，本月与历史数据未作修改。");
    expect(invokeMock).toHaveBeenCalledWith("save_next_month_goal", {
      input: { minimumSavingsRateBasisPoints: 2500 },
    });
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
    expect(screen.getByText("无论哪种模式，财务承载能力都按月均负担计算。")).toBeInTheDocument();
  });

  it("shows actual completeness states and records expense/refund entries without editing totals", async () => {
    installHarness({
      plans: [examplePlan],
      startupCreated: 2,
      monthly: {
        "2026-08": [
          monthlyItem(),
          monthlyItem({
            id: "00000000-0000-0000-0000-000000000202",
            item_name: "退款",
            actual_amount: "0.00",
            actual_confirmed_at: "2026-08-31T00:00:00Z",
            variance_amount: "-100.00",
            completion_rate_percent: "0.00",
            data_status: "CONFIRMED_ZERO",
            variance_effect: "FAVORABLE",
          }),
          monthlyItem({
            id: "00000000-0000-0000-0000-000000000203",
            item_name: "房租",
            actual_amount: "300.00",
            actual_entry_count: 1,
            actual_confirmed_at: "2026-08-31T00:00:00Z",
            variance_amount: "0.00",
            completion_rate_percent: "100.00",
            data_status: "FINAL",
            variance_effect: "ON_PLAN",
          }),
        ],
      },
    });
    const user = userEvent.setup();
    window.location.hash = "#/monthly";
    render(<App />);

    expect(await screen.findByText(/当前月已自动检查：新增 2 项/)).toBeInTheDocument();
    expect(await screen.findByText("尚无条目")).toBeInTheDocument();
    expect(screen.getAllByText("¥ 0.00").length).toBeGreaterThan(0);
    expect(screen.getAllByText("¥ 300.00").length).toBeGreaterThan(0);
    await user.click(screen.getAllByRole("button", { name: "确认项目已完成" })[0]);
    expect(invokeMock).toHaveBeenCalledWith("confirm_monthly_item", {
      input: expect.objectContaining({ id: expect.any(String) }),
    });

    await user.click(screen.getByRole("button", { name: "添加实际条目" }));
    await user.click(screen.getByRole("button", { name: /关联周期规则/ }));
    await user.clear(screen.getByLabelText("金额"));
    await user.type(screen.getByLabelText("金额"), "427.25");
    await user.click(screen.getByLabelText("类型"));
    await user.click(screen.getByRole("option", { name: "退款" }));
    await user.click(screen.getByRole("button", { name: "保存条目" }));
    expect(invokeMock).toHaveBeenCalledWith("create_actual_entry", {
      input: expect.objectContaining({ amount: "427.25", effect: "DECREASE" }),
    });
  });

  it("creates an actual-only monthly item before recording an entry outside the plan schedule", async () => {
    installHarness({ plans: [examplePlan], monthly: { "2026-08": [] } });
    const user = userEvent.setup();
    window.location.hash = "#/monthly";
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "添加实际条目" }));
    await user.click(screen.getByRole("button", { name: /关联周期规则/ }));
    await user.type(screen.getByLabelText("金额"), "25.00");
    await user.click(screen.getByLabelText("类型"));
    await user.click(screen.getByRole("option", { name: "退款" }));
    await user.click(screen.getByRole("button", { name: "保存条目" }));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("ensure_actual_only_monthly_item", {
        input: { planItemId: examplePlan.id, month: "2026-08" },
      });
    });
    expect(invokeMock).toHaveBeenCalledWith("create_actual_entry", {
      input: expect.objectContaining({
        monthlyItemId: "00000000-0000-0000-0000-000000000201",
        occurredOn: "2026-08-01",
        effect: "DECREASE",
        amount: "25.00",
      }),
    });
  });

  it("records a manual monthly item without requiring a long-term plan", async () => {
    installHarness({ plans: [], monthly: { "2026-08": [] } });
    const user = userEvent.setup();
    window.location.hash = "#/monthly";
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "添加实际条目" }));
    await user.type(screen.getByLabelText("项目名称"), "本月房租");
    await user.type(screen.getByLabelText("金额"), "3200.00");
    await user.click(screen.getByRole("button", { name: "保存条目" }));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("create_manual_monthly_item", {
        input: {
          name: "本月房租",
          month: "2026-08",
          category: "ESSENTIAL_EXPENSE",
        },
      });
    });
    expect(invokeMock).toHaveBeenCalledWith("create_actual_entry", {
      input: expect.objectContaining({ amount: "3200.00", effect: "INCREASE" }),
    });
    expect(invokeMock.mock.calls.some(([command]) => command === "ensure_actual_only_monthly_item")).toBe(false);
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
    expect(await screen.findByRole("heading", { name: "2026 年 9 月" })).toBeInTheDocument();
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

  it("batch confirmation marks completion without synthesizing actual entries", async () => {
    installHarness({ monthly: { "2026-08": [monthlyItem()] } });
    const user = userEvent.setup();
    window.location.hash = "#/monthly";
    render(<App />);
    expect(await screen.findByText("确认只标记条目已核对，不会补写计划金额或创建虚假实际。")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "确认所选范围已完成" }));
    expect(await screen.findByText("已将 1 项标记为最终确认。")).toBeInTheDocument();
    expect(invokeMock).toHaveBeenCalledWith("confirm_monthly_actuals", {
      input: { month: "2026-08", category: null },
    });
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

describe("dashboard and capacity analytics", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    window.location.hash = "";
  });

  it("labels partial actuals and keeps chart values available in a table", async () => {
    installHarness({ plans: [examplePlan] });
    render(<App />);

    expect(await screen.findByRole("heading", { name: "2026 年 8 月" })).toBeInTheDocument();
    expect(screen.getByText("66.67%")).toBeInTheDocument();
    expect(screen.getAllByText("当前已录").length).toBeGreaterThan(0);
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
        actual_status: "EMPTY",
        total_item_count: 0,
        planned_item_count: 0,
        recorded_item_count: 0,
        completeness_percent: null,
        income: emptyComparison,
        expense: emptyComparison,
        net_balance: emptyComparison,
        planned_savings_rate_percent: null,
        actual_savings_rate_percent: null,
        savings_rate_percentage_point_variance: null,
        savings_rate_plan_completion_percent: null,
        important_variances: [],
      }),
      capacity: {
        ...capacity,
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

  it("renders historical trends with numerical tables and explicit actual status", async () => {
    installHarness({
      history: [
        monthAnalytics({
          month: "2026-07",
          actual_status: "COMPLETE",
          recorded_item_count: 3,
          completeness_percent: "100.00",
        }),
        monthAnalytics(),
      ],
    });
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole("link", { name: "历史报表" }));

    expect(await screen.findByRole("heading", { name: "历史报表" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /各月计划与实际收入/ })).toBeInTheDocument();
    const trendTable = screen.getByRole("table", { name: "财务趋势图对应数值" });
    expect(within(trendTable).getByText("2026-07")).toBeInTheDocument();
    expect(within(trendTable).getAllByText("最终实际").length).toBeGreaterThan(0);
    expect(within(trendTable).getAllByText("当前已录").length).toBeGreaterThan(0);
  });

  it("uses backend ranks and excludes missing actuals from the actual ranking", async () => {
    installHarness({ plans: [examplePlan] });
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole("link", { name: "历史报表" }));
    await user.click(await screen.findByText("2026 年 8 月"));

    expect(await screen.findByRole("heading", { name: "月度执行结果" })).toBeInTheDocument();
    expect(screen.getAllByText("固定承诺支出").length).toBeGreaterThan(0);
    expect(screen.getByText("房租")).toBeInTheDocument();
    await user.click(screen.getByLabelText("排名依据"));
    await user.click(screen.getByRole("option", { name: "实际金额" }));
    expect(screen.queryByText("房租")).not.toBeInTheDocument();
    const rankingTable = screen.getByRole("table", { name: "项目排名图对应数据" });
    expect(within(rankingTable).getByText("电费")).toBeInTheDocument();
    expect(within(rankingTable).getByText("¥ 427.00")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "← 返回历史报表" })).toBeInTheDocument();
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
    await user.click(await screen.findByRole("button", { name: "添加支出或退款" }));
    await user.type(screen.getByLabelText("金额"), "427");
    await user.click(screen.getByRole("button", { name: "保存条目" }));
    await user.click(screen.getByRole("link", { name: "总览" }));
    await screen.findByRole("heading", { name: "2026 年 8 月" });
    await waitFor(() => expect(analyticsCallCount()).toBe(2));
  });
});
