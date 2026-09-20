import * as React from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";

interface ConfirmOpts {
  title: string;
  tier: 1 | 2;
  typeNoun?: string;
}

interface ConfirmRequest extends ConfirmOpts {
  retypeTarget: string;
  resolve: (result: boolean) => void;
}

/**
 * React port of the vanilla showConfirm()/dialogFocusables() pair (design
 * doc §12, guide §16). The imperative Promise<boolean> API is kept
 * identical on purpose — every call site (single action, bulk action,
 * project-down, remediation button) awaits confirm() exactly like it
 * awaited showConfirm() before. What changed is everything *inside* the
 * dialog: initial focus, the Tab/Shift+Tab trap, and Escape-to-cancel are
 * now Radix AlertDialog's job, not ~50 lines of hand-rolled DOM code —
 * see alert-dialog.tsx's onOpenAutoFocus override for the one place this
 * still needs a deliberate override (default focus to Cancel, not the
 * dialog itself).
 */
export function useConfirm(): {
  confirm: (opts: ConfirmOpts, retypeTarget: string) => Promise<boolean>;
  dialog: React.ReactNode;
} {
  const [request, setRequest] = React.useState<ConfirmRequest | null>(null);
  const [typedValue, setTypedValue] = React.useState("");
  const cancelRef = React.useRef<HTMLButtonElement>(null);

  const confirm = React.useCallback((opts: ConfirmOpts, retypeTarget: string): Promise<boolean> => {
    return new Promise((resolve) => {
      setTypedValue("");
      setRequest({ ...opts, retypeTarget, resolve });
    });
  }, []);

  const settle = React.useCallback(
    (result: boolean) => {
      request?.resolve(result);
      setRequest(null);
    },
    [request],
  );

  const noun = request?.typeNoun ?? "container name";
  const isTier2 = request?.tier === 2;
  const typedMatches = !isTier2 || typedValue === request?.retypeTarget;

  const dialog = (
    <AlertDialog open={request !== null} onOpenChange={(open) => !open && settle(false)}>
      {request && (
        <AlertDialogContent initialFocusRef={cancelRef}>
          <AlertDialogTitle>{request.title}</AlertDialogTitle>
          <AlertDialogDescription>
            {isTier2
              ? `Tier 2 action — off by default, per design doc §4. Type the ${noun} to confirm.`
              : "Tier 1 action — reversible, per design doc §4."}
          </AlertDialogDescription>
          {isTier2 && (
            <div className="mb-3">
              <label htmlFor="confirm-type-input" className="mb-1 block text-xs text-muted">
                Type the {noun} to confirm:
              </label>
              <Input
                id="confirm-type-input"
                autoComplete="off"
                value={typedValue}
                onChange={(e) => setTypedValue(e.target.value)}
                className="font-mono"
              />
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel ref={cancelRef} onClick={() => settle(false)}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction disabled={!typedMatches} onClick={() => settle(true)}>
              Confirm
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      )}
    </AlertDialog>
  );

  return { confirm, dialog };
}
