"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  LayoutDashboard,
  Users,
  Car,
  CalendarDays,
  Wallet,
  Settings,
  ChevronDown,
} from "lucide-react";
import { cn } from "@/lib/utils";

type NavItem = {
  title: string;
  icon: React.ElementType;
  href?: string;
  children?: { title: string; href: string }[];
};

const nav: NavItem[] = [
  { title: "Dashboard", icon: LayoutDashboard, href: "/dashboard" },
  {
    title: "CRM",
    icon: Users,
    children: [
      { title: "Leads", href: "/crm/leads" },
      { title: "Customers", href: "/crm/customers" },
      { title: "Contacts", href: "/crm/contacts" },
      { title: "Follow-ups", href: "/crm/follow-ups" },
      { title: "Communication", href: "/crm/communication" },
    ],
  },
  {
    title: "Vehicles",
    icon: Car,
    children: [
      { title: "Fleet Overview", href: "/vehicles" },
      { title: "Vehicle Profiles", href: "/vehicles/profiles" },
      { title: "Availability Calendar", href: "/vehicles/availability" },
      { title: "Cleaning", href: "/vehicles/cleaning" },
      { title: "Maintenance", href: "/vehicles/maintenance" },
      { title: "Compliance", href: "/vehicles/compliance" },
    ],
  },
  {
    title: "Reservations",
    icon: CalendarDays,
    children: [
      { title: "Calendar", href: "/reservations/calendar" },
      { title: "Active Rentals", href: "/reservations/active" },
      { title: "Returns", href: "/reservations/returns" },
    ],
  },
  {
    title: "Finance",
    icon: Wallet,
    children: [
      { title: "Revenue", href: "/finance/revenue" },
      { title: "Expenses", href: "/finance/expenses" },
      { title: "Vehicle Profitability", href: "/finance/profitability" },
    ],
  },
  { title: "Settings", icon: Settings, href: "/settings" },
];

export default function Sidebar() {
  const pathname = usePathname();
  const [open, setOpen] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    nav.forEach((item) => {
      if (item.children?.some((c) => pathname.startsWith(c.href))) {
        initial[item.title] = true;
      }
    });
    return initial;
  });

  const toggle = (title: string) =>
    setOpen((prev) => ({ ...prev, [title]: !prev[title] }));

  return (
    <aside className="w-72 border-r border-border bg-surface p-5 flex flex-col">
      <div className="mb-10">
        <h1 className="font-syne text-2xl font-bold tracking-tight">
          Klyn<span className="text-lime">x</span>
        </h1>
        <p className="text-sm text-muted">Rental OS</p>
      </div>

      <nav className="space-y-1 flex-1">
        {nav.map((item) => {
          const Icon = item.icon;

          if (!item.children) {
            const active = pathname === item.href;
            return (
              <Link
                key={item.title}
                href={item.href!}
                className={cn(
                  "flex items-center gap-3 rounded-xl px-4 py-2.5 text-sm transition",
                  active
                    ? "bg-lime/10 text-lime"
                    : "text-text-secondary hover:bg-surface-secondary hover:text-text"
                )}
              >
                <Icon size={18} />
                {item.title}
              </Link>
            );
          }

          const isOpen = open[item.title];
          const hasActiveChild = item.children.some((c) => pathname.startsWith(c.href));

          return (
            <div key={item.title}>
              <button
                onClick={() => toggle(item.title)}
                className={cn(
                  "flex w-full items-center justify-between gap-3 rounded-xl px-4 py-2.5 text-sm transition",
                  hasActiveChild
                    ? "text-lime"
                    : "text-text-secondary hover:bg-surface-secondary hover:text-text"
                )}
              >
                <span className="flex items-center gap-3">
                  <Icon size={18} />
                  {item.title}
                </span>
                <ChevronDown
                  size={14}
                  className={cn("transition-transform", isOpen && "rotate-180")}
                />
              </button>

              {isOpen && (
                <div className="ml-9 mt-1 space-y-1 border-l border-border pl-3">
                  {item.children.map((child) => {
                    const active = pathname === child.href;
                    return (
                      <Link
                        key={child.href}
                        href={child.href}
                        className={cn(
                          "block rounded-lg px-3 py-2 text-sm transition",
                          active
                            ? "text-lime"
                            : "text-muted hover:text-text"
                        )}
                      >
                        {child.title}
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </nav>
    </aside>
  );
}