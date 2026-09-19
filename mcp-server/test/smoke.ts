/**
 * Headless verification of the Stage-0 spike (design doc §5 in the staged
 * validation plan): spawns the built server over the real stdio transport,
 * lists tools, calls system-info and system-poll, and asserts the returned
 * resource actually matches the MCP Apps shape. This is the part we can
 * verify without a graphical host, regardless of whether the current
 * Claude Code CLI renders MCP Apps yet (docs/design/mcp-ui-docker-ops.md §12).
 */
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import path from "node:path";
import Docker from "dockerode";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`FAIL: ${message}`);
  }
}

async function assertHtmlResource(client: Client, uri: string): Promise<void> {
  const resource = await client.readResource({ uri });
  const content = resource.contents[0];
  assert(content, `resource ${uri} must have at least one content item`);
  assert(
    content.mimeType === RESOURCE_MIME_TYPE,
    `resource ${uri} mimeType must be ${RESOURCE_MIME_TYPE}, got ${content.mimeType}`,
  );
  assert("text" in content && typeof content.text === "string", `resource ${uri} must be returned as text, not blob`);
  const html = content.text;
  assert(html.includes("<html"), `resource ${uri} text must be an HTML document`);
  console.log(`resource ${uri}: mimeType ok, ${html.length} bytes`);
}

