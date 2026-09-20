import * as React from "react";
import { toast, Toaster } from "sonner";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/dashboard/ConfirmDialog";
import { useEffectiveTheme } from "@/lib/theme";
import { app, useIncomingReport } from "./mcp";
import { TIER1_TOOLS, TOOL_LABELS, type RemediationAction } from "./types";

export function ReportApp() {
  const report = useIncomingReport();
  const { confirm, dialog } = useConfirm();
  const toasterTheme = useEffectiveTheme();
  const [actionInFlight, setActionInFlight] = React.useState(false);
  const [doneTools, setDoneTools] = React.useState<Set<string>>(new Set());
  const [status, setStatus] = React.useState<{ kind: "ok" | "error"; text: string } | null>(null);

  async function runRemediation(action: RemediationAction, key: string) {
    if (actionInFlight) return;
    const tier = TIER1_TOOLS.has(action.tool) ? 1 : 2;
    const label = TOOL_LABELS[action.tool];
    const confirmed = await confirm({ title: `${label} "${action.id}"?`, tier }, action.id);
    if (!confirmed) return;

    setActionInFlight(true);
    setStatus(null);
    try {
      const result = await app.callServerTool({ name: action.tool, arguments: { id: action.id } });
      if (result.isError) throw new Error("tool returned an error");
      const text = `${label} "${action.id}" succeeded.`;
      setStatus({ kind: "ok", text });
      toast.success(text, { duration: 3500 });
      setDoneTools((prev) => new Set(prev).add(key));
    } catch (e) {
      console.error(`${action.tool} failed:`, e);
      const text = `${label} "${action.id}" failed — see console.`;
      setStatus({ kind: "error", text });
      toast.error(text, { duration: 6000 });
    } finally {
      setActionInFlight(false);
    }
  }

  if (!report) {
    return (
      <main className="main mx-auto max-w-xl p-4 text-sm text-muted">
        Waiting for a report…
        {dialog}
        <Toaster position="bottom-right" richColors closeButton theme={toasterTheme} />
      </main>
    );
  }

  return (
    <main className="main mx-auto max-w-xl p-4">
      <header className="mb-3">
        <h1 className="text-base font-semibold">{report.subject}</h1>
      </header>

      <p className="mb-4 text-sm text-muted">{report.summary}</p>

      <section className="mb-4">
        <h2 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">Root cause</h2>
        <div className="rounded-lg border border-danger/50 bg-danger/5 p-3 text-sm">{report.rootCause}</div>
      </section>

      <section className="mb-4">
        <h2 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">Timeline</h2>
        {report.timeline.length === 0 ? (
          <p className="text-sm text-muted">No timeline provided.</p>
        ) : (
          <ol className="space-y-1.5 pl-4 text-sm">
            {report.timeline.map((t, i) => (
              <li key={i} className="list-decimal">
                <span className="mr-1.5 font-mono text-xs text-muted">{t.timestamp}</span>
                {t.event}
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="mb-4">
        <h2 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">Evidence</h2>
        {report.evidence.length === 0 ? (
          <p className="text-sm text-muted">No evidence provided.</p>
        ) : (
          <div className="space-y-2">
            {report.evidence.map((e, i) => (
              <div key={i} className="overflow-hidden rounded-lg border border-border">
                <div className="bg-border/40 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-muted">
                  {e.source}
                </div>
                <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words p-2.5 font-mono text-xs">
                  {e.excerpt}
                </pre>
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">Suggested remediation</h2>
        {report.suggestedRemediations.length === 0 ? (
          <p className="text-sm text-muted">No remediation suggested.</p>
        ) : (
          <ul className="space-y-2">
            {report.suggestedRemediations.map((item, i) => {
              const key = item.action ? `${item.action.tool}:${item.action.id}:${i}` : String(i);
              const done = doneTools.has(key);
              return (
                <li key={key} className="flex items-baseline justify-between gap-2 text-sm">
                  <span>{item.description}</span>
                  {item.action && (
                    <Button
                      size="sm"
                      variant={done ? "outline" : TIER1_TOOLS.has(item.action.tool) ? "default" : "danger"}
                      disabled={actionInFlight || done}
                      onClick={() => void runRemediation(item.action!, key)}
                    >
                      {done ? "Done" : "Run"}
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        <p className="mt-2 text-[11px] text-muted">
          Items with a "Run" button call this server's own gated tools — each still requires confirming in the
          dialog before anything runs. Plain suggestions have no button and take no action.
        </p>
        {status && (
          <div className={`mt-2 text-xs ${status.kind === "ok" ? "text-success" : "text-danger"}`}>{status.text}</div>
        )}
      </section>

      {dialog}
      <Toaster position="bottom-right" richColors closeButton theme={toasterTheme} />
    </main>
  );
}
