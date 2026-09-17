# docker-skill

Experimental Claude Code skill: a Docker operations/investigation UI backed
by an MCP server, built to test the **MCP-UI / MCP Apps** technique (MCP
tool results that render rich, interactive UI in the host and can push new
prompts back into the agent).

See [`docs/design/mcp-ui-docker-ops.md`](docs/design/mcp-ui-docker-ops.md)
for the full architecture, communication protocol, tool/risk-tier catalog,
security model, and staged plan.

## Status

**Stages 0-2 (design doc §11/§13) are implemented and passing their
headless smoke test** — a local system card, and a real read-only Docker
fleet dashboard (`docker-ps`/`docker-inspect`/`docker-logs`/`docker-stats`
against the local Docker socket, with a tabbed detail panel). Mutating
actions and the investigation-report view are still ahead. See
[`SKILL.md`](SKILL.md) for what's implemented and how to run it.

```bash
cd mcp-server
npm install
npm run build
npm run smoke
```

`npm run smoke` spawns the built server over the real MCP stdio protocol,
calls all six tools (the Docker ones against whatever's actually running
locally), and confirms both returned resources match the official MCP
Apps shape (`text/html;profile=mcp-app`). That's verified. **Whether the
UI actually *renders* in the Claude Code CLI is not** — see the design
doc §12 and `SKILL.md` for why, and what to check before going further.
