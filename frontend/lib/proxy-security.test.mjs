import test from "node:test";
import assert from "node:assert/strict";
import { COOKIE_NAME, COOKIE_OPTIONS, configuration, sameOrigin, backendPath, boundedBody } from "./proxy-security.mjs";

const env = { APP_ENV: "staging", NEXT_PUBLIC_API_URL: "https://api-staging.rental-os.example.invalid", KLYNX_PROXY_KEY: "x".repeat(48) };
test("reject mismatched environment and missing secrets", () => {
  assert.equal(configuration(env).origin, "https://staging.rental-os.example.invalid");
  assert.throws(() => configuration({ ...env, APP_ENV: "production" }));
  assert.throws(() => configuration({ ...env, KLYNX_PROXY_KEY: "" }));
});
test("development cannot proxy production or arbitrary remote origins", () => {
  const local = { ...env, APP_ENV: "development", APP_ORIGIN: "http://localhost:3001", NEXT_PUBLIC_API_URL: "http://127.0.0.1:8000" };
  assert.equal(configuration(local).backend, "http://127.0.0.1:8000");
  assert.throws(() => configuration({ ...local, NEXT_PUBLIC_API_URL: env.NEXT_PUBLIC_API_URL }));
  assert.throws(() => configuration({ ...local, APP_ORIGIN: "http://attacker.test" }));
});
test("same-site staging cannot make production mutations", () => {
  const request = new Request("https://rental-os.example.invalid/api/backend/cars", { headers: { origin: "https://staging.rental-os.example.invalid", "sec-fetch-site": "same-site" } });
  assert.equal(sameOrigin(request, "https://rental-os.example.invalid"), false);
  assert.equal(sameOrigin(request, "https://staging.rental-os.example.invalid"), true);
  assert.equal(sameOrigin(new Request(request.url), "https://rental-os.example.invalid"), false);
});
test("proxy cannot forward admin paths, traversal, encoded slashes or arbitrary URLs", () => {
  for (const segments of [["auth", "login"], ["admin", "users"], ["cars", "..", "auth"], ["cars", "%2fadmin"], ["cars", "a/b"], ["https:", "evil.test"]]) {
    assert.throws(() => backendPath(segments));
  }
  assert.equal(backendPath(["invoices", "8", "document"]), "/invoices/8/document");
});
test("cookies cannot be shared with another environment or read by JavaScript", () => {
  assert.equal(COOKIE_NAME, "__Host-klynx_session");
  assert.equal(COOKIE_OPTIONS.httpOnly, true);
  assert.equal(COOKIE_OPTIONS.secure, true);
  assert.equal(COOKIE_OPTIONS.path, "/");
  assert.equal(COOKIE_OPTIONS.domain, undefined);
});
test("body limit also applies to bodies without content-length", async () => {
  await assert.rejects(boundedBody(new Request("https://example.test", { method: "POST", body: "x".repeat(100) }), 20));
  assert.equal(await boundedBody(new Request("https://example.test", { method: "POST", body: "{}" }), 20), "{}");
});
