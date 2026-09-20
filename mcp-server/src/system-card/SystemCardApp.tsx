import { RefreshCw } from "lucide-react";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { StatBar } from "@/dashboard/StatBar";
import { formatBytes, formatUptime } from "./format";
import { app, useSystemInfoResult } from "./mcp";
import type { DiskUsage, PollStats } from "./types";

const DISK_INVESTIGATE_THRESHOLD = 80;

export function SystemCardApp() {
  const incoming = useSystemInfoResult();

  const [disk, setDisk] = React.useState<DiskUsage | null>(null);
  const [freeMemBytes, setFreeMemBytes] = React.useState(0);
  const [totalMemBytes, setTotalMemBytes] = React.useState(0);
  const [uptime, setUptime] = React.useState("");
  const [refreshing, setRefreshing] = React.useState(false);
  const [investigating, setInvestigating] = React.useState(false);
  const repoPathRef = React.useRef("");

  const info = React.useMemo(() => {
    if (!incoming) return null;
    return {
      hostname: incoming.system.hostname,
      platform: incoming.system.platform,
      cpuSummary: `${incoming.system.cpuModel} (${incoming.system.cpuCount})`,
      gitSummary: incoming.git
        ? `${incoming.git.branch}${incoming.git.dirty ? " (dirty)" : ""} — ${incoming.git.aheadBehind}`
        : "not a git repository",
    };
  }, [incoming]);

  // See dashboard/DashboardApp.tsx's own incoming-sync block for why this
  // runs during render (React's documented "adjusting state when a prop
  // changes" pattern) via a `useState` marker rather than a useEffect.
  // repoPathRef can't move into this same branch, unlike the setState
  // calls below: react-hooks forbids writing `ref.current` during render
  // unconditionally, even gated behind "did incoming actually change" —
  // confirmed by the linter, not just assumed — so it keeps its own
  // effect instead, which is what a ref write with no accompanying
  // setState is actually for.
  const [prevIncoming, setPrevIncoming] = React.useState(incoming);
  if (incoming !== prevIncoming) {
    setPrevIncoming(incoming);
    if (incoming) {
      setTotalMemBytes(incoming.system.totalMemBytes);
      setDisk(incoming.disk);
      setFreeMemBytes(incoming.freeMemBytes);
      setUptime(formatUptime(incoming.uptimeSeconds));
    }
  }

  React.useEffect(() => {
    if (incoming) repoPathRef.current = incoming.git?.repoPath ?? "";
  }, [incoming]);

  async function refresh() {
    setRefreshing(true);
    try {
      const result = await app.callServerTool({ name: "system-poll", arguments: {} });
      if (result.isError) throw new Error("system-poll returned an error");
      const stats = result.structuredContent as PollStats;
      setDisk(stats.disk);
      setFreeMemBytes(stats.freeMemBytes);
      setUptime(formatUptime(stats.uptimeSeconds));
    } catch (e) {
      console.error("Refresh failed:", e);
    } finally {
      setRefreshing(false);
    }
  }

  async function investigate() {
    if (!disk) return;
    const prompt =
      `Disk usage on ${disk.path} looks high. Investigate what's consuming ` +
      `space on this machine (du/df are fine to use) and, if ${repoPathRef.current} is ` +
      `relevant, check whether build artifacts or git history there are a ` +
      `contributing factor. Once you've actually looked, call this server's ` +
      `build-investigation-report tool with your findings (subject "Disk ` +
      `usage on ${disk.path}") instead of just replying in chat — root cause, ` +
      `the commands/output you based it on as evidence, and what's safe to ` +
      `clean up as suggested remediation.`;
    setInvestigating(true);
    try {
      const { isError } = await app.sendMessage(
        { role: "user", content: [{ type: "text", text: prompt }] },
        { signal: AbortSignal.timeout(5000) },
      );
      if (isError) console.error("Host rejected the investigate prompt");
    } catch (e) {
      console.error("sendMessage failed:", e);
    } finally {
      setInvestigating(false);
    }
  }

  const memUsedPercent = totalMemBytes > 0 ? Math.round(((totalMemBytes - freeMemBytes) / totalMemBytes) * 100) : 0;
  const showInvestigate = disk !== null && disk.usedPercent >= DISK_INVESTIGATE_THRESHOLD;

  return (
    <main className="main mx-auto max-w-sm p-4">
      <header className="mb-3 flex items-center justify-between">
        <h1 className="text-base font-semibold">System</h1>
        <Button variant="outline" size="sm" onClick={() => void refresh()} disabled={refreshing}>
          <RefreshCw className={refreshing ? "animate-spin" : ""} />
          Refresh
        </Button>
      </header>

      {info && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-sm">
          <dt className="text-muted">Hostname</dt>
          <dd className="text-fg">{info.hostname}</dd>
          <dt className="text-muted">Platform</dt>
          <dd className="text-fg">{info.platform}</dd>
          <dt className="text-muted">CPU</dt>
          <dd className="text-fg">{info.cpuSummary}</dd>
          <dt className="text-muted">Uptime</dt>
          <dd className="text-fg">{uptime}</dd>
          <dt className="text-muted">Git</dt>
          <dd className="text-fg">{info.gitSummary}</dd>
        </dl>
      )}

      {disk && (
        <div className="mt-4 space-y-3">
          <StatBar
            label="Disk"
            percent={disk.usedPercent}
            detail={`${formatBytes(disk.availableBytes)} free of ${formatBytes(disk.totalBytes)}`}
          />
          <StatBar
            label="Memory"
            percent={memUsedPercent}
            detail={`${formatBytes(freeMemBytes)} free of ${formatBytes(totalMemBytes)}`}
          />
        </div>
      )}

      {showInvestigate && disk && (
        <div className="mt-4 rounded-lg border border-warning/50 bg-warning/10 p-3">
          <p className="mb-2 text-xs text-fg">
            Disk usage on {disk.path} is at {disk.usedPercent}%.
          </p>
          <Button
            size="sm"
            variant="outline"
            className="border-warning text-warning hover:bg-warning/10"
            onClick={() => void investigate()}
            disabled={investigating}
          >
            Investigate
          </Button>
        </div>
      )}
    </main>
  );
}
