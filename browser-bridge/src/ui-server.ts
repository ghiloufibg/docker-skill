import http from "node:http";
import { randomBytes, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import open from "open";
import { NodeStreamableHTTPServerTransport, localhostHostValidation } from "@modelcontextprotocol/node";
import type { Client, CallToolResult } from "@modelcontextprotocol/client";
import { createPassthroughServer } from "./passthrough.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Built by `vite build` (see vite.config.ts) — kept in a separate output dir
// from the tsc-compiled Node code (dist/) so the two builds never collide.
const WRAPPER_HTML_PATH = path.join(__dirname, "..", "dist-browser", "wrapper.html");

interface Session {
  id: string;
  toolName: string;
  toolArgs: Record<string, unknown> | undefined;
  toolResult: CallToolResult;
  resourceUri: string;
  createdAt: number;
}

export interface UiBridgeOptions {
  /** Spawns a fresh backend connection dedicated to browser-originated traffic. */
  spawnBackend: () => Promise<Client>;
  /** Fixed port, or 0 (default) to let the OS pick a free loopback port. */
  port?: number;
  /** Auto-launch the system browser when a new session is registered (default true). */
  autoOpen?: boolean;
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
 *    gated by the same token via `Authorization: Bearer`, forwarded to a
 *    dedicated backend Client (see spawn-backend.ts) so the View's own
 *    `tools/call`/`resources/read` requests reach the real server.
 */
export class UiBridge {
  private readonly opts: Required<UiBridgeOptions>;
  private readonly token = randomBytes(24).toString("base64url");
  private readonly sessions = new Map<string, Session>();
  private server: http.Server | undefined;
  private baseUrl = "";
  private starting: Promise<void> | undefined;

  constructor(opts: UiBridgeOptions) {
    this.opts = { port: 0, autoOpen: true, ...opts };
  }

  async registerSession(
    toolName: string,
    toolArgs: Record<string, unknown> | undefined,
    toolResult: CallToolResult,
    resourceUri: string,
  ): Promise<{ linkText: string }> {
    await this.ensureStarted();

    const id = randomUUID();
    this.sessions.set(id, { id, toolName, toolArgs, toolResult, resourceUri, createdAt: Date.now() });

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

  private async ensureStarted(): Promise<void> {
    if (this.server) return;
    if (!this.starting) this.starting = this.start();
    await this.starting;
  }

  private async start(): Promise<void> {
    const backend = await this.opts.spawnBackend();
    const mcpServer = createPassthroughServer(backend, {
      // Browser-originated tool calls never need to re-trigger the bridge —
      // this hook only exists for the CLI-facing server (passthrough.ts).
      onUiToolResult: async () => undefined,
    });
    const httpTransport = new NodeStreamableHTTPServerTransport({ sessionIdGenerator: () => randomUUID() });
    await mcpServer.connect(httpTransport);

    const validateHost = localhostHostValidation();
    const wrapperTemplate = await fs.readFile(WRAPPER_HTML_PATH, "utf-8");

    const server = http.createServer((req, res) => {
      if (!validateHost(req, res)) return; // already answered (403) on failure

      const url = new URL(req.url ?? "/", "http://localhost");

      if (url.pathname === "/mcp") {
        if (!this.hasValidToken(req, url)) return this.deny(res);
        void httpTransport.handleRequest(req, res);
        return;
      }

      const appMatch = url.pathname.match(/^\/app\/([^/]+)$/);
      if (appMatch) {
        if (url.searchParams.get("token") !== this.token) return this.deny(res);
        const session = this.sessions.get(appMatch[1]);
        if (!session) {
          res.writeHead(404, { "content-type": "text/plain" }).end("Unknown or expired session");
          return;
        }
        const bootstrap = {
          resourceUri: session.resourceUri,
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
    console.error(`[browser-bridge] local UI companion listening on ${this.baseUrl} (loopback only)`);
  }

  private hasValidToken(req: http.IncomingMessage, url: URL): boolean {
    const header = req.headers.authorization;
    if (header === `Bearer ${this.token}`) return true;
    return url.searchParams.get("token") === this.token;
  }

  private deny(res: http.ServerResponse): void {
    res.writeHead(403, { "content-type": "text/plain" }).end("Forbidden");
  }

  private handleAppMessage(req: http.IncomingMessage, res: http.ServerResponse): void {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString("utf-8"));
        // v1, deliberate limitation: this bridge is a detached process, not
        // the live Claude Code CLI conversation, so it cannot inject a real
        // turn into that chat. It surfaces the request loudly instead of
        // silently dropping it or faking success. See README "Known gaps".
        console.error(
          `[browser-bridge] the UI sent a message intended for the agent (not delivered ` +
            `automatically — see README): ${JSON.stringify(body.content ?? body)}`,
        );
        res.writeHead(200, { "content-type": "application/json" }).end("{}");
      } catch {
        res.writeHead(400).end();
      }
    });
  }
}
