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

  const resource = await client.readResource({ uri: resourceUri });
  const content = resource.contents[0];
  assert(content, "resource must have at least one content item");
  console.log("resource mimeType:", content.mimeType);
  assert(content.mimeType === RESOURCE_MIME_TYPE, `resource mimeType must be ${RESOURCE_MIME_TYPE}, got ${content.mimeType}`);
  assert("text" in content && typeof content.text === "string", "resource must be returned as text, not blob");
  const html = content.text;
  assert(html.includes("<html"), "resource text must be an HTML document");
  console.log(`resource HTML size: ${html.length} bytes`);

  await client.close();
  console.log("\nSMOKE TEST PASSED");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
