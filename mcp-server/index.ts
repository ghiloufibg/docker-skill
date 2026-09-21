#!/usr/bin/env node
/**
 * Entry point. The MCP protocol itself is stdio transport only — no HTTP
 * server is started for it, per the single-machine, no-remote-communication
 * constraint in docs/design/mcp-ui-docker-ops.md §1. The one exception is
 * the Stage 5 streaming sidecar (docker/stream/sidecar.ts): a loopback-only
 * (127.0.0.1) HTTP/SSE server, started lazily only if the dashboard's Live
 * toggle is ever used, that stays inside the same single-machine
 * constraint — see that file's own doc comment for why it needs TCP at all
 * and how it's kept safe.
 *
 * Run with: node dist/index.js
 */
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { closeSidecarIfStarted } from "./docker/stream/sidecar.js";
import { createServer } from "./server.js";

async function main() {
  await createServer().connect(new StdioServerTransport());

  // Best-effort cleanup so a Ctrl-C (or the host killing this process on
  // session end) stops the streaming sidecar's loopback listener instead of
  // relying purely on the OS to reclaim the port on process exit. Mirrors
  // browser-bridge/src/cli.ts's shutdown pattern in this same repo. Runs
  // once; a second signal falls through to Node's default (immediate exit).
  let shuttingDown = false;
  const shutdown = (signal: NodeJS.Signals) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.error(`docker-skill-mcp-server: ${signal} received, shutting down…`);
    closeSidecarIfStarted();
    process.exit(0);
  };
  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
