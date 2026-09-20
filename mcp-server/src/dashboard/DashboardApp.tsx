import { RefreshCw } from "lucide-react";
import * as React from "react";
import { toast, Toaster } from "sonner";
import { Button } from "@/components/ui/button";
import { BulkToolbar } from "./BulkToolbar";
import { CardList } from "./CardList";
import { CardListSkeleton } from "./CardListSkeleton";
import { useConfirm } from "./ConfirmDialog";
import { DetailPanel } from "./DetailPanel";
import { FleetToolbar } from "./FleetToolbar";
import { app, useIncomingContainers } from "./mcp";
import { STATE_SORT_RANK, stateBucket, type ActionDef, type ContainerSummary } from "./types";
import { useContainerDetail } from "./useContainerDetail";

type Status = { kind: "ok" | "error"; text: string } | null;

export function DashboardApp() {
  const incoming = useIncomingContainers();
  const [allContainers, setAllContainers] = React.useState<ContainerSummary[]>([]);
  const [hasLoadedOnce, setHasLoadedOnce] = React.useState(false);
  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(new Set());
  const [search, setSearch] = React.useState("");
  const [stateFilter, setStateFilter] = React.useState("all");
  const [sortBy, setSortBy] = React.useState("name");
  const [refreshing, setRefreshing] = React.useState(false);
  const [actionInFlight, setActionInFlight] = React.useState(false);
  const [fleetStatus, setFleetStatus] = React.useState<Status>(null);
  const [actionsStatus, setActionsStatus] = React.useState<Status>(null);

  const searchInputRef = React.useRef<HTMLInputElement>(null);
  const { confirm, dialog } = useConfirm();
  const detail = useContainerDetail();

  // Every docker-ps result (initial render, manual refresh, or the
  // refresh a bulk/project-down action triggers afterward) arrives through
  // the same SDK callback — bridge it into local state and reset the bulk
  // selection, matching the vanilla setContainers().
  React.useEffect(() => {
    if (incoming) {
      setAllContainers(incoming);
      setHasLoadedOnce(true);
      setSelectedIds(new Set());
    }
  }, [incoming]);

  // "/" focuses search (GitHub/Slack/Linear convention), skipped while
  // already typing into any input/textarea/select.
  React.useEffect(() => {
    function onKeydown(e: KeyboardEvent) {
      if (e.key !== "/") return;
      const active = document.activeElement;
      const isTyping = active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement || active instanceof HTMLSelectElement;
      if (isTyping) return;
      e.preventDefault();
      searchInputRef.current?.focus();
    }
    document.addEventListener("keydown", onKeydown);
    return () => document.removeEventListener("keydown", onKeydown);
  }, []);

  const filtered = React.useMemo(() => {
    const query = search.trim().toLowerCase();
    let result = allContainers.filter((c) => {
      if (query && !c.name.toLowerCase().includes(query) && !c.image.toLowerCase().includes(query)) return false;
      if (stateFilter !== "all" && stateBucket(c.state) !== stateFilter) return false;
      return true;
    });
    result = result.slice().sort((a, b) => {
      if (sortBy === "state") {
        const rankDiff = STATE_SORT_RANK[stateBucket(a.state)] - STATE_SORT_RANK[stateBucket(b.state)];
        if (rankDiff !== 0) return rankDiff;
        return a.name.localeCompare(b.name);
      }
      if (sortBy === "created") return b.createdAt.localeCompare(a.createdAt);
      return a.name.localeCompare(b.name);
    });
    return result;
  }, [allContainers, search, stateFilter, sortBy]);

  async function refreshCardList(): Promise<void> {
    setRefreshing(true);
    try {
      const result = await app.callServerTool({ name: "docker-ps", arguments: {} });
      if (result.isError) throw new Error("docker-ps returned an error");
      const payload = result.structuredContent as unknown as { containers: ContainerSummary[] };
      setAllContainers(payload.containers);
      setHasLoadedOnce(true);
      setSelectedIds(new Set());
    } catch (e) {
      console.error("Refresh failed:", e);
    } finally {
      setRefreshing(false);
    }
  }

  function toggleSelect(id: string, checked: boolean) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  async function investigate(c: ContainerSummary): Promise<void> {
    const prompt =
      `Container "${c.name}" (image ${c.image}) is not running ` +
      `(state: ${c.state}, status: ${c.status}${c.exitCode !== null ? `, exit code ${c.exitCode}` : ""}). ` +
      `Investigate why — prefer this server's docker-logs and docker-inspect ` +
      `tools if you have them (container id "${c.id}"), otherwise fall back ` +
      `to \`docker logs ${c.name}\` / \`docker inspect ${c.name}\` via Bash. ` +
      `Once you've actually looked, call this server's build-investigation-report ` +
      `tool with your findings (subject "${c.name}") instead of just replying ` +
      `in chat — root cause, the log lines/inspect fields you based it on as ` +
      `evidence, and remediation as suggestions only (never call a mutating ` +
      `docker-* tool yourself). If a suggestion maps directly to one of this ` +
      `server's own container actions (start/restart/pause/unpause/stop/kill/rm ` +
      `— tool name and this container's id "${c.id}"), include it as a ` +
      `structured action so the report can offer it as a button; the human ` +
      `still has to confirm it there before anything runs.`;
    try {
      const { isError } = await app.sendMessage(
        { role: "user", content: [{ type: "text", text: prompt }] },
        { signal: AbortSignal.timeout(5000) },
      );
      if (isError) console.error("Host rejected the investigate prompt");
    } catch (e) {
      console.error("sendMessage failed:", e);
    }
  }

  async function handleAction(def: ActionDef): Promise<void> {
    if (actionInFlight || !detail.containerId || !detail.detail) return;
    const id = detail.containerId;
    const containerName = detail.detail.name;

    const confirmed = await confirm({ title: `${def.label} "${containerName}"?`, tier: def.tier }, containerName);
    if (!confirmed) return;

    setActionInFlight(true);
    setActionsStatus(null);
    try {
      const result = await app.callServerTool({ name: def.tool, arguments: { id } });
      if (result.isError) throw new Error("tool returned an error");

      setActionsStatus({ kind: "ok", text: `${def.label} succeeded.` });
      toast.success(`${def.label} "${containerName}" succeeded.`, { duration: 3500 });

      await refreshCardList();

      if (def.tool === "docker-rm") {
        detail.close();
      } else {
        await detail.refresh();
      }
    } catch (e) {
      console.error(`${def.tool} failed:`, e);
      setActionsStatus({ kind: "error", text: `${def.label} failed — see console.` });
      toast.error(`${def.label} "${containerName}" failed — see console.`, { duration: 6000 });
    } finally {
      setActionInFlight(false);
    }
  }

  async function handleBulkAction(def: ActionDef, targets: ContainerSummary[]): Promise<void> {
    if (actionInFlight) return;
    const plural = targets.length === 1 ? "" : "s";
    const confirmed = await confirm(
      { title: `${def.label} ${targets.length} container${plural}?`, tier: def.tier, typeNoun: `number of containers (${targets.length})` },
      String(targets.length),
    );
    if (!confirmed) return;

    setActionInFlight(true);
    setFleetStatus(null);
    try {
      let succeeded = 0;
      const failed: string[] = [];
      // Sequential, not Promise.all — see design doc §11 item 8: avoids
      // reintroducing the concurrent-mutation race across several bulk
      // calls' own refreshes.
      for (const c of targets) {
        try {
          const result = await app.callServerTool({ name: def.tool, arguments: { id: c.id } });
          if (result.isError) throw new Error("tool returned an error");
          succeeded++;
        } catch (e) {
          console.error(`${def.tool} failed for ${c.name}:`, e);
          failed.push(c.name);
        }
      }

      if (failed.length === 0) {
        setFleetStatus({ kind: "ok", text: `${def.label} succeeded on all ${succeeded} container${plural}.` });
        toast.success(`${def.label} succeeded on all ${succeeded} container${plural}.`, { duration: 3500 });
      } else {
        const text = `${def.label} succeeded on ${succeeded}/${targets.length}; failed: ${failed.join(", ")} — see console.`;
        setFleetStatus({ kind: "error", text });
        toast.error(`${def.label}: ${succeeded}/${targets.length} succeeded, ${failed.length} failed.`, { duration: 6000 });
      }
      await refreshCardList();
    } finally {
      setActionInFlight(false);
    }
  }

  async function handleProjectDown(project: string, members: ContainerSummary[]): Promise<void> {
    if (actionInFlight) return;
    const plural = members.length === 1 ? "" : "s";
    const confirmed = await confirm(
      { title: `Tear down "${project}"? (${members.length} container${plural})`, tier: 2, typeNoun: "project name" },
      project,
    );
    if (!confirmed) return;

    setActionInFlight(true);
    setFleetStatus(null);
    try {
      const result = await app.callServerTool({ name: "docker-compose-down", arguments: { project } });
      if (result.isError) throw new Error("tool returned an error");

      setFleetStatus({ kind: "ok", text: `"${project}" torn down.` });
      toast.success(`"${project}" torn down.`, { duration: 3500 });

      if (detail.containerId && members.some((m) => m.id === detail.containerId)) {
        detail.close();
      }
      await refreshCardList();
    } catch (e) {
      console.error("docker-compose-down failed:", e);
      setFleetStatus({ kind: "error", text: `Tearing down "${project}" failed — see console.` });
      toast.error(`Tearing down "${project}" failed — see console.`, { duration: 6000 });
    } finally {
      setActionInFlight(false);
    }
  }

  const hasAnyContainers = allContainers.length > 0;
  const noMatches = hasAnyContainers && filtered.length === 0;
  const selected = allContainers.filter((c) => selectedIds.has(c.id));

  return (
    <main className="main mx-auto max-w-2xl p-4">
      <header className="mb-3 flex items-center justify-between">
        <h1 className="text-base font-semibold">Docker Fleet</h1>
        <Button variant="outline" size="sm" onClick={refreshCardList} disabled={refreshing}>
          <RefreshCw className={refreshing ? "animate-spin" : ""} />
          Refresh
        </Button>
      </header>

      <div className="mb-3">
        <FleetToolbar
          search={search}
          onSearchChange={setSearch}
          stateFilter={stateFilter}
          onStateFilterChange={setStateFilter}
          sortBy={sortBy}
          onSortByChange={setSortBy}
          searchInputRef={searchInputRef}
        />
      </div>

      <BulkToolbar selected={selected} onClear={() => setSelectedIds(new Set())} onAction={handleBulkAction} />

      {!hasAnyContainers && hasLoadedOnce && <div className="py-6 text-center text-sm text-muted">No containers found.</div>}
      {noMatches && <div className="py-6 text-center text-sm text-muted">No containers match the current search/filter.</div>}
      {fleetStatus && (
        <div className={`mb-3 text-xs ${fleetStatus.kind === "ok" ? "text-success" : "text-danger"}`}>{fleetStatus.text}</div>
      )}

      {!hasLoadedOnce ? (
        <CardListSkeleton />
      ) : (
        <CardList
          containers={filtered}
          selectedIds={selectedIds}
          onSelectChange={toggleSelect}
          onOpen={detail.open}
          onInvestigate={investigate}
          onProjectDown={handleProjectDown}
        />
      )}

      {detail.containerId && (
        <DetailPanel
          detailState={detail}
          actionInFlight={actionInFlight}
          actionsStatus={actionsStatus}
          onAction={handleAction}
          onClose={detail.close}
        />
      )}

      {dialog}
      <Toaster position="bottom-right" richColors closeButton />
    </main>
  );
}
