import { Server } from "@modelcontextprotocol/server";
import type { Client, CallToolResult, Tool } from "@modelcontextprotocol/client";

/**
 * Reimplemented locally instead of imported from
 * `@modelcontextprotocol/ext-apps/app-bridge` (the only subpath that
 * exports it) to avoid pulling a browser-oriented module into the Node
 * process. Matches the MCP Apps convention exactly: the nested
 * `_meta.ui.resourceUri` form (preferred) or the deprecated flat
 * `_meta["ui/resourceUri"]` form, either of which must start with `ui://`.
 */
function getToolUiResourceUri(tool: Partial<Tool>): string | undefined {
  const meta = tool._meta as Record<string, unknown> | undefined;
  const nested = meta?.ui as Record<string, unknown> | undefined;
  const uri = (nested?.resourceUri as string | undefined) ?? (meta?.["ui/resourceUri"] as string | undefined);
  if (uri === undefined) return undefined;
  if (!uri.startsWith("ui://")) {
    throw new Error(`Invalid ui.resourceUri on tool "${tool.name}": must start with "ui://", got "${uri}"`);
  }
  return uri;
}

export interface UiHook {
  /**
   * Called after a UI-enabled tool call succeeds, before the result is
   * relayed upstream. Awaited: this is what lets a lazily-started bridge
   * (first call boots an HTTP server) still get its link into THIS result,
   * not just future ones.
   */
  onUiToolResult(
    toolName: string,
    args: Record<string, unknown> | undefined,
    result: CallToolResult,
    resourceUri: string,
  ): Promise<{ linkText: string } | undefined>;
}

/**
 * Builds a `Server` that transparently forwards every standard MCP method to
 * `backend` (an already-connected Client to a spawned instance of the
 * wrapped target). This is intentionally NOT built with per-tool
 * `registerTool()` calls — the whole point is to work with any target
 * server without knowing its tools ahead of time, so it forwards by method
 * name instead.
 *
 * The one piece of real logic: after a `tools/call` result comes back, it
 * checks whether the called tool declares a `ui://` resource
 * (`_meta.ui.resourceUri`, the MCP Apps convention). If so, it hands the
 * result to `hook.onUiToolResult`, which lazily starts the local browser
 * bridge and returns a short text note; that note is appended to the
 * result's content so the model (and the human reading its reply) knows an
 * interactive view is available, without altering the original data the
 * model already reasons over.
 */
export function createPassthroughServer(backend: Client, hook: UiHook): Server {
  const server = new Server(
    { name: "mcp-apps-browser-bridge", version: "0.1.0" },
    { capabilities: backend.getServerCapabilities() ?? {} },
  );

  let toolsByName = new Map<string, Tool>();

  server.fallbackRequestHandler = async (request) => {
    const { method, params } = request as { method: string; params?: Record<string, unknown> };

    switch (method) {
      case "tools/list": {
        const result = await backend.listTools(params as never);
        toolsByName = new Map(result.tools.map((t) => [t.name, t]));
        return result;
      }
      case "tools/call": {
        const callParams = params as { name: string; arguments?: Record<string, unknown> };
        const result = await backend.callTool(callParams as never);

        if (!result.isError) {
          // A well-behaved client always calls tools/list before tools/call,
          // populating this cache as a side effect above — but don't assume
          // it: fetch on demand so a client that skips straight to
          // tools/call (or reconnects without re-listing) still gets its
          // link.
          if (!toolsByName.has(callParams.name)) {
            const { tools } = await backend.listTools();
            toolsByName = new Map(tools.map((t) => [t.name, t]));
          }
          const tool = toolsByName.get(callParams.name);
          const resourceUri = tool ? getToolUiResourceUri(tool) : undefined;
          if (resourceUri) {
            const note = await hook.onUiToolResult(callParams.name, callParams.arguments, result, resourceUri);
            if (note) {
              return {
                ...result,
                content: [...result.content, { type: "text" as const, text: note.linkText }],
              };
            }
          }
        }
        return result;
      }
      case "resources/list":
        return backend.listResources(params as never);
      case "resources/templates/list":
        return backend.listResourceTemplates(params as never);
      case "resources/read":
        return backend.readResource(params as never);
      case "prompts/list":
        return backend.listPrompts(params as never);
      case "prompts/get":
        return backend.getPrompt(params as never);
      case "completion/complete":
        return backend.complete(params as never);
      default:
        throw new Error(`mcp-apps-browser-bridge: unsupported passthrough method "${method}"`);
    }
  };

  return server;
}
