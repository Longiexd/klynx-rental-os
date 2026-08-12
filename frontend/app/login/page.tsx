"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function LoginPage() {
  const router = useRouter();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setError("");
    setLoading(true);

    // ---------------------------------------------------------
    // DEMO AUTH
    // ---------------------------------------------------------

    if (username === "demo-user" && password === "demo-password") {
      document.cookie =
        "klynx_session=demo; path=/; max-age=86400; SameSite=Lax";

      router.push("/dashboard");
      router.refresh();

      return;
    }

    setError("Invalid username or password.");
    setLoading(false);
  }

  return (
    <main
      className="
        relative
        flex
        min-h-screen
        items-center
        justify-center
        overflow-hidden
        bg-[#09090B]
        px-6
        text-white
      "
    >

      {/* =========================================================
          AMBIENT BACKGROUND
      ========================================================= */}

      <div className="pointer-events-none absolute inset-0">

        <div
          className="
            absolute
            left-1/2
            top-[-250px]
            h-[600px]
            w-[600px]
            -translate-x-1/2
            rounded-full
            bg-[#C8F065]/[0.055]
            blur-[160px]
          "
        />

        <div
          className="
            absolute
            bottom-[-250px]
            right-[-100px]
            h-[500px]
            w-[500px]
            rounded-full
            bg-[#F06AAA]/[0.045]
            blur-[160px]
          "
        />

      </div>


      {/* =========================================================
          LOGIN
      ========================================================= */}

      <div className="relative w-full max-w-[390px]">

        {/* Logo */}

        <div className="mb-8 text-center">

          <Link
            href="/"
            className="
              font-[Syne]
              text-2xl
              font-semibold
              tracking-tight
            "
          >
            Klyn
            <span className="text-[#C8F065]">x</span>
            <span className="text-[#F06AAA]">OS</span>
          </Link>

          <p className="mt-2 text-sm text-[#71717A]">
            Rental business operating system
          </p>

        </div>


        {/* Card */}

        <div
          className="
            rounded-2xl
            border
            border-[#2B2B30]
            bg-[#111113]/90
            p-6
            shadow-[0_30px_100px_rgba(0,0,0,.6)]
            backdrop-blur-xl
          "
        >

          <div className="mb-6">

            <h1 className="font-[Syne] text-xl font-semibold">
              Welcome back
            </h1>

            <p className="mt-1 text-sm text-[#71717A]">
              Sign in to your workspace.
            </p>

          </div>


          <form
            onSubmit={handleSubmit}
            className="space-y-4"
          >

            {/* Username */}

            <div>

              <label
                htmlFor="username"
                className="mb-2 block text-xs text-[#A1A1AA]"
              >
                Username
              </label>

              <input
                id="username"
                type="text"
                autoComplete="username"
                value={username}
                onChange={(event) =>
                  setUsername(event.target.value)
                }
                placeholder="admin"
                className="
                  h-10
                  w-full
                  rounded-lg
                  border
                  border-[#2B2B30]
                  bg-[#09090B]
                  px-3
                  text-sm
                  outline-none
                  transition
                  placeholder:text-[#52525B]
                  focus:border-[#C8F065]/50
                "
              />

            </div>


            {/* Password */}

            <div>

              <label
                htmlFor="password"
                className="mb-2 block text-xs text-[#A1A1AA]"
              >
                Password
              </label>

              <input
                id="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) =>
                  setPassword(event.target.value)
                }
                placeholder="••••••••"
                className="
                  h-10
                  w-full
                  rounded-lg
                  border
                  border-[#2B2B30]
                  bg-[#09090B]
                  px-3
                  text-sm
                  outline-none
                  transition
                  placeholder:text-[#52525B]
                  focus:border-[#C8F065]/50
                "
              />

            </div>


            {/* Error */}

            {error && (
              <div
                className="
                  rounded-lg
                  border
                  border-[#54273C]
                  bg-[#54273C]/20
                  px-3
                  py-2
                  text-xs
                  text-[#F06AAA]
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


        <p className="mt-5 text-center text-[11px] text-[#52525B]">
          Klynx OS · Demo environment
        </p>

      </div>

    </main>
  );
}