/**
 * @file Stage-0 MCP-UI spike widget — see docs/design/mcp-ui-docker-ops.md §13.
 * Vanilla JS/DOM, no framework, per §6.1 of that doc.
 */
import { App, applyDocumentTheme, applyHostStyleVariables, type McpUiHostContext } from "@modelcontextprotocol/ext-apps";
import "./mcp-app.css";

interface SystemInfo {
  hostname: string;
  platform: string;
  cpuModel: string;
  cpuCount: number;
  totalMemBytes: number;
}
interface DiskUsage {
  path: string;
  usedPercent: number;
  totalBytes: number;
  availableBytes: number;
}
interface GitStatus {
  repoPath: string;
  branch: string;
  dirty: boolean;
  aheadBehind: string;
}
interface SystemInfoResult {
  system: SystemInfo;
  disk: DiskUsage;
  git: GitStatus | null;
  freeMemBytes: number;
  uptimeSeconds: number;
}
interface PollStats {
  disk: DiskUsage;
  freeMemBytes: number;
  uptimeSeconds: number;
  timestamp: string;
}

const DISK_INVESTIGATE_THRESHOLD = 80;

const mainEl = document.querySelector(".main") as HTMLElement;
const refreshBtn = document.getElementById("refresh-btn")!;
const infoHostname = document.getElementById("info-hostname")!;
const infoPlatform = document.getElementById("info-platform")!;
const infoCpu = document.getElementById("info-cpu")!;
const infoUptime = document.getElementById("info-uptime")!;
const diskPercent = document.getElementById("disk-percent")!;
const diskBarFill = document.getElementById("disk-bar-fill")!;
const diskDetail = document.getElementById("disk-detail")!;
const memPercent = document.getElementById("mem-percent")!;
const memBarFill = document.getElementById("mem-bar-fill")!;
const memDetail = document.getElementById("mem-detail")!;
const gitSummary = document.getElementById("git-summary")!;
const investigateSection = document.getElementById("investigate-section")!;
const investigateText = document.getElementById("investigate-text")!;
const investigateBtn = document.getElementById("investigate-btn")!;

let totalMemBytes = 0;
let diskPath = "/";
let repoPath = "";

function formatBytes(bytes: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex++;
  }
  return `${value.toFixed(1)} ${units[unitIndex]}`;
}

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  parts.push(`${minutes}m`);
  return parts.join(" ");
}

function setBar(fillEl: HTMLElement, percentEl: HTMLElement, percent: number): void {
  fillEl.style.width = `${percent}%`;
  fillEl.classList.remove("warning", "danger");
  if (percent >= 90) fillEl.classList.add("danger");
  else if (percent >= 70) fillEl.classList.add("warning");
  percentEl.textContent = `${percent}%`;
}

function updateDisk(disk: DiskUsage): void {
  diskPath = disk.path;
  setBar(diskBarFill, diskPercent, disk.usedPercent);
  diskDetail.textContent = `${formatBytes(disk.availableBytes)} free of ${formatBytes(disk.totalBytes)}`;

  if (disk.usedPercent >= DISK_INVESTIGATE_THRESHOLD) {
    investigateSection.hidden = false;
    investigateText.textContent =
      `Disk usage on ${disk.path} is at ${disk.usedPercent}%.`;
  } else {
    investigateSection.hidden = true;
  }
}

function updateMemory(freeMemBytes: number): void {
  if (totalMemBytes <= 0) return;
  const usedBytes = totalMemBytes - freeMemBytes;
  const percent = Math.round((usedBytes / totalMemBytes) * 100);
  setBar(memBarFill, memPercent, percent);
  memDetail.textContent = `${formatBytes(freeMemBytes)} free of ${formatBytes(totalMemBytes)}`;
}

