import { App, applyDocumentTheme, applyHostStyleVariables, type McpUiHostContext } from "@modelcontextprotocol/ext-apps";
import { useSyncExternalStore } from "react";
import type { SystemInfoResult } from "./types";

// Module scope, not inside a React effect — see docker-dashboard's mcp.ts
// for the full reasoning (guide §2: handlers must be registered before
// connect() can race a host's first message, and module-scope code runs
// before React's first render commits). ontoolresult in particular MUST be
// registered here, not in a component's useEffect — a useEffect only runs
// after React's first paint, which is exactly the race window the guide
// warns about; this bit us during this very migration, caught before ever
// running it, the same discipline as design doc §12's other lessons.
export const app = new App({ name: "Local System Card", version: "0.1.0" });
app.onerror = console.error;

type Listener = () => void;
const listeners = new Set<Listener>();
let latestResult: SystemInfoResult | null = null;

app.ontoolresult = (result) => {
  const payload = result.structuredContent as unknown as SystemInfoResult | undefined;
  if (payload) {
    latestResult = payload;
    for (const l of listeners) l();
  }
};

export function useSystemInfoResult(): SystemInfoResult | null {
  return useSyncExternalStore(
    (onStoreChange) => {
      listeners.add(onStoreChange);
      return () => listeners.delete(onStoreChange);
    },
    () => latestResult,
  );
}

function handleHostContextChanged(ctx: McpUiHostContext): void {
  if (ctx.theme) applyDocumentTheme(ctx.theme);
  if (ctx.styles?.variables) applyHostStyleVariables(ctx.styles.variables);
  if (ctx.safeAreaInsets) {
    const mainEl = document.querySelector(".main") as HTMLElement | null;
    if (mainEl) {
      mainEl.style.paddingTop = `${ctx.safeAreaInsets.top}px`;
      mainEl.style.paddingRight = `${ctx.safeAreaInsets.right}px`;
      mainEl.style.paddingBottom = `${ctx.safeAreaInsets.bottom}px`;
      mainEl.style.paddingLeft = `${ctx.safeAreaInsets.left}px`;
    }
  }
}
app.onhostcontextchanged = handleHostContextChanged;

app
  .connect()
  .then(() => {
    const ctx = app.getHostContext();
    if (ctx) handleHostContextChanged(ctx);
  })
  // See docker-dashboard's mcp.ts for why this .catch is here: onerror
  // covers errors after a successful handshake, not a rejection of
  // connect() itself.
  .catch((err: unknown) => app.onerror?.(err instanceof Error ? err : new Error(String(err))));
