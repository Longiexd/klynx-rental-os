from concurrent.futures import ThreadPoolExecutor
import hashlib
import secrets
import time
from unittest.mock import patch

from cryptography.fernet import Fernet
from fastapi import HTTPException
from fastapi.testclient import TestClient
import pytest

from app.control import Control, Settings, IDLE_SECONDS
from app.odoo_client import OdooClient, current_client, odoo


@pytest.fixture
def control(tmp_path):
    store = Control(Settings("test", tmp_path, Fernet.generate_key(), secrets.token_urlsafe(48)))
    store.initialize()
    with store.db(True) as db:
        for company in ("atlas", "bravo"):
            db.execute("INSERT INTO companies VALUES (?,?,?,?,?)", (company, company.title(), f"http://{company}:8069", "db_"+company, "active"))
            db.execute("INSERT INTO users VALUES (?,?,?,?,1)", (company, "sarah", 8, "operator"))
    return store


@pytest.fixture
def client(control, monkeypatch, tmp_path):
    monkeypatch.setenv("APP_ENV", "test")
    monkeypatch.setenv("CORS_ALLOWED_ORIGINS", "https://staging.rental-os.example.invalid")
    monkeypatch.setenv("KLYNX_STATE_DIR", str(tmp_path))
    for setting, name, value in [("KLYNX_SESSION_KEY_FILE", "session.key", control.settings.cipher_key.decode()),
                                  ("KLYNX_PROXY_KEY_FILE", "proxy.key", control.settings.proxy_key)]:
        path = tmp_path / name
        path.write_text(value)
        monkeypatch.setenv(setting, str(path))
    from app.main import app
    with TestClient(app) as client:
        yield client


def headers(control, token=""):
    return {"X-Klynx-Proxy-Key": control.settings.proxy_key, "X-Klynx-Session": token}


def test_cors_allows_proxy_headers_and_rejects_arbitrary_headers(client):
    headers = {"Origin": "https://staging.rental-os.example.invalid", "Access-Control-Request-Method": "POST",
               "Access-Control-Request-Headers": "content-type,x-klynx-proxy-key,x-klynx-session,x-klynx-client-ip"}
    response = client.options("/sales/1/confirm", headers=headers)
    assert response.status_code == 200 and response.headers['access-control-allow-credentials'] == 'true'
    assert '*' not in response.headers['access-control-allow-headers']
    assert client.options("/sales/1/confirm", headers={**headers, 'Access-Control-Request-Headers': 'x-arbitrary-tenant'}).status_code == 400


def issue(control, company="atlas"):
    return control.create_session(control.lookup(company, "sarah"), "odoo-session-"+company)


@pytest.mark.parametrize("path", ["/cars", "/customers", "/crm/leads", "/sales", "/invoices", "/rentals/options", "/calendar", "/analytics", "/activities"])
def test_business_routes_reject_direct_access(client, path):
    assert client.get(path, headers={"X-Tenant-ID": "atlas"}).status_code == 401


def test_demo_cookie_and_obsolete_login_cannot_authenticate(client, control):
    assert client.get("/login").status_code == 404
    assert client.get("/cars", headers={**headers(control), "Cookie": "klynx_session=demo-admin-session"}).status_code == 401


def test_password_validation_never_echoes_input(client, control):
    password = "unique-password-not-for-error-output" * 30
    response = client.post("/auth/login", headers=headers(control), json={"username": "atlas.sarah", "password": password})
    assert response.status_code == 422
    assert "unique-password" not in response.text


def test_login_routes_same_local_username_to_one_company(client, control):
    seen = []
    def authenticate(self, password):
        seen.append((self.profile["database_name"], self.profile["login"], password))
        return "private-odoo-sid"
    with patch.object(OdooClient, "authenticate", authenticate):
        for company in ("atlas", "bravo"):
            response = client.post("/auth/login", headers=headers(control), json={"username": company+".sarah", "password": "user-entered-password"})
            assert response.status_code == 200
            assert control.session(response.json()["token"])["code"] == company
    assert seen == [("db_atlas", "sarah", "user-entered-password"), ("db_bravo", "sarah", "user-entered-password")]


def test_unregistered_username_never_probes_any_odoo(client, control):
    with patch.object(OdooClient, "authenticate") as authenticate:
        response = client.post("/auth/login", headers=headers(control), json={"username": "atlas.unregistered", "password": "irrelevant"})
    assert response.status_code == 401
    authenticate.assert_not_called()


