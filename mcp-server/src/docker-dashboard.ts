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
  healthStatus: string | null;
  cpuLimitCores: number | null;
  memLimitBytes: number | null;
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
const refreshIcon = document.getElementById("refresh-icon")!;
const cardList = document.getElementById("card-list")!;
const emptyState = document.getElementById("empty-state")!;
const fleetNoMatches = document.getElementById("fleet-no-matches")!;
const fleetSearch = document.getElementById("fleet-search") as HTMLInputElement;
const fleetStateFilter = document.getElementById("fleet-state-filter") as HTMLSelectElement;
const fleetSort = document.getElementById("fleet-sort") as HTMLSelectElement;
const fleetStatus = document.getElementById("fleet-status")!;
const bulkToolbar = document.getElementById("bulk-toolbar")!;
const bulkCount = document.getElementById("bulk-count")!;
const bulkActionsEl = document.getElementById("bulk-actions")!;
const bulkClearBtn = document.getElementById("bulk-clear-btn")!;
const toastContainer = document.getElementById("toast-container")!;

// A lightweight, additive notification layer for one-off action results
// (succeeded/failed) — the existing inline status banners (fleetStatus,
// actionsStatus) stay as-is for their own persistent, panel-local context
// (a message that makes sense right where it's read, e.g. next to the
// Actions tab it came from); a toast is for the "yes, that worked" glance
// that doesn't need to stick around once read. Auto-dismisses; errors get
// longer to read before they do.
function showToast(kind: "ok" | "error", message: string): void {
  const toast = document.createElement("div");
  toast.className = `toast toast-${kind}`;
  toast.textContent = message;
  toastContainer.appendChild(toast);
  const timeoutMs = kind === "error" ? 6000 : 3500;
  const remove = () => {
    toast.classList.add("toast-leaving");
    // Not just animationend: prefers-reduced-motion disables the CSS
    // animation entirely (see the media query below), and an animation
    // that never runs never fires animationend — this fallback timer is
    // what actually removes the element in that case, not a backup for
    // an edge case that "shouldn't happen."
    toast.addEventListener("animationend", () => toast.remove(), { once: true });
    setTimeout(() => toast.remove(), 250);
  };
  const timer = setTimeout(remove, timeoutMs);
  toast.addEventListener("click", () => {
    clearTimeout(timer);
    remove();
  });
}
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
const confirmTypeLabel = document.getElementById("confirm-type-label")!;
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
const logsLiveToggle = document.getElementById("logs-live-toggle") as HTMLInputElement;
const logsLiveStatus = document.getElementById("logs-live-status")!;
const statsLiveToggle = document.getElementById("stats-live-toggle") as HTMLInputElement;
const sparkline = document.getElementById("stats-sparkline")!;
const sparklineCpu = document.getElementById("sparkline-cpu")!;
const sparklineMem = document.getElementById("sparkline-mem")!;
const sparklineLegend = document.getElementById("sparkline-legend")!;

let currentContainerId: string | null = null;
let currentDetail: ContainerDetail | null = null;
// Guards the window between a confirmed action's tool call and the button
// re-render that follows it — the confirm overlay blocks a second click
// while a dialog is open, but nothing stopped a second action from being
// confirmed and fired *concurrently* with the first once that dialog
// closed, before refreshDetail() re-rendered the (possibly now-stale)
// buttons. A real user found this by confirming Restart, then immediately
// confirming Pause before Restart's tool call returned — see design doc
// §12 for the full account.
let actionInFlight = false;

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

