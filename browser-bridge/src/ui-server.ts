import http from "node:http";
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import open from "open";
import { NodeStreamableHTTPServerTransport, localhostHostValidation } from "@modelcontextprotocol/node";
import type { Client, CallToolResult } from "@modelcontextprotocol/client";
import { createPassthroughServer, type ToolUiMeta } from "./passthrough.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Built by `vite build` (see vite.config.ts) — kept in a separate output dir
// from the tsc-compiled Node code (dist/) so the two builds never collide.
const WRAPPER_HTML_PATH = path.join(__dirname, "..", "dist-browser", "wrapper.html");

// Same pattern as mcp-server/docker/stream/sidecar.ts's timingSafeTokenMatch
// in this same repo: a plain `===` on the token leaks timing information
// proportional to how many leading characters match, a real (if narrow,
// loopback-only) weakening of the "every request needs a random per-process
// token" property the README's threat model leans on.
function timingSafeTokenMatch(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

interface AppSession {
  id: string;
  toolName: string;
  toolArgs: Record<string, unknown> | undefined;
  toolResult: CallToolResult;
  uiMeta: ToolUiMeta;
  expiresAt: number;
}

interface McpSession {
  transport: NodeStreamableHTTPServerTransport;
  backend: Client;
  lastActivityAt: number;
}

export interface UiBridgeOptions {
  /** Spawns a fresh backend connection dedicated to browser-originated traffic. */
  spawnBackend: () => Promise<Client>;
  /** Fixed port, or 0 (default) to let the OS pick a free loopback port. */
  port?: number;
  /** Auto-launch the system browser when a new session is registered (default true). */
  autoOpen?: boolean;
  /** How long an unopened session link — or an idle browser MCP connection — stays valid, in ms (default 30 min). */
  sessionTtlMs?: number;
  /**
   * File that `ui/message` payloads (the "Investigate"-button mechanism —
   * see README "Known gaps") get appended to, one JSON object per line, in
   * addition to the stderr log line. Defaults to a fixed path under the OS
   * temp dir so it survives even if the terminal's scrollback doesn't.
   */
  messageInboxPath?: string;
}

/**
 * Lazily-started local HTTP companion (loopback-only) that lets a real
 * browser render MCP Apps `ui://` resources on behalf of a terminal MCP
 * host that can't render them itself. Mirrors this repo's own Stage-5
 * streaming sidecar pattern (docker/stream/sidecar.ts): nothing binds a
 * port until the first UI-bearing tool result actually shows up.
 *
 * Two logical endpoints once started:
 *  - `GET  /app/:sessionId?token=...`  the human-facing page (host wrapper +
 *    sandboxed iframe for the View), gated by a per-process random token.
 *  - `ANY  /mcp`                        the browser's own MCP connection,
 *    gated by the same token via `Authorization: Bearer`.
 *
 * `/mcp` supports any number of independent browser sessions concurrently —
 * each gets its own dedicated backend connection and passthrough server,
 * keyed by the `Mcp-Session-Id` the transport negotiates on `initialize`
 * (the standard multi-session Streamable HTTP pattern; see
 * `WebStandardStreamableHTTPServerTransportOptions.onsessioninitialized`'s
 * own doc comment: "Useful in cases when you need to register multiple mcp
 * sessions and need to keep track of them"). A single shared transport
 * would reject any second browser tab's `initialize` outright — verified
 * the hard way: opening two links against one bridge process previously
 * produced `Invalid Request: Server already initialized`.
 */
export class UiBridge {
  private readonly opts: Required<UiBridgeOptions>;
  private readonly token = randomBytes(24).toString("base64url");
  private readonly appSessions = new Map<string, AppSession>();
  private readonly mcpSessions = new Map<string, McpSession>();
  private server: http.Server | undefined;
  private cleanupTimer: NodeJS.Timeout | undefined;
  private baseUrl = "";
  private starting: Promise<void> | undefined;
  private closed = false;

  constructor(opts: UiBridgeOptions) {
    this.opts = {
      port: 0,
      autoOpen: true,
      sessionTtlMs: 30 * 60_000,
      messageInboxPath: path.join(os.tmpdir(), "mcp-apps-browser-bridge-messages.jsonl"),
      ...opts,
    };
  }

  async registerSession(
    toolName: string,
    toolArgs: Record<string, unknown> | undefined,
    toolResult: CallToolResult,
    uiMeta: ToolUiMeta,
  ): Promise<{ linkText: string }> {
    await this.ensureStarted();

    const id = randomUUID();
    this.appSessions.set(id, {
      id,
      toolName,
      toolArgs,
      toolResult,
      uiMeta,
      expiresAt: Date.now() + this.opts.sessionTtlMs,
    });

    const url = `${this.baseUrl}/app/${id}?token=${this.token}`;
    if (this.opts.autoOpen) {
      open(url).catch((err) => {
        console.error(`[browser-bridge] could not auto-open browser: ${(err as Error).message}`);
      });
    }
    // OSC 8 makes this clickable in terminals that support it (iTerm2,
    // Windows Terminal, VS Code, kitty, ...); the plain URL after it is the
    // fallback for terminals that don't.
    const hyperlink = `]8;;${url}Open interactive view]8;;`;
    console.error(`[browser-bridge] ${toolName} has an interactive UI → ${hyperlink} (${url})`);

    return {
      linkText: `🖥️ Interactive UI available in your browser: ${url}\n` +
        `(this terminal cannot render MCP Apps UI directly — open the link above to see and use the real widget)`,
    };
  }

  /** Closes the local HTTP server and every open browser MCP session's backend connection. Idempotent. */
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
    await Promise.allSettled(
      [...this.mcpSessions.values()].map((s) => Promise.allSettled([s.transport.close(), s.backend.close()])),
    );
    this.mcpSessions.clear();
    await new Promise<void>((resolve) => (this.server ? this.server.close(() => resolve()) : resolve()));
  }

  private async ensureStarted(): Promise<void> {
    if (this.closed) throw new Error("mcp-apps-browser-bridge: UiBridge already closed");
    if (this.server) return;
    if (!this.starting) {
      // If start() fails, clear `starting` so the *next* UI-bearing tool
      // call gets a fresh attempt instead of forever re-awaiting (and
      // re-throwing from) the same rejected promise — a transient failure
      // (e.g. the port picked was momentarily taken) shouldn't be fatal for
      // the whole remaining session.
      this.starting = this.start().catch((err) => {
        this.starting = undefined;
        throw err;
      });
    }
    await this.starting;
  }

  private async start(): Promise<void> {
    const validateHost = localhostHostValidation();
    const wrapperTemplate = await fs.readFile(WRAPPER_HTML_PATH, "utf-8");

    const server = http.createServer((req, res) => {
      if (!validateHost(req, res)) return; // already answered (403) on failure

      const url = new URL(req.url ?? "/", "http://localhost");

      if (url.pathname === "/mcp") {
        if (!this.hasValidToken(req, url)) return this.deny(res);
        void this.handleMcpRequest(req, res);
        return;
      }

      const appMatch = url.pathname.match(/^\/app\/([^/]+)$/);
      if (appMatch) {
        if (!timingSafeTokenMatch(url.searchParams.get("token") ?? "", this.token)) return this.deny(res);
        const session = this.appSessions.get(appMatch[1]);
        if (!session || session.expiresAt < Date.now()) {
          res.writeHead(404, { "content-type": "text/plain" }).end("Unknown or expired session");
          return;
        }
        const bootstrap = {
          resourceUri: session.uiMeta.resourceUri,
          permissions: session.uiMeta.permissions ?? {},
          toolName: session.toolName,
          toolArgs: session.toolArgs ?? {},
          toolResult: session.toolResult,
          mcpUrl: "/mcp",
          token: this.token,
        };
        // Escape `<` so nothing in the (agent- and tool-controlled) payload
        // — e.g. a docker-logs excerpt that happens to contain "</script>"
        // — can prematurely close this script tag and inject markup.
        const json = JSON.stringify(bootstrap).replace(/</g, "\\u003c");
        const html = wrapperTemplate.replace('"__BRIDGE_SESSION__"', json);
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(html);
        return;
      }

      if (url.pathname === "/message" && req.method === "POST") {
        if (!this.hasValidToken(req, url)) return this.deny(res);
        this.handleAppMessage(req, res);
        return;
      }

      res.writeHead(404, { "content-type": "text/plain" }).end("Not found");
    });

    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(this.opts.port, "127.0.0.1", () => resolve());
    });

    const address = server.address();
    const port = typeof address === "object" && address ? address.port : this.opts.port;
    this.baseUrl = `http://127.0.0.1:${port}`;
    this.server = server;
    // Sessions are small but unbounded without this — a long-running bridge
    // process that keeps getting UI-bearing tool calls, or browser tabs
    // that get closed without a clean MCP session teardown, would
    // otherwise leak memory (and, for mcpSessions, leaked child processes)
    // for the life of the process.
    this.cleanupTimer = setInterval(() => {
      this.sweepExpiredAppSessions();
      void this.sweepIdleMcpSessions();
    }, 60_000);
    this.cleanupTimer.unref?.(); // never keep the process alive on its own
    console.error(`[browser-bridge] local UI companion listening on ${this.baseUrl} (loopback only)`);
  }

  /**
   * Routes an `/mcp` request to its existing browser session's transport,
   * or — for a request with no (or an unrecognized) `Mcp-Session-Id`
   * header, i.e. a fresh `initialize` — spins up a brand new dedicated
   * backend connection + passthrough server + transport for it. Each
   * browser tab that opens a link gets full isolation from every other one,
   * the same way the CLI-facing side already has its own dedicated
   * connection (see spawn-backend.ts).
   */
  private async handleMcpRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const sessionIdHeader = req.headers["mcp-session-id"];
    const existing = typeof sessionIdHeader === "string" ? this.mcpSessions.get(sessionIdHeader) : undefined;
    if (existing) {
      existing.lastActivityAt = Date.now();
      await existing.transport.handleRequest(req, res);
      return;
    }

    let backend: Client;
    try {
      backend = await this.opts.spawnBackend();
    } catch (err) {
      console.error(`[browser-bridge] could not start backend for new browser session: ${(err as Error).message}`);
      res.writeHead(502, { "content-type": "application/json" }).end(
        JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message: "Backend unavailable" }, id: null }),
      );
      return;
    }

    const mcpServer = createPassthroughServer(backend, {
      // Browser-originated tool calls never need to re-trigger the bridge —
      // this hook only exists for the CLI-facing server (passthrough.ts).
      // UiHook requires a Promise-returning callback; nothing to await here.
      // eslint-disable-next-line @typescript-eslint/require-await
      onUiToolResult: async () => undefined,
    });
    let registered = false;
    const transport = new NodeStreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (sessionId) => {
        registered = true;
        this.mcpSessions.set(sessionId, { transport, backend, lastActivityAt: Date.now() });
      },
      onsessionclosed: (sessionId) => {
        const session = this.mcpSessions.get(sessionId);
        this.mcpSessions.delete(sessionId);
        void session?.backend.close().catch(() => undefined);
        console.error(`[browser-bridge] browser session ${sessionId} closed, backend released`);
      },
    });
    await mcpServer.connect(transport);
    await transport.handleRequest(req, res);
    // `backend` is spawned above for any request that arrives with no (or
    // an unrecognized) Mcp-Session-Id header, before it's known whether the
    // request actually is a valid `initialize` — a client that sends some
    // other method first (a stale/dropped session id, a buggy retry) gets a
    // clean error response from the SDK's own request handling, but
    // `onsessioninitialized` then never fires, so this backend (and its
    // spawned child process) would otherwise never be registered anywhere
    // and never closed — leaked for the life of the bridge process.
    // Verified empirically: one such request measurably left an extra
    // backend child process running with no fix in place.
    if (!registered) {
      await Promise.allSettled([backend.close(), transport.close()]);
    }
  }

  private sweepExpiredAppSessions(): void {
    const now = Date.now();
    for (const [id, session] of this.appSessions) {
      if (session.expiresAt < now) this.appSessions.delete(id);
    }
  }

  private async sweepIdleMcpSessions(): Promise<void> {
    const cutoff = Date.now() - this.opts.sessionTtlMs;
    const idle = [...this.mcpSessions.entries()].filter(([, s]) => s.lastActivityAt < cutoff);
    for (const [id, session] of idle) {
      this.mcpSessions.delete(id);
      await Promise.allSettled([session.transport.close(), session.backend.close()]);
    }
  }

  private hasValidToken(req: http.IncomingMessage, url: URL): boolean {
    const header = req.headers.authorization;
    if (header !== undefined && timingSafeTokenMatch(header, `Bearer ${this.token}`)) return true;
    return timingSafeTokenMatch(url.searchParams.get("token") ?? "", this.token);
  }

  private deny(res: http.ServerResponse): void {
    res.writeHead(403, { "content-type": "text/plain" }).end("Forbidden");
  }

  private handleAppMessage(req: http.IncomingMessage, res: http.ServerResponse): void {
    const MAX_BODY_BYTES = 1_000_000; // ui/message is a short agent prompt, not a file upload
    const chunks: Buffer[] = [];
    let bytesReceived = 0;
    let settled = false; // guards against double-responding once a size cap or stream error already handled it

    req.on("data", (c: Buffer) => {
      if (settled) return; // request already destroyed below; ignore trailing buffered chunks
      bytesReceived += c.length;
      if (bytesReceived > MAX_BODY_BYTES) {
        settled = true;
        res.writeHead(413, { "content-type": "text/plain" }).end("Payload too large");
        req.destroy();
        return;
      }
      chunks.push(c);
    });

    // Without this, a client that aborts mid-upload never fires "end" —
    // the request just hangs with no timeout and no cleanup, instead of
    // failing cleanly.
    req.on("error", () => {
      if (settled) return;
      settled = true;
      if (!res.headersSent) res.writeHead(400).end();
    });

    req.on("end", () => {
      if (settled) return;
      settled = true;
      void (async () => {
        try {
          // Parsed into `unknown`, not trusted as any particular shape --
          // this is the one place in the bridge that handles a payload the
          // *widget* controls (an agent-authored ui/message call), not one
          // this process generated itself, so it gets the narrower
          // treatment passthrough.ts's own trust-boundary comments describe.
          const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString("utf-8"));
          const body = typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
          // v1, deliberate limitation: this bridge is a detached process, not
          // the live CLI conversation, so it cannot inject a real turn into
          // it. It surfaces the request loudly (stderr) AND durably (a JSON
          // Lines inbox file, so it isn't lost to terminal scrollback)
          // instead of silently dropping it or faking success. See README
          // "Known gaps".
          const entry = { receivedAt: new Date().toISOString(), ...body };
          console.error(
            `[browser-bridge] the UI sent a message intended for the agent (not delivered ` +
              `automatically — see README; also appended to ${this.opts.messageInboxPath}): ` +
              `${JSON.stringify(body.content ?? body)}`,
          );
          await fs.appendFile(this.opts.messageInboxPath, JSON.stringify(entry) + "\n", "utf-8").catch((err) => {
            console.error(`[browser-bridge] could not write message inbox: ${(err as Error).message}`);
          });
          res.writeHead(200, { "content-type": "application/json" }).end("{}");
        } catch {
          res.writeHead(400).end();
        }
      })();
    });
  }
}
