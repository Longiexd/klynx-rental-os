import React from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

type ModalProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  maxWidth?: string;
};

// The one modal shell for the whole app — backdrop, panel, header,
// close button, optional footer. Add/Create modals should render
// their form fields as `children` and their submit button as `footer`.
//
// This standardizes what was previously three separate, slightly
// different implementations (different z-index, backdrop opacity,
// and close-button placement in CreateRentalModal /
// AddCustomerModal).
export function Modal({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  maxWidth = "max-w-lg",
}: ModalProps) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-end justify-center bg-black/70 p-0 backdrop-blur-sm sm:items-center sm:p-6"
      onClick={onClose}
    >
      <div
        className={cn(
          "klynx-form-sheet flex max-h-dvh w-full flex-col overflow-hidden border border-border bg-surface sm:max-h-[92dvh] sm:rounded-2xl",
          maxWidth
        )}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div>
            <h2 className="font-syne text-base font-semibold text-text">
              {title}
            </h2>

            {subtitle && (
              <p className="mt-0.5 text-[11px] text-muted">{subtitle}</p>
            )}
          </div>

          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="rounded-lg p-1.5 text-muted transition hover:bg-surface-secondary hover:text-text"
          >
            <X size={16} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>

        {footer && (
          <div className="mobile-form-actions shrink-0 border-t border-border bg-surface px-5 py-4">{footer}</div>
        )}
      </div>
    </div>
  );
}
