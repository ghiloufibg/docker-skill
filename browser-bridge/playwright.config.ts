import { defineConfig } from "@playwright/test";

// Rendering-level regression coverage for the one thing test/smoke.ts
// (protocol-only, no browser) and the mcp-server component tests (jsdom,
// no real sandboxed iframe) both stop short of: does a UI-enabled tool
// result actually render, with real data, inside a real browser, through
// the real bridge? Manual Playwright passes answered this before (see
// claudedocs/qa-report-claude-code-cli-e2e.md); this makes that check
// automated and repeatable instead of a one-off someone has to remember
// to redo by hand.
export default defineConfig({
  testDir: "./test/e2e",
  timeout: 30_000,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [["list"]],
  use: {
    headless: true,
  },
});
