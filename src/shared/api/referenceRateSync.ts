import {
  importReferenceRates,
  listExchangeRates,
  listPlanItems,
  type ExchangeRate,
} from "./finance";
import { fetchEcbReferenceRates, SUPPORTED_CURRENCIES } from "./referenceRates";

export interface ReferenceRateSyncResult {
  rates: ExchangeRate[];
  updatedCount: number;
  observedOn: string;
}

export async function syncOfficialReferenceRates(baseCurrency: string): Promise<ReferenceRateSyncResult> {
  const [observations, currentRates, plans] = await Promise.all([
    fetchEcbReferenceRates(),
    listExchangeRates(),
    listPlanItems(),
  ]);
  const coveredCurrencies = new Set(observations.map((observation) => observation.currency));
  const currencies = Array.from(new Set([
    ...SUPPORTED_CURRENCIES,
    ...currentRates.map((rate) => rate.currency),
    ...plans.map((plan) => plan.currency),
  ])).filter((currency) => currency !== baseCurrency && coveredCurrencies.has(currency));
  const rates = await importReferenceRates({ observations, currencies });
  const updated = rates.filter(
    (rate) => currencies.includes(rate.currency) && rate.source === "ECB_REFERENCE",
  );
  if (updated.length === 0) {
    throw new Error("官方参考汇率没有返回可更新的支持币种。");
  }
  return {
    rates,
    updatedCount: updated.length,
    observedOn: updated.map((rate) => rate.observed_on ?? "").sort().at(-1) ?? "",
  };
}
