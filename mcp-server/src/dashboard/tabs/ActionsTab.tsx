import { Button } from "@/components/ui/button";
import { ACTION_DEFS, type ActionDef, type ContainerDetail } from "../types";

interface ActionsTabProps {
  detail: ContainerDetail | null;
  actionInFlight: boolean;
  status: { kind: "ok" | "error"; text: string } | null;
  onAction: (def: ActionDef) => void;
}

function ActionGroup({
  title,
  defs,
  actionInFlight,
  onAction,
}: {
  title: string;
  defs: ActionDef[];
  actionInFlight: boolean;
  onAction: (def: ActionDef) => void;
}) {
  return (
    <div>
      <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">{title}</h3>
      <div className="flex flex-wrap gap-1.5">
        {defs.length === 0 && <span className="text-xs text-muted">None available in this state.</span>}
        {defs.map((def) => (
          <Button
            key={def.tool}
            size="sm"
            variant={def.tier === 2 ? "danger" : "default"}
            disabled={actionInFlight}
            onClick={() => onAction(def)}
          >
            {def.label}
          </Button>
        ))}
      </div>
    </div>
  );
}

export function ActionsTab({ detail, actionInFlight, status, onAction }: ActionsTabProps) {
  if (!detail) return null;
  const tier1 = ACTION_DEFS.filter((a) => a.tier === 1 && a.showIf(detail.state));
  const tier2 = ACTION_DEFS.filter((a) => a.tier === 2 && a.showIf(detail.state));

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted">
        Tier 1 actions (Start/Restart/Pause/Unpause) ask for a simple confirm. Tier 2 actions (Stop/Kill/Remove)
        require typing the container name — see design doc §4/§9.
      </p>
      <ActionGroup title="Tier 1" defs={tier1} actionInFlight={actionInFlight} onAction={onAction} />
      <ActionGroup title="Tier 2" defs={tier2} actionInFlight={actionInFlight} onAction={onAction} />
      {status && <div className={`text-xs ${status.kind === "ok" ? "text-success" : "text-danger"}`}>{status.text}</div>}
    </div>
  );
}
