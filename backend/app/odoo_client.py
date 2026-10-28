"""Request-scoped Odoo sessions; no shared user or database fallback."""
from contextvars import ContextVar
import re
from urllib.parse import urlsplit

import requests
from fastapi import HTTPException

current_client = ContextVar("odoo_client", default=None)


def safe_odoo_message(error_data, fallback="Odoo could not accept this action; check the record and try again", redactions=()):
    """Use business messages only; never use Odoo's debug/traceback field."""
    message = error_data.get("message")
    if not isinstance(message, str) or not message.strip():
        arguments = error_data.get("arguments")
        message = arguments[0] if isinstance(arguments, (list, tuple)) and arguments and isinstance(arguments[0], str) else ""
    # Discard diagnostic/credential lines as a whole, before truncation. Removing
    # just the keyword could leave its value (or SQL literals) in the response.
    unsafe = re.compile(r"traceback|\bfile\s+[\"']|^\s*(?:select|insert|update|delete|alter|drop|create|with|from|where|join|values|grant|truncate)\b|"
                        r"\bsql\b|password|passwd|\bpwd\b|\bbearer\b|secret|token|authorization|api[_ -]?key|session[_ -]?id|credential", re.I)
    lines = []
    for line in message.splitlines():
        if re.search(r"traceback|\bfile\s+[\"']", line, re.I):
            break
        if unsafe.search(line):
            break  # Diagnostic values may continue onto otherwise innocuous lines.
        for value in redactions:
            if isinstance(value, str) and value:
                line = line.replace(value, "[redacted]")
        line = re.sub(r"https?://\S+|\b(?:[A-Za-z0-9-]+\.)+[A-Za-z][A-Za-z0-9-]*(?::\d+)?\b|"
                      r"\b(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?\b|\bklynx-[\w-]+\b|"
                      r"[A-Za-z]:[\\/]\S+|(?<!\w)/[\w./-]+|\b[A-Za-z0-9_=-]{32,}\b", "[redacted]", line)
        lines.append("".join(char for char in line if char >= " "))
    return " ".join(" ".join(lines).split())[:300] or fallback


class OdooClient:
    def __init__(self, profile, sid=None):
        self.profile = dict(profile)
        self.url = profile["endpoint"].rstrip("/")
        parsed = urlsplit(self.url)
        if parsed.scheme not in {"http", "https"} or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment:
            raise ValueError("Invalid registered Odoo endpoint")
        self.http = requests.Session()
        self.http.trust_env = False
        if sid:
            self.http.cookies.set("session_id", sid)

    def close(self):
        self.http.close()

    def rpc(self, path, params):
        try:
            response = self.http.post(self.url + path, json={"jsonrpc": "2.0", "method": "call", "params": params, "id": 1},
                                      timeout=(3, 20), allow_redirects=False)
            if response.status_code != 200:
                raise HTTPException(502, "Company service unavailable")
            data = response.json()
        except (requests.RequestException, ValueError):
            raise HTTPException(502, "Company service unavailable") from None
        if not isinstance(data, dict):
            raise HTTPException(502, "Invalid company service response")
        if "error" in data:
            error = data.get("error")
            error_data = error.get("data") if isinstance(error, dict) else None
            error_data = error_data if isinstance(error_data, dict) else {}
            name = str(error_data.get("name", "")).rsplit(".", 1)[-1]
            # Odoo can renew a host-scoped cookie alongside the restored cookie.
            # Cookies.get(name) raises CookieConflictError when both are present.
            redactions = (urlsplit(self.url).hostname, self.profile.get("database_name"),
                          *(cookie.value for cookie in self.http.cookies if cookie.name == "session_id"))
            if name in {"AccessDenied", "SessionExpiredException"}:
                raise HTTPException(401, "Please sign in")
            if name == "AccessError":
                raise HTTPException(403, safe_odoo_message(error_data, "Your account does not have access to this action", redactions))
            if name in {"ValidationError", "UserError"}:
                raise HTTPException(422, safe_odoo_message(error_data, redactions=redactions))
            raise HTTPException(502, "Company service could not complete this action")
        if "result" not in data:
            raise HTTPException(502, "Invalid company service response")
        return data["result"]

    def authenticate(self, password):
        result = self.rpc("/web/session/authenticate", {"db": self.profile["database_name"], "login": self.profile["login"], "password": password})
        sid = self.http.cookies.get("session_id")
        if not self.valid_identity(result) or not sid:
            raise HTTPException(401, "Invalid username or password")
        return sid

    def check(self):
        result = self.rpc("/web/session/get_session_info", {})
        if not self.valid_identity(result):
            raise HTTPException(401, "Please sign in")

    def valid_identity(self, result):
        return (isinstance(result, dict) and result.get("uid") == self.profile["uid"]
                and result.get("db") == self.profile["database_name"]
                and result.get("is_internal_user") is True
                and not result.get("is_system") and not result.get("is_admin"))

    def execute(self, model, method, args=None, kwargs=None):
        if method.startswith("_"):
            raise ValueError("Private Odoo methods are forbidden")
        if self.profile.get("role") == "viewer" and method not in {"search", "read", "search_read", "search_count", "fields_get", "klynx_deposit_snapshot"}:
            raise HTTPException(403, "Your account has read-only access")
        return self.rpc("/web/dataset/call_kw", {"model": model, "method": method, "args": args or [], "kwargs": kwargs or {}})

    def document(self, report, identifier):
        if report not in {"account.report_invoice_with_payments", "sale.report_saleorder"} or identifier < 1:
            raise HTTPException(400, "Invalid document")
        try:
            with self.http.get(f"{self.url}/report/pdf/{report}/{identifier}", timeout=(3, 30), allow_redirects=False, stream=True) as response:
                if response.status_code != 200 or "application/pdf" not in response.headers.get("Content-Type", ""):
                    raise HTTPException(502, "Document unavailable")
                chunks, size = [], 0
                for chunk in response.iter_content(65536):
                    size += len(chunk)
                    if size > 20 * 1024 * 1024:
                        raise HTTPException(413, "Document is too large")
                    chunks.append(chunk)
                return b"".join(chunks)
        except requests.RequestException:
            raise HTTPException(502, "Document unavailable") from None


class RequestOdoo:
    def _client(self):
        client = current_client.get()
        if client is None:
            raise HTTPException(401, "Please sign in")
        return client

    def execute(self, model, method, args=None, kwargs=None):
        return self._client().execute(model, method, args, kwargs)

    def document(self, report, identifier):
        return self._client().document(report, identifier)


odoo = RequestOdoo()