def test_parallel_requests_cannot_switch_tenant_via_headers_or_query(client, control):
    tokens = {company: issue(control, company) for company in ("atlas", "bravo")}
    def rpc(self, path, params):
        time.sleep(0.005)
        if path.endswith("get_session_info"):
            return {"uid": 8, "db": self.profile["database_name"], "is_internal_user": True}
        assert current_client.get() is self
        assert self.http.cookies.get("session_id") == "odoo-session-" + self.profile["code"]
        return []
    def get(company):
        response = client.get("/cars?db=db_intruder&tenant=intruder", headers={**headers(control, tokens[company]), "X-Tenant-ID": "intruder", "X-Odoo-URL": "http://intruder"})
        assert response.status_code == 200
    with patch.object(OdooClient, "rpc", rpc), ThreadPoolExecutor(max_workers=4) as pool:
        list(pool.map(get, ["atlas", "bravo"] * 8))
    assert current_client.get() is None


def test_sessions_are_opaque_encrypted_and_not_plaintext_in_registry(control):
    token = issue(control)
    with control.db() as db:
        row = db.execute("SELECT token_hash, encrypted_sid FROM sessions").fetchone()
    assert row[0] == hashlib.sha256(token.encode()).hexdigest()
    assert b"odoo-session-atlas" not in row[1]
    assert control.session(token)["sid"] == "odoo-session-atlas"


@pytest.mark.parametrize("change", ["expired", "idle", "disabled", "suspended", "revoked"])
def test_session_revocation_and_expiry(control, change):
    token = issue(control)
    with control.db(True) as db:
        if change == "expired": db.execute("UPDATE sessions SET expires=0")
        if change == "idle": db.execute("UPDATE sessions SET touched=?", (time.time()-IDLE_SECONDS-1,))
        if change == "disabled": db.execute("UPDATE users SET active=0")
        if change == "suspended": db.execute("UPDATE companies SET status='suspended'")
    if change == "revoked": control.revoke(token)
    with pytest.raises(HTTPException) as error: control.session(token)
    assert error.value.status_code == 401


def test_mismatched_environment_cannot_open_registry(control):
    settings = Settings("production", control.settings.state_dir, control.settings.cipher_key, control.settings.proxy_key)
    with pytest.raises(RuntimeError, match="environment mismatch"):
        Control(settings).verify()


def test_odoo_revocation_invalidates_local_session(client, control):
    token = issue(control)
    with patch.object(OdooClient, "check", side_effect=HTTPException(401, "expired")):
        assert client.get("/cars", headers=headers(control, token)).status_code == 401
    with pytest.raises(HTTPException): control.session(token)


def test_logout_revokes_even_when_odoo_is_down(client, control):
    token = issue(control)
    with patch.object(OdooClient, "rpc", side_effect=HTTPException(502, "offline")):
        assert client.delete("/auth/session", headers=headers(control, token)).status_code == 200
    with pytest.raises(HTTPException): control.session(token)


def test_no_customer_user_or_company_administration_routes(client, control):
    for path in ("/users", "/companies", "/admin/users", "/admin/companies", "/auth/register", "/auth/reset-password"):
        assert client.post(path, headers=headers(control, issue(control))).status_code == 404


def test_company_limits_do_not_block_other_companies(control):
    leases = [control.lease("atlas") for _ in range(8)]
    with pytest.raises(HTTPException) as error: control.lease("atlas")
    assert error.value.status_code == 429
    control.release(control.lease("bravo"))
    for lease in leases: control.release(lease)
    control.release(control.lease("atlas"))


def test_rate_limit_is_atomic(control):
    def attempt(_):
        try: control.throttle("one-user", 5); return True
        except HTTPException: return False
    with ThreadPoolExecutor(max_workers=10) as pool:
        assert sum(pool.map(attempt, range(20))) == 5


def test_facade_has_no_global_credential_fallback():
    with pytest.raises(HTTPException) as error: odoo.execute("res.partner", "search", [[]])
    assert error.value.status_code == 401


def test_rpc_does_not_return_odoo_tracebacks(control):
    client = OdooClient(control.lookup("atlas", "sarah"))
    with patch.object(client.http, "post") as post:
        post.return_value.status_code = 200
        post.return_value.json.return_value = {"error": {"data": {"name": "odoo.exceptions.AccessError", "debug": "secret traceback"}}}
        with pytest.raises(HTTPException) as error: client.execute("res.partner", "search", [[]])
        assert error.value.status_code == 403
        assert "secret" not in str(error.value.detail)
        assert post.call_args.kwargs["timeout"] == (3, 20)
        assert post.call_args.kwargs["allow_redirects"] is False
    client.close()


@pytest.mark.parametrize("override", [{"uid": 9}, {"db": "db_bravo"}, {"is_system": True}, {"is_admin": True}, {"is_internal_user": False}])
def test_wrong_odoo_identity_or_privileged_account_is_rejected(control, override):
    client = OdooClient(control.lookup("atlas", "sarah"))
    result = {"uid": 8, "db": "db_atlas", "is_internal_user": True, **override}
    with patch.object(client, "rpc", return_value=result):
        with pytest.raises(HTTPException) as error: client.check()
    assert error.value.status_code == 401
    client.close()
