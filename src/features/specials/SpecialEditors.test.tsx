import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SpecialActualEntry } from "../../shared/api/specials";
import { SpecialActualEditor, SpecialAllocationEditor } from "./SpecialEditors";
import { specialEntry, specialProject, specialRates } from "./testFixtures";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

function wrap(children: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}><MemoryRouter>{children}</MemoryRouter></QueryClientProvider>);
}

describe("special actual editor", () => {
  beforeEach(() => { vi.mocked(invoke).mockReset(); });

  it("edits the existing monthly fact and keeps its original FX snapshot and identity", async () => {
    const user = userEvent.setup();
    const saved = vi.fn().mockResolvedValue(undefined);
    vi.mocked(invoke).mockResolvedValue(specialEntry());
    wrap(<SpecialActualEditor project={specialProject()} currentMonth="2026-10" rates={specialRates} existing={specialEntry()} detailGroups={["住宿"]} onClose={vi.fn()} onSaved={saved} />);
    expect(screen.getByRole("combobox", { name: "专项条目币种" })).toBeDisabled();
    expect(screen.getByRole("combobox", { name: "实际条目支出分类" })).toBeDisabled();
    expect(screen.getByLabelText("发生月份")).toBeDisabled();
    const amount = screen.getByLabelText(/原币金额/);
    await user.clear(amount);
    await user.type(amount, "75.00");
    const group = screen.getByLabelText(/明细组（可选）/);
    await user.clear(group);
    await user.type(group, "交通");
    await user.click(screen.getByRole("button", { name: "保存条目" }));
    await waitFor(() => expect(saved).toHaveBeenCalledOnce());
    expect(invoke).toHaveBeenCalledExactlyOnceWith("update_actual_entry", { input: expect.objectContaining({
      id: "expense", monthlyItemId: "monthly-trip", amount: "75.00", currency: "USD", exchangeRate: "7.00000000", exchangeRateSource: "ECB_REFERENCE", exchangeRateObservedOn: "2026-10-01", detailGroup: "交通",
    }) });
  });

  it("saves a refund through the canonical special endpoint once under repeated submission", async () => {
    const user = userEvent.setup();
    const saved = vi.fn().mockResolvedValue(undefined);
    let release!: (entry: SpecialActualEntry) => void;
    const pending = new Promise<SpecialActualEntry>((resolve) => { release = resolve; });
    vi.mocked(invoke).mockReturnValue(pending);
    wrap(<SpecialActualEditor project={specialProject({ archived: true })} currentMonth="2026-10" rates={specialRates} detailGroups={[]} onClose={vi.fn()} onSaved={saved} />);
    await user.type(screen.getByLabelText(/原币金额/), "25.00");
    await user.click(screen.getByRole("combobox", { name: "专项条目类型" }));
    await user.click(screen.getByRole("option", { name: "退款" }));
    await user.dblClick(screen.getByRole("button", { name: "保存条目" }));
    expect(invoke).toHaveBeenCalledExactlyOnceWith("create_special_actual_entry", { input: expect.objectContaining({
      projectId: "trip", month: "2026-10", effect: "DECREASE", amount: "25.00", currency: "CNY", exchangeRate: "1.00000000", exchangeRateSource: "BASE_CURRENCY",
    }) });
    await act(async () => { release(specialEntry()); await pending; });
    await waitFor(() => expect(saved).toHaveBeenCalledOnce());
  });

  it("keeps the entered draft reviewable when the backend rejects saving", async () => {
    const user = userEvent.setup();
    const saved = vi.fn().mockResolvedValue(undefined);
    vi.mocked(invoke).mockRejectedValue(new Error("保存失败，请重试"));
    wrap(<SpecialActualEditor project={specialProject()} currentMonth="2026-10" rates={specialRates} detailGroups={[]} onClose={vi.fn()} onSaved={saved} />);
    await user.type(screen.getByLabelText(/原币金额/), "15+20");
    await user.click(screen.getByRole("button", { name: "保存条目" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("保存失败，请重试");
    expect(screen.getByLabelText(/原币金额/)).toHaveValue("15+20");
    expect(saved).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "保存条目" })).toBeEnabled();
  });
});

describe("special allocation editor", () => {
  beforeEach(() => { vi.mocked(invoke).mockReset(); });

  it("makes current-month freezing explicit before it saves the nominal allocation", async () => {
    const user = userEvent.setup();
    const saved = vi.fn().mockResolvedValue(undefined);
    vi.mocked(invoke).mockResolvedValue({ id: "allocation", frozen: true });
    wrap(<SpecialAllocationEditor project={specialProject()} currentMonth="2026-10" onClose={vi.fn()} onSaved={saved} />);
    fireEvent.change(screen.getByLabelText("分配月份"), { target: { value: "2026-10" } });
    await user.type(screen.getByLabelText(/月分配金额/), "200.00");
    expect(screen.getByRole("status")).toHaveTextContent("保存后立即形成本月快照");
    await user.click(screen.getByRole("button", { name: "保存并形成本月快照" }));
    await waitFor(() => expect(saved).toHaveBeenCalledOnce());
    expect(invoke).toHaveBeenCalledExactlyOnceWith("save_special_allocation", { input: expect.objectContaining({ projectId: "trip", month: "2026-10", amount: "200.00" }) });
  });
});
