"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Bell,
  BarChart3,
  CalendarDays,
  Car,
  CircleHelp,
  ClipboardList,
  LayoutDashboard,
  LogOut,
  Users,
  Zap,
  Sun,
  Moon,
  ArrowUpRight,
} from "lucide-react";
import React, { useEffect, useRef, useState } from "react";

import AddCustomerModal from "@/components/customers/AddCustomerModal";
import CreateRentalModal from "@/components/rentals/CreateRentalModal";
import { QuickAddMenu } from "@/components/ui/QuickAddMenu";
import { useReminders } from "@/components/activities/api";
import KlynxLogo from "@/components/klynxlogo";
import { API_URL } from "@/lib/api-config";
import { useKlynxUI } from "@/components/providers/UIProvider";
import { useFeatures, useCompanySession } from "@/components/providers/FeaturesProvider";
import { workspaceForPath, workspaceFeature } from "@/lib/workspaces";
import { FleetCareProvider } from "@/components/fleet/FleetCare";
import { NavigationSearch } from "@/components/layout/NavigationSearch";
import { MobileNavigation } from "@/components/layout/MobileNavigation";

const workspaces = [
  {id: "rentals", label: "Rentals"},
  {id: "fleet", label: "Fleet"},
  {id: "management", label: "Management"},
] as const;
const navigation = [
  {label: "Overview", icon: LayoutDashboard, href: "/dashboard", workspace: "rentals"},
  {label: "Rentals", icon: ClipboardList, href: "/dashboard/rentals", workspace: "rentals"},
  {label: "Calendar", icon: CalendarDays, href: "/dashboard/calendar", workspace: "rentals"},
  {label: "Customers", icon: Users, href: "/dashboard/customers", workspace: "rentals"},
  {label: "Prospects", icon: Users, href: "/crm/leads", workspace: "rentals"},
  {label: "To do", icon: ClipboardList, href: "/dashboard/activities", workspace: "rentals"},
  {label: "Vehicles", icon: Car, href: "/dashboard/fleet", workspace: "fleet"},
  {label: "Fleet care", icon: ClipboardList, href: "/dashboard/fleet-care", workspace: "fleet"},
  {label: "Analytics", icon: BarChart3, href: "/dashboard/analytics", workspace: "management"},
];

