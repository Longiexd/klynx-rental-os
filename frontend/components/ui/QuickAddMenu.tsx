"use client";

import React, { useEffect, useRef, useState } from "react";
import { ChevronDown, Plus } from "lucide-react";
import { cn } from "@/lib/utils";

export type QuickAddAction = {
  label: string;
  description?: string;
  icon: React.ReactNode;
  onClick: () => void;
};

type QuickAddMenuProps = {
  actions: QuickAddAction[];
  label?: string;
};

// The one "start something new" entry point for the whole app.
// A sales agent should never have to remember which page has the
// "add" button — this is always in the same place, top-right.
export function QuickAddMenu({
  actions,
  label = "New",
}: QuickAddMenuProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        ref.current &&
        !ref.current.contains(event.target as Node)
      ) {
        setOpen(false);
      }
    }

    document.addEventListener(
      "mousedown",
      handleClickOutside
    );

    return () =>
      document.removeEventListener(
        "mousedown",
        handleClickOutside
      );
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() =>
          setOpen((current) => !current)
        }
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={label}
        className="flex h-9 min-w-9 items-center justify-center gap-2 rounded-lg bg-lime px-2 text-xs font-medium text-[#111113] shadow-glow-lime transition hover:bg-lime-dark sm:px-4"
      >
        <Plus size={16} className="sm:hidden" aria-hidden="true" />
        <span className="hidden sm:inline">{label}</span>

        <ChevronDown
          size={13}
          className={cn(
            "hidden transition-transform sm:block",
            open && "rotate-180"
          )}
        />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-11 z-50 w-64 overflow-hidden rounded-xl border border-border bg-surface shadow-card"
        >
          {actions.map((action) => (
            <button
              key={action.label}
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                action.onClick();
              }}
              className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-surface-secondary"
            >
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-lime/15 text-lime-ink">
                {action.icon}
              </div>

              <div className="min-w-0">
                <div className="text-xs font-medium text-text">
                  {action.label}
                </div>

                {action.description && (
                  <div className="truncate text-[10px] text-muted">
                    {action.description}
                  </div>
                )}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
