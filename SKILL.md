---
name: docker-skill-system-card
description: MCP-UI/Docker Ops experiment in this repo, Stages 0-4 (the core staged plan). Shows a read-only local system card and a Docker fleet dashboard (list/inspect/logs/stats, plus tier-gated start/restart/pause/unpause/stop/kill/remove) as interactive MCP Apps, each with an "Investigate" button that hands root-cause analysis to the agent and has the agent report back via a structured investigation-report resource. Use when asked to test whether the current host renders MCP Apps UI resources, to check or manage local Docker containers through this repo's MCP server, or to continue the docker-skill design-to-implementation work described in docs/design/mcp-ui-docker-ops.md.
---

# docker-skill: MCP-UI spike, Stages 0-4 (core plan complete)

`docs/design/mcp-ui-docker-ops.md` §11 laid out five stages; the first
four — plumbing spike, read-only dashboard, logs/stats, investigation
report, gated mutating actions — are all implemented and verified. Only
item 5 (optional sidecar streaming for true live logs/stats) and things
the design doc explicitly deferred (a compose project view, real
remediation-action buttons in the investigation report) remain. Read the
design doc for the full architecture, risk tiers, and staged plan — this
file only covers how to run and use what's implemented.

Everything this project's build-and-break-it process learned that isn't
Docker-specific — kit choice, tool/risk design, the `hidden`/theme CSS
traps, `isError` handling, CSP, payload size, how to actually test
rendering — is distilled into
[`docs/guides/building-mcp-ui-servers.md`](docs/guides/building-mcp-ui-servers.md).
Read that first if the task is "build a different MCP-UI server," not
"continue this one."

## What's implemented

`mcp-server/` is a real MCP server built with the official
`@modelcontextprotocol/ext-apps` SDK (the MCP Apps spec extension) and
`@modelcontextprotocol/server`, stdio transport only (no HTTP/network — see
design doc §1). It exposes three UI resources:

