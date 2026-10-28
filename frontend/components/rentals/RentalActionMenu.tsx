"use client";

import { MoreVertical, Phone, Check, X, XCircle, Eye, Clock } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useKlynxUI } from "@/components/providers/UIProvider";

type Rect = { left: number; right: number; top: number; bottom: number };

/** Keep an anchored menu inside the viewport, opening upwards near its bottom. */
function menuPosition(anchor: Rect, width: number, height: number, viewportWidth: number, viewportHeight: number) {
  const margin = 8, gap = 4;
  const menuWidth = Math.min(width, Math.max(0, viewportWidth - margin * 2));
  const available = Math.max(0, viewportHeight - margin * 2);
  const below = Math.min(available, Math.max(0, viewportHeight - anchor.bottom - gap - margin));
  const above = Math.min(available, Math.max(0, anchor.top - gap - margin));
  const opensAbove = below < height && above > below;
  const maxHeight = Math.min(height, opensAbove ? above : below);
  return {
    left: Math.max(margin, Math.min(anchor.right - menuWidth, viewportWidth - menuWidth - margin)),
    top: Math.max(margin, Math.min(opensAbove ? anchor.top - gap - maxHeight : anchor.bottom + gap,
      viewportHeight - maxHeight - margin)),
    width: menuWidth, maxHeight,
  };
}

export type ActionSale = {
  id: number;
  vehicle_id?: number | null;
  picked_up?: boolean;
  returned?: boolean;
  paperwork?: { contract_ready: boolean };
};

