import React from "react";

type EmptyStateProps = {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
};

// One consistent "nothing here yet" pattern for the whole app.
export function EmptyState({
  icon,
  title,
  description,
  action,
}: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-border bg-surface-secondary/50 px-4 py-10 text-center">
      {icon && (
        <div className="mb-1 text-muted [&_svg]:h-6 [&_svg]:w-6">{icon}</div>
      )}

      <div className="text-xs font-medium text-text-secondary">{title}</div>

      {description && (
        <p className="max-w-xs text-[11px] text-muted">{description}</p>
      )}

      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
