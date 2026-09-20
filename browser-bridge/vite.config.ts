import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "src", "browser");

export default defineConfig({
  root,
  base: "./",
  build: {
    outDir: path.join(__dirname, "dist-browser"),
    emptyOutDir: true,
    rollupOptions: { input: path.join(root, "wrapper.html") },
  },
  plugins: [viteSingleFile()],
});
