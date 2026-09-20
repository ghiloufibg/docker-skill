#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { spawnBackendClient } from "./spawn-backend.js";
import { createPassthroughServer } from "./passthrough.js";
import { UiBridge } from "./ui-server.js";

function printUsageAndExit(): never {
  console.error(
    "Usage: mcp-apps-browser-bridge [--no-open] [--port <n>] -- <command> [args...]\n\n" +
      "Wraps any stdio MCP server given after `--`. Register THIS command with your\n" +
      "MCP host (in place of the real server command) so tool results carrying a\n" +
      "ui:// MCP Apps resource get a real, fully-wired browser view instead of\n" +
      "silently degrading to raw text on a terminal host.",
  );
  process.exit(1);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const sep = argv.indexOf("--");
  if (sep === -1 || argv.length === sep + 1) printUsageAndExit();

  const flags = argv.slice(0, sep);
  const [command, ...targetArgs] = argv.slice(sep + 1);
  const noOpen = flags.includes("--no-open");
  const portIdx = flags.indexOf("--port");
  const port = portIdx !== -1 ? Number(flags[portIdx + 1]) : 0;

  const cliBackend = await spawnBackendClient(command, targetArgs);
  const uiBridge = new UiBridge({
    spawnBackend: () => spawnBackendClient(command, targetArgs),
    port,
    autoOpen: !noOpen,
  });

  const server = createPassthroughServer(cliBackend, {
    onUiToolResult: (toolName, args, result, resourceUri) =>
      uiBridge.registerSession(toolName, args, result, resourceUri),
  });

  await server.connect(new StdioServerTransport());
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