function updateStaticInfo(result: SystemInfoResult): void {
  totalMemBytes = result.system.totalMemBytes;
  repoPath = result.git?.repoPath ?? "";

  infoHostname.textContent = result.system.hostname;
  infoPlatform.textContent = result.system.platform;
  infoCpu.textContent = `${result.system.cpuModel} (${result.system.cpuCount})`;

  updateDisk(result.disk);
  updateMemory(result.freeMemBytes);
  infoUptime.textContent = formatUptime(result.uptimeSeconds);

  gitSummary.textContent = result.git
    ? `${result.git.branch}${result.git.dirty ? " (dirty)" : ""} — ${result.git.aheadBehind}`
    : "not a git repository";
}

// =============================================================================
// MCP App — this is the protocol layer from design doc §6.0: the App class
// owns the postMessage/JSON-RPC framing, we never touch window.parent.postMessage
// directly.
// =============================================================================

const app = new App({ name: "Local System Card", version: "0.1.0" });

app.onerror = console.error;

// Static snapshot arrives once, as the result of the tool call that rendered
// this app (design doc §7.1 — the "tool" round trip, but here it's implicit:
// the host calls system-info to render us, and we get the result for free).
app.ontoolresult = (result) => {
  const payload = result.structuredContent as unknown as SystemInfoResult;
  if (payload) {
    updateStaticInfo(payload);
  }
};

// Manual refresh (design doc §8 "MVP: manual refresh") — calls the app-only
// system-poll tool directly. This is the explicit "tool" round trip.
refreshBtn.addEventListener("click", async () => {
  refreshBtn.setAttribute("disabled", "true");
  try {
    const result = await app.callServerTool({ name: "system-poll", arguments: {} });
    const stats = result.structuredContent as unknown as PollStats;
    updateDisk(stats.disk);
    updateMemory(stats.freeMemBytes);
    infoUptime.textContent = formatUptime(stats.uptimeSeconds);
  } catch (e) {
    console.error("Refresh failed:", e);
  } finally {
    refreshBtn.removeAttribute("disabled");
  }
});

// "Investigate" — design doc §7.2, the "prompt" round trip. This hands
// reasoning to the agent instead of the MCP server trying to be smart.
investigateBtn.addEventListener("click", async () => {
  const prompt =
    `Disk usage on ${diskPath} looks high. Investigate what's consuming ` +
    `space on this machine (du/df are fine to use) and, if ${repoPath} is ` +
    `relevant, check whether build artifacts or git history there are a ` +
    `contributing factor. Once you've actually looked, call this server's ` +
    `build-investigation-report tool with your findings (subject "Disk ` +
    `usage on ${diskPath}") instead of just replying in chat — root cause, ` +
    `the commands/output you based it on as evidence, and what's safe to ` +
    `clean up as suggested remediation.`;
  investigateBtn.setAttribute("disabled", "true");
  try {
    const { isError } = await app.sendMessage(
      { role: "user", content: [{ type: "text", text: prompt }] },
      { signal: AbortSignal.timeout(5000) },
    );
    if (isError) console.error("Host rejected the investigate prompt");
  } catch (e) {
    console.error("sendMessage failed:", e);
  } finally {
    investigateBtn.removeAttribute("disabled");
  }
});

function handleHostContextChanged(ctx: McpUiHostContext): void {
  if (ctx.theme) applyDocumentTheme(ctx.theme);
  if (ctx.styles?.variables) applyHostStyleVariables(ctx.styles.variables);
  if (ctx.safeAreaInsets) {
    mainEl.style.paddingTop = `${ctx.safeAreaInsets.top}px`;
    mainEl.style.paddingRight = `${ctx.safeAreaInsets.right}px`;
    mainEl.style.paddingBottom = `${ctx.safeAreaInsets.bottom}px`;
    mainEl.style.paddingLeft = `${ctx.safeAreaInsets.left}px`;
  }
}
app.onhostcontextchanged = handleHostContextChanged;

app.connect().then(() => {
  const ctx = app.getHostContext();
  if (ctx) handleHostContextChanged(ctx);
});
