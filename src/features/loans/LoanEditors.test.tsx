import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import type { LoanDetail } from "../../shared/api/loans";
import { LoanEditor, LoanPaymentEditor, LoanScheduleEditor } from "./LoanEditors";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
function wrap(children: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}>{children}</QueryClientProvider>);
}
const detail: LoanDetail = {
  loan: { id: "loan", name: "住房贷款", counterparty: "银行", direction: "BORROWED", currency: "CNY", principal: "1000.00", started_on: "2000-01-01", opening_only: true, archived: false, note: null, paid_principal: "0.00", remaining_principal: "1000.00", remaining_charges: "0.00", scheduled_remaining_principal: "0.00", plan_review_required: false, overdue_total: "0.00", next_due_on: null, status: "ACTIVE" },
  installments: [], payments: [], versions: [],
};
beforeEach(() => { vi.mocked(invoke).mockReset(); });

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
  expect(await screen.findByRole("alert")).toHaveTextContent("超过剩余本金");
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
