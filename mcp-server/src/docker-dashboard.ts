/**
 * @file Docker fleet dashboard — design doc §5 item 1 / §11 Stages 1-4.
 * Vanilla JS/DOM, no framework, per §6.1. Mutating actions (Stage 4, §11
 * item 4) live behind the Actions tab with tier-gated confirm dialogs —
 * see showConfirm() and §9's defense-in-depth requirement.
 */
import { App, applyDocumentTheme, applyHostStyleVariables, type McpUiHostContext } from "@modelcontextprotocol/ext-apps";
import "./docker-dashboard.css";

interface ContainerSummary {
  id: string;
  name: string;
  image: string;
  state: string;
  status: string;
  createdAt: string;
  project: string | null;
  exitCode: number | null;
}

interface ContainerDetail {
  id: string;
  name: string;
  image: string;
  state: string;
  status: string;
  restartCount: number;
  startedAt: string | null;
  finishedAt: string | null;
  exitCode: number | null;
  envKeys: string[];
  mounts: { source: string; destination: string; mode: string }[];
  networks: string[];
  labels: Record<string, string>;
  ports: string[];
}

interface ContainerLogs {
  lines: string[];
}

interface ContainerStats {
  cpuPercent: number;
  memUsageBytes: number;
  memLimitBytes: number;
  memPercent: number;
  netRxBytes: number;
  netTxBytes: number;
  pids: number;
}

const mainEl = document.querySelector(".main") as HTMLElement;
const refreshBtn = document.getElementById("refresh-btn")!;
const cardList = document.getElementById("card-list")!;
const emptyState = document.getElementById("empty-state")!;
const detailPanel = document.getElementById("detail-panel")!;
const detailTitle = document.getElementById("detail-title")!;
const detailBody = document.getElementById("detail-body")!;
const detailCloseBtn = document.getElementById("detail-close-btn")!;
const tabBtns = Array.from(document.querySelectorAll<HTMLButtonElement>(".tab-btn"));
const tabPanels: Record<string, HTMLElement> = {
  inspect: document.getElementById("tab-inspect")!,
  logs: document.getElementById("tab-logs")!,
  stats: document.getElementById("tab-stats")!,
  actions: document.getElementById("tab-actions")!,
};
const actionsTier1 = document.getElementById("actions-tier1")!;
const actionsTier2 = document.getElementById("actions-tier2")!;
const actionsStatus = document.getElementById("actions-status")!;
const confirmOverlay = document.getElementById("confirm-overlay")!;
const confirmTitle = document.getElementById("confirm-title")!;
const confirmBody = document.getElementById("confirm-body")!;
const confirmTypeWrap = document.getElementById("confirm-type-wrap")!;
const confirmTypeInput = document.getElementById("confirm-type-input") as HTMLInputElement;
const confirmCancelBtn = document.getElementById("confirm-cancel-btn")!;
const confirmOkBtn = document.getElementById("confirm-ok-btn") as HTMLButtonElement;
const logsRefreshBtn = document.getElementById("logs-refresh-btn")!;
const logsContent = document.getElementById("logs-content")!;
const statsRefreshBtn = document.getElementById("stats-refresh-btn")!;
const statsCpuPercent = document.getElementById("stats-cpu-percent")!;
const statsCpuBar = document.getElementById("stats-cpu-bar")!;
const statsMemPercent = document.getElementById("stats-mem-percent")!;
const statsMemBar = document.getElementById("stats-mem-bar")!;
const statsMemDetail = document.getElementById("stats-mem-detail")!;
const statsNetRx = document.getElementById("stats-net-rx")!;
const statsNetTx = document.getElementById("stats-net-tx")!;
const statsPids = document.getElementById("stats-pids")!;
const statsStatus = document.getElementById("stats-status")!;
const statsData = document.getElementById("stats-data")!;

let currentContainerId: string | null = null;
let currentDetail: ContainerDetail | null = null;

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

function setBar(fillEl: HTMLElement, percentEl: HTMLElement, percent: number): void {
  fillEl.style.width = `${Math.min(percent, 100)}%`;
  fillEl.classList.remove("warning", "danger");
  if (percent >= 90) fillEl.classList.add("danger");
  else if (percent >= 70) fillEl.classList.add("warning");
  percentEl.textContent = `${percent}%`;
}

function stateClass(state: string): string {
  if (state === "running") return "state-running";
  if (state === "exited" || state === "dead") return "state-stopped";
  return "state-other";
}

