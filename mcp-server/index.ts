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
import { createServer } from "./server.js";

async function main() {
  await createServer().connect(new StdioServerTransport());
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
