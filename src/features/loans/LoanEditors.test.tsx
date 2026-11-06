import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { MemoryRouter, useNavigate } from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";
import type { LoanAdvance, LoanAdvanceInput, LoanDetail, LoanScheduleInput } from "../../shared/api/loans";
import { LoanEditor, LoanPaymentEditor, LoanScheduleEditor } from "./LoanEditors";
import { LoansPage } from "./LoansPage";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
function wrap(children: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}>{children}</QueryClientProvider>);
}
const detail: LoanDetail = {
  loan: { id: "loan", name: "住房贷款", counterparty: "银行", direction: "BORROWED", currency: "CNY", principal: "1000.00", total_principal: "1000.00", started_on: "2000-01-01", opening_only: true, archived: false, note: null, paid_principal: "0.00", remaining_principal: "1000.00", remaining_charges: "0.00", scheduled_remaining_principal: "0.00", plan_review_required: false, overdue_total: "0.00", next_due_on: null, status: "ACTIVE" },
  installments: [], payments: [], advances: [], versions: [],
};
beforeEach(() => { vi.mocked(invoke).mockReset(); });

it.each([
  ["BORROWED", "我需偿还", "追加借入"],
  ["LENT", "待他人归还", "追加借出"],
] as const)("records and corrects principal advances from the %s workspace", async (direction, tab, action) => {
  let advance: LoanAdvance | null = null;
  vi.mocked(invoke).mockImplementation(async (command, args) => {
    const balance = advance ? (1000 + Number(advance.principal)).toFixed(2) : "1000.00";
    const loan = { ...detail.loan, direction, total_principal: balance, remaining_principal: balance };
    switch (command) {
      case "list_loans": return [loan];
      case "get_loan": return { ...detail, loan, advances: advance ? [advance] : [] };
      case "get_settings": return { base_currency: "CNY" };
      case "get_startup_status": return { current_month: "2026-11" };
      case "get_loan_month_summary": return { has_loans: false };
      case "save_loan_advance": {
        const input = (args as { input: LoanAdvanceInput }).input;
        advance = { id: input.id, occurred_on: input.occurredOn, principal: input.principal, note: input.note ?? null, updated_at: "revision" };
        return;
      }
      case "delete_loan_advance":
        advance = null;
        return;
      default: throw new Error(command);
    }
  });
  const user = userEvent.setup();
  wrap(<MemoryRouter><LoansPage /></MemoryRouter>);
  await user.click(screen.getByRole("button", { name: tab }));
  await user.click(await screen.findByRole("button", { name: action }));
  const editor = within(screen.getByRole("dialog", { name: action }));
  await user.type(editor.getByLabelText("追加本金（CNY）"), "200");
  fireEvent.change(editor.getByLabelText("发生日期"), { target: { value: "2000-02-12" } });
  await user.click(editor.getByRole("button", { name: "保存" }));
  const table = within(await screen.findByRole("table", { name: "追加本金记录" }));
  const balance = within(screen.getByRole("region", { name: "借贷余额" }));
  expect(balance.getByText("剩余本金").parentElement).toHaveTextContent("1,200.00");
  expect(invoke).toHaveBeenCalledWith("save_loan_advance", { input: expect.objectContaining({ loanId: detail.loan.id, occurredOn: "2000-02-12", principal: "200" }) });

  await user.click(table.getByRole("button", { name: "编辑" }));
  const edit = within(screen.getByRole("dialog", { name: `编辑${action}` }));
  const principal = edit.getByLabelText("追加本金（CNY）");
  expect(principal).toHaveValue("200");
  await user.clear(principal);
  await user.type(principal, "300");
  await user.click(edit.getByRole("button", { name: "保存" }));
  await waitFor(() => expect(balance.getByText("剩余本金").parentElement).toHaveTextContent("1,300.00"));
  expect(invoke).toHaveBeenCalledWith("save_loan_advance", { input: expect.objectContaining({ expectedUpdatedAt: "revision", principal: "300" }) });

  await user.click(table.getByRole("button", { name: "删除" }));
  await user.click(within(screen.getByRole("dialog", { name: "删除这笔追加记录？" })).getByRole("button", { name: "确认删除" }));
  expect(await screen.findByText("还没有追加记录。")).toBeInTheDocument();
  expect(balance.getByText("剩余本金").parentElement).toHaveTextContent("1,000.00");
  expect(invoke).toHaveBeenCalledWith("delete_loan_advance", { input: { id: expect.any(String), expectedUpdatedAt: "revision" } });
});

