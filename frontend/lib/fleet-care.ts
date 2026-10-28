/** Views are independent: an overdue scan must not hide a future renewal. */
export type FleetAlert = { kind: string; reason: string; severity: "danger" | "warning"; date: string | null; remaining?: number | null; label?: string; record_id?: number };
export function isToday(alert: FleetAlert) {
  return alert.severity === "danger" || ["uploaded", "date_missing", "in_progress"].includes(alert.reason);
}
export function isUpcoming(alert: FleetAlert) {
  return ["renewal", "soon", "planned"].includes(alert.reason);
}
export function alertsInView(alerts: FleetAlert[], view: string) {
  return alerts.filter(alert => view === "today" ? isToday(alert) : view === "upcoming" ? isUpcoming(alert)
    : view === "maintenance" ? ["oil_change", "maintenance", "service"].includes(alert.kind)
    : view === "documents" ? !["oil_change", "maintenance", "service"].includes(alert.kind) : true);
}
