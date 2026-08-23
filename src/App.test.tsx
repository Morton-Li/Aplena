import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";
import type { Invoke } from "./shared/api/domain";
import type {
  InitializeMonthResult,
  MonthPreview,
  MonthlyItem,
  PlanItem,
  Settings,
} from "./shared/api/finance";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

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
  amount_decimal_places: 4,
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
  planned_amount: "1200.0000",
  currency: "CNY",
  period_months: 12,
  start_month: "2026-08",
  end_month: null,
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
    planned_amount: "300.0000",
    actual_amount: null,
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

interface HarnessOptions {
  settings?: Settings | null;
  plans?: PlanItem[];
  monthly?: Record<string, MonthlyItem[]>;
  startupCreated?: number;
  missingCurrency?: string;
  rejectCommand?: { command: string; error: unknown };
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
      case "preview_plan_item": {
        const request = args?.request as {
          planItem: { recognitionMode: string };
        };
        return {
          effective: true,
          recognized_in_target_month: request.planItem.recognitionMode === "AMORTIZED",
          monthly_equivalent: "100.0000",
          recognized_amount:
            request.planItem.recognitionMode === "AMORTIZED" ? "100.0000" : null,
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
      case "update_monthly_actual": {
        const input = args?.input as { id: string; actualAmount: string | null };
        return monthlyItem({
          id: input.id,
          actual_amount: input.actualAmount,
          data_status:
            input.actualAmount === null ? "MISSING" : input.actualAmount === "0" ? "CONFIRMED_ZERO" : "RECORDED",
        }) as T;
      }
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

    expect((await screen.findAllByText("100.0000 CNY")).length).toBeGreaterThan(0);
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
    expect(screen.getByText("只在以开始月份为锚点的支付月计入完整金额。")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "预览并检查" }));
    expect(await screen.findByText("不会")).toBeInTheDocument();
    expect(screen.getByText("无论哪种模式，财务承载能力都按月均负担计算。")).toBeInTheDocument();
  });

  it("shows current-month automatic initialization and preserves NULL, zero, and positive states", async () => {
    installHarness({
      startupCreated: 2,
      monthly: {
        "2026-08": [
          monthlyItem(),
          monthlyItem({
            id: "00000000-0000-0000-0000-000000000202",
            item_name: "退款",
            actual_amount: "0.0000",
            variance_amount: "-100.0000",
            completion_rate_percent: "0.00",
            data_status: "CONFIRMED_ZERO",
            variance_effect: "FAVORABLE",
          }),
          monthlyItem({
            id: "00000000-0000-0000-0000-000000000203",
            item_name: "房租",
            actual_amount: "300.0000",
            variance_amount: "0.0000",
            completion_rate_percent: "100.00",
            data_status: "RECORDED",
            variance_effect: "ON_PLAN",
          }),
        ],
      },
    });
    const user = userEvent.setup();
    render(<App />);

    expect(await screen.findByText(/当前月已自动检查：新增 2 项/)).toBeInTheDocument();
    expect(screen.getByText("尚未录入")).toBeInTheDocument();
    expect(screen.getAllByText("0.0000").length).toBeGreaterThan(0);
    expect(screen.getAllByText("300.0000").length).toBeGreaterThan(0);
    await user.click(screen.getAllByRole("button", { name: "确认实际为 0" })[0]);
    expect(invokeMock).toHaveBeenCalledWith("update_monthly_actual", {
      input: expect.objectContaining({ actualAmount: "0" }),
    });
    await user.clear(screen.getByLabelText("房租 实际金额"));
    await user.type(screen.getByLabelText("房租 实际金额"), "427");
    await user.click(within(screen.getByText("房租").closest("article")!).getByRole("button", { name: "保存实际" }));
    expect(invokeMock).toHaveBeenCalledWith("update_monthly_actual", {
      input: expect.objectContaining({ actualAmount: "427" }),
    });
  });

  it("browses future and historical months without writes, then explicitly initializes", async () => {
    installHarness();
    const user = userEvent.setup();
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

  it("batch confirmation states that existing actual amounts are never overwritten", async () => {
    installHarness({ monthly: { "2026-08": [monthlyItem()] } });
    const user = userEvent.setup();
    render(<App />);
    expect(await screen.findByText("确认操作只填充尚未录入项，不覆盖 0 或已有正数。")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "未录入项按计划确认" }));
    expect(await screen.findByText("已确认 1 项，已有实际金额未被覆盖。")).toBeInTheDocument();
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
});
