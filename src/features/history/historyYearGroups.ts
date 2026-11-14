import type { CategoryBreakdown, MonthAnalytics } from "../../shared/api/finance";

export interface HistoryYearGroup {
  year: string;
  currency: string;
  months: MonthAnalytics[];
  monthCount: number;
  actualIncome: string | null;
  actualExpense: string | null;
  actualNetBalance: string | null;
  actualSavingsRatePercent: string | null;
  actualMonthCount: number;
  plannedMonthCount: number;
  plannedIncome: string;
  plannedExpense: string;
  plannedNetBalance: string;
  plannedSavingsRatePercent: string | null;
  categories: CategoryBreakdown[];
}

export function groupHistoryByYear(months: MonthAnalytics[]): HistoryYearGroup[] {
  const grouped = new Map<string, MonthAnalytics[]>();
  for (const month of months) {
    const year = month.month.slice(0, 4);
    const existing = grouped.get(year) ?? [];
    existing.push(month);
    grouped.set(year, existing);
  }

  return [...grouped.entries()]
    .sort(([left], [right]) => right.localeCompare(left))
    .map(([year, yearMonths]) => buildYearGroup(year, yearMonths));
}

export function defaultExpandedHistoryYears(groups: HistoryYearGroup[]): string[] {
  return groups.length === 0 ? [] : [groups[0].year];
}

function buildYearGroup(year: string, months: MonthAnalytics[]): HistoryYearGroup {
  const sortedMonths = [...months].sort((left, right) => right.month.localeCompare(left.month));
  const incomeCents = sumAmounts(sortedMonths.map((month) => month.income.actual_to_date));
  const expenseCents = sumAmounts(sortedMonths.map((month) => month.expense.actual_to_date));
  const netCents = sumAmounts(sortedMonths.map((month) => month.net_balance.actual_to_date));
  const plannedIncome = sumAmounts(sortedMonths.map((month) => month.income.planned));
  const plannedExpense = sumAmounts(sortedMonths.map((month) => month.expense.planned));
  const plannedNet = sumAmounts(sortedMonths.map((month) => month.net_balance.planned));

  const categoryGroups = new Map<string, CategoryBreakdown[]>();
  for (const month of sortedMonths) {
    for (const category of month.categories) {
      const key = `${category.flow_type}:${category.category}`;
      const group = categoryGroups.get(key) ?? [];
      group.push(category);
      categoryGroups.set(key, group);
    }
  }
  const categories = [...categoryGroups.values()].map((group) => {
    const first = group[0];
    const planned = sumAmounts(group.map((item) => item.planned_amount));
    const actual = sumAmounts(group.map((item) => item.actual_to_date));
    return {
      category: first.category,
      flow_type: first.flow_type,
      planned_amount: formatCents(planned) ?? "0.00",
      actual_to_date: formatCents(actual),
      planned_share_percent: savingsRate(first.flow_type === "INCOME" ? plannedIncome : plannedExpense, planned),
      actual_share_percent: savingsRate(first.flow_type === "INCOME" ? incomeCents : expenseCents, actual),
    };
  });

  return {
    year,
    currency: sortedMonths[0]?.currency ?? "CNY",
    months: sortedMonths,
    monthCount: sortedMonths.length,
    actualIncome: formatCents(incomeCents),
    actualExpense: formatCents(expenseCents),
    actualNetBalance: formatCents(netCents),
    actualSavingsRatePercent: savingsRate(incomeCents, netCents),
    actualMonthCount: sortedMonths.filter((month) => month.net_balance.actual_to_date !== null).length,
    plannedMonthCount: sortedMonths.filter((month) => month.planned_item_count > 0).length,
    plannedIncome: formatCents(plannedIncome) ?? "0.00",
    plannedExpense: formatCents(plannedExpense) ?? "0.00",
    plannedNetBalance: formatCents(plannedNet) ?? "0.00",
    plannedSavingsRatePercent: savingsRate(plannedIncome, plannedNet),
    categories,
  };
}

function sumAmounts(values: Array<string | null>): bigint | null {
  const amounts = values.map(parseCents).filter((value): value is bigint => value !== null);
  if (amounts.length === 0) return null;
  return amounts.reduce((total, value) => total + value, 0n);
}

function parseCents(value: string | null): bigint | null {
  if (value === null) return null;
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!match) return null;
  const sign = match[1] === "-" ? -1n : 1n;
  const fractional = (match[3] ?? "").padEnd(2, "0");
  return sign * (BigInt(match[2]) * 100n + BigInt(fractional));
}

function formatCents(value: bigint | null): string | null {
  if (value === null) return null;
  const sign = value < 0n ? "-" : "";
  const absolute = value < 0n ? -value : value;
  return `${sign}${absolute / 100n}.${String(absolute % 100n).padStart(2, "0")}`;
}

function savingsRate(incomeCents: bigint | null, netCents: bigint | null): string | null {
  if (incomeCents === null || incomeCents <= 0n || netCents === null) return null;
  const scaled = netCents * 10_000n;
  const rounded = scaled >= 0n
    ? (scaled + incomeCents / 2n) / incomeCents
    : (scaled - incomeCents / 2n) / incomeCents;
  return formatHundredths(rounded);
}

function formatHundredths(value: bigint): string {
  const sign = value < 0n ? "-" : "";
  const absolute = value < 0n ? -value : value;
  return `${sign}${absolute / 100n}.${String(absolute % 100n).padStart(2, "0")}`;
}
