import "server-only";
import { cookies } from "next/headers";
import { COOKIE_NAME, configuration } from "./proxy-security.mjs";

export async function backendRequest(path: string, init: RequestInit = {}, clientIp?: string) {
  // Read Worker secrets at request time, never in a public variable or build constant.
  const env = process.env;
  const config = configuration(env);
  const session = (await cookies()).get(COOKIE_NAME)?.value;
  const headers = new Headers({ "Content-Type": "application/json", "X-Klynx-Proxy-Key": config.key });
  if (session) headers.set("X-Klynx-Session", session);
  if (clientIp) headers.set("X-Klynx-Client-IP", clientIp);
  if (env.CF_ACCESS_CLIENT_ID && env.CF_ACCESS_CLIENT_SECRET) {
    headers.set("CF-Access-Client-Id", env.CF_ACCESS_CLIENT_ID);
    headers.set("CF-Access-Client-Secret", env.CF_ACCESS_CLIENT_SECRET);
  }
  return fetch(config.backend + path, { ...init, headers, redirect: "manual", cache: "no-store", signal: AbortSignal.timeout(60000) });
}

export async function hasSession(): Promise<boolean> {
  if (!(await cookies()).get(COOKIE_NAME)?.value) return false;
  const response = await backendRequest("/auth/session");
  if (response.status === 401) return false;
  if (!response.ok) throw new Error("Your company service is temporarily unavailable. Please retry.");
  return true;
}
