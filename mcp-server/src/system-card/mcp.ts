import { createUiAppStore } from "@/lib/uiAppStore";
import { SystemInfoResultSchema, type SystemInfoResult } from "./types";

const store = createUiAppStore({ name: "Local System Card", version: "0.1.0" }, SystemInfoResultSchema);

export const app = store.app;

export function useSystemInfoResult(): SystemInfoResult | null {
  return store.useIncoming();
}
