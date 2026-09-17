import { docker } from "../client.js";

export interface ContainerDetail {
  id: string;
  name: string;
  image: string;
  state: string;
  status: string;
  restartCount: number;
  startedAt: string | null;
  finishedAt: string | null;
  exitCode: number | null;
  // Env var *names* only, never values — inspect is a read-only tool whose
  // output becomes part of the model's context, and container env commonly
  // carries secrets (API keys, DB passwords). See design doc §9.
  envKeys: string[];
  mounts: { source: string; destination: string; mode: string }[];
  networks: string[];
  labels: Record<string, string>;
  ports: string[];
}

export async function inspectContainer(id: string): Promise<ContainerDetail> {
  const container = docker.getContainer(id);
  const data = await container.inspect();

  const envKeys = (data.Config.Env ?? []).map((entry) => entry.split("=")[0] ?? entry);
  const mounts = (data.Mounts ?? []).map((m) => ({
    source: m.Source,
    destination: m.Destination,
    mode: m.Mode ?? (m.RW ? "rw" : "ro"),
  }));
  const networks = Object.keys(data.NetworkSettings?.Networks ?? {});
  const ports = Object.entries(data.NetworkSettings?.Ports ?? {})
    .filter(([, bindings]) => bindings)
    .map(([containerPort, bindings]) =>
      (bindings ?? [])
        .map((b) => `${b.HostIp}:${b.HostPort}->${containerPort}`)
        .join(", "),
    );

  return {
    id: data.Id,
    name: data.Name.replace(/^\//, ""),
    image: data.Config.Image,
    state: data.State.Status,
    status: data.State.Running
      ? `Up since ${data.State.StartedAt}`
      : `Exited (${data.State.ExitCode})`,
    restartCount: data.RestartCount,
    startedAt: data.State.StartedAt ?? null,
    finishedAt: data.State.Running ? null : (data.State.FinishedAt ?? null),
    exitCode: data.State.Running ? null : data.State.ExitCode,
    envKeys,
    mounts,
    networks,
    labels: data.Config.Labels ?? {},
    ports,
  };
}
