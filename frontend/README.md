# Public interface source

Use Node.js 22. Install with `npm ci`, then run `npx tsc --noEmit` and
`node --experimental-strip-types --test lib/*.test.mjs`.

For a Next.js build, set `NEXT_PUBLIC_API_URL=http://localhost:8000` in your shell
and run `npm run build`. Configuration values for runtime are listed in
`.env.example`. Development origins are restricted to local addresses; staging
and production example hosts are deliberately non-routable.

The server-only proxy key must match a newly generated key in your local API.
Never expose it through a `NEXT_PUBLIC_` variable. The session cookie retains
its Secure, HttpOnly, and SameSite protections. Do not weaken those protections
to simulate a demo. A working authenticated UI requires the local tenant/Odoo
setup described in the root README.
