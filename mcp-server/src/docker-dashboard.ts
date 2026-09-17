/**
 * @file Docker fleet dashboard — design doc §5 item 1 / §11 Stage 1.
 * Vanilla JS/DOM, no framework, per §6.1. Tier 0 (read-only) only: no
 * start/stop/rm actions here — that's §11 item 4, gated separately.
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

const mainEl = document.querySelector(".main") as HTMLElement;
const refreshBtn = document.getElementById("refresh-btn")!;
const cardList = document.getElementById("card-list")!;
const emptyState = document.getElementById("empty-state")!;
const detailPanel = document.getElementById("detail-panel")!;
const detailTitle = document.getElementById("detail-title")!;
const detailBody = document.getElementById("detail-body")!;
const detailCloseBtn = document.getElementById("detail-close-btn")!;

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
}

async function openDetail(id: string): Promise<void> {
  try {
    const result = await app.callServerTool({ name: "docker-inspect", arguments: { id } });
    renderDetail(result.structuredContent as unknown as ContainerDetail);
  } catch (e) {
    console.error("docker-inspect failed:", e);
  }
}

detailCloseBtn.addEventListener("click", () => {
  detailPanel.hidden = true;
});

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
refreshBtn.addEventListener("click", async () => {
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
});

// "Investigate" on a non-running container — design doc §7.2's "prompt"
// round trip, same pattern as the Stage-0 system card.
async function investigate(c: ContainerSummary): Promise<void> {
  const prompt =
    `Container "${c.name}" (image ${c.image}) is not running ` +
    `(state: ${c.state}, status: ${c.status}${c.exitCode !== null ? `, exit code ${c.exitCode}` : ""}). ` +
    `Investigate why using \`docker logs ${c.name}\` and \`docker inspect ${c.name}\` ` +
    `and summarize the likely root cause.`;
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
