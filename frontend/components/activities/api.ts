import { useEffect, useState } from "react";
import { useFeatures } from "@/components/providers/FeaturesProvider";
import { apiFetch } from "@/lib/api";

export { apiFetch as activityRequest } from "@/lib/api";

export function noteText(html: string | false) {
  return (html || "").replace(/<br\s*\/?\s*>|<\/p>/gi, "\n").replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/&#(?:39|x27);/g, "'").replace(/&amp;/g, "&").trim();
}

export type Activity = {
  id: number; res_id: number; res_model?: string; res_name: string; summary: string | false; note: string | false;
  date_deadline: string; activity_type_id: [number, string] | false;
  activity_category: string; user_id: [number, string] | false; state: string;
};


export function activityHref(item: Activity) {
  return `${item.res_model === "sale.order" ? "/dashboard/rentals" : "/crm/leads"}/${item.res_id}?activity=${item.id}`;
}

// Shared "what's due" data source for the notification bell and the
// dashboard reminder section — same /activities list everyone else
// reads, filtered to today/overdue, refreshed on an interval so the
// bell badge doesn't go stale across a long session.
export function useReminders(pollMs = 60000) {
  const enabled = useFeatures()?.automatic_reminders === true;
  const [due, setDue] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    async function load() {
      try {
        const result = await apiFetch<{ activities: Activity[] }>("/activities");
        if (active) setDue(result.activities.filter((item) => item.state === "today" || item.state === "overdue"));
      } catch {
        // Reminders are a convenience layer — a failed poll shouldn't surface an error banner in the topbar.
      } finally {
        if (active) setLoading(false);
      }
    }
    load();
    const interval = setInterval(load, pollMs);
    return () => { active = false; clearInterval(interval); };
  }, [pollMs, enabled]);

  return { due: enabled ? due : [], loading: enabled && loading };
}
