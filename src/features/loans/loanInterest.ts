import type { LoanFrequency, LoanInterestMode, LoanInterestRule } from "../../shared/api/loans";

export interface LoanInterestDraft {
  enabled: boolean; mode: LoanInterestMode; frequency: LoanFrequency; rate: string; fixed: string; started: string;
}

export function interestDraft(rule?: LoanInterestRule | null): LoanInterestDraft {
  return { enabled: Boolean(rule), mode: rule?.mode ?? "SIMPLE", frequency: rule?.frequency ?? "MONTH", rate: rule?.ratePercent ?? "", fixed: rule?.fixedAmount ?? "", started: rule?.startedOn ?? "" };
}

export function interestRule(draft: LoanInterestDraft, started: string): LoanInterestRule | null {
  return draft.enabled ? {
    mode: draft.mode, frequency: draft.frequency, ratePercent: draft.mode === "FIXED" ? "0" : draft.rate,
    fixedAmount: draft.mode === "FIXED" ? draft.fixed : "0.00", startedOn: draft.started || started,
  } : null;
}
