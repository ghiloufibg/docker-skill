# mcp-apps-browser-bridge

A generic companion for terminal MCP hosts — Claude Code CLI, and (per the
official [client support matrix](https://modelcontextprotocol.io/extensions/client-matrix))
every other pure-terminal AI agent as of this writing — that do not render
[MCP Apps](https://modelcontextprotocol.io/extensions/apps/overview)
(`ui://` resources). It wraps *any* stdio MCP server; when a tool result
comes from a tool that declares a `ui://` UI resource, the bridge lazily
opens a real browser tab that renders it properly, using the official
`@modelcontextprotocol/ext-apps` `AppBridge` — fully wired back to the same
server, not a static HTML dump.

This exists because Claude Code CLI, tested directly against this repo's own
`docker-skill-system-card` server, turned out to return `ui://` resources as
inert raw text (see `claudedocs/qa-report-claude-code-cli-e2e.md`) — a
limitation confirmed to be industry-wide, not Claude-specific. Not Docker
related at all: it works with any MCP server that follows the MCP Apps
convention, and is meant to be forked/adapted as a starting point for other
MCP-UI work (see "Using this as a blueprint" below).

**Status**: built and verified end-to-end (protocol passthrough, real
browser render with live data, and a genuine interactive `tools/call` round
trip — see `test/smoke.ts` and the QA report). Trust model assumed
throughout: **local, single-user, no remote exposure** — see "Threat model"
before reusing this somewhere that assumption doesn't hold.

## How it works

```
Claude Code CLI  <--stdio-->  [this bridge, one process]  <--stdio-->  [spawned target server #1]
                                       |
                                       | lazily, only when a tools/call result
                                       | comes from a ui://-enabled tool
                                       v
                          local HTTP server, 127.0.0.1 only
                     (NodeStreamableHTTPServerTransport, per-process
                      random token, DNS-rebinding-protected host check)
                                       |
                                  auto-opened link
                                       v
                                real system browser
                                       |
                      wrapper page: Client -> StreamableHTTPClientTransport
                      -> AppBridge -> sandboxed iframe (the actual widget)
                                       |
                          same HTTP server, forwarded to a SECOND
                          spawned instance of the target server
```

The bridge presents itself to your MCP host exactly like the real server —
same tools, same resources, same capabilities — by forwarding every
standard method (`tools/list`, `tools/call`, `resources/*`, `prompts/*`,
`completion/complete`) to the wrapped command (`src/passthrough.ts`). The
**only** logic it adds: after a `tools/call` result comes back from a tool
whose definition carries `_meta.ui.resourceUri`, it appends one text block
naming a browser link before relaying the result upstream — the underlying
data the model reasons over is unchanged. If a tool has no UI resource, the
bridge is a no-op passthrough.

Two independent instances of the target server are spawned (one servicing
the CLI-facing side, one the browser-facing side, the second one lazily —
see `src/ui-server.ts`) rather than multiplexing one child's stdio pipe.
That's simpler and avoids JSON-RPC id collisions, at the cost of assuming
your target server keeps no meaningful in-process state of its own (state
should live in whatever external system the tools actually talk to — true
of this repo's own server, whose only state is the real Docker daemon).

## Usage

Build it once:

```bash
cd browser-bridge
npm install
npm run build
```

Then register **this** command with your MCP host instead of the real
server command — everything after `--` is the real server's own command
line, unchanged:

```json
{
  "mcpServers": {
    "docker-skill-system-card": {
      "type": "stdio",
      "command": "node",
      "args": [
        "<absolute path to>/browser-bridge/dist/cli.js",
        "--",
        "node",
        "<absolute path to>/mcp-server/dist/index.js"
      ]
    }
  }
}
```

Or with the Claude Code CLI:

```bash
claude mcp add docker-skill-system-card --scope local -- \
  node <absolute path to>/browser-bridge/dist/cli.js -- \
  node <absolute path to>/mcp-server/dist/index.js
```

Flags (must come *before* `--`):

| Flag | Default | Meaning |
|---|---|---|
| `--no-open` | off | Print the link instead of auto-launching a browser tab. |
| `--port <n>` | OS-assigned | Fixed loopback port instead of a random one. |
| `--session-ttl <minutes>` | 30 | How long an unopened session link stays valid before it's swept. |
| `-h`, `--help` | | Print usage and exit 0. |
| `-v`, `--version` | | Print the version and exit 0. |

## Threat model

Built and verified for **local, single-user use with no remote exposure** —
the target audience is "my own machine, my own terminal, my own MCP
server(s)." What's still in place, cheap and non-intrusive, so it's kept
regardless:

- The local HTTP server binds `127.0.0.1` only, never `0.0.0.0`.
- Every request needs a random, per-process token (`?token=` or
  `Authorization: Bearer`).
- `localhostHostValidation()` rejects a mismatched `Host` header (DNS
  rebinding), not just a token check.
- The View renders in an iframe with `sandbox="allow-scripts allow-forms"`
  (plus a computed `allow` attribute for any permissions the tool's
  `_meta.ui.permissions` requests) and no `allow-same-origin` — an opaque,
  unique origin with no access to the wrapper page's or bridge's own
  cookies, storage, or DOM.

What's **deliberately not here**, because the local/single-user assumption
makes it not worth the complexity — add these first if you ever point this
at a shared machine, a multi-tenant setup, or anything remote:

- The spec's double-iframe **sandbox-proxy** pattern (an extra neutral frame
  between the wrapper page and the untrusted widget HTML) — this bridge sets
  `srcdoc` on one sandboxed iframe directly instead. `allow-scripts` without
  `allow-same-origin` already blocks same-origin/cookie/storage access and
  top-level navigation, so this is a simplification, not an open hole, but
  it's a real gap from the spec's recommended posture.
- Any rate limiting, request logging/auditing, or CSRF-style origin
  allowlisting beyond the DNS-rebinding host check.
- Auth beyond a single shared per-process token (no per-session tokens, no
  expiry on the token itself — only on sessions).

## Process lifecycle

Verified directly (see the empirical Windows test in the git history of
this file's commit, or repeat it yourself): if the bridge process is killed
— even forcefully (`Stop-Process -Force` / `taskkill /F`, the same as a host
abruptly terminating its MCP server subprocess) — its spawned target-server
children are **not** orphaned. Windows (and POSIX) close the parent's end of
the piped stdio handles as part of process teardown, which the child's own
`StdioServerTransport` sees as its stdin closing and exits on. This is the
real safety net, and it requires nothing from the wrapped server beyond
"uses a standard stdio MCP transport," which is exactly the servers this
bridge targets.

On top of that, `cli.ts` installs `SIGINT`/`SIGTERM` handlers that close
both backend connections and the local HTTP server explicitly, for the
*graceful* shutdown path (e.g. an interactive Ctrl-C) where they actually
get a chance to run — useful for the tidy log line and prompt release, not
required for correctness.

Long-running-process concerns this pass specifically addressed:

- **Session memory leak**: every UI-bearing tool call used to add an entry
  to an in-memory map that nothing ever removed. Sessions now expire after
  `--session-ttl` minutes (default 30) and are swept every 60s
  (`src/ui-server.ts`'s `sweepExpiredSessions`).
- **Stuck startup**: if the lazy local HTTP server's first start attempt
  fails (e.g. the OS-picked port raced with something else), the bridge
  used to permanently re-await (and re-throw from) that same rejected
  promise forever. It now clears the cached attempt on failure so the next
  UI-bearing tool call gets a fresh try.
- **Opaque spawn failures**: a typo'd target command used to surface as a
  generic transport-closed error deep in the SDK. `spawn-backend.ts` now
  wraps it with the actual command line and cause.

## Known gaps (still open, by design)

- **`ui/message` (the "Investigate"-button mechanism) is not delivered into
  the live conversation.** The bridge is a separate process from your CLI
  session and has no way to inject a real turn into it. It logs the message
  to stderr **and** appends it as JSON to a durable inbox file (default
  `$TMPDIR/mcp-apps-browser-bridge-messages.jsonl`, one JSON object per
  line) instead of silently dropping it or faking success — see
  `handleAppMessage` in `src/ui-server.ts`. If you need this to actually
  reach the agent, tail that file or watch the bridge's stderr and paste it
  in yourself for now.
- **No response caching / offline replay** — every browser session hits the
  real backend live; there's no way to reopen an old session's exact view
  after the process restarts.

## Using this as a blueprint for a new MCP-UI skill

Nothing here is Docker-specific — the passthrough works with any target
server's command line. To reuse this for a different MCP-UI project:

1. Copy `browser-bridge/` as-is; it has no dependency on anything else in
   this repo (double-check by grepping for `../mcp-server` — only
   `test/smoke.ts` references it, and only as its *test target*, not a
   runtime dependency).
2. Point it at your new server: `node dist/cli.js -- <your server's command>`.
   No code changes needed if your server follows the standard MCP Apps
   convention (`_meta.ui.resourceUri` on the tool definition, a matching
   `ui://` resource with `text/html;profile=mcp-app`).
3. `src/config.ts` is where to add project-specific flags.
4. `src/passthrough.ts`'s `switch` is the complete list of MCP methods this
   forwards — extend it if your server uses something beyond the standard
   set (e.g. `resources/subscribe`, `logging/setLevel`).
5. `test/smoke.ts` is written to be adapted: swap `TARGET_SERVER` and the
   tool name/arguments under test for your own server's UI-enabled tool.

## Testing this yourself

```bash
cd browser-bridge
npm install
npm run smoke    # builds, then runs test/smoke.ts against ../mcp-server
```

`smoke` covers: `--help`/`--version` exit codes, a missing `--` being
rejected cleanly, a nonexistent target command failing fast instead of
hanging, the full passthrough (`tools/list` count, a UI-enabled
`tools/call` getting its link appended), the session page actually
rendering with the bootstrap payload substituted in, both HTTP endpoints'
auth gates (missing/wrong token → 403), and an unknown session id → 404.

What it does **not** cover (verified manually instead, see the QA report):
actual browser rendering and the live `tools/call` round trip from inside
the iframe — that needs a real browser (Playwright was used for this
during development; there's no reason not to wire it into `test/` too if
you're extending this and want that automated).
