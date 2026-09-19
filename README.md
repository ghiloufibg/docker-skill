# docker-skill

Experimental Claude Code skill: a Docker operations/investigation UI backed
by an MCP server, built to test the **MCP-UI / MCP Apps** technique (MCP
tool results that render rich, interactive UI in the host and can push new
prompts back into the agent).

See [`docs/design/mcp-ui-docker-ops.md`](docs/design/mcp-ui-docker-ops.md)
for the full architecture, communication protocol, tool/risk-tier catalog,
security model, and staged plan.

**Building your own MCP-UI server?** Skip the Docker-specific parts and
read [`docs/guides/building-mcp-ui-servers.md`](docs/guides/building-mcp-ui-servers.md)
instead — a project-agnostic field guide distilled from everything this
repo's build-and-break-it process turned up, including twelve real bugs
across four rounds of experimentation that were only ever found by
actually rendering the page (or, for the streaming features, actually
driving a real container restart against a real daemon).

## Status

**All five stages from design doc §11, everything the design doc
originally deferred as "not a numbered stage," and a fourth round of
functional/UI-UX additions on top are implemented and passing their
headless smoke test.** A local system card; a real Docker fleet
dashboard (`docker-ps`/`docker-inspect`/`docker-logs`/`docker-stats`,
tabbed detail panel with health status and CPU/memory resource limits,
cards grouped by compose project with a project-level teardown button,
client-side search/filter/sort, multi-select bulk actions, toast
notifications, and loading-state skeletons) against the local Docker
socket; optional live-updating Logs/Stats via a loopback streaming
sidecar; an investigation-report resource the agent fills in with its
own findings after "Investigate" is clicked, whose remediation
suggestions can carry a gated one-click action; and tier-gated mutating
actions (`docker-start`/`restart`/`pause`/`unpause` at Tier 1,
`docker-stop`/`kill`/`rm` at Tier 2, each requiring its own confirm —
Tier 2 requires typing the container name, or the selection count for a
bulk action). See [`SKILL.md`](SKILL.md) for what's implemented, a
documented residual gap in the Tier 2 confirm design, and how to run it.

```bash
cd mcp-server
npm install
npm run build
npm run smoke
```

`npm run smoke` spawns the built server over the real MCP stdio protocol
and calls all sixteen tools. For the mutating ones, it's not a dry run:
it creates a disposable container, drives it through
pause→unpause→restart→kill→start→stop→rm via the real tools, confirms
each state transition and that it's actually gone afterward, then cleans
up; tears down a real two-container compose-labeled project; and opens
the streaming sidecar's SSE endpoint to confirm it actually emits a live
event and rejects a wrong auth token. It also confirms all three returned
resources match the official MCP Apps shape (`text/html;profile=mcp-app`).

**Rendering is verified too — not just the protocol.** All three UI
resources were checked end-to-end against the official
`modelcontextprotocol/ext-apps` reference host, driven with Playwright:
tool calls, resource rendering, tabs, state-aware action buttons, the
Tier 2 confirm dialog, live streaming surviving a container restart, and
gated remediation buttons all genuinely work. **What's still open is the
Claude Code CLI specifically** — the reference host isn't Claude Code —
see the design doc §12 and `SKILL.md` for the full picture and what to
check next.
