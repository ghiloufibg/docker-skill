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
    }
  }

  await client.close();
  console.log("\nSMOKE TEST PASSED");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
