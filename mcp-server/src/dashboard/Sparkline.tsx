const MAX_STATS_HISTORY = 40;

export { MAX_STATS_HISTORY };

export function Sparkline({ history }: { history: { cpu: number; mem: number }[] }) {
  if (history.length < 2) return null;

  const toPoints = (key: "cpu" | "mem") =>
    history
      .map((s, i) => {
        const x = (i / (MAX_STATS_HISTORY - 1)) * 200;
        const y = 48 - (Math.min(s[key], 100) / 100) * 48;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");

  return (
    <div className="mt-2">
      <svg viewBox="0 0 200 48" preserveAspectRatio="none" className="h-12 w-full">
        <polyline points={toPoints("cpu")} fill="none" stroke="var(--accent)" strokeWidth="1.5" />
        <polyline points={toPoints("mem")} fill="none" stroke="var(--warning)" strokeWidth="1.5" />
      </svg>
      <div className="mt-1 flex gap-3 text-[11px] text-muted">
        <span className="before:mr-1 before:inline-block before:h-2 before:w-2 before:rounded-full before:bg-accent before:content-['']">
          CPU
        </span>
        <span className="before:mr-1 before:inline-block before:h-2 before:w-2 before:rounded-full before:bg-warning before:content-['']">
          Memory
        </span>
      </div>
    </div>
  );
}
