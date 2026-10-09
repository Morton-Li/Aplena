import { describe, expect, it, vi } from "vitest";

import { archiveSpecialProject, createSpecialActualEntry, deleteSpecialAllocation, getSpecialProject, listSpecialProjects, saveSpecialAllocation, saveSpecialProject } from "../../shared/api/specials";
import { specialDetail } from "./testFixtures";

describe("special IPC adapters", () => {
  it("passes stable command names and camelCase input, preserving backend detail totals", async () => {
    const detail = specialDetail();
    const invoke = vi.fn().mockResolvedValue(detail);
    await expect(getSpecialProject("trip", invoke)).resolves.toBe(detail);
    expect(invoke).toHaveBeenLastCalledWith("get_special_project", { id: "trip" });
    await listSpecialProjects(invoke);
    expect(invoke).toHaveBeenLastCalledWith("list_special_projects");
    await saveSpecialProject({ id: "trip", name: "旅行", totalBudget: "1000.00" }, invoke);
    expect(invoke).toHaveBeenLastCalledWith("save_special_project", { input: { id: "trip", name: "旅行", totalBudget: "1000.00" } });
    await archiveSpecialProject({ id: "trip", archived: true }, invoke);
    expect(invoke).toHaveBeenLastCalledWith("archive_special_project", { input: { id: "trip", archived: true } });
    await saveSpecialAllocation({ projectId: "trip", month: "2026-11", category: "DISCRETIONARY_BUDGET", amount: "300.00" }, invoke);
    expect(invoke).toHaveBeenLastCalledWith("save_special_allocation", { input: { projectId: "trip", month: "2026-11", category: "DISCRETIONARY_BUDGET", amount: "300.00" } });
    await deleteSpecialAllocation("allocation", invoke);
    expect(invoke).toHaveBeenLastCalledWith("delete_special_allocation", { id: "allocation" });
  });

  it("creates actual facts through the canonical project container endpoint", async () => {
    const invoke = vi.fn().mockResolvedValue({ id: "refund" });
    const input = {
      projectId: "trip", month: "2026-10", category: "ESSENTIAL_EXPENSE" as const, occurredOn: "2026-10-07", effect: "DECREASE" as const, amount: "25.00", currency: "USD",
      exchangeRate: "7.10000000", exchangeRateSource: "ECB_REFERENCE" as const, exchangeRateObservedOn: "2026-10-06", detailGroup: "住宿",
    };
    await createSpecialActualEntry(input, invoke);
    expect(invoke).toHaveBeenCalledExactlyOnceWith("create_special_actual_entry", { input });
  });
});
