import "./booking-journey.test.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { getVehicleBookings, buildReturnPayload, emptyReturnInspection, inspectionChecksComplete, odometerUnit } from "./fleet-bookings.ts";
import { getRentalState } from "./status.ts";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const today = new Date(2026, 9, 4, 12);
const sale = { id: 1, vehicle_id: 4, state: "sale", date_order: "2026-10-04 09:00:00", commitment_date: "2026-10-06 09:00:00" };

test("confirmed past pickup stays pickup due, even after its planned return, until actual handover", () => {
  const missed = { ...sale, booking_status: "confirmed", date_order: "2026-10-01", commitment_date: "2026-10-02" };
  assert.equal(getRentalState(missed, today), "pickup_due");
  assert.equal(getVehicleBookings(4, [missed], today).rental.id, missed.id);
  assert.equal(getRentalState({ ...missed, picked_up: true }, today), "return_due");
  assert.equal(getRentalState({ ...missed, returned: true }, today), "completed");
});

test("only actual pickup makes a confirmed booking ongoing and drafts never become pickup due", () => {
  assert.equal(getRentalState(sale, today), "confirmed");
  assert.equal(getRentalState({ ...sale, picked_up: true }, today), "ongoing");
  assert.equal(getRentalState({ ...sale, booking_status: "quotation", date_order: "2026-10-01" }, today), "draft");
  assert.equal(getRentalState({ ...sale, state: "cancel", date_order: "2026-10-01" }, today), "cancelled");
  assert.equal(getRentalState({ ...sale, state: "done", date_order: "2026-10-01" }, today), "pickup_due");
});

test("drafts appear as quotations without becoming the fleet card's active rental", () => {
  const draft = { ...sale, state: "draft" };
  const result = getVehicleBookings(4, [draft], today);
  assert.equal(result.rental, null);
  assert.deepEqual(result.quotations, [draft]);
});

test("confirmed rental remains visible even when a newer quotation exists", () => {
  const draft = { ...sale, id: 2, state: "draft" };
  const result = getVehicleBookings(4, [draft, sale], today);
  assert.equal(result.rental.id, sale.id);
  assert.equal(result.quotations[0].id, draft.id);
});

test("confirmed Odoo quotation stays nonblocking until booking confirmation", () => {
  const result = getVehicleBookings(4, [{ ...sale, booking_status: "quotation" }], today);
  assert.equal(result.rental, null);
  assert.equal(result.quotations.length, 1);
});

test("returned, cancelled and other vehicles' bookings are ignored", () => {
  const result = getVehicleBookings(4, [
    { ...sale, returned: true }, { ...sale, state: "cancel" }, { ...sale, vehicle_id: 9 },
  ], today);
  assert.equal(result.rental, null);
  assert.deepEqual(result.quotations, []);
});

test("overdue rental is visible ahead of an upcoming booking", () => {
  const overdue = { ...sale, id: 2, commitment_date: "2026-10-03 09:00:00" };
  assert.equal(getVehicleBookings(4, [sale, overdue], today).rental.id, 2);
});

test("selection does not reorder the shared sales array", () => {
  const data = [{ ...sale, id: 2 }, sale];
  getVehicleBookings(4, data, today);
  assert.deepEqual(data.map(item => item.id), [2, 1]);
});