async function main() {
  const serverEntry = path.join(import.meta.dirname, "..", "index.js");
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverEntry],
  });
  const client = new Client({ name: "smoke-test-client", version: "0.1.0" });

  await client.connect(transport);
  console.log("connected to server");

  const { tools } = await client.listTools();
  const toolNames = tools.map((t) => t.name).sort();
  console.log("tools:", toolNames);
  assert(toolNames.includes("system-info"), "system-info tool must be registered");
  assert(toolNames.includes("system-poll"), "system-poll tool must be registered");

  const infoTool = tools.find((t) => t.name === "system-info")!;
  const resourceUri = (infoTool._meta as any)?.ui?.resourceUri;
  console.log("system-info _meta.ui.resourceUri:", resourceUri);
  assert(typeof resourceUri === "string" && resourceUri.startsWith("ui://"), "resourceUri must be a ui:// URI");

  const infoResult = await client.callTool({ name: "system-info", arguments: {} });
  assert(!infoResult.isError, "system-info call must not error");
  const info = infoResult.structuredContent as any;
  console.log("system-info structuredContent:", JSON.stringify(info, null, 2));
  assert(typeof info.system.hostname === "string", "hostname must be a string");
  assert(typeof info.disk.usedPercent === "number", "disk.usedPercent must be a number");

  const pollResult = await client.callTool({ name: "system-poll", arguments: {} });
  assert(!pollResult.isError, "system-poll call must not error");
  console.log("system-poll structuredContent:", JSON.stringify(pollResult.structuredContent, null, 2));

  await assertHtmlResource(client, resourceUri);

  // =============================================================================
  // Stage 1 (design doc §11 item 1): docker-ps / docker-inspect against the
  // real local Docker socket — not mocked. Skipped gracefully if no daemon
  // is reachable, since Stage 0's plumbing check shouldn't hard-fail on a
  // machine with no Docker running.
  // =============================================================================
  assert(toolNames.includes("docker-ps"), "docker-ps tool must be registered");
  assert(toolNames.includes("docker-inspect"), "docker-inspect tool must be registered");

  const psResult = await client.callTool({ name: "docker-ps", arguments: {} });
  if (psResult.isError) {
    console.warn("docker-ps errored (no Docker daemon reachable?) — skipping Stage 1 checks:", psResult.content);
  } else {
    const { containers } = psResult.structuredContent as any;
    console.log(`docker-ps: ${containers.length} container(s) found`);
    assert(Array.isArray(containers), "containers must be an array");

    if (containers.length > 0) {
      const first = containers[0];
      assert(typeof first.id === "string" && first.id.length > 0, "container id must be a non-empty string");
      assert(typeof first.state === "string", "container state must be a string");

      const inspectResult = await client.callTool({ name: "docker-inspect", arguments: { id: first.id } });
      assert(!inspectResult.isError, "docker-inspect call must not error");
      const detail = inspectResult.structuredContent as any;
      console.log("docker-inspect result for", first.name, ":", JSON.stringify(detail, null, 2));
      assert(detail.id === first.id, "inspect result id must match the requested container");
      assert(Array.isArray(detail.envKeys), "envKeys must be an array");
      for (const key of detail.envKeys) {
        assert(!key.includes("="), "envKeys must contain names only, never key=value pairs (no leaked values)");
      }

      const dashboardTool = tools.find((t) => t.name === "docker-ps")!;
      const dashboardUri = (dashboardTool._meta as any)?.ui?.resourceUri;
      await assertHtmlResource(client, dashboardUri);

      // =========================================================================
      // Stage 2 (design doc §11 item 2): docker-logs / docker-stats.
      // =========================================================================
      assert(toolNames.includes("docker-logs"), "docker-logs tool must be registered");
      assert(toolNames.includes("docker-stats"), "docker-stats tool must be registered");

      const exited = containers.find((c: any) => c.state === "exited");
      if (exited) {
        const logsResult = await client.callTool({ name: "docker-logs", arguments: { id: exited.id, tail: 50 } });
        assert(!logsResult.isError, "docker-logs call must not error");
        const { lines } = logsResult.structuredContent as any;
        console.log(`docker-logs for ${exited.name}:`, lines);
        assert(Array.isArray(lines), "logs lines must be an array");
        assert(lines.length > 0, "expected at least one log line from the exited test container");
      } else {
        console.warn("no exited container found — skipping docker-logs content check");
      }

      const running = containers.find((c: any) => c.state === "running");
      if (running) {
        const statsResult = await client.callTool({ name: "docker-stats", arguments: { id: running.id } });
        assert(!statsResult.isError, "docker-stats call must not error for a running container");
        const stats = statsResult.structuredContent as any;
        console.log(`docker-stats for ${running.name}:`, JSON.stringify(stats, null, 2));
        assert(typeof stats.cpuPercent === "number" && stats.cpuPercent >= 0, "cpuPercent must be a non-negative number");
        assert(typeof stats.memUsageBytes === "number" && stats.memUsageBytes > 0, "memUsageBytes must be positive");
      } else {
        console.warn("no running container found — skipping docker-stats check");
      }
    }
  }

  // =============================================================================
  // Stage 3 (design doc §11 item 3): build-investigation-report.
  // This tool doesn't gather data itself, so it works with no Docker daemon —
  // exercised unconditionally with representative sample data.
  // =============================================================================
  assert(toolNames.includes("build-investigation-report"), "build-investigation-report tool must be registered");

  const reportTool = tools.find((t) => t.name === "build-investigation-report")!;
  const reportUri = (reportTool._meta as any)?.ui?.resourceUri;
  assert(typeof reportUri === "string" && reportUri.startsWith("ui://"), "report resourceUri must be a ui:// URI");

  const sampleReport = {
    subject: "test-crashed",
    summary: "Container exits immediately with code 137, consistent with an OOM kill or explicit self-termination.",
    rootCause: "The process calls os.Exit(137) on startup — this is a deliberate exit, not a crash.",
    timeline: [
      { timestamp: "2026-09-17T14:22:29.081Z", event: "Container started" },
      { timestamp: "2026-09-17T14:22:29.187Z", event: "Process exited with code 137" },
    ],
    evidence: [
      { source: "docker-logs", excerpt: "crasher: simulating OOM-ish exit" },
      { source: "docker-inspect", excerpt: "ExitCode: 137, RestartCount: 0" },
    ],
    suggestedRemediations: [
      { description: "Check the application's own logs for the actual failure reason." },
      {
        description: "Restart it — deliberate exits like this are sometimes transient on this image.",
        action: { tool: "docker-restart", id: "test-crashed" },
      },
    ],
  };

  const reportResult = await client.callTool({ name: "build-investigation-report", arguments: sampleReport });
  assert(!reportResult.isError, "build-investigation-report call must not error");
  const reportEcho = reportResult.structuredContent as any;
  assert(reportEcho.subject === sampleReport.subject, "report structuredContent must echo the input");
  assert(reportEcho.timeline.length === 2, "report timeline must round-trip intact");
  assert(
    reportEcho.suggestedRemediations[1]?.action?.tool === "docker-restart",
    "a remediation item's structured action must round-trip intact",
  );
  console.log("build-investigation-report accepted sample report for:", reportEcho.subject);

  // A remediation action naming a tool outside the fixed enum (§ RemediationActionSchema
  // in server.ts) must be rejected by schema validation, not silently accepted —
  // this is the actual security boundary for agent-authored remediation suggestions.
  const badReport = { ...sampleReport, suggestedRemediations: [{ description: "x", action: { tool: "docker-compose-down", id: "y" } }] };
  const badResult = await client.callTool({ name: "build-investigation-report", arguments: badReport });
  assert(badResult.isError, "a remediation action tool outside the fixed enum must be rejected");
  console.log("build-investigation-report OK: out-of-enum remediation action rejected");

  await assertHtmlResource(client, reportUri);

  // =============================================================================
  // Stage 4 (design doc §11 item 4): gated mutating actions.
  // Runs against a dedicated, disposable container — not test-web/test-idle/
  // test-crashed, which the earlier read-only assertions rely on staying put
  // across repeated runs. Skipped gracefully if the local/sleeper:test image
  // from Stages 1-3's manual setup isn't present (see SKILL.md for how it
  // was built with no registry access).
  // =============================================================================
  for (const tool of ["docker-start", "docker-restart", "docker-pause", "docker-unpause", "docker-stop", "docker-kill", "docker-rm"]) {
    assert(toolNames.includes(tool), `${tool} tool must be registered`);
  }

  const docker = new Docker();
  const image = "local/sleeper:test";
  const images = await docker.listImages({ filters: JSON.stringify({ reference: [image] }) });
  if (images.length === 0) {
    console.warn(`${image} not found — skipping Stage 4 lifecycle checks (see SKILL.md to build it)`);
  } else {
    const lifecycleContainer = await docker.createContainer({
      Image: image,
      name: `docker-skill-smoke-lifecycle-${Date.now()}`,
    });
    const lifecycleId = lifecycleContainer.id;
    try {
      await lifecycleContainer.start();

      const pauseResult = await client.callTool({ name: "docker-pause", arguments: { id: lifecycleId } });
      assert(!pauseResult.isError, "docker-pause must not error");
      assert((pauseResult.structuredContent as any).state === "paused", "state must be 'paused' after docker-pause");

      const unpauseResult = await client.callTool({ name: "docker-unpause", arguments: { id: lifecycleId } });
      assert(!unpauseResult.isError, "docker-unpause must not error");
      assert((unpauseResult.structuredContent as any).state === "running", "state must be 'running' after docker-unpause");

      const restartResult = await client.callTool({ name: "docker-restart", arguments: { id: lifecycleId } });
      assert(!restartResult.isError, "docker-restart must not error");
      assert((restartResult.structuredContent as any).state === "running", "state must be 'running' after docker-restart");

      const killResult = await client.callTool({ name: "docker-kill", arguments: { id: lifecycleId } });
      assert(!killResult.isError, "docker-kill must not error");
      assert((killResult.structuredContent as any).state === "exited", "state must be 'exited' after docker-kill");

      const startResult = await client.callTool({ name: "docker-start", arguments: { id: lifecycleId } });
      assert(!startResult.isError, "docker-start must not error");
      assert((startResult.structuredContent as any).state === "running", "state must be 'running' after docker-start");

      const stopResult = await client.callTool({ name: "docker-stop", arguments: { id: lifecycleId } });
      assert(!stopResult.isError, "docker-stop must not error");
      assert((stopResult.structuredContent as any).state === "exited", "state must be 'exited' after docker-stop");

      const rmResult = await client.callTool({ name: "docker-rm", arguments: { id: lifecycleId } });
      assert(!rmResult.isError, "docker-rm must not error");
      console.log(`Stage 4 lifecycle OK: pause -> unpause -> restart -> kill -> start -> stop -> rm on ${lifecycleId.slice(0, 12)}`);

      // docker-rm actually removed it — confirm dockerode agrees, not just that the tool said so.
      const stillThere = await docker.listContainers({ all: true, filters: JSON.stringify({ id: [lifecycleId] }) });
      assert(stillThere.length === 0, "container must actually be gone after docker-rm");
    } finally {
      // Best-effort cleanup if an assertion threw mid-lifecycle — docker-rm
      // above already removed it on the happy path, so this is normally a no-op.
      await lifecycleContainer.remove({ force: true }).catch(() => {});
    }
  }

  // =============================================================================
  // Compose project view: docker-compose-down. Two disposable containers
  // sharing a fake com.docker.compose.project label, torn down via the tool
  // rather than the compose CLI (see docker/tools/actions.ts for why) —
  // confirms both actually get stopped+removed, not just the first.
  // =============================================================================
  assert(toolNames.includes("docker-compose-down"), "docker-compose-down tool must be registered");
  if (images.length === 0) {
    console.warn(`${image} not found — skipping compose-down check`);
  } else {
    const project = `smoke-compose-${Date.now()}`;
    const members = await Promise.all(
      [0, 1].map(async (i) => {
        const c = await docker.createContainer({
          Image: image,
          name: `docker-skill-smoke-compose-${Date.now()}-${i}`,
          Labels: { "com.docker.compose.project": project },
        });
        await c.start();
        return c;
      }),
    );
    try {
      const downResult = await client.callTool({ name: "docker-compose-down", arguments: { project } });
      assert(!downResult.isError, "docker-compose-down must not error");
      const removed = (downResult.structuredContent as any).removed as string[];
      assert(removed.length === 2, `docker-compose-down must report both containers removed, got ${removed.length}`);
      console.log(`docker-compose-down OK: tore down ${removed.length} containers in project "${project}"`);

      const stillThere = await docker.listContainers({
        all: true,
        filters: JSON.stringify({ label: [`com.docker.compose.project=${project}`] }),
      });
      assert(stillThere.length === 0, "all project containers must actually be gone after docker-compose-down");
    } finally {
      await Promise.all(members.map((c) => c.remove({ force: true }).catch(() => {})));
    }
  }

  // =============================================================================
  // Stage 5: the streaming sidecar. stream-info hands out the port+token;
  // this confirms the sidecar actually comes up and streams real events
  // for a running container, and that a wrong token is genuinely rejected
  // — not just that the tool call succeeds (see docker/stream/sidecar.ts
  // for the token's role).
  // =============================================================================
  assert(toolNames.includes("stream-info"), "stream-info tool must be registered");
  const running = await docker.listContainers({ filters: JSON.stringify({ status: ["running"] }) });
  if (running.length === 0) {
    console.warn("no running container — skipping streaming sidecar check");
  } else {
    const streamInfoResult = await client.callTool({ name: "stream-info", arguments: {} });
    assert(!streamInfoResult.isError, "stream-info must not error");
    const { port, token } = streamInfoResult.structuredContent as any;
    assert(typeof port === "number" && typeof token === "string" && token.length > 0, "stream-info must return a port and token");

    const statsUrl = `http://127.0.0.1:${port}/stream/stats/${running[0].Id}?token=${token}`;
    const firstEvent = await readOneSseEvent(statsUrl, 5000);
    assert(firstEvent !== null, "stats stream must emit at least one event within 5s");
    const parsed = JSON.parse(firstEvent!);
    assert(typeof parsed.cpuPercent === "number", "streamed stats event must look like ContainerStats");
    console.log(`streaming sidecar OK: live stats event received (cpuPercent=${parsed.cpuPercent})`);

    const wrongTokenRes = await fetch(`http://127.0.0.1:${port}/stream/stats/${running[0].Id}?token=wrong`);
    assert(wrongTokenRes.status === 403, `wrong token must be rejected with 403, got ${wrongTokenRes.status}`);
    console.log("streaming sidecar OK: wrong token rejected with 403");
  }

  await client.close();
  console.log("\nSMOKE TEST PASSED");
}

// Connects to an SSE endpoint, returns the `data:` payload of the first
// event received, or null if none arrives before `timeoutMs`. Aborts the
// underlying connection either way — this is a smoke check, not a
// long-lived subscriber.
async function readOneSseEvent(url: string, timeoutMs: number): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok || !res.body) return null;
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) return null;
      buffer += decoder.decode(value, { stream: true });
      const match = buffer.match(/^data: (.+)$/m);
      if (match) return match[1];
    }
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
