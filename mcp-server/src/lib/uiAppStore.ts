import { App, applyDocumentTheme, applyHostStyleVariables, type McpUiHostContext } from "@modelcontextprotocol/ext-apps";
import { useSyncExternalStore } from "react";
import type { z } from "zod";

export interface UiAppStore<T> {
  app: App;
  useIncoming: () => T | null;
}

/**
 * Bootstraps an ext-apps `App` for a single-tool UI widget — the shared
 * shape behind dashboard/mcp.ts, report/mcp.ts, and system-card/mcp.ts
 * (previously three near-identical ~55-line files, differing only by
 * name/version and the result shape). Registers `onerror`, bridges the
 * SDK's push-style `ontoolresult` callback into React state via
 * `useSyncExternalStore` (the correct primitive for subscribing to a
 * mutable external source without tearing), applies the host's
 * theme/styles/safe-area on every `onhostcontextchanged`, and connects —
 * all at module scope, not inside a React effect (the host can send
 * requests immediately after the handshake, per the SDK guide's own §2
 * warning; module scope runs at import time, before React's first render
 * commits).
 *
 * `schema` validates every incoming result before it's accepted. This is
 * the one boundary in each app where structuredContent arrives
 * unsolicited — a push notification the host can fire whenever, not a
 * direct response to a call this code just made — so unlike the explicit
 * request/response call sites elsewhere in these apps (each already
 * gated behind its own `if (result.isError) throw ...` and consumed
 * immediately for one known purpose), a naked cast here would trust data
 * with no local proof it actually matches. A validation failure is
 * logged and the incoming result is dropped rather than accepted — the
 * previous render's data (or the initial `null`) stays visible instead
 * of a shape mismatch corrupting state or throwing deep in rendering.
 */
export function createUiAppStore<T>(info: { name: string; version: string }, schema: z.ZodType<T>): UiAppStore<T> {
  const app = new App(info);
  app.onerror = console.error;

  type Listener = () => void;
  const listeners = new Set<Listener>();
  let latest: T | null = null;

  app.ontoolresult = (result) => {
    const parsed = schema.safeParse(result.structuredContent);
    if (parsed.success) {
      latest = parsed.data;
      for (const l of listeners) l();
    } else {
      console.error("[uiAppStore] structuredContent failed validation:", parsed.error, result.structuredContent);
    }
  };

  function useIncoming(): T | null {
    return useSyncExternalStore(
      (onStoreChange) => {
        listeners.add(onStoreChange);
        return () => listeners.delete(onStoreChange);
      },
      () => latest,
    );
  }

  function handleHostContextChanged(ctx: McpUiHostContext): void {
    if (ctx.theme) applyDocumentTheme(ctx.theme);
    if (ctx.styles?.variables) applyHostStyleVariables(ctx.styles.variables);
    if (ctx.safeAreaInsets) {
      // Not actually unnecessary: `document.querySelector(".main")` resolves
      // to the generic `<E extends Element = Element>` overload (".main"
      // isn't a recognized tag-name literal), so tsc infers `Element |
      // null`, which has no `.style` property. Confirmed by running the
      // real `tsc -p tsconfig.json` build with this cast removed: TS2339
      // on every `.style.*` access below. A known false-positive class for
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
    // contextless unhandled promise rejection.
    .catch((err: unknown) => app.onerror?.(err instanceof Error ? err : new Error(String(err))));

  return { app, useIncoming };
}
