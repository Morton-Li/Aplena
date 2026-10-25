import { invoke } from "@tauri-apps/api/core";
import type { Invoke } from "./domain";

export type LoanDirection = "BORROWED" | "LENT";
export type LoanFrequency = "DAY" | "MONTH" | "QUARTER" | "YEAR";
export const loanFrequencyLabels: Record<LoanFrequency, string> = { DAY: "日", MONTH: "月", QUARTER: "季度", YEAR: "年" };
export interface Loan {
  id: string; name: string; counterparty: string; direction: LoanDirection; currency: string;
  principal: string; started_on: string; opening_only: boolean; archived: boolean; note: string | null;
  paid_principal: string; remaining_principal: string; remaining_charges: string;
  overdue_total: string; next_due_on: string | null; status: "ACTIVE" | "SETTLED";
}
export interface LoanInput {
  id: string; name: string; counterparty: string; direction: LoanDirection;
  principal: string; startedOn: string; openingOnly: boolean; note?: string;
}
export interface LoanInstallment {
  id: string; version_id: string; position: number; due_on: string;
  principal: string; interest: string; fees: string; paid_principal: string; paid_interest: string; paid_fees: string;
  remaining_principal: string; remaining_interest: string; remaining_fees: string; remaining_total: string;
  state: "PENDING" | "PARTIAL" | "OVERDUE" | "PAID" | "SUPERSEDED"; superseded: boolean;
}
export interface LoanAllocation { installmentId: string | null; principal: string; interest: string; fees: string }
export interface LoanPayment {
  id: string; occurred_on: string; principal: string; interest: string; fees: string; total: string;
  note: string | null; updated_at: string; allocations: LoanAllocation[];
}
export interface LoanPaymentInput {
  id: string; loanId: string; expectedUpdatedAt?: string; occurredOn: string;
  principal: string; interest: string; fees: string; note?: string; allocations: LoanAllocation[];
}
export interface LoanScheduleRow { due_on: string; principal: string; interest: string; fees: string }
export interface LoanScheduleInput {
  loanId: string; frequency: LoanFrequency; intervalCount: number; firstDate: string; count: number;
  method: "MANUAL" | "EQUAL_PRINCIPAL" | "ANNUITY"; periodRatePercent: string; note?: string; rows: LoanScheduleRow[];
}
export interface LoanSchedulePreview { principal_to_schedule: string; preserved_count: number; rows: LoanScheduleRow[] }
export interface LoanDetail {
  loan: Loan; installments: LoanInstallment[]; payments: LoanPayment[];
  versions: Array<{ id: string; frequency: LoanFrequency; interval_count: number; method: string; period_rate_percent: string; note: string | null; created_at: string }>;
}
export interface LoanMonthSummary {
  month: string; currency: string; has_loans: boolean; actual_principal_in: string; actual_principal_out: string;
  actual_cash_net: string | null; planned_borrow_principal: string; planned_borrow_charges: string; planned_borrow_total: string;
  planned_lent_principal: string; planned_lent_charges: string; planned_lent_total: string;
}
export const loanQueryKeys = {
  list: ["loans"] as const,
  detail: (id: string) => ["loan", id] as const,
  month: (month: string) => ["loan-month", month] as const,
};
export const listLoans = (call: Invoke = invoke) => call<Loan[]>("list_loans");
export const getLoan = (id: string, call: Invoke = invoke) => call<LoanDetail>("get_loan", { id });
export const createLoan = (input: LoanInput, call: Invoke = invoke) => call<Loan>("create_loan", { input });
export const updateLoanMetadata = (input: { id: string; name: string; counterparty: string; note?: string; archived: boolean }, call: Invoke = invoke) => call<void>("update_loan_metadata", { input });
export const previewLoanSchedule = (input: LoanScheduleInput, call: Invoke = invoke) => call<LoanSchedulePreview>("preview_loan_schedule", { input });
export const saveLoanSchedule = (input: LoanScheduleInput, call: Invoke = invoke) => call<void>("save_loan_schedule", { input });
export const previewLoanPayment = (input: LoanPaymentInput, call: Invoke = invoke) => call<LoanAllocation[]>("preview_loan_payment", { input });
export const saveLoanPayment = (input: LoanPaymentInput, call: Invoke = invoke) => call<void>("save_loan_payment", { input });
export const deleteLoanPayment = (input: { id: string; expectedUpdatedAt: string }, call: Invoke = invoke) => call<void>("delete_loan_payment", { input });
export const getLoanMonthSummary = (month: string, call: Invoke = invoke) => call<LoanMonthSummary>("get_loan_month_summary", { month });
