---
name: docker-skill-system-card
description: MCP-UI/Docker Ops experiment in this repo, Stages 0-5 plus advanced features, a fourth round of functional/UI-UX additions, and a fifth round rewriting the UI in React + Tailwind + shadcn/ui (the full staged plan). Shows a read-only local system card and a Docker fleet dashboard (list/inspect/logs/stats with optional live streaming, health status and resource limits, search/filter/sort, compose-project grouping with project-level teardown, multi-select bulk actions, toast notifications, plus tier-gated start/restart/pause/unpause/stop/kill/remove) as interactive MCP Apps, each with an "Investigate" button that hands root-cause analysis to the agent and has the agent report back via a structured investigation-report resource whose remediation suggestions can be gated one-click actions. Use when asked to test whether the current host renders MCP Apps UI resources, to check or manage local Docker containers through this repo's MCP server, or to continue the docker-skill design-to-implementation work described in docs/design/mcp-ui-docker-ops.md.
---

# docker-skill: MCP-UI spike, Stages 0-5 + advanced features + rounds 4-5 (complete)

`docs/design/mcp-ui-docker-ops.md` §11 laid out five stages, all five —
plumbing spike, read-only dashboard, logs/stats, investigation report,
gated mutating actions, and the optional Stage 5 streaming sidecar — are
now implemented and verified, along with everything the design doc
originally deferred as "not a numbered stage": a compose project view
and real remediation-action buttons in the investigation report. Read
the design doc for the full architecture, risk tiers, and staged plan —
this file only covers how to run and use what's implemented.

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
`@modelcontextprotocol/server`. The MCP protocol itself is stdio-only
(no HTTP/network — see design doc §1); the one exception is the optional
Stage 5 streaming sidecar (`docker/stream/sidecar.ts`), a loopback-only
(127.0.0.1) SSE server started lazily only if a "Live" toggle is used —
see that file's doc comment. It exposes three UI resources:

