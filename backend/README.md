# Public API source

The FastAPI application retains its normal proxy-key, encrypted tenant-session,
role, entitlement, and tenant-isolation checks. API documentation routes remain
disabled. Public tests create temporary stores and synthetic identities.

Run `python verify_backend.py` from the repository root after installing
`backend/requirements.txt`, `pytest`, and `httpx` in a virtual environment.

`.env.example` lists configuration names. To run the API, create a fresh local
control registry and fresh session/proxy keys, and configure a separate local
Odoo instance. The backend requires an initialized control database before it
becomes ready. Production provisioning utilities are intentionally excluded;
this source showcase is not a one-command deployment distribution.

The Odoo addons under `deploy/odoo-addons` implement rental deposit operations
and report note filtering. Their native integration tests require Odoo's runner;
they are not collected by the isolated backend test command above.
