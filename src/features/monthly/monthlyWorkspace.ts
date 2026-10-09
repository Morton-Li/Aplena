import type { MonthlyItem } from "../../shared/api/finance";
import { categoryLabel } from "../../shared/formatting/labels";

export type MonthlyFlowFilter = "ALL" | "INCOME" | "EXPENSE";
export type MonthlyVarianceFilter = "ALL" | MonthlyItem["variance_effect"];
export type MonthlySort = "UPDATED" | "NAME" | "ACTUAL" | "VARIANCE" | "COMPLETION";

export interface MonthlyWorkspaceFilters {
  search: string;
  category: string;
  flow: MonthlyFlowFilter;
  variance: MonthlyVarianceFilter;
  sort: MonthlySort;
}

export interface MonthlyItemCounts {
  total: number;
  planned: number;
  temporary: number;
  entries: number;
}

export const defaultMonthlyWorkspaceFilters: MonthlyWorkspaceFilters = {
  search: "",
  category: "ALL",
  flow: "ALL",
  variance: "ALL",
  sort: "UPDATED",
};

export function defaultActualEntryDate(month: string, now = new Date()) {
  const localDate = [
    String(now.getFullYear()).padStart(4, "0"),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("-");
  return localDate.startsWith(`${month}-`) ? localDate : `${month}-01`;
}

export function isActualOnly(item: MonthlyItem) {
  return item.item_source === "ACTUAL_ONLY";
}

export function isTemporaryItem(item: MonthlyItem) {
  return item.item_origin === "MANUAL";
}

export function isSpecialProjectItem(item: MonthlyItem) {
  return item.item_origin === "SPECIAL_PROJECT";
}

export function hasMonthlyBudgetBaseline(item: MonthlyItem) {
  return item.item_source === "PLANNED" && !isTemporaryItem(item);
}

export function specialProjectLink(item: MonthlyItem) {
  return isSpecialProjectItem(item) && item.source_special_project_id
    ? `/specials?id=${encodeURIComponent(item.source_special_project_id)}`
    : null;
}

export function monthlyItemCounts(items: MonthlyItem[]): MonthlyItemCounts {
  return items.reduce<MonthlyItemCounts>((counts, item) => {
    counts.total += 1;
    if (hasMonthlyBudgetBaseline(item)) counts.planned += 1;
    if (isTemporaryItem(item)) counts.temporary += 1;
    counts.entries += item.actual_entry_count;
    return counts;
  }, { total: 0, planned: 0, temporary: 0, entries: 0 });
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
      if (filters.category !== "ALL" && item.category !== filters.category) return false;
      if (filters.flow !== "ALL" && item.flow_type !== filters.flow) return false;
      if (filters.variance !== "ALL" && item.variance_effect !== filters.variance) return false;
      return true;
    })
    .sort((left, right) => compareMonthlyItems(left, right, filters.sort));
}

export function hasActiveMonthlyFilters(filters: MonthlyWorkspaceFilters) {
  return filters.search.trim() !== "" ||
    filters.category !== "ALL" ||
    filters.flow !== "ALL" ||
    filters.variance !== "ALL" ||
    filters.sort !== "UPDATED";
}

function compareMonthlyItems(left: MonthlyItem, right: MonthlyItem, sort: MonthlySort) {
  const result = sort === "NAME"
    ? left.item_name.localeCompare(right.item_name, "zh-CN")
    : sort === "ACTUAL"
      ? numeric(right.actual_amount) - numeric(left.actual_amount)
      : sort === "VARIANCE"
        ? absoluteNumeric(right.variance_amount) - absoluteNumeric(left.variance_amount)
        : sort === "COMPLETION"
          ? numeric(right.completion_rate_percent) - numeric(left.completion_rate_percent)
          : right.updated_at.localeCompare(left.updated_at);
  return result || left.item_name.localeCompare(right.item_name, "zh-CN");
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
