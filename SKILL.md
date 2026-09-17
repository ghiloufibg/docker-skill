---
name: docker-skill-system-card
description: Stage-0 spike for the MCP-UI/Docker Ops experiment in this repo. Shows a read-only local system card (hostname, CPU, memory, disk usage, git status) as an interactive MCP App, with an "Investigate" button that hands disk-usage root-cause analysis to the agent. Use when asked to test whether the current host renders MCP Apps UI resources, to check local disk/memory/git status through this repo's MCP server, or to continue the docker-skill design-to-implementation work described in docs/design/mcp-ui-docker-ops.md.
---

# docker-skill: Stage-0 MCP-UI spike

This is **not** the Docker Ops dashboard yet. It's the Stage-0 spike from
`docs/design/mcp-ui-docker-ops.md` §13: a zero-Docker, zero-network local
system card, built to validate the MCP-UI/MCP Apps plumbing (does the host
render `ui://` resources, does the `tool`/`prompt` round trip work) before
any Docker-specific code is written. Read that design doc for the full
architecture, risk tiers, and staged plan — this file only covers how to
run and use what's implemented so far.

## What's implemented

`mcp-server/` is a real MCP server built with the official
`@modelcontextprotocol/ext-apps` SDK (the MCP Apps spec extension) and
`@modelcontextprotocol/server`, stdio transport only (no HTTP/network — see
design doc §1). It exposes:

- **`system-info`** (model-facing, Tier 0 read-only): one-shot snapshot of
  hostname/CPU/memory/disk/git status. Its result renders the `mcp-app.html`
  UI resource (`ui://system-card/mcp-app.html`).
- **`system-poll`** (app-only, `_meta.ui.visibility: ["app"]` — never
  offered to the model): re-samples disk/memory/uptime. Called by the UI's
  "Refresh" button only, per design doc §8's manual-refresh MVP.

The UI (`mcp-server/src/mcp-app.ts` + `.css`, bundled by Vite into a single
inlined `mcp-app.html`) shows the snapshot, a disk/memory bar, git branch
status, and — when disk usage crosses 80% — an "Investigate" button that
calls `app.sendMessage(...)` to hand a diagnostic prompt to the agent
(design doc §7.2's "prompt" round trip).

## Running it

```bash
cd mcp-server
npm install
npm run build        # tsc type-check, Vite bundle of the widget, tsc build of the server
npm run smoke         # headless verification via the real MCP stdio protocol — no host UI needed
```

`npm run smoke` spawns the built server, lists tools, calls both, and reads
the `ui://` resource back, asserting its mimeType is exactly
`text/html;profile=mcp-app`. This is the part verifiable without any
graphical host, and it passes as of this writing.

To register it with an MCP client that supports stdio (add to that
client's MCP config):

```json
{
  "mcpServers": {
    "docker-skill-system-card": {
      "command": "node",
      "args": ["<absolute path to>/mcp-server/dist/index.js"]
    }
  }
}
```

## The one thing this hasn't proven yet

Whether the *rendering* actually happens is unverified — `docs/design/
mcp-ui-docker-ops.md` §12 flags that public reporting places MCP Apps
rendering as live in Claude Desktop/claude.ai/Cowork/VS Code Copilot but
**not confirmed for the Claude Code CLI** as of Sept 2026. If you're
picking this work back up: re-check `code.claude.com/docs/en/changelog`
first, then register the server above in whichever host is confirmed to
support it and open the `system-info` tool to see if the card renders.

## If asked to continue this work

- **"Does the UI render?"** — register the server (above) in a host known
  to support MCP Apps, call `system-info`, and report what you see (or
  don't).
- **"Continue to Stage 1"** (design doc §11) — read §13/§1 first: the next
  stage adds real `docker.ps`/`docker.inspect` tools reading the local
  Docker socket, still read-only, still no network. Reuse this project's
  structure (`server.ts` tool registration pattern, `mcp-app.ts`/`.css`
  vanilla-JS widget pattern) rather than starting over.
- **An "Investigate" prompt arrives as a new user turn** (e.g. "Disk usage
  on / looks high. Investigate what's consuming space...") — that's this
  skill's UI calling `app.sendMessage`, not a request from the repo owner
  directly. Use Bash (`du`, `df`, `git log`, etc., all local — see design
  doc §1) to actually investigate, and report findings plainly; don't just
  acknowledge the button click.
