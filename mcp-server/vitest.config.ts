import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vitest/config";

// Deliberately separate from vite.config.ts: that file throws if the INPUT
// env var isn't set (it drives which widget entry point to bundle) and
// pulls in the Tailwind plugin/singlefile inlining that a component test
// has no use for. This only needs the same "@/*" path alias.
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
  },
});
