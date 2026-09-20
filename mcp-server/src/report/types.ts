import { z } from "zod";

export const TimelineEntrySchema = z.object({ timestamp: z.string(), event: z.string() });
export type TimelineEntry = z.infer<typeof TimelineEntrySchema>;

export const EvidenceEntrySchema = z.object({ source: z.string(), excerpt: z.string() });
export type EvidenceEntry = z.infer<typeof EvidenceEntrySchema>;

export const RemediationToolSchema = z.enum([
  "docker-start",
  "docker-restart",
  "docker-pause",
  "docker-unpause",
  "docker-stop",
  "docker-kill",
  "docker-rm",
]);
export type RemediationTool = z.infer<typeof RemediationToolSchema>;

export const RemediationActionSchema = z.object({ tool: RemediationToolSchema, id: z.string() });
export type RemediationAction = z.infer<typeof RemediationActionSchema>;

export const RemediationItemSchema = z.object({
  description: z.string(),
  action: RemediationActionSchema.optional(),
});
export type RemediationItem = z.infer<typeof RemediationItemSchema>;

// What build-investigation-report's ontoolresult push actually delivers —
// see src/lib/uiAppStore.ts for why this is the one boundary in this app
// worth a real schema instead of a cast.
export const InvestigationReportSchema = z.object({
  subject: z.string(),
  summary: z.string(),
  rootCause: z.string(),
  timeline: z.array(TimelineEntrySchema),
  evidence: z.array(EvidenceEntrySchema),
  suggestedRemediations: z.array(RemediationItemSchema),
});
export type InvestigationReport = z.infer<typeof InvestigationReportSchema>;

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
