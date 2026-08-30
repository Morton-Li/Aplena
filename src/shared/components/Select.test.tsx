import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { Select } from "./Select";

const options = [
  { value: "alpha", label: "Alpha", description: "First choice" },
  { value: "beta", label: "Beta", description: "Second choice" },
  { value: "gamma", label: "Gamma", disabled: true },
];

function Harness() {
  const [value, setValue] = useState("alpha");
  return <Select ariaLabel="Test select" value={value} onChange={setValue} options={options} />;
}

describe("Select", () => {
  it("opens in a portal and selects an option with pointer input", async () => {
    const user = userEvent.setup();
    const portalHost = document.createElement("div");
    portalHost.id = "select-portal-root";
    document.body.append(portalHost);
    render(<Harness />);
    const trigger = screen.getByRole("combobox", { name: "Test select" });

    await user.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    const listbox = screen.getByRole("listbox", { name: "Test select" });
    expect(listbox).toBeInTheDocument();
    expect(listbox.closest(".select-portal-layer")?.parentElement).toBe(portalHost);
    await user.click(screen.getByRole("option", { name: /Beta/ }));

    expect(trigger).toHaveTextContent("Beta");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(trigger).toHaveFocus();
    portalHost.remove();
  });

  it("supports arrows, Enter, typeahead and Escape while retaining focus", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const trigger = screen.getByRole("combobox", { name: "Test select" });
    trigger.focus();

    await user.keyboard("b");
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    await user.keyboard("{Enter}");
    expect(trigger).toHaveTextContent("Beta");

    await user.keyboard("{ArrowUp}");
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    await user.keyboard("{Escape}");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(trigger).toHaveFocus();
  });

  it("does not open when all options are unavailable", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Select ariaLabel="Disabled select" value="" onChange={onChange} options={[{ value: "x", label: "Unavailable", disabled: true }]} />);
    const trigger = screen.getByRole("combobox", { name: "Disabled select" });

    expect(trigger).toBeDisabled();
    await user.click(trigger);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("anchors a flipped short menu directly above the trigger", async () => {
    const user = userEvent.setup();
    const originalInnerHeight = window.innerHeight;
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 200 });
    render(<Harness />);
    const trigger = screen.getByRole("combobox", { name: "Test select" });
    vi.spyOn(trigger, "getBoundingClientRect").mockReturnValue({
      x: 10,
      y: 160,
      top: 160,
      right: 210,
      bottom: 180,
      left: 10,
      width: 200,
      height: 20,
      toJSON: () => ({}),
    });

    await user.click(trigger);
    const popover = screen.getByRole("listbox", { name: "Test select" }).parentElement;
    expect(popover).toHaveClass("select-popover-top");
    expect(popover).toHaveAttribute("data-placement", "top");
    expect(popover).toHaveStyle({ bottom: "47px" });

    Object.defineProperty(window, "innerHeight", { configurable: true, value: originalInnerHeight });
  });
});
