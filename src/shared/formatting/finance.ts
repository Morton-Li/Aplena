import type { ActualEntry } from "../api/finance";

const currencySymbols: Record<string, string> = {
  CNY: "¥",
  USD: "US$",
  EUR: "€",
  HKD: "HK$",
  JPY: "JP¥",
  GBP: "£",
};

const currencyNames: Record<string, string> = {
  CNY: "人民币（CNY）",
  USD: "美元（USD）",
  EUR: "欧元（EUR）",
  HKD: "港币（HKD）",
  JPY: "日元（JPY）",
  GBP: "英镑（GBP）",
};

export function formatMoney(value: string | null, currency: string, fallback = "—") {
  if (value === null) return fallback;
  const match = /^([+-]?)(\d+)(?:\.(\d+))?$/.exec(value.trim());
  if (!match) return `${currencySymbols[currency] ?? currency} ${value}`;

  const [, sign, integer, fraction = ""] = match;
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const decimals = fraction.padEnd(2, "0").slice(0, 2);
  const prefix = sign === "-" ? "−" : sign;
  return `${prefix}${currencySymbols[currency] ?? currency} ${grouped}.${decimals}`;
}

export function formatPercent(value: string | null, fallback = "—") {
  return value === null ? fallback : `${displayDecimal(value)}%`;
}

export function formatPercentagePoints(value: string | null, fallback = "—") {
  return value === null ? fallback : `${displayDecimal(value)} 个百分点`;
}

export function formatExchangeRate(value: string) {
  const match = /^(\d+)(?:\.(\d+))?$/.exec(value.trim());
  if (!match) return value;

  const [, integer, fraction = ""] = match;
  const significantFraction = fraction.replace(/0+$/, "");
  return `${integer}.${significantFraction.padEnd(2, "0")}`;
}

export function formatRebasedRateSource(rebasedFromCurrency?: string | null, rebasedOn?: string | null) {
  return rebasedFromCurrency && rebasedOn
    ? `本位币切换换算 · 原本位币 ${rebasedFromCurrency} · 换算日 ${rebasedOn}`
    : null;
}

export function formatEntryRateSource(
  source: ActualEntry["exchange_rate_source"],
  observedOn: string,
  rebasedFromCurrency?: string | null,
  rebasedOn?: string | null,
) {
  const rebased = formatRebasedRateSource(rebasedFromCurrency, rebasedOn);
  if (rebased) return rebased;
  const label = source === "ECB_REFERENCE" ? "欧洲央行每日参考汇率" : source === "MANUAL" ? "备用手动汇率" : "本位币";
  return `${label} · ${observedOn}`;
}

export function currencyName(currency: string) {
  return currencyNames[currency] ?? currency;
}

export function decimalValue(value: string | null) {
  if (value === null) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function compactMoney(value: number, currency: string) {
  return new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency,
    currencyDisplay: "narrowSymbol",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value).replace("-", "−");
}

export function monthLabel(month: string) {
  const [year, value] = month.split("-");
  return year && value ? `${year} 年 ${Number(value)} 月` : month;
}

export function isValidMonth(value: string | null | undefined): value is string {
  return typeof value === "string" && /^(?!0000)\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

function displayDecimal(value: string) {
  return value.startsWith("-") ? `−${value.slice(1)}` : value;
}
