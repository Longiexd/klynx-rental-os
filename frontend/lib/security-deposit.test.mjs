import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { randomUUID } from "node:crypto";
import ts from "typescript";
import * as jsx from "react/jsx-runtime";
import { emptyReturnInspection, inspectionChecksComplete } from "./fleet-bookings.ts";

// Execute the real components; replace hooks with persistent render state and
// intercept their network boundary. Controls below are driven by rendered props.
function mount(name, props, network) {
  const slots = [], effects = [];
  let cursor = 0;
  const same = (a, b) => a && b && a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
  const hooks = {
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = { value: typeof initial === "function" ? initial() : initial };
      return [slots[index].value, value => { slots[index].value = typeof value === "function" ? value(slots[index].value) : value; }];
    },
    useRef(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = { current: initial };
      return slots[index];
    },
    useCallback(callback, dependencies) {
      const index = cursor++;
      if (!slots[index] || !same(slots[index].dependencies, dependencies)) slots[index] = { callback, dependencies };
      return slots[index].callback;
    },
    useEffect(effect, dependencies) {
      const index = cursor++;
      if (!slots[index] || !same(slots[index].dependencies, dependencies)) {
        slots[index]?.cleanup?.();
        slots[index] = { dependencies };
        effects.push(() => { slots[index].cleanup = effect(); });
      }
    },
  };
  const loaded = { exports: {} };
  const source = readFileSync(new URL(`../components/rentals/${name}.tsx`, import.meta.url), "utf8");
  runInNewContext(ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2017, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, {
    module: loaded, exports: loaded.exports, Error, crypto: { randomUUID }, require(id) {
      if (id === "react") return hooks;
      if (id === "react/jsx-runtime") return jsx;
      if (id.endsWith("/api")) return { apiFetch: network.apiFetch };
      if (id.endsWith("api-config")) return { API_URL: "/api/backend", apiRequest: network.apiRequest };
      if (id.endsWith("fleet-bookings")) return { emptyReturnInspection, inspectionChecksComplete };
      if (id.endsWith("format")) return { formatCurrency: amount => `${amount} TND` };
      if (id.endsWith("ReturnInspectionFields")) return { default: function ReturnInspectionFields() {} };
      throw new Error(`Unexpected import: ${id}`);
    },
  });
  const render = () => {
    cursor = 0;
    const tree = loaded.exports.default(props);
    effects.splice(0).forEach(effect => effect());
    return tree;
  };
  render();
  return { render, close: () => slots.forEach(slot => slot?.cleanup?.()) };
}

const flush = () => new Promise(resolve => setImmediate(resolve));
const response = (value = {}, status = 200) => ({ ok: status < 400, status, json: async () => value });
const copy = value => JSON.parse(JSON.stringify(value));
function elements(tree) {
  if (!tree || typeof tree !== "object") return [];
  if (Array.isArray(tree)) return tree.flatMap(elements);
  return [tree, ...elements(tree.props?.children)];
}
function text(tree) {
  if (tree == null || typeof tree === "boolean") return "";
  if (typeof tree !== "object") return String(tree);
  if (Array.isArray(tree)) return tree.map(text).join("");
  return text(tree.props?.children);
}
function button(view, label) {
  const found = elements(view.render()).find(node => node.type === "button" && text(node) === label);
  assert.ok(found, `Missing button: ${label}`);
  return found;
}
function control(view, label) {
  const tree = elements(view.render());
  const field = tree.find(node => node.type === "label" && text(node).startsWith(label));
  assert.ok(field, `Missing field: ${label}`);
  const found = elements(field).find(node => ["select", "input", "textarea"].includes(node.type));
  assert.ok(found, `Missing control: ${label}`);
  return found;
}
function change(view, label, value) {
  control(view, label).props.onChange({ target: { value } });
}
function submit(view) {
  const form = elements(view.render()).find(node => node.type === "form");
  assert.ok(form, "Missing settlement/inspection form");
  form.props.onSubmit({ preventDefault() {} });
}
const inspected = { body_checked: true, interior_checked: true, fuel_keys_checked: true, approved: true };
const record = { status: "completed", inspection: inspected, damaged: false, damage_notes: "" };
const balance = { required_amount: 500, collected_amount: 500, held_amount: 500, refunded_amount: 0,
  retained_amount: 0, legacy_issue: null, events: [] };
async function panel({ returned = record, deposit = balance, request = async () => response(), onSaved = async () => {}, load } = {}) {
  const calls = [];
  const view = mount("SecurityDepositPanel", { orderId: 42, record: returned, journals: [{ id: 3, name: "Deposit cash" }], canInvoice: false, onSaved }, {
    apiFetch: load || (async () => copy(deposit)),
    apiRequest: async (url, options) => { calls.push({ url, options, body: JSON.parse(options.body) }); return request(url, options); },
  });
  await flush();
  return { view, calls };
}
function refundForm(view, amount = "500") {
  change(view, "Amount", amount);
  change(view, "Refund from", "3");
}

