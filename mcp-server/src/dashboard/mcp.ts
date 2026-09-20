import { createUiAppStore } from "@/lib/uiAppStore";
import { DockerPsResultSchema, type ContainerSummary } from "./types";

const store = createUiAppStore({ name: "Docker Fleet Dashboard", version: "0.1.0" }, DockerPsResultSchema);

export const app = store.app;

export function useIncomingContainers(): ContainerSummary[] | null {
  return store.useIncoming()?.containers ?? null;
}
