import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as jsx from "react/jsx-runtime";
import * as icons from "lucide-react";

const module = { exports: {} };
const source = readFileSync(new URL("../components/rentals/BookingJourney.tsx", import.meta.url), "utf8");
runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText, {
  module, exports: module.exports, require: id => {
    if (id === "react/jsx-runtime") return jsx;
    if (id === "lucide-react") return icons;
    if (id.endsWith("UIProvider")) return { useKlynxUI: () => ({ t: text => text }) };
    if (id.endsWith("format")) return { formatCurrency: amount => `${amount} TND` };
    throw new Error(`Unexpected import: ${id}`);
  },
});
const props = { editable: false, cancelled: false, confirmed: true, pickedUp: false, returned: false, customerPresent: true, requirementsReady: true, paymentReceived: true, fullyPaid: false, contractReady: false, paperworkLoading: false };
const render = overrides => renderToStaticMarkup(React.createElement(module.exports.default, { ...props, ...overrides }));

test("part payment confirms its own step without marking documents or pickup complete", () => {
  const html = render();
  assert.match(html, /Deposit received/);
  assert.match(html, /aria-current="step"[^]*?#paperwork/);
  assert.match(html, /href="#handover"/);
  assert.equal((html.match(/aria-current="step"/g) || []).length, 1);
});
test("cancelled and returned bookings do not show a next actionable step", () => {
  assert.doesNotMatch(render({ cancelled: true }), /aria-current/);
  assert.doesNotMatch(render({ returned: true }), /aria-current/);
  assert.match(render({ returned: true }), /Rental completed/);
});
test("missing payment leads to payments rather than full-payment requirement after a deposit", () => {
  const html = render({ paymentReceived: false, confirmed: false });
  assert.match(html, /aria-current="step"[^]*?#payments/);
  assert.match(render({ contractReady: true }), /aria-current="step"[^]*?#handover/);
});
test("invoice meter handles partial, full, excess, zero, draft and credit balances", () => {
  const summary = overrides => renderToStaticMarkup(React.createElement(module.exports.InvoiceSummary, { total: 100, paid: 25, outstanding: 75, draft: false, credit: false, ...overrides }));
  assert.match(summary(), /aria-valuenow="25"/);
  assert.match(summary({ paid: 100 }), /aria-valuenow="100"/);
  assert.match(summary({ paid: 110 }), /aria-valuenow="100"/);
  assert.doesNotMatch(summary({ total: 0 }), /progressbar|NaN|Infinity/);
  assert.doesNotMatch(summary({ draft: true }), /progressbar/);
  assert.doesNotMatch(summary({ credit: true }), /progressbar/);
});

// Actual booking/document components: date boundaries and truthful action gates.
let componentLocale = "en";
function loadComponent(relativePath) {
  const loaded = { exports: {} };
  const source = readFileSync(new URL(relativePath, import.meta.url), "utf8");
  runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText, {
    module: loaded, exports: loaded.exports, require: id => {
      if (id === "react") return React;
      if (id === "react/jsx-runtime") return jsx;
      if (id === "lucide-react") return icons;
      if (id === "next/navigation") return { useRouter: () => ({ push() {} }) };
      if (id.endsWith("UIProvider")) return { useKlynxUI: () => ({ locale: componentLocale, t: text => componentLocale === "fr" ? translations[text] || text : text }) };
      if (id.endsWith("FeaturesProvider")) return { useFeatures: () => ({ fleet_care: true }) };
      if (id.endsWith("api-config")) return { API_URL: "/api/backend", apiRequest: () => { throw new Error("Unexpected SSR request"); } };
      if (id.endsWith("/api")) return { apiFetch: () => { throw new Error("Unexpected SSR request"); } };
      throw new Error(`Unexpected import: ${id}`);
    },
  });
  return loaded.exports;
}
const translations = loadComponent("../lib/i18n/fr.ts").fr;
const { rentalDayCount } = loadComponent("../components/rentals/CreateRentalModal.tsx");
const { PaperworkPanel } = loadComponent("../components/ui/DocumentsPanel.tsx");
const paperworkProps = { rentalId: 28, customerId: 1, confirmed: true, collected: false,
  status: {documents_ready: true, contract_current: false, contract_ready: false, contract_id: null, snapshot_ids: [], details: {}},
  refresh: async () => {}, editBooking() {} };
const renderPaperwork = overrides => renderToStaticMarkup(React.createElement(PaperworkPanel, {...paperworkProps, ...overrides}));
function contractButtonTag(html, label = "Prepare / Print rental contract") {
  const start = html.lastIndexOf("<button", html.indexOf(label));
  return html.slice(start, html.indexOf(">", start) + 1);
}

test("rental billing counts elapsed days with a one-day minimum across date boundaries", () => {
  for (const [start, end, expected] of [["2026-10-14", "2026-10-15", 1], ["2026-10-14", "2026-10-14", 1],
    ["2026-10-14", "2026-10-16", 2], ["2026-10-31", "2026-11-01", 1], ["2026-12-31", "2027-01-01", 1], ["2026-10-24", "2026-10-26", 2],
    ["", "2026-10-15", 1], ["2026-10-15", "2026-10-14", 1], ["invalid", "2026-10-15", 1]]) {
    assert.equal(rentalDayCount(start, end), expected, `${start} → ${end}`);
  }
});
test("verified documents do not claim a contract can be generated before booking confirmation", () => {
  const html = renderPaperwork({confirmed: false});
  assert.match(html, /Awaiting booking confirmation/);
  assert.match(html, /Record the agreed payment and use Confirm booking/);
  assert.match(contractButtonTag(html), /disabled=""/);
  assert.match(contractButtonTag(html), /title="Confirm the booking before preparing its contract/);
  assert.doesNotMatch(html, /Ready to generate/);
});
test("confirmed booking enables contract preparation only with verified driver documents", () => {
  const ready = renderPaperwork();
  assert.match(ready, /Ready to generate/);
  assert.doesNotMatch(contractButtonTag(ready), /disabled=/);
  assert.match(contractButtonTag(renderPaperwork({status: {...paperworkProps.status, documents_ready: false}})), /disabled=/);
  assert.match(contractButtonTag(renderPaperwork({status: null})), /disabled=/);
});
test("an archived rental can still open its saved contract without re-verifying current documents", () => {
  const html = renderPaperwork({collected: true, status: {...paperworkProps.status, documents_ready: false, contract_id: 9}});
  assert.doesNotMatch(contractButtonTag(html, "View / print saved contract"), /disabled=/);
  assert.match(contractButtonTag(renderPaperwork({collected: true}), "View / print saved contract"), /disabled=/);
});

test("booking confirmation guidance remains French when driver documents are incomplete", () => {
  componentLocale = "fr";
  try {
    const html = renderPaperwork({confirmed: false, status: {...paperworkProps.status, documents_ready: false}});
    assert.match(html, /Confirmation de réservation attendue/);
    assert.match(html, /Enregistrez le paiement convenu/);
    assert.match(contractButtonTag(html, "Prepare / Print rental contract"), /Confirmez la réservation avant/);
    assert.doesNotMatch(html, /Awaiting booking confirmation|Record the agreed payment/);
  } finally {
    componentLocale = "en";
  }
});
