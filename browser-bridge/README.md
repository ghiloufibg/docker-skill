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
convention.

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
`completion/complete`) to the wrapped command. The **only** logic it adds:
after a `tools/call` result comes back from a tool whose definition carries
`_meta.ui.resourceUri`, it appends one text block naming a browser link
before relaying the result upstream — the underlying data the model reasons
over is unchanged. If a tool has no UI resource, the bridge is a no-op
passthrough.

Two independent instances of the target server are spawned (one servicing
the CLI-facing side, one the browser-facing side) rather than multiplexing
one child's stdio pipe. That's simpler and avoids JSON-RPC id collisions,
at the cost of assuming your target server keeps no meaningful in-process
state of its own (state should live in whatever external system the tools
actually talk to — true of this repo's own server, whose only state is the
real Docker daemon).

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

- `--no-open` — print the link instead of auto-launching a browser tab.
- `--port <n>` — fixed loopback port instead of an OS-assigned one.

## Security

- The local HTTP server binds `127.0.0.1` only, never `0.0.0.0`.
- Every request (page load and the browser's own `/mcp` connection) requires
  a random, per-process token, checked via `?token=` or `Authorization:
  Bearer`.
- `localhostHostValidation()` (from `@modelcontextprotocol/node`) rejects
  requests with a mismatched `Host` header — DNS-rebinding protection, not
  just a token check.
- The View renders in an iframe with `sandbox="allow-scripts allow-forms"`
  and no `allow-same-origin` — an opaque, unique origin with no access to
  the wrapper page's or bridge's own cookies, storage, or DOM, matching the
  MCP Apps spec's security model.

## Known gaps (v1, deliberate)

- **`ui/message` (the "Investigate"-button mechanism) is not delivered into
  the live conversation.** The bridge is a separate process from your CLI
  session and has no way to inject a real turn into it. It logs the
  message loudly to the bridge's own stderr instead of silently dropping it
  or faking success. If you need this to actually reach the agent, watch
  the bridge's terminal output and paste it in yourself for now.
- **Single-iframe sandbox, not the spec's double-iframe sandbox-proxy
  pattern.** The official docs describe an extra neutral "sandbox proxy"
  frame for stronger isolation of untrusted server-authored HTML; this
  bridge sets `srcdoc` on one sandboxed iframe directly. `sandbox`'s
  `allow-scripts` (without `allow-same-origin`) already prevents same-origin
  access, cookie/storage access, and top-level navigation, so this is a
  simplification, not an open hole — but it's a real gap from the spec's
  recommended posture, worth closing in a v2.
- **No `--allow` support for `ui.permissions`** (microphone/camera/etc.) —
  the iframe's `allow` attribute isn't built from
  `buildAllowAttribute(permissions)` yet, so a resource that requests a
  permission won't get it.
- **The Stage-5 live-streaming sidecar** (this repo's own loopback SSE
  server for Docker logs/stats) isn't specifically exercised — two
  independent server instances each try to start it lazily on the same
  fixed port if you toggle "Live" from both the browser and (hypothetically)
  another client; the second one will just fail to bind and log an error,
  it won't crash anything, but Live streaming from the bridged browser tab
  hasn't been verified.

## Testing this yourself

There's no test suite yet — verify it end-to-end the same way this was
built and checked:

```bash
# from browser-bridge/, after npm run build
node -e '
import("@modelcontextprotocol/client").then(async ({Client}) => {
  const {StdioClientTransport} = await import("@modelcontextprotocol/client/stdio");
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["dist/cli.js", "--no-open", "--", "node", "../mcp-server/dist/index.js"],
  });
  const client = new Client({name: "probe", version: "0.1.0"});
  await client.connect(transport);
  const result = await client.callTool({name: "docker-ps", arguments: {}});
  console.log(result.content.find(c => c.type === "text" && c.text.includes("http://")).text);
});
'
```

Then open the printed link — you should see a real, populated Docker
dashboard, not raw JSON.
