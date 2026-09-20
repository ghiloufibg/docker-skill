import { z } from "zod";

export const SystemInfoSchema = z.object({
  hostname: z.string(),
  platform: z.string(),
  cpuModel: z.string(),
  cpuCount: z.number(),
  totalMemBytes: z.number(),
});
export type SystemInfo = z.infer<typeof SystemInfoSchema>;

export const DiskUsageSchema = z.object({
  path: z.string(),
  usedPercent: z.number(),
  totalBytes: z.number(),
  availableBytes: z.number(),
});
export type DiskUsage = z.infer<typeof DiskUsageSchema>;

export const GitStatusSchema = z.object({
  repoPath: z.string(),
  branch: z.string(),
  dirty: z.boolean(),
  aheadBehind: z.string(),
});
export type GitStatus = z.infer<typeof GitStatusSchema>;

// What system-info's ontoolresult push actually delivers — see
// src/lib/uiAppStore.ts for why this is the one boundary in this app
// worth a real schema instead of a cast.
export const SystemInfoResultSchema = z.object({
  system: SystemInfoSchema,
  disk: DiskUsageSchema,
  git: GitStatusSchema.nullable(),
  freeMemBytes: z.number(),
  uptimeSeconds: z.number(),
});
export type SystemInfoResult = z.infer<typeof SystemInfoResultSchema>;

export interface PollStats {
  disk: DiskUsage;
  freeMemBytes: number;
  uptimeSeconds: number;
  timestamp: string;
}
