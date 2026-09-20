import {
  RESOURCE_MIME_TYPE,
  registerAppResource,
  registerAppTool,
} from "@modelcontextprotocol/ext-apps/server";
import {
  McpServer,
  type CallToolResult,
  type ReadResourceResult,
} from "@modelcontextprotocol/server";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import { listContainers } from "./docker/tools/ps.js";
import { inspectContainer } from "./docker/tools/inspect.js";
import { getContainerLogs } from "./docker/tools/logs.js";
import { getContainerStats } from "./docker/tools/stats.js";
import {
  startContainer,
  restartContainer,
  pauseContainer,
  unpauseContainer,
  stopContainer,
  killContainer,
  removeContainer,
  stopComposeProject,
} from "./docker/tools/actions.js";
import { ensureSidecarStarted, SIDECAR_PORT } from "./docker/stream/sidecar.js";
import { createLargeContentStore } from "./src/lib/large-content.js";

const execFileAsync = promisify(execFile);

// Works both from source (server.ts) and compiled (dist/server.js)
const DIST_DIR = import.meta.filename.endsWith(".ts")
  ? path.join(import.meta.dirname, "dist")
  : import.meta.dirname;

// =============================================================================
// Data gathering — all local, no network calls (design doc §1).
// =============================================================================

const SystemInfoSchema = z.object({
  hostname: z.string(),
  platform: z.string(),
  cpuModel: z.string(),
  cpuCount: z.number(),
  totalMemBytes: z.number(),
});
type SystemInfo = z.infer<typeof SystemInfoSchema>;

function getSystemInfo(): SystemInfo {
  const cpuInfo = os.cpus()[0];
  return {
    hostname: os.hostname(),
    platform: `${os.platform()} ${os.arch()}`,
    cpuModel: cpuInfo?.model ?? "unknown",
    cpuCount: os.cpus().length,
    totalMemBytes: os.totalmem(),
  };
}

const DiskUsageSchema = z.object({
  path: z.string(),
  usedPercent: z.number(),
  totalBytes: z.number(),
  availableBytes: z.number(),
});
type DiskUsage = z.infer<typeof DiskUsageSchema>;

async function getDiskUsage(target = "/"): Promise<DiskUsage> {
  // `df -kP` is available on every POSIX system this is expected to run on;
  // parsed instead of shelling out to a heavier dependency for one number.
  const { stdout } = await execFileAsync("df", ["-kP", target]);
  const line = stdout.trim().split("\n").at(-1) ?? "";
  const fields = line.trim().split(/\s+/);
  const totalKb = Number(fields[1] ?? 0);
  const availableKb = Number(fields[3] ?? 0);
  const usedPercent = Number((fields[4] ?? "0").replace("%", ""));
  return {
    path: target,
    usedPercent,
    totalBytes: totalKb * 1024,
    availableBytes: availableKb * 1024,
  };
}

const GitStatusSchema = z.object({
  repoPath: z.string(),
  branch: z.string(),
  dirty: z.boolean(),
  aheadBehind: z.string(),
});
type GitStatus = z.infer<typeof GitStatusSchema>;

async function getGitStatus(repoPath: string): Promise<GitStatus | null> {
  try {
    const [branchRes, statusRes, aheadBehindRes] = await Promise.all([
      execFileAsync("git", ["-C", repoPath, "rev-parse", "--abbrev-ref", "HEAD"]),
      execFileAsync("git", ["-C", repoPath, "status", "--porcelain"]),
      execFileAsync("git", ["-C", repoPath, "status", "-sb"]).catch(() => ({ stdout: "" })),
    ]);
    const branchLine = aheadBehindRes.stdout.split("\n")[0] ?? "";
    const aheadBehindMatch = branchLine.match(/\[(.+?)\]/);
    return {
      repoPath,
      branch: branchRes.stdout.trim(),
      dirty: statusRes.stdout.trim().length > 0,
      aheadBehind: aheadBehindMatch ? aheadBehindMatch[1] : "up to date",
    };
  } catch {
    return null; // not a git repo, or git isn't installed — not fatal
  }
}

const PollStatsSchema = z.object({
  disk: DiskUsageSchema,
  freeMemBytes: z.number(),
  uptimeSeconds: z.number(),
  timestamp: z.string(),
});
type PollStats = z.infer<typeof PollStatsSchema>;