// SVGElement.hidden exists but, in this environment at least, setting it
// false does not reliably remove the `hidden` content attribute the way it
// does for a plain HTMLElement — the CSS [hidden] override still applies
// even after `.hidden = false`, leaving the element stuck invisible. Found
// only by checking getComputedStyle after toggling, not by reading either
// this file's CSS or the property assignment in isolation — each looked
// correct on its own. A plain HTMLElement (like sparklineLegend below)
// doesn't need this — .hidden works normally there.
//
// The first fix attempt here (`style.display = hidden ? "none" : ""`) was
// itself still broken: an *empty* inline style clears any inline override
// and falls back to the stylesheet cascade — which still matched
// `.sparkline[hidden]` because the static `hidden` attribute in the HTML
// markup was never actually removed, only shadowed. Setting a concrete
// inline value ("block") is what actually wins over the stylesheet
// regardless of that attribute's state, and toggleAttribute keeps the
// attribute itself semantically in sync too. Caught the same way as the
// first bug: checking computed style after toggling, not by reasoning
// about the code — this exact "the fix's fix also needs verifying"
// pattern is why §16 of the guide exists for a different element.
function setSvgHidden(el: Element, hidden: boolean): void {
  el.toggleAttribute("hidden", hidden);
  (el as HTMLElement).style.display = hidden ? "none" : "block";
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

// Bulk selection (design doc §5 item 1 extension) — a plain Set of
// container ids, deliberately reset on every fresh docker-ps fetch
// (setContainers) rather than reconciled against the new list: a
// selection surviving a refresh across containers that may have been
// removed/replaced is more surprising than just starting clean.
const selectedIds = new Set<string>();

function buildCard(c: ContainerSummary): HTMLElement {
  const card = document.createElement("div");
  card.className = "card";
  card.dataset.id = c.id;

  const needsInvestigate = c.state !== "running";

  card.innerHTML = `
    <label class="card-select" title="Select for bulk action">
      <input type="checkbox" class="card-checkbox" ${selectedIds.has(c.id) ? "checked" : ""}>
    </label>
    <div class="card-header">
      <span class="dot ${stateClass(c.state)}"></span>
      <span class="card-name">${escapeHtml(c.name)}</span>
    </div>
    <div class="card-image">${escapeHtml(c.image)}</div>
    <div class="card-status">${escapeHtml(c.status)}</div>
    ${needsInvestigate ? `<button class="btn btn-warning btn-small investigate-btn">Investigate</button>` : ""}
  `;

  const checkbox = card.querySelector(".card-checkbox") as HTMLInputElement;
  checkbox.addEventListener("click", (e) => e.stopPropagation());
  checkbox.addEventListener("change", () => {
    if (checkbox.checked) selectedIds.add(c.id);
    else selectedIds.delete(c.id);
    card.classList.toggle("card-selected", checkbox.checked);
    updateBulkToolbar();
  });
  if (selectedIds.has(c.id)) card.classList.add("card-selected");

  card.addEventListener("click", (e) => {
    if ((e.target as HTMLElement).classList.contains("investigate-btn")) return;
    if ((e.target as HTMLElement).closest(".card-select")) return;
    openDetail(c);
  });

  const investigateBtn = card.querySelector(".investigate-btn");
  investigateBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    investigate(c);
  });

  return card;
}

// The full, unfiltered list from the last docker-ps refresh — search/
// filter/sort (below) always recompute from this rather than re-fetching,
// since the data's already in hand and there's no reason to round-trip
// the tool call just to change what's displayed.
let allContainers: ContainerSummary[] = [];

function stateBucket(state: string): "running" | "paused" | "exited" | "other" {
  if (state === "running") return "running";
  if (state === "paused") return "paused";
  if (state === "exited" || state === "dead") return "exited";
  return "other";
}

// running < paused < other < exited feels like the useful triage order —
// what's live, then what's frozen, then everything else, stopped last.
const STATE_SORT_RANK: Record<string, number> = { running: 0, paused: 1, other: 2, exited: 3 };

function setContainers(containers: ContainerSummary[]): void {
  allContainers = containers;
  selectedIds.clear();
  applyFiltersAndRender();
  updateBulkToolbar(); // reflects the clear above — a stale-but-still-visible toolbar after a fresh fetch reads as broken
}

function applyFiltersAndRender(): void {
  const query = fleetSearch.value.trim().toLowerCase();
  const stateWanted = fleetStateFilter.value;
  const sortBy = fleetSort.value;

  let filtered = allContainers.filter((c) => {
    if (query && !c.name.toLowerCase().includes(query) && !c.image.toLowerCase().includes(query)) return false;
    if (stateWanted !== "all" && stateBucket(c.state) !== stateWanted) return false;
    return true;
  });

  filtered = filtered.slice().sort((a, b) => {
    if (sortBy === "state") {
      const rankDiff = STATE_SORT_RANK[stateBucket(a.state)] - STATE_SORT_RANK[stateBucket(b.state)];
      if (rankDiff !== 0) return rankDiff;
      return a.name.localeCompare(b.name);
    }
    if (sortBy === "created") return b.createdAt.localeCompare(a.createdAt);
    return a.name.localeCompare(b.name);
  });

  renderCards(filtered);

  // Distinguish "no containers at all" from "some exist, none match" —
  // showing the same empty message for both reads as a bug ("did my
  // search break the dashboard?") when it's really just zero results.
  const hasAnyContainers = allContainers.length > 0;
  fleetNoMatches.hidden = !(hasAnyContainers && filtered.length === 0);
}

