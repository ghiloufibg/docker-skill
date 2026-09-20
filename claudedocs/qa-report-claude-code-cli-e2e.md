# QA Report: docker-skill-system-card MCP server + Skill on Claude Code CLI

**Date:** 2026-09-20
**Scope:** Real end-user install + end-to-end test of this repo's MCP server
(`docker-skill-system-card`) and its Skill (`SKILL.md`) against a live
**Claude Code CLI** session on Windows — the specific host the project's own
README/SKILL.md flag as "still unconfirmed." Both were removed again at the
end of the session (see **Cleanup**).

**Method:** built the server (`npm install && npm run build`), registered it
as a local-scope MCP server (`claude mcp add ... --scope local`) and copied
`SKILL.md` into `.claude/skills/docker-skill-system-card/SKILL.md`, then
drove it from **separate, fresh `claude -p` subprocess sessions** (not this
conversation) so tests reflect what a brand-new Claude Code CLI session
actually does, capturing raw `stream-json` transcripts. Docker Desktop
(29.6.2) was available with ~46 real containers (1 running: `gitlab`) plus a
disposable `qa-test-sleeper` (alpine) container created solely for
destructive-action testing.

---

## Findings, most severe first

### 1. CRITICAL — `system-info`/`system-poll` are broken on Windows outside Git Bash
`getDiskUsage()` (`mcp-server/server.ts:72-87`) shells out to POSIX `df -kP`
unconditionally, with no try/catch around it in the `system-info` handler
(`server.ts:310-326`) or `system-poll` (`server.ts:343-349`). On a Claude
Code CLI process launched the normal way (PowerShell/cmd, no
`Git\usr\bin` on `PATH` — confirmed via `Get-Command df` returning nothing),
spawning the built server fails with:
```
spawn df ENOENT
```
Verified directly against the real MCP client/protocol from a native
PowerShell process, not just inferred.

