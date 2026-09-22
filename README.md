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
repo's build-and-break-it process turned up, including fourteen real
bugs across six rounds of experimentation that were only ever found by
actually running the thing — rendering the page, driving a real
container restart against a real daemon for the streaming features, or
running an automated accessibility audit (`axe-core`) for two
contrast/theming bugs no amount of eyeballing screenshots had caught.

## Status

**All five stages from design doc §11, everything the design doc
originally deferred as "not a numbered stage," a fourth round of
functional/UI-UX additions, and a fifth round rewriting all three UI
resources in React + Tailwind CSS v4 + shadcn/ui are implemented and
passing their headless smoke test.** A local system card; a real Docker
fleet dashboard (`docker-ps`/`docker-inspect`/`docker-logs`/`docker-stats`,
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

**Round 5 note:** the view layer moved from hand-rolled vanilla DOM/CSS
to React + Tailwind CSS v4 + shadcn/ui (Radix primitives) — a
deliberate reversal of the design doc's original "no framework" call,
made on request and with the payload cost measured and accepted (each
resource is now roughly 2.2-2.6× its vanilla size; see design doc §6.1's
update and §12's table). The protocol layer, every tool, and the whole
Docker-side server were untouched by this — it's a rendering-technique
change, verified against the exact same feature set as every prior
round with zero regressions found.

**Round 6 note:** an `axe-core` accessibility audit across all three
resources and eleven UI states found two real bugs the previous five
rounds of manual review missed — four CSS color tokens that read fine
by eye but failed WCAG AA's 4.5:1 text-contrast threshold (computed and
retuned, not guessed at), and a toast-notification library never wired
to the host-driven theme (a new instance of the exact dual-selector bug
§8 of the guide already documents, just inside a third-party component
this time). Both fixed; the audit and the full round-5 regression suite
both re-verified clean afterward. See design doc §11 item 10.

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

## Other skills in this repo

[`skills/mimir/`](skills/mimir/SKILL.md) is an unrelated Claude Code skill
also published from this repo: given a feature/requirement, it produces a
detailed implementation plan for a Java 21 (LTS, never newer) backend built
with strict Hexagonal Architecture — domain model, ports, use-case
services, adapter skeletons, package layout, and a testing strategy. It has
no connection to the Docker Ops/MCP-UI work above; it lives here purely for
publishing convenience.
