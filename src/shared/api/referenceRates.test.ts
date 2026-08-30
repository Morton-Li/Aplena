import { describe, expect, it, vi } from "vitest";

import {
  deriveReferenceRate,
  fetchEcbReferenceRates,
  isReferenceRateStale,
  SUPPORTED_CURRENCIES,
} from "./referenceRates";

describe("ECB reference rates", () => {
  it("keeps one shared first-release currency list", () => {
    expect(SUPPORTED_CURRENCIES).toEqual(["CNY", "USD", "EUR", "HKD", "JPY", "GBP"]);
  });

  it("keeps only the latest observation date and adds the EUR anchor", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response([
      "KEY,FREQ,CURRENCY,CURRENCY_DENOM,EXR_TYPE,EXR_SUFFIX,TIME_PERIOD,OBS_VALUE",
      "EXR.D.USD.EUR.SP00.A,D,USD,EUR,SP00,A,2026-08-28,1.1643",
      "EXR.D.CNY.EUR.SP00.A,D,CNY,EUR,SP00,A,2026-08-28,7.8251",
      "EXR.D.BGN.EUR.SP00.A,D,BGN,EUR,SP00,A,2025-12-31,1.9558",
    ].join("\n"), { status: 200 }));

    await expect(fetchEcbReferenceRates(fetcher)).resolves.toEqual([
      { currency: "CNY", euroRate: "7.8251", observedOn: "2026-08-28" },
      { currency: "EUR", euroRate: "1", observedOn: "2026-08-28" },
      { currency: "USD", euroRate: "1.1643", observedOn: "2026-08-28" },
    ]);
  });

  it("rejects an unexpected response shape", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response("not,csv", { status: 200 }));
    await expect(fetchEcbReferenceRates(fetcher)).rejects.toThrow("format");
  });

  it("derives a source-to-base cross rate from the shared EUR anchor", () => {
    expect(deriveReferenceRate([
      { currency: "CNY", euroRate: "7.8251", observedOn: "2026-08-28" },
      { currency: "USD", euroRate: "1.1643", observedOn: "2026-08-28" },
    ], "USD", "CNY")).toEqual({ rate: "6.72086232", observedOn: "2026-08-28" });
  });

  it("uses the explicit EUR anchor when EUR is the source currency", () => {
    expect(deriveReferenceRate([
      { currency: "CNY", euroRate: "7.8251", observedOn: "2026-08-28" },
      { currency: "EUR", euroRate: "1", observedOn: "2026-08-28" },
    ], "EUR", "CNY")).toEqual({ rate: "7.82510000", observedOn: "2026-08-28" });
  });

  it("flags observations older than the visible seven-day freshness window", () => {
    expect(isReferenceRateStale("2026-08-23", "2026-08-30")).toBe(false);
    expect(isReferenceRateStale("2026-08-22", "2026-08-30")).toBe(true);
    expect(isReferenceRateStale("not-a-date", "2026-08-30")).toBe(true);
  });
});
