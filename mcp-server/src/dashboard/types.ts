export interface ContainerSummary {
  id: string;
  name: string;
  image: string;
  state: string;
  status: string;
  createdAt: string;
  project: string | null;
  exitCode: number | null;
}

export interface ContainerDetail {
  id: string;
  name: string;
  image: string;
  state: string;
  status: string;
  restartCount: number;
  startedAt: string | null;
  finishedAt: string | null;
  exitCode: number | null;
  envKeys: string[];
  mounts: { source: string; destination: string; mode: string }[];
  networks: string[];
  labels: Record<string, string>;
  ports: string[];
  healthStatus: string | null;
  cpuLimitCores: number | null;
  memLimitBytes: number | null;
}

export interface ContainerStats {
  cpuPercent: number;
  memUsageBytes: number;
  memLimitBytes: number;
  memPercent: number;
  netRxBytes: number;
  netTxBytes: number;
  pids: number;
}

export interface StreamInfo {
  port: number;
  token: string;
}

export type TabName = "inspect" | "logs" | "stats" | "actions";

export interface ActionDef {
  tool: string;
  label: string;
  tier: 1 | 2;
  showIf: (state: string) => boolean;
}

// running < paused < other < exited feels like the useful triage order —
// what's live, then what's frozen, then everything else, stopped last.
export const STATE_SORT_RANK: Record<string, number> = { running: 0, paused: 1, other: 2, exited: 3 };

export function stateBucket(state: string): "running" | "paused" | "exited" | "other" {
  if (state === "running") return "running";
  if (state === "paused") return "paused";
  if (state === "exited" || state === "dead") return "exited";
  return "other";
}

export const ACTION_DEFS: ActionDef[] = [
  { tool: "docker-start", label: "Start", tier: 1, showIf: (s) => s !== "running" },
  { tool: "docker-restart", label: "Restart", tier: 1, showIf: (s) => s === "running" },
  { tool: "docker-pause", label: "Pause", tier: 1, showIf: (s) => s === "running" },
  { tool: "docker-unpause", label: "Unpause", tier: 1, showIf: (s) => s === "paused" },
  { tool: "docker-stop", label: "Stop", tier: 2, showIf: (s) => s === "running" || s === "paused" },
  { tool: "docker-kill", label: "Kill", tier: 2, showIf: (s) => s === "running" || s === "paused" },
  // No force option on docker-rm (design doc §9), so it's only offered once
  // the container is already stopped — matches the tool's own behavior
  // rather than offering a button that's guaranteed to fail.
  { tool: "docker-rm", label: "Remove", tier: 2, showIf: (s) => s !== "running" && s !== "paused" },
];
