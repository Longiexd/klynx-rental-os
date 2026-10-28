import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as jsx from "react/jsx-runtime";
import { matchesShortcut } from "./navigation-search.ts";
import { backendPath } from "./proxy-security.mjs";

function elements(tree) {
  if (!tree || typeof tree !== "object") return [];
  if (Array.isArray(tree)) return tree.flatMap(elements);
  return [tree, ...elements(tree.props?.children)];
}

function mount(name, props, request = async () => ({ok: true, json: async () => ({results: []})})) {
  const slots = [], effects = [], timers = new Map(), events = new Map(), navigated = [];
  let cursor = 0, timerId = 0;
  const dialog = {showModal() {}, close() {}, querySelector: () => ({scrollIntoView() {}})};
  const hooks = {
    useState: initial => {const i = cursor++; if (!(i in slots)) slots[i] = initial;
      return [slots[i], next => {slots[i] = typeof next === "function" ? next(slots[i]) : next;}];},
    useRef: initial => {const i = cursor++; return slots[i] ||= {current: initial};},
    useEffect: (fn, deps) => {const i = cursor++; const old = slots[i];
      if (!old || deps.some((value, index) => value !== old.deps[index])) effects.push(() => {
        old?.cleanup?.(); slots[i] = {deps, cleanup: fn()};
      });},
  };
  const source = readFileSync(new URL(`../components/layout/${name}.tsx`, import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX}}).outputText;
  const sandboxModule = {exports: {}};
  runInNewContext(compiled, {module: sandboxModule, exports: sandboxModule.exports, AbortController,
    window: {addEventListener: (key, fn) => events.set(key, fn), removeEventListener: key => events.delete(key),
      setTimeout: fn => {timers.set(++timerId, fn); return timerId;}, clearTimeout: id => timers.delete(id)},
    require: id => {
      if (id === "react") return hooks;
      if (id === "react/jsx-runtime") return jsx;
      if (id === "next/navigation") return {usePathname: () => "/dashboard/rentals/33", useRouter: () => ({push: href => navigated.push(href)})};
      if (id.endsWith("navigation-search")) return {matchesShortcut};
      if (id.endsWith("api-config")) return {API_URL: "/api/backend", apiRequest: request};
      if (id.endsWith("UIProvider")) return {useKlynxUI: () => ({t: value => value, locale: "en", theme: "dark"})};
      return new Proxy({}, {get: () => () => null});
    }});
  return {events, timers, navigated, render() {
    cursor = 0;
    const tree = elements(sandboxModule.exports[name](props));
    tree.filter(item => item.type === "dialog").forEach(item => {item.props.ref.current = dialog;});
    effects.splice(0).forEach(fn => fn());
    return tree;
  }};
}

test("navigation understands French/English task words and only searches supplied modules", () => {
  assert.ok(matchesShortcut({label: "Fleet care", href: "/dashboard/fleet-care"}, "assurance"));
  assert.ok(matchesShortcut({label: "Rentals", href: "/dashboard/rentals"}, "paiement"));
  assert.ok(matchesShortcut({label: "Vehicles", href: "/dashboard/fleet"}, "véhicules"));
  assert.equal(matchesShortcut({label: "Customers", href: "/dashboard/customers"}, "analytics"), false);
  assert.equal(backendPath(["search"]), "/search");
});

test("command palette opens by keyboard and guides directly to the current rental section", () => {
  const view = mount("NavigationSearch", {navigation: [{label: "Rentals", href: "/dashboard/rentals"}], onNewBooking() {}, onNewCustomer() {}});
  let tree = view.render();
  view.events.get("keydown")({key: "k", ctrlKey: true, preventDefault() {}});
  tree = view.render();
  const input = tree.find(item => item.props?.role === "combobox");
  assert.equal(input.props["aria-expanded"], true);
  input.props.onChange({target: {value: "contrat"}});
  tree = view.render();
  const option = tree.find(item => item.props?.role === "option");
  assert.ok(option);
  tree.find(item => item.props?.role === "combobox").props.onKeyDown({key: "Enter", preventDefault() {}});
  assert.equal(view.navigated[0], "/dashboard/rentals/33#paperwork");
  assert.equal(view.render().find(item => item.props?.role === "combobox").props["aria-expanded"], false);
});

test("an obsolete Odoo response is aborted and cannot replace the latest search", async () => {
  let resolveRequest, signal;
  const view = mount("NavigationSearch", {navigation: [], onNewBooking() {}, onNewCustomer() {}}, async (_, init) => {
    signal = init.signal;
    return new Promise(resolve => {resolveRequest = resolve;});
  });
  let tree = view.render();
  tree.find(item => item.type === "button" && item.props["aria-label"] === "Search and shortcuts").props.onClick();
  tree = view.render();
  tree.find(item => item.props?.role === "combobox").props.onChange({target: {value: "old name"}});
  view.render();
  const pending = [...view.timers.values()][0]();
  tree = view.render();
  tree.find(item => item.props?.role === "combobox").props.onChange({target: {value: "new name"}});
  view.render();
  assert.equal(signal.aborted, true);
  resolveRequest({ok: true, json: async () => ({results: [{id: "old", kind: "Rental", label: "OLD", href: "/dashboard/rentals/1"}]})});
  await pending;
  assert.ok(!view.render().some(item => item.props?.id === "navigation-result-0"));
});

test("live record results appear and navigate to their current Odoo destination", async () => {
  const view = mount("NavigationSearch", {navigation: [], onNewBooking() {}, onNewCustomer() {}}, async url => {
    assert.ok(url.endsWith("/search?q=S00033"));
    return {ok: true, json: async () => ({results: [{id: "rental-33", kind: "Rental", label: "S00033", description: "Customer", href: "/dashboard/rentals/33"}]})};
  });
  let tree = view.render();
  tree.find(item => item.type === "button" && item.props["aria-label"] === "Search and shortcuts").props.onClick();
  tree = view.render();
  tree.find(item => item.props?.role === "combobox").props.onChange({target: {value: "S00033"}});
  view.render();
  await [...view.timers.values()][0]();
  tree = view.render();
  tree.find(item => item.props?.role === "option").props.onClick();
  assert.equal(view.navigated[0], "/dashboard/rentals/33");
});

test("mobile tabs expose four direct destinations and a grouped More menu", () => {
  const view = mount("MobileNavigation", {navigation: [{label: "Rentals", href: "/dashboard/rentals", workspace: "rentals", icon: () => null}], groups: [{id: "rentals", label: "Rentals"}], isActive: href => href === "/dashboard/fleet", onNewBooking() {}});
  const tree = view.render();
  const nav = tree.find(item => item.type === "nav");
  assert.deepEqual(elements(nav).filter(item => item.props?.href).map(item => item.props.href), ["/dashboard", "/dashboard/calendar", "/dashboard/fleet", "/dashboard/customers"]);
  assert.equal(elements(nav).find(item => item.props?.["aria-current"] === "page").props.href, "/dashboard/fleet");
  assert.ok(tree.find(item => item.props?.["aria-controls"] === "mobile-menu"));
});