async function getPollStats(watchPath: string): Promise<PollStats> {
  const disk = await getDiskUsage(watchPath);
  return {
    disk,
    freeMemBytes: os.freemem(),
    uptimeSeconds: os.uptime(),
    timestamp: new Date().toISOString(),
  };
}

// =============================================================================
// MCP server
// =============================================================================

// Registers a UI resource that just serves a built HTML file from DIST_DIR —
// shared by every mcp-app.* entrypoint this server exposes.
function registerHtmlResource(
  server: McpServer,
  uri: string,
  distFile: string,
  description: string,
  csp?: { connectDomains?: string[] },
): void {
  registerAppResource(
    server,
    uri,
    uri,
    { mimeType: RESOURCE_MIME_TYPE, description },
    async (): Promise<ReadResourceResult> => {
      const html = await fs.readFile(path.join(DIST_DIR, distFile), "utf-8");
      return {
        contents: [
          { uri, mimeType: RESOURCE_MIME_TYPE, text: html, ...(csp ? { _meta: { ui: { csp } } } : {}) },
        ],
      };
    },
  );
}

const ContainerSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  image: z.string(),
  state: z.string(),
  status: z.string(),
  createdAt: z.string(),
  project: z.string().nullable(),
  exitCode: z.number().nullable(),
});

const ContainerDetailSchema = z.object({
  id: z.string(),
  name: z.string(),
  image: z.string(),
  state: z.string(),
  status: z.string(),
  restartCount: z.number(),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
  exitCode: z.number().nullable(),
  envKeys: z.array(z.string()),
  mounts: z.array(z.object({ source: z.string(), destination: z.string(), mode: z.string() })),
  networks: z.array(z.string()),
  labels: z.record(z.string(), z.string()),
  ports: z.array(z.string()),
  healthStatus: z.string().nullable(),
  cpuLimitCores: z.number().nullable(),
  memLimitBytes: z.number().nullable(),
});

// Model-facing summaries for tools whose full detail belongs only in
// structuredContent (see the token-consumption comments at each call site
// below). Kept next to the schemas they summarize so a field added to one
// prompts updating the other.
function summarizeContainers(containers: z.infer<typeof ContainerSummarySchema>[]): string {
  if (containers.length === 0) return "No containers found.";
  const running = containers.filter((c) => c.state === "running");
  const projects = new Set(containers.map((c) => c.project).filter((p): p is string => p !== null));
  const runningNames = running.map((c) => c.name).join(", ");
  return (
    `${containers.length} container(s): ${running.length} running` +
    (running.length > 0 ? ` (${runningNames})` : "") +
    `, ${containers.length - running.length} not running, across ${projects.size} compose project(s) ` +
    `plus any standalone containers. Full detail rendered in the UI.`
  );
}

function summarizeContainerDetail(detail: z.infer<typeof ContainerDetailSchema>): string {
  const health = detail.healthStatus ? ` (${detail.healthStatus})` : "";
  return `${detail.name} — ${detail.image}, state: ${detail.state}${health}. Full detail rendered in the UI.`;
}

const ContainerStatsSchema = z.object({
  cpuPercent: z.number(),
  memUsageBytes: z.number(),
  memLimitBytes: z.number(),
  memPercent: z.number(),
  netRxBytes: z.number(),
  netTxBytes: z.number(),
  pids: z.number(),
});

// The allowlist a remediation item's structured action can name — the same
// Tier 1/2 single-container tools the dashboard's own Actions tab offers,
// nothing wider. Deliberately excludes docker-compose-down (a different
// argument shape and blast radius — project-scoped, not container-scoped)
// and anything outside this server's own gated tool set. See the
// RemediationActionSchema comment below for why this exists at all.
const RemediationToolSchema = z.enum([
  "docker-start",
  "docker-restart",
  "docker-pause",
  "docker-unpause",
  "docker-stop",
  "docker-kill",
  "docker-rm",
]);

// A structured action lets the investigation-report widget offer a
// suggestion as a one-click "Run" button instead of plain text — but it
// goes through the exact same confirm-dialog UI (simple confirm for Tier
// 1, re-type-the-name for Tier 2) as the dashboard's own action buttons
// before calling anything, per SKILL.md's "known, deliberate gap" note.
// This is what makes offering it safe at all: an agent-authored report
// can *suggest* a tool+id pair from this fixed enum, never invoke it —
// the human still has to read the dialog and confirm.
const RemediationActionSchema = z.object({
  tool: RemediationToolSchema,
  id: z.string().describe("Container ID or name the action targets"),
});

