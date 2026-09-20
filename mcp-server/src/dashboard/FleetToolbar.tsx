import { Search } from "lucide-react";
import * as React from "react";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";

interface FleetToolbarProps {
  search: string;
  onSearchChange: (v: string) => void;
  stateFilter: string;
  onStateFilterChange: (v: string) => void;
  sortBy: string;
  onSortByChange: (v: string) => void;
  searchInputRef: React.RefObject<HTMLInputElement | null>;
}

export function FleetToolbar({
  search,
  onSearchChange,
  stateFilter,
  onStateFilterChange,
  sortBy,
  onSortByChange,
  searchInputRef,
}: FleetToolbarProps) {
  return (
    <div className="flex flex-wrap gap-2">
      <div className="relative min-w-[180px] flex-1">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" />
        <Input
          ref={searchInputRef}
          type="search"
          placeholder="Search name or image... (press / to focus)"
          aria-label="Search containers"
          className="pl-8"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape" && search) {
              e.stopPropagation();
              onSearchChange("");
            }
          }}
        />
      </div>
      <Select aria-label="Filter by state" value={stateFilter} onChange={(e) => onStateFilterChange(e.target.value)}>
        <option value="all">All states</option>
        <option value="running">Running</option>
        <option value="paused">Paused</option>
        <option value="exited">Exited</option>
        <option value="other">Other</option>
      </Select>
      <Select aria-label="Sort by" value={sortBy} onChange={(e) => onSortByChange(e.target.value)}>
        <option value="name">Sort: Name</option>
        <option value="state">Sort: State</option>
        <option value="created">Sort: Newest first</option>
      </Select>
    </div>
  );
}
