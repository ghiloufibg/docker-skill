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
  const session: BridgeSession = JSON.parse(raw);

  const client = new Client({ name: "mcp-apps-browser-bridge-view", version: "0.1.0" });
  const mcpUrl = new URL(session.mcpUrl, window.location.origin);
  const transport = new StreamableHTTPClientTransport(mcpUrl, {
    requestInit: { headers: { Authorization: `Bearer ${session.token}` } },
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
  const allow = buildAllowAttribute(session.permissions as never);
  if (allow) iframe.setAttribute("allow", allow);
  frameWrap.appendChild(iframe);

  const bridge = new AppBridge(
    client,
    { name: "mcp-apps-browser-bridge", version: "0.1.0" },
    { openLinks: {}, serverTools: {}, logging: {} },
  );

  bridge.oninitialized = () => {
    setStatus("Ready", "ready");
    bridge.sendToolInput({ arguments: session.toolArgs });
    bridge.sendToolResult(session.toolResult);
  };

  bridge.onsizechange = ({ width, height }) => {
    if (height != null) frameWrap.style.height = "";
    if (width != null) iframe.style.width = `${width}px`;
    if (height != null) iframe.style.height = `${height}px`;
  };

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
    } catch (err) {
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