### 2. HIGH — even when `df` *is* found, its output doesn't parse
When `df` **is** reachable (e.g. Git Bash's coreutils on `PATH`), a live
Claude Code CLI session calling `system-info` got a different failure:
```
Output validation error: Invalid structured content for tool system-info:
disk.totalBytes: Invalid input: expected number, received NaN
```
`server.ts:76-86` parses `df`'s columns by fixed index
(`fields[1]`/`fields[3]`); MSYS/Git-Bash `df`'s output for `/` doesn't match
the assumed format closely enough, so the byte counts come back `NaN`, which
then fails the tool's own Zod `outputSchema`.

**Combined:** in every Windows execution context tested, `system-info` (and
by extension `system-poll`, which shares `getDiskUsage`) is non-functional.
This isn't a theoretical edge case — it's Stage 0, the simplest tool in the
whole project, and it's also *why* `npm run smoke` fails on Windows
(reproduced: the smoke script throws `FAIL: system-info call must not
error` at the exact same assertion).

**Suggested fix:** Node has had cross-platform `fs.statfs`/`fs.statfsSync`
since 18.15 (this repo already requires `@types/node ^22`) — replacing the
`df` shell-out in `getDiskUsage` with `fs.statfs` would fix both failure
modes at once and drop the external-process dependency entirely. Also worth
wrapping `system-info`/`system-poll` in a try/catch that degrades
gracefully (`disk: null` + a note) the way `getGitStatus` already does
(`server.ts:97-114`), instead of hard-failing the whole tool call.

### 3. HIGH — confirms the repo's open question: **Claude Code CLI does not render MCP Apps `ui://` resources**
Verified two independent ways in live sessions:
- Reading `ui://docker-dashboard/docker-dashboard.html` via
  `ReadMcpResourceTool` returned the raw ~660 KB HTML/JS bundle as a plain
  JSON-wrapped text blob (mimeType `text/html;profile=mcp-app` present as a
  string field, nothing more), persisted to a side file for size — no
  rendering, iframe, or webview of any kind.
- Calling `docker-ps`/`docker-inspect`/`docker-logs`/`docker-stats` never
  triggered any resource fetch; the model only ever saw the tool's
  `structuredContent` as JSON text. The model itself correctly recognized
  this mid-session, unprompted: *"this tool also returns an interactive
  HTML dashboard (`ui://` resource) if your host renders MCP-UI Apps — this
  CLI session shows the raw data instead."*

This directly answers SKILL.md/README's "still open" question: **on Claude
Code CLI specifically, none of the three MCP-UI resources (system card,
Docker dashboard, investigation report) render as interactive UI today.**
They degrade to plain JSON/text tool output. Not a bug in this server —
it's a host capability gap — but it means the project's central premise
(rich dashboards, in-widget confirm dialogs, live streaming) is currently
inert on this specific, and presumably common, host.

### 4. MEDIUM — security-relevant: Tier 2 confirm gate is empirically a no-op on this host
Direct, empirical confirmation of the "known, deliberate gap" the repo
already documents in SKILL.md — now proven, not just theorized, for Claude
Code CLI. Because the widget's JS never executes here (finding #3), the
Tier 2 "type the exact container name" client-side safety gate never runs
at all. A scoped lifecycle test drove the disposable `qa-test-sleeper`
container through pause → unpause → restart → stop → start → kill → rm; all
seven calls, **including the three Tier-2 destructive ones**, succeeded as
single ordinary tool calls with zero re-confirmation step — the only gate
was Claude Code's own generic per-tool permission prompt, which this test
deliberately bypassed (`--permission-mode bypassPermissions`) to observe
tool-level behavior. In default interactive use a real user would still see
Claude Code's own approve/deny prompt per call, but never the project's
intended "type the container name" re-check — on this host that protection
is fully absent, not just weaker. Worth calling out explicitly in
SKILL.md's gap section as *confirmed*, not just possible, for this host.

### 5. Positive — Skill auto-activates correctly
A natural request with no tool/skill named explicitly ("show me a dashboard
of my local docker containers using whatever capability you have
installed") correctly triggered the `docker-skill-system-card` Skill, which
then located and called the right tools, and gracefully degraded to a
formatted markdown table instead of failing or hallucinating a UI.

### 6. Positive — all read-only Docker tools work correctly on Windows
`docker-ps`, `docker-inspect`, `docker-logs`, `docker-stats` all function
correctly against a real Docker Desktop engine via `dockerode`, across ~46
real containers (mix of running/long-exited), including compose-project
grouping and health-status/resource-limit fields. No POSIX assumptions
found in the Docker-facing code path (only `system-info`'s `df` call is
affected — see #1/#2).

### 7. Positive — all 7 tested mutating lifecycle tools work correctly
`docker-pause`/`unpause`/`restart`/`stop`/`start`/`kill`/`rm` each returned
correct state transitions against the disposable test container, confirmed
against real `docker ps` output before and after (container was gone from
`docker ps -a` at the end, as expected).

### 8. Positive — clean error handling for invalid input
`docker-inspect` against a nonexistent container ID returned `isError:
true` with the Docker daemon's own 404 message passed through unmodified —
no crash, no stack trace leak.

### 9. Positive — `build-investigation-report` works
Accepted a well-formed structured payload (subject/summary/rootCause/
timeline/evidence/suggestedRemediations with a structured `action`) and
returned without error, consistent with its always-available, no-Docker,
model-facing design.

---

## Not covered in this pass (scope note)

- `docker-compose-down` and multi-select bulk actions — the only
  compose-labeled containers on this host were the user's own real, non-
  disposable projects; no throwaway compose stack was created to test
  against safely in the time available.
- The Stage-5 live-streaming sidecar (SSE) — a UI-only affordance over
  already-verified primitives; lower priority given the two genuinely open
  questions (#1/#2 and #3) this pass was aimed at resolving.
- Default (non-bypassed) Claude Code permission-prompt behavior per tool
  call — this requires an interactive TTY and wasn't automatable; all
  mutating-action tests here used `--permission-mode bypassPermissions` to
  isolate tool-level behavior from host-permission-UI behavior.

---

## Cleanup performed

- Removed the local-scope MCP registration: `claude mcp remove
  docker-skill-system-card` (confirmed gone from `claude mcp list` and from
  `~/.claude.json`'s project entry).
- Deleted `.claude/skills/docker-skill-system-card/` (and the now-empty
  `.claude/` directory it created) — confirmed a fresh session no longer
  lists the skill.
- Deleted the disposable `qa-test-sleeper` container (removed as the last
  step of the lifecycle test itself; confirmed absent from `docker ps -a`).
- `git status` on the repo is clean — `mcp-server/dist/` and `node_modules/`
  are already gitignored, so the build performed for this QA pass left no
  tracked-file changes. The build output itself (`mcp-server/dist/`) was
  left in place since it's a normal, gitignored build artifact matching the
  README's own build instructions, not something installed "into Claude
  CLI" — delete it manually if you want a fully pristine tree.
