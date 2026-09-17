import { docker } from "../client.js";

export interface ActionResult {
  id: string;
  state: string; // container state after the action, per a fresh inspect
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
