"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ArrowUpRight, Car, ClipboardList, Clock3, FileText, ReceiptText, Search, UserRound, X } from "lucide-react";
import { API_URL, apiRequest } from "@/lib/api-config";
import { matchesShortcut, type SearchResult } from "@/lib/navigation-search";
import { useKlynxUI } from "@/components/providers/UIProvider";

const icons = {Page: ArrowUpRight, Action: ArrowUpRight, Rental: FileText, Vehicle: Car, Customer: UserRound, Prospect: ClipboardList, Invoice: ReceiptText, Activity: Clock3};

export function NavigationSearch({ navigation, onNewBooking, onNewCustomer }: {
  navigation: {label: string; href: string}[];
  onNewBooking: () => void;
  onNewCustomer: () => void;
}) {
  const {t} = useKlynxUI();
  const router = useRouter();
  const pathname = usePathname();
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const [records, setRecords] = useState<{query: string; items: SearchResult[]; failed?: boolean}>({query: "", items: []});

  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen(value => !value);
      }
    };
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  }, []);
  useEffect(() => {
    if (open) dialog.current?.showModal();
    else dialog.current?.close();
  }, [open]);
  useEffect(() => {
    if (!open || query.trim().length < 2) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const response = await apiRequest(`${API_URL}/search?q=${encodeURIComponent(query.trim())}`, {signal: controller.signal, cache: "no-store"});
        if (!response.ok) throw new Error("Search unavailable");
        const data = await response.json();
        if (!controller.signal.aborted) setRecords({query, items: Array.isArray(data.results) ? data.results : []});
      } catch {
        if (!controller.signal.aborted) setRecords({query, items: [], failed: true});
      }
    }, 350);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [query, open]);

  const shortcuts: SearchResult[] = [
    ...navigation.map(item => ({...item, label: t(item.label), id: item.href, kind: "Page" as const})),
    {id: "new-booking", kind: "Action", label: t("New booking"), action: "booking"},
    {id: "new-customer", kind: "Action", label: t("New customer"), action: "customer"},
  ];
  if (/^\/dashboard\/rentals\/\d+$/.test(pathname)) {
    for (const [label, target, words] of [
      ["Payments", "payments", "payment invoice paiement facture"],
      ["Documents / rental contract", "paperwork", "documents contract contrat permis"],
      ["Pickup / return", "booking", "pickup return depart remise retour"],
    ]) shortcuts.unshift({id: target, label: t(label), kind: "Page", href: `${pathname}#${target}`, description: t("This rental"), keywords: words});
  }
  const items = [...shortcuts.filter(item => matchesShortcut(item, query)),
    ...(query.trim().length >= 2 && records.query === query ? records.items : [])];
  const index = Math.min(selected, Math.max(0, items.length - 1));
  useEffect(() => {
    if (open) dialog.current?.querySelector(`#navigation-result-${index}`)?.scrollIntoView({block: "nearest"});
  }, [index, open]);
  const pending = query.trim().length >= 2 && records.query !== query;
  const choose = (item: SearchResult) => {
    setOpen(false);
    if (item.href) router.push(item.href);
    else if (item.action === "booking") onNewBooking();
    else if (item.action === "customer") onNewCustomer();
  };

  return <>
    <button type="button" onClick={() => {setQuery(""); setSelected(0); setOpen(true);}}
      aria-label={t("Search and shortcuts")} className="flex h-11 w-11 shrink-0 items-center justify-center gap-2 rounded-xl border border-border bg-surface-secondary text-muted sm:w-full sm:max-w-[390px] sm:justify-start sm:px-3">
      <Search size={17} aria-hidden="true"/><span className="hidden text-sm sm:block">{t("Search and shortcuts")}</span><kbd className="ml-auto hidden rounded border border-border px-1.5 text-[10px] sm:block">Ctrl K</kbd>
    </button>
    <dialog ref={dialog} data-i18n-ignore="true" aria-label={t("Search and shortcuts")} onCancel={() => setOpen(false)} onClose={() => setOpen(false)}
      onClick={event => {if (event.target === event.currentTarget) setOpen(false);}}
      className="navigation-search m-0 h-dvh max-h-dvh w-screen max-w-none border-0 bg-surface p-0 text-text backdrop:bg-black/60 sm:mx-auto sm:mt-[8dvh] sm:h-auto sm:max-h-[80dvh] sm:w-[calc(100vw-3rem)] sm:max-w-xl sm:rounded-2xl sm:border sm:border-border sm:shadow-2xl">
      <div className="flex items-center gap-3 border-b border-border px-4 py-3">
        <Search size={20} className="shrink-0 text-lime-ink"/>
        <input autoFocus value={query} maxLength={80} onChange={event => {setQuery(event.target.value); setSelected(0);}}
          role="combobox" aria-label={t("Search pages, people, bookings or plates")} aria-expanded={open} aria-controls="navigation-results" aria-activedescendant={items.length ? `navigation-result-${index}` : undefined} autoComplete="off"
          placeholder={t("Where do you want to go?")} className="min-h-11 min-w-0 flex-1 bg-transparent text-base outline-none"
          onKeyDown={event => {
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault(); setSelected((index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % Math.max(1, items.length));
            } else if (event.key === "Enter" && items[index]) {event.preventDefault(); choose(items[index]);}
          }}/>
        <button type="button" aria-label={t("Close search")} onClick={() => setOpen(false)} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl hover:bg-surface-secondary"><X size={20}/></button>
      </div>
      <div id="navigation-results" role="listbox" aria-label={t("Search results")} className="max-h-[calc(100dvh-10rem)] overflow-y-auto p-2 sm:max-h-[55dvh]">
        {items.map((item, i) => {const Icon = icons[item.kind]; return <button key={item.id} id={`navigation-result-${i}`} type="button" role="option" aria-selected={index === i} onClick={() => choose(item)}
          className={`flex min-h-14 w-full items-center gap-3 rounded-xl px-3 py-2 text-left ${index === i ? "bg-surface-secondary" : "hover:bg-surface-secondary"}`}>
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border text-lime-ink"><Icon size={17}/></span>
          <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{item.label}</span><span className="block truncate text-xs text-muted">{item.description || t(item.kind)}</span></span><ArrowUpRight size={16} className="shrink-0 text-muted"/>
        </button>;})}
        {!items.length && !pending && <p className="p-5 text-sm text-muted">{t("No results. Try a name, booking reference or plate.")}</p>}
      </div>
      <p role="status" className="border-t border-border px-4 py-3 text-xs text-muted">{pending ? t("Searching company records…") : records.query === query && records.failed ? t("Records are temporarily unavailable. Page shortcuts still work.") : t("Type to find a page or record. Use ↑ ↓ and Enter, or tap a result.")}</p>
    </dialog>
  </>;
}
