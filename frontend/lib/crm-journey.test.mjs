import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as jsx from "react/jsx-runtime";

const source = readFileSync(new URL("../app/dashboard/crm/leads/page.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;

function page(request) {
  const state = [], effects = [], windowEvents = new Map(), documentEvents = new Map();
  let cursor = 0;
  const events = map => ({ addEventListener: (event, handler) => map.set(event, handler),
    removeEventListener: event => map.delete(event) });
  const document = { visibilityState: "visible", ...events(documentEvents) };
  const sandboxModule = { exports: {} };
  runInNewContext(compiled, { module: sandboxModule, exports: sandboxModule.exports, document, window: events(windowEvents),
    console, require: id => {
      if (id === "react/jsx-runtime") return jsx;
      if (id === "react") return {
        useState: initial => { const index = cursor++; if (!(index in state)) state[index] = initial;
          return [state[index], value => { state[index] = typeof value === "function" ? value(state[index]) : value; }]; },
        useRef: initial => ({ current: initial }), useCallback: fn => fn,
        useMemo: fn => fn(), useEffect: fn => effects.push(fn),
      };
      if (id.endsWith("api-config")) return { API_URL: "/api/backend", apiRequest: request };
      return new Proxy({}, { get: () => () => null });
    },
  });
  const render = () => { cursor = 0; return sandboxModule.exports.default(); };
  render();
  const cleanups = effects.map(effect => effect());
  return { state, render, windowEvents, documentEvents, document, close: () => cleanups.forEach(fn => fn?.()) };
}
const settle = () => new Promise(resolve => setImmediate(resolve));
const response = value => ({ ok: true, json: async () => value });

function elements(tree) {
  if (!tree || typeof tree !== "object") return [];
  if (Array.isArray(tree)) return tree.flatMap(elements);
  return [tree, ...elements(tree.props?.children)];
}

test("newest prospects lead both views; sorting and search retain their linked rental", async () => {
  const leads = [
    {id: 7, name: "Zulu", created: "2026-10-10 10:00:00", email: false, phone: false, rental: {id: 42, name: "S00042"}},
    {id: 8, name: "Alpha", created: "2026-10-18 10:00:00", rental: {id: 43, name: "S00043"}},
    {id: 9, name: "Inquiry", created: "2026-10-18 10:00:00", rental: null},
  ];
  const view = page(async url => response(url.endsWith("sync-journey") ? {crm_synced: 0}
    : url.endsWith("stages") ? {stages: [{id: 1, name: "New"}]} : {leads}));
  await settle();
  let tree = elements(view.render());
  let table = tree.find(item => item.type?.name === "LeadsTable");
  assert.deepEqual(Array.from(table.props.leads, row => row.id), [9, 8, 7]);
  const links = elements(table.type(table.props)).filter(item => item.props?.href);
  assert.equal(links.find(item => item.props.children === "Zulu").props.href, "/dashboard/rentals/42");
  assert.equal(links.find(item => item.props.children === "Inquiry").props.href, "/crm/leads/9");
  tree.find(item => item.props?.["aria-label"] === "Sort prospects").props.onChange({target: {value: "name:asc"}});
  tree = elements(view.render());
  table = tree.find(item => item.type?.name === "LeadsTable");
  assert.deepEqual(Array.from(table.props.leads, row => row.id), [8, 9, 7]);
  tree.find(item => item.type === "button" && [].concat(item.props.children).includes("Kanban")).props.onClick();
  tree = elements(view.render());
  const kanban = tree.find(item => item.type?.name === "LeadsKanban");
  assert.deepEqual(Array.from(kanban.props.leads, row => row.id), [8, 9, 7]);
  tree.find(item => item.props?.placeholder === "Search leads...").props.onChange({target: {value: "no match"}});
  assert.doesNotThrow(() => view.render());
  view.close();
});

test("Prospects reconciles native CRM before loading and refreshes on browser focus", async () => {
  const calls = [];
  let stageId = 4;
  const view = page(async (url, options) => {
    calls.push([url, options.method || "GET"]);
    return response(url.endsWith("sync-journey") ? { crm_synced: 1 }
      : url.endsWith("stages") ? { stages: [{ id: 4, name: "Documents", sequence: 40 }] }
      : { leads: [{ id: 7, stage_id: stageId, name: "QA" }] });
  });
  await settle();
  assert.equal(calls[0][1], "POST");
  assert.equal(calls[0][0], "/api/backend/crm/leads/sync-journey");
  assert.equal(view.state[0][0].stage_id, 4);
  stageId = 6;
  view.windowEvents.get("focus")();
  await settle();
  assert.equal(view.state[0][0].stage_id, 6);
  assert.equal(calls.length, 6);
  view.document.visibilityState = "hidden";
  view.documentEvents.get("visibilitychange")();
  assert.equal(calls.length, 6);
  view.close();
  assert.equal(view.windowEvents.size + view.documentEvents.size, 0);
});

test("a CRM warning still loads Odoo data and can recover on the next refresh", async () => {
  let pending = true;
  const view = page(async url => response(url.endsWith("sync-journey")
    ? pending ? { crm_warning: "pending" } : { crm_synced: 0 }
    : url.endsWith("stages") ? { stages: [] } : { leads: [{ id: 7, stage_id: 3 }] }));
  await settle();
  assert.equal(view.state[4], true);
  assert.equal(view.state[0][0].stage_id, 3);
  pending = false;
  view.windowEvents.get("focus")();
  await settle();
  assert.equal(view.state[4], false);
  view.close();
});

test("focus and visibility events cannot overlap an in-flight CRM refresh", async () => {
  let resolveSync;
  const calls = [];
  const view = page((url) => {
    calls.push(url);
    return url.endsWith("sync-journey") ? new Promise(resolve => { resolveSync = resolve; })
      : Promise.resolve(response(url.endsWith("stages") ? { stages: [] } : { leads: [] }));
  });
  view.windowEvents.get("focus")(); view.documentEvents.get("visibilitychange")();
  assert.equal(calls.length, 1);
  resolveSync(response({ crm_synced: 0 }));
  await settle();
  assert.equal(calls.length, 3);
  assert.equal(view.state[2], false);
  view.close();
});
