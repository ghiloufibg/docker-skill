import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { useConfirm } from "./ConfirmDialog";

/**
 * Exercises the one thing standing between a click and a destructive
 * docker-stop/kill/rm call: the Tier 2 type-to-confirm gate. See
 * ConfirmDialog.tsx's own doc comment and alert-dialog.tsx's
 * onOpenAutoFocus override — both call out the initial-focus-on-Cancel
 * behavior as security-relevant, not styling, which is why it's asserted
 * here rather than left to a manual pass.
 */
function Harness({ onResult, tier }: { onResult: (v: boolean) => void; tier: 1 | 2 }) {
  const { confirm, dialog } = useConfirm();
  return (
    <div>
      <button
        onClick={() =>
          void confirm(tier === 2 ? { title: 'Remove "db"?', tier: 2 } : { title: 'Restart "web"?', tier: 1 }, "db").then(
            onResult,
          )
        }
      >
        open
      </button>
      {dialog}
    </div>
  );
}

describe("useConfirm", () => {
  it("tier 1: Confirm is enabled immediately and resolves true", async () => {
    const user = userEvent.setup();
    const results: boolean[] = [];
    render(<Harness tier={1} onResult={(v) => results.push(v)} />);

    await user.click(screen.getByRole("button", { name: "open" }));
    const confirmBtn = await screen.findByRole("button", { name: "Confirm" });
    expect(confirmBtn).not.toBeDisabled();

    await user.click(confirmBtn);
    expect(results).toEqual([true]);
  });

  it("tier 2: Confirm stays disabled until the exact target is retyped", async () => {
    const user = userEvent.setup();
    const results: boolean[] = [];
    render(<Harness tier={2} onResult={(v) => results.push(v)} />);

    await user.click(screen.getByRole("button", { name: "open" }));
    const confirmBtn = await screen.findByRole("button", { name: "Confirm" });
    expect(confirmBtn).toBeDisabled();

    const input = screen.getByLabelText(/type the container name to confirm/i);
    await user.type(input, "d");
    expect(confirmBtn).toBeDisabled();

    await user.type(input, "b");
    expect(confirmBtn).not.toBeDisabled();

    await user.click(confirmBtn);
    expect(results).toEqual([true]);
  });

  it("tier 2: a near-miss retype (wrong case, trailing space) keeps Confirm disabled", async () => {
    const user = userEvent.setup();
    render(<Harness tier={2} onResult={() => {}} />);

    await user.click(screen.getByRole("button", { name: "open" }));
    const confirmBtn = await screen.findByRole("button", { name: "Confirm" });
    const input = screen.getByLabelText(/type the container name to confirm/i);

    await user.type(input, "DB");
    expect(confirmBtn).toBeDisabled();

    await user.clear(input);
    await user.type(input, "db ");
    expect(confirmBtn).toBeDisabled();
  });

  it("tier 2: Cancel resolves false even after the target was correctly retyped", async () => {
    const user = userEvent.setup();
    const results: boolean[] = [];
    render(<Harness tier={2} onResult={(v) => results.push(v)} />);

    await user.click(screen.getByRole("button", { name: "open" }));
    const input = screen.getByLabelText(/type the container name to confirm/i);
    await user.type(input, "db");

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(results).toEqual([false]);
  });

  it("tier 2: initial focus lands on Cancel, never on the destructive Confirm button", async () => {
    const user = userEvent.setup();
    render(<Harness tier={2} onResult={() => {}} />);

    await user.click(screen.getByRole("button", { name: "open" }));
    const cancelBtn = await screen.findByRole("button", { name: "Cancel" });

    await waitFor(() => expect(cancelBtn).toHaveFocus());
  });
});
