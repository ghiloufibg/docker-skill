import { App, applyDocumentTheme, applyHostStyleVariables, type McpUiHostContext } from "@modelcontextprotocol/ext-apps";
import { useSyncExternalStore } from "react";
import type { ContainerSummary } from "./types";

/**
 * The App instance and its event handlers are created/registered at module
 * scope, not inside a React effect. Per the guide's own §2 warning, the
 * host can send requests immediately after the handshake, so a handler
 * registered inside a useEffect (which only runs post-paint) risks missing
 * the first one. Module scope runs at import time, before React's first
 * render commits — same ordering guarantee the vanilla version got "for
 * free" by being top-level script code.
 */
export const app = new App({ name: "Docker Fleet Dashboard", version: "0.1.0" });
app.onerror = console.error;

type Listener = () => void;
const containerListeners = new Set<Listener>();
let latestContainers: ContainerSummary[] | null = null;

app.ontoolresult = (result) => {
  const payload = result.structuredContent as unknown as { containers: ContainerSummary[] } | undefined;
  if (payload) {
    latestContainers = payload.containers;
    for (const l of containerListeners) l();
  }
};

/** Bridges the SDK's push-style ontoolresult callback into React state via useSyncExternalStore — the correct primitive for subscribing to a mutable external source without tearing. */
export function useIncomingContainers(): ContainerSummary[] | null {
  return useSyncExternalStore(
    (onStoreChange) => {
      containerListeners.add(onStoreChange);
      return () => containerListeners.delete(onStoreChange);
    },
    () => latestContainers,
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

app.connect().then(() => {
  const ctx = app.getHostContext();
  if (ctx) handleHostContextChanged(ctx);
});
