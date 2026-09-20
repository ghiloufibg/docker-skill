export interface SystemInfo {
  hostname: string;
  platform: string;
  cpuModel: string;
  cpuCount: number;
  totalMemBytes: number;
}
export interface DiskUsage {
  path: string;
  usedPercent: number;
  totalBytes: number;
  availableBytes: number;
}
export interface GitStatus {
  repoPath: string;
  branch: string;
  dirty: boolean;
  aheadBehind: string;
}
export interface SystemInfoResult {
  system: SystemInfo;
  disk: DiskUsage;
  git: GitStatus | null;
  freeMemBytes: number;
  uptimeSeconds: number;
}
export interface PollStats {
  disk: DiskUsage;
  freeMemBytes: number;
  uptimeSeconds: number;
  timestamp: string;
}
