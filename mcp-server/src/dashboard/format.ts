export function formatBytes(bytes: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex++;
  }
  return `${value.toFixed(1)} ${units[unitIndex]}`;
}

export function formatCpuLimit(cores: number | null): string {
  if (cores === null) return "Unlimited";
  return `${cores % 1 === 0 ? cores : cores.toFixed(2)} core${cores === 1 ? "" : "s"}`;
}

export function barTone(percent: number): "danger" | "warning" | "accent" {
  if (percent >= 90) return "danger";
  if (percent >= 70) return "warning";
  return "accent";
}
