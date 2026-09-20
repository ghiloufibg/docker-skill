import { Client } from "@modelcontextprotocol/client";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { AppBridge, PostMessageTransport, buildAllowAttribute } from "@modelcontextprotocol/ext-apps/app-bridge";
import type { CallToolResult } from "@modelcontextprotocol/client";

interface BridgeSession {
  resourceUri: string;
  permissions: Record<string, unknown>;
  toolName: string;
  toolArgs: Record<string, unknown>;
  toolResult: CallToolResult;
  mcpUrl: string;
  token: string;
}

const statusEl = document.getElementById("status")!;
const statusText = document.getElementById("status-text")!;
const frameWrap = document.getElementById("frame-wrap")!;

function setStatus(text: string, kind: "connecting" | "ready" | "error" = "connecting") {
  statusText.textContent = text;
  statusEl.className = kind === "ready" ? "ready" : kind === "error" ? "error" : "";
}

function showError(message: string) {
  setStatus("Failed", "error");
  frameWrap.innerHTML = `<div id="error">${message.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</div>`;
}

async function main() {
  const raw = document.getElementById("bridge-session")!.textContent ?? "{}";
  // Explicit assertion, not an inferred/annotated assignment: this is our
  // own bridge process's own generated bootstrap payload (see ui-server.ts
  // -- same trust boundary already crossed the same way throughout
  // passthrough.ts), not third-party input worth a runtime schema check.
  const session = JSON.parse(raw) as BridgeSession;

  const client = new Client({ name: "mcp-apps-browser-bridge-view", version: "0.1.0" });
  const mcpUrl = new URL(session.mcpUrl, window.location.origin);
  const transport = new StreamableHTTPClientTransport(mcpUrl, {
    // `keepalive` lets the DELETE below actually reach the server during
    // page unload — a normal fetch gets cancelled the instant the page
    // starts navigating away, `keepalive: true` is the standard platform
    // mechanism for "let this specific request survive that." No body on
    // a DELETE, so none of this touches keepalive's ~64KB request cap.
    requestInit: { headers: { Authorization: `Bearer ${session.token}` }, keepalive: true },
  });

  // Resource-efficiency note: without this, closing the tab leaves the
  // bridge holding this session's dedicated backend process open until the
  // idle-timeout sweep reclaims it (--session-ttl, 30 min default) — fine
  // as a backstop, wasteful as the common case for someone opening many
  // links over a session. `terminateSession()` sends the MCP-spec DELETE
  // ("Clients that no longer need a particular session... SHOULD send an
  // HTTP DELETE") the moment the tab actually closes, so the server's own
  // `onsessionclosed` cleanup (ui-server.ts) fires immediately instead.
  // Best-effort by nature (unload handlers can still lose the race, e.g. a
  // hard crash) — the idle sweep stays the authoritative backstop, this
  // just makes the common case fast instead of a 30-minute wait.
  window.addEventListener("pagehide", () => {
    void transport.terminateSession().catch(() => undefined);
  });

  await client.connect(transport);
  setStatus(`Connected. Loading ${session.toolName}’s UI…`);

  const resource = await client.readResource({ uri: session.resourceUri });
  const content = resource.contents[0];
  const html = content && "text" in content ? content.text : undefined;
  if (!html) throw new Error(`Resource ${session.resourceUri} did not return HTML text content`);

  const iframe = document.createElement("iframe");
  // No `allow-same-origin`: the view gets an opaque, unique origin — it
  // cannot read cookies/storage from this wrapper page or the bridge's own
  // origin, matching the MCP Apps sandboxing model even though this is a
  // single-iframe simplification of the spec's documented double-iframe
  // sandbox-proxy pattern (see README "Known gaps").
  iframe.setAttribute("sandbox", "allow-scripts allow-forms");
  const allow = buildAllowAttribute(session.permissions);
  if (allow) iframe.setAttribute("allow", allow);
  frameWrap.appendChild(iframe);

  const bridge = new AppBridge(
    client,
    { name: "mcp-apps-browser-bridge", version: "0.1.0" },
    { openLinks: {}, serverTools: {}, logging: {} },
  );

  bridge.oninitialized = () => {
    setStatus("Ready", "ready");
    // oninitialized itself must stay synchronous (the SDK's own type is
    // `() => void`, not `() => Promise<void>`) so these two can't be
    // awaited here -- but a rejection from either must not just vanish as
    // an unhandled promise rejection, so both get an explicit .catch.
    bridge.sendToolInput({ arguments: session.toolArgs }).catch((err: unknown) => {
      console.error("[mcp-apps-browser-bridge] sendToolInput failed:", err);
    });
    bridge.sendToolResult(session.toolResult).catch((err: unknown) => {
      console.error("[mcp-apps-browser-bridge] sendToolResult failed:", err);
    });
  };

  bridge.onsizechange = ({ width, height }) => {
    if (width != null) iframe.style.width = `${width}px`;
    if (height != null) iframe.style.height = `${height}px`;
  };

  // window.open is synchronous, but AppBridge's own type requires this
  // callback to return Promise<McpUiOpenLinkResult>, so `async` stays even
  // with nothing to actually await.
  // eslint-disable-next-line @typescript-eslint/require-await
  bridge.onopenlink = async ({ url }) => {
    window.open(url, "_blank", "noopener,noreferrer");
    return {};
  };

  bridge.onmessage = async (params) => {
    // v1 limitation: this bridge is a separate process from the live CLI
    // conversation and cannot inject a real turn into it. It forwards the
    // request to the bridge process, which logs it loudly to the terminal
    // instead of silently dropping it. See README "Known gaps".
    try {
      await fetch("/message", {
        method: "POST",
        headers: { "content-type": "application/json", Authorization: `Bearer ${session.token}` },
        body: JSON.stringify(params),
      });
      return {};
    } catch {
      return { isError: true };
    }
  };

  const postMessageTransport = new PostMessageTransport(iframe.contentWindow!, iframe.contentWindow!);
  await bridge.connect(postMessageTransport);

  // Set content only after the bridge is already listening, so the view's
  // own `ui/initialize` handshake (fired as soon as its script runs) is
  // never missed.
  iframe.srcdoc = html;
}

main().catch((err) => {
  console.error(err);
  showError(`${err instanceof Error ? err.message : String(err)}`);
});
