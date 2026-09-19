/**
 * @file Investigation report — design doc §11 item 3 / §5 item 3.
 * Vanilla JS/DOM, no framework, per §6.1. This is a terminal, point-in-time
 * report: no refresh, no polling — the agent calls build-investigation-report
 * once with its findings, and this just renders them.
 *
 * Remediation items can now carry a structured `action` (§11 item 4),
 * rendered as a "Run" button — but it goes through the exact same
 * confirm-dialog gate as the dashboard's own Tier 1/2 actions
 * (showConfirm/dialogFocusables below are the same code as
 * docker-dashboard.ts, including its keyboard-accessibility fix; see
 * design doc §12 for why that fix needed a second, more careful
 * verification pass the first time). An agent-authored report can
 * *suggest* a tool+id pair from a fixed server-side enum — it can never
 * skip the human clicking through this dialog. See SKILL.md's "known,
 * deliberate gap" note for the residual risk this still doesn't close
 * (the dialog is this iframe's own JS, not server-verified).
 */
import { App, applyDocumentTheme, applyHostStyleVariables, type McpUiHostContext } from "@modelcontextprotocol/ext-apps";
import "./investigation-report.css";

interface TimelineEntry {
  timestamp: string;
  event: string;
}

interface EvidenceEntry {
  source: string;
  excerpt: string;
}

type RemediationTool =
  | "docker-start"
  | "docker-restart"
  | "docker-pause"
  | "docker-unpause"
  | "docker-stop"
  | "docker-kill"
  | "docker-rm";

interface RemediationAction {
  tool: RemediationTool;
  id: string;
}

interface RemediationItem {
  description: string;
  action?: RemediationAction;
}

interface InvestigationReport {
  subject: string;
  summary: string;
  rootCause: string;
  timeline: TimelineEntry[];
  evidence: EvidenceEntry[];
  suggestedRemediations: RemediationItem[];
}

// Same tiering as docker-dashboard.ts's ACTION_DEFS (design doc §4) — Tier
// 1 gets a plain confirm, Tier 2 requires re-typing the container name.
const TIER1_TOOLS = new Set<RemediationTool>(["docker-start", "docker-restart", "docker-pause", "docker-unpause"]);
const TOOL_LABELS: Record<RemediationTool, string> = {
  "docker-start": "Start",
  "docker-restart": "Restart",
  "docker-pause": "Pause",
  "docker-unpause": "Unpause",
  "docker-stop": "Stop",
  "docker-kill": "Kill",
  "docker-rm": "Remove",
};

const mainEl = document.querySelector(".main") as HTMLElement;
const reportSubject = document.getElementById("report-subject")!;
const reportSummary = document.getElementById("report-summary")!;
const rootCause = document.getElementById("root-cause")!;
const timelineList = document.getElementById("timeline-list")!;
const evidenceList = document.getElementById("evidence-list")!;
const remediationList = document.getElementById("remediation-list")!;
const remediationStatus = document.getElementById("remediation-status")!;
const confirmOverlay = document.getElementById("confirm-overlay")!;
const confirmTitle = document.getElementById("confirm-title")!;
const confirmBody = document.getElementById("confirm-body")!;
const confirmTypeWrap = document.getElementById("confirm-type-wrap")!;
const confirmTypeLabel = document.getElementById("confirm-type-label")!;
const confirmTypeInput = document.getElementById("confirm-type-input") as HTMLInputElement;
const confirmCancelBtn = document.getElementById("confirm-cancel-btn")!;
const confirmOkBtn = document.getElementById("confirm-ok-btn") as HTMLButtonElement;

function escapeHtml(s: string): string {
  const div = document.createElement("div");
  div.textContent = s;
  return div.innerHTML;
}

// Ported from docker-dashboard.ts's showConfirm/dialogFocusables —
// see that file's comments for the full account of the keyboard-
// accessibility bug (and the wrong-selector bug in its first fix) this
// carries forward correctly from the start.
function dialogFocusables(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>(".confirm-dialog button, .confirm-dialog input")).filter(
    (el) => !(el as HTMLButtonElement).disabled && el.offsetParent !== null,
  );
}

