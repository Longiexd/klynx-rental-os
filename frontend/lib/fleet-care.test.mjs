import test from "node:test";
import assert from "node:assert/strict";
import { alertsInView, isToday, isUpcoming } from "./fleet-care.ts";
const alert = (kind, reason, severity = "warning") => ({kind, reason, severity, date: null});
test("renewals appear in Upcoming even when the same vehicle has missing or unverified scans", () => {
  const alerts = [alert("registration", "missing", "danger"), alert("insurance", "uploaded"), alert("insurance", "renewal")];
  assert.equal(alerts.filter(isToday).length, 2);
  assert.deepEqual(alertsInView(alerts, "upcoming"), [alerts[2]]);
  assert.equal(isUpcoming(alerts[0]), false);
});
test("fleet maintenance state, services and oil-change reminders belong to Maintenance", () => {
  const alerts = [alert("maintenance", "in_progress"), alert("service", "planned"), alert("oil_change", "due", "danger"), alert("insurance", "renewal")];
  assert.equal(alertsInView(alerts, "maintenance").length, 3);
  assert.equal(alertsInView(alerts, "today").length, 2);
  assert.equal(alertsInView(alerts, "upcoming").length, 2);
  assert.deepEqual(alertsInView(alerts, "documents"), [alerts[3]]);
});
test("cleared reminders do not leave empty counts or phantom alerts", () => {
  for (const view of ["today", "upcoming", "maintenance", "documents", "all"]) assert.deepEqual(alertsInView([], view), []);
});