for (const el of [fleetSearch, fleetStateFilter, fleetSort]) {
  el.addEventListener("input", applyFiltersAndRender);
  el.addEventListener("change", applyFiltersAndRender);
}

// "/" focuses search (a la GitHub/Slack/Linear) — the common power-user
// convention, so it's the one most likely to be already-known rather than
// something new to learn. Skipped while any text input/textarea/select
// already has focus, so it doesn't hijack a "/" a user is actually typing
// (e.g. into a label or a future free-text field) or double-fire while
// already in the search box itself.
document.addEventListener("keydown", (e) => {
  if (e.key !== "/") return;
  const active = document.activeElement;
  const isTyping = active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement || active instanceof HTMLSelectElement;
  if (isTyping) return;
  e.preventDefault();
  fleetSearch.focus();
});

fleetSearch.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && fleetSearch.value) {
    e.stopPropagation(); // don't let this Escape also bubble to something else listening for it
    fleetSearch.value = "";
    applyFiltersAndRender();
  }
});

// Bulk actions: the toolbar only ever offers an action valid for EVERY
// selected container's current state (ACTION_DEFS.showIf, same rule the
// per-container Actions tab uses) — no button that would fail for part
// of the selection ever appears, rather than appearing and silently
// skipping members it can't apply to.
function updateBulkToolbar(): void {
  if (selectedIds.size === 0) {
    bulkToolbar.hidden = true;
    return;
  }
  bulkToolbar.hidden = false;
  bulkCount.textContent = `${selectedIds.size} selected`;

  const selected = allContainers.filter((c) => selectedIds.has(c.id));
  const applicable = ACTION_DEFS.filter((def) => selected.every((c) => def.showIf(c.state)));

  bulkActionsEl.innerHTML = "";
  if (applicable.length === 0) {
    bulkActionsEl.innerHTML = `<span class="empty">No action applies to every selected container.</span>`;
    return;
  }
  for (const def of applicable) {
    const btn = document.createElement("button");
    btn.className = def.tier === 2 ? "btn btn-small btn-danger" : "btn btn-small";
    btn.textContent = def.label;
    btn.addEventListener("click", () => handleBulkAction(def, selected));
    bulkActionsEl.appendChild(btn);
  }
}

bulkClearBtn.addEventListener("click", () => {
  selectedIds.clear();
  applyFiltersAndRender(); // re-render to uncheck/unhighlight every card
  updateBulkToolbar();
});

async function handleBulkAction(def: ActionDef, targets: ContainerSummary[]): Promise<void> {
  if (actionInFlight) return;
  const plural = targets.length === 1 ? "" : "s";
  // Retyping N container names for a bulk Tier 2 confirm would be
  // unreasonable UX — typing the count is the bulk-scale equivalent of
  // "type the container name": still a deliberate, error-prone-to-fake
  // action, not just a click.
  const confirmed = await showConfirm(
    {
      title: `${def.label} ${targets.length} container${plural}?`,
      tier: def.tier,
      typeNoun: `number of containers (${targets.length})`,
    },
    String(targets.length),
  );
  if (!confirmed) return;

  actionInFlight = true;
  setActionButtonsDisabled(true);
  fleetStatus.hidden = true;
  try {
    let succeeded = 0;
    const failed: string[] = [];
    // Sequential, not Promise.all: each call already goes through the same
    // tool this dashboard's single-container actions use, and running them
    // one at a time keeps this from becoming its own miniature version of
    // the concurrent-mutation race §12/§17 already found and fixed for a
    // single container — here that would mean several bulk calls' own
    // refreshes racing each other instead.
    for (const c of targets) {
      try {
        const result = await app.callServerTool({ name: def.tool, arguments: { id: c.id } });
        if (result.isError) throw new Error("tool returned an error");
        succeeded++;
      } catch (e) {
        console.error(`${def.tool} failed for ${c.name}:`, e);
        failed.push(c.name);
      }
    }

    if (failed.length === 0) {
      fleetStatus.className = "actions-status ok";
      fleetStatus.textContent = `${def.label} succeeded on all ${succeeded} container${plural}.`;
      showToast("ok", fleetStatus.textContent);
    } else {
      fleetStatus.className = "actions-status error";
      fleetStatus.textContent =
        `${def.label} succeeded on ${succeeded}/${targets.length}; failed: ${failed.join(", ")} — see console.`;
      showToast("error", `${def.label}: ${succeeded}/${targets.length} succeeded, ${failed.length} failed.`);
    }
    fleetStatus.hidden = false;
    await refreshCardList(); // setContainers clears selectedIds as part of this
  } finally {
    actionInFlight = false;
    setActionButtonsDisabled(false);
  }
}

