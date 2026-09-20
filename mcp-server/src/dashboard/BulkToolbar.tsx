import { Button } from "@/components/ui/button";
import { ACTION_DEFS, type ActionDef, type ContainerSummary } from "./types";

interface BulkToolbarProps {
  selected: ContainerSummary[];
  onClear: () => void;
  onAction: (def: ActionDef, targets: ContainerSummary[]) => void;
}

export function BulkToolbar({ selected, onClear, onAction }: BulkToolbarProps) {
  if (selected.length === 0) return null;

  // Only an action valid for EVERY selected container's current state is
  // offered — same rule the per-container Actions tab uses (ACTION_DEFS'
  // own showIf) — rather than a button that would silently fail for part
  // of the selection.
  const applicable = ACTION_DEFS.filter((def) => selected.every((c) => def.showIf(c.state)));

  return (
    <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-accent/40 bg-accent/5 p-2.5">
      <span className="text-xs font-medium text-fg">{selected.length} selected</span>
      <div className="flex flex-wrap gap-1.5">
        {applicable.length === 0 ? (
          <span className="text-xs text-muted">No action applies to every selected container.</span>
        ) : (
          applicable.map((def) => (
            <Button
              key={def.tool}
              size="sm"
              variant={def.tier === 2 ? "danger" : "default"}
              onClick={() => onAction(def, selected)}
            >
              {def.label}
            </Button>
          ))
        )}
      </div>
      <Button size="sm" variant="ghost" className="ml-auto" onClick={onClear}>
        Clear
      </Button>
    </div>
  );
}
