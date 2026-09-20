import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

/**
 * Spawns one fresh instance of the wrapped target command and returns a
 * connected Client. The bridge spawns a separate instance per logical
 * connection (CLI-facing vs. browser-facing) instead of multiplexing one
 * child's stdio pipe — simpler and safer than JSON-RPC id-rewriting, and
 * fine for MCP servers that keep no server-local state (they should not;
 * real state belongs in the external system the tools talk to).
 *
 * Rejects with a clear, specific error if the target command can't even be
 * spawned (typo'd command, missing interpreter, etc.) instead of hanging or
 * surfacing an opaque transport error later.
 */
export async function spawnBackendClient(command: string, args: string[]): Promise<Client> {
  const transport = new StdioClientTransport({ command, args });
  const client = new Client({ name: "mcp-apps-browser-bridge", version: "1.0.0" });

  try {
    await client.connect(transport);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `mcp-apps-browser-bridge: failed to start wrapped server "${command} ${args.join(" ")}": ${message}`,
      { cause: err },
    );
  }

  return client;
}
