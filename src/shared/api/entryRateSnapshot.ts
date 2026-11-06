import type { ActualEntry, ActualEntryInput, ExchangeRate } from "./finance";

export interface EntryRateSnapshot {
  rate: string;
  source: ActualEntryInput["exchangeRateSource"];
  observedOn: string;
  rebasedFromCurrency?: string | null;
  rebasedOn?: string | null;
}

export function entryRateSnapshot(
  currency: string,
  baseCurrency: string,
  occurredOn: string,
  rates: ExchangeRate[],
  existing?: ActualEntry,
): EntryRateSnapshot | null {
  if (existing) {
    return {
      rate: existing.exchange_rate,
      source: existing.exchange_rate_source === "MIGRATED_BASE" ? "BASE_CURRENCY" : existing.exchange_rate_source,
      observedOn: existing.exchange_rate_observed_on,
      rebasedFromCurrency: existing.exchange_rate_rebased_from_currency,
      rebasedOn: existing.exchange_rate_rebased_on,
    };
  }
  if (currency === baseCurrency) return { rate: "1.00000000", source: "BASE_CURRENCY", observedOn: occurredOn };
  const rate = rates.find((candidate) => candidate.currency === currency && candidate.base_currency === baseCurrency);
  return rate ? {
    rate: rate.rate,
    source: rate.source,
    observedOn: rate.rebased_on ?? rate.observed_on ?? occurredOn,
    rebasedFromCurrency: rate.rebased_from_currency,
    rebasedOn: rate.rebased_on,
  } : null;
}

export function entryRateInput(snapshot: EntryRateSnapshot) {
  return {
    exchangeRate: snapshot.rate,
    exchangeRateSource: snapshot.source,
    exchangeRateObservedOn: snapshot.observedOn,
    ...(snapshot.rebasedFromCurrency && snapshot.rebasedOn && {
      exchangeRateRebasedFromCurrency: snapshot.rebasedFromCurrency,
      exchangeRateRebasedOn: snapshot.rebasedOn,
    }),
  };
}
