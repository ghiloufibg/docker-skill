import * as React from "react";
import { app } from "./mcp";
import { MAX_STATS_HISTORY } from "./Sparkline";
import type { ContainerDetail, ContainerStats, ContainerSummary, StreamInfo, TabName } from "./types";

interface LogsState {
  content: string;
  loading: boolean;
  live: boolean;
  liveStatus: string | null;
}

interface StatsState {
  data: ContainerStats | null;
  status: string | null;
  live: boolean;
  history: { cpu: number; mem: number }[];
}

const INITIAL_LOGS: LogsState = { content: "--", loading: false, live: false, liveStatus: null };
const INITIAL_STATS: StatsState = { data: null, status: null, live: false, history: [] };

function streamUrl(info: StreamInfo, kind: "logs" | "stats", id: string): string {
  return `http://127.0.0.1:${info.port}/stream/${kind}/${encodeURIComponent(id)}?token=${encodeURIComponent(info.token)}`;
}

/**
 * Owns everything about the currently-open detail panel: which container,
 * its Inspect data, the active tab, and the optional live Logs/Stats
 * streams (design doc §11 item 5). This is a direct port of the vanilla
 * file's module-level currentContainerId/currentDetail/logs-and-stats
 * variables and their functions — same lifecycle rules, just owned by a
 * hook instead of top-level closures: closing/switching containers always
 * tears down any open EventSource (closeLiveStreams), a stream survives a
 * tab switch but not a container switch, and reconnecting on toggle-on
 * always clears prior sparkline history.
 */