function showConfirm(opts: { title: string; tier: 1 | 2; typeNoun?: string }, retypeTarget: string): Promise<boolean> {
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
    confirmCancelBtn.focus();

    const onKeydown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        cleanup(false);
        return;
      }
      if (e.key !== "Tab") return;
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
      previouslyFocused?.focus();
      resolve(result);
    };
    confirmCancelBtn.onclick = () => cleanup(false);
    confirmOkBtn.onclick = () => cleanup(true);
  });
}

let actionInFlight = false;

async function runRemediation(action: RemediationAction, runBtn: HTMLButtonElement): Promise<void> {
  if (actionInFlight) return;
  const tier = TIER1_TOOLS.has(action.tool) ? 1 : 2;
  const label = TOOL_LABELS[action.tool];
  const confirmed = await showConfirm({ title: `${label} "${action.id}"?`, tier }, action.id);
  if (!confirmed) return;

  actionInFlight = true;
  for (const btn of remediationList.querySelectorAll<HTMLButtonElement>(".remediation-run-btn")) btn.disabled = true;
  remediationStatus.hidden = true;
  try {
    const result = await app.callServerTool({ name: action.tool, arguments: { id: action.id } });
    if (result.isError) throw new Error("tool returned an error");
    remediationStatus.className = "remediation-status ok";
    remediationStatus.textContent = `${label} "${action.id}" succeeded.`;
    remediationStatus.hidden = false;
    runBtn.disabled = true;
    runBtn.textContent = "Done";
  } catch (e) {
    console.error(`${action.tool} failed:`, e);
    remediationStatus.className = "remediation-status error";
    remediationStatus.textContent = `${label} "${action.id}" failed — see console.`;
    remediationStatus.hidden = false;
  } finally {
    actionInFlight = false;
    for (const btn of remediationList.querySelectorAll<HTMLButtonElement>(".remediation-run-btn")) {
      if (btn.textContent !== "Done") btn.disabled = false;
    }
  }
}

function renderReport(r: InvestigationReport): void {
  reportSubject.textContent = r.subject;
  reportSummary.textContent = r.summary;
  rootCause.textContent = r.rootCause;

  timelineList.innerHTML = r.timeline
    .map((t) => `<li><span class="timeline-ts">${escapeHtml(t.timestamp)}</span> ${escapeHtml(t.event)}</li>`)
    .join("") || "<li class=\"empty\">No timeline provided.</li>";

  evidenceList.innerHTML = r.evidence
    .map(
      (e) =>
        `<div class="evidence-item"><div class="evidence-source">${escapeHtml(e.source)}</div><pre class="evidence-excerpt">${escapeHtml(e.excerpt)}</pre></div>`,
    )
    .join("") || "<div class=\"empty\">No evidence provided.</div>";

  remediationStatus.hidden = true;
  remediationList.innerHTML = "";
  if (r.suggestedRemediations.length === 0) {
    remediationList.innerHTML = "<li class=\"empty\">No remediation suggested.</li>";
    return;
  }
  for (const item of r.suggestedRemediations) {
    const li = document.createElement("li");
    li.className = "remediation-item";
    const text = document.createElement("span");
    text.textContent = item.description;
    li.appendChild(text);
    if (item.action) {
      const action = item.action;
      const btn = document.createElement("button");
      btn.className = "btn btn-small remediation-run-btn" + (TIER1_TOOLS.has(action.tool) ? "" : " btn-danger");
      btn.textContent = "Run";
      btn.addEventListener("click", () => runRemediation(action, btn));
      li.appendChild(btn);
    }
    remediationList.appendChild(li);
  }
}

// =============================================================================
// MCP App
// =============================================================================

const app = new App({ name: "Investigation Report", version: "0.1.0" });
app.onerror = console.error;

app.ontoolresult = (result) => {
  const report = result.structuredContent as unknown as InvestigationReport | undefined;
  if (report) renderReport(report);
};

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
