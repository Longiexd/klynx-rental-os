"use client";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
export type Features = { fleet_care: boolean; fleet_compliance: boolean; automatic_reminders: boolean; analytics: boolean };
type CompanySession = { username: string; company: string; plan: string; features: Features };
const Context = createContext<CompanySession | null>(null);
export function useCompanySession() { return useContext(Context); }
export function useFeatures() { return useCompanySession()?.features ?? null; }
export function FeaturesProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<CompanySession | null>(null);
  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const response = await fetch("/api/auth", {cache: "no-store"});
        if (!response.ok) return;
        const data = await response.json();
        const value = data.features;
        if (active && typeof data.username === "string" && typeof data.company === "string" && typeof data.plan === "string" && value && ["fleet_care", "fleet_compliance", "automatic_reminders", "analytics"].every(key => typeof value[key] === "boolean")) setSession({username: data.username, company: data.company, plan: data.plan, features: value});
      } catch { /* Keep the last confirmed entitlements during a temporary outage. */ }
    };
    void load();
    window.addEventListener("focus", load);
    const timer = window.setInterval(load, 60000);
    return () => { active = false; clearInterval(timer); window.removeEventListener("focus", load); };
  }, []);
  return <Context.Provider value={session}>{children}</Context.Provider>;
}
