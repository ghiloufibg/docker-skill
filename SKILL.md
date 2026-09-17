---
name: docker-skill-system-card
description: MCP-UI/Docker Ops experiment in this repo, Stages 0-1. Shows a read-only local system card (hostname, CPU, memory, disk usage, git status) and a read-only Docker fleet dashboard (docker-ps/docker-inspect) as interactive MCP Apps, each with an "Investigate" button that hands root-cause analysis to the agent. Use when asked to test whether the current host renders MCP Apps UI resources, to check local disk/memory/git/Docker status through this repo's MCP server, or to continue the docker-skill design-to-implementation work described in docs/design/mcp-ui-docker-ops.md.
---

# docker-skill: MCP-UI spike, Stages 0-1

This is **not** the full Docker Ops dashboard yet — mutating actions
(start/stop/rm), logs/stats views, and the investigation-report resource
are still ahead (design doc §11 items 2-4). What's here: the Stage-0
plumbing spike (`docs/design/mcp-ui-docker-ops.md` §13 — a zero-Docker,
zero-network local system card validating the MCP-UI/MCP Apps mechanism
itself) and Stage 1 (§11 item 1 — real read-only `docker-ps`/`docker-inspect`
tools against the local Docker socket). Read the design doc for the full
architecture, risk tiers, and staged plan — this file only covers how to
run and use what's implemented so far.

## What's implemented

`mcp-server/` is a real MCP server built with the official
`@modelcontextprotocol/ext-apps` SDK (the MCP Apps spec extension) and
`@modelcontextprotocol/server`, stdio transport only (no HTTP/network — see
design doc §1). It exposes two UI resources:

**Stage 0 — local system card** (`system-info` model-facing, `system-poll`
app-only via `_meta.ui.visibility: ["app"]`): hostname/CPU/memory/disk/git
snapshot, manual "Refresh", and — when disk usage crosses 80% — an
"Investigate" button that calls `app.sendMessage(...)` to hand a diagnostic
prompt to the agent (design doc §7.2's "prompt" round trip).

**Stage 1 — Docker fleet dashboard** (`docker-ps` model-facing, `docker-inspect`
model-facing with an `id` argument): a card grid of all local containers
(`mcp-server/docker/tools/ps.ts`, via `dockerode` against the local socket
only — see design doc §1/§9), click-through to a detail panel
(`docker/tools/inspect.ts`), manual "Refresh", and an "Investigate" button
on any non-`running` container. `docker-inspect` returns env var **names
only, never values** — see design doc §9 for why. Both tools are Tier 0
(read-only, pre-approved per §4) — no start/stop/rm/exec here yet, that's
§11 item 4, deliberately gated separately.

## Running it

```bash
cd mcp-server
npm install
npm run build        # tsc type-check, Vite bundle of the widget, tsc build of the server
npm run smoke         # headless verification via the real MCP stdio protocol — no host UI needed
```

`npm run smoke` spawns the built server, lists all four tools, calls them
(including `docker-ps`/`docker-inspect` against whatever Docker daemon is
actually reachable — it skips those checks gracefully if none is), and
reads both `ui://` resources back, asserting their mimeType is exactly
`text/html;profile=mcp-app`. This is the part verifiable without any
graphical host, and it passes as of this writing. Note: if you're testing
Stage 1 somewhere with no local containers, `docker run` something first
or the dashboard will just render empty — that's expected, not a bug.

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
support it and open `system-info` or `docker-ps` to see if the card
renders.

## If asked to continue this work

- **"Does the UI render?"** — register the server (above) in a host known
  to support MCP Apps, call `system-info` or `docker-ps`, and report what
  you see (or don't).
- **"Continue to Stage 2"** (design doc §11 item 2) — logs + stats views,
  still read-only. Reuse this project's structure (`server.ts` tool
  registration pattern, `docker/tools/*.ts` for data gathering,
  `src/*.ts`/`.css` vanilla-JS widget pattern, one Vite `INPUT` per
  HTML entrypoint) rather than starting over. Stats charts should be
  hand-rolled inline SVG per §6.1, not a charting library.
- **"Add mutating actions"** (§11 item 4) — this is explicitly *not* next
  in the plan; §11 items 2-3 (logs/stats, investigation-report) come
  first. If asked anyway: read §4's risk tiers and §9's confirm
  requirements before writing a single `docker.stop`/`docker.rm` tool —
  those need both a UI-side confirm and to stay off by default.
- **An "Investigate" prompt arrives as a new user turn** (e.g. "Disk usage
  on / looks high..." or "Container X is not running (exit code 137)...")
  — that's one of this skill's two UIs calling `app.sendMessage`, not a
  request from the repo owner directly. Use Bash (`du`, `df`, `git log`,
  `docker logs`, `docker inspect`, etc., all local — see design doc §1)
  to actually investigate, and report findings plainly; don't just
  acknowledge the button click.
- **Testing Stage 1 needs actual containers.** If none exist and you have
  no registry egress (check `/root/.ccr/README.md` if `docker pull`
  fails with 403), build minimal local test images instead of trying to
  route around the restriction: a tiny static Go/Rust binary in a `FROM
  scratch` image works fine and needs no network at all. That's how this
  was verified originally.