**Stage 0 — local system card** (`system-info` model-facing, `system-poll`
app-only via `_meta.ui.visibility: ["app"]`): hostname/CPU/memory/disk/git
snapshot, manual "Refresh", and — when disk usage crosses 80% — an
"Investigate" button that calls `app.sendMessage(...)` to hand a diagnostic
prompt to the agent (design doc §7.2's "prompt" round trip).

**Stages 1/2/4 — Docker fleet dashboard**: a card grid of all local
containers (`docker-ps`, via `docker/tools/ps.ts`/`dockerode` against the
local socket only — see §1/§9), click-through to a tabbed detail panel:
- **Inspect** (`docker-inspect`) — env var **names only, never values** (§9).
- **Logs** (`docker-logs`) — tail of stdout/stderr.
- **Stats** (`docker-stats`) — one-shot CPU/mem/net/pids as progress bars.
- **Actions** (Stage 4, `docker/tools/actions.ts`) — state-aware buttons:
  Tier 1 (`docker-start`/`restart`/`pause`/`unpause`, plain confirm dialog)
  and Tier 2 (`docker-stop`/`kill`/`rm`, must type the exact container
  name to confirm — §4/§9). Every tool carries standard MCP
  `readOnlyHint`/`destructiveHint`/`idempotentHint` annotations, the
  spec-level signal a compliant host can use for its own confirmation,
  layered on top of the UI dialog, not instead of it — see the honest
  gap noted below.

All tabs manual-refresh only, per §8's MVP. An "Investigate" button
appears on any non-`running` container, telling the agent to prefer this
server's own tools over shelling out.

**Stage 3 — investigation report** (`build-investigation-report`,
model-facing): both "Investigate" prompts end by telling the agent to
call this tool with what it actually found — `subject`, `summary`,
`rootCause`, a `timeline`, `evidence` excerpts tagged by source, and
`suggestedRemediations` — instead of just answering in chat. The tool
gathers nothing itself; it only renders the agent's own findings as
`investigation-report.html`. `suggestedRemediations` is plain text, not
action buttons, and both prompts explicitly tell the agent not to take
any action on its own — see the next point for why real buttons aren't
wired even now that Tier 1/2 tools exist.

## A known, deliberate gap — read this before extending Stage 4

The Tier 2 type-to-confirm dialog is enforced by the dashboard's own
JavaScript, running inside the sandboxed iframe. A compromised or buggy
resource could in principle skip straight to calling
`app.callServerTool({ name: "docker-rm", ... })` without ever showing the
dialog. The real backstop is the **host's own MCP permission prompt** on
the tool call — that's why the design doc calls this "defense in depth,"
not "the UI confirm is sufficient" on its own.

A more rigorous option exists: MCP's elicitation capability
(`inputRequired.elicit()` in `@modelcontextprotocol/server`) routes
confirmation through the **host's own native UI** instead of the iframe,
which a compromised resource can't bypass by construction. It wasn't
used here because at implementation time no verified usage example was
found to check the pattern against, and guessing at a security-relevant
mechanism seemed worse than being explicit about the current design.
This is also why `suggestedRemediations` in the investigation report is
still plain text, not clickable buttons, even though the tools they'd
call now exist — wiring real one-click remediation into a report the
*agent* fills in compounds this same risk (an agent-authored report
triggering a Tier 2 action on click is a bigger attack surface than a
human-clicked dashboard button). If you pick this up: read the design
doc §9/§11 item 4 status note in full first.

## Running it

```bash
cd mcp-server
npm install
npm run build        # tsc type-check, Vite bundle of all three widgets, tsc build of the server
npm run smoke         # headless verification via the real MCP stdio protocol — no host UI needed
```

`npm run smoke` spawns the built server, lists all fourteen tools, calls
them (the Docker ones against whatever's actually reachable — read-only
checks skip gracefully if no daemon or no running container exists;
`build-investigation-report` needs no Docker at all), and for Stage 4
specifically **creates a disposable container, drives it through
pause→unpause→restart→kill→start→stop→rm via the real tools, confirms
each state transition, confirms it's actually gone afterward, and cleans
up** — not a dry run. It also reads all three `ui://` resources back,
asserting their mimeType is exactly `text/html;profile=mcp-app`. This is
the part verifiable without any graphical host, and it passes as of this
writing. Note: if you're testing this somewhere with no local containers,
`docker run` something first or the dashboard will just render empty —
that's expected, not a bug.

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

## Rendering: proven for the mechanism, still open for Claude Code CLI

**Update:** the rendering question is no longer fully open. All three UI
resources were verified end-to-end against `modelcontextprotocol/ext-apps`'s
own reference host (`examples/basic-host`), driven headlessly with
Playwright — tool calls, resource rendering, tab switching, state-aware
Tier 1/2 buttons, and the type-to-confirm dialog all genuinely work. A
follow-up pass then clicked through *everything* as a real user would —
Logs/Stats on both running and stopped containers, the full pause →
unpause → restart → Stop (wrong-name-disabled, then Cancel, then for
real) → Remove lifecycle on a disposable container, cross-checked
against actual `docker inspect` output at every step, and the
Investigate button's `sendMessage` — confirmed delivered, visible in
`basic-host`'s own Messages panel. Zero JS exceptions across either pass.

Three real bugs were found and fixed in total (details in design doc
§12): two were the same CSS-specificity trap — `.confirm-overlay` and
`.investigate-section` stayed visible despite `hidden` being set, because
their class also set `display` unconditionally, which beats the
browser's default `[hidden]` rule. The third was different: the Stats
tab's "unavailable" message for a stopped container rendered next to
CPU/Memory bars frozen at 0%, reading as real data rather than "we have
nothing" — fixed by hiding the data block entirely when unavailable.
If you add a new `hidden`-toggled element to any of the three widgets,
check its CSS for the first trap; if you add a new empty/error state,
check you're not showing placeholder-looking data next to it.

**What's still unconfirmed:** whether the **Claude Code CLI** specifically
renders this — `basic-host` is a reference/test implementation, not
Claude Code, so that question needs a real Claude Code session, not this
harness. If you're picking that up: re-check
`code.claude.com/docs/en/changelog` first, then register the server
(above) directly in a Claude Code session and open `system-info` or
`docker-ps` to see if it renders — and, since real mutating tools exist,
be deliberate about which environment you test Tier 2 actions against;
everything so far was verified against disposable local test containers
on purpose.

**How the basic-host check was done, if you need to repeat it:** it is
*not* part of this repo (the shipped server is stdio-only, no HTTP, per
§1 — this was a temporary exception just for the check). Clone
`modelcontextprotocol/ext-apps`, copy `examples/basic-host` to a
directory *outside* that repo (its own `npm install` fights the
monorepo's workspace/build scripts otherwise), `npm install` there, then
give this server a throwaway loopback HTTP transport (wrap
`createServer()` from `server.ts` with `NodeStreamableHTTPServerTransport`
from `@modelcontextprotocol/node`, bound to `127.0.0.1` — mirror
`main.ts` in any of the ext-apps examples) so `basic-host` has something
to connect to at `http://127.0.0.1:3001/mcp`. Delete that transport file
afterward; it must never be committed.

## If asked to continue this work

- **"Does the UI render?"** — the mechanism itself is proven (see above);
  what's still open is Claude Code CLI specifically. Register the server
  (above) directly in a Claude Code session, call `system-info` or
  `docker-ps`, and report what you actually see (or don't) — don't
  re-answer this from `basic-host`'s result, which doesn't cover the CLI.
- **"Continue to Stage 5"** (optional, design doc §11 item 5) — a
  loopback/Unix-socket-only streaming sidecar for true live logs/stats,
  per §8 phase 2. Not required; the core plan is done without it.
- **"Add a compose project view"** (§5 item 4, never scheduled as a
  numbered stage) — group containers by `com.docker.compose.project`
  label (already captured in `ContainerSummary.project`), project-level
  up/down/logs. `docker.compose.down` would be a new Tier 2 tool —
  same confirm requirements as the rest of §4.
- **"Make remediation suggestions clickable"** — read "A known,
  deliberate gap" above first. Not a small addition: it means an
  agent-authored resource triggering Tier 2 actions, which raises the
  bar on what "confirm" needs to mean.
- **An "Investigate" prompt arrives as a new user turn** (e.g. "Disk usage
  on / looks high..." or "Container X is not running (exit code 137)...")
  — that's one of this skill's two UIs calling `app.sendMessage`, not a
  request from the repo owner directly. If this MCP server is registered
  in your session, prefer its own `docker-logs`/`docker-inspect`/
  `docker-stats` tools over shelling out; otherwise fall back to Bash
  (all local — see design doc §1). Then **call
  `build-investigation-report`** with what you actually found — don't
  just answer in chat — and don't take any remediating action yourself;
  suggest only.
- **Testing Stages 1/2/4 needs actual containers**, and `docker-stats`
  specifically needs at least one *running* one. If none exist and you
  have no registry egress (check `/root/.ccr/README.md` if `docker pull`
  fails with 403), build minimal local test images instead of trying to
  route around the restriction: a tiny static Go/Rust binary in a `FROM
  scratch` image works fine and needs no network at all. That's how this
  was verified originally, and it's also what `test/smoke.ts` relies on
  for the Stage 4 lifecycle checks (`local/sleeper:test`).
