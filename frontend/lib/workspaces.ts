export type Workspace = "rentals" | "fleet" | "management";

export function workspaceForPath(path: string): Workspace {
  if (path === "/dashboard/analytics" || path.startsWith("/dashboard/analytics/")) return "management";
  if (["/dashboard/fleet", "/dashboard/fleet-care"].some(base => path === base || path.startsWith(`${base}/`))) return "fleet";
  return "rentals";
}

export function workspaceFeature(path: string): "fleet_care" | "analytics" | null {
  if (path === "/dashboard/fleet-care" || path.startsWith("/dashboard/fleet-care/")) return "fleet_care";
  return workspaceForPath(path) === "management" ? "analytics" : null;
}
