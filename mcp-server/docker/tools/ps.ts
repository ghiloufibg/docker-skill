import { docker } from "../client.js";

export interface ContainerSummary {
  id: string;
  name: string;
  image: string;
  state: string; // "running" | "exited" | "paused" | ...
  status: string; // dockerode's human string, e.g. "Up 2 minutes" / "Exited (137) 1 second ago"
  createdAt: string;
  project: string | null; // com.docker.compose.project label, if any
  exitCode: number | null;
}

export async function listContainers(): Promise<ContainerSummary[]> {
  const containers = await docker.listContainers({ all: true });
  return containers.map((c) => ({
    id: c.Id,
    name: c.Names[0]?.replace(/^\//, "") ?? c.Id.slice(0, 12),
    image: c.Image,
    state: c.State,
    status: c.Status,
    createdAt: new Date(c.Created * 1000).toISOString(),
    project: c.Labels?.["com.docker.compose.project"] ?? null,
    exitCode: parseExitCode(c.Status),
  }));
}

function parseExitCode(status: string): number | null {
  const match = status.match(/Exited \((\d+)\)/);
  return match ? Number(match[1]) : null;
}
