import React from "react";
import { cn } from "@/lib/utils";
import type { StatusTone } from "@/lib/status";

type StatCardProps = {
  icon: React.ReactNode;
  label: string;
  value: string;
  detail?: string;
  tone?: StatusTone;
  loading?: boolean;
};

const GLOW: Record<StatusTone, string> = {
  lime: "bg-lime/[0.10]",
  pink: "bg-pink/[0.10]",
  danger: "bg-danger/[0.10]",
  muted: "bg-muted/[0.10]",
  amber: "bg-amber-400/[0.10]",
  blue: "bg-blue-400/[0.10]",
  violet: "bg-violet-400/[0.10]",
};

const ICON_COLOR: Record<StatusTone, string> = {
  lime: "text-lime-ink",
  pink: "text-pink-ink",
  danger: "text-danger",
  muted: "text-muted",
  amber: "text-amber-400",
  blue: "text-blue-400",
  violet: "text-violet-400",
};

// The one KPI card definition for the whole app. Previously
// dashboard, customers, and fleet each shipped their own copy
// with slightly different spacing and font sizes.
export function StatCard({
  icon,
  label,
  value,
  detail,
  tone = "lime",
  loading = false,
}: StatCardProps) {
  return (
    <div className="os-card relative h-full min-w-0 overflow-hidden rounded-2xl border border-border bg-surface p-4 sm:p-5">
      <div className="relative">
        <div className="flex items-start justify-between gap-2 text-xs text-text-secondary">
          <span className="min-w-0 leading-5">{label}</span><span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg", GLOW[tone], ICON_COLOR[tone])}>{icon}</span>
        </div>
        <p className="mt-3 break-words text-2xl font-semibold leading-tight tracking-[-0.04em] text-text sm:text-[30px]">{loading ? "—" : value}</p>
        {detail && <p className="mt-2 text-xs text-muted">{detail}</p>}
      </div>
    </div>
  );
}
