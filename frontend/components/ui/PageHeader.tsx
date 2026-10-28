import React from "react";

type PageHeaderProps = {
  breadcrumb?: string;
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
};

// One consistent title/size/breadcrumb pattern for every page.
// Previously each page invented its own heading size (26px, 28px,
// text-3xl...) — this is now the only place that decision lives.
export function PageHeader({
  breadcrumb,
  title,
  subtitle,
  action,
}: PageHeaderProps) {
  return (
    <section className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
      <div>
        {breadcrumb && (
          <div className="mb-2 flex items-center gap-2 text-[11px] text-muted">
            <span>Workspace</span>
            <span>/</span>
            <span className="text-text-secondary">{breadcrumb}</span>
          </div>
        )}

        <h1 className="text-[26px] font-semibold leading-tight tracking-[-0.04em] text-text sm:text-[30px]">
          {title}
        </h1>

        {subtitle && (
          <p className="mt-1 text-sm text-muted">{subtitle}</p>
        )}
      </div>

      {action && <div className="shrink-0">{action}</div>}
    </section>
  );
}
