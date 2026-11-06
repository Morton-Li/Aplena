import { entryRateInput, type EntryRateSnapshot } from "../../shared/api/entryRateSnapshot";
import {
  specialExpenseCategories,
  type SpecialActualEntryInput,
  type SpecialAllocation,
  type SpecialExpenseCategory,
} from "../../shared/api/specials";

export interface SpecialEntryValues {
  month: string;
  category: SpecialExpenseCategory;
  occurredOn: string;
  effect: "INCREASE" | "DECREASE";
  currency: string;
  note: string;
  detailGroup: string;
}

export function validSpecialMonth(value: string) {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(value) && !value.startsWith("0000-");
}

export function specialMonthLastDate(month: string) {
  if (!validSpecialMonth(month)) return "";
  const [year, numericMonth] = month.split("-").map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = numericMonth === 2 ? leap ? 29 : 28 : [4, 6, 9, 11].includes(numericMonth) ? 30 : 31;
  return `${month}-${days}`;
}

export function nextSpecialMonth(month: string) {
  if (!validSpecialMonth(month)) return "";
  const [year, numericMonth] = month.split("-").map(Number);
  return numericMonth === 12 ? `${String(year + 1).padStart(4, "0")}-01` : `${String(year).padStart(4, "0")}-${String(numericMonth + 1).padStart(2, "0")}`;
}

export function validSpecialEntryDate(date: string, month: string) {
  return validSpecialMonth(month) && /^\d{4}-\d{2}-\d{2}$/.test(date) &&
    date >= `${month}-01` && date <= specialMonthLastDate(month);
}

export function validSpecialBudget(amount: string) {
  return /^\d+(\.\d{1,2})?$/.test(amount.trim());
}

export function canEditSpecialAllocation(allocation: SpecialAllocation, currentMonth: string, archived = false) {
  return !archived && !allocation.frozen && allocation.month > currentMonth;
}

export function specialEntryValidation(values: SpecialEntryValues) {
  if (!validSpecialEntryDate(values.occurredOn, values.month)) return "实际日期必须是所选月份内的有效日期。";
  if (!specialExpenseCategories.includes(values.category)) return "请选择一种支出分类。";
  if (!/^[A-Z]{3}$/.test(values.currency)) return "请选择实际条目的币种。";
  return null;
}

export function specialActualInput(
  projectId: string,
  values: SpecialEntryValues,
  amount: string,
  snapshot: EntryRateSnapshot,
): SpecialActualEntryInput {
  return {
    projectId,
    month: values.month,
    category: values.category,
    occurredOn: values.occurredOn,
    effect: values.effect,
    amount,
    currency: values.currency,
    ...entryRateInput(snapshot),
    note: values.note.trim() || undefined,
    detailGroup: values.detailGroup.trim() || undefined,
  };
}
