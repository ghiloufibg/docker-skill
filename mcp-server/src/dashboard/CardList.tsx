import { Button } from "@/components/ui/button";
import { Card } from "./Card";
import type { ContainerSummary } from "./types";

interface CardListProps {
  containers: ContainerSummary[];
  selectedIds: Set<string>;
  onSelectChange: (id: string, checked: boolean) => void;
  onOpen: (c: ContainerSummary) => void;
  onInvestigate: (c: ContainerSummary) => void;
  onProjectDown: (project: string, members: ContainerSummary[]) => void;
}

const GRID_CLASS = "grid grid-cols-1 gap-2 sm:grid-cols-2";

export function CardList({ containers, selectedIds, onSelectChange, onOpen, onInvestigate, onProjectDown }: CardListProps) {
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

  return (
    <div className="space-y-4">
      {[...projects.entries()].map(([project, members]) => (
        <div key={project} className="rounded-lg border border-border/70 p-2.5">
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="flex items-baseline gap-2">
              <span className="text-sm font-semibold">{project}</span>
              <span className="text-xs text-muted">
                {members.length} container{members.length === 1 ? "" : "s"}
              </span>
            </div>
            <Button size="sm" variant="danger" onClick={() => onProjectDown(project, members)}>
              Down
            </Button>
          </div>
          <div className={GRID_CLASS}>
            {members.map((c) => (
              <Card
                key={c.id}
                container={c}
                selected={selectedIds.has(c.id)}
                onSelectChange={(checked) => onSelectChange(c.id, checked)}
                onOpen={() => onOpen(c)}
                onInvestigate={() => onInvestigate(c)}
              />
            ))}
          </div>
        </div>
      ))}

      {standalone.length > 0 && (
        <div className={GRID_CLASS}>
          {standalone.map((c) => (
            <Card
              key={c.id}
              container={c}
              selected={selectedIds.has(c.id)}
              onSelectChange={(checked) => onSelectChange(c.id, checked)}
              onOpen={() => onOpen(c)}
              onInvestigate={() => onInvestigate(c)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
