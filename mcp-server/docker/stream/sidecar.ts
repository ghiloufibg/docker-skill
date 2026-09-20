/**
 * Stage 5 (design doc §11 item 5): an optional loopback-only streaming
 * sidecar for live logs/stats, so the dashboard's Logs/Stats tabs can push
 * updates instead of relying on manual refresh. This is a genuine exception
 * to "no HTTP/SSE server, stdio only" in index.ts — but a deliberate,
 * already-anticipated one (see the design doc), and it stays inside the
 * same single-machine constraint: bound to 127.0.0.1 only, never 0.0.0.0,
 * so nothing off this machine can ever reach it.
 *
 * Why TCP at all, when the design doc's original phrasing was "loopback/
 * Unix-socket-only": a browser's EventSource can't open a Unix domain
 * socket — the widget runs inside a sandboxed iframe and can only reach
 * this over the network stack, so a loopback TCP port is the only option
 * that's actually reachable from there. The trade-off that opens (any
 * process on this machine that can reach 127.0.0.1 can also reach this
 * port — the classic "localhost sidecar" concern shared by every local
 * dev-server-with-a-UI) is mitigated, not eliminated, by requiring a
 * random per-process token on every request: knowing the port alone isn't
 * enough. The token is only ever handed out over the existing MCP
 * tool-call channel (the `stream-info` tool in server.ts), never embedded
 * in the static HTML resource, so it isn't discoverable by anything that
 * can merely read the (cacheable, otherwise-static) widget bundle.
 */
import crypto from "node:crypto";
import http from "node:http";
import type Docker from "dockerode";
import { docker, DOCKER_ID_PATTERN } from "../client.js";
import { computeStatsFromRaw } from "../tools/stats.js";

const DEFAULT_PORT = 19943;
export const SIDECAR_PORT = Number(process.env.DOCKER_SKILL_SIDECAR_PORT ?? DEFAULT_PORT);

export interface SidecarInfo {
  port: number;
  token: string;
}

// Module-level singleton: createServer() can in principle run more than
// once in the same process (each stdio connection creates a fresh
// McpServer, and so does the smoke test's multiple-session use), but the
// sidecar is process-wide — a second .listen() on the same port would
// throw EADDRINUSE. Every session in this process shares one sidecar and
// one token, which is fine for a local, single-user tool.
//
// Known gap, not fixed here: this only dedupes within one process. Two
// independent instances of this server (two separate `node dist/index.js`
// processes on the same machine — e.g. two Claude Code sessions each with
// it registered) both try the same fixed port. The second one's
// server.listen() fails (logged, non-fatal — see the 'error' handler
// below), but `started` is still set optimistically before that failure
// can be known, so its stream-info tool hands out a token that was never
// actually bound anywhere. The widget's EventSource then reaches the
// FIRST process's sidecar with the SECOND process's token, gets 403, and
// shows the generic "Live unavailable" — not wrong, but not diagnosable
// either. Fixing this properly (OS-assigned port communicated back before
// any tool advertises it, or a lock file) is more machinery than a local,
// single-user, single-instance-at-a-time tool needs today; if multi-
// instance use becomes real, start there.
let started: SidecarInfo | null = null;

