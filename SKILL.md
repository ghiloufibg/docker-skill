---
name: docker-skill-system-card
description: MCP-UI/Docker Ops experiment in this repo, Stages 0-2. Shows a read-only local system card (hostname, CPU, memory, disk usage, git status) and a read-only Docker fleet dashboard (list/inspect/logs/stats) as interactive MCP Apps, each with an "Investigate" button that hands root-cause analysis to the agent. Use when asked to test whether the current host renders MCP Apps UI resources, to check local disk/memory/git/Docker status through this repo's MCP server, or to continue the docker-skill design-to-implementation work described in docs/design/mcp-ui-docker-ops.md.
---

# docker-skill: MCP-UI spike, Stages 0-2

This is **not** the full Docker Ops dashboard yet — mutating actions
(start/stop/rm) and the investigation-report resource are still ahead
(design doc §11 items 3-4). What's here: the Stage-0 plumbing spike
(`docs/design/mcp-ui-docker-ops.md` §13 — a zero-Docker, zero-network
local system card validating the MCP-UI/MCP Apps mechanism itself),
Stage 1 (§11 item 1 — real read-only `docker-ps`/`docker-inspect` against
the local Docker socket), and Stage 2 (§11 item 2 — `docker-logs`/
`docker-stats`, surfaced as Logs/Stats tabs in the same detail panel).
Read the design doc for the full architecture, risk tiers, and staged
plan — this file only covers how to run and use what's implemented so far.

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

**Stage 1/2 — Docker fleet dashboard** (`docker-ps`, `docker-inspect`,
`docker-logs`, `docker-stats` — all model-facing, all Tier 0 read-only per
§4): a card grid of all local containers (`docker/tools/ps.ts`, via
`dockerode` against the local socket only — see §1/§9), click-through to a
tabbed detail panel — **Inspect** (`docker/tools/inspect.ts`), **Logs**
(`docker/tools/logs.ts`, tail of stdout/stderr), **Stats**
(`docker/tools/stats.ts`, one-shot CPU/mem/net/pids as progress bars,
reusing Stage 0's bar styling) — manual "Refresh" everywhere, and an
"Investigate" button on any non-`running` container that now tells the
agent to prefer this server's own `docker-logs`/`docker-inspect` tools
over shelling out. `docker-inspect` returns env var **names only, never
values** — see §9 for why. No start/stop/rm/exec here yet — that's §11
item 4, deliberately gated separately.

## Running it

```bash
cd mcp-server
npm install
npm run build        # tsc type-check, Vite bundle of the widget, tsc build of the server
npm run smoke         # headless verification via the real MCP stdio protocol — no host UI needed
```

`npm run smoke` spawns the built server, lists all six tools, calls them
(the Docker ones against whatever Docker daemon is actually reachable —
it skips those checks gracefully if none is, and `docker-stats` needs at
least one *running* container since Docker's stats endpoint doesn't work
on stopped ones), and reads both `ui://` resources back, asserting their
mimeType is exactly `text/html;profile=mcp-app`. This is the part
verifiable without any graphical host, and it passes as of this writing.
Note: if you're testing this somewhere with no local containers, `docker
run` something first or the dashboard will just render empty — that's
expected, not a bug.

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
- **"Continue to Stage 3"** (design doc §11 item 3) — the investigation-report
  resource: today "Investigate" just sends a plain-text prompt and the
  agent's answer lands as an ordinary chat reply; Stage 3 is about the
  agent coming back with a *structured resource* (timeline, log excerpts,
  root cause, suggested remediation buttons) instead. Reuse this
  project's structure (`server.ts` tool registration pattern,
  `docker/tools/*.ts` for data gathering, `src/*.ts`/`.css` vanilla-JS
  widget pattern, one Vite `INPUT` per HTML entrypoint) rather than
  starting over.
- **"Add mutating actions"** (§11 item 4) — this is explicitly *not* next
  in the plan; §11 item 3 (investigation-report) comes first. If asked
  anyway: read §4's risk tiers and §9's confirm requirements before
  writing a single `docker.stop`/`docker.rm` tool — those need both a
  UI-side confirm and to stay off by default.
- **An "Investigate" prompt arrives as a new user turn** (e.g. "Disk usage
  on / looks high..." or "Container X is not running (exit code 137)...")
  — that's one of this skill's two UIs calling `app.sendMessage`, not a
  request from the repo owner directly. If this MCP server is registered
  in your session, prefer its own `docker-logs`/`docker-inspect`/
  `docker-stats` tools over shelling out (the Docker-dashboard prompt
  says this explicitly); otherwise fall back to Bash (`du`, `df`,
  `git log`, `docker logs`, `docker inspect`, etc., all local — see
  design doc §1). Actually investigate and report findings plainly;
  don't just acknowledge the button click.
- **Testing Stages 1-2 needs actual containers**, and `docker-stats`
  specifically needs at least one *running* one. If none exist and you
  have no registry egress (check `/root/.ccr/README.md` if `docker pull`
  fails with 403), build minimal local test images instead of trying to
  route around the restriction: a tiny static Go/Rust binary in a `FROM
  scratch` image works fine and needs no network at all. That's how this
  was verified originally — a long-running one for `docker-stats`/state
  `running`, and one that exits non-zero for `docker-logs`/investigate.