// Groups cards under their com.docker.compose.project label (design doc §5
// item 4 / SKILL.md's "compose project view"), each with its own project-
// level "Down" button. A container with no project label renders as a
// standalone card, same as before this grouping existed.
function renderCards(containers: ContainerSummary[]): void {
  cardList.innerHTML = "";
  emptyState.hidden = allContainers.length > 0;

  const projects = new Map<string, ContainerSummary[]>();
  const standalone: ContainerSummary[] = [];
  for (const c of containers) {
    if (c.project) {
      const members = projects.get(c.project) ?? [];
      members.push(c);
      projects.set(c.project, members);
    } else {
      standalone.push(c);
    }
  }

  for (const [project, members] of projects) {
    const group = document.createElement("div");
    group.className = "project-group";

    const header = document.createElement("div");
    header.className = "project-group-header";
    header.innerHTML = `
      <span class="project-group-name">${escapeHtml(project)}</span>
      <span class="project-group-count">${members.length} container${members.length === 1 ? "" : "s"}</span>
    `;
    const downBtn = document.createElement("button");
    downBtn.className = "btn btn-small btn-danger project-down-btn";
    downBtn.textContent = "Down";
    downBtn.addEventListener("click", () => handleProjectDown(project, members));
    header.appendChild(downBtn);
    group.appendChild(header);

    const grid = document.createElement("div");
    grid.className = "card-list";
    for (const c of members) grid.appendChild(buildCard(c));
    group.appendChild(grid);

    cardList.appendChild(group);
  }

  for (const c of standalone) cardList.appendChild(buildCard(c));
}

async function handleProjectDown(project: string, members: ContainerSummary[]): Promise<void> {
  if (actionInFlight) return;
  const plural = members.length === 1 ? "" : "s";
  const confirmed = await showConfirm(
    { title: `Tear down "${project}"? (${members.length} container${plural})`, tier: 2, typeNoun: "project name" },
    project,
  );
  if (!confirmed) return;

  actionInFlight = true;
  setActionButtonsDisabled(true);
  fleetStatus.hidden = true;
  try {
    const result = await app.callServerTool({ name: "docker-compose-down", arguments: { project } });
    if (result.isError) throw new Error("tool returned an error");

    fleetStatus.className = "actions-status ok";
    fleetStatus.textContent = `"${project}" torn down.`;
    fleetStatus.hidden = false;
    showToast("ok", fleetStatus.textContent);

    // The detail panel may be showing a container that was just removed as
    // part of this project — close it rather than leaving it pointed at a
    // now-nonexistent container (refreshDetail's docker-inspect would just
    // fail for it).
    if (currentContainerId && members.some((m) => m.id === currentContainerId)) {
      closeLiveStreams();
      detailPanel.hidden = true;
      currentContainerId = null;
      currentDetail = null;
    }
    await refreshCardList();
  } catch (e) {
    console.error("docker-compose-down failed:", e);
    fleetStatus.className = "actions-status error";
    fleetStatus.textContent = `Tearing down "${project}" failed — see console.`;
    fleetStatus.hidden = false;
    showToast("error", fleetStatus.textContent);
  } finally {
    actionInFlight = false;
    setActionButtonsDisabled(false);
  }
}

