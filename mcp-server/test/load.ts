/**
 * Opt-in scale check — not part of `npm run smoke` or CI (both run on every
 * push/commit; this is heavier and creates real, if disposable, containers).
 * Answers the one thing test/smoke.ts's single-container Stage 4 lifecycle
 * check can't: does docker-ps, sequential bulk actions (design doc §11 item
 * 8's "sequential, not concurrent" rule — mirrored here exactly as
 * DashboardApp.tsx's handleBulkAction does it), and docker-compose-down
 * still behave correctly against a real multi-container fleet, not just one
 * container?
 *
 * Every container this creates carries a distinctive name prefix AND the
 * com.docker.compose.project label below — both used for cleanup, and the
 * label doubles as proof docker-compose-down itself handles N containers
 * correctly, not just the 2 in test/smoke.ts's own compose check. Runs
 * against whatever Docker daemon is configured (this machine's real one,
 * likely with real unrelated containers already on it) — this file never
 * touches any container it didn't create itself, and the try/finally below
 * force-removes every container carrying LOAD_TEST_PROJECT even if an
 * assertion throws mid-run, so a failed run can't leave containers behind.
 */
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import path from "node:path";
import Docker from "dockerode";

const LOAD_TEST_COUNT = 25;
const LOAD_TEST_IMAGE = "busybox:1.31.1"; // 1.2MB — already present on any machine that's run this repo's own smoke test image pulls, and on most dev machines generally
const LOAD_TEST_PROJECT = "docker-skill-loadtest";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FAIL: ${message}`);
}

async function forceCleanup(docker: Docker): Promise<number> {
  const survivors = await docker.listContainers({
    all: true,
    filters: { label: [`com.docker.compose.project=${LOAD_TEST_PROJECT}`] },
  });
  for (const c of survivors) {
    await docker
      .getContainer(c.Id)
      .remove({ force: true })
      .catch(() => undefined);
  }
  return survivors.length;
}

async function main(): Promise<void> {
  const docker = new Docker();
  const serverEntry = path.join(import.meta.dirname, "..", "index.js");
  const transport = new StdioClientTransport({ command: process.execPath, args: [serverEntry] });
  const client = new Client({ name: "load-test-client", version: "0.1.0" });
  await client.connect(transport);
  console.log(`connected to server — creating ${LOAD_TEST_COUNT} disposable ${LOAD_TEST_IMAGE} containers`);

  const createdIds: string[] = [];
  try {
    for (let i = 0; i < LOAD_TEST_COUNT; i++) {
      const container = await docker.createContainer({
        Image: LOAD_TEST_IMAGE,
        name: `docker-skill-loadtest-${i}-${Date.now()}`,
        Cmd: ["sleep", "3600"],
        Labels: { "com.docker.compose.project": LOAD_TEST_PROJECT },
      });
      await container.start();
      createdIds.push(container.id);
    }
    console.log(`created and started ${createdIds.length} containers`);

    // --- docker-ps against a real fleet with this batch mixed into whatever
    // else is already running on this daemon ---
    const psStart = Date.now();
    const psResult = await client.callTool({ name: "docker-ps", arguments: {} });
    const psMs = Date.now() - psStart;
    assert(!psResult.isError, "docker-ps must not error against a larger fleet");
    const { containers } = psResult.structuredContent as { containers: { id: string; project: string | null }[] };
    const seen = new Set(containers.map((c) => c.id));
    for (const id of createdIds) assert(seen.has(id), `docker-ps must list load-test container ${id.slice(0, 12)}`);
    assert(
      containers.filter((c) => c.project === LOAD_TEST_PROJECT).length === LOAD_TEST_COUNT,
      "all load-test containers must report the load-test compose project",
    );
    console.log(`docker-ps OK: ${containers.length} total containers listed (incl. ${LOAD_TEST_COUNT} load-test ones) in ${psMs}ms`);

    // --- Sequential bulk actions: same execution shape as
    // DashboardApp.tsx's handleBulkAction (design doc §11 item 8) — one
    // tool call at a time, not Promise.all, specifically to avoid the
    // concurrent-mutation race that guard exists for. Proving it holds at
    // N=25 is the actual point of this file. ---
    const pauseStart = Date.now();
    for (const id of createdIds) {
      const r = await client.callTool({ name: "docker-pause", arguments: { id } });
      assert(!r.isError, `docker-pause must not error for ${id.slice(0, 12)}`);
      assert((r.structuredContent as { state: string }).state === "paused", `${id.slice(0, 12)} must report paused`);
    }
    console.log(`sequential docker-pause OK: ${createdIds.length} containers in ${Date.now() - pauseStart}ms`);

    const unpauseStart = Date.now();
    for (const id of createdIds) {
      const r = await client.callTool({ name: "docker-unpause", arguments: { id } });
      assert(!r.isError, `docker-unpause must not error for ${id.slice(0, 12)}`);
      assert((r.structuredContent as { state: string }).state === "running", `${id.slice(0, 12)} must report running`);
    }
    console.log(`sequential docker-unpause OK: ${createdIds.length} containers in ${Date.now() - unpauseStart}ms`);

    // --- docker-compose-down at N=25, not the 2 in test/smoke.ts's own
    // compose check — same tool, larger fleet. ---
    const downStart = Date.now();
    const downResult = await client.callTool({ name: "docker-compose-down", arguments: { project: LOAD_TEST_PROJECT } });
    assert(!downResult.isError, "docker-compose-down must not error");
    const { removed } = downResult.structuredContent as { removed: string[] };
    assert(removed.length === LOAD_TEST_COUNT, `docker-compose-down must report all ${LOAD_TEST_COUNT} removed, got ${removed.length}`);
    console.log(`docker-compose-down OK: tore down ${removed.length} containers in ${Date.now() - downStart}ms`);

    const stillThere = await docker.listContainers({
      all: true,
      filters: { label: [`com.docker.compose.project=${LOAD_TEST_PROJECT}`] },
    });
    assert(stillThere.length === 0, "all load-test containers must actually be gone after docker-compose-down");

    console.log("\nLOAD TEST PASSED — docker-ps/sequential bulk actions/docker-compose-down all held up at N=25");
  } finally {
    const leftover = await forceCleanup(docker);
    if (leftover > 0) console.error(`cleanup: force-removed ${leftover} leftover load-test container(s)`);
    await client.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
