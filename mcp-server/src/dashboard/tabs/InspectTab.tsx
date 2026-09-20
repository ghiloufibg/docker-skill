import { Skeleton } from "@/components/ui/skeleton";
import { formatBytes, formatCpuLimit } from "../format";
import type { ContainerDetail } from "../types";

function Section({ label }: { label: string }) {
  return <dt className="col-span-2 mt-3 border-t border-border pt-2 text-[11px] font-semibold uppercase tracking-wide text-muted first:mt-0 first:border-0 first:pt-0">{label}</dt>;
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <>
      <dt className="text-muted">{label}</dt>
      <dd className="break-words text-fg">{value}</dd>
    </>
  );
}

export function InspectTab({ detail, loading }: { detail: ContainerDetail | null; loading: boolean }) {
  if (loading || !detail) {
    return (
      <div className="space-y-2 py-1">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-4 w-full" />
        ))}
      </div>
    );
  }

  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-sm">
      <Section label="Status" />
      <Row label="State" value={detail.status} />
      <Row label="Image" value={detail.image} />
      <Row label="Restarts" value={detail.restartCount} />

      <Section label="Resource limits" />
      <Row label="CPU" value={formatCpuLimit(detail.cpuLimitCores)} />
      <Row label="Memory" value={detail.memLimitBytes === null ? "Unlimited" : formatBytes(detail.memLimitBytes)} />

      <Section label="Network" />
      <Row label="Networks" value={detail.networks.join(", ") || "--"} />
      <Row label="Ports" value={detail.ports.join(", ") || "--"} />

      <Section label="Storage" />
      <Row
        label="Mounts"
        value={
          detail.mounts.length > 0
            ? detail.mounts.map((m, i) => (
                <div key={i}>
                  {m.source} → {m.destination} ({m.mode})
                </div>
              ))
            : "--"
        }
      />

      <Section label="Metadata" />
      <Row label="Env vars (names only)" value={detail.envKeys.join(", ") || "--"} />
      <Row
        label="Labels"
        value={
          Object.entries(detail.labels).length > 0
            ? Object.entries(detail.labels).map(([k, v]) => <div key={k}>{k}={v}</div>)
            : "--"
        }
      />
    </dl>
  );
}