**Stage 0 — local system card** (`system-info` model-facing, `system-poll`
app-only via `_meta.ui.visibility: ["app"]`): hostname/CPU/memory/disk/git
snapshot, manual "Refresh", and — when disk usage crosses 80% — an
"Investigate" button that calls `app.sendMessage(...)` to hand a diagnostic
prompt to the agent (design doc §7.2's "prompt" round trip).

**Stages 1/2/4/5 — Docker fleet dashboard**: a card grid of all local
containers (`docker-ps`, via `docker/tools/ps.ts`/`dockerode` against the
local socket only — see §1/§9), grouped by `com.docker.compose.project`
label where present, each group with its own "Down" button
(`docker-compose-down` — Tier 2, stops+removes every container in that
project). Click a card through to a tabbed detail panel:
- **Inspect** (`docker-inspect`) — env var **names only, never values** (§9).
- **Logs** (`docker-logs`) — tail of stdout/stderr, plus a "Live" toggle
  (Stage 5) that streams new lines via the loopback sidecar instead of
  manual refresh.
- **Stats** (`docker-stats`) — one-shot CPU/mem/net/pids as progress
  bars; its own "Live" toggle streams updates and draws a small inline
  CPU/memory sparkline once a couple of samples exist.
- **Actions** (Stage 4, `docker/tools/actions.ts`) — state-aware buttons:
  Tier 1 (`docker-start`/`restart`/`pause`/`unpause`, plain confirm dialog)
  and Tier 2 (`docker-stop`/`kill`/`rm`, must type the exact container
  name to confirm — §4/§9). Every tool carries standard MCP
  `readOnlyHint`/`destructiveHint`/`idempotentHint` annotations, the
  spec-level signal a compliant host can use for its own confirmation,
  layered on top of the UI dialog, not instead of it — see the honest
  gap noted below. A dashboard-wide `actionInFlight` guard (design doc
  §12) stops a per-container action and a project-level "Down" from
  firing concurrently against overlapping containers.

Inspect/Actions stay manual-refresh only, per §8's MVP — Logs/Stats gained
the opt-in Live alternative above. An "Investigate" button appears on any
non-`running` container, telling the agent to prefer this server's own
tools over shelling out.

**Round 4 additions** (design doc §11 item 8): client-side search/
filter/sort over the card grid (no new tool); a health-status badge and
CPU/memory resource limits in the Inspect tab (`docker-inspect`'s
`healthStatus`/`cpuLimitCores`/`memLimitBytes`); per-card checkboxes and
a bulk-action toolbar that shows only the actions valid for every
selected container, Tier 2 bulk actions confirmed by typing the
selection count rather than each name, and bulk tool calls run
sequentially, not concurrently, for the same race-avoidance reason as
the existing `actionInFlight` guard; and UI/UX polish — toast
notifications (also ported into the investigation-report widget),
loading skeletons for the card list and the detail panel (the latter
now populated optimistically with the clicked container's already-known
name instead of showing the previous container's stale data), a
spinning refresh icon, and a `"/"`-to-focus-search shortcut.

**Round 5 (design doc §11 item 9): all three UI resources rewritten in
React + Tailwind CSS v4 + shadcn/ui (Radix primitives), on request.**
Every feature above still works exactly as described — this was a
view-layer rewrite, not a feature or protocol change, verified with a
full Playwright pass against a real Docker daemon after the rewrite
with zero regressions found. The MCP Apps SDK registration
(`App`/`ontoolresult`/`onhostcontextchanged`) now lives in a small
`mcp.ts` per widget (`src/{dashboard,system-card,report}/mcp.ts`),
still at **module scope**, not inside a React effect — see the design
doc §11 item 9 and the guide's new §21 for why that distinction matters
in a framework port specifically. The tier-gated confirm dialog is now
built on Radix `AlertDialog` (`src/dashboard/ConfirmDialog.tsx`),
shared as source between the dashboard and the report widget, which
gets the focus-trap/Escape-to-cancel behavior §12/§16 of the guide
describe hand-rolling for free from a maintained primitive — the one
deliberate override is initial focus landing on Cancel, not Radix's own
default, per that same security-relevant rule. Cost: each resource is
now roughly 2.2-2.6× its previous size (measured in design doc §6.1's
update table) — accepted deliberately, not accidental bloat.

**Stage 3 — investigation report** (`build-investigation-report`,
model-facing): both "Investigate" prompts end by telling the agent to
call this tool with what it actually found — `subject`, `summary`,
`rootCause`, a `timeline`, `evidence` excerpts tagged by source, and
`suggestedRemediations` — instead of just answering in chat. The tool
gathers nothing itself; it only renders the agent's own findings as
`investigation-report.html`. Each remediation item is `{ description,
action? }`: plain text by default, or — for the container-lifecycle
prompt specifically — a structured `action: { tool, id }` drawn from a
fixed server-side enum (the same seven Tier 1/2 container tools the
dashboard's Actions tab offers), rendered as a "Run" button. See the
next point for the gate that button goes through before it does
anything.

## A known, deliberate gap — read this before extending Stage 4

The Tier 2 type-to-confirm dialog is enforced by the dashboard's (and
now the report's) own JavaScript, running inside the sandboxed iframe. A
compromised or buggy resource could in principle skip straight to
calling `app.callServerTool({ name: "docker-rm", ... })` without ever
showing the dialog. The real backstop is the **host's own MCP permission
prompt** on the tool call — that's why the design doc calls this
"defense in depth," not "the UI confirm is sufficient" on its own.

**Update — elicitation is now verified working, not just "no example
found."** A round-2 experiment tested `inputRequired`/`inputRequired.elicit()`
directly against `@modelcontextprotocol/server` + `@modelcontextprotocol/client`
2.0.0 (still the latest published version — checked): a client that
declares `elicitation: {}` and registers an `elicitation/create` handler
gets the full multi-round-trip flow working end-to-end, no manual retry
code needed — the SDK's own `client.callTool()` handles it transparently.
A client that doesn't declare the capability gets a clean `isError: true`
refusal with a specific message, exactly as before. So the mechanism
itself is confirmed, not hypothetical. What's *still* unconfirmed is any
real host implementing the client side — `basic-host` (this project's
only available reference host) still doesn't declare `elicitation`, so
there's nothing to render this dashboard's confirm dialogs through
natively yet. That's why remediation buttons and the dashboard's own
Tier 1/2 confirms still route through the UI-side dialog, not
elicitation — the moment a real host declares the capability, that's
the next thing to wire up, and it's now a known-working target, not a
guess. If you pick this up: read the design doc §9/§11 item 4 status
note in full first, and the round-2 write-up in §12 for the exact test.

Remediation buttons compound the iframe-vs-host question slightly
differently: an agent-authored report can *suggest* a `tool`+`id` pair,
restricted to a fixed enum server-side (no arbitrary tool names, no
compose-project-wide actions) — but it still can't invoke anything
itself. The human has to read the same confirm dialog and click through
it, same as a dashboard button. That boundary is enforced by the schema
(`server.ts`'s `RemediationActionSchema`), not by trusting the agent's
own judgment about what's safe to suggest.

## Running it

```bash
cd mcp-server
npm install
npm run build        # tsc type-check, Vite bundle of all three widgets, tsc build of the server
npm run smoke         # headless verification via the real MCP stdio protocol — no host UI needed
```

`npm run smoke` spawns the built server, lists all sixteen tools, calls
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
- **"Continue to Stage 5"** — done. `docker/stream/sidecar.ts` is a
  loopback-only (127.0.0.1) SSE server, started lazily on first use, that
  the dashboard's Logs/Stats "Live" toggles connect to directly (a
  browser can't reach a Unix socket, so this had to be TCP — see that
  file's doc comment for the token-auth mitigation and its known
  same-machine-multi-instance gap). Verified surviving a container
  restart mid-stream — the underlying `docker logs -f`/`stats` connection
  goes quiet on restart without ever emitting 'end', so this polls
  `State.StartedAt` and reconnects; the first version of that reconnect
  logic still lost the restart's own log line, found only by scripting
  two restarts in a row, not one.
- **"Add a compose project view"** — done. Cards group by
  `com.docker.compose.project` label with a project-level "Down" button
  (`docker-compose-down` — stops+removes every container in the project
  via dockerode, deliberately not the compose CLI; see
  `docker/tools/actions.ts`'s `stopComposeProject` for why).
- **"Make remediation suggestions clickable"** — done, within the scope
  "A known, deliberate gap" above describes: a fixed server-side enum
  (`RemediationActionSchema` in `server.ts`) plus the same UI confirm
  dialog as the dashboard, not elicitation (still nothing to route it
  through — see that section for the round-2 finding on elicitation
  itself).
- **An "Investigate" prompt arrives as a new user turn** (e.g. "Disk usage
  on / looks high..." or "Container X is not running (exit code 137)...")
  — that's one of this skill's two UIs calling `app.sendMessage`, not a
  request from the repo owner directly. If this MCP server is registered
  in your session, prefer its own `docker-logs`/`docker-inspect`/
  `docker-stats` tools over shelling out; otherwise fall back to Bash
  (all local — see design doc §1). Then **call
  `build-investigation-report`** with what you actually found — don't
  just answer in chat — and don't call any mutating `docker-*` tool
  yourself. For the container-lifecycle prompt, a suggestion that maps to
  one of this server's own container actions can include a structured
  `action` (tool + this container's id) so the report offers it as a
  button — but that button still requires a human to confirm it; it is
  not you taking the action.
- **Testing Stages 1/2/4 needs actual containers**, and `docker-stats`
  specifically needs at least one *running* one. If none exist and you
  have no registry egress (check `/root/.ccr/README.md` if `docker pull`
  fails with 403), build minimal local test images instead of trying to
  route around the restriction: a tiny static Go/Rust binary in a `FROM
  scratch` image works fine and needs no network at all. That's how this
  was verified originally, and it's also what `test/smoke.ts` relies on
  for the Stage 4 lifecycle checks (`local/sleeper:test`).
