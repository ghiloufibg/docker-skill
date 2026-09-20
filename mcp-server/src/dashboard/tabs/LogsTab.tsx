import { RefreshCw } from "lucide-react";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";

interface LogsTabProps {
  content: string;
  loading: boolean;
  live: boolean;
  liveStatus: string | null;
  onRefresh: () => void;
  onLiveChange: (on: boolean) => void;
}

export function LogsTab({ content, loading, live, liveStatus, onRefresh, onLiveChange }: LogsTabProps) {
  const preRef = React.useRef<HTMLPreElement>(null);
  React.useEffect(() => {
    if (live && preRef.current) preRef.current.scrollTop = preRef.current.scrollHeight;
  }, [content, live]);

  return (
    <div>
      <div className="mb-2 flex items-center gap-3">
        <Button size="sm" variant="outline" onClick={onRefresh} disabled={loading}>
          <RefreshCw className={loading ? "animate-spin" : ""} />
          Refresh
        </Button>
        <label className="flex items-center gap-1.5 text-xs text-muted">
          <Checkbox checked={live} onCheckedChange={(c) => onLiveChange(c === true)} />
          Live
        </label>
      </div>
      {liveStatus && <div className="mb-2 text-xs text-danger">{liveStatus}</div>}
      <pre
        ref={preRef}
        className="max-h-72 overflow-auto rounded-md border border-border bg-border/20 p-2 font-mono text-xs whitespace-pre-wrap break-words"
      >
        {content}
      </pre>
    </div>
  );
}
