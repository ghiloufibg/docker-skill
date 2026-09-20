import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * A plain native <select>, styled to match the rest of the kit — not a
 * Radix Select. Keyboard/screen-reader behavior for a native select is
 * already correct out of the box; wrapping it in Radix would add a
 * portal/positioning layer for no accessibility gain here.
 */
export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, children, ...props }, ref) => (
    <select
      ref={ref}
      className={cn(
        "h-8 rounded-md border border-border bg-bg px-2 text-sm text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
        className,
      )}
      {...props}
    >
      {children}
    </select>
  ),
);
Select.displayName = "Select";
