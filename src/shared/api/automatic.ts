import { invoke } from "@tauri-apps/api/core";

import type { Invoke } from "./domain";

export interface AutomaticEntryPolicy {
  plan_item_id: string;
  enabled: boolean;
  effective_month: string | null;
  first_date: string | null;
  period_months: number | null;
  amount: string | null;
  currency: string | null;
}

export type AutomaticOccurrenceState = "POSTED" | "CONFLICT" | "SKIPPED" | "DELETED" | "FAILED";

export interface AutomaticOccurrence {
  id: string;
  rule_key: string;
  rule_name?: string | null;
  month: string;
  state: AutomaticOccurrenceState;
  occurred_on: string;
  actual_entry_id: string | null;
  monthly_item_id: string | null;
  error_code?: string | null;
}

export interface AutomaticEntryCheck {
  current_month: string;
  created_count: number;
  conflict_count: number;
  failed_count: number;
  occurrences: AutomaticOccurrence[];
}

export type AutomaticConflictAction = "LINK_EXISTING" | "SKIP" | "CREATE_SEPARATE";

export const automaticQueryKeys = {
  policies: ["automatic-entry-policies"] as const,
  occurrences: (month?: string) => ["automatic-occurrences", month ?? "ALL"] as const,
};

export function listAutomaticEntryPolicies(invokeCommand: Invoke = invoke): Promise<AutomaticEntryPolicy[]> {
  return invokeCommand<AutomaticEntryPolicy[]>("list_automatic_entry_policies");
}

export function saveAutomaticEntryPolicy(
  input: { planItemId: string; enabled: boolean; firstDate?: string },
  invokeCommand: Invoke = invoke,
): Promise<AutomaticEntryPolicy> {
  return invokeCommand<AutomaticEntryPolicy>("save_automatic_entry_policy", { input });
}

export function checkAutomaticEntries(invokeCommand: Invoke = invoke): Promise<AutomaticEntryCheck> {
  return invokeCommand<AutomaticEntryCheck>("check_automatic_entries");
}

export function listAutomaticOccurrences(
  month?: string,
  invokeCommand: Invoke = invoke,
): Promise<AutomaticOccurrence[]> {
  return invokeCommand<AutomaticOccurrence[]>("list_automatic_occurrences", { month: month ?? null });
}

export function resolveAutomaticEntryConflict(
  input: { id: string; action: AutomaticConflictAction; actualEntryId?: string },
  invokeCommand: Invoke = invoke,
): Promise<AutomaticOccurrence> {
  return invokeCommand<AutomaticOccurrence>("resolve_automatic_entry_conflict", { input });
}
