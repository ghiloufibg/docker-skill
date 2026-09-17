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
repo's build-and-break-it process turned up, including nine real bugs
that were only ever found by actually rendering the page.

## Status

**Stages 0-4 — the whole core staged plan from design doc §11 — are
implemented and passing their headless smoke test.** A local system
card; a real Docker fleet dashboard (`docker-ps`/`docker-inspect`/
`docker-logs`/`docker-stats`, tabbed detail panel) against the local
Docker socket; an investigation-report resource the agent fills in with
its own findings after "Investigate" is clicked; and tier-gated mutating
actions (`docker-start`/`restart`/`pause`/`unpause` at Tier 1,
`docker-stop`/`kill`/`rm` at Tier 2, each requiring its own confirm —
Tier 2 requires typing the container name). Only the optional Stage 5
(streaming) and things never scheduled as stages (a compose view, real
one-click remediation) remain. See [`SKILL.md`](SKILL.md) for what's
implemented, a documented residual gap in the Tier 2 confirm design, and
how to run it.

```bash
cd mcp-server
npm install
npm run build
npm run smoke
```

`npm run smoke` spawns the built server over the real MCP stdio protocol
and calls all fourteen tools. For the mutating ones, it's not a dry run:
it creates a disposable container, drives it through
pause→unpause→restart→kill→start→stop→rm via the real tools, confirms
each state transition and that it's actually gone afterward, then cleans
up. It also confirms all three returned resources match the official MCP
Apps shape (`text/html;profile=mcp-app`).

**Rendering is now verified too — not just the protocol.** All three UI
resources were checked end-to-end against the official
`modelcontextprotocol/ext-apps` reference host, driven with Playwright:
tool calls, resource rendering, tabs, state-aware action buttons, and
the Tier 2 confirm dialog all genuinely work. That check also caught and
fixed two real CSS bugs invisible to the headless smoke test (elements
that stayed visible despite `hidden` being set). **What's still open is
the Claude Code CLI specifically** — the reference host isn't Claude
Code — see the design doc §12 and `SKILL.md` for the full picture and
what to check next.
