import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { formatBytes } from "../format";
import { Sparkline } from "../Sparkline";
import { StatBar } from "../StatBar";
import type { ContainerStats } from "../types";

interface StatsTabProps {
  data: ContainerStats | null;
  status: string | null;
  live: boolean;
  history: { cpu: number; mem: number }[];
  onRefresh: () => void;
  onLiveChange: (on: boolean) => void;
}

export function StatsTab({ data, status, live, history, onRefresh, onLiveChange }: StatsTabProps) {
  return (
    <div>
      <div className="mb-2 flex items-center gap-3">
        <Button size="sm" variant="outline" onClick={onRefresh}>
          <RefreshCw />
          Refresh
        </Button>
        <label className="flex items-center gap-1.5 text-xs text-muted">
          <Checkbox checked={live} onCheckedChange={(c) => onLiveChange(c === true)} />
          Live
        </label>
      </div>
      {status && <div className="mb-2 text-xs text-danger">{status}</div>}
      {data && (
        <div className="space-y-3">
          <StatBar label="CPU" percent={data.cpuPercent} />
          <StatBar
            label="Memory"
            percent={data.memPercent}
            detail={`${formatBytes(data.memUsageBytes)} / ${formatBytes(data.memLimitBytes)}`}
          />
          <div className="flex justify-between text-xs text-muted">
            <span>Net RX {formatBytes(data.netRxBytes)}</span>
            <span>Net TX {formatBytes(data.netTxBytes)}</span>
            <span>PIDs {data.pids}</span>
          </div>
          {live && <Sparkline history={history} />}
        </div>
      )}
    </div>
  );
}
