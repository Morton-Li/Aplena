import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
  PlanItem,
  RestoreInspection,
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
  target_month: "2026-08",
  base_currency: "CNY",
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
    recorded_item_count: 2,
    completeness_percent: "66.67",
    income: {
      planned: "30000.00",
      actual_to_date: "28700.00",
      variance: "-1300.00",
      variance_effect: "UNFAVORABLE",
    },
    expense: {
      planned: "9300.00",
      actual_to_date: "8427.00",
      variance: "-873.00",
      variance_effect: "FAVORABLE",
    },
    net_balance: {
      planned: "20700.00",
      actual_to_date: "20273.00",
      variance: "-427.00",
      variance_effect: "UNFAVORABLE",
    },
    planned_savings_rate_percent: "69.00",
    actual_savings_rate_percent: "70.64",
    savings_rate_percentage_point_variance: "1.64",
    savings_rate_target_completion_percent: "102.38",
    savings_rate_relative_deviation_percent: "2.38",
    minimum_savings_rate_percent: "20.00",
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
  target_month: "2026-08",
  base_currency: "CNY",
  minimum_savings_rate_percent: "20.00",
  stable_income: "30000.00",
  variable_income: "3000.00",
  essential_expenses: "6000.00",
  fixed_commitments: "3000.00",
  discretionary_budget: "2000.00",
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
  restoreInspection?: RestoreInspection;
}

