import { NextResponse } from "next/server";

export async function POST(request: Request) {
  try {
    const body = await request.json();

    const { username, password } = body;

    // Temporary demo authentication.
    // This will later be replaced by the FastAPI/Odoo authentication flow.
    if (username !== "demo-user" || password !== "demo-password") {
      return NextResponse.json(
        {
          success: false,
          message: "Invalid username or password",
        },
        {
          status: 401,
        }
      );
    }

    const response = NextResponse.json({
      success: true,
      message: "Login successful",
      user: {
        username: "demo-user",
        role: "Administrator",
      },
    });

    // Temporary session cookie.
    // Later this can become a proper JWT/session from FastAPI.
    response.cookies.set("klynx_session", "demo-admin-session", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 8, // 8 hours
    });

    return response;
  } catch {
    return NextResponse.json(
      {
        success: false,
        message: "Invalid request",
      },
      {
        status: 400,
      }
    );
  }
}