function timingSafeTokenMatch(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export function ensureSidecarStarted(): SidecarInfo {
  if (started) return started;
  const token = crypto.randomBytes(24).toString("hex");
  const info: SidecarInfo = { port: SIDECAR_PORT, token };

  const server = http.createServer((req, res) => {
    handleRequest(req, res, token).catch((e) => {
      console.error("streaming sidecar request error:", e);
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
  });
  server.on("error", (e) => {
    // Non-fatal: the dashboard's Live toggle degrades to "unavailable" if
    // the sidecar never came up (see the widget's connection-error
    // handling) — a port collision here should never take down the whole
    // MCP server, which still works fine without live streaming.
    console.error(`streaming sidecar failed to bind 127.0.0.1:${SIDECAR_PORT}:`, e.message);
  });
  server.listen(SIDECAR_PORT, "127.0.0.1");

  started = info;
  return info;
}

async function handleRequest(req: http.IncomingMessage, res: http.ServerResponse, token: string): Promise<void> {
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${SIDECAR_PORT}`);
  // No credentials/cookies are ever used for auth here (the token in the
  // query string is the only credential, handed out over a private
  // channel per the module doc above), so a wildcard origin doesn't leak
  // anything a same-origin policy would otherwise have protected.
  res.setHeader("Access-Control-Allow-Origin", "*");

  if (!timingSafeTokenMatch(url.searchParams.get("token") ?? "", token)) {
    res.writeHead(403, { "Content-Type": "text/plain" });
    res.end("forbidden");
    return;
  }

  const logsMatch = url.pathname.match(/^\/stream\/logs\/([^/]+)$/);
  const statsMatch = url.pathname.match(/^\/stream\/stats\/([^/]+)$/);
  const rawId = logsMatch?.[1] ?? statsMatch?.[1];

  if (rawId === undefined) {
    res.writeHead(404);
    res.end();
    return;
  }

  // The route regex above only excludes a literal `/` in the raw,
  // still-percent-encoded path segment — decodeURIComponent can turn an
  // encoded `%2F`/`%2E%2E` back into `/`/`..` afterward, so the decoded id
  // still needs its own check before it reaches dockerode's raw
  // path-concatenated HTTP request (see DOCKER_ID_PATTERN's doc comment).
  const id = decodeURIComponent(rawId);
  if (!DOCKER_ID_PATTERN.test(id)) {
    res.writeHead(400, { "Content-Type": "text/plain" });
    res.end("invalid container id");
    return;
  }

  if (logsMatch) {
    await streamLogs(id, res);
  } else {
    await streamStats(id, res);
  }
}

function sseHeaders(res: http.ServerResponse): void {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
}

function sendEvent(res: http.ServerResponse, data: unknown): void {
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const MAX_RECONNECT_ATTEMPTS = 20;

// The first version of the reconnect loop below waited for the dockerode
// stream's own 'end'/'error' events to notice a restart. Verified against
// a real restart with a Playwright script: it doesn't work — a `docker
// logs -f`/`stats({stream:true})` connection attached before a container
// restart just goes quiet afterward, in this Docker version, without ever
// emitting 'end' or 'error'. The stream is never told the process it was
// following is gone. So this polls `State.StartedAt` (changes on every
// start/restart) alongside waiting for the stream's own end, and forces a
// reconnect the moment it notices — the same "verify the fix by watching
// it happen, not by reading the code" lesson as the [hidden]-on-<svg>
// fix elsewhere in this round, applied to a server-side stream instead of
// a CSS toggle.
async function waitForStreamEndOrRestart(
  id: string,
  nodeStream: NodeJS.ReadableStream & { destroy?: () => void },
  attachedStartedAt: string,
): Promise<void> {
  return new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearInterval(watchdog);
      resolve();
    };
    nodeStream.on("end", finish);
    nodeStream.on("error", finish);
    const watchdog = setInterval(() => {
      if (settled) return;
      docker
        .getContainer(id)
        .inspect()
        .then((info) => {
          if (info.State.StartedAt !== attachedStartedAt) {
            nodeStream.destroy?.();
            finish();
          }
        })
        .catch(() => finish()); // container gone entirely — let the next attach's own not-found path handle it
    }, 1500);
  });
}

// `docker stats`/`docker logs -f` both follow the CONTAINER PROCESS, not
// the container's identity — restart it (exactly the thing this
// dashboard's own Actions tab does constantly) and the underlying stream
// goes quiet. Without reconnecting here, a real user would see "Live"
// silently go dead on the single most likely action to trigger while
// watching it: restarting the container they're watching. Found by
// scripting exactly that sequence, not by reasoning about dockerode's
// stream lifecycle. The reconnect loop lives server-side so it's
// invisible to the widget's EventSource — from the client's perspective
// the stream just keeps producing events.
async function streamStats(id: string, res: http.ServerResponse): Promise<void> {
  sseHeaders(res);
  let clientClosed = false;
  let currentStream: (NodeJS.ReadableStream & { destroy?: () => void }) | null = null;
  res.on("close", () => {
    clientClosed = true;
    currentStream?.destroy?.();
  });

  for (let attempt = 0; !clientClosed && attempt <= MAX_RECONNECT_ATTEMPTS; attempt++) {
    let nodeStream: NodeJS.ReadableStream;
    let startedAt: string;
    try {
      startedAt = (await docker.getContainer(id).inspect()).State.StartedAt;
      nodeStream = await docker.getContainer(id).stats({ stream: true });
    } catch {
      if (attempt === 0) {
        sendEvent(res, { error: "container not found or not running" });
        res.end();
        return;
      }
      await delay(Math.min(500 * attempt, 3000));
      continue;
    }
    currentStream = nodeStream;

    let buffer = "";
    nodeStream.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf-8");
      let idx: number;
      while ((idx = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 1);
        if (!line.trim()) continue;
        try {
          // Our own dockerode stream's own per-tick JSON, not attacker
          // input (see computeStatsFromRaw's doc comment) — a schema check
          // here would just duplicate what the `try` above already covers
          // for a malformed/split line.
          sendEvent(res, computeStatsFromRaw(JSON.parse(line) as Docker.ContainerStats));
        } catch {
          // A line split across two chunks — the next newline resyncs.
        }
      }
    });
    await waitForStreamEndOrRestart(id, currentStream, startedAt);
    if (!clientClosed) await delay(300);
  }
  if (!clientClosed) sendEvent(res, { error: "container appears to be gone — giving up reconnecting" });
  res.end();
}