function installHarness(options: HarnessOptions = {}) {
  let storedSettings = options.settings === undefined ? settings : options.settings;
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
      case "save_settings": {
        const input = args?.input as {
          targetMonth: string;
          baseCurrency: string;
          minimumSavingsRateBasisPoints: number;
        };
        storedSettings = {
          target_month: input.targetMonth,
          base_currency: input.baseCurrency,
          minimum_savings_rate_basis_points: input.minimumSavingsRateBasisPoints,
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
        return {
          plan_item: created,
          current_month_initialization: {
            month: "2026-08",
            created_count: 1,
            skipped_existing_count: 0,
            excluded_count: 0,
            warnings: [],
          },
        } as T;
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
      case "create_backup":
        return {
          status: "CREATED",
          file_name: "Aplena-test.aplena",
          created_at: "2026-08-23T00:00:00Z",
          summary: null,
        } as T;
      case "export_csv":
        return {
          status: "CREATED",
          folder_name: "Aplena-CSV-test",
          created_at: "2026-08-23T00:00:00Z",
          file_count: 5,
        } as T;
      case "inspect_backup":
        return (options.restoreInspection ?? {
          status: "READY",
          token: "restore-token",
          file_name: "Aplena-test.aplena",
          backup_created_at: "2026-08-22T00:00:00Z",
          backup_app_version: "0.1.0",
          schema_version: 3,
          migrations_applied: false,
          summary: {
            settings: {
              target_month: "2026-08",
              base_currency: "CNY",
              minimum_savings_rate_basis_points: 2000,
            },
            settings_count: 1,
            exchange_rate_count: 1,
            plan_item_count: 2,
            monthly_item_count: 3,
            actual_entry_count: 4,
            first_month: "2026-07",
            last_month: "2026-08",
          },
          current_summary: {
            settings: {
              target_month: "2026-08",
              base_currency: "CNY",
              minimum_savings_rate_basis_points: 2000,
            },
            settings_count: 1,
            exchange_rate_count: 1,
            plan_item_count: 1,
            monthly_item_count: 1,
            actual_entry_count: 1,
            first_month: "2026-08",
            last_month: "2026-08",
          },
        }) as T;
      case "restore_backup":
        return {
          restored: true,
          recovery_point_name: "before-restore-test.aplena",
          restored_at: "2026-08-23T00:00:00Z",
          summary: {
            settings: null,
            settings_count: 1,
            exchange_rate_count: 1,
            plan_item_count: 2,
            monthly_item_count: 3,
            actual_entry_count: 4,
            first_month: "2026-07",
            last_month: "2026-08",
          },
        } as T;
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

  it("completes first setup entirely by keyboard and creates the base currency", async () => {
    installHarness({ settings: null });
    const user = userEvent.setup();
    render(<App />);

    expect(await screen.findByRole("heading", { name: "建立你的财务基准" })).toBeInTheDocument();
    await user.tab();
    expect(screen.getByRole("combobox", { name: /本位币/ })).toHaveFocus();
    await user.tab();
    await user.tab();
    await user.tab();
    expect(screen.getByRole("button", { name: "完成设置并进入 Aplena" })).toHaveFocus();
    await user.keyboard("{Enter}");

    expect(await screen.findByRole("link", { name: "长期计划" })).toBeInTheDocument();
    expect(invokeMock).toHaveBeenCalledWith("save_settings", {
      input: expect.objectContaining({
        baseCurrency: "CNY",
        minimumSavingsRateBasisPoints: 2000,
      }),
    });
  });

  it("previews and creates an AMORTIZED plan without frontend financial arithmetic", async () => {
    installHarness();
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole("link", { name: "长期计划" }));
    await user.click(await screen.findByRole("button", { name: "新建计划" }));
    await user.type(screen.getByLabelText("项目名称"), "云服务器");
    await user.type(screen.getByLabelText("计划金额"), "1200");
    await user.click(screen.getByRole("button", { name: "预览并检查" }));

    expect((await screen.findAllByText("100.00 CNY")).length).toBeGreaterThan(0);
    await user.click(screen.getByRole("button", { name: "确认保存" }));
    expect(await screen.findByText(/计划已保存/)).toBeInTheDocument();
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
    render(<App />);
    await user.click(await screen.findByRole("link", { name: "长期计划" }));
    await user.click(await screen.findByRole("button", { name: "新建计划" }));
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
    expect(screen.getByText("尚无条目")).toBeInTheDocument();
    expect(screen.getAllByText("0.00").length).toBeGreaterThan(0);
    expect(screen.getAllByText("300.00 CNY").length).toBeGreaterThan(0);
    await user.click(screen.getAllByRole("button", { name: "确认项目已完成" })[0]);
    expect(invokeMock).toHaveBeenCalledWith("confirm_monthly_item", {
      input: expect.objectContaining({ id: expect.any(String) }),
    });

    await user.click(screen.getByRole("button", { name: "添加实际条目" }));
    await user.clear(screen.getByLabelText("金额"));
    await user.type(screen.getByLabelText("金额"), "427.25");
    await user.selectOptions(screen.getByLabelText("类型"), "DECREASE");
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
    await user.type(screen.getByLabelText("金额"), "25.00");
    await user.selectOptions(screen.getByLabelText("类型"), "DECREASE");
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

  it("browses future and historical months without writes, then explicitly initializes", async () => {
    installHarness();
    const user = userEvent.setup();
    window.location.hash = "#/monthly";
    render(<App />);
    const picker = await screen.findByLabelText("查看月份");

    fireEvent.change(picker, { target: { value: "2026-09" } });
    expect(await screen.findByText("未来月份预览")).toBeInTheDocument();
    expect(invokeMock.mock.calls.some(([command]) => command === "initialize_month")).toBe(false);
    await user.click(screen.getByRole("button", { name: "确认并初始化未来月份" }));
    await user.click(screen.getByLabelText(/我理解这会创建/));
    await user.click(screen.getByRole("button", { name: "确认创建月度快照" }));
    expect(invokeMock).toHaveBeenCalledWith(
      "initialize_month",
      expect.objectContaining({ input: expect.objectContaining({ month: "2026-09", confirmed: true }) }),
    );

    fireEvent.change(picker, { target: { value: "2026-01" } });
    expect(await screen.findByText("历史月份查看")).toBeInTheDocument();
    const historyPreviewCalls = invokeMock.mock.calls.filter(
      ([command, args]) =>
        command === "preview_month" &&
        (args as { input: { month: string } }).input.month === "2026-01",
    );
    expect(historyPreviewCalls.length).toBeGreaterThan(0);
  });

  it("requires a temporary rate when a historical snapshot has a missing currency", async () => {
    installHarness({ missingCurrency: "USD" });
    const user = userEvent.setup();
    window.location.hash = "#/monthly";
    render(<App />);
    fireEvent.change(await screen.findByLabelText("查看月份"), { target: { value: "2025-12" } });
    expect(await screen.findByText("缺少汇率：USD")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "补录这个历史月份" }));
    const confirm = screen.getByRole("button", { name: "确认创建月度快照" });
    await user.click(screen.getByLabelText(/我理解这会创建/));
    expect(confirm).toBeDisabled();
    await user.type(screen.getByLabelText("USD 临时汇率（必填）"), "7.1");
    expect(confirm).toBeEnabled();
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
        command: "get_settings",
        error: {
          error_code: "BASE_CURRENCY_LOCKED",
          message_key: "error.base_currency_locked",
        },
      },
    });
    render(<App />);
    expect(await screen.findByText("已有月度数据，本位币已锁定。")).toBeInTheDocument();
  });

  it("keeps backup paths in Rust and requires two explicit restore confirmations", async () => {
    installHarness();
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole("link", { name: "设置" }));
    await screen.findByRole("heading", { name: "备份、恢复与可读导出" });

    await user.click(screen.getByRole("button", { name: "创建完整备份" }));
    expect(await screen.findByText(/已创建 Aplena-test\.aplena/)).toBeInTheDocument();
    expect(invokeMock).toHaveBeenCalledWith("create_backup");

    await user.click(screen.getByRole("button", { name: "导出五表 CSV" }));
    expect(await screen.findByText(/Aplena-CSV-test 中导出 5 个 CSV/)).toBeInTheDocument();
    expect(invokeMock).toHaveBeenCalledWith("export_csv");

    await user.click(screen.getByRole("button", { name: "选择并检查备份" }));
    expect(await screen.findByRole("heading", { name: "恢复前只读检查已通过" })).toBeInTheDocument();
    const comparison = screen.getByRole("table", { name: "恢复数据差异" });
    expect(within(comparison).getByText("2026-07 — 2026-08")).toBeInTheDocument();
    expect(within(comparison).getByText("+2")).toBeInTheDocument();
    const restore = screen.getByRole("button", { name: "确认恢复此备份" });
    expect(restore).toBeDisabled();
    await user.click(screen.getByLabelText(/我已核对月份/));
    await user.type(screen.getByLabelText("输入“恢复”进行第二次确认"), "恢复");
    expect(restore).toBeEnabled();
    await user.click(restore);
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("restore_backup", {
        input: { token: "restore-token", confirmed: true, confirmationPhrase: "恢复" },
      }),
    );
    expect(await screen.findByText(/替换前恢复点为 before-restore-test\.aplena/)).toBeInTheDocument();
  });

  it("renders a safe structured backup validation error", async () => {
    installHarness({
      rejectCommand: {
        command: "inspect_backup",
        error: { error_code: "BACKUP_CHECKSUM_MISMATCH", message_key: "error.backup_checksum_mismatch" },
      },
    });
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole("link", { name: "设置" }));
    await screen.findByRole("heading", { name: "备份、恢复与可读导出" });
    await user.click(screen.getByRole("button", { name: "选择并检查备份" }));
    expect(await screen.findByText(/备份内容与校验清单不一致/)).toBeInTheDocument();
  });
});

