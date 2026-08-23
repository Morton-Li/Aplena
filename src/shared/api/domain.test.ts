import { describe, expect, it, vi } from "vitest";

import { getDomainContract } from "./domain";

describe("domain API adapter", () => {
  it("uses the stable snake-case Tauri command name", async () => {
    const contract = {
      categories: [],
      flow_types: [],
      recognition_modes: [],
      amount_decimal_places: 4,
      exchange_rate_decimal_places: 8,
    };
    const invoke = vi.fn().mockResolvedValue(contract);

    await expect(getDomainContract(invoke)).resolves.toEqual(contract);
    expect(invoke).toHaveBeenCalledWith("get_domain_contract");
  });
});
