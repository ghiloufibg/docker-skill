# docker-skill

Experimental Claude Code skill: a Docker operations/investigation UI backed
by an MCP server, built to test the **MCP-UI / MCP Apps** technique (MCP
tool results that render rich, interactive UI in the host and can push new
prompts back into the agent).

See [`docs/design/mcp-ui-docker-ops.md`](docs/design/mcp-ui-docker-ops.md)
for the full architecture, communication protocol, tool/risk-tier catalog,
security model, and staged plan.

## Status

**Stage 0 (design doc §13) is implemented and passing its headless smoke
test.** Not the Docker dashboard yet — see [`SKILL.md`](SKILL.md) for what
"Stage 0" means and how to run it.

```bash
cd mcp-server
npm install
npm run build
npm run smoke
```

`npm run smoke` spawns the built server over the real MCP stdio protocol,
calls both tools, and confirms the returned resource matches the official
MCP Apps shape (`text/html;profile=mcp-app`). That's verified. **Whether
the UI actually *renders* in the Claude Code CLI is not** — see the design
doc §12 and `SKILL.md` for why, and what to check before going further.
