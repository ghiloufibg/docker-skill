import { App, applyDocumentTheme, applyHostStyleVariables, type McpUiHostContext } from "@modelcontextprotocol/ext-apps";
import { useSyncExternalStore } from "react";
import type { InvestigationReport } from "./types";

// Module scope — see docker-dashboard's mcp.ts / system-card's mcp.ts for
// why ontoolresult must be registered here, not inside a React effect.
export const app = new App({ name: "Investigation Report", version: "0.1.0" });
app.onerror = console.error;

type Listener = () => void;
const listeners = new Set<Listener>();
let latestReport: InvestigationReport | null = null;

app.ontoolresult = (result) => {
  const report = result.structuredContent as unknown as InvestigationReport | undefined;
  if (report) {
    latestReport = report;
    for (const l of listeners) l();
  }
};

export function useIncomingReport(): InvestigationReport | null {
  return useSyncExternalStore(
    (onStoreChange) => {
      listeners.add(onStoreChange);
      return () => listeners.delete(onStoreChange);
    },
    () => latestReport,
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
