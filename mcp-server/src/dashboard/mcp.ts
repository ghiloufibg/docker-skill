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
  const payload = result.structuredContent as { containers: ContainerSummary[] } | undefined;
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
    // Not actually unnecessary: `document.querySelector(".main")` resolves
    // to the generic `<E extends Element = Element>` overload (".main" isn't
    // a recognized tag-name literal), so tsc infers `Element | null`, which
    // has no `.style` property. Confirmed by running the real `tsc -p
    // tsconfig.json` build with this cast removed: TS2339 on every
    // `.style.*` access below. A known false-positive class for
    // typescript-eslint's type-aware check on this exact querySelector
    // pattern, not a real redundant assertion.
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
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
  // The SDK's own documented pattern (App_connect_withPostMessageTransport
  // in app.examples.ts) wraps connect() in try/catch — onerror covers
  // errors after a successful handshake, not a rejection of connect()
  // itself, so without this a handshake failure becomes a silent,
  // contextless unhandled promise rejection instead of the same
  // console.error("[app]", err) path everything else in this file uses.
  .catch((err: unknown) => app.onerror?.(err instanceof Error ? err : new Error(String(err))));