function renderCards(containers: ContainerSummary[]): void {
  cardList.innerHTML = "";
  emptyState.hidden = containers.length > 0;

  for (const c of containers) {
    const card = document.createElement("div");
    card.className = "card";
    card.dataset.id = c.id;

    const needsInvestigate = c.state !== "running";

    card.innerHTML = `
      <div class="card-header">
        <span class="dot ${stateClass(c.state)}"></span>
        <span class="card-name">${escapeHtml(c.name)}</span>
      </div>
      <div class="card-image">${escapeHtml(c.image)}</div>
      <div class="card-status">${escapeHtml(c.status)}</div>
      ${c.project ? `<div class="card-project">project: ${escapeHtml(c.project)}</div>` : ""}
      ${needsInvestigate ? `<button class="btn btn-warning btn-small investigate-btn">Investigate</button>` : ""}
    `;

    card.addEventListener("click", (e) => {
      if ((e.target as HTMLElement).classList.contains("investigate-btn")) return;
      openDetail(c.id);
    });

    const investigateBtn = card.querySelector(".investigate-btn");
    investigateBtn?.addEventListener("click", (e) => {
      e.stopPropagation();
      investigate(c);
    });

    cardList.appendChild(card);
  }
}

function escapeHtml(s: string): string {
  const div = document.createElement("div");
  div.textContent = s;
  return div.innerHTML;
}

function renderDetail(d: ContainerDetail): void {
  currentDetail = d;
  detailTitle.textContent = d.name;
  detailBody.innerHTML = `
    <dt>State</dt><dd>${escapeHtml(d.status)}</dd>
    <dt>Image</dt><dd>${escapeHtml(d.image)}</dd>
    <dt>Restarts</dt><dd>${d.restartCount}</dd>
    <dt>Networks</dt><dd>${d.networks.map(escapeHtml).join(", ") || "--"}</dd>
    <dt>Ports</dt><dd>${d.ports.map(escapeHtml).join(", ") || "--"}</dd>
    <dt>Mounts</dt><dd>${d.mounts.map((m) => escapeHtml(`${m.source} -> ${m.destination} (${m.mode})`)).join("<br>") || "--"}</dd>
    <dt>Env vars (names only)</dt><dd>${d.envKeys.map(escapeHtml).join(", ") || "--"}</dd>
    <dt>Labels</dt><dd>${Object.entries(d.labels).map(([k, v]) => escapeHtml(`${k}=${v}`)).join("<br>") || "--"}</dd>
  `;
  detailPanel.hidden = false;
  if (!tabPanels.actions.hidden) renderActionsTab();
}

async function refreshDetail(id: string): Promise<void> {
  try {
    const result = await app.callServerTool({ name: "docker-inspect", arguments: { id } });
    if (result.isError) throw new Error("docker-inspect returned an error");
    renderDetail(result.structuredContent as unknown as ContainerDetail);
  } catch (e) {
    console.error("docker-inspect failed:", e);
  }
}

async function openDetail(id: string): Promise<void> {
  currentContainerId = id;
  currentDetail = null;
  logsContent.textContent = "--";
  resetStatsDisplay();
  switchTab("inspect");
  await refreshDetail(id);
}

detailCloseBtn.addEventListener("click", () => {
  detailPanel.hidden = true;
  currentContainerId = null;
  currentDetail = null;
});

// =============================================================================
// Tabs — Logs and Stats are lazy-loaded on first switch, per design doc §5
// item 2 ("Container detail — tabs for Logs / Stats / Inspect / Actions").
// =============================================================================

function switchTab(tab: string): void {
  for (const btn of tabBtns) {
    btn.classList.toggle("active", btn.dataset.tab === tab);
  }
  for (const [name, panel] of Object.entries(tabPanels)) {
    panel.hidden = name !== tab;
  }
  if (tab === "logs") loadLogs();
  if (tab === "stats") loadStats();
  if (tab === "actions") renderActionsTab();
}

for (const btn of tabBtns) {
  btn.addEventListener("click", () => switchTab(btn.dataset.tab!));
}

async function loadLogs(): Promise<void> {
  if (!currentContainerId) return;
  logsContent.textContent = "Loading...";
  try {
    const result = await app.callServerTool({
      name: "docker-logs",
      arguments: { id: currentContainerId, tail: 100 },
    });
    const { lines } = result.structuredContent as unknown as ContainerLogs;
    logsContent.textContent = lines.length > 0 ? lines.join("\n") : "(no log output)";
  } catch (e) {
    console.error("docker-logs failed:", e);
    logsContent.textContent = "[ERROR fetching logs]";
  }
}
logsRefreshBtn.addEventListener("click", loadLogs);