// Same 8-byte-header demux as docker/tools/logs.ts's `demux`, but
// stateful across chunk boundaries (a `follow:true` stream can split a
// frame header or payload across two `data` events, unlike the one-shot
// tool's single complete Buffer) — genuinely different code, not just a
// style choice, so it isn't shared with that function. See streamStats
// above for why this reconnects rather than ending on the container's
// underlying process exiting.
async function streamLogs(id: string, res: http.ServerResponse): Promise<void> {
  sseHeaders(res);
  let clientClosed = false;
  let currentStream: (NodeJS.ReadableStream & { destroy?: () => void }) | null = null;
  res.on("close", () => {
    clientClosed = true;
    currentStream?.destroy?.();
  });

  // Reconnecting with no further argument would resume as "only lines
  // from the moment of THIS attach" — anything the container logged in
  // the reconnect gap (e.g. its restart-announcement line, emitted before
  // this loop's delay() even returns) would be silently lost, not just
  // delayed.
  //
  // The first version of this fix tracked `since` from the last line
  // actually *received*, defaulting to undefined (→ tail:0) until then.
  // That still lost data for exactly the case this exists to handle: a
  // container that logs once at startup and nothing else. Its one line
  // arrives on the first attach, nothing else ever does, so `since` never
  // gets set — and every reconnect after that falls straight back to
  // tail:0, recreating the identical gap for the *next* restart's line.
  // Caught only by watching two restarts in a row, not one — verifying a
  // fix with a single trial run isn't enough when the bug is about a gap
  // between events. Tracking "the moment we started watching" instead,
  // independent of whether anything was ever received, closes it for the
  // silent-container case too.
  let sinceUnixSeconds = Math.floor(Date.now() / 1000);

  for (let attempt = 0; !clientClosed && attempt <= MAX_RECONNECT_ATTEMPTS; attempt++) {
    let isTty = false;
    let startedAt: string;
    let nodeStream: NodeJS.ReadableStream;
    try {
      const info = await docker.getContainer(id).inspect();
      isTty = Boolean(info.Config.Tty);
      startedAt = info.State.StartedAt;
      nodeStream = await docker.getContainer(id).logs({
        stdout: true,
        stderr: true,
        follow: true,
        // First attach only: tail:0 ("only new lines") is a better default
        // than since=now — the Logs tab's manual refresh already covers
        // history, and tail:0 has no off-by-a-second edge the way a
        // just-computed `since` would. Every reconnect uses `since`.
        ...(attempt === 0 ? { tail: 0 } : { since: sinceUnixSeconds }),
        timestamps: true,
      });
    } catch {
      if (attempt === 0) {
        sendEvent(res, { error: "container not found" });
        res.end();
        return;
      }
      await delay(Math.min(500 * attempt, 3000));
      continue;
    }
    currentStream = nodeStream;

    let buffer = Buffer.alloc(0);
    const emitLines = (text: string) => {
      for (const line of text.split("\n")) {
        if (line.length === 0) continue;
        sendEvent(res, { line });
        // Docker's --timestamps prefixes each line with "<RFC3339Nano> ".
        // Date.parse needs just that token — handing it the whole line
        // (trailing message text included) returns NaN, not a partial parse.
        const ts = Date.parse(line.slice(0, line.indexOf(" ")));
        if (!Number.isNaN(ts)) sinceUnixSeconds = Math.max(sinceUnixSeconds, Math.floor(ts / 1000));
      }
    };
    nodeStream.on("data", (chunk: Buffer) => {
      if (isTty) {
        emitLines(chunk.toString("utf-8"));
        return;
      }
      buffer = Buffer.concat([buffer, chunk]);
      while (buffer.length >= 8) {
        const size = buffer.readUInt32BE(4);
        if (buffer.length < 8 + size) break;
        emitLines(buffer.subarray(8, 8 + size).toString("utf-8"));
        buffer = buffer.subarray(8 + size);
      }
    });
    await waitForStreamEndOrRestart(id, currentStream, startedAt);
    if (!clientClosed) await delay(300);
  }
  if (!clientClosed) sendEvent(res, { error: "container appears to be gone — giving up reconnecting" });
  res.end();
}
