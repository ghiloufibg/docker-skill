/**
 * Headless verification over the real MCP stdio protocol — no browser
 * needed for this part (the browser-rendering half was verified manually
 * with Playwright; see claudedocs/qa-report-claude-code-cli-e2e.md and the
 * README for how to repeat that). This covers what a bad refactor is most
 * likely to break: passthrough correctness, the UI-link injection, and the
 * local HTTP server's auth gates.
 *
 * Target: this repo's own mcp-server (build it first: `cd ../mcp-server &&
 * npm run build`). Uses `build-investigation-report` as the UI-enabled tool
 * under test specifically because it needs neither Docker nor `df` — see
 * claudedocs/qa-report-claude-code-cli-e2e.md for why `system-info` isn't a
 * safe pick for this.
 */
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

// This file compiles to dist/test/smoke.js (see tsconfig.test.json), so
// __dirname at runtime is browser-bridge/dist/test — one level up is
// browser-bridge/dist (where cli.js lives), three levels up is the repo
// root (where mcp-server/ is a sibling of browser-bridge/).
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BRIDGE_ENTRY = path.join(__dirname, "..", "cli.js");
const TARGET_SERVER = path.join(__dirname, "..", "..", "..", "mcp-server", "dist", "index.js");

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FAIL: ${message}`);
}

async function main(): Promise<void> {
  // --- config.ts: --help / --version exit 0 without needing a target ---
  for (const flag of ["--help", "--version"]) {
    const exitCode = await new Promise<number | null>((resolve) => {
      const child = spawn(process.execPath, [BRIDGE_ENTRY, flag]);
      child.on("exit", resolve);
    });
    assert(exitCode === 0, `"${flag}" must exit 0, got ${exitCode}`);
  }
  console.log("config: --help / --version ok");

  // --- config.ts: missing "--" is a clear usage error, not a hang/crash ---
  {
    const exitCode = await new Promise<number | null>((resolve) => {
      const child = spawn(process.execPath, [BRIDGE_ENTRY, "node", "whatever.js"]);
      child.on("exit", resolve);
    });
    assert(exitCode === 1, `missing "--" must exit 1, got ${exitCode}`);
  }
  console.log("config: missing -- rejected ok");

  // --- spawn-backend.ts: a target that can't even be spawned fails clearly ---
  {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [BRIDGE_ENTRY, "--", "this-command-does-not-exist-anywhere"],
    });
    const client = new Client({ name: "smoke", version: "0.1.0" });
    let threw = false;
    try {
      await client.connect(transport);
    } catch {
      threw = true;
    }
    assert(threw, "connecting through a bridge wrapping a nonexistent command must fail, not hang");
  }
  console.log("spawn-backend: bad target command rejected ok");

  // --- the real end-to-end path ---
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [BRIDGE_ENTRY, "--no-open", "--", "node", TARGET_SERVER],
  });
  const client = new Client({ name: "smoke", version: "0.1.0" });
  await client.connect(transport);
  console.log("connected through bridge");

  const { tools } = await client.listTools();
  assert(tools.length === 16, `expected 16 passthrough tools, got ${tools.length}`);
  assert(
    tools.some((t) => t.name === "build-investigation-report"),
    "build-investigation-report must be in the passthrough tool list",
  );
  console.log(`passthrough: ${tools.length} tools listed ok`);

  const result = await client.callTool({
    name: "build-investigation-report",
    arguments: {
      subject: "smoke-test",
      summary: "smoke test summary",
      rootCause: "smoke test root cause",
      timeline: [{ timestamp: new Date().toISOString(), event: "smoke test event" }],
      evidence: [{ source: "smoke-test", excerpt: "n/a" }],
      suggestedRemediations: [{ description: "n/a" }],
    },
  });
  assert(!result.isError, "build-investigation-report call must not error");

  const linkBlock = result.content.find((c) => c.type === "text" && c.text.includes("http://127.0.0.1"));
  assert(linkBlock?.type === "text", "UI-enabled tool result must have a link block appended");
  const match = linkBlock.text.match(/http:\/\/127\.0\.0\.1:\d+\/app\/[a-f0-9-]+\?token=[\w-]+/);
  assert(match, "link block must contain a well-formed session URL");
  const sessionUrl = match[0];
  console.log(`UI link injection ok: ${sessionUrl}`);

  // The session page itself renders (200, real HTML, the bootstrap payload
  // actually substituted in — not the raw placeholder).
  const pageRes = await fetch(sessionUrl);
  assert(pageRes.status === 200, `session page must return 200, got ${pageRes.status}`);
  const pageBody = await pageRes.text();
  assert(pageBody.includes("resourceUri"), "session page must contain the bootstrap payload");
  assert(!pageBody.includes("__BRIDGE_SESSION__"), "placeholder must have been substituted, not left literal");
  console.log("session page renders ok");

  // Regression test: /mcp must support multiple independent browser
  // sessions concurrently. Previously it didn't — a single shared
  // transport/server meant a second browser tab's `initialize` failed with
  // "Invalid Request: Server already initialized" (see ui-server.ts's
  // handleMcpRequest doc comment for the fix). Two real
  // StreamableHTTPClientTransport connections, exactly as two browser tabs
  // would each open one, is what actually exercises this — a single
  // shared connection would never have caught it.
  {
    const token = new URL(sessionUrl).searchParams.get("token")!;
    const mcpUrl = new URL("/mcp", sessionUrl);
    const authInit = { requestInit: { headers: { Authorization: `Bearer ${token}` } } };
    const sessionA = new Client({ name: "smoke-session-a", version: "0.1.0" });
    const sessionB = new Client({ name: "smoke-session-b", version: "0.1.0" });
    await sessionA.connect(new StreamableHTTPClientTransport(mcpUrl, authInit));
    await sessionB.connect(new StreamableHTTPClientTransport(mcpUrl, authInit));
    const [toolsA, toolsB] = await Promise.all([sessionA.listTools(), sessionB.listTools()]);
    assert(toolsA.tools.length === 16, `session A must see all 16 tools, got ${toolsA.tools.length}`);
    assert(toolsB.tools.length === 16, `session B must see all 16 tools, got ${toolsB.tools.length}`);
    await Promise.all([sessionA.close(), sessionB.close()]);
  }
  console.log("multi-session /mcp: two independent browser sessions both initialized ok");

  // Regression test: a request to /mcp with no (or an unrecognized)
  // Mcp-Session-Id header that ISN'T a valid `initialize` (a stale session
  // id after a dropped connection, a buggy retry) takes handleMcpRequest's
  // "spawn a fresh backend" branch, but never becomes a registered session
  // — before the fix, the backend spawned for it (and its child process)
  // was never closed, leaking for the life of the bridge process. This
  // asserts the request itself still resolves cleanly (a clean error, not
  // a hang) after the fix; the leak itself was confirmed and fixed by
  // directly measuring backend child-process count before/after during
  // development (OS-process inspection isn't portable enough for this
  // automated, cross-platform suite).
  {
    const mcpUrl = new URL("/mcp", sessionUrl).toString();
    const token = new URL(sessionUrl).searchParams.get("token")!;
    const res = await fetch(mcpUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ jsonrpc: "2.0", method: "tools/list", params: {}, id: 1 }),
    });
    assert(res.status === 400, `non-initialize request with no session must 400, got ${res.status}`);
    // The bridge must still be healthy afterward, not left in a bad state.
    const followUp = new Client({ name: "smoke-post-leak-check", version: "0.1.0" });
    await followUp.connect(
      new StreamableHTTPClientTransport(new URL(mcpUrl), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }),
    );
    const { tools } = await followUp.listTools();
    assert(tools.length === 16, `bridge must still work normally afterward, got ${tools.length} tools`);
    await followUp.close();
  }
  console.log("non-initialize request with no session ok (rejected cleanly, bridge still healthy)");

  // /message (the "Investigate"-button mechanism, see README "Known gaps")
  // had zero coverage before this. Confirms the happy path (200, durable
  // inbox write — see handleAppMessage) and the size cap added alongside
  // the leak fix above.
  {
    const messageUrl = new URL("/message", sessionUrl);
    messageUrl.search = new URL(sessionUrl).search;
    const okRes = await fetch(messageUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: [{ type: "text", text: "smoke test message" }] }),
    });
    assert(okRes.status === 200, `/message with a valid body must 200, got ${okRes.status}`);

    const oversizedRes = await fetch(messageUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "x".repeat(1_000_001),
    });
    assert(oversizedRes.status === 413, `/message over the size cap must 413, got ${oversizedRes.status}`);
  }
  console.log("/message ok (valid body accepted, oversized body rejected)");

  // Auth gates: wrong/missing token on both endpoints must be rejected, not
  // silently served.
  const noTokenUrl = sessionUrl.replace(/\?token=.*$/, "");
  const wrongTokenUrl = sessionUrl.replace(/token=[\w-]+$/, "token=wrong");
  for (const badUrl of [noTokenUrl, wrongTokenUrl]) {
    const res = await fetch(badUrl);
    assert(res.status === 403, `session page without a valid token must 403, got ${res.status} for ${badUrl}`);
  }
  const mcpUrl = new URL("/mcp", sessionUrl).toString();
  const mcpRes = await fetch(mcpUrl, { method: "POST", body: "{}" });
  assert(mcpRes.status === 403, `/mcp without a valid token must 403, got ${mcpRes.status}`);
  console.log("auth gates ok");

  // Unknown session id: 404, not a crash.
  const unknownUrl = sessionUrl.replace(/app\/[a-f0-9-]+/, "app/00000000-0000-0000-0000-000000000000");
  const unknownRes = await fetch(unknownUrl);
  assert(unknownRes.status === 404, `unknown session id must 404, got ${unknownRes.status}`);
  console.log("unknown session -> 404 ok");

  await client.close();
  console.log("\nAll smoke checks passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
