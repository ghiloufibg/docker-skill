import { randomUUID } from "node:crypto";
import type { ContentBlock, McpServer } from "@modelcontextprotocol/server";

/**
 * Generic MCP token-optimization helper — zero project-specific knowledge,
 * safe to copy into any MCP server as a starting point for a new MCP-UI
 * skill. Not Docker-specific, not tied to this repo's tool set in any way.
 *
 * The problem this solves: a tool result's `content` array is what actually
 * reaches the model's context (confirmed empirically against Claude Code
 * CLI — see claudedocs/qa-report-claude-code-cli-e2e.md — `structuredContent`
 * is not forwarded to the model on that host). A tool that returns a large
 * blob (logs, a big file, a long query result) pays full token cost on
 * *every* call, even on calls where the model never actually needs to read
 * all of it — e.g. a UI-driven refresh that only displays the data via
 * `structuredContent`.
 *
 * The fix is the MCP spec's own mechanism for this, not a workaround: the
 * `resource_link` content type (see
 * https://modelcontextprotocol.io/specification/2025-06-18/server/tools#resource-links).
 * "A tool MAY return links to Resources... the tool will return a URI that
 * can be subscribed to or fetched by the client" instead of embedding the
 * data. The model still gets a short, immediately useful summary either
 * way; it only pays for the full content on the calls where it actually
 * dereferences the link.
 *
 * Usage in a tool handler, once per server:
 * ```ts
 * const largeContent = createLargeContentStore(server);
 *
 * // inside a tool handler:
 * const fullText = JSON.stringify(someBigPayload);
 * return {
 *   content: largeContent.toContent(fullText, {
 *     name: "query-result",
 *     mimeType: "application/json",
 *   }),
 *   structuredContent: someBigPayload, // unchanged — the UI still gets everything
 * };
 * ```
 *
 * Small inputs (below `thresholdBytes`) are returned inline, unchanged —
 * this only changes behavior for genuinely large content, and never changes
 * `structuredContent` at all, so it composes with the content/structuredContent
 * split pattern without any interaction between the two.
 */
export interface LargeContentOptions {
  /** Short, stable identifier for the resource (shown to the model/UI as its name). */
  name: string;
  /** Optional longer human-readable description of what this resource contains. */
  description?: string;
  /** MIME type of the content. Defaults to "text/plain". */
  mimeType?: string;
  /** Bytes above which content is stored out-of-band instead of inlined. Default: 2000. */
  thresholdBytes?: number;
  /** How long the out-of-band resource stays fetchable, in ms. Default: 10 minutes. */
  ttlMs?: number;
  /** Override the default summary text shown in place of the full content. */
  summary?: (text: string, byteLength: number) => string;
}

const DEFAULT_THRESHOLD_BYTES = 2000;
const DEFAULT_TTL_MS = 10 * 60_000;
const PREVIEW_CHARS = 200;

function defaultSummary(text: string, byteLength: number): string {
  const preview = text.length > PREVIEW_CHARS ? `${text.slice(0, PREVIEW_CHARS)}…` : text;
  return `${preview}\n\n(${byteLength.toLocaleString()} bytes total — full content available via the linked resource.)`;
}

export interface LargeContentStore {
  /**
   * Returns a `content` array for the given text: inline if small, or a
   * summary + `resource_link` if it exceeds `thresholdBytes`. Registers a
   * fresh, uniquely-URI'd MCP resource for the latter case and schedules
   * its own cleanup — callers don't need to manage resource lifecycle.
   */
  toContent(text: string, opts: LargeContentOptions): ContentBlock[];
}

/** Creates a store bound to `server`, used to register ephemeral resources on demand. */
export function createLargeContentStore(server: McpServer): LargeContentStore {
  return {
    toContent(text, opts) {
      const thresholdBytes = opts.thresholdBytes ?? DEFAULT_THRESHOLD_BYTES;
      const byteLength = Buffer.byteLength(text, "utf-8");
      if (byteLength <= thresholdBytes) {
        return [{ type: "text", text }];
      }

      const uri = `ephemeral://${randomUUID()}`;
      const mimeType = opts.mimeType ?? "text/plain";
      const registered = server.registerResource(
        opts.name,
        uri,
        { description: opts.description, mimeType },
        () => ({ contents: [{ uri, mimeType, text }] }),
      );
      // Not a leak-prevention afterthought — every ephemeral resource is
      // scheduled for removal the moment it's created, same TTL-sweep
      // discipline as browser-bridge's UiBridge session store.
      const timer = setTimeout(() => registered.remove(), opts.ttlMs ?? DEFAULT_TTL_MS);
      timer.unref?.();

      const summarize = opts.summary ?? defaultSummary;
      return [
        { type: "text", text: summarize(text, byteLength) },
        { type: "resource_link", uri, name: opts.name, description: opts.description, mimeType },
      ];
    },
  };
}
