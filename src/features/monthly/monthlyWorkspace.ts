import type { MonthlyItem } from "../../shared/api/finance";
import { categoryLabel } from "../../shared/formatting/labels";

export type MonthlyStatusFilter = "ALL" | "ATTENTION" | "IN_PROGRESS" | "CONFIRMED" | "ACTUAL_ONLY";
export type MonthlyFlowFilter = "ALL" | "INCOME" | "EXPENSE";
export type MonthlyVarianceFilter = "ALL" | MonthlyItem["variance_effect"];
export type MonthlySort = "PRIORITY" | "NAME" | "ACTUAL" | "VARIANCE" | "COMPLETION" | "UPDATED";

export interface MonthlyWorkspaceFilters {
  search: string;
  status: MonthlyStatusFilter;
  category: string;
  flow: MonthlyFlowFilter;
  variance: MonthlyVarianceFilter;
  sort: MonthlySort;
}

export interface MonthlyStatusCounts {
  total: number;
  missing: number;
  inProgress: number;
  confirmed: number;
  actualOnly: number;
}

export const defaultMonthlyWorkspaceFilters: MonthlyWorkspaceFilters = {
  search: "",
  status: "ALL",
  category: "ALL",
  flow: "ALL",
  variance: "ALL",
  sort: "PRIORITY",
};

export function isConfirmed(item: MonthlyItem) {
  return item.data_status === "FINAL" || item.data_status === "CONFIRMED_ZERO";
}

export function isActualOnly(item: MonthlyItem) {
  return item.item_origin === "MANUAL" || item.item_source === "ACTUAL_ONLY";
}

export function monthlyStatusCounts(items: MonthlyItem[]): MonthlyStatusCounts {
  return items.reduce<MonthlyStatusCounts>((counts, item) => {
    counts.total += 1;
    if (item.data_status === "MISSING") counts.missing += 1;
    if (item.data_status === "IN_PROGRESS") counts.inProgress += 1;
    if (isConfirmed(item)) counts.confirmed += 1;
    if (isActualOnly(item)) counts.actualOnly += 1;
    return counts;
  }, { total: 0, missing: 0, inProgress: 0, confirmed: 0, actualOnly: 0 });
}

export function filterAndSortMonthlyItems(
  items: MonthlyItem[],
  filters: MonthlyWorkspaceFilters,
) {
  const search = filters.search.trim().toLocaleLowerCase("zh-CN");
  return items
    .filter((item) => {
      if (search) {
        const searchable = [item.item_name, categoryLabel(item.category), item.note ?? ""]
          .join(" ")
          .toLocaleLowerCase("zh-CN");
        if (!searchable.includes(search)) return false;
      }
      if (filters.status === "ATTENTION" && item.data_status !== "MISSING") return false;
      if (filters.status === "IN_PROGRESS" && item.data_status !== "IN_PROGRESS") return false;
      if (filters.status === "CONFIRMED" && !isConfirmed(item)) return false;
      if (filters.status === "ACTUAL_ONLY" && !isActualOnly(item)) return false;
      if (filters.category !== "ALL" && item.category !== filters.category) return false;
      if (filters.flow !== "ALL" && item.flow_type !== filters.flow) return false;
      if (filters.variance !== "ALL" && item.variance_effect !== filters.variance) return false;
      return true;
    })
    .sort((left, right) => compareMonthlyItems(left, right, filters.sort));
}

export function hasActiveMonthlyFilters(filters: MonthlyWorkspaceFilters) {
  return filters.search.trim() !== "" ||
    filters.status !== "ALL" ||
    filters.category !== "ALL" ||
    filters.flow !== "ALL" ||
    filters.variance !== "ALL" ||
    filters.sort !== "PRIORITY";
}

function compareMonthlyItems(left: MonthlyItem, right: MonthlyItem, sort: MonthlySort) {
  let result = 0;
  if (sort === "PRIORITY") {
    result = priority(left) - priority(right) ||
      numeric(right.actual_amount) - numeric(left.actual_amount);
  } else if (sort === "NAME") {
    result = left.item_name.localeCompare(right.item_name, "zh-CN");
  } else if (sort === "ACTUAL") {
    result = numeric(right.actual_amount) - numeric(left.actual_amount);
  } else if (sort === "VARIANCE") {
    result = absoluteNumeric(right.variance_amount) - absoluteNumeric(left.variance_amount);
  } else if (sort === "COMPLETION") {
    result = numeric(right.completion_rate_percent) - numeric(left.completion_rate_percent);
  } else if (sort === "UPDATED") {
    result = right.updated_at.localeCompare(left.updated_at);
  }
  return result || left.item_name.localeCompare(right.item_name, "zh-CN");
}

function priority(item: MonthlyItem) {
  if (item.data_status === "MISSING") return 0;
  if (item.data_status === "IN_PROGRESS") return 1;
  if (item.variance_effect === "UNFAVORABLE") return 2;
  return 3;
}

function numeric(value: string | null) {
  if (value === null) return Number.NEGATIVE_INFINITY;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

function absoluteNumeric(value: string | null) {
  if (value === null) return Number.NEGATIVE_INFINITY;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.abs(parsed) : Number.NEGATIVE_INFINITY;
}