export default function OSLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const { theme, locale, setTheme, setLocale, t } = useKlynxUI();
  const workspace = workspaceForPath(pathname);
  const features = useFeatures();
  const visibleNavigation = navigation.filter(item => { const feature = workspaceFeature(item.href); return !feature || features?.[feature]; });
  const groups = workspaces.filter(group => visibleNavigation.some(item => item.workspace === group.id));
  const requiredFeature = workspaceFeature(pathname);
  const allowed = !requiredFeature || features?.[requiredFeature];

  const [addRentalOpen, setAddRentalOpen] = useState(false);
  const [addCustomerOpen, setAddCustomerOpen] = useState(false);
  const [bellOpen, setBellOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const bellRef = useRef<HTMLDivElement>(null);
  const userMenuRef = useRef<HTMLDivElement>(null);
  const userTriggerRef = useRef<HTMLButtonElement>(null);
  const logoutRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!bellOpen && !userMenuOpen) return;
    const dismissOutside = (event: Event) => {
      if (!(event.target instanceof Node)) return;
      if (!bellRef.current?.contains(event.target)) setBellOpen(false);
      if (!userMenuRef.current?.contains(event.target)) setUserMenuOpen(false);
    };
    const dismissEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setBellOpen(false);
      setUserMenuOpen(false);
      if (userMenuOpen) userTriggerRef.current?.focus();
      else bellRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
    };
    document.addEventListener("pointerdown", dismissOutside);
    document.addEventListener("focusin", dismissOutside);
    document.addEventListener("keydown", dismissEscape);
    return () => {
      document.removeEventListener("pointerdown", dismissOutside);
      document.removeEventListener("focusin", dismissOutside);
      document.removeEventListener("keydown", dismissEscape);
    };
  }, [bellOpen, userMenuOpen]);

  useEffect(() => {
    setBellOpen(false);
    setUserMenuOpen(false);
    setAddRentalOpen(false);
    setAddCustomerOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (userMenuOpen) logoutRef.current?.focus();
  }, [userMenuOpen]);


  const identity = useCompanySession();

  const userName = identity?.username.split(".").slice(1).join(".") || identity?.username || "";
  const initials = userName.trim().split(/\s+/).filter(Boolean).map((part) => part[0]).join("").slice(0, 2).toUpperCase();

  const { due } = useReminders();

  const handleLogout = async () => {
    try {
      const response = await fetch("/api/auth", { method: "DELETE" });
      if (!response.ok) throw new Error("Sign out failed");
      window.location.assign("/login");
    } catch {
      window.alert("Could not finish signing out. Please retry.");
    }
  };

  const isActive = (href: string) =>
    href === "/dashboard"
      ? pathname === href
      : pathname === href ||
        pathname.startsWith(`${href}/`) ||
        (href === "/crm/leads" &&
          pathname.startsWith("/dashboard/crm/leads"));

  return (
    <div className="os-stage text-text">
      <div className="os-shell">

        {/* =====================================================
            DESKTOP SIDEBAR
        ===================================================== */}
        <aside className="hidden w-[208px] shrink-0 flex-col border-r border-border bg-chrome lg:flex">

          {/* Klynx logo */}
          <Link
            href="/dashboard"
            className="flex h-[70px] items-center justify-center border-b border-border px-5"
            aria-label="Klynx overview"
          >
            <KlynxLogo variant="brand" size="md" />
          </Link>

          {/* Navigation */}
          <nav
            aria-label="Main navigation"
            className="space-y-8 px-3 py-7"
          >
            {groups.map(group => <section key={group.id} aria-label={t(group.label)}>
            <p className="mb-2 px-3 text-[10px] uppercase tracking-[0.18em] text-muted">{t(group.label)}</p>
            <div className="space-y-1">{visibleNavigation.filter(item => item.workspace === group.id).map(({label, icon: Icon, href}) => (
              <Link key={href} href={href} aria-current={isActive(href) ? "page" : undefined}
                className={`flex min-h-11 items-center gap-3 rounded-lg px-3 text-[13px] transition-colors ${isActive(href) ? "bg-[var(--sidebar-active)] font-medium text-text [&>svg]:text-lime-ink" : "text-text-secondary hover:bg-surface-secondary hover:text-text"}`}>
                <Icon className="shrink-0" size={16} strokeWidth={1.6} /><span className="min-w-0 leading-5">{t(label)}</span>
              </Link>
            ))}</div></section>)}
          </nav>

          {/* Sidebar footer */}
          <div className="mt-auto space-y-2 p-4">

            <div className="klynx-pro-card mb-3 rounded-xl p-3.5">
              <div className="flex items-start gap-2.5">
                <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-pink/15 text-pink-ink">
                  <Zap size={14} fill="currentColor" />
                </span>
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-text">{t("Upgrade to Pro")}</p>
                  <p className="mt-1 text-[10px] leading-relaxed text-muted">{t("More vehicles, more features.")}</p>
                </div>
                <button type="button" title={t("Explore Pro")} aria-label={t("Explore Pro")} className="ml-auto flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-pink/20 bg-surface text-pink-ink transition hover:bg-pink/10">
                  <ArrowUpRight size={13} />
                </button>
              </div>
            </div>

            <div className="flex items-center gap-3 rounded-lg px-2 py-2 text-xs text-muted">
              <Zap size={15} className="text-pink-ink" />
              Klynx AI
              <span className="ml-auto text-[10px] text-pink-ink">
                {t("Soon")}
              </span>
            </div>

            <a
              href="mailto:support@example.invalid"
              className="flex items-center gap-3 rounded-lg px-2 py-2 text-xs text-muted transition hover:bg-surface-secondary hover:text-text"
            >
              <CircleHelp size={15} />
              {t("Help & support")}
            </a>

            <button
              type="button"
              onClick={handleLogout}
              className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left text-xs text-muted transition hover:bg-surface-secondary hover:text-text"
            >
              <LogOut size={15} />
              {t("Log out")}
            </button>
          </div>
        </aside>

        {/* =====================================================
            MAIN AREA
        ===================================================== */}
        <div className="min-w-0 flex-1">

          {/* Header */}
          <header className="os-header sticky top-0 z-30 flex min-h-16 items-center justify-between gap-2 border-b border-border bg-chrome px-4 py-2 sm:flex-wrap sm:gap-3 sm:px-7 lg:h-[70px] lg:flex-nowrap lg:py-0">

            {/* Mobile Klynx logo */}
            <Link
              href="/dashboard"
              aria-label="Klynx overview"
              className="lg:hidden"
            >
              <KlynxLogo variant="brand" size="sm" />
            </Link>

            {/* Search */}
            <NavigationSearch navigation={visibleNavigation} onNewBooking={() => setAddRentalOpen(true)} onNewCustomer={() => setAddCustomerOpen(true)} />

            {/* Header actions */}
            <div className="ml-auto flex items-center gap-2 sm:gap-3">

              <div className="klynx-control hidden sm:inline-flex" aria-label="Language">
                <button type="button" data-active={locale === "fr"} onClick={() => setLocale("fr")}>FR</button>
                <button type="button" data-active={locale === "en"} onClick={() => setLocale("en")}>EN</button>
              </div>
              <div className="klynx-control hidden sm:inline-flex" aria-label="Theme">
                <button type="button" data-active={theme === "light"} aria-pressed={theme === "light"} onClick={() => setTheme("light")} aria-label="Light mode" title="Light mode">
                  <Sun size={14} />
                </button>
                <button type="button" data-active={theme === "dark"} aria-pressed={theme === "dark"} onClick={() => setTheme("dark")} aria-label="Dark mode" title="Dark mode">
                  <Moon size={14} />
                </button>
              </div>

              {workspace === "rentals" && <div className="hidden sm:block"><QuickAddMenu
                actions={[
                  {
                    label: t("New booking"),
                    description:
                      t("Save a prospect or prepare a quotation"),
                    icon: <Car size={15} />,
                    onClick: () => setAddRentalOpen(true),
                  },
                  {
                    label: t("New customer"),
                    description:
                      t("Create a customer record"),
                    icon: <Users size={15} />,
                    onClick: () => setAddCustomerOpen(true),
                  },
                ]}
              /></div>}

              {/* Notifications */}
              {workspace === "rentals" && features?.automatic_reminders && <div className="relative" ref={bellRef}>
                <button
                  type="button"
                  aria-expanded={bellOpen}
                  aria-controls="header-notifications"
                  aria-label="Notifications"
                  onClick={() => {
                    setUserMenuOpen(false);
                    setBellOpen((value) => !value);
                  }}
                  className={`relative flex h-9 w-9 items-center justify-center rounded-full border border-border text-text-secondary transition hover:text-text ${due.length > 0 ? "klynx-notification-flicker" : ""}`}
                >
                  <Bell size={16} />

                  {due.length > 0 && (
                    <span className="klynx-notification-badge absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[9px] font-semibold">
                      {due.length}
                    </span>
                  )}
                </button>

                {bellOpen && (
                  <div id="header-notifications" className="absolute right-0 top-11 z-30 w-72 rounded-xl border border-border bg-surface p-3 shadow-xl">

                    <p className="px-1 pb-2 text-xs font-medium uppercase tracking-wider text-muted">
                      {t("Due today & overdue")}
                    </p>

                    {due.length === 0 ? (
                      <p className="px-1 py-2 text-sm text-muted">
                        {t("Nothing due. You're all caught up.")}
                      </p>
                    ) : (
                      <div className="max-h-72 space-y-1 overflow-y-auto">
                        {due.slice(0, 8).map((item) => (
                          <Link
                            key={item.id}
                            href={
                              item.res_model === "sale.order"
                                ? `/dashboard/rentals/${item.res_id}?activity=${item.id}`
                                : `/crm/leads/${item.res_id}?activity=${item.id}`
                            }
                            onClick={() => setBellOpen(false)}
                            className="block rounded-lg px-2 py-2 text-sm hover:bg-surface-secondary"
                          >
                            <span
                              className={`font-medium ${
                                item.state === "overdue"
                                  ? "text-danger"
                                  : "text-text"
                              }`}
                            >
                              {item.summary || t("Follow up")}
                            </span>

                            <span className="block text-xs text-muted">
                              {item.res_name} · {item.date_deadline}
                            </span>
                          </Link>
                        ))}
                      </div>
                    )}

                    <Link
                      href="/dashboard/activities"
                      onClick={() => setBellOpen(false)}
                      className="mt-2 block rounded-lg px-2 py-1.5 text-center text-xs text-lime-ink hover:underline"
                    >
                      {t("View all activities →")}
                    </Link>
                  </div>
                )}
              </div>}

              {/* Signed-in user disclosure, with room for future account options. */}
              <div className="relative" ref={userMenuRef}>
                <button
                  ref={userTriggerRef}
                  type="button"
                  aria-label={userName || "User menu"}
                  aria-expanded={userMenuOpen}
                  aria-controls="header-user-options"
                  onClick={() => {
                    setBellOpen(false);
                    setUserMenuOpen((value) => !value);
                  }}
                  className="flex items-center gap-2 rounded-lg p-1 text-text transition hover:bg-surface-secondary"
                >
                  <span className="hidden max-w-36 text-right sm:block">
                    <span className="block truncate text-xs font-medium leading-tight">
                      {userName}
                    </span>
                    <span className="block truncate text-[10px] leading-tight text-muted">
                      {identity?.company || ""}
                    </span>
                  </span>
                  <span className="flex h-9 w-9 items-center justify-center rounded-full border border-border bg-surface-secondary text-xs font-medium">
                    {initials}
                  </span>
                </button>
                {userMenuOpen && (
                  <div id="header-user-options" className="absolute right-0 top-full z-30 mt-2 w-44 rounded-xl border border-border bg-surface p-1.5 shadow-xl">
                    <button
                      ref={logoutRef}
                      type="button"
                      onClick={() => {
                        setUserMenuOpen(false);
                        void handleLogout();
                      }}
                      className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-text-secondary transition hover:bg-surface-secondary hover:text-pink-ink"
                    >
                      <LogOut size={16} />
                      <span>{t("Log out")}</span>
                    </button>
                  </div>
                )}
              </div>
            </div>
          </header>

          {/* Mobile navigation */}
          <MobileNavigation navigation={visibleNavigation} groups={groups} isActive={isActive} onNewBooking={() => setAddRentalOpen(true)} />

          <div className="os-content">
            {allowed ? <FleetCareProvider>{children}</FleetCareProvider> : <div className="mx-auto max-w-3xl px-6 py-10"><p>{t(features ? "This module is not enabled for your company." : "Loading…")}</p><Link href="/dashboard" className="mt-3 inline-block underline">{t("Overview")}</Link></div>}
          </div>
        </div>
      </div>

      <CreateRentalModal
        open={addRentalOpen}
        onClose={() => setAddRentalOpen(false)}
        onCreated={() => window.location.reload()}
      />

      {addCustomerOpen && (
        <AddCustomerModal
          apiUrl={API_URL}
          onClose={() => setAddCustomerOpen(false)}
          onSuccess={() => window.location.reload()}
        />
      )}
    </div>
  );
}
