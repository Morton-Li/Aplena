import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";

import { Dialog } from "./Dialog";
import { Select } from "./Select";

function Harness() {
  const [open, setOpen] = useState(false);
  return <>
    <button type="button" onClick={() => setOpen(true)}>Open dialog</button>
    {open && <Dialog title="Accessible dialog" onClose={() => setOpen(false)} footer={<button type="button">Save</button>}>
      <input aria-label="Dialog input" />
    </Dialog>}
  </>;
}

function SelectHarness() {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("first");
  return <>
    <button type="button" onClick={() => setOpen(true)}>Open select dialog</button>
    {open && <Dialog title="Select dialog" onClose={() => setOpen(false)}>
      <Select
        ariaLabel="Dialog choice"
        value={value}
        onChange={setValue}
        options={[
          { value: "first", label: "First" },
          { value: "second", label: "Second" },
        ]}
      />
    </Dialog>}
  </>;
}

function AutoFocusHarness() {
  const [open, setOpen] = useState(false);
  return <>
    <button type="button" onClick={() => setOpen(true)}>Open autofocus dialog</button>
    {open && <Dialog title="Autofocus dialog" onClose={() => setOpen(false)}>
      <input autoFocus aria-label="Autofocus input" />
    </Dialog>}
  </>;
}

function PreferredFocusHarness() {
  const [open, setOpen] = useState(false);
  return <>
    <button type="button" onClick={() => setOpen(true)}>Open preferred focus dialog</button>
    {open && <Dialog title="Preferred focus dialog" onClose={() => setOpen(false)}>
      <input data-dialog-initial-focus aria-label="Preferred input" />
    </Dialog>}
  </>;
}

describe("Dialog", () => {
  it("moves focus inside, closes with Escape and restores the opener", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const opener = screen.getByRole("button", { name: "Open dialog" });

    await user.click(opener);
    expect(await screen.findByRole("dialog", { name: "Accessible dialog" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "关闭" })).toHaveFocus();
    await user.keyboard("{Escape}");

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  it("cycles focus inside the dialog", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "Open dialog" }));
    const close = await screen.findByRole("button", { name: "关闭" });
    const save = screen.getByRole("button", { name: "Save" });

    save.focus();
    await user.tab();
    expect(close).toHaveFocus();
    await user.tab({ shift: true });
    expect(save).toHaveFocus();
  });

  it("lets Escape close a nested Select before closing the dialog", async () => {
    const user = userEvent.setup();
    render(<SelectHarness />);
    await user.click(screen.getByRole("button", { name: "Open select dialog" }));
    const trigger = screen.getByRole("combobox", { name: "Dialog choice" });

    await user.click(trigger);
    expect(screen.getByRole("listbox", { name: "Dialog choice" })).toBeInTheDocument();
    await user.keyboard("{Escape}");

    expect(screen.queryByRole("listbox", { name: "Dialog choice" })).not.toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Select dialog" })).toBeInTheDocument();
    expect(trigger).toHaveFocus();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Select dialog" })).not.toBeInTheDocument();
  });

  it("restores the opener when a child takes autofocus during mount", async () => {
    const user = userEvent.setup();
    render(<AutoFocusHarness />);
    const opener = screen.getByRole("button", { name: "Open autofocus dialog" });

    await user.click(opener);
    expect(screen.getByRole("textbox", { name: "Autofocus input" })).toHaveFocus();
    await user.keyboard("{Escape}");

    expect(opener).toHaveFocus();
  });

  it("prioritizes an explicitly marked initial field over the earlier close button", async () => {
    const user = userEvent.setup();
    render(<PreferredFocusHarness />);

    await user.click(screen.getByRole("button", { name: "Open preferred focus dialog" }));

    expect(screen.getByRole("textbox", { name: "Preferred input" })).toHaveFocus();
  });
});
