import { backendRequest } from "@/lib/backend-server";
import { backendPath, boundedBody, configuration, sameOrigin } from "@/lib/proxy-security.mjs";

type Context = { params: Promise<{ path: string[] }> };
async function proxy(request: Request, context: Context) {
  try {
    const config = configuration(process.env);
    const mutation = !["GET", "HEAD"].includes(request.method);
    if (mutation && !sameOrigin(request, config.origin)) {
      return Response.json({ detail: "Invalid request origin" }, { status: 403 });
    }
    let path: string;
    try { path = backendPath((await context.params).path); }
    catch { return Response.json({ detail: "Not found" }, { status: 404 }); }
    let body: string | undefined;
    if (mutation) {
      try { body = await boundedBody(request); }
      catch { return Response.json({ detail: "Request too large" }, { status: 413 }); }
      if (body && !request.headers.get("content-type")?.startsWith("application/json")) {
        return Response.json({ detail: "JSON is required" }, { status: 415 });
      }
    }
    const response = await backendRequest(path + new URL(request.url).search, { method: request.method, body });
    if (response.status >= 300 && response.status < 400) {
      return Response.json({ detail: "Company service unavailable" }, { status: 502 });
    }
    if (response.status !== 204 && !/^(application\/json|application\/pdf)(;|$)/i.test(response.headers.get("content-type") || "")) {
      return Response.json({ detail: "Company service unavailable" }, { status: 502 });
    }
    const headers = new Headers({ "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
    for (const key of ["content-type", "content-disposition", "retry-after"]) {
      const value = response.headers.get(key);
      if (value) headers.set(key, value);
    }
    return new Response(response.body, { status: response.status, headers });
  } catch {
    return Response.json({ detail: "Company service unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}

export { proxy as GET, proxy as POST, proxy as PUT, proxy as PATCH, proxy as DELETE };