function escapeHtml(s: string): string {
  const div = document.createElement("div");
  div.textContent = s;
  return div.innerHTML;
}

function healthBadge(health: string | null): string {
  if (!health) return "";
  const cls = health === "healthy" ? "health-ok" : health === "unhealthy" ? "health-bad" : "health-pending";
  return ` <span class="health-badge ${cls}">${escapeHtml(health)}</span>`;
}

function formatCpuLimit(cores: number | null): string {
  if (cores === null) return "Unlimited";
  return `${cores % 1 === 0 ? cores : cores.toFixed(2)} core${cores === 1 ? "" : "s"}`;
}

// Spans both grid columns of the .detail-body dl (see the CSS) so it reads
// as a section divider instead of a mislabeled field — no matching <dd>,
// since grid-column: span 2 consumes the row on its own.
function sectionHeader(label: string): string {
  return `<dt class="detail-section-header">${escapeHtml(label)}</dt>`;
}

function renderDetail(d: ContainerDetail): void {
  currentDetail = d;
  detailTitle.innerHTML = `${escapeHtml(d.name)}${healthBadge(d.healthStatus)}`;
  detailBody.innerHTML = `
    ${sectionHeader("Status")}
    <dt>State</dt><dd>${escapeHtml(d.status)}</dd>
    <dt>Image</dt><dd>${escapeHtml(d.image)}</dd>
    <dt>Restarts</dt><dd>${d.restartCount}</dd>

    ${sectionHeader("Resource limits")}
    <dt>CPU</dt><dd>${formatCpuLimit(d.cpuLimitCores)}</dd>
    <dt>Memory</dt><dd>${d.memLimitBytes === null ? "Unlimited" : formatBytes(d.memLimitBytes)}</dd>

    ${sectionHeader("Network")}
    <dt>Networks</dt><dd>${d.networks.map(escapeHtml).join(", ") || "--"}</dd>
    <dt>Ports</dt><dd>${d.ports.map(escapeHtml).join(", ") || "--"}</dd>

    ${sectionHeader("Storage")}
    <dt>Mounts</dt><dd>${d.mounts.map((m) => escapeHtml(`${m.source} -> ${m.destination} (${m.mode})`)).join("<br>") || "--"}</dd>

    ${sectionHeader("Metadata")}
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

const DETAIL_SKELETON_HTML = Array.from(
  { length: 4 },
  () => `<div class="skeleton-row"></div>`,
).join("");

// The detail panel used to keep the *previous* container's Inspect data on
// screen until docker-inspect for the new one resolved — clicking through
// several containers on a slow connection would show container A's fields
// under container B's name for a moment. Showing the clicked card's own
// name immediately (already known, no round trip needed) plus a loading
// skeleton for the fields still in flight fixes both the stale data and
// the "did my click register?" dead air.
async function openDetail(c: ContainerSummary): Promise<void> {
  closeLiveStreams(); // switching containers — any stream from the previous one is now stale
  currentContainerId = c.id;
  currentDetail = null;
  logsContent.textContent = "--";
  resetStatsDisplay();
  detailTitle.textContent = c.name;
  detailBody.innerHTML = DETAIL_SKELETON_HTML;
  detailPanel.hidden = false;
  switchTab("inspect");
  await refreshDetail(c.id);
}

detailCloseBtn.addEventListener("click", () => {
  closeLiveStreams();
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
    if (result.isError) throw new Error("docker-logs returned an error");
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
// Stage 5 (design doc §11 item 5): optional live logs/stats via the
// loopback streaming sidecar (docker/stream/sidecar.ts). Off by default —
// manual refresh (above) stays the default per design doc §8's MVP; this
// is purely opt-in via the "Live" checkboxes. A stream, once opened, keeps
// running across tab switches (stopping it only on uncheck, on switching
// to a different container, or on closing the detail panel) — simpler
// than tying its lifecycle to tab visibility, and updating hidden bars in
// the background costs nothing a user would notice.
// =============================================================================

interface StreamInfo {
  port: number;
  token: string;
}

// The sidecar's port+token are constant for this server process (see
// sidecar.ts's module-level singleton) — fetched once, not on every stream open.
let streamInfoCache: StreamInfo | null = null;

async function getStreamInfo(): Promise<StreamInfo | null> {
  if (streamInfoCache) return streamInfoCache;
  try {
    const result = await app.callServerTool({ name: "stream-info", arguments: {} });
    if (result.isError) throw new Error("stream-info returned an error");
    streamInfoCache = result.structuredContent as unknown as StreamInfo;
    return streamInfoCache;
  } catch (e) {
    console.error("stream-info failed:", e);
    return null;
  }
}

function streamUrl(info: StreamInfo, kind: "logs" | "stats", id: string): string {
  return `http://127.0.0.1:${info.port}/stream/${kind}/${encodeURIComponent(id)}?token=${encodeURIComponent(info.token)}`;
}

