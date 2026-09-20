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
import { Client } from "@modelcontextprotocol/client";
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
  const sessionUrl = match![0];
  console.log(`UI link injection ok: ${sessionUrl}`);

  // The session page itself renders (200, real HTML, the bootstrap payload
  // actually substituted in — not the raw placeholder).
  const pageRes = await fetch(sessionUrl);
  assert(pageRes.status === 200, `session page must return 200, got ${pageRes.status}`);
  const pageBody = await pageRes.text();
  assert(pageBody.includes("resourceUri"), "session page must contain the bootstrap payload");
  assert(!pageBody.includes("__BRIDGE_SESSION__"), "placeholder must have been substituted, not left literal");
  console.log("session page renders ok");

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
