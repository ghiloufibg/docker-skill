import { createUiAppStore } from "@/lib/uiAppStore";
import { InvestigationReportSchema, type InvestigationReport } from "./types";

const store = createUiAppStore({ name: "Investigation Report", version: "0.1.0" }, InvestigationReportSchema);

export const app = store.app;

export function useIncomingReport(): InvestigationReport | null {
  return store.useIncoming();
}
