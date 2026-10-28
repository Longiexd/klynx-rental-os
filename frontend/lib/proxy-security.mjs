// Pure helpers shared by the server routes and their security tests.
export const COOKIE_NAME = "__Host-klynx_session";
export const COOKIE_OPTIONS = { httpOnly: true, secure: true, sameSite: "lax", path: "/" };
const prefixes = new Set(["cars", "customers", "crm", "sales", "invoices", "rentals", "calendar", "analytics", "activities", "bookings", "search"]);

export function configuration(env) {
  if (env.APP_ENV === "development") {
    const origin = new URL(env.APP_ORIGIN);
    const backend = new URL(env.NEXT_PUBLIC_API_URL);
    for (const url of [origin, backend]) {
      const allowedHost = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || (url === backend && url.hostname === "backend" && url.port === "8000");
      if (!allowedHost || url.protocol !== "http:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
        throw new Error("Development must use explicit loopback origins");
      }
    }
    if (!env.KLYNX_PROXY_KEY || env.KLYNX_PROXY_KEY.length < 32) throw new Error("Development proxy key is required");
    return { origin: origin.origin, backend: backend.origin, key: env.KLYNX_PROXY_KEY };
  }
  const values = {
    staging: ["https://staging.rental-os.example.invalid", "https://api-staging.rental-os.example.invalid"],
    production: ["https://rental-os.example.invalid", "https://api.rental-os.example.invalid"],
  }[env.APP_ENV];
  if (!values || env.NEXT_PUBLIC_API_URL !== values[1] || !env.KLYNX_PROXY_KEY || env.KLYNX_PROXY_KEY.length < 32) {
    throw new Error("Incomplete or mismatched server environment");
  }
  return { origin: values[0], backend: values[1], key: env.KLYNX_PROXY_KEY };
}

export function sameOrigin(request, origin) {
  return request.headers.get("origin") === origin && request.headers.get("sec-fetch-site") !== "cross-site";
}

export function backendPath(segments) {
  if (!Array.isArray(segments) || !prefixes.has(segments[0]) || segments.length > 12 ||
      segments.some(segment => !/^[a-zA-Z0-9_-]+$/.test(segment))) {
    throw new Error("Invalid API path");
  }
  return "/" + segments.join("/");
}

export async function boundedBody(request, limit = 1024 * 1024) {
  if (Number(request.headers.get("content-length") || 0) > limit) throw new Error("Request too large");
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) throw new Error("Request too large");
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(bytes);
}