const InvestigationReportSchema = z.object({
  subject: z.string().describe("What's being investigated, e.g. a container or host resource name"),
  summary: z.string().describe("One-paragraph summary of the investigation"),
  rootCause: z.string().describe("The most likely root cause, stated plainly"),
  timeline: z
    .array(z.object({ timestamp: z.string(), event: z.string() }))
    .describe("Chronological events that support the root-cause finding"),
  evidence: z
    .array(z.object({ source: z.string(), excerpt: z.string() }))
    .describe("Raw data backing the finding, tagged by where it came from (e.g. 'docker-logs', 'du -sh')"),
  suggestedRemediations: z
    .array(
      z.object({
        description: z.string().describe("Human-readable remediation suggestion"),
        action: RemediationActionSchema.optional().describe(
          "Optional structured action rendered as a gated one-click button. Omit for a plain informational suggestion — most host-level or non-container remediations (e.g. disk cleanup) won't have one.",
        ),
      }),
    )
    .describe(
      "Remediation suggestions. Each can be informational-only, or carry a structured `action` the widget " +
        "offers as a button gated behind the same confirm dialog as the dashboard's own Tier 1/2 actions " +
        "(design doc §11 item 4) — never executed without that confirmation.",
    ),
});

const ActionResultSchema = z.object({
  id: z.string(),
  state: z.string(),
});

const ComposeDownResultSchema = z.object({
  project: z.string(),
  removed: z.array(z.string()),
});

const StreamInfoSchema = z.object({
  port: z.number(),
  token: z.string(),
});

