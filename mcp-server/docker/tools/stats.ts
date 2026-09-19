import { docker } from "../client.js";

export interface ContainerStats {
  cpuPercent: number;
  memUsageBytes: number;
  memLimitBytes: number;
  memPercent: number;
  netRxBytes: number;
  netTxBytes: number;
  pids: number;
}

// Docker's non-streaming stats endpoint (stream:false) still returns a
// cpu_stats/precpu_stats pair sampled a tick apart internally, so the usual
// two-sample CPU% formula works from a single call.
function computeCpuPercent(stats: any): number {
  const cpuDelta = stats.cpu_stats.cpu_usage.total_usage - stats.precpu_stats.cpu_usage.total_usage;
  const systemDelta = stats.cpu_stats.system_cpu_usage - (stats.precpu_stats.system_cpu_usage ?? 0);
  const onlineCpus = stats.cpu_stats.online_cpus ?? stats.cpu_stats.cpu_usage.percpu_usage?.length ?? 1;
  if (systemDelta <= 0 || cpuDelta < 0) return 0;
  return Math.round((cpuDelta / systemDelta) * onlineCpus * 10000) / 100;
}

// Shared between the one-shot tool below and the streaming sidecar
// (docker/stream/sidecar.ts), which gets the same raw per-tick JSON shape
// from dockerode's stream:true mode.
export function computeStatsFromRaw(stats: any): ContainerStats {
  const memUsageBytes = stats.memory_stats.usage ?? 0;
  const memLimitBytes = stats.memory_stats.limit ?? 0;
  const memPercent = memLimitBytes > 0 ? Math.round((memUsageBytes / memLimitBytes) * 10000) / 100 : 0;

  let netRxBytes = 0;
  let netTxBytes = 0;
  for (const iface of Object.values(stats.networks ?? {}) as any[]) {
    netRxBytes += iface.rx_bytes ?? 0;
    netTxBytes += iface.tx_bytes ?? 0;
  }

  return {
    cpuPercent: computeCpuPercent(stats),
    memUsageBytes,
    memLimitBytes,
    memPercent,
    netRxBytes,
    netTxBytes,
    pids: stats.pids_stats?.current ?? 0,
  };
}

export async function getContainerStats(id: string): Promise<ContainerStats> {
  const container = docker.getContainer(id);
  const stats = await container.stats({ stream: false });
  return computeStatsFromRaw(stats);
}