it("keeps a new advance attached to its original loan after history navigation", async () => {
  const otherLoan = { ...detail.loan, id: "other-loan", name: "第二笔借款" };
  vi.mocked(invoke).mockImplementation(async (command, args) => {
    switch (command) {
      case "list_loans": return [otherLoan, detail.loan];
      case "get_loan": return { ...detail, loan: (args as { id: string }).id === otherLoan.id ? otherLoan : detail.loan };
      case "get_settings": return { base_currency: "CNY" };
      case "get_startup_status": return { current_month: "2026-11" };
      case "get_loan_month_summary": return { has_loans: false };
      case "save_loan_advance": return;
      default: throw new Error(command);
    }
  });
  function HistoryBack() {
    const navigate = useNavigate();
    return <button type="button" onClick={() => void navigate(-1)}>返回上一页</button>;
  }
  const user = userEvent.setup();
  wrap(<MemoryRouter initialEntries={["/loans?id=other-loan"]}><HistoryBack /><LoansPage /></MemoryRouter>);
  await screen.findByRole("heading", { name: otherLoan.name });
  await user.click(screen.getByRole("button", { name: new RegExp(detail.loan.name) }));
  await screen.findByRole("heading", { name: detail.loan.name });
  await user.click(screen.getByRole("button", { name: "追加借入" }));
  const editor = within(screen.getByRole("dialog", { name: "追加借入" }));
  await user.type(editor.getByLabelText("追加本金（CNY）"), "200");
  fireEvent.click(screen.getByRole("button", { name: "返回上一页" }));
  await screen.findByRole("heading", { name: otherLoan.name });
  await user.click(editor.getByRole("button", { name: "保存" }));

  await waitFor(() => expect(invoke).toHaveBeenCalledWith("save_loan_advance", {
    input: expect.objectContaining({ loanId: detail.loan.id, principal: "200" }),
  }));
});

it("creates a loan in either direction from an opening balance without a fake receipt", async () => {
  const user = userEvent.setup();
  const saved = vi.fn().mockResolvedValue(undefined);
  vi.mocked(invoke).mockResolvedValue({ ...detail.loan, direction: "LENT" });
  wrap(<LoanEditor currency="CNY" direction="BORROWED" onClose={vi.fn()} onSaved={saved} />);
  await user.click(screen.getByRole("combobox", { name: "借贷方向" }));
  await user.click(screen.getByRole("option", { name: "我借给别人" }));
  await user.type(screen.getByLabelText("名称"), "借给张三");
  await user.type(screen.getByLabelText("借款人"), "张三");
  await user.type(screen.getByLabelText(/期初剩余本金/), "1000.00");
  fireEvent.change(screen.getByLabelText("开始跟踪日期"), { target: { value: "2000-01-01" } });
  await user.click(screen.getByRole("button", { name: "保存" }));
  await waitFor(() => expect(saved).toHaveBeenCalledOnce());
  expect(invoke).toHaveBeenCalledExactlyOnceWith("create_loan", { input: expect.objectContaining({ direction: "LENT", openingOnly: true, principal: "1000.00", startedOn: "2000-01-01" }) });
});

it.each(["日", "月", "季度", "年"])("previews %s installments and invalidates the preview when edited", async (label) => {
  const user = userEvent.setup();
  vi.mocked(invoke).mockResolvedValue({ principal_to_schedule: "1000.00", preserved_count: 0, rows: [{ due_on: "2028-01-31", principal: "1000.00", interest: "0.00", fees: "0.00" }] });
  wrap(<LoanScheduleEditor detail={detail} onClose={vi.fn()} onSaved={vi.fn()} />);
  expect(screen.getByRole("button", { name: "保存计划" })).toBeDisabled();
  await user.click(screen.getByRole("combobox", { name: "周期单位" }));
  await user.click(screen.getByRole("option", { name: label }));
  fireEvent.change(screen.getByLabelText("首次还款日"), { target: { value: "2028-01-31" } });
  await user.click(screen.getByRole("button", { name: "预览并核对" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "保存计划" })).toBeEnabled());
  expect(invoke).toHaveBeenCalledWith("preview_loan_schedule", { input: expect.objectContaining({ frequency: ({ 日: "DAY", 月: "MONTH", 季度: "QUARTER", 年: "YEAR" })[label], firstDate: "2028-01-31" }) });
  await user.click(screen.getByRole("button", { name: "在此结果上手动调整本金、利息或日期" }));
  fireEvent.change(screen.getByLabelText("第1期本金"), { target: { value: "900.00" } });
  expect(screen.getByRole("button", { name: "保存计划" })).toBeDisabled();
  expect(screen.getByLabelText("第1期本金")).toHaveValue("900.00");
});

