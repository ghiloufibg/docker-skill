#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { parseArgs, UsageError } from "./config.js";
import { spawnBackendClient } from "./spawn-backend.js";
import { createPassthroughServer } from "./passthrough.js";
import { UiBridge } from "./ui-server.js";

async function main(): Promise<void> {
  const config = parseArgs(process.argv.slice(2));

  const cliBackend = await spawnBackendClient(config.targetCommand, config.targetArgs);
  const uiBridge = new UiBridge({
    spawnBackend: () => spawnBackendClient(config.targetCommand, config.targetArgs),
    port: config.port,
    autoOpen: config.autoOpen,
    sessionTtlMs: config.sessionTtlMs,
  });

  const server = createPassthroughServer(cliBackend, {
    onUiToolResult: (toolName, args, result, uiMeta) => uiBridge.registerSession(toolName, args, result, uiMeta),
  });

  // Best-effort cleanup so a Ctrl-C (or the host killing this process on
  // session end) doesn't leave the wrapped server's child processes — or
  // the local UI HTTP server's port — hanging around. Runs once; a second
  // signal falls through to Node's default (immediate exit).
  let shuttingDown = false;
  const shutdown = async (signal: NodeJS.Signals) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.error(`[browser-bridge] ${signal} received, shutting down…`);
    await Promise.allSettled([cliBackend.close(), uiBridge.close()]);
    process.exit(0);
  };
  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));

  await server.connect(new StdioServerTransport());
}

main().catch((err) => {
  if (err instanceof UsageError) {
    console.error(err.message);
    process.exit(1);
  }
  console.error(err);
  process.exit(1);
});