const form = { orderId: "42", odometer: "12500", nextState: "Nettoyage", returnNotes: " All checked ", damageNotes: "" };
test("return carries the selected booking, mileage, notes and chosen operational state", () => {
  assert.deepEqual(buildReturnPayload(form, 12000), { order_id: 42, odometer: 12500,
    next_state: "Nettoyage", return_notes: "All checked", damage_notes: "" });
});
test("blank, decreasing and non-finite odometer readings cannot submit", () => {
  for (const odometer of ["", " ", "11999", "-1", "Infinity", "NaN", "not a number"]) {
    assert.throws(() => buildReturnPayload({ ...form, odometer }, 12000));
  }
});
test("equal reading is valid for a retry or a rental with no distance travelled", () => {
  assert.equal(buildReturnPayload(form, 12500).odometer, 12500);
  assert.equal(buildReturnPayload({ ...form, odometer: "0" }, 0).odometer, 0);
});
test("missing or invalid booking selection cannot return a different booking implicitly", () => {
  for (const orderId of ["", "0", "-1", "1.5", "NaN"]) assert.throws(() => buildReturnPayload({ ...form, orderId }, 12000));
});
test("notes remain plain text and are bounded", () => {
  assert.equal(buildReturnPayload({ ...form, damageNotes: "<script>not markup</script>" }, 12000).damage_notes, "<script>not markup</script>");
  assert.throws(() => buildReturnPayload({ ...form, returnNotes: "x".repeat(4001) }, 12000));
});
test("odometer unit follows the vehicle instead of converting its reading", () => {
  assert.equal(odometerUnit("kilometers"), "km");
  assert.equal(odometerUnit("miles"), "mi");
});
test("a legacy pending return with no mileage resumes its saved values", () => {
  const pending = { status: "pending", order_id: 42, odometer: null,
    next_state: "Maintenance", return_notes: "Saved", damage_notes: "Scratch" };
  assert.deepEqual(buildReturnPayload({ ...form, odometer: "" }, 12000, pending), {
    order_id: 42, odometer: null, next_state: "Maintenance", return_notes: "Saved", damage_notes: "Scratch",
  });
});
test("a pending return cannot switch booking or lower an advanced reading", () => {
  const pending = { status: "pending", order_id: 43, odometer: 12500 };
  assert.throws(() => buildReturnPayload(form, 12000, pending));
  assert.throws(() => buildReturnPayload(form, 13000, { ...pending, order_id: 42 }));
});
test("invalid saved vehicle mileage is rejected", () => {
  for (const reading of [-1, NaN, Infinity]) assert.throws(() => buildReturnPayload(form, reading));
});

const checkedInspection = { body_checked: true, interior_checked: true, fuel_keys_checked: true, approved: true };
test("new returns persist each basic check, approval and explicit damage flag", () => {
  const payload = buildReturnPayload({ ...form, inspection: checkedInspection, damaged: false }, 12000);
  assert.deepEqual(payload.inspection, checkedInspection);
  assert.equal(payload.damaged, false);
  assert.equal(payload.damage_notes, "");
});

test("condition approval requires all checks and no damage", () => {
  for (const check of ["body_checked", "interior_checked", "fuel_keys_checked"]) {
    assert.throws(() => buildReturnPayload({ ...form, inspection: { ...checkedInspection, [check]: false } }, 12000), /basic checks/);
  }
  assert.throws(() => buildReturnPayload({ ...form, inspection: checkedInspection, damaged: true, damageNotes: "Scratch" }, 12000), /resolve damage/);
  assert.equal(inspectionChecksComplete(emptyReturnInspection()), false);
  assert.equal(inspectionChecksComplete(checkedInspection), true);
});

test("damage needs a note and prevents release as available", () => {
  assert.throws(() => buildReturnPayload({ ...form, damaged: true, damageNotes: "  " }, 12000), /Describe the vehicle damage/);
  assert.throws(() => buildReturnPayload({ ...form, damaged: true, damageNotes: "Scratch", nextState: "Disponible" }, 12000), /damaged vehicle/);
  const payload = buildReturnPayload({ ...form, damaged: true, damageNotes: " Scratch ", nextState: "Maintenance", inspection: emptyReturnInspection() }, 12000);
  assert.equal(payload.next_state, "Maintenance");
  assert.equal(payload.damage_notes, "Scratch");
  assert.equal(payload.inspection.approved, false);
});

test("unfinished checks do not prevent recording an actual return to cleaning", () => {
  const payload = buildReturnPayload({ ...form, inspection: emptyReturnInspection(), damaged: false }, 12000);
  assert.equal(payload.next_state, "Nettoyage");
  assert.equal(payload.inspection.approved, false);
});

test("retry uses the inspection and damage saved in Odoo, ignoring edited form values", () => {
  const inspection = { ...checkedInspection, approved: false };
  const pending = { status: "pending", order_id: 42, odometer: 12500, next_state: "Maintenance",
    return_notes: "Saved", damage_notes: "Scratch", damaged: true, inspection };
  const payload = buildReturnPayload({ ...form, damaged: false, inspection: checkedInspection }, 12000, pending);
  assert.deepEqual(payload, { order_id: 42, odometer: 12500, next_state: "Maintenance",
    return_notes: "Saved", damage_notes: "Scratch", damaged: true, inspection });
});


const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const theme = readFileSync(resolve(root, "styles/theme.css"), "utf8");
const globals = readFileSync(resolve(root, "app/globals.css"), "utf8");
const light = theme.slice(theme.indexOf('html[data-theme="light"]'));
const palette = Object.fromEntries([...light.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6});/gi)].map(match => [match[1], match[2]]));

