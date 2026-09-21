import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";
import "@testing-library/jest-dom/vitest";

// Not automatic under Vitest without `test.globals: true` (which we don't
// set, to avoid widening ambient types project-wide) — @testing-library's
// own auto-cleanup only registers itself when it detects a global
// `afterEach`, which isn't present here. Without this, every test's
// rendered tree (including anything Radix portals into document.body,
// e.g. ConfirmDialog's AlertDialog) would keep accumulating across tests
// in the same file.
afterEach(() => {
  cleanup();
});
