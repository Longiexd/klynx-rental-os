import React from "react";
import { cn } from "@/lib/utils";

type CardProps = {
  children: React.ReactNode;
  className?: string;
};

// The one "panel" container for the whole app — sections, tables,
// lists all live inside one of these. Previously every page redefined
// `rounded-xl border border-border bg-surface` by hand.
export function Card({ children, className }: CardProps) {
  return (
    <div
      className={cn(
        "os-card overflow-hidden rounded-xl border border-border bg-surface",
        className
      )}
    >
      {children}
    </div>
  );
}

type CardHeaderProps = {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
};

// The header strip used at the top of nearly every Card — title,
// subtitle, and an optional "View all →" / action on the right.
export function CardHeader({ title, subtitle, action }: CardHeaderProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
      <div>
        <h2 className="text-sm font-semibold text-text">
          {title}
        </h2>

        {subtitle && (
          <p className="mt-1 text-[11px] text-muted">{subtitle}</p>
        )}
      </div>

      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