let activeLogsSource: EventSource | null = null;
let activeStatsSource: EventSource | null = null;
const MAX_STATS_HISTORY = 40;
const statsHistory: { cpu: number; mem: number }[] = [];

function closeLiveStreams(): void {
  activeLogsSource?.close();
  activeLogsSource = null;
  logsLiveToggle.checked = false;
  logsLiveStatus.hidden = true;

  activeStatsSource?.close();
  activeStatsSource = null;
  statsLiveToggle.checked = false;
  statsHistory.length = 0;
  setSvgHidden(sparkline, true);
  sparklineLegend.hidden = true;
}

async function startLogsLive(): Promise<void> {
  if (!currentContainerId) return;
  const info = await getStreamInfo();
  if (!info) {
    logsLiveToggle.checked = false;
    logsLiveStatus.textContent = "Live unavailable — see console.";
    logsLiveStatus.hidden = false;
    return;
  }
  logsLiveStatus.hidden = true;
  if (logsContent.textContent === "(no log output)" || logsContent.textContent === "--") {
    logsContent.textContent = "";
  }
  const source = new EventSource(streamUrl(info, "logs", currentContainerId));
  activeLogsSource = source;
  source.onmessage = (ev) => {
    const data = JSON.parse(ev.data) as { line?: string; error?: string };
    if (data.error) {
      logsLiveStatus.textContent = data.error;
      logsLiveStatus.hidden = false;
      return;
    }
    logsContent.textContent += (logsContent.textContent ? "\n" : "") + data.line;
    logsContent.scrollTop = logsContent.scrollHeight;
  };
  source.onerror = () => {
    logsLiveStatus.textContent = "Live connection lost.";
    logsLiveStatus.hidden = false;
    source.close();
    if (activeLogsSource === source) activeLogsSource = null;
    logsLiveToggle.checked = false;
  };
}

