// @ts-check
import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist/**", "dist-browser/**", "node_modules/**"] },
  js.configs.recommended,
  {
    // src/** (the React apps) and server.ts/index.ts/docker/**/test/**
    // (the Node server, plus everything it transitively imports) sit under
    // two different tsconfigs with different `lib`/`module` settings —
    // both are listed so projectService-style auto-discovery isn't needed
    // (it only recognizes files literally named "tsconfig.json" while
    // walking up directories, same gap browser-bridge's eslint.config.js
    // hit with its own split tsconfigs).
    files: ["src/**/*.ts", "src/**/*.tsx", "server.ts", "index.ts", "docker/**/*.ts", "test/**/*.ts"],
    extends: [...tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        project: ["./tsconfig.json", "./tsconfig.server.json"],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },
  {
    files: ["src/**/*.tsx", "src/**/*.ts"],
    plugins: { "react-hooks": reactHooks },
    rules: reactHooks.configs["recommended-latest"].rules,
  },
  {
    files: ["vite.config.ts"],
    extends: [...tseslint.configs.recommended],
  },
  {
    // test/smoke.ts asserts against `structuredContent`/`_meta` on live
    // results from a server that exports no result types to check against
    // (server.ts's only export is createServer) — the alternative to `any`
    // here isn't a real type, it's hand-modeling ~10 tool output shapes a
    // second time purely for compile-time noise in a file that already
    // runtime-asserts every field it touches (see its own `assert()`
    // calls), on values that never reach production code. `no-unsafe-*`
    // and the redundant-assertion check both exist to catch exactly the
    // failure mode this file's assertions already catch at runtime, so
    // they're relaxed here specifically — everywhere else in this project
    // (src/**, server.ts, docker/**) keeps the full type-aware set.
    // no-explicit-any stays on as a warning, not fully silenced.
    files: ["test/**/*.ts"],
    rules: {
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unnecessary-type-assertion": "off",
    },
  },
);
