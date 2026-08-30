import type { MonthAnalytics } from "../../shared/api/finance";

export interface HistoryYearGroup {
  year: string;
  currency: string;
  months: MonthAnalytics[];
  monthCount: number;
  confirmedMonthCount: number;
  actualIncome: string | null;
  actualExpense: string | null;
  actualNetBalance: string | null;
  actualSavingsRatePercent: string | null;
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

  return {
    year,
    currency: sortedMonths[0]?.currency ?? "CNY",
    months: sortedMonths,
    monthCount: sortedMonths.length,
    confirmedMonthCount: sortedMonths.filter((month) => month.actual_status === "COMPLETE").length,
    actualIncome: formatCents(incomeCents),
    actualExpense: formatCents(expenseCents),
    actualNetBalance: formatCents(netCents),
    actualSavingsRatePercent: savingsRate(incomeCents, netCents),
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
