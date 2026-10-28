import { NextResponse } from "next/server";
import { backendRequest } from "@/lib/backend-server";
import {
  COOKIE_NAME,
  COOKIE_OPTIONS,
  boundedBody,
  configuration,
  sameOrigin,
} from "@/lib/proxy-security.mjs";

function message(text: string, status: number) {
  return NextResponse.json(
    { success: false, message: text },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: Request) {
  let stage = "configuration";

  try {
    const config = configuration(process.env);

    console.info("Login diagnostic", {
      revision: "login-debug-2",
      accessIdPresent: Boolean(process.env.CF_ACCESS_CLIENT_ID),
      accessSecretPresent: Boolean(process.env.CF_ACCESS_CLIENT_SECRET),
    });

    stage = "request-validation";

    if (!sameOrigin(request, config.origin)) {
      return message("Invalid request origin", 403);
    }

    if (!request.headers.get("content-type")?.startsWith("application/json")) {
      return message("JSON is required", 415);
    }

    let body;
    try {
      body = JSON.parse(await boundedBody(request, 4096));
    } catch {
      return message("Invalid request", 400);
    }

    if (
      typeof body?.username !== "string" ||
      typeof body?.password !== "string"
    ) {
      return message("Invalid request", 400);
    }

    stage = "backend-request";

    const upstream = await backendRequest(
      "/auth/login",
      {
        method: "POST",
        body: JSON.stringify({
          username: body.username,
          password: body.password,
        }),
      },
      request.headers.get("cf-connecting-ip") || "unknown",
    );

    console.info("Login upstream", {
      status: upstream.status,
      contentType: upstream.headers.get("content-type"),
      isRedirect: upstream.status >= 300 && upstream.status < 400,
    });

    if (!upstream.ok) {
      const status = [401, 422, 429].includes(upstream.status)
        ? upstream.status
        : 503;

      return message(
        status === 429
          ? "Too many attempts. Please wait a minute."
          : status === 503
            ? "Company service unavailable"
            : "Invalid username or password",
        status,
      );
    }

    stage = "backend-json";
    const data = await upstream.json();

    stage = "token-validation";
    if (
      typeof data?.token !== "string" ||
      !/^[A-Za-z0-9_-]{43}$/.test(data.token)
    ) {
      console.error("Login token check", { valid: false });
      return message("Company service unavailable", 503);
    }

    stage = "session-cookie";
    const response = NextResponse.json(
      { success: true },
      { headers: { "Cache-Control": "no-store" } },
    );

    response.cookies.set(COOKIE_NAME, data.token, {
      ...COOKIE_OPTIONS,
      sameSite: "lax",
      maxAge: 8 * 3600,
    });

    // Expire the former demo cookie.
    response.cookies.set("klynx_session", "", {
      httpOnly: true,
      secure: true,
      path: "/",
      maxAge: 0,
    });

    console.info("Login completed", { success: true });
    return response;
  } catch (error) {
    console.error("Login failed", {
      revision: "login-debug-2",
      stage,
      errorType: error instanceof Error ? error.name : "Unknown",
      configurationRejected:
        error instanceof Error &&
        error.message === "Incomplete or mismatched server environment",
      stagingEnvironment: process.env.APP_ENV === "staging",
      stagingApiUrlMatches:
        process.env.NEXT_PUBLIC_API_URL ===
        "https://api-staging.rental-os.example.invalid",
      proxyKeyPresent: Boolean(process.env.KLYNX_PROXY_KEY),
      proxyKeyLengthValid:
        (process.env.KLYNX_PROXY_KEY?.length ?? 0) >= 32,
      accessIdPresent: Boolean(process.env.CF_ACCESS_CLIENT_ID),
      accessSecretPresent: Boolean(process.env.CF_ACCESS_CLIENT_SECRET),
    });

    return message("Company service unavailable", 503);
  }
}

export async function GET() {
  try {
    const upstream = await backendRequest("/auth/session", { method: "GET" });
    if (!upstream.ok) return message("Session unavailable", upstream.status === 401 ? 401 : 503);
    const data = await upstream.json();
    return NextResponse.json(
      { username: data.username, company: data.company, plan: data.plan, features: data.features },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return message("Session unavailable", 503);
  }
}

export async function DELETE(request: Request) {
  try {
    if (!sameOrigin(request, configuration(process.env).origin)) {
      return message("Invalid request origin", 403);
    }

    const upstream = await backendRequest("/auth/session", {
      method: "DELETE",
    });

    if (!upstream.ok) {
      return message("Could not finish signing out. Please retry.", 503);
    }

    const response = NextResponse.json(
      { success: true },
      { headers: { "Cache-Control": "no-store" } },
    );

    response.cookies.set(COOKIE_NAME, "", {
      ...COOKIE_OPTIONS,
      sameSite: "lax",
      maxAge: 0,
    });

    return response;
  } catch {
    return message("Could not finish signing out. Please retry.", 503);
  }
}