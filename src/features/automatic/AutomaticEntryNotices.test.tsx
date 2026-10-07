import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { listAutomaticOccurrences, resolveAutomaticEntryConflict, type AutomaticOccurrence } from "../../shared/api/automatic";
import { listActualEntries, type ActualEntry } from "../../shared/api/finance";
import { AutomaticEntryContext } from "./AutomaticEntryContext";
import { AutomaticEntryNotices } from "./AutomaticEntryNotices";

vi.mock("../../shared/api/automatic", async () => ({
  ...await vi.importActual<typeof import("../../shared/api/automatic")>("../../shared/api/automatic"),
  listAutomaticOccurrences: vi.fn(),
  resolveAutomaticEntryConflict: vi.fn(),
}));
vi.mock("../../shared/api/finance", async () => ({
  ...await vi.importActual<typeof import("../../shared/api/finance")>("../../shared/api/finance"),
  listActualEntries: vi.fn(),
}));

const conflict: AutomaticOccurrence = {
  id: "occurrence-1", rule_key: "rule-1", rule_name: "工资", month: "2026-11", state: "CONFLICT",
  occurred_on: "2026-11-01", actual_entry_id: null, monthly_item_id: "monthly-1", error_code: null,
};
const manual: ActualEntry = {
  id: "entry-1", monthly_item_id: "monthly-1", occurred_on: "2026-11-01", effect: "INCREASE",
  amount: "100.00", source_amount: "100.00", source_currency: "CNY", exchange_rate: "1.00000000",
  exchange_rate_source: "BASE_CURRENCY", exchange_rate_observed_on: "2026-11-01", origin: "USER",
  note: "手动工资", created_at: "2026-11-01T00:00:00Z", updated_at: "2026-11-01T00:00:00Z",
};

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const check = vi.fn().mockResolvedValue(undefined);
  render(<QueryClientProvider client={client}><AutomaticEntryContext.Provider value={{ result: null, checking: false, error: null, check }}><AutomaticEntryNotices month="2026-11" currentMonth="2026-11" /></AutomaticEntryContext.Provider></QueryClientProvider>);
  return { check };
}

beforeEach(() => {
  vi.mocked(listAutomaticOccurrences).mockReset().mockResolvedValue([conflict]);
  vi.mocked(listActualEntries).mockReset().mockResolvedValue([manual]);
  vi.mocked(resolveAutomaticEntryConflict).mockReset().mockResolvedValue({ ...conflict, state: "POSTED", actual_entry_id: manual.id });
});
afterEach(cleanup);

describe("automatic duplicate recording choices", () => {
  it("requires a selected manual record before linking, then preserves its id", async () => {
    const user = userEvent.setup();
    const { check } = setup();
    await user.click(await screen.findByRole("button", { name: "处理重复记录" }));
    expect(screen.getByRole("button", { name: "关联所选记录" })).toBeDisabled();
    await user.click(await screen.findByRole("combobox", { name: "关联已有实际记录" }));
    await user.click(screen.getByRole("option", { name: /手动工资/ }));
    await user.click(screen.getByRole("button", { name: "关联所选记录" }));
    await waitFor(() => expect(resolveAutomaticEntryConflict).toHaveBeenCalledWith({ id: conflict.id, action: "LINK_EXISTING", actualEntryId: manual.id }));
    await waitFor(() => expect(check).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it.each([
    ["跳过本次自动入账", "SKIP"],
    ["仍新增一笔实际", "CREATE_SEPARATE"],
  ])("guards repeated clicks on %s until the resolution is complete", async (label, action) => {
    let complete!: (value: AutomaticOccurrence) => void;
    vi.mocked(resolveAutomaticEntryConflict).mockReturnValue(new Promise((resolve) => { complete = resolve; }));
    setup();
    fireEvent.click(await screen.findByRole("button", { name: "处理重复记录" }));
    const button = screen.getByRole("button", { name: label });
    fireEvent.click(button);
    fireEvent.click(button);
    await waitFor(() => expect(resolveAutomaticEntryConflict).toHaveBeenCalledTimes(1));
    expect(resolveAutomaticEntryConflict).toHaveBeenCalledWith({ id: conflict.id, action, actualEntryId: undefined });
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await act(async () => { complete({ ...conflict, state: action === "SKIP" ? "SKIPPED" : "POSTED" }); });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("leaves the conflict visible when its resolution fails", async () => {
    vi.mocked(resolveAutomaticEntryConflict).mockRejectedValue(new Error("resolution unavailable"));
    const user = userEvent.setup();
    setup();
    await user.click(await screen.findByRole("button", { name: "处理重复记录" }));
    await user.click(screen.getByRole("button", { name: "跳过本次自动入账" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("resolution unavailable");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "跳过本次自动入账" })).toBeEnabled();
  });
});
