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
                       same HTTP server's /mcp endpoint, each browser tab
                       getting its OWN spawned instance of the target
                       server (see "Multi-session" below)
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

Independent instances of the target server are spawned per logical
connection (one for the CLI-facing side; one *per browser session* on the
UI-facing side — see "Multi-session" below) rather than multiplexing one
child's stdio pipe. That's simpler and avoids JSON-RPC id collisions, at
the cost of assuming your target server keeps no meaningful in-process
state of its own (state should live in whatever external system the tools
actually talk to — true of this repo's own server, whose only state is the
real Docker daemon).

### Multi-session

The `/mcp` endpoint supports any number of concurrent browser sessions —
open a dozen tabs against a dozen different tool-call links from the same
bridge process and each gets its own fully isolated backend connection.
This isn't incidental: a naive single-shared-transport implementation was
the first version, and it broke on exactly this — a second browser tab's
`initialize` request failed outright with `Invalid Request: Server already
initialized`, since one `NodeStreamableHTTPServerTransport` connected to
one passthrough server can only ever complete one MCP handshake. The fix
(`UiBridge.handleMcpRequest` in `src/ui-server.ts`) is the standard
multi-session Streamable HTTP pattern: requests carrying no (or an
unrecognized) `Mcp-Session-Id` header get a brand-new backend + passthrough
server + transport spun up for them; the transport's own
`onsessioninitialized`/`onsessionclosed` callbacks key a session map so
subsequent requests for that session route to the same transport instead
of starting a new one. Idle sessions (no explicit close, e.g. a tab just
left open) are swept after `--session-ttl` minutes, same as unopened
tool-call links.
`test/smoke.ts` has a regression test for this specifically — two real
`StreamableHTTPClientTransport` connections against the same `/mcp` URL,
both expected to complete `initialize` and list tools successfully.

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
- A `Content-Security-Policy` meta tag is injected into the widget's own
  `<head>` (`injectDefaultCsp` in `src/browser/main.ts`), denying
  `connect-src`/`frame-src` by default. The sandbox attribute alone doesn't
  stop a widget from making its own network calls or nesting further
  frames; since this bridge already carries all real data over
  `postMessage` (which CSP can't see or restrict), a widget has no
  legitimate need for either. A third-party widget that genuinely needs
  live network access (e.g. map tiles) will need this relaxed for its own
  deployment.

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
the CLI-facing backend connection, every open browser session's backend
connection and transport, and the local HTTP server itself, for the
*graceful* shutdown path (e.g. an interactive Ctrl-C) where they actually
get a chance to run — useful for the tidy log line and prompt release, not
required for correctness.

Long-running-process concerns this pass specifically addressed:

- **Session memory leak**: every UI-bearing tool call used to add an entry
  to an in-memory map that nothing ever removed. Unopened tool-call links
  now expire after `--session-ttl` minutes (default 30) and are swept every
  60s (`sweepExpiredAppSessions`); browser MCP sessions left idle that
  long (no explicit close, e.g. a tab left open) are swept the same way
  (`sweepIdleMcpSessions`), closing their transport and backend connection.
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
rendering with the bootstrap payload substituted in, two independent
`/mcp` browser sessions both completing `initialize` concurrently (the
multi-session regression test — see above), both HTTP endpoints' auth
gates (missing/wrong token → 403), and an unknown session id → 404.

What it does **not** cover (verified manually instead, see the QA report):
actual browser rendering and the live `tools/call` round trip from inside
the iframe — that needs a real browser (Playwright was used for this
during development; there's no reason not to wire it into `test/` too if
you're extending this and want that automated).

## Code quality

```bash
npm run lint   # eslint, type-aware
npm run build  # includes a real type-check of src/browser/** now — see below
```

`src/browser/main.ts` — the file most worth getting right, since it's the
actual `AppBridge`/`PostMessageTransport` wiring a fork of this project
would copy — went unchecked by `tsc` for this project's entire history:
`tsconfig.json` explicitly excludes `src/browser/**` (it has no DOM lib,
the Node-side config), and Vite/esbuild only *transpile* TypeScript during
bundling, never type-check it. `tsconfig.browser.json` (DOM + DOM.Iterable
lib, `noEmit`) closes that gap and is now a real step in `npm run build` —
a type error in the browser code fails the build, same as everywhere else
in this project, instead of only surfacing as a runtime failure in someone's
actual browser.

ESLint (`eslint.config.js`, flat config, type-aware via `typescript-eslint`)
runs against an explicit `project` array covering all three tsconfigs
(`projectService`'s auto-discovery only recognizes files literally named
`tsconfig.json` while walking up directories, which misses this project's
deliberately-split `tsconfig.browser.json`/`tsconfig.test.json` — worth
knowing if you add a fourth). First real run found and fixed genuine bugs,
not just style: two floating promises in `main.ts` (`sendToolInput`/
`sendToolResult` results were neither awaited nor `.catch()`'d — a rejection
from either would have become a silent unhandled rejection), an unsafe `any`
chain from `JSON.parse` flowing into a `Buffer.concat` argument and an
object spread in `ui-server.ts`'s `handleAppMessage`, and six now-redundant
`as never` casts in `passthrough.ts` left over from earlier, more
defensive versions of that code.
