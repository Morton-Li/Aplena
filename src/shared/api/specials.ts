import { invoke } from "@tauri-apps/api/core";

import type { Invoke } from "./domain";
import type { ActualEntry, ActualEntryInput } from "./finance";

export const specialExpenseCategories = [
  "ESSENTIAL_EXPENSE",
  "FIXED_COMMITMENT_EXPENSE",
  "DISCRETIONARY_BUDGET",
] as const;

export type SpecialExpenseCategory = (typeof specialExpenseCategories)[number];

export interface SpecialProject {
  id: string;
  name: string;
  total_budget: string;
  allocated_budget: string;
  unallocated_budget: string;
  actual_net_amount: string | null;
  remaining_budget: string;
  currency: string;
  archived: boolean;
  note: string | null;
  created_at: string;
  updated_at: string;
}

export interface SpecialProjectInput {
  id?: string;
  name: string;
  totalBudget: string;
  note?: string;
}

export interface SpecialAllocation {
  id: string;
  project_id: string;
  month: string;
  category: SpecialExpenseCategory;
  amount: string;
  frozen: boolean;
  monthly_item_id: string | null;
}

export interface SpecialAllocationInput {
  id?: string;
  projectId: string;
  month: string;
  category: SpecialExpenseCategory;
  amount: string;
}

export interface SpecialActualEntry extends ActualEntry {
  month: string;
  category: SpecialExpenseCategory;
}

export interface SpecialActualEntryInput extends Omit<ActualEntryInput, "id" | "monthlyItemId"> {
  projectId: string;
  month: string;
  category: SpecialExpenseCategory;
}

export interface SpecialMonthlyTotal {
  month: string;
  planned_amount: string;
  actual_net_amount: string | null;
}

export interface SpecialDetailGroupTotal {
  detail_group: string | null;
  actual_net_amount: string;
  entry_count: number;
}

export interface SpecialProjectDetail {
  project: SpecialProject;
  allocations: SpecialAllocation[];
  entries: SpecialActualEntry[];
  monthly_totals: SpecialMonthlyTotal[];
  detail_group_totals: SpecialDetailGroupTotal[];
}

export const specialQueryKeys = {
  projects: ["special-projects"] as const,
  detail: (id: string) => ["special-project", id] as const,
};

export function listSpecialProjects(invokeCommand: Invoke = invoke): Promise<SpecialProject[]> {
  return invokeCommand<SpecialProject[]>("list_special_projects");
}

export function saveSpecialProject(
  input: SpecialProjectInput,
  invokeCommand: Invoke = invoke,
): Promise<SpecialProject> {
  return invokeCommand<SpecialProject>("save_special_project", { input });
}

export function archiveSpecialProject(
  input: { id: string; archived: boolean },
  invokeCommand: Invoke = invoke,
): Promise<SpecialProject> {
  return invokeCommand<SpecialProject>("archive_special_project", { input });
}

export function getSpecialProject(
  id: string,
  invokeCommand: Invoke = invoke,
): Promise<SpecialProjectDetail> {
  return invokeCommand<SpecialProjectDetail>("get_special_project", { id });
}

export function saveSpecialAllocation(
  input: SpecialAllocationInput,
  invokeCommand: Invoke = invoke,
): Promise<SpecialAllocation> {
  return invokeCommand<SpecialAllocation>("save_special_allocation", { input });
}

export function deleteSpecialAllocation(
  id: string,
  invokeCommand: Invoke = invoke,
): Promise<void> {
  return invokeCommand<void>("delete_special_allocation", { id });
}

export function createSpecialActualEntry(
  input: SpecialActualEntryInput,
  invokeCommand: Invoke = invoke,
): Promise<ActualEntry> {
  return invokeCommand<ActualEntry>("create_special_actual_entry", { input });
}
