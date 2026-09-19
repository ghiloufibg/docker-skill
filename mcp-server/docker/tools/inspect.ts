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
  // null when the image defines no HEALTHCHECK — distinct from any real
  // status string ("starting"/"healthy"/"unhealthy"), so the UI can tell
  // "no healthcheck configured" apart from "healthcheck hasn't run yet."
  healthStatus: string | null;
  // null when Docker reports no limit (HostConfig value of 0, i.e.
  // "use everything the host has") — again distinct from an actual 0.
  cpuLimitCores: number | null;
  memLimitBytes: number | null;
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

  // NanoCpus (billionths of a CPU) is the modern `--cpus` flag; CpuQuota/
  // CpuPeriod is the older cgroup-v1-style `--cpu-quota`/`--cpu-period`
  // pair some tooling (including older compose files) still sets instead.
  // Either can be present with the other at 0 — check NanoCpus first since
  // it's the more common modern path, fall back to the quota/period ratio.
  const hostConfig = data.HostConfig;
  let cpuLimitCores: number | null = null;
  if (hostConfig.NanoCpus) {
    cpuLimitCores = hostConfig.NanoCpus / 1e9;
  } else if (hostConfig.CpuQuota && hostConfig.CpuPeriod) {
    cpuLimitCores = hostConfig.CpuQuota / hostConfig.CpuPeriod;
  }
  const memLimitBytes = hostConfig.Memory ? hostConfig.Memory : null;

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
    healthStatus: data.State.Health?.Status ?? null,
    cpuLimitCores,
    memLimitBytes,
  };
}