export function useContainerDetail() {
  const [containerId, setContainerId] = React.useState<string | null>(null);
  const [containerName, setContainerName] = React.useState<string | null>(null);
  const [detail, setDetail] = React.useState<ContainerDetail | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [tab, setTabState] = React.useState<TabName>("inspect");
  const [logs, setLogs] = React.useState<LogsState>(INITIAL_LOGS);
  const [stats, setStats] = React.useState<StatsState>(INITIAL_STATS);

  const logsSourceRef = React.useRef<EventSource | null>(null);
  const statsSourceRef = React.useRef<EventSource | null>(null);
  const streamInfoRef = React.useRef<StreamInfo | null>(null);

  const closeLiveStreams = React.useCallback(() => {
    logsSourceRef.current?.close();
    logsSourceRef.current = null;
    statsSourceRef.current?.close();
    statsSourceRef.current = null;
    setLogs((s) => ({ ...s, live: false, liveStatus: null }));
    setStats((s) => ({ ...s, live: false, history: [] }));
  }, []);

  const getStreamInfo = React.useCallback(async (): Promise<StreamInfo | null> => {
    if (streamInfoRef.current) return streamInfoRef.current;
    try {
      const result = await app.callServerTool({ name: "stream-info", arguments: {} });
      if (result.isError) throw new Error("stream-info returned an error");
      streamInfoRef.current = result.structuredContent as unknown as StreamInfo;
      return streamInfoRef.current;
    } catch (e) {
      console.error("stream-info failed:", e);
      return null;
    }
  }, []);

  const refresh = React.useCallback(async (id: string) => {
    try {
      const result = await app.callServerTool({ name: "docker-inspect", arguments: { id } });
      if (result.isError) throw new Error("docker-inspect returned an error");
      setDetail(result.structuredContent as unknown as ContainerDetail);
    } catch (e) {
      console.error("docker-inspect failed:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  // Detail panel shows the clicked card's already-known name immediately
  // (optimistic UI, round 4) instead of stale previous-container data
  // while docker-inspect is still in flight.
  const open = React.useCallback(
    (c: ContainerSummary) => {
      closeLiveStreams();
      setContainerId(c.id);
      setContainerName(c.name);
      setDetail(null);
      setLoading(true);
      setLogs(INITIAL_LOGS);
      setStats(INITIAL_STATS);
      setTabState("inspect");
      void refresh(c.id);
    },
    [closeLiveStreams, refresh],
  );

  const close = React.useCallback(() => {
    closeLiveStreams();
    setContainerId(null);
    setContainerName(null);
    setDetail(null);
  }, [closeLiveStreams]);

  const loadLogs = React.useCallback(async () => {
    if (!containerId) return;
    setLogs((s) => ({ ...s, loading: true }));
    try {
      const result = await app.callServerTool({ name: "docker-logs", arguments: { id: containerId, tail: 100 } });
      if (result.isError) throw new Error("docker-logs returned an error");
      const { lines } = result.structuredContent as unknown as { lines: string[] };
      setLogs((s) => ({ ...s, loading: false, content: lines.length > 0 ? lines.join("\n") : "(no log output)" }));
    } catch (e) {
      console.error("docker-logs failed:", e);
      setLogs((s) => ({ ...s, loading: false, content: "[ERROR fetching logs]" }));
    }
  }, [containerId]);

  const loadStats = React.useCallback(async () => {
    if (!containerId) return;
    setStats((s) => ({ ...s, status: null }));
    try {
      const result = await app.callServerTool({ name: "docker-stats", arguments: { id: containerId } });
      if (result.isError) throw new Error("tool returned an error");
      const data = result.structuredContent as unknown as ContainerStats;
      setStats((s) => ({ ...s, data, status: null }));
    } catch (e) {
      // Expected for a stopped container — Docker's stats endpoint only
      // works on running ones. Not a bug: surface it plainly rather than
      // leaving stale/misleading bars on screen (design doc §12).
      console.error("docker-stats failed:", e);
      setStats((s) => ({ ...s, data: null, status: "Stats unavailable (container not running?)" }));
    }
  }, [containerId]);

  const setTab = React.useCallback(
    (t: TabName) => {
      setTabState(t);
      if (t === "logs") void loadLogs();
      if (t === "stats") void loadStats();
    },
    [loadLogs, loadStats],
  );

  const toggleLogsLive = React.useCallback(
    async (on: boolean) => {
      if (!on) {
        logsSourceRef.current?.close();
        logsSourceRef.current = null;
        setLogs((s) => ({ ...s, live: false, liveStatus: null }));
        return;
      }
      if (!containerId) return;
      const info = await getStreamInfo();
      if (!info) {
        setLogs((s) => ({ ...s, live: false, liveStatus: "Live unavailable — see console." }));
        return;
      }
      setLogs((s) => ({
        ...s,
        live: true,
        liveStatus: null,
        content: s.content === "(no log output)" || s.content === "--" ? "" : s.content,
      }));
      const source = new EventSource(streamUrl(info, "logs", containerId));
      logsSourceRef.current = source;
      source.onmessage = (ev) => {
        let data: { line?: string; error?: string };
        try {
          data = JSON.parse(ev.data) as { line?: string; error?: string };
        } catch {
          setLogs((s) => ({ ...s, liveStatus: "Live update dropped (malformed data)." }));
          return;
        }
        if (data.error) {
          setLogs((s) => ({ ...s, liveStatus: data.error ?? null }));
          return;
        }
        setLogs((s) => ({ ...s, content: s.content ? `${s.content}\n${data.line}` : (data.line ?? "") }));
      };
      source.onerror = () => {
        setLogs((s) => ({ ...s, live: false, liveStatus: "Live connection lost." }));
        source.close();
        if (logsSourceRef.current === source) logsSourceRef.current = null;
      };
    },
    [containerId, getStreamInfo],
  );

  const toggleStatsLive = React.useCallback(
    async (on: boolean) => {
      if (!on) {
        statsSourceRef.current?.close();
        statsSourceRef.current = null;
        setStats((s) => ({ ...s, live: false, history: [] }));
        return;
      }
      if (!containerId) return;
      const info = await getStreamInfo();
      if (!info) {
        setStats((s) => ({ ...s, live: false, status: "Live unavailable — see console." }));
        return;
      }
      setStats((s) => ({ ...s, live: true, history: [] }));
      const source = new EventSource(streamUrl(info, "stats", containerId));
      statsSourceRef.current = source;
      source.onmessage = (ev) => {
        let data: ContainerStats | { error: string };
        try {
          data = JSON.parse(ev.data) as ContainerStats | { error: string };
        } catch {
          setStats((s) => ({ ...s, status: "Live update dropped (malformed data)." }));
          return;
        }
        if ("error" in data) {
          setStats((s) => ({ ...s, status: data.error }));
          return;
        }
        setStats((s) => {
          const history = [...s.history, { cpu: data.cpuPercent, mem: data.memPercent }];
          if (history.length > MAX_STATS_HISTORY) history.shift();
          return { ...s, data, status: null, history };
        });
      };
      source.onerror = () => {
        setStats((s) => ({ ...s, live: false, status: "Live connection lost." }));
        source.close();
        if (statsSourceRef.current === source) statsSourceRef.current = null;
      };
    },
    [containerId, getStreamInfo],
  );

  // Belt-and-suspenders: close any open stream if the component unmounts
  // outright (e.g. the whole widget re-renders/unmounts for an unrelated
  // reason) — the explicit close()/open() paths above are the primary
  // mechanism, this just guarantees no dangling EventSource survives it.
  React.useEffect(() => closeLiveStreams, [closeLiveStreams]);

  return {
    containerId,
    containerName,
    detail,
    loading,
    tab,
    setTab,
    open,
    close,
    refresh: () => (containerId ? refresh(containerId) : Promise.resolve()),
    logs,
    stats,
    toggleLogsLive,
    toggleStatsLive,
    loadLogs,
    loadStats,
  };
}