it("requires an explicit preview before replacing overdue unpaid installments", async () => {
  const user = userEvent.setup();
  const existing: LoanDetail = { ...detail, installments: [{
    id: "overdue", version_id: "version", position: 1, due_on: "2000-02-12",
    principal: "1250.00", interest: "20.00", fees: "0.00",
    paid_principal: "0.00", paid_interest: "5.00", paid_fees: "0.00",
    remaining_principal: "1250.00", remaining_interest: "15.00", remaining_fees: "0.00",
    remaining_total: "1265.00", state: "OVERDUE", superseded: false,
  }] };
  vi.mocked(invoke).mockImplementation(async (command, args) => {
    const input = (args as { input: LoanScheduleInput }).input;
    if (command === "preview_loan_schedule") {
      if (!input.correctPastInstallments) {
        throw { error_code: "LOAN_PAST_INSTALLMENTS_CORRECTION_REQUIRED", message_key: "error.loan_past_installments_correction_required" };
      }
      return { principal_to_schedule: "1000.00", preserved_count: 0, corrected_past_count: 1, correction_revision: "reviewed-correction", rows: input.rows };
    }
    if (command === "save_loan_schedule") return;
    throw new Error(command);
  });
  const saved = vi.fn().mockResolvedValue(undefined);
  wrap(<LoanScheduleEditor detail={existing} onClose={vi.fn()} onSaved={saved} />);
  const save = screen.getByRole("button", { name: "保存计划" });
  const check = screen.getByRole("button", { name: "预览并核对" });
  await user.click(check);
  const optIn = await screen.findByRole("checkbox", { name: "更正逾期未清偿期次" });
  expect(optIn).not.toBeChecked();
  expect(save).toBeDisabled();
  await user.click(optIn);
  expect(screen.getByLabelText("第1期利息")).toHaveValue("15.00");
  fireEvent.change(screen.getByLabelText("第1期本金"), { target: { value: "1000.00" } });
  await user.click(check);
  expect(await screen.findByRole("status")).toHaveTextContent("替换 1 个逾期未清偿期次");
  await user.click(save);
  await waitFor(() => expect(saved).toHaveBeenCalledOnce());
  expect(invoke).toHaveBeenCalledWith("save_loan_schedule", {
    input: expect.objectContaining({
      correctPastInstallments: true, expectedCorrectionRevision: "reviewed-correction", method: "MANUAL",
      rows: [{ due_on: "2000-02-12", principal: "1000.00", interest: "15.00", fees: "0.00" }],
    }),
  });
});

it("previews allocations before saving a payment and keeps a rejected draft", async () => {
  const user = userEvent.setup();
  vi.mocked(invoke).mockImplementation(async (command) => {
    if (command === "preview_loan_payment") return [{ installmentId: null, principal: "100.00", interest: "10.00", fees: "0.00" }];
    throw { error_code: "LOAN_PRINCIPAL_OVERPAYMENT", message_key: "error.loan_principal_overpayment" };
  });
  const saved = vi.fn();
  wrap(<LoanPaymentEditor detail={detail} onClose={vi.fn()} onSaved={saved} />);
  expect(screen.getByRole("button", { name: "保存实际收付" })).toBeDisabled();
  fireEvent.change(screen.getByLabelText("本金（CNY）"), { target: { value: "100.00" } });
  fireEvent.change(screen.getByLabelText("利息（CNY）"), { target: { value: "10.00" } });
  await user.click(screen.getByRole("button", { name: "预览分配" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "保存实际收付" })).toBeEnabled());
  await user.click(screen.getByRole("button", { name: "保存实际收付" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("剩余本金低于零");
  expect(screen.getByLabelText("本金（CNY）")).toHaveValue("100.00");
  expect(saved).not.toHaveBeenCalled();
});

it("omits settled future installments from manual edits and ignores a hidden calculator rate", async () => {
  const user = userEvent.setup();
  const installment = {
    id: "paid", version_id: "version", position: 1, due_on: "2099-12-01", principal: "250.00", interest: "0.00", fees: "0.00",
    paid_principal: "250.00", paid_interest: "0.00", paid_fees: "0.00", remaining_principal: "0.00", remaining_interest: "0.00",
    remaining_fees: "0.00", remaining_total: "0.00", state: "PAID" as const, superseded: false,
  };
  const existing: LoanDetail = { ...detail, installments: [installment, {
    ...installment, id: "unpaid", position: 2, due_on: "2099-12-02", principal: "750.00", paid_principal: "0.00",
    remaining_principal: "750.00", remaining_total: "750.00", state: "PENDING",
  }] };
  vi.mocked(invoke).mockResolvedValue({ principal_to_schedule: "750.00", preserved_count: 0, rows: [] });
  wrap(<LoanScheduleEditor detail={existing} onClose={vi.fn()} onSaved={vi.fn()} />);
  fireEvent.change(screen.getByLabelText(/每期利率/), { target: { value: "" } });
  await user.click(screen.getByRole("combobox", { name: "生成方式" }));
  await user.click(screen.getByRole("option", { name: "手动逐期指定" }));
  expect(screen.getByLabelText("第1期本金")).toHaveValue("750.00");
  expect(screen.queryByLabelText("第2期本金")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "预览并核对" }));
  await waitFor(() => expect(invoke).toHaveBeenCalledWith("preview_loan_schedule", { input: expect.objectContaining({
    method: "MANUAL", periodRatePercent: "0", rows: [{ due_on: "2099-12-02", principal: "750.00", interest: "0.00", fees: "0.00" }],
  }) }));
});