export function RentalActionMenu({
  sale,
  kind,
  onPickedUp,
  onCancel,
  onReturn,
}: {
  sale: ActionSale;
  kind: "pickup" | "return" | "overdue";
  onPickedUp?: (saleId: number) => void;
  onCancel?: (saleId: number) => void;
  onReturn?: (vehicleId: number, nextState: "Nettoyage" | "Disponible", saleId: number) => void;
}) {
  const { t } = useKlynxUI();
  const [open, setOpen] = useState(false);
  const [subMenu, setSubMenu] = useState<"none" | "not-picked-up" | "not-returned">("none");
  const ref = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const [position, setPosition] = useState<ReturnType<typeof menuPosition> | null>(null);

  useLayoutEffect(() => {
    if (!open) return;
    function update() {
      if (!triggerRef.current || !menuRef.current) return;
      const next = menuPosition(triggerRef.current.getBoundingClientRect(), 224,
        menuRef.current.scrollHeight, window.innerWidth, window.innerHeight);
      setPosition(previous => previous && Object.keys(next).every(key =>
        previous[key as keyof typeof next] === next[key as keyof typeof next]) ? previous : next);
    }
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    const observer = new ResizeObserver(update);
    if (menuRef.current) observer.observe(menuRef.current);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true); observer.disconnect();
    };
  }, [open, subMenu]);

  const positioned = position !== null;
  useEffect(() => {
    if (open && positioned) menuRef.current?.querySelector<HTMLElement>("a[href], button")?.focus();
  }, [open, subMenu, positioned]);

  useEffect(() => {
    if (!open) return;
    function onOutside(event: MouseEvent) {
      if (!ref.current?.contains(event.target as Node) && !menuRef.current?.contains(event.target as Node)) {
        setOpen(false);
        setSubMenu("none");
      }
    }
    document.addEventListener("mousedown", onOutside);
    return () => document.removeEventListener("mousedown", onOutside);
  }, [open]);

  function close() {
    setOpen(false);
    setSubMenu("none");
  }

  return (
    <div className="relative shrink-0" ref={ref}>
      <button
        type="button"
        ref={triggerRef}
        aria-label="Rental actions"
        aria-expanded={open}
        aria-haspopup="menu"
        aria-controls={open ? menuId : undefined}
        onClick={(event) => {
          event.preventDefault();
          setOpen((value) => !value);
          setSubMenu("none");
          setPosition(null);
        }}
        className="flex h-7 w-7 items-center justify-center rounded-md text-muted transition hover:bg-surface-secondary hover:text-text"
      >
        <MoreVertical size={15} />
      </button>

      {open && createPortal(
        <div
          ref={menuRef} id={menuId} role="menu" aria-label="Rental actions"
          onClick={(event) => event.stopPropagation()}
          onKeyDown={event => {
            const items = Array.from(menuRef.current?.querySelectorAll<HTMLElement>("a[href], button:not(:disabled)") || []);
            if (event.key === "Escape") { event.preventDefault(); close(); triggerRef.current?.focus(); }
            if (event.key === "Tab") { close(); triggerRef.current?.focus(); }
            if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key) && items.length) {
              event.preventDefault();
              const index = items.indexOf(document.activeElement as HTMLElement);
              const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1
                : (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
              items[next].focus();
            }
          }}
          style={position ? { ...position, visibility: "visible" } : { width: 224, visibility: "hidden" }}
          className="fixed z-[200] overflow-y-auto rounded-lg border border-border bg-surface py-1 text-sm shadow-xl"
        >
          {subMenu === "none" && (
            <>
              <Link role="menuitem" href={`/dashboard/rentals/${sale.id}`} onClick={close} className="flex items-center gap-2 px-3 py-2 text-text-secondary hover:bg-surface-secondary hover:text-text">
                <Eye size={14} /> View rental
              </Link>

              {kind === "pickup" && !sale.picked_up && (
                <>
                  {sale.paperwork?.contract_ready ? <button role="menuitem" type="button" onClick={() => { onPickedUp?.(sale.id); close(); }} className="flex w-full items-center gap-2 px-3 py-2 text-left text-lime-ink hover:bg-lime/10">
                    <Check size={14} /> Picked up
                  </button> : <Link role="menuitem" href={`/dashboard/rentals/${sale.id}#paperwork`} onClick={close} className="flex items-center gap-2 px-3 py-2 text-danger hover:bg-surface-secondary"><Check size={14} /> Complete pickup paperwork</Link>}
                  <button role="menuitem" type="button" onClick={() => setSubMenu("not-picked-up")} className="flex w-full items-center gap-2 px-3 py-2 text-left text-text-secondary hover:bg-surface-secondary hover:text-text">
                    <X size={14} /> Not picked up
                  </button>
                </>
              )}

              {(kind === "return" || kind === "overdue") && !sale.returned && sale.vehicle_id && (
                <>
                  <button role="menuitem" type="button" onClick={() => { onReturn?.(sale.vehicle_id!, "Nettoyage", sale.id); close(); }} className="flex w-full items-center gap-2 px-3 py-2 text-left text-lime-ink hover:bg-lime/10">
                    <Check size={14} /> Returned · send to cleaning
                  </button>
                  <button role="menuitem" type="button" onClick={() => { onReturn?.(sale.vehicle_id!, "Disponible", sale.id); close(); }} className="flex w-full items-center gap-2 px-3 py-2 text-left text-lime-ink hover:bg-lime/10">
                    <Check size={14} /> Returned · ready now
                  </button>
                  <button role="menuitem" type="button" onClick={() => setSubMenu("not-returned")} className="flex w-full items-center gap-2 px-3 py-2 text-left text-text-secondary hover:bg-surface-secondary hover:text-text">
                    <Clock size={14} /> Not returned yet
                  </button>
                </>
              )}

              {onCancel && (
                <button role="menuitem" type="button" onClick={() => { if (window.confirm(t("Cancel this booking?"))) { onCancel(sale.id); } close(); }} className="flex w-full items-center gap-2 px-3 py-2 text-left text-danger hover:bg-danger/10">
                  <XCircle size={14} /> Cancel booking
                </button>
              )}
            </>
          )}

          {subMenu === "not-picked-up" && (
            <>
              <p className="px-3 py-1.5 text-xs text-muted">Customer hasn&apos;t shown up yet</p>
              <Link role="menuitem" href={`/dashboard/rentals/${sale.id}#follow-ups`} onClick={close} className="flex w-full items-center gap-2 px-3 py-2 text-left text-text-secondary hover:bg-surface-secondary hover:text-text">
                <Phone size={14} /> Schedule a call
              </Link>
              {onCancel && (
                <button role="menuitem" type="button" onClick={() => { if (window.confirm(t("Cancel this booking?"))) { onCancel(sale.id); } close(); }} className="flex w-full items-center gap-2 px-3 py-2 text-left text-danger hover:bg-danger/10">
                  <XCircle size={14} /> Cancel booking
                </button>
              )}
            </>
          )}

          {subMenu === "not-returned" && (
            <>
              <p className="px-3 py-1.5 text-xs text-muted">Extension in progress?</p>
              <Link role="menuitem" href={`/dashboard/rentals/${sale.id}?edit=1`} onClick={close} className="flex w-full items-center gap-2 px-3 py-2 text-left text-text-secondary hover:bg-surface-secondary hover:text-text">
                <Clock size={14} /> Extend booking (new days)
              </Link>
              <Link role="menuitem" href={`/dashboard/rentals/${sale.id}#payments`} onClick={close} className="flex w-full items-center gap-2 px-3 py-2 text-left text-text-secondary hover:bg-surface-secondary hover:text-text">
                <Clock size={14} /> Invoice extra hours
              </Link>
            </>
          )}
        </div>, document.body,
      )}
    </div>
  );
}