function renderSparkline(): void {
  if (statsHistory.length < 2) return;
  setSvgHidden(sparkline, false);
  sparklineLegend.hidden = false;
  const toPoints = (key: "cpu" | "mem") =>
    statsHistory
      .map((s, i) => {
        const x = (i / (MAX_STATS_HISTORY - 1)) * 200;
        const y = 48 - Math.min(s[key], 100) / 100 * 48;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");
  sparklineCpu.setAttribute("points", toPoints("cpu"));
  sparklineMem.setAttribute("points", toPoints("mem"));
}

async function startStatsLive(): Promise<void> {
  if (!currentContainerId) return;
  const info = await getStreamInfo();
  if (!info) {
    statsLiveToggle.checked = false;
    statsStatus.textContent = "Live unavailable — see console.";
    statsStatus.hidden = false;
    return;
  }
  statsHistory.length = 0;
  const source = new EventSource(streamUrl(info, "stats", currentContainerId));
  activeStatsSource = source;
  source.onmessage = (ev) => {
    const data = JSON.parse(ev.data) as ContainerStats | { error: string };
    if ("error" in data) {
      statsStatus.textContent = data.error;
      statsStatus.hidden = false;
      return;
    }
    statsStatus.hidden = true;
    setBar(statsCpuBar, statsCpuPercent, data.cpuPercent);
    setBar(statsMemBar, statsMemPercent, data.memPercent);
    statsMemDetail.textContent = `${formatBytes(data.memUsageBytes)} / ${formatBytes(data.memLimitBytes)}`;
    statsNetRx.textContent = formatBytes(data.netRxBytes);
    statsNetTx.textContent = formatBytes(data.netTxBytes);
    statsPids.textContent = String(data.pids);
    statsData.hidden = false;

    statsHistory.push({ cpu: data.cpuPercent, mem: data.memPercent });
    if (statsHistory.length > MAX_STATS_HISTORY) statsHistory.shift();
    renderSparkline();
  };
  source.onerror = () => {
    statsStatus.textContent = "Live connection lost.";
    statsStatus.hidden = false;
    source.close();
    if (activeStatsSource === source) activeStatsSource = null;
    statsLiveToggle.checked = false;
  };
}

logsLiveToggle.addEventListener("change", () => {
  if (logsLiveToggle.checked) {
    startLogsLive();
  } else {
    activeLogsSource?.close();
    activeLogsSource = null;
    logsLiveStatus.hidden = true;
  }
});

statsLiveToggle.addEventListener("change", () => {
  if (statsLiveToggle.checked) {
    startStatsLive();
  } else {
    activeStatsSource?.close();
    activeStatsSource = null;
    statsHistory.length = 0;
    setSvgHidden(sparkline, true);
    sparklineLegend.hidden = true;
  }
});

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

// One dashboard-wide lock, not a per-panel one: a project-down and a
// per-container action can target overlapping containers, so disabling
// only one region during the other's in-flight window would reopen the
// same concurrent-mutation race §12/§17 of the guide already found and
// fixed for the Actions tab alone.
function setActionButtonsDisabled(disabled: boolean): void {
  for (const btn of actionsTier1.querySelectorAll("button")) (btn as HTMLButtonElement).disabled = disabled;
  for (const btn of actionsTier2.querySelectorAll("button")) (btn as HTMLButtonElement).disabled = disabled;
  for (const btn of document.querySelectorAll<HTMLButtonElement>(".project-down-btn")) btn.disabled = disabled;
  for (const btn of bulkActionsEl.querySelectorAll("button")) (btn as HTMLButtonElement).disabled = disabled;
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
// Focusable elements inside the dialog, in tab order — used for both the
// initial focus target and the Tab/Shift+Tab trap below.
function dialogFocusables(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>(".confirm-dialog button, .confirm-dialog input")).filter(
    (el) => !(el as HTMLButtonElement).disabled && el.offsetParent !== null,
  );
}

// A real user driving this with a keyboard, not a mouse, found this dialog
// with zero accessibility support: focus stayed on the button behind the
// overlay, Tab eventually left the dialog (and the widget's own iframe)
// while it was still open and unconfirmed, and Escape did nothing. All
// three fixed here — see design doc §12 for the full account. This
// matters more than usual for a *confirmation* dialog specifically: the
// whole point of Tier 2's re-type-the-name step is to slow down a
// destructive action, and that protection is void if a keyboard user
// can tab past it without ever reaching the Cancel/Confirm buttons.
function showConfirm(
  opts: { title: string; tier: 1 | 2; typeNoun?: string },
  retypeTarget: string,
): Promise<boolean> {
  return new Promise((resolve) => {
    confirmTitle.textContent = opts.title;
    confirmTypeInput.value = "";
    const noun = opts.typeNoun ?? "container name";

    if (opts.tier === 2) {
      confirmBody.textContent = `Tier 2 action — off by default, per design doc §4. Type the ${noun} to confirm.`;
      confirmTypeLabel.textContent = `Type the ${noun} to confirm:`;
      confirmTypeWrap.hidden = false;
      confirmOkBtn.disabled = true;
      confirmTypeInput.oninput = () => {
        confirmOkBtn.disabled = confirmTypeInput.value !== retypeTarget;
      };
    } else {
      confirmBody.textContent = "Tier 1 action — reversible, per design doc §4.";
      confirmTypeWrap.hidden = true;
      confirmOkBtn.disabled = false;
    }

    const previouslyFocused = document.activeElement as HTMLElement | null;
    confirmOverlay.hidden = false;
    // Default focus to Cancel, not Confirm — a modal shouldn't put the
    // destructive action one accidental Enter-press away from firing.
    confirmCancelBtn.focus();

    const onKeydown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        cleanup(false);
        return;
      }
      if (e.key !== "Tab") return;
      // Trap focus: wrap Tab/Shift+Tab within the dialog's own focusable set
      // instead of letting it escape to the page (or the host) behind it.
      const focusables = dialogFocusables();
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const current = document.activeElement;
      if (e.shiftKey && current === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && current === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeydown);

    const cleanup = (result: boolean) => {
      confirmOverlay.hidden = true;
      confirmCancelBtn.onclick = null;
      confirmOkBtn.onclick = null;
      confirmTypeInput.oninput = null;
      document.removeEventListener("keydown", onKeydown);
      // Return focus to whatever triggered the dialog (the action button),
      // rather than leaving it stranded on a now-hidden element.
      previouslyFocused?.focus();
      resolve(result);
    };
    confirmCancelBtn.onclick = () => cleanup(false);
    confirmOkBtn.onclick = () => cleanup(true);
  });
}

async function handleAction(def: ActionDef): Promise<void> {
  // The confirm overlay blocks a second click while its own dialog is open,
  // but once confirmed there's a real gap — from here until refreshDetail()
  // re-renders the buttons — during which the old buttons are still live.
  // Without this guard a second action can be confirmed and fired while
  // the first is still in flight, both mutating the same container
  // concurrently with only the last-resolving one's status ever shown.
  if (actionInFlight || !currentContainerId || !currentDetail) return;
  const id = currentContainerId;
  const containerName = currentDetail.name;

  const confirmed = await showConfirm({ title: `${def.label} "${containerName}"?`, tier: def.tier }, containerName);
  if (!confirmed) return;

  actionInFlight = true;
  setActionButtonsDisabled(true);
  actionsStatus.hidden = true;
  try {
    const result = await app.callServerTool({ name: def.tool, arguments: { id } });
    if (result.isError) throw new Error("tool returned an error");

    actionsStatus.className = "actions-status ok";
    actionsStatus.textContent = `${def.label} succeeded.`;
    actionsStatus.hidden = false;
    showToast("ok", `${def.label} "${containerName}" succeeded.`);

    await refreshCardList(); // state changed — the fleet list is stale either way

    if (def.tool === "docker-rm") {
      // The container no longer exists — nothing left to re-inspect, and
      // any live stream against it is now pointed at nothing.
      closeLiveStreams();
      detailPanel.hidden = true;
      currentContainerId = null;
      currentDetail = null;
    } else {
      await refreshDetail(id); // re-renders the Actions tab with fresh state, buttons re-enabled
    }
  } catch (e) {
    console.error(`${def.tool} failed:`, e);
    actionsStatus.className = "actions-status error";
    actionsStatus.textContent = `${def.label} failed — see console.`;
    actionsStatus.hidden = false;
    showToast("error", `${def.label} "${containerName}" failed — see console.`);
  } finally {
    actionInFlight = false;
    setActionButtonsDisabled(false);
  }
}

// =============================================================================
// MCP App
// =============================================================================

const app = new App({ name: "Docker Fleet Dashboard", version: "0.1.0" });
app.onerror = console.error;

app.ontoolresult = (result) => {
  const payload = result.structuredContent as unknown as { containers: ContainerSummary[] } | undefined;
  if (payload) setContainers(payload.containers);
};

// Manual refresh (design doc §8 MVP) — re-calls the same model-facing tool.
async function refreshCardList(): Promise<void> {
  refreshBtn.setAttribute("disabled", "true");
  refreshIcon.classList.add("spinning");
  try {
    const result = await app.callServerTool({ name: "docker-ps", arguments: {} });
    if (result.isError) throw new Error("docker-ps returned an error");
    const payload = result.structuredContent as unknown as { containers: ContainerSummary[] };
    setContainers(payload.containers);
  } catch (e) {
    console.error("Refresh failed:", e);
  } finally {
    refreshBtn.removeAttribute("disabled");
    refreshIcon.classList.remove("spinning");
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
    `evidence, and remediation as suggestions only (never call a mutating ` +
    `docker-* tool yourself). If a suggestion maps directly to one of this ` +
    `server's own container actions (start/restart/pause/unpause/stop/kill/rm ` +
    `— tool name and this container's id "${c.id}"), include it as a ` +
    `structured action so the report can offer it as a button; the human ` +
    `still has to confirm it there before anything runs.`;
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