function resetStatsDisplay(): void {
  setBar(statsCpuBar, statsCpuPercent, 0);
  setBar(statsMemBar, statsMemPercent, 0);
  statsMemDetail.textContent = "-- / --";
  statsNetRx.textContent = "--";
  statsNetTx.textContent = "--";
  statsPids.textContent = "--";
  statsStatus.hidden = true;
  // Hidden until a successful load, not just reset to zeroes — a 0% bar
  // sitting right under "Stats unavailable" reads as real (if idle) data
  // to a real user, not as "we have nothing." Found during a full
  // click-through pass, not the headless smoke test (see design doc §12).
  statsData.hidden = true;
}

async function loadStats(): Promise<void> {
  if (!currentContainerId) return;
  statsStatus.hidden = true;
  try {
    const result = await app.callServerTool({ name: "docker-stats", arguments: { id: currentContainerId } });
    if (result.isError) throw new Error("tool returned an error");
    const stats = result.structuredContent as unknown as ContainerStats;
    setBar(statsCpuBar, statsCpuPercent, stats.cpuPercent);
    setBar(statsMemBar, statsMemPercent, stats.memPercent);
    statsMemDetail.textContent = `${formatBytes(stats.memUsageBytes)} / ${formatBytes(stats.memLimitBytes)}`;
    statsNetRx.textContent = formatBytes(stats.netRxBytes);
    statsNetTx.textContent = formatBytes(stats.netTxBytes);
    statsPids.textContent = String(stats.pids);
    statsData.hidden = false;
  } catch (e) {
    // Expected for a stopped container — Docker's stats endpoint only
    // works on running ones. Not a bug, so surface it plainly rather
    // than leaving stale/misleading bars on screen.
    console.error("docker-stats failed:", e);
    resetStatsDisplay();
    statsStatus.textContent = "Stats unavailable (container not running?)";
    statsStatus.hidden = false;
  }
}
statsRefreshBtn.addEventListener("click", loadStats);

// =============================================================================
// Actions tab — Stage 4 (design doc §11 item 4). Tier 1/2 per §4; every
// action needs a confirm here *and* relies on the host's own MCP
// permission prompt for the underlying tool call — see §9's
// defense-in-depth note and the residual-risk callout in the design doc:
// this dialog is enforced by this iframe's own JS, which a compromised
// resource could in principle skip, so the host-side prompt is the real
// backstop, not a redundant formality.
// =============================================================================

interface ActionDef {
  tool: string;
  label: string;
  tier: 1 | 2;
  showIf: (state: string) => boolean;
}

const ACTION_DEFS: ActionDef[] = [
  { tool: "docker-start", label: "Start", tier: 1, showIf: (s) => s !== "running" },
  { tool: "docker-restart", label: "Restart", tier: 1, showIf: (s) => s === "running" },
  { tool: "docker-pause", label: "Pause", tier: 1, showIf: (s) => s === "running" },
  { tool: "docker-unpause", label: "Unpause", tier: 1, showIf: (s) => s === "paused" },
  { tool: "docker-stop", label: "Stop", tier: 2, showIf: (s) => s === "running" || s === "paused" },
  { tool: "docker-kill", label: "Kill", tier: 2, showIf: (s) => s === "running" || s === "paused" },
  // No force option on docker-rm (design doc §9), so it's only offered once
  // the container is already stopped — matches the tool's own behavior
  // rather than offering a button that's guaranteed to fail.
  { tool: "docker-rm", label: "Remove", tier: 2, showIf: (s) => s !== "running" && s !== "paused" },
];

function renderActionButtons(container: HTMLElement, defs: ActionDef[]): void {
  container.innerHTML = "";
  if (defs.length === 0) {
    container.innerHTML = `<span class="empty">None available in this state.</span>`;
    return;
  }
  for (const def of defs) {
    const btn = document.createElement("button");
    btn.className = def.tier === 2 ? "btn btn-small btn-danger" : "btn btn-small";
    btn.textContent = def.label;
    btn.addEventListener("click", () => handleAction(def));
    container.appendChild(btn);
  }
}

function renderActionsTab(): void {
  if (!currentDetail) return;
  actionsStatus.hidden = true;
  const state = currentDetail.state;
  renderActionButtons(actionsTier1, ACTION_DEFS.filter((a) => a.tier === 1 && a.showIf(state)));
  renderActionButtons(actionsTier2, ACTION_DEFS.filter((a) => a.tier === 2 && a.showIf(state)));
}

