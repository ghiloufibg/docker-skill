#!/usr/bin/env node
/**
 * Entry point. Stdio transport only — no HTTP/SSE server is started, per the
 * single-machine, no-remote-communication constraint in
 * docs/design/mcp-ui-docker-ops.md §1.
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
