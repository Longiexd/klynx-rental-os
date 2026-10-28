"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { CalendarDays, Car, Home, MoreHorizontal, Moon, Plus, Sun, Users, X, type LucideIcon } from "lucide-react";
import { useKlynxUI } from "@/components/providers/UIProvider";

export function MobileNavigation({navigation, groups, isActive, onNewBooking}: {
  navigation: {label: string; href: string; workspace: string; icon: LucideIcon}[];
  groups: {id: string; label: string}[];
  isActive: (href: string) => boolean;
  onNewBooking: () => void;
}) {
  const {t, locale, setLocale, theme, setTheme} = useKlynxUI();
  const [open, setOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const pathname = usePathname();
  useEffect(() => {dialog.current?.close();}, [pathname]);
  const tabs = [{label: "Home", href: "/dashboard", icon: Home},
    {label: "Planning", href: "/dashboard/calendar", icon: CalendarDays},
    {label: "Vehicles", href: "/dashboard/fleet", icon: Car},
    {label: "Customers", href: "/dashboard/customers", icon: Users}];
  const moreActive = !tabs.some(tab => isActive(tab.href));
  useEffect(() => {
    if (open) dialog.current?.showModal();
    else dialog.current?.close();
  }, [open]);
  return <>
    <nav aria-label={t("Mobile navigation")} className="mobile-tabbar fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-border bg-chrome px-2 pt-2 lg:hidden">
      {tabs.map(({href,label,icon: Icon}) =>
        <Link key={href} href={href} aria-current={isActive(href) ? "page" : undefined} className={`flex min-h-14 flex-col items-center justify-center gap-1 rounded-xl text-[11px] ${isActive(href) ? "font-semibold text-lime-ink" : "text-text-secondary"}`}><Icon size={23} fill={label === "Home" && isActive(href) ? "currentColor" : "none"} strokeWidth={isActive(href) ? 2.2 : 1.6}/>{t(label)}</Link>)}
      <button type="button" onClick={() => setOpen(true)} aria-expanded={open} aria-controls="mobile-menu" className={`flex min-h-14 flex-col items-center justify-center gap-1 rounded-xl text-[11px] ${moreActive ? "font-semibold text-lime-ink" : "text-text-secondary"}`}><MoreHorizontal size={24}/>{t("More")}</button>
    </nav>
    <dialog id="mobile-menu" ref={dialog} aria-label={t("All modules")} onCancel={() => setOpen(false)} onClose={() => setOpen(false)} className="mobile-menu m-0 ml-auto h-dvh max-h-dvh w-full max-w-sm border-0 border-l border-border bg-surface p-0 text-text backdrop:bg-black/60">
      <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-surface p-4"><h2 className="text-lg font-semibold">{t("All modules")}</h2><button type="button" aria-label={t("Close")} onClick={() => setOpen(false)} className="flex h-11 w-11 items-center justify-center rounded-xl hover:bg-surface-secondary"><X size={21}/></button></div>
      <div className="space-y-6 p-4"><button type="button" onClick={() => {setOpen(false); onNewBooking();}} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-lime text-sm font-semibold text-black"><Plus size={20}/>{t("New booking")}</button>{groups.map(group => <section key={group.id}><h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">{t(group.label)}</h3><div className="space-y-1">{navigation.filter(item => item.workspace === group.id).map(({label,href,icon: Icon}) => <Link key={href} href={href} onClick={() => setOpen(false)} aria-current={isActive(href) ? "page" : undefined} className={`flex min-h-12 items-center gap-3 rounded-xl px-3 text-sm ${isActive(href) ? "bg-[var(--sidebar-active)] text-lime-ink" : "text-text-secondary hover:bg-surface-secondary"}`}><Icon size={20}/>{t(label)}</Link>)}</div></section>)}
        <section className="border-t border-border pt-4"><h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted">{t("Preferences")}</h3><div className="flex items-center justify-between gap-3"><div className="klynx-control inline-flex" aria-label={t("Language")}><button type="button" data-active={locale === "fr"} onClick={() => setLocale("fr")}>FR</button><button type="button" data-active={locale === "en"} onClick={() => setLocale("en")}>EN</button></div><button type="button" onClick={() => setTheme(theme === "light" ? "dark" : "light")} className="flex min-h-11 items-center gap-2 rounded-xl border border-border px-3 text-sm">{theme === "light" ? <Moon size={18}/> : <Sun size={18}/>} {t(theme === "light" ? "Dark mode" : "Light mode")}</button></div></section>
      </div>
    </dialog>
  </>;
}
