import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { queryKeys } from "../../shared/api/finance";
import { loanQueryKeys } from "../../shared/api/loans";
import { SpecialsPage } from "./SpecialsPage";
import { specialDetail, specialEntry, specialProject, specialRates } from "./testFixtures";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

function LocationProbe() {
  const location = useLocation();
  return <output aria-label="当前地址">{location.pathname}{location.search}</output>;
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  client.setQueryData(queryKeys.monthly("2026-10"), []);
  client.setQueryData(queryKeys.monthAnalytics("2026-10"), {});
  client.setQueryData(loanQueryKeys.month("2026-10"), {});
  client.setQueryData(loanQueryKeys.month("2026-02"), {});
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={["/specials?id=trip"]}><SpecialsPage /><LocationProbe /></MemoryRouter></QueryClientProvider>);
  return client;
}

describe("specials page", () => {
  beforeEach(() => { vi.mocked(invoke).mockReset(); });

  function mockService() {
    let deleted = false;
    const projects = [specialProject({ id: "renovation", name: "装修" }), specialProject()];
    vi.mocked(invoke).mockImplementation(async (command, args) => {
      if (command === "list_special_projects") return projects as never;
      if (command === "get_settings") return { base_currency: "CNY", auto_update_exchange_rates: false, created_at: "", updated_at: "" } as never;
      if (command === "get_startup_status") return { current_month: "2026-10", initialization: null, error: null } as never;
      if (command === "list_exchange_rates") return specialRates as never;
      if (command === "get_special_project") {
        const { id } = args as { id: string };
        const project = projects.find((candidate) => candidate.id === id);
        return specialDetail({ project, entries: id === "trip" && !deleted ? [specialEntry()] : [] }) as never;
      }
      if (command === "delete_actual_entry") { deleted = true; return undefined as never; }
      if (command === "create_special_actual_entry") return specialEntry({ month: "2026-02", effect: "DECREASE" }) as never;
      if (command === "update_actual_entry") return specialEntry({ source_amount: "40.00" }) as never;
      throw new Error(`Unexpected command: ${command}`);
    });
  }

  it("selects the deep-linked project and updates the URL when the user chooses another", async () => {
    const user = userEvent.setup();
    mockService();
    renderPage();
    expect(await screen.findByRole("heading", { level: 2, name: "旅行" })).toBeInTheDocument();
    expect(invoke).toHaveBeenCalledWith("get_special_project", { id: "trip" });
    await user.click(screen.getByRole("button", { name: /装修/ }));
    expect(await screen.findByRole("heading", { level: 2, name: "装修" })).toBeInTheDocument();
    expect(screen.getByLabelText("当前地址")).toHaveTextContent("/specials?id=renovation");
  });

  it("deletes the same monthly actual fact and invalidates both special and monthly views", async () => {
    const user = userEvent.setup();
    mockService();
    const client = renderPage();
    await user.click(await screen.findByRole("button", { name: "删除条目" }));
    const dialog = screen.getByRole("dialog", { name: "确认删除这条实际记录？" });
    await user.click(within(dialog).getByRole("button", { name: "确认删除" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(invoke).toHaveBeenCalledWith("delete_actual_entry", { id: "expense" });
    expect(vi.mocked(invoke).mock.calls.filter(([command]) => command === "delete_actual_entry")).toHaveLength(1);
    expect(client.getQueryState(queryKeys.monthly("2026-10"))?.isInvalidated).toBe(true);
    expect(client.getQueryState(queryKeys.monthAnalytics("2026-10"))?.isInvalidated).toBe(true);
    expect(client.getQueryState(loanQueryKeys.month("2026-10"))?.isInvalidated).toBe(true);
    await waitFor(() => expect(screen.queryByRole("button", { name: "编辑条目" })).not.toBeInTheDocument());
  });

  it("refreshes the historical loan balance after recording a special refund", async () => {
    mockService();
    const client = renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "添加支出或退款" }));
    fireEvent.change(screen.getByLabelText("发生月份"), { target: { value: "2026-02" } });
    fireEvent.click(screen.getByRole("combobox", { name: "专项条目类型" }));
    fireEvent.click(screen.getByRole("option", { name: "退款" }));
    fireEvent.change(screen.getByLabelText(/原币金额/), { target: { value: "50.00" } });
    fireEvent.click(screen.getByRole("button", { name: "保存条目" }));
    await waitFor(() => expect(client.getQueryState(loanQueryKeys.month("2026-02"))?.isInvalidated).toBe(true));
    expect(invoke).toHaveBeenCalledWith("create_special_actual_entry", { input: expect.objectContaining({ month: "2026-02", effect: "DECREASE", amount: "50.00" }) });
  });

  it("invalidates the loan balance after editing a special actual snapshot", async () => {
    mockService();
    const client = renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "编辑条目" }));
    fireEvent.change(screen.getByLabelText(/原币金额/), { target: { value: "40.00" } });
    fireEvent.click(screen.getByRole("button", { name: "保存条目" }));
    await waitFor(() => expect(client.getQueryState(loanQueryKeys.month("2026-10"))?.isInvalidated).toBe(true));
    expect(invoke).toHaveBeenCalledWith("update_actual_entry", { input: expect.objectContaining({ id: "expense", amount: "40.00", exchangeRate: "7.00000000" }) });
  });
});