test("refund action requires a completed, approved inspection without unresolved damage", async () => {
  for (const [returned, allowed] of [
    [record, true],
    [{ ...record, status: "pending" }, false],
    [{ ...record, inspection: { ...inspected, approved: false } }, false],
    [{ ...record, inspection: { ...inspected, body_checked: false } }, false],
    [{ ...record, damaged: true, damage_notes: "Door scratch", inspection: { ...inspected, approved: false } }, false],
  ]) {
    const { view } = await panel({ returned });
    const found = elements(view.render()).find(node => node.type === "button" && text(node) === "Record deposit refund");
    assert.equal(!!found && !found.props.disabled, allowed);
    view.close();
  }
});

test("damaged return can retain part of the deposit, then refund only its remainder", async () => {
  let deposit = copy(balance);
  const returned = { ...record, damaged: true, damage_notes: "Door scratch", inspection: { ...inspected, approved: false } };
  const { view, calls } = await panel({ returned, load: async () => copy(deposit), request: async (_url, options) => {
    const body = JSON.parse(options.body);
    if (body.action === "retain") {
      deposit = { ...deposit, held_amount: 350, retained_amount: 150, events: [{ ...body, move_id: 77 }] };
    } else deposit = { ...deposit, held_amount: 0, refunded_amount: 350, events: [...deposit.events, { ...body, credit_note_id: 88 }] };
    return response();
  } });
  assert.equal(button(view, "Record deposit refund").props.disabled, true);
  change(view, "Deposit action", "retain");
  change(view, "Amount", "150");
  change(view, "Settlement note", " Door repair ");
  assert.equal(button(view, "Record damage retention").props.disabled, false);
  submit(view);
  await flush();
  assert.equal(calls[0].body.action, "retain");
  assert.equal(calls[0].body.amount, 150);
  assert.equal(calls[0].body.note, "Door repair");
  assert.equal(calls[0].body.journal_id, null);
  assert.match(text(view.render()), /350 TND/);
  change(view, "Deposit action", "refund");
  refundForm(view, "350");
  assert.equal(button(view, "Record deposit refund").props.disabled, false);
  submit(view);
  await flush();
  assert.equal(calls.length, 2);
  assert.equal(calls[1].body.action, "refund");
  assert.equal(calls[1].body.amount, 350);
  assert.equal(calls[1].body.journal_id, 3);
  assert.notEqual(calls[0].body.request_id, calls[1].body.request_id);
  assert.equal(elements(view.render()).filter(node => node.type === "form").length, 0);
  assert.match(text(view.render()), /Credit note/);
  view.close();
});

test("a rejected settlement permits correcting the amount and submitting a new request", async () => {
  const { view, calls } = await panel({ request: async () => response({ detail: "Choose a deposit refund journal." }, 422) });
  refundForm(view);
  submit(view);
  await flush();
  assert.match(text(view.render()), /Choose a deposit refund journal\./);
  assert.equal(elements(view.render()).find(node => node.type === "fieldset").props.disabled, false);
  change(view, "Amount", "250");
  submit(view);
  await flush();
  assert.equal(calls.length, 2);
  assert.equal(calls[1].body.amount, 250);
  assert.notEqual(calls[0].body.request_id, calls[1].body.request_id);
  view.close();
});

test("network uncertainty retries the identical settlement and ignores a double submit", async () => {
  let rejectRequest;
  const failure = new Promise((_resolve, reject) => { rejectRequest = reject; });
  const { view, calls } = await panel({ request: async () => failure });
  refundForm(view);
  submit(view);
  submit(view);
  assert.equal(calls.length, 1);
  rejectRequest(new Error("Connection lost"));
  await flush();
  assert.match(text(view.render()), /Connection lost/);
  assert.equal(elements(view.render()).find(node => node.type === "fieldset").props.disabled, true);
  assert.equal(button(view, "Retry saved settlement").props.disabled, false);
  submit(view);
  await flush();
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1].body, calls[0].body);
  assert.match(calls[0].body.request_id, /^[0-9a-f-]{36}$/);
  view.close();
});

test("successful settlement followed by a refresh failure never repeats its payment", async () => {
  const { view, calls } = await panel({ onSaved: async () => { throw new Error("Refresh failed"); } });
  refundForm(view);
  submit(view);
  await flush();
  assert.equal(calls.length, 1);
  assert.match(text(view.render()), /Deposit settlement saved\. Refresh the booking/);
  assert.match(text(view.render()), /Deposit settlement recorded in Odoo\./);
  submit(view);
  await flush();
  assert.equal(calls.length, 1);
  assert.match(text(view.render()), /Enter an amount within the held deposit balance\./);
  view.close();
});

