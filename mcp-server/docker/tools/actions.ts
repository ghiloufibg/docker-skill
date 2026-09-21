import { docker } from "../client.js";

export interface ActionResult {
  id: string;
  state: string; // container state after the action, per a fresh inspect
}

export interface ComposeDownResult {
  project: string;
  removed: string[]; // container names, in the order they were torn down
}

async function currentState(id: string): Promise<string> {
  const info = await docker.getContainer(id).inspect();
  return info.State.Status;
}

// =============================================================================
// Tier 1 (design doc §4): low-risk mutate. Reversible, no data loss.
// =============================================================================

export async function startContainer(id: string): Promise<ActionResult> {
  await docker.getContainer(id).start();
  return { id, state: await currentState(id) };
}

export async function restartContainer(id: string): Promise<ActionResult> {
  await docker.getContainer(id).restart();
  return { id, state: await currentState(id) };
}

export async function pauseContainer(id: string): Promise<ActionResult> {
  await docker.getContainer(id).pause();
  return { id, state: await currentState(id) };
}

export async function unpauseContainer(id: string): Promise<ActionResult> {
  await docker.getContainer(id).unpause();
  return { id, state: await currentState(id) };
}

// =============================================================================
// Tier 2 (design doc §4): high-risk mutate. Off by default in the UI — see
// docker-dashboard.ts's confirm-dialog requirement, and §9's note that the
// UI-side confirm is enforced by the (sandboxed but not server-verified)
// iframe, not the server — the host's own MCP permission prompt is the
// backstop, not a redundant formality.
// =============================================================================

export async function stopContainer(id: string): Promise<ActionResult> {
  await docker.getContainer(id).stop();
  return { id, state: await currentState(id) };
}

export async function killContainer(id: string): Promise<ActionResult> {
  await docker.getContainer(id).kill();
  return { id, state: await currentState(id) };
}

// No `force` option exposed: removing a running container should fail
// loudly (Docker's default behavior) rather than silently stopping it
// first. If that turns out to be too strict in practice, add `force` as
// an explicit, separately-described parameter — never make it the default.
export async function removeContainer(id: string): Promise<{ id: string }> {
  await docker.getContainer(id).remove();
  return { id };
}

// A project-level "down", scoped deliberately narrower than `docker compose
// down`: it stops+removes every container carrying this
// com.docker.compose.project label, using the same dockerode calls as the
// per-container Tier 2 actions above. It does NOT shell out to the compose
// CLI or touch networks/volumes — the compose file path lives in a label
// (com.docker.compose.project.config_files) that's attacker-influenced
// input if it ever came from anything but our own docker-ps listing, and
// running an arbitrary CLI against an arbitrary path is a materially
// bigger blast radius than "stop and remove containers this server can
// already see and already has tools to stop/remove individually." If
// network/volume cleanup turns out to matter in practice, add it as its
// own explicit, separately-annotated tool — don't fold it in here.
export async function stopComposeProject(project: string): Promise<ComposeDownResult> {
  const containers = await docker.listContainers({
    all: true,
    filters: { label: [`com.docker.compose.project=${project}`] },
  });
  // Parallel, not sequential: found by load-testing this against 25 real
  // containers, not reasoned about in the abstract. Each container's own
  // .stop() pays Docker's default ~10s SIGTERM-then-SIGKILL grace period
  // whenever the container's PID 1 doesn't handle SIGTERM (the common
  // case — PID 1 gets no *default* disposition for a signal it hasn't
  // explicitly handled, unlike every other process) — stopping containers
  // one at a time summed those waits linearly and blew past the MCP
  // client's own 60s request timeout well before a 25-container project
  // finished, even though every container was, in fact, still being torn
  // down correctly in the background.
  //
  // This is safe to parallelize, unlike the dashboard's own bulk-action
  // loop (design doc §11 item 8), which deliberately stays sequential:
  // that sequencing exists to stop *separate* tool calls (one per
  // selected container) from racing each other's actionInFlight/refresh
  // cycle on the client side. This function is one already-atomic server
  // call tearing down one already-identified project — nothing observes
  // or refreshes state mid-way through it, so there's no equivalent race
  // to protect against by staying sequential here.
  const removed = await Promise.all(
    containers.map(async (c) => {
      const name = c.Names[0]?.replace(/^\//, "") ?? c.Id.slice(0, 12);
      const container = docker.getContainer(c.Id);
      if (c.State === "running" || c.State === "paused") {
        if (c.State === "paused") await container.unpause();
        await container.stop();
      }
      await container.remove();
      return name;
    }),
  );
  return { project, removed };
}
