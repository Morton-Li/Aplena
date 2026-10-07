import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { checkAutomaticEntries, type AutomaticEntryCheck } from "../../shared/api/automatic";
import { getStartupStatus, queryKeys, type StartupStatus } from "../../shared/api/finance";
import { useAutomaticEntries } from "./AutomaticEntryContext";
import { AutomaticEntryProvider } from "./AutomaticEntryProvider";

vi.mock("../../shared/api/automatic", () => ({ checkAutomaticEntries: vi.fn() }));
vi.mock("../../shared/api/finance", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../shared/api/finance")>(),
  getStartupStatus: vi.fn(),
}));

const result: AutomaticEntryCheck = {
  current_month: "2026-11",
  created_count: 1,
  conflict_count: 0,
  failed_count: 0,
  occurrences: [],
};

function Status() {
  const automatic = useAutomaticEntries();
  return <><span>{automatic.checking ? "checking" : "idle"}</span><span>{automatic.result?.current_month}</span><button type="button" onClick={() => void automatic.check()}>check</button>{automatic.error != null && <span>check failed</span>}</>;
}

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  client.setQueryData<StartupStatus>(queryKeys.startup, { current_month: "2026-10", initialization: null, error: null });
  const invalidate = vi.spyOn(client, "invalidateQueries").mockResolvedValue(undefined);
  const view = render(<QueryClientProvider client={client}><AutomaticEntryProvider><Status /></AutomaticEntryProvider></QueryClientProvider>);
  return { client, invalidate, ...view };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(checkAutomaticEntries).mockReset();
  vi.mocked(getStartupStatus).mockReset().mockResolvedValue({ current_month: "2026-11", initialization: null, error: null });
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  Reflect.deleteProperty(document, "visibilityState");
});

describe("automatic entry foreground checks", () => {
  it("refreshes restored monthly budgets and startup errors when the occurrence list stays unchanged", async () => {
    const unchanged = { ...result, current_month: "2026-10", created_count: 0 };
    const initial: StartupStatus = { current_month: "2026-10", initialization: null, error: { error_code: "MISSING_EXCHANGE_RATE", message_key: "error.missing_exchange_rate" } };
    const restored: StartupStatus = { current_month: "2026-10", initialization: { month: "2026-10", created_count: 1, skipped_existing_count: 0, excluded_count: 0, warnings: [] }, error: null };
    vi.mocked(checkAutomaticEntries).mockResolvedValue(unchanged);
    vi.mocked(getStartupStatus).mockResolvedValueOnce(initial).mockResolvedValue(restored);
    const { client, invalidate } = setup();
    await act(async () => undefined);
    expect(client.getQueryData<StartupStatus>(queryKeys.startup)?.error?.error_code).toBe("MISSING_EXCHANGE_RATE");
    invalidate.mockClear();
    await act(async () => { window.dispatchEvent(new Event("focus")); });
    expect(client.getQueryData<StartupStatus>(queryKeys.startup)).toEqual(restored);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["monthly-items"] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["month-analytics"] });
  });

  it("guards overlapping timer, focus and manual checks and refreshes the current month", async () => {
    let complete!: (value: AutomaticEntryCheck) => void;
    vi.mocked(checkAutomaticEntries).mockReturnValueOnce(new Promise((resolve) => { complete = resolve; })).mockResolvedValue({ ...result, created_count: 0 });
    const { client, invalidate, unmount } = setup();
    await act(async () => undefined);
    expect(checkAutomaticEntries).toHaveBeenCalledTimes(1);
    act(() => {
      window.dispatchEvent(new Event("focus"));
      document.dispatchEvent(new Event("visibilitychange"));
      fireEvent.click(screen.getByRole("button", { name: "check" }));
      vi.advanceTimersByTime(60_000);
    });
    expect(checkAutomaticEntries).toHaveBeenCalledTimes(1);
    await act(async () => complete(result));
    expect(client.getQueryData<StartupStatus>(queryKeys.startup)?.current_month).toBe("2026-11");
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["monthly-items"] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["special-project"] });
    expect(screen.getByText("idle")).toBeInTheDocument();
    await act(async () => { vi.advanceTimersByTime(60_000); });
    expect(checkAutomaticEntries).toHaveBeenCalledTimes(2);
    unmount();
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      vi.advanceTimersByTime(60_000);
    });
    expect(checkAutomaticEntries).toHaveBeenCalledTimes(2);
  });

  it("pauses hidden windows and recovers from a failed check when visible again", async () => {
    vi.mocked(checkAutomaticEntries).mockRejectedValueOnce(new Error("unavailable")).mockResolvedValue(result);
    setup();
    await act(async () => undefined);
    expect(screen.getByText("check failed")).toBeInTheDocument();
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      vi.advanceTimersByTime(60_000);
    });
    expect(checkAutomaticEntries).toHaveBeenCalledTimes(1);
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
    expect(checkAutomaticEntries).toHaveBeenCalledTimes(2);
    expect(screen.queryByText("check failed")).not.toBeInTheDocument();
  });
});