function contrast(a, b) {
  const luminance = hex => {
    const channels = hex.slice(1).match(/../g).map(value => parseInt(value, 16) / 255)
      .map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
    return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722;
  };
  const values = [luminance(a), luminance(b)].sort((a, b) => b - a);
  return (values[0] + .05) / (values[1] + .05);
}

test("shared light-mode text and accent tokens meet 4.5:1 on page/card/form surfaces", () => {
  for (const foreground of ["text", "text-secondary", "muted", "lime-ink", "pink-ink", "blue-ink", "violet-ink", "orange-ink", "red-ink"])
    for (const background of ["background", "surface", "surface-secondary"])
      assert.ok(contrast(palette[foreground], palette[background]) >= 4.5, `${foreground} on ${background}`);
});

test("every semantic status and to-do token has readable light-mode text", () => {
  for (const name of ["available", "reserved", "rented", "cleaning", "maintenance", "danger"])
    assert.ok(contrast(palette[`status-${name}-text`], palette[`status-${name}-bg`]) >= 4.5, name);
  assert.ok(contrast(palette["todo-text"], palette["todo-bg"]) >= 4.5);
  assert.ok(contrast(palette["todo-fill-text"], palette["todo-fill"]) >= 4.5);
});

function sources(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? sources(path) : /\.tsx?$/.test(entry.name) ? [readFileSync(path, "utf8")] : [];
  });
}

test("legacy colored text across all app pages/components has a light-mode override", () => {
  const content = [...sources(resolve(root, "app")), ...sources(resolve(root, "components"))].join("\n");
  const classes = new Set(content.match(/text-(?:green|blue|yellow|amber|orange|violet|red|zinc)-\d+(?:\/\d+)?/g));
  assert.ok(classes.size > 0);
  for (const name of classes) assert.ok(globals.includes(`.${name.replaceAll("/", "\\/")}`), `Missing override: ${name}`);
});

test("blue and lime action fills stay legible in light mode", () => {
  assert.ok(contrast("#111113", "#3B82F6") >= 4.5);
  assert.ok(contrast("#111113", "#C8F065") >= 4.5);
});


// Compile only the two pure predicates from the existing modal; no browser imports.
test("Economy keeps LOC-ECO and DEP-ECO type matches while OPT products stay extras", async () => {
  const {default: ts} = await import("typescript");
  const {runInNewContext} = await import("node:vm");
  const source = readFileSync(resolve(root, "components/rentals/CreateRentalModal.tsx"), "utf8");
  const parsed = ts.createSourceFile("modal.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const predicates = parsed.statements.filter(node => ts.isFunctionDeclaration(node) &&
    ["matchesVehicleProduct", "isOptionalProduct"].includes(node.name?.text)).map(node => node.getText(parsed)).join("\n");
  const code = ts.transpileModule(predicates, {compilerOptions: {module: ts.ModuleKind.CommonJS}}).outputText;
  const exports = {};
  runInNewContext(code, {exports});
  const {matchesVehicleProduct, isOptionalProduct} = exports;
  const references = ["LOC-ECO", "DEP-ECO", "LOC-SUV", "DEP-SUV", "OPT-CDSUPP", "OPT-BEBE", "OPT-ECO", null];
  assert.deepEqual(references.filter(ref => matchesVehicleProduct(ref, "Economy")), ["LOC-ECO", "DEP-ECO"]);
  assert.deepEqual(references.filter(isOptionalProduct), ["OPT-CDSUPP", "OPT-BEBE", "OPT-ECO"]);
  assert.equal(matchesVehicleProduct(" dep-éco ".normalize("NFD").replace(/[\u0300-\u036f]/g, ""), "Économique"), true);
  assert.equal(matchesVehicleProduct("LOC-ECO", ""), false);
  assert.equal(isOptionalProduct(" opt-cdsupp "), true);
});

