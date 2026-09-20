import { X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ActionsTab } from "./tabs/ActionsTab";
import { InspectTab } from "./tabs/InspectTab";
import { LogsTab } from "./tabs/LogsTab";
import { StatsTab } from "./tabs/StatsTab";
import type { useContainerDetail } from "./useContainerDetail";
import type { ActionDef } from "./types";

function HealthBadge({ health }: { health: string | null }) {
  if (!health) return null;
  const variant = health === "healthy" ? "success" : health === "unhealthy" ? "danger" : "warning";
  return <Badge variant={variant}>{health}</Badge>;
}

interface DetailPanelProps {
  detailState: ReturnType<typeof useContainerDetail>;
  actionInFlight: boolean;
  actionsStatus: { kind: "ok" | "error"; text: string } | null;
  onAction: (def: ActionDef) => void;
  onClose: () => void;
}

export function DetailPanel({ detailState: d, actionInFlight, actionsStatus, onAction, onClose }: DetailPanelProps) {
  return (
    <section className="mt-4 rounded-lg border border-border bg-card p-3">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="flex flex-wrap items-center gap-2 text-sm font-semibold">
          {d.containerName}
          <HealthBadge health={d.detail?.healthStatus ?? null} />
        </h2>
        <Button size="sm" variant="ghost" onClick={onClose} aria-label="Close detail panel">
          <X />
        </Button>
      </div>

      <Tabs value={d.tab} onValueChange={(v) => d.setTab(v as typeof d.tab)}>
        <TabsList>
          <TabsTrigger value="inspect">Inspect</TabsTrigger>
          <TabsTrigger value="logs">Logs</TabsTrigger>
          <TabsTrigger value="stats">Stats</TabsTrigger>
          <TabsTrigger value="actions">Actions</TabsTrigger>
        </TabsList>

        <TabsContent value="inspect">
          <InspectTab detail={d.detail} loading={d.loading} />
        </TabsContent>
        <TabsContent value="logs">
          <LogsTab
            content={d.logs.content}
            loading={d.logs.loading}
            live={d.logs.live}
            liveStatus={d.logs.liveStatus}
            onRefresh={d.loadLogs}
            onLiveChange={d.toggleLogsLive}
          />
        </TabsContent>
        <TabsContent value="stats">
          <StatsTab
            data={d.stats.data}
            status={d.stats.status}
            live={d.stats.live}
            history={d.stats.history}
            onRefresh={d.loadStats}
            onLiveChange={d.toggleStatsLive}
          />
        </TabsContent>
        <TabsContent value="actions">
          <ActionsTab detail={d.detail} actionInFlight={actionInFlight} status={actionsStatus} onAction={onAction} />
        </TabsContent>
      </Tabs>
    </section>
  );
}
