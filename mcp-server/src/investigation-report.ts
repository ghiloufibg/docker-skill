/**
 * @file Investigation report — design doc §11 item 3 / §5 item 3.
 * Vanilla JS/DOM, no framework, per §6.1. This is a terminal, point-in-time
 * report: no refresh, no polling — the agent calls build-investigation-report
 * once with its findings, and this just renders them. Remediation items are
 * plain text, not action buttons — wiring those up is §11 item 4's job, once
 * gated mutating tools actually exist to call.
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

interface InvestigationReport {
  subject: string;
  summary: string;
  rootCause: string;
  timeline: TimelineEntry[];
  evidence: EvidenceEntry[];
  suggestedRemediations: string[];
}

const mainEl = document.querySelector(".main") as HTMLElement;
const reportSubject = document.getElementById("report-subject")!;
const reportSummary = document.getElementById("report-summary")!;
const rootCause = document.getElementById("root-cause")!;
const timelineList = document.getElementById("timeline-list")!;
const evidenceList = document.getElementById("evidence-list")!;
const remediationList = document.getElementById("remediation-list")!;

function escapeHtml(s: string): string {
  const div = document.createElement("div");
  div.textContent = s;
  return div.innerHTML;
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

  remediationList.innerHTML = r.suggestedRemediations.map((m) => `<li>${escapeHtml(m)}</li>`).join("") ||
    "<li class=\"empty\">No remediation suggested.</li>";
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
