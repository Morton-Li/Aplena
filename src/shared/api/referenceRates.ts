import type { ReferenceRateObservation } from "./finance";

export const SUPPORTED_CURRENCIES = ["CNY", "USD", "EUR", "HKD", "JPY", "GBP"] as const;

export const ECB_REFERENCE_RATES_URL =
  "https://data-api.ecb.europa.eu/service/data/EXR/D..EUR.SP00.A?format=csvdata&lastNObservations=1&detail=dataonly";

const ECB_REQUEST_TIMEOUT_MS = 10_000;

export async function fetchEcbReferenceRates(
  fetcher: typeof fetch = fetch,
): Promise<ReferenceRateObservation[]> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), ECB_REQUEST_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetcher(ECB_REFERENCE_RATES_URL, {
      headers: { Accept: "text/csv" },
      signal: controller.signal,
    });
  } finally {
    window.clearTimeout(timeout);
  }
  if (!response.ok) {
    throw new Error(`ECB reference rates request failed (${response.status})`);
  }
  const rows = parseEcbCsv(await response.text());
  const observedOn = rows.reduce(
    (latest, row) => row.observedOn > latest ? row.observedOn : latest,
    "",
  );
  if (!observedOn) throw new Error("ECB reference rates response was empty");
  return [
    { currency: "EUR", euroRate: "1", observedOn },
    ...rows.filter((row) => row.observedOn === observedOn),
  ].sort((left, right) => left.currency.localeCompare(right.currency));
}

export function isReferenceRateStale(
  observedOn: string,
  today = new Date().toISOString().slice(0, 10),
  maxAgeDays = 7,
): boolean {
  const observed = Date.parse(`${observedOn}T00:00:00Z`);
  const current = Date.parse(`${today}T00:00:00Z`);
  if (!Number.isFinite(observed) || !Number.isFinite(current)) return true;
  return current - observed > maxAgeDays * 86_400_000;
}

export function deriveReferenceRate(
  observations: ReferenceRateObservation[],
  sourceCurrency: string,
  baseCurrency: string,
): { rate: string; observedOn: string } | null {
  const source = observations.find((row) => row.currency === sourceCurrency);
  const base = observations.find((row) => row.currency === baseCurrency);
  if (!source || !base || source.observedOn !== base.observedOn) return null;
  const value = Number(base.euroRate) / Number(source.euroRate);
  if (!Number.isFinite(value) || value <= 0) return null;
  return { rate: value.toFixed(8), observedOn: source.observedOn };
}

function parseEcbCsv(csv: string): ReferenceRateObservation[] {
  const [header, ...lines] = csv.trim().split(/\r?\n/);
  const columns = header?.split(",") ?? [];
  const currencyIndex = columns.indexOf("CURRENCY");
  const dateIndex = columns.indexOf("TIME_PERIOD");
  const rateIndex = columns.indexOf("OBS_VALUE");
  if (currencyIndex < 0 || dateIndex < 0 || rateIndex < 0) {
    throw new Error("ECB reference rates response format was not recognized");
  }
  return lines.flatMap((line) => {
    const values = line.split(",");
    const currency = values[currencyIndex]?.trim();
    const observedOn = values[dateIndex]?.trim();
    const euroRate = values[rateIndex]?.trim();
    if (!currency || !observedOn || !euroRate || !/^[A-Z]{3}$/.test(currency) || !/^\d{4}-\d{2}-\d{2}$/.test(observedOn) || !/^\d+(\.\d+)?$/.test(euroRate)) {
      return [];
    }
    return [{ currency, euroRate, observedOn }];
  });
}
