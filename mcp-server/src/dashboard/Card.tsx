import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { stateBucket } from "./types";
import type { ContainerSummary } from "./types";

const DOT_CLASS: Record<ReturnType<typeof stateBucket>, string> = {
  running: "bg-success",
  paused: "bg-warning",
  exited: "bg-muted",
  other: "bg-warning",
};

export function Card({
  container: c,
  selected,
  onSelectChange,
  onOpen,
  onInvestigate,
}: {
  container: ContainerSummary;
  selected: boolean;
  onSelectChange: (checked: boolean) => void;
  onOpen: () => void;
  onInvestigate: () => void;
}) {
  const needsInvestigate = c.state !== "running";

  return (
    <div
      className={cn(
        "relative cursor-pointer rounded-lg border p-3 pl-8 transition-colors",
        selected ? "border-accent bg-accent/5" : "border-border hover:bg-border/20",
      )}
      onClick={onOpen}
    >
      <div
        className="absolute left-2.5 top-3.5"
        onClick={(e) => e.stopPropagation()}
      >
        <Checkbox checked={selected} onCheckedChange={(v) => onSelectChange(v === true)} aria-label="Select for bulk action" />
      </div>
      <div className="flex items-center gap-1.5">
        <span className={cn("h-2 w-2 shrink-0 rounded-full", DOT_CLASS[stateBucket(c.state)])} />
        <span className="truncate text-sm font-medium">{c.name}</span>
      </div>
      <div className="mt-0.5 truncate text-xs text-muted">{c.image}</div>
      <div className="mt-0.5 truncate text-xs text-muted">{c.status}</div>
      {needsInvestigate && (
        <Button
          size="sm"
          variant="outline"
          className="mt-2 border-warning text-warning hover:bg-warning/10"
          onClick={(e) => {
            e.stopPropagation();
            onInvestigate();
          }}
        >
          Investigate
        </Button>
      )}
    </div>
  );
}
