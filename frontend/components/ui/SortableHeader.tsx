import React from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";

export type SortDirection = "asc" | "desc";

function SortIcon({
  active,
  direction,
}: {
  active: boolean;
  direction: SortDirection;
}) {
  if (!active) {
    return <span className="text-muted">↕</span>;
  }

  return direction === "asc" ? (
    <ChevronUp size={12} className="text-lime-ink" />
  ) : (
    <ChevronDown size={12} className="text-lime-ink" />
  );
}

type SortableHeaderProps<K extends string> = {
  label: string;
  sortKey: K;
  currentKey: K;
  direction: SortDirection;
  onSort: (key: K) => void;
  align?: "left" | "right";
};

// Generic sortable <th> — click to sort, click again to flip
// direction. Used across fleet, leads, and any future table.
export function SortableHeader<K extends string>({
  label,
  sortKey,
  currentKey,
  direction,
  onSort,
  align = "left",
}: SortableHeaderProps<K>) {
  const active = currentKey === sortKey;

  return (
    <th
      className={cn(
        "px-5 py-3 font-medium",
        align === "right" ? "text-right" : "text-left"
      )}
    >
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={cn(
          "inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.12em] transition",
          active ? "text-lime-ink" : "text-muted hover:text-text-secondary"
        )}
      >
        {label}
        <SortIcon active={active} direction={direction} />
      </button>
    </th>
  );
}
