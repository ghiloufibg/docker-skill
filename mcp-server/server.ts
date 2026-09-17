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
): void {
  registerAppResource(
    server,
    uri,
    uri,
    { mimeType: RESOURCE_MIME_TYPE, description },
    async (): Promise<ReadResourceResult> => {
      const html = await fs.readFile(path.join(DIST_DIR, distFile), "utf-8");
      return { contents: [{ uri, mimeType: RESOURCE_MIME_TYPE, text: html }] };
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
});

export function createServer(): McpServer {
  const server = new McpServer({
    name: "docker-skill Stage-0 spike: local system card",
    version: "0.1.0",
  });

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
      inputSchema: z.object({}),
      outputSchema: z.object({ containers: z.array(ContainerSummarySchema) }),
      _meta: { ui: { resourceUri: dashboardUri } },
    },
    async (): Promise<CallToolResult> => {
      const containers = await listContainers();
      const payload = { containers };
      return {
        content: [{ type: "text", text: JSON.stringify(payload) }],
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
      inputSchema: z.object({ id: z.string().describe("Container ID or name") }),
      outputSchema: ContainerDetailSchema,
      _meta: { ui: { resourceUri: dashboardUri } },
    },
    async ({ id }): Promise<CallToolResult> => {
      const detail = await inspectContainer(id);
      return {
        content: [{ type: "text", text: JSON.stringify(detail) }],
        structuredContent: detail,
      };
    },
  );

  registerHtmlResource(
    server,
    dashboardUri,
    "docker-dashboard.html",
    "Docker Fleet Dashboard UI",
  );

  return server;
}
