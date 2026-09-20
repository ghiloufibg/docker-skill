import { barTone } from "./format";

const TONE_CLASS: Record<ReturnType<typeof barTone>, string> = {
  accent: "bg-accent",
  warning: "bg-warning",
  danger: "bg-danger",
};

export function StatBar({ label, percent, detail }: { label: string; percent: number; detail?: string }) {
  const tone = barTone(percent);
  return (
    <div>
      <div className="flex items-baseline justify-between text-xs text-muted">
        <span>{label}</span>
        <span className="font-mono text-fg">{percent}%</span>
      </div>
      <div className="mt-1 h-2 overflow-hidden rounded-full bg-border/60">
        <div
          className={`h-full rounded-full transition-[width] duration-300 ${TONE_CLASS[tone]}`}
          style={{ width: `${Math.min(percent, 100)}%` }}
        />
      </div>
      {detail && <div className="mt-0.5 text-[11px] text-muted">{detail}</div>}
    </div>
  );
}