test("a lost response is reconciled against Odoo events before allowing another settlement", async () => {
  let deposit = copy(balance);
  const { view, calls } = await panel({ load: async () => copy(deposit), request: async (_url, options) => {
    const body = JSON.parse(options.body);
    deposit = { ...deposit, held_amount: 0, refunded_amount: 500, events: [{ ...body, credit_note_id: 88 }] };
    throw new Error("Response lost after save");
  } });
  refundForm(view);
  submit(view);
  await flush();
  assert.equal(calls.length, 1);
  assert.match(text(view.render()), /Deposit settlement recorded in Odoo\./);
  assert.equal(elements(view.render()).filter(node => node.type === "form").length, 0);
  assert.equal(elements(view.render()).find(node => node.type === "button" && text(node) === "Retry saved settlement"), undefined);
  assert.match(text(view.render()), /Credit note/);
  view.close();
});

test("recovering a committed partial refund clears its amount and note before another submit", async () => {
  let deposit = copy(balance);
  const { view, calls } = await panel({ load: async () => copy(deposit), request: async (_url, options) => {
    const body = JSON.parse(options.body);
    deposit = { ...deposit, held_amount: 350, refunded_amount: 150, events: [{ ...body, credit_note_id: 88 }] };
    throw new Error("Response lost after partial refund");
  } });
  refundForm(view, "150");
  change(view, "Settlement note", "Partial cash refund");
  submit(view);
  await flush();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].body.amount, 150);
  assert.equal(calls[0].body.note, "Partial cash refund");
  assert.match(text(view.render()), /350 TND/);
  assert.match(text(view.render()), /Deposit settlement recorded in Odoo\./);
  assert.equal(control(view, "Amount").props.value, "");
  assert.equal(control(view, "Settlement note").props.value, "");
  assert.equal(elements(view.render()).find(node => node.props?.role === "alert"), undefined);
  assert.equal(elements(view.render()).find(node => node.type === "fieldset").props.disabled, false);
  submit(view);
  await flush();
  assert.equal(calls.length, 1, "the previous partial refund must not be submitted under a new request ID");
  assert.match(text(view.render()), /Enter an amount within the held deposit balance\./);
  view.close();
});

test("TND millime amounts remain precise in the balance, amount input and refund request", async () => {
  let deposit = { ...copy(balance), required_amount: 0.005, collected_amount: 0.005, held_amount: 0.005,
    currency: "TND", currency_rounding: 0.001 };
  const { view, calls } = await panel({ load: async () => copy(deposit), request: async (_url, options) => {
    const body = JSON.parse(options.body);
    deposit = { ...deposit, held_amount: 0, refunded_amount: 0.005, events: [{ ...body, credit_note_id: 88 }] };
    return response();
  } });
  assert.match(text(view.render()), /Deposit held0\.005 TND/);
  const amount = control(view, "Amount");
  assert.equal(amount.props.min, 0.001);
  assert.equal(amount.props.step, 0.001);
  assert.equal(amount.props.max, 0.005);
  refundForm(view, "0.005");
  assert.equal(button(view, "Record deposit refund").props.disabled, false);
  submit(view);
  await flush();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].body.amount, 0.005);
  assert.match(text(view.render()), /Deposit refunded0\.005 TND/);
  assert.match(text(view.render()), /Credit note0\.005 TND/);
  view.close();
});

test("missing Odoo deposit addon is shown as a recoverable load error", async () => {
  let loads = 0;
  const { view, calls } = await panel({ load: async () => { loads++; throw new Error("Install the Klynx rental deposits addon in Odoo."); } });
  assert.match(text(view.render()), /Install the Klynx rental deposits addon/);
  assert.equal(elements(view.render()).find(node => node.props?.role === "alert") != null, true);
  button(view, "Load deposit details").props.onClick();
  await flush();
  assert.equal(loads, 2);
  assert.equal(calls.length, 0);
  view.close();
});

test("inspection review saves actual check values and allows correction after rejection", async () => {
  const calls = [];
  let reject = true, refreshes = 0;
  const view = mount("ReturnInspectionReview", { orderId: 42, record, onSaved: async () => { refreshes++; } }, {
    apiFetch: async (url, options) => {
      calls.push({ url, body: JSON.parse(options.body) });
      if (reject) throw new Error("Describe the vehicle damage before saving.");
      return {};
    },
  });
  const fields = () => elements(view.render()).find(node => node.type?.name === "ReturnInspectionFields");
  fields().props.onChange({ inspection: { ...inspected, approved: false }, damaged: true, damageNotes: "" });
  submit(view);
  await flush();
  assert.equal(refreshes, 0);
  assert.match(text(view.render()), /Describe the vehicle damage/);
  assert.equal(button(view, "Save vehicle inspection").props.disabled, false);
  fields().props.onChange({ inspection: { ...inspected, approved: false }, damaged: true, damageNotes: " Door scratch " });
  reject = false;
  submit(view);
  submit(view);
  await flush();
  assert.equal(calls.length, 2);
  assert.equal(calls[1].url, "/sales/42/return-inspection");
  assert.deepEqual(calls[1].body, { inspection: { ...inspected, approved: false }, damaged: true, damage_notes: "Door scratch" });
  assert.equal(refreshes, 1);
  assert.match(text(view.render()), /Vehicle inspection saved\./);
  view.close();
});