describe("dashboard and capacity analytics", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    window.location.hash = "";
  });

  it("labels partial actuals and keeps chart values available in a table", async () => {
    installHarness();
    render(<App />);

    expect(await screen.findByRole("heading", { name: "本月计划执行到哪里了？" })).toBeInTheDocument();
    expect(screen.getByText("66.67%")).toBeInTheDocument();
    expect(screen.getAllByText("当前已录").length).toBeGreaterThan(0);
    expect(
      screen.getByRole("img", {
        name: "2026-08 计划与当前实际的收入、支出和净结余柱状图",
      }),
    ).toBeInTheDocument();
    const comparisonTable = screen.getByRole("table", { name: "图表对应数值" });
    expect(within(comparisonTable).getByText("28700.00")).toBeInTheDocument();
    expect(within(comparisonTable).getByText("8427.00")).toBeInTheDocument();
    expect(screen.getByText("超支")).toBeInTheDocument();
    expect(screen.getByText("13000.00 CNY")).toBeInTheDocument();
  });

  it("shows N/A for empty actuals and zero-denominator rates", async () => {
    const emptyComparison = {
      planned: "0.00",
      actual_to_date: null,
      variance: null,
      variance_effect: "UNKNOWN" as const,
    };
    installHarness({
      analytics: monthAnalytics({
        actual_status: "EMPTY",
        total_item_count: 0,
        recorded_item_count: 0,
        completeness_percent: null,
        income: emptyComparison,
        expense: emptyComparison,
        net_balance: emptyComparison,
        planned_savings_rate_percent: null,
        actual_savings_rate_percent: null,
        savings_rate_percentage_point_variance: null,
        savings_rate_target_completion_percent: null,
        savings_rate_relative_deviation_percent: null,
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

    expect((await screen.findAllByText("暂无实际")).length).toBeGreaterThan(0);
    expect(screen.getAllByText("N/A").length).toBeGreaterThan(3);
    expect(screen.getByText("N/A（稳定收入为 0）")).toBeInTheDocument();
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
    await user.click(await screen.findByRole("link", { name: "历史" }));

    expect(await screen.findByRole("heading", { name: "计划与结果如何随时间变化？" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /各月计划与实际收入/ })).toBeInTheDocument();
    const trendTable = screen.getByRole("table", { name: "财务趋势图对应数值" });
    expect(within(trendTable).getByText("2026-07")).toBeInTheDocument();
    expect(within(trendTable).getAllByText("最终实际").length).toBeGreaterThan(0);
    expect(within(trendTable).getAllByText("当前已录").length).toBeGreaterThan(0);
  });

  it("uses backend ranks and excludes missing actuals from the actual ranking", async () => {
    installHarness();
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole("link", { name: "分析" }));

    expect(await screen.findByRole("heading", { name: "钱的结构与长期负担健康吗？" })).toBeInTheDocument();
    expect(screen.getAllByText("固定承诺支出").length).toBeGreaterThan(0);
    expect(screen.getByText("房租")).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("排名依据"), "ACTUAL");
    expect(screen.queryByText("房租")).not.toBeInTheDocument();
    const rankingTable = screen.getByRole("table", { name: "项目排名图对应数值" });
    expect(within(rankingTable).getByText("电费")).toBeInTheDocument();
    expect(within(rankingTable).getByText("427.00")).toBeInTheDocument();
    expect(screen.getByText(/PAYMENT 项目在非支付月份仍计入/)).toBeInTheDocument();
  });

  it("invalidates month analytics after an actual entry is added", async () => {
    installHarness({ monthly: { "2026-08": [monthlyItem()] } });
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("heading", { name: "本月计划执行到哪里了？" });
    const analyticsCallCount = () =>
      invokeMock.mock.calls.filter(([command]) => command === "get_month_analytics").length;
    expect(analyticsCallCount()).toBe(1);

    await user.click(screen.getByRole("link", { name: "月度计划" }));
    await user.click(await screen.findByRole("button", { name: "添加支出或退款" }));
    await user.type(screen.getByLabelText("金额"), "427");
    await user.click(screen.getByRole("button", { name: "保存条目" }));
    await user.click(screen.getByRole("link", { name: "总览" }));
    await screen.findByRole("heading", { name: "本月计划执行到哪里了？" });
    await waitFor(() => expect(analyticsCallCount()).toBe(2));
  });
});
