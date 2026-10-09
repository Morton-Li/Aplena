import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { queryKeys } from "../../shared/api/finance";
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
    await waitFor(() => expect(screen.queryByRole("button", { name: "编辑条目" })).not.toBeInTheDocument());
  });
});
