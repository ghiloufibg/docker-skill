// @ts-check
import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist/**", "dist-browser/**", "node_modules/**"] },
  js.configs.recommended,
  {
    // Type-aware linting for the real source: `projectService`'s auto-
    // discovery only recognizes files literally named "tsconfig.json"
    // while walking up from each linted file, which misses this project's
    // deliberately-named tsconfig.browser.json/tsconfig.test.json (see
    // each file's own doc comment for why they're split out rather than
    // one shared tsconfig) -- an explicit `project` array is the correct
    // typescript-eslint setup for a multi-tsconfig project shaped like
    // this one.
    files: ["src/**/*.ts", "test/**/*.ts"],
    extends: [...tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        project: ["./tsconfig.json", "./tsconfig.browser.json", "./tsconfig.test.json"],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Genuinely catches dead code and copy-paste leftovers; both are
      // errors elsewhere in this repo's own conventions (see server.ts's
      // Round 6 comments on not leaving things half-cleaned-up).
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      // This codebase deliberately uses `as never`/`as X` a handful of
      // times to cross an SDK type boundary the way the SDK's own docs
      // show (e.g. buildAllowAttribute in main.ts) -- banning `any`
      // outright would just push those into `@ts-expect-error` comments
      // instead, which hide more than they reveal. Keep the softer warning.
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },
  {
    // Root-level config file: real TypeScript, but not part of any
    // tsconfig's `include` and not worth a dedicated one for one file --
    // syntax-level linting only, no type-aware rules.
    files: ["vite.config.ts"],
    extends: [...tseslint.configs.recommended],
  },
);
