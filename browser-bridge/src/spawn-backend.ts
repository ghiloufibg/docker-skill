import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

/**
 * Spawns one fresh instance of the wrapped target command and returns a
 * connected Client. The bridge spawns a separate instance per logical
 * connection (CLI-facing vs. browser-facing) instead of multiplexing one
 * child's stdio pipe — simpler and safer than JSON-RPC id-rewriting, and
 * fine for MCP servers that keep no server-local state (they should not;
 * real state belongs in the external system the tools talk to).
 */
export async function spawnBackendClient(command: string, args: string[]): Promise<Client> {
  const transport = new StdioClientTransport({ command, args });
  const client = new Client({ name: "mcp-apps-browser-bridge", version: "0.1.0" });
  await client.connect(transport);
  return client;
}
