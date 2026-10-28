import React from "react";
import { cn } from "@/lib/utils";
import { toneClasses, type StatusMeta } from "@/lib/status";

type StatusBadgeProps = {
  meta: StatusMeta;
  withDot?: boolean;
  className?: string;
};

// Renders any StatusMeta from lib/status.ts consistently.
// Usage: <StatusBadge meta={fleetStatusMeta(getFleetStatus(car))} />
export function StatusBadge({
  meta,
  withDot = true,
  className,
}: StatusBadgeProps) {
  const classes = toneClasses(meta.tone);

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-medium uppercase tracking-wide",
        classes.bg,
        classes.text,
        classes.border,
        className
      )}
    >
      {withDot && (
        <span className={cn("h-1.5 w-1.5 rounded-full", classes.dot)} />
      )}
      {meta.label}
    </span>
  );
}