async function translator() {
  const {default: ts} = await import("typescript");
  const {runInNewContext} = await import("node:vm");
  const source = readFileSync(resolve(root, "components/providers/UIProvider.tsx"), "utf8");
  const parsed = ts.createSourceFile("ui.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const names = new Set(["originalText", "lastRenderedText", "originalAttrs", "lastRenderedAttrs", "translatableAttrs", "legacyFrenchToEnglish", "monthFr", "fullMonthFr"]);
  const selected = parsed.statements.filter(node =>
    ts.isVariableStatement(node) && names.has(node.declarationList.declarations[0]?.name.getText(parsed)) ||
    ts.isFunctionDeclaration(node) && ["localizeDateFragments", "translateExact", "applyTranslation"].includes(node.name?.text)
  ).map(node => node.getText(parsed)).join("\n");
  const dictionary = {};
  runInNewContext(ts.transpileModule(readFileSync(resolve(root, "lib/i18n/fr.ts"), "utf8"), {compilerOptions: {module: ts.ModuleKind.CommonJS}}).outputText, {exports: dictionary});
  class Element {
    constructor(tag = "div", attrs = {}, texts = []) { this.tag = tag; this.attrs = {...attrs}; this.texts = texts.map(value => ({nodeValue: value, parentElement: this})); }
    closest(selector) { return this.tag === "textarea" && selector.includes("textarea") ? this : null; }
    getAttribute(name) { return this.attrs[name] ?? null; }
    setAttribute(name, value) { this.attrs[name] = value; }
    querySelectorAll() { return []; }
  }
  const context = {fr: dictionary.fr, Element, NodeFilter: {SHOW_TEXT: 4}, document: {createTreeWalker: element => {let index=0; return {nextNode: () => element.texts[index++] ?? null};}}};
  context.exports = {};
  runInNewContext(ts.transpileModule(selected + "\nexports.translate = translateExact; exports.apply = applyTranslation;", {compilerOptions: {module: ts.ModuleKind.CommonJS}}).outputText, context);
  return {...context.exports, Element};
}

test("French workflow labels and dates translate while client and product data stay intact", async () => {
  const {translate} = await translator();
  assert.equal(translate("5 Documents & contract", "fr"), "5 Documents et contrat");
  assert.equal(translate("October 2026", "fr"), "octobre 2026");
  assert.equal(translate("Month performance · 2026", "fr"), "Mois · performances 2026");
  assert.equal(translate("0 pickup paperwork incomplete · 1 late pickup · 0 overdue returns", "fr"), "0 documents de départ incomplets · 1 départs en retard · 0 retours en retard");
  assert.equal(translate("QA client · OPT-CDSUPP", "fr"), "QA client · OPT-CDSUPP");
  assert.equal(translate("Download / review", "en"), "Download / review");
});

test("React updates to placeholders and accessibility labels survive locale changes", async () => {
  const {apply, Element} = await translator();
  const field = new Element("input", {placeholder: "Save document", "aria-label": "Customer"});
  apply(field, "fr");
  assert.equal(field.attrs.placeholder, "Enregistrer le document");
  field.setAttribute("placeholder", "Download / review"); field.setAttribute("aria-label", "Close");
  apply(field, "fr");
  assert.equal(field.attrs.placeholder, "Télécharger / consulter"); assert.equal(field.attrs["aria-label"], "Fermer");
  apply(field, "en");
  assert.equal(field.attrs.placeholder, "Download / review"); assert.equal(field.attrs["aria-label"], "Close");
});

test("translation protects editable textarea contents and preserves updated React text", async () => {
  const {apply, Element} = await translator();
  const textarea = new Element("textarea", {}, ["Save document"]);
  apply(textarea, "fr"); assert.equal(textarea.texts[0].nodeValue, "Save document");
  const label = new Element("span", {}, ["Save document"]);
  apply(label, "fr"); label.texts[0].nodeValue = "Download / review";
  apply(label, "fr"); assert.equal(label.texts[0].nodeValue, "Télécharger / consulter");
  apply(label, "en"); assert.equal(label.texts[0].nodeValue, "Download / review");
});

test("attention text and notification counts stay legible on their colored backgrounds", () => {
  const dark = Object.fromEntries([...theme.slice(0, theme.indexOf('html[data-theme="light"]')).matchAll(/--([\w-]+):\s*(#[0-9a-f]{6});/gi)].map(match => [match[1], match[2]]));
  assert.ok(contrast("#FFFFFF", dark["notification-red"]) >= 4.5);
  assert.ok(contrast("#FFFFFF", palette["notification-red"]) >= 4.5);
  assert.ok(contrast(dark.danger, "#142440") >= 4.5);
  assert.ok(contrast(palette.danger, "#C6D7EA") >= 4.5);
});