export function createServer(): McpServer {
  const server = new McpServer({
    name: "docker-skill Stage-0 spike: local system card",
    version: "0.1.0",
  });

  // Generic MCP token-optimization helper (src/lib/large-content.ts) — not
  // Docker-specific, safe to lift into any new MCP-UI skill. See that
  // file's own doc comment for the full rationale; docker-logs below is
  // this repo's one concrete instance of it, proving it out.
  const largeContent = createLargeContentStore(server);

  const resourceUri = "ui://system-card/mcp-app.html";
  // The repo this server is running from — used for the git-status row.
  // Local-only by construction: no path outside the process's own cwd is ever read.
  const watchRepoPath = process.cwd();
  const watchDiskPath = "/";

  // Model-facing tool (Tier 0, read-only, per design doc §4): static info +
  // one disk-usage/git-status snapshot, gathered once when the tool is called.
  registerAppTool(
    server,
    "system-info",
    {
      title: "Local System Card",
      description:
        "Read-only local system snapshot (hostname, CPU, memory, disk usage, " +
        "git status of the current repo). No Docker, no network calls — this " +
        "is the Stage-0 MCP-UI plumbing spike from docs/design/mcp-ui-docker-ops.md, " +
        "not the Docker dashboard itself.",
      annotations: { readOnlyHint: true, openWorldHint: false },
      inputSchema: z.object({}),
      outputSchema: z.object({
        system: SystemInfoSchema,
        disk: DiskUsageSchema,
        git: GitStatusSchema.nullable(),
        freeMemBytes: z.number(),
        uptimeSeconds: z.number(),
      }),
      _meta: { ui: { resourceUri } },
    },
    async (): Promise<CallToolResult> => {
      const [disk, git] = await Promise.all([
        getDiskUsage(watchDiskPath),
        getGitStatus(watchRepoPath),
      ]);
      const payload = {
        system: getSystemInfo(),
        disk,
        git,
        freeMemBytes: os.freemem(),
        uptimeSeconds: os.uptime(),
      };
      return {
        content: [{ type: "text", text: JSON.stringify(payload) }],
        structuredContent: payload,
      };
    },
  );

  // App-only tool (per design doc §8 "State and refresh strategy"): the
  // manual Refresh button calls this directly; it's never offered to the
  // model, so it can't be polled/spammed by agent reasoning.
  registerAppTool(
    server,
    "system-poll",
    {
      title: "Refresh disk/memory/uptime",
      description: "Re-samples disk usage, free memory, and uptime. App-only.",
      annotations: { readOnlyHint: true, openWorldHint: false },
      inputSchema: z.object({}),
      outputSchema: PollStatsSchema,
      _meta: { ui: { visibility: ["app"] } },
    },
    async (): Promise<CallToolResult> => {
      const stats = await getPollStats(watchDiskPath);
      return {
        content: [{ type: "text", text: JSON.stringify(stats) }],
        structuredContent: stats,
      };
    },
  );

  registerHtmlResource(server, resourceUri, "mcp-app.html", "Local System Card UI");

  // ===========================================================================
  // Stage 1 (design doc §11 item 1): read-only Docker fleet dashboard.
  // Tier 0 per §4 — both tools are read-only and pre-approved.
  // ===========================================================================

  const dashboardUri = "ui://docker-dashboard/docker-dashboard.html";

  registerAppTool(
    server,
    "docker-ps",
    {
      title: "List Docker Containers",
      description:
        "Lists all local Docker containers (running and stopped) with name, " +
        "image, state, and compose project. Read-only, local socket only.",
      annotations: { readOnlyHint: true, openWorldHint: false },
      inputSchema: z.object({}),
      outputSchema: z.object({ containers: z.array(ContainerSummarySchema) }),
      _meta: { ui: { resourceUri: dashboardUri } },
    },
    async (): Promise<CallToolResult> => {
      const containers = await listContainers();
      const payload = { containers };
      return {
        // Token-consumption note: the dashboard widget reads exclusively
        // from `structuredContent` (see src/dashboard/mcp.ts's
        // `ontoolresult`), never from `content` — confirmed by reading its
        // source, not assumed. `content` is what actually reaches the
        // model's context (confirmed empirically: Claude Code CLI does not
        // forward `structuredContent` to the model at all). Dumping the
        // full container array into `content` therefore bought nothing for
        // the UI and cost real tokens on every call — a compact summary
        // here is model-sufficient (it still knows what exists to reason
        // about) while the human gets full detail in the widget either way.
        content: [{ type: "text", text: summarizeContainers(containers) }],
        structuredContent: payload,
      };
    },
  );

  registerAppTool(
    server,
    "docker-inspect",
    {
      title: "Inspect Docker Container",
      description:
        "Detailed read-only inspection of one container: restart count, " +
        "exit code, mounts, networks, labels, ports, and env var *names* " +
        "(never values — see design doc §9). Local socket only.",
      annotations: { readOnlyHint: true, openWorldHint: false },
      inputSchema: z.object({ id: z.string().describe("Container ID or name") }),
      outputSchema: ContainerDetailSchema,
      _meta: { ui: { resourceUri: dashboardUri } },
    },
    async ({ id }): Promise<CallToolResult> => {
      const detail = await inspectContainer(id);
      return {
        // Same rationale as docker-ps above: the Inspect tab reads
        // structuredContent only, so content can be a compact summary
        // instead of the full mounts/labels/ports/env-key dump.
        content: [{ type: "text", text: summarizeContainerDetail(detail) }],
        structuredContent: detail,
      };
    },
  );

  // ===========================================================================
  // Stage 2 (design doc §11 item 2): logs + stats, still read-only Tier 0.
  // Both are model-facing (not app-only) per the §4 tier table.
  // ===========================================================================

  registerAppTool(
    server,
    "docker-logs",
    {
      title: "Get Container Logs",
      description:
        "Tail of a container's stdout/stderr (default last 100 lines). " +
        "Read-only, local socket only.",
      annotations: { readOnlyHint: true, openWorldHint: false },
      inputSchema: z.object({
        id: z.string().describe("Container ID or name"),
        tail: z.number().int().positive().optional().describe("Number of lines to tail (default 100)"),
      }),
      outputSchema: z.object({ lines: z.array(z.string()) }),
      _meta: { ui: { resourceUri: dashboardUri } },
    },
    async ({ id, tail }): Promise<CallToolResult> => {
      const lines = await getContainerLogs(id, tail);
      const payload = { lines };
      return {
        // The concrete proof-of-concept for src/lib/large-content.ts: logs
        // are the one payload in this server that's both potentially large
        // AND genuinely needed by the model (for diagnosis, not just
        // display) — unlike docker-ps/docker-inspect, this can't just be
        // shrunk to a summary. A short tail stays inline as before; a long
        // one becomes a summary + resource_link, so the model only pays
        // full token cost on the calls where it actually reads the logs.
        content: largeContent.toContent(JSON.stringify(payload), {
          name: `docker-logs-${id}`,
          description: `Log tail for container ${id}`,
          mimeType: "application/json",
        }),
        structuredContent: payload,
      };
    },
  );

  registerAppTool(
    server,
    "docker-stats",
    {
      title: "Get Container Stats",
      description:
        "One-shot CPU/memory/network snapshot for a single container. " +
        "Read-only, local socket only.",
      annotations: { readOnlyHint: true, openWorldHint: false },
      inputSchema: z.object({ id: z.string().describe("Container ID or name") }),
      outputSchema: ContainerStatsSchema,
      _meta: { ui: { resourceUri: dashboardUri } },
    },
    async ({ id }): Promise<CallToolResult> => {
      const stats = await getContainerStats(id);
      return {
        content: [{ type: "text", text: JSON.stringify(stats) }],
        structuredContent: stats,
      };
    },
  );

  // Stage 5 (design doc §11 item 5): app-only, same reasoning as
  // system-poll above — the widget's own "Live" toggle calls this to get
  // the sidecar's port + auth token, the model never needs it or should
  // be able to trigger it. See docker/stream/sidecar.ts for the sidecar
  // itself and the token/CORS trade-offs.
  registerAppTool(
    server,
    "stream-info",
    {
      title: "Get streaming sidecar connection info",
      description: "Returns the loopback streaming sidecar's port and per-process auth token. App-only.",
      annotations: { readOnlyHint: true, openWorldHint: false },
      inputSchema: z.object({}),
      outputSchema: StreamInfoSchema,
      _meta: { ui: { visibility: ["app"] } },
    },
    async (): Promise<CallToolResult> => {
      const info = ensureSidecarStarted();
      return { content: [{ type: "text", text: JSON.stringify(info) }], structuredContent: info };
    },
  );

  registerHtmlResource(
    server,
    dashboardUri,
    "docker-dashboard.html",
    "Docker Fleet Dashboard UI",
    { connectDomains: [`http://127.0.0.1:${SIDECAR_PORT}`] },
  );

  // ===========================================================================
  // Stage 3 (design doc §11 item 3): investigation-report resource.
  // Not read data itself — this tool just renders findings the *agent*
  // already gathered (via docker-logs/docker-inspect/docker-stats or Bash)
  // into a structured resource, instead of the agent's answer landing as
  // an ordinary chat reply. See §7.2: the agent owns the reasoning, the
  // server only owns turning the result into UI.
  // ===========================================================================

  const reportUri = "ui://investigation-report/investigation-report.html";

  registerAppTool(
    server,
    "build-investigation-report",
    {
      title: "Build Investigation Report",
      description:
        "Renders investigation findings (root cause, timeline, evidence, " +
        "suggested remediation) as a structured report UI. Call this after " +
        "actually investigating something — via docker-logs/docker-inspect/" +
        "docker-stats or Bash — not before. This tool does not gather any " +
        "data itself.",
      annotations: { readOnlyHint: true, openWorldHint: false, idempotentHint: true },
      inputSchema: InvestigationReportSchema,
      outputSchema: InvestigationReportSchema,
      _meta: { ui: { resourceUri: reportUri } },
    },
    async (report): Promise<CallToolResult> => {
      return {
        // The agent wrote every field of `report` as this call's own
        // arguments a moment ago — echoing the full object back in
        // `content` cost tokens to restate data already in context, for
        // zero informational gain. The report UI reads structuredContent
        // (unchanged, full detail), same as every other tool here.
        content: [
          { type: "text", text: `Investigation report for "${report.subject}" recorded and rendered in the UI.` },
        ],
        structuredContent: report,
      };
    },
  );

  registerHtmlResource(
    server,
    reportUri,
    "investigation-report.html",
    "Investigation Report UI",
  );

  // ===========================================================================
  // Stage 4 (design doc §11 item 4): gated mutating actions. All render the
  // dashboard resource so they show up in its Actions tab. `destructiveHint`
  // is the standard MCP signal a compliant host can use to require its own
  // confirmation — it's additive to, not a substitute for, the UI-side
  // confirm dialog built in docker-dashboard.ts, per §9's defense-in-depth
  // requirement.
  // ===========================================================================

  const containerIdInput = { id: z.string().describe("Container ID or name") };

  registerAppTool(
    server,
    "docker-start",
    {
      title: "Start Container",
      description: "Starts a stopped container. Tier 1 (design doc §4) — reversible, no data loss.",
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      inputSchema: z.object(containerIdInput),
      outputSchema: ActionResultSchema,
      _meta: { ui: { resourceUri: dashboardUri } },
    },
    async ({ id }): Promise<CallToolResult> => {
      const result = await startContainer(id);
      return { content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result };
    },
  );

  registerAppTool(
    server,
    "docker-restart",
    {
      title: "Restart Container",
      description: "Restarts a running container. Tier 1 (design doc §4) — reversible, no data loss.",
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      inputSchema: z.object(containerIdInput),
      outputSchema: ActionResultSchema,
      _meta: { ui: { resourceUri: dashboardUri } },
    },
    async ({ id }): Promise<CallToolResult> => {
      const result = await restartContainer(id);
      return { content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result };
    },
  );

  registerAppTool(
    server,
    "docker-pause",
    {
      title: "Pause Container",
      description: "Freezes all processes in a running container. Tier 1 (design doc §4) — reversible.",
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      inputSchema: z.object(containerIdInput),
      outputSchema: ActionResultSchema,
      _meta: { ui: { resourceUri: dashboardUri } },
    },
    async ({ id }): Promise<CallToolResult> => {
      const result = await pauseContainer(id);
      return { content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result };
    },
  );

  registerAppTool(
    server,
    "docker-unpause",
    {
      title: "Unpause Container",
      description: "Resumes a paused container. Tier 1 (design doc §4) — reversible.",
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      inputSchema: z.object(containerIdInput),
      outputSchema: ActionResultSchema,
      _meta: { ui: { resourceUri: dashboardUri } },
    },
    async ({ id }): Promise<CallToolResult> => {
      const result = await unpauseContainer(id);
      return { content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result };
    },
  );

  registerAppTool(
    server,
    "docker-stop",
    {
      title: "Stop Container",
      description:
        "Gracefully stops a running container (SIGTERM, then SIGKILL after a " +
        "timeout). Tier 2 (design doc §4) — off by default, requires confirm.",
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
      inputSchema: z.object(containerIdInput),
      outputSchema: ActionResultSchema,
      _meta: { ui: { resourceUri: dashboardUri } },
    },
    async ({ id }): Promise<CallToolResult> => {
      const result = await stopContainer(id);
      return { content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result };
    },
  );

  registerAppTool(
    server,
    "docker-kill",
    {
      title: "Kill Container",
      description:
        "Immediately kills a running container (SIGKILL, no graceful shutdown). " +
        "Tier 2 (design doc §4) — off by default, requires confirm.",
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
      inputSchema: z.object(containerIdInput),
      outputSchema: ActionResultSchema,
      _meta: { ui: { resourceUri: dashboardUri } },
    },
    async ({ id }): Promise<CallToolResult> => {
      const result = await killContainer(id);
      return { content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result };
    },
  );

  registerAppTool(
    server,
    "docker-rm",
    {
      title: "Remove Container",
      description:
        "Permanently removes a stopped container — irreversible. Fails if the " +
        "container is still running (no force option). Tier 2 (design doc §4) " +
        "— off by default, requires confirm.",
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
      inputSchema: z.object(containerIdInput),
      outputSchema: z.object({ id: z.string() }),
      _meta: { ui: { resourceUri: dashboardUri } },
    },
    async ({ id }): Promise<CallToolResult> => {
      const result = await removeContainer(id);
      return { content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result };
    },
  );

  registerAppTool(
    server,
    "docker-compose-down",
    {
      title: "Tear Down Compose Project",
      description:
        "Stops and removes every container carrying this docker-compose project label — the same " +
        "dockerode calls as docker-stop/docker-rm applied to the whole project, not the compose CLI " +
        "(see docker/tools/actions.ts for why). Permanently removes containers — irreversible. " +
        "Tier 2 (design doc §4) — off by default, requires confirm.",
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
      inputSchema: z.object({ project: z.string().describe("com.docker.compose.project label value") }),
      outputSchema: ComposeDownResultSchema,
      _meta: { ui: { resourceUri: dashboardUri } },
    },
    async ({ project }): Promise<CallToolResult> => {
      const result = await stopComposeProject(project);
      return { content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result };
    },
  );

  return server;
}
