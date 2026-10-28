# Klynx Rental OS

A rental operations platform with a Next.js/React frontend, a FastAPI backend,
and Odoo integration. This repository is the curated public source showcase.

## Current capabilities

- Fleet and fleet-care workspaces, customers, and CRM journeys.
- Rentals, calendar availability, inspections, and vehicle returns.
- Invoices, finance views, and security-deposit settlement integration.
- Analytics, activity tracking, search, and French interface translations.
- Tenant-scoped sessions, role checks, and a server-side API proxy.

The frontend calls the server-side proxy; FastAPI enforces sessions and tenant
access before communicating with Odoo. Authentication and tenant isolation are
preserved in this edition.

## Scope and limitations

Public application source, selected isolated tests, and Odoo addons are included.
Production deployment tooling, infrastructure configuration, tenant provisioning,
operational records, credentials, and internal documentation are excluded.
Example domains are deliberately non-routable. There is no hosted demo or
preconfigured tenant database in this repository. The normal login requires an
isolated local Odoo setup and tenant registry; it does not accept a demo bypass.

## Verify locally

Use Python 3.12 and Node.js 22. In a fresh checkout:

```sh
python -m venv .venv
# Activate the virtual environment for your shell.
python -m pip install -r backend/requirements.txt pytest httpx
python verify_backend.py
cd frontend
npm ci
npx tsc --noEmit
node --experimental-strip-types --test lib/*.test.mjs
```

To compile the frontend, set `NEXT_PUBLIC_API_URL=http://localhost:8000` in your
shell, then run `npm run build`. Next.js downloads Google fonts during this build,
so outbound access is required. Runtime backend configuration is documented in
`backend/README.md`; frontend configuration is in `frontend/README.md`.

Use synthetic records for examples and screenshots. Never connect an exploratory
checkout to a live business database.

The backend runner uses one process per module: these tests configure different
origins while the API reads CORS configuration at import time. This prevents
one module's configuration from leaking into another module's test environment.

## Publication

Public updates are generated from a reviewed, scanned export. Only the resulting
files are committed here; development Git history and private review reports are
not part of the public repository.

## Usage rights

This repository is available for portfolio inspection. No additional license or
permission to redistribute is granted by this update; contact the repository
owner regarding use beyond rights otherwise provided by the hosting platform.
