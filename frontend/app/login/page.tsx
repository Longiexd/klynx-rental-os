"use client";

import { FormEvent, PointerEvent, useRef, useState } from "react";
import Link from "next/link";
import styles from "./login.module.css";

export default function LoginPage() {
  const backgroundRef = useRef<HTMLDivElement>(null);

  function moveBackground(event: PointerEvent<HTMLElement>) {
    if (event.pointerType !== "mouse" ||
        !window.matchMedia("(hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)").matches) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    backgroundRef.current?.style.setProperty("--glow-x", `${(event.clientX - bounds.left) / bounds.width * 100}%`);
    backgroundRef.current?.style.setProperty("--glow-y", `${(event.clientY - bounds.top) / bounds.height * 100}%`);
    backgroundRef.current?.style.setProperty("--pink-x", `${100 - (event.clientX - bounds.left) / bounds.width * 70}%`);
    backgroundRef.current?.style.setProperty("--pink-y", `${100 - (event.clientY - bounds.top) / bounds.height * 60}%`);
  }

  function resetBackground() {
    backgroundRef.current?.style.removeProperty("--glow-x");
    backgroundRef.current?.style.removeProperty("--glow-y");
    backgroundRef.current?.style.removeProperty("--pink-x");
    backgroundRef.current?.style.removeProperty("--pink-y");
  }

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setError("");
    setLoading(true);

    try {
      const response = await fetch("/api/auth", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          username,
          password,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.message || "Invalid username or password.");
        setLoading(false);
        return;
      }

      // Reload after login so no previous tenant's client state survives.
      window.location.assign("/dashboard");
    } catch {
      setError("Unable to sign in. Please try again.");
      setLoading(false);
    }
  }

  return (
    <main
      onPointerMove={moveBackground}
      onPointerLeave={resetBackground}
      className={`${styles.page} relative flex min-h-screen items-center justify-center overflow-hidden px-6 py-12`}
    >
      <div ref={backgroundRef} aria-hidden="true" className={styles.ambient} />

      {/* =========================================================
          LOGIN
      ========================================================= */}

      <div className="relative w-full max-w-[390px]">
        {/* Logo */}

        <div className="mb-8 text-center">
          <Link href="/" aria-label="Klynx" className="inline-flex items-baseline font-syne text-2xl font-semibold tracking-tight">
            KLYN<span className="text-[#C8F065]">X</span><span className="text-[#F06AAA]">OS</span>
          </Link>

          <p className="mt-2 text-sm text-muted">
            Rental business operating system
          </p>
        </div>

        {/* Card */}

        <div className={`${styles.panel} rounded-2xl border p-6`}>
          <div className="mb-6">
            <h1 className="font-[Syne] text-xl font-semibold">
              Welcome back
            </h1>

            <p className="mt-1 text-sm text-muted">
              Sign in to your workspace.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Username */}

            <div>
              <label
                htmlFor="username"
                className="mb-2 block text-xs text-text-secondary"
              >
                Username
              </label>

              <input
                id="username"
                type="text"
                autoComplete="username"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                placeholder="company.username"
                className="
                  h-10
                  w-full
                  rounded-lg
                  border
                  border-border
                  bg-background
                  px-3
                  text-sm
                  outline-none
                  transition
                  placeholder:text-muted
                  focus:border-[#C8F065]/50
                "
              />
            </div>

            {/* Password */}

            <div>
              <label
                htmlFor="password"
                className="mb-2 block text-xs text-text-secondary"
              >
                Password
              </label>

              <input
                id="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="••••••••"
                className="
                  h-10
                  w-full
                  rounded-lg
                  border
                  border-border
                  bg-background
                  px-3
                  text-sm
                  outline-none
                  transition
                  placeholder:text-muted
                  focus:border-[#C8F065]/50
                "
              />
            </div>

            {/* Error */}

            {error && (
              <div
                role="alert"
                className="
                  rounded-lg
                  border
                  border-[var(--status-danger-border)]
                  bg-[var(--status-danger-bg)]
                  px-3
                  py-2
                  text-xs
                  text-[var(--status-danger-text)]
                "
              >
                {error}
              </div>
            )}

            {/* Submit */}

            <button
              type="submit"
              disabled={loading}
              className="
                h-10
                w-full
                rounded-lg
                bg-[#C8F065]
                text-sm
                font-medium
                text-black
                transition
                hover:bg-[#d7ff80]
                disabled:cursor-not-allowed
                disabled:opacity-50
              "
            >
              {loading ? "Opening workspace..." : "Sign in"}
            </button>
          </form>
        </div>
      </div>
    </main>
  );
}