// Tier 1: a plain confirm. Tier 2: the Confirm button stays disabled until
// the typed text exactly matches the container name (design doc §4/§9).
function showConfirm(def: ActionDef, containerName: string): Promise<boolean> {
  return new Promise((resolve) => {
    confirmTitle.textContent = `${def.label} "${containerName}"?`;
    confirmTypeInput.value = "";

    if (def.tier === 2) {
      confirmBody.textContent =
        "Tier 2 action — off by default, per design doc §4. Type the container name to confirm.";
      confirmTypeWrap.hidden = false;
      confirmOkBtn.disabled = true;
      confirmTypeInput.oninput = () => {
        confirmOkBtn.disabled = confirmTypeInput.value !== containerName;
      };
    } else {
      confirmBody.textContent = "Tier 1 action — reversible, per design doc §4.";
      confirmTypeWrap.hidden = true;
      confirmOkBtn.disabled = false;
    }

    confirmOverlay.hidden = false;

    const cleanup = (result: boolean) => {
      confirmOverlay.hidden = true;
      confirmCancelBtn.onclick = null;
      confirmOkBtn.onclick = null;
      confirmTypeInput.oninput = null;
      resolve(result);
    };
    confirmCancelBtn.onclick = () => cleanup(false);
    confirmOkBtn.onclick = () => cleanup(true);
  });
}

async function handleAction(def: ActionDef): Promise<void> {
  if (!currentContainerId || !currentDetail) return;
  const id = currentContainerId;
  const containerName = currentDetail.name;

  const confirmed = await showConfirm(def, containerName);
  if (!confirmed) return;

  actionsStatus.hidden = true;
  try {
    const result = await app.callServerTool({ name: def.tool, arguments: { id } });
    if (result.isError) throw new Error("tool returned an error");

    actionsStatus.className = "actions-status ok";
    actionsStatus.textContent = `${def.label} succeeded.`;
    actionsStatus.hidden = false;

    await refreshCardList(); // state changed — the fleet list is stale either way

    if (def.tool === "docker-rm") {
      // The container no longer exists — nothing left to re-inspect.
      detailPanel.hidden = true;
      currentContainerId = null;
      currentDetail = null;
    } else {
      await refreshDetail(id);
    }
  } catch (e) {
    console.error(`${def.tool} failed:`, e);
    actionsStatus.className = "actions-status error";
    actionsStatus.textContent = `${def.label} failed — see console.`;
    actionsStatus.hidden = false;
  }
}

// =============================================================================
// MCP App
// =============================================================================

const app = new App({ name: "Docker Fleet Dashboard", version: "0.1.0" });
app.onerror = console.error;

app.ontoolresult = (result) => {
  const payload = result.structuredContent as unknown as { containers: ContainerSummary[] } | undefined;
  if (payload) renderCards(payload.containers);
};

// Manual refresh (design doc §8 MVP) — re-calls the same model-facing tool.
async function refreshCardList(): Promise<void> {
  refreshBtn.setAttribute("disabled", "true");
  try {
    const result = await app.callServerTool({ name: "docker-ps", arguments: {} });
    const payload = result.structuredContent as unknown as { containers: ContainerSummary[] };
    renderCards(payload.containers);
  } catch (e) {
    console.error("Refresh failed:", e);
  } finally {
    refreshBtn.removeAttribute("disabled");
  }
}
refreshBtn.addEventListener("click", refreshCardList);

// "Investigate" on a non-running container — design doc §7.2's "prompt"
// round trip, same pattern as the Stage-0 system card.
async function investigate(c: ContainerSummary): Promise<void> {
  const prompt =
    `Container "${c.name}" (image ${c.image}) is not running ` +
    `(state: ${c.state}, status: ${c.status}${c.exitCode !== null ? `, exit code ${c.exitCode}` : ""}). ` +
    `Investigate why — prefer this server's docker-logs and docker-inspect ` +
    `tools if you have them (container id "${c.id}"), otherwise fall back ` +
    `to \`docker logs ${c.name}\` / \`docker inspect ${c.name}\` via Bash. ` +
    `Once you've actually looked, call this server's build-investigation-report ` +
    `tool with your findings (subject "${c.name}") instead of just replying ` +
    `in chat — root cause, the log lines/inspect fields you based it on as ` +
    `evidence, and remediation as suggestions only (don't take any action).`;
  try {
    const { isError } = await app.sendMessage(
      { role: "user", content: [{ type: "text", text: prompt }] },
      { signal: AbortSignal.timeout(5000) },
    );
    if (isError) console.error("Host rejected the investigate prompt");
  } catch (e) {
    console.error("sendMessage failed:", e);
  }
}

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
