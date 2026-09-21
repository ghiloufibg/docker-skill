/**
 * Rendering-level regression test: proves a UI-enabled tool result actually
 * renders as a working interactive widget inside a real browser, through
 * the real bridge — not just that the protocol round-trip succeeds
 * (test/smoke.ts) or that a component behaves correctly in jsdom
 * (mcp-server's ConfirmDialog.test.tsx). Every prior verification of this
 * ("does it render") was a manual Playwright pass someone ran by hand and
 * wrote up (claudedocs/qa-report-claude-code-cli-e2e.md, design doc §12);
 * this is that same check, automated so it can't silently rot.
 *
 * Uses build-investigation-report as the tool under test, same choice and
 * same reason as test/smoke.ts: it needs neither Docker nor a live
 * container, so this test runs anywhere the two packages are built.
 *
 * Prerequisite (not run automatically, matching test/smoke.ts's own
 * documented prerequisite): `cd ../mcp-server && npm run build`, then
 * `npm run build` here, before `npm run test:e2e`.
 */
import { test, expect } from "@playwright/test";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BRIDGE_ENTRY = path.join(__dirname, "..", "..", "dist", "cli.js");
const TARGET_SERVER = path.join(__dirname, "..", "..", "..", "mcp-server", "dist", "index.js");

const SAMPLE_REPORT = {
  subject: "e2e-rendering-test",
  summary: "Playwright rendering regression check — real browser, real MCP round trip.",
  rootCause: "N/A — this is a rendering smoke check, not a real investigation.",
  timeline: [{ timestamp: new Date().toISOString(), event: "Test started" }],
  evidence: [{ source: "playwright", excerpt: "n/a" }],
  suggestedRemediations: [
    { description: "Plain suggestion, no button." },
    {
      description: "Restart it (renders a Run button — Tier 1, plain confirm).",
      action: { tool: "docker-restart", id: "e2e-test-container" },
    },
  ],
};

test("build-investigation-report renders real data in a real browser, and the Run/confirm mechanism works", async ({
  page,
}) => {
  const client = new Client({ name: "e2e-rendering-test", version: "0.1.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [BRIDGE_ENTRY, "--no-open", "--", "node", TARGET_SERVER],
  });
  await client.connect(transport);

  try {
    const result = await client.callTool({ name: "build-investigation-report", arguments: SAMPLE_REPORT });
    expect(result.isError).toBeFalsy();

    const linkBlock = result.content.find((c) => c.type === "text" && c.text.includes("http://127.0.0.1"));
    expect(linkBlock?.type).toBe("text");
    const match = (linkBlock as { text: string }).text.match(
      /http:\/\/127\.0\.0\.1:\d+\/app\/[a-f0-9-]+\?token=[\w-]+/,
    );
    expect(match, "tool result must contain a well-formed session URL").not.toBeNull();
    const sessionUrl = match![0];

    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    const pageErrors: string[] = [];
    page.on("pageerror", (err) => pageErrors.push(err.message));

    await page.goto(sessionUrl);

    // The wrapper page's #status flips to the "ready" class only after the
    // AppBridge handshake completes and sendToolResult was accepted (see
    // browser/main.ts's bridge.oninitialized) — this is the actual proof
    // the widget booted, not just that the HTTP response was 200.
    await expect(page.locator("#status")).toHaveClass(/ready/, { timeout: 15_000 });

    // The widget renders inside a sandboxed srcdoc iframe (browser/main.ts) —
    // real content, not the wrapper page, lives here.
    const widget = page.frameLocator("#frame-wrap iframe");
    await expect(widget.locator("h1")).toHaveText(SAMPLE_REPORT.subject);
    await expect(widget.getByText(SAMPLE_REPORT.summary)).toBeVisible();
    await expect(widget.getByText(SAMPLE_REPORT.rootCause)).toBeVisible();

    // The plain-text remediation has no button; the structured-action one
    // does (ReportApp.tsx: `{item.action && (<Button>Run</Button>)}`).
    const runButtons = widget.getByRole("button", { name: "Run" });
    await expect(runButtons).toHaveCount(1);

    // Click through to the real Tier 1 confirm dialog (ConfirmDialog.tsx,
    // rendered inside this same iframe, source-shared with the dashboard —
    // see investigation-report.tsx's own comment on why that's safe) and
    // cancel rather than confirm, so this test never actually calls
    // docker-restart against a container that doesn't exist.
    await runButtons.click();
    await expect(widget.getByRole("alertdialog")).toBeVisible();
    await expect(widget.getByRole("button", { name: "Cancel" })).toBeFocused();
    await widget.getByRole("button", { name: "Cancel" }).click();
    await expect(widget.getByRole("alertdialog")).toBeHidden();
    // Cancelling must not have triggered the action — the button stays
    // "Run", never flips to "Done" (see ReportApp.tsx's doneTools state).
    await expect(widget.getByRole("button", { name: "Run" })).toBeVisible();

    expect(consoleErrors, `unexpected console.error(s): ${consoleErrors.join("; ")}`).toEqual([]);
    expect(pageErrors, `unexpected uncaught page error(s): ${pageErrors.join("; ")}`).toEqual([]);
  } finally {
    await client.close();
  }
});
