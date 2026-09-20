export interface TimelineEntry {
  timestamp: string;
  event: string;
}

export interface EvidenceEntry {
  source: string;
  excerpt: string;
}

export type RemediationTool =
  | "docker-start"
  | "docker-restart"
  | "docker-pause"
  | "docker-unpause"
  | "docker-stop"
  | "docker-kill"
  | "docker-rm";

export interface RemediationAction {
  tool: RemediationTool;
  id: string;
}

export interface RemediationItem {
  description: string;
  action?: RemediationAction;
}

export interface InvestigationReport {
  subject: string;
  summary: string;
  rootCause: string;
  timeline: TimelineEntry[];
  evidence: EvidenceEntry[];
  suggestedRemediations: RemediationItem[];
}

// Same tiering as the dashboard's ACTION_DEFS (design doc §4) — Tier 1
// gets a plain confirm, Tier 2 requires re-typing the container name.
export const TIER1_TOOLS = new Set<RemediationTool>(["docker-start", "docker-restart", "docker-pause", "docker-unpause"]);

export const TOOL_LABELS: Record<RemediationTool, string> = {
  "docker-start": "Start",
  "docker-restart": "Restart",
  "docker-pause": "Pause",
  "docker-unpause": "Unpause",
  "docker-stop": "Stop",
  "docker-kill": "Kill",
  "docker-rm": "Remove",
};
