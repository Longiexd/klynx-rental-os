import Link from "next/link";

export default function Home() {
  return (
    <div className="min-h-screen overflow-hidden bg-[#09090B] text-white">

      {/* =========================================================
          AMBIENT BACKGROUND
      ========================================================= */}

      <div className="pointer-events-none absolute inset-0 -z-10">

        <div
          className="
            absolute
            left-1/2
            top-[-250px]
            h-[500px]
            w-[700px]
            -translate-x-1/2
            rounded-full
            bg-[#C8F065]/10
            blur-[160px]
          "
        />

        <div
          className="
            absolute
            right-[-200px]
            top-[300px]
            h-[500px]
            w-[500px]
            rounded-full
            bg-[#F06AAA]/10
            blur-[180px]
          "
        />

      </div>


      {/* =========================================================
          NAVBAR
      ========================================================= */}

      <nav
        className="
          mx-auto
          flex
          max-w-6xl
          items-center
          justify-between
          px-6
          py-6
        "
      >

        {/* Logo */}

        <div
          className="
            font-[Syne]
            text-xl
            font-semibold
            tracking-tight
          "
        >
          Klyn
          <span className="text-[#C8F065]">x</span>
          <span className="text-[#F06AAA]">OS</span>
        </div>


        {/* Demo */}

        <Link
          href="/login"
          className="
            rounded-lg
            border
            border-[#2B2B30]
            bg-[#111113]
            px-4
            py-2
            text-sm
            text-[#A1A1AA]
            transition
            hover:border-[#3B3B42]
            hover:text-white
          "
        >
          Demo
        </Link>

      </nav>


      {/* =========================================================
          HERO
      ========================================================= */}

      <main className="mx-auto max-w-6xl px-6">

        <section className="pt-28 text-center">

          {/* Badge */}

          <div
            className="
              inline-flex
              items-center
              gap-2
              rounded-full
              border
              border-[#2B2B30]
              bg-[#111113]/70
              px-3
              py-1.5
              text-xs
              text-[#A1A1AA]
              backdrop-blur
            "
          >

            <span
              className="
                h-1.5
                w-1.5
                rounded-full
                bg-[#C8F065]
                shadow-[0_0_10px_#C8F065]
              "
            />

            Rental Intelligence Platform

          </div>


          {/* Heading */}

          <h1
            className="
              mt-8
              font-[Syne]
              text-5xl
              font-semibold
              leading-[1.05]
              tracking-tight
              md:text-6xl
            "
          >
            Your rental business.

            <br />

            <span
              className="
                bg-gradient-to-r
                from-[#C8F065]
                via-white
                to-[#F06AAA]
                bg-clip-text
                text-transparent
              "
            >
              Operating as one system.
            </span>

          </h1>


          {/* Description */}

          <p
            className="
              mx-auto
              mt-6
              max-w-xl
              text-base
              leading-relaxed
              text-[#A1A1AA]
            "
          >
            Klynx OS connects fleet, rentals, customers and analytics
            into a single intelligent workspace.
          </p>


          {/* CTA */}

          <div className="mt-8 flex justify-center">

            <Link
              href="/login"
              className="
                group
                rounded-xl
                bg-[#C8F065]
                px-5
                py-2.5
                text-sm
                font-medium
                text-black
                shadow-[0_0_30px_rgba(200,240,101,0.15)]
                transition
                hover:bg-[#d7ff80]
              "
            >
              Open OS

              <span
                className="
                  ml-2
                  inline-block
                  opacity-50
                  transition
                  group-hover:translate-x-1
                "
              >
                →
              </span>

            </Link>

          </div>

        </section>


        {/* =========================================================
            APP PREVIEW
        ========================================================= */}

        <section className="mt-20 pb-32">

          <div
            className="
              rounded-2xl
              border
              border-[#2B2B30]
              bg-[#111113]/80
              p-2
              shadow-[0_30px_120px_rgba(0,0,0,.7)]
              backdrop-blur-xl
            "
          >

            <div
              className="
                overflow-hidden
                rounded-xl
                border
                border-[#2B2B30]
                bg-[#09090B]
              "
            >

              {/* Browser top bar */}

              <div
                className="
                  flex
                  h-10
                  items-center
                  gap-2
                  border-b
                  border-[#2B2B30]
                  px-4
                "
              >

                <div className="h-2 w-2 rounded-full bg-[#F06AAA]" />
                <div className="h-2 w-2 rounded-full bg-[#C8F065]" />

                <div
                  className="
                    ml-4
                    text-xs
                    text-[#71717A]
                  "
                >
                  klynx-os/dashboard
                </div>

              </div>


              <div
                className="
                  grid
                  gap-8
                  p-8
                  md:grid-cols-[170px_1fr]
                "
              >

                {/* Preview sidebar */}

                <aside className="space-y-2">

                  {[
                    "Dashboard",
                    "Fleet",
                    "Rentals",
                    "CRM",
                    "Calendar",
                    "Analytics",
                  ].map((item, index) => (
                    <div
                      key={item}
                      className={`
                        rounded-lg
                        px-3
                        py-2
                        text-xs
                        ${
                          index === 0
                            ? "bg-[#C8F065]/10 text-[#C8F065]"
                            : "text-[#71717A]"
                        }
                      `}
                    >
                      {item}
                    </div>
                  ))}

                </aside>


                {/* Preview content */}

                <div>

                  <div className="grid gap-4 md:grid-cols-3">

                    {[
                      ["Vehicles", "248"],
                      ["Rentals", "42"],
                      ["Revenue", "48K"],
                    ].map(([label, value]) => (
                      <div
                        key={label}
                        className="
                          rounded-xl
                          border
                          border-[#2B2B30]
                          bg-[#111113]
                          p-4
                        "
                      >

                        <p className="text-xs text-[#71717A]">
                          {label}
                        </p>

                        <p
                          className="
                            mt-3
                            font-[Syne]
                            text-2xl
                          "
                        >
                          {value}
                        </p>

                      </div>
                    ))}

                  </div>


                  <div
                    className="
                      mt-4
                      h-40
                      rounded-xl
                      border
                      border-[#2B2B30]
                      bg-gradient-to-br
                      from-[#C8F065]/5
                      via-transparent
                      to-[#F06AAA]/5
                    "
                  />

                </div>

              </div>

            </div>

          </div>

        </section>

      </main>

    </div>
  );
}