import ActivitiesPanel from "@/components/activities/ActivitiesPanel";
import { PageHeader } from "@/components/ui/PageHeader";

export default function ActivitiesPage() {
  return <main className="mx-auto max-w-[1400px] space-y-6 p-5 sm:p-8"><PageHeader breadcrumb="To do" title="Activities" subtitle="Prioritize today's calls and keep every follow-up linked to its prospect." /><ActivitiesPanel /></main>;
}
