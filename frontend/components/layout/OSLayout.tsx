"use client";

import Link from "next/link";
import {
  Activity,
  BarChart3,
  Bell,
  CalendarDays,
  Car,
  ChevronDown,
  CircleHelp,
  ClipboardList,
  LayoutDashboard,
  Search,
  Settings,
  Users,
  Zap,
} from "lucide-react";
import React from "react";

const navigation = [
  {
    label: "Overview",
    icon: LayoutDashboard,
    href: "/dashboard",
  },
  {
    label: "Fleet",
    icon: Car,
    href: "/dashboard/fleet",
  },
  {
    label: "Rentals",
    icon: ClipboardList,
    href: "/dashboard/rentals",
  },
  {
    label: "Customers",
    icon: Users,
    href: "/dashboard/customers",
  },
  {
    label: "Calendar",
    icon: CalendarDays,
    href: "/dashboard/calendar",
  },
  {
    label: "Analytics",
    icon: BarChart3,
    href: "/dashboard/analytics",
  },
];

export default function OSLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-[#09090B] text-white">
      {/* Ambient OS lighting */}
      <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <div className="absolute -left-40 -top-40 h-[500px] w-[500px] rounded-full bg-[#C8F065]/[0.035] blur-[140px]" />

        <div className="absolute right-[-180px] top-[15%] h-[500px] w-[500px] rounded-full bg-[#F06AAA]/[0.025] blur-[150px]" />
      </div>

      <div className="relative flex min-h-screen">

        {/* SIDEBAR */}
        <aside className="hidden w-[230px] shrink-0 border-r border-[#2B2B30] bg-[#09090B]/90 lg:flex lg:flex-col">

          {/* BRAND */}
          <div className="flex h-[68px] items-center border-b border-[#2B2B30] px-5">
            <Link
              href="/"
              className="font-[Syne] text-[19px] font-semibold tracking-[-0.04em]"
            >
              Klyn
              <span className="text-[#C8F065]">x</span>
              <span className="text-[#F06AAA]"> OS</span>
            </Link>
          </div>

          {/* NAVIGATION */}
          <div className="px-3 py-5">
            <div className="mb-3 px-2 text-[10px] font-medium uppercase tracking-[0.16em] text-[#71717A]">
              Workspace
            </div>

            <nav className="space-y-1">
              {navigation.map((item, index) => {
                const Icon = item.icon;

                return (
                  <Link
                    key={item.label}
                    href={item.href}
                    className={`group flex items-center gap-3 rounded-lg px-3 py-2 text-[13px] transition ${
                      index === 0
                        ? "bg-[#C8F065]/[0.09] text-[#C8F065]"
                        : "text-[#A1A1AA] hover:bg-[#111113] hover:text-white"
                    }`}
                  >
                    <Icon
                      size={16}
                      strokeWidth={index === 0 ? 2 : 1.7}
                    />

                    <span>{item.label}</span>

                    {index === 0 && (
                      <span className="ml-auto h-1.5 w-1.5 rounded-full bg-[#C8F065] shadow-[0_0_8px_rgba(200,240,101,.7)]" />
                    )}
                  </Link>
                );
              })}
            </nav>
          </div>

          {/* INTELLIGENCE */}
          <div className="px-3">
            <div className="mb-3 px-2 text-[10px] font-medium uppercase tracking-[0.16em] text-[#71717A]">
              Intelligence
            </div>

            <button className="flex w-full items-center gap-3 rounded-lg border border-[#54273C]/50 bg-[#54273C]/10 px-3 py-2.5 text-[13px] text-[#F06AAA] transition hover:bg-[#54273C]/20">
              <Zap size={16} />

              <span>Klynx AI</span>

              <span className="ml-auto rounded-md bg-[#F06AAA]/10 px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-[#F06AAA]">
                Beta
              </span>
            </button>
          </div>

          {/* BOTTOM */}
          <div className="mt-auto border-t border-[#2B2B30] p-3">
            <button className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-[13px] text-[#71717A] transition hover:bg-[#111113] hover:text-white">
              <Settings size={16} />
              Settings
            </button>

            <button className="mt-1 flex w-full items-center gap-3 rounded-lg px-3 py-2 text-[13px] text-[#71717A] transition hover:bg-[#111113] hover:text-white">
              <CircleHelp size={16} />
              Help & Support
            </button>
          </div>
        </aside>

        {/* APPLICATION */}
        <div className="min-w-0 flex-1">

          {/* TOP BAR */}
          <header className="flex h-[68px] items-center justify-between border-b border-[#2B2B30] px-5 sm:px-8">

            {/* SEARCH */}
            <div className="flex h-9 w-full max-w-[340px] items-center gap-2 rounded-lg border border-[#2B2B30] bg-[#111113]/70 px-3 text-[#71717A] transition focus-within:border-[#C8F065]/30">
              <Search size={15} />

              <span className="text-xs">
                Search anything...
              </span>

              <div className="ml-auto hidden items-center gap-1 sm:flex">
                <kbd className="rounded border border-[#2B2B30] bg-[#17171A] px-1.5 py-0.5 font-mono text-[9px] text-[#71717A]">
                  ⌘
                </kbd>

                <kbd className="rounded border border-[#2B2B30] bg-[#17171A] px-1.5 py-0.5 font-mono text-[9px] text-[#71717A]">
                  K
                </kbd>
              </div>
            </div>

            {/* RIGHT */}
            <div className="ml-4 flex items-center gap-2">

              <button className="relative flex h-9 w-9 items-center justify-center rounded-lg text-[#71717A] transition hover:bg-[#111113] hover:text-white">
                <Bell size={17} />

                <span className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-[#F06AAA] shadow-[0_0_7px_rgba(240,106,170,.7)]" />
              </button>

              <div className="ml-1 hidden h-7 w-px bg-[#2B2B30] sm:block" />

              <button className="ml-1 flex items-center gap-2 rounded-lg px-2 py-1.5 transition hover:bg-[#111113]">

                <div className="flex h-7 w-7 items-center justify-center rounded-md bg-gradient-to-br from-[#C8F065] to-[#6E9501] text-[10px] font-semibold text-[#09090B]">
                  KL
                </div>

                <div className="hidden text-left sm:block">
                  <div className="text-xs font-medium">
                    Klynx Admin
                  </div>

                  <div className="text-[10px] text-[#71717A]">
                    Administrator
                  </div>
                </div>

                <ChevronDown
                  size={13}
                  className="hidden text-[#71717A] sm:block"
                />
              </button>
            </div>
          </header>

          {/* PAGE CONTENT */}
          <main className="flex-1">
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}