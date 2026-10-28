import secrets

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field, SecretStr
from starlette.concurrency import run_in_threadpool

from app.control import CODE, LOGIN, SESSION_SECONDS
from app.odoo_client import OdooClient, current_client

router = APIRouter(prefix="/auth", tags=["authentication"])


def trusted_proxy(request: Request):
    control = request.app.state.control
    supplied = request.headers.get("x-klynx-proxy-key", "")
    if not secrets.compare_digest(supplied.encode(), control.settings.proxy_key.encode()):
        raise HTTPException(401, "Unauthorized")
    return control


class Login(BaseModel):
    username: str = Field(min_length=3, max_length=97)
    password: SecretStr = Field(min_length=1, max_length=512)


@router.post("/login")
def login(body: Login, request: Request, control=Depends(trusted_proxy)):
    username = body.username.strip().lower()
    control.throttle("login:all", 120)
    control.throttle("login:ip:" + request.headers.get("x-klynx-client-ip", "unknown"), 30)
    control.throttle("login:user:" + username, 10)
    company, _, local_login = username.partition(".")
    profile = control.lookup(company, local_login) if CODE.fullmatch(company) and LOGIN.fullmatch(local_login) else None
    if not profile:
        raise HTTPException(401, "Invalid username or password")
    lease = control.lease(company)
    client = None
    try:
        client = OdooClient(profile)
        sid = client.authenticate(body.password.get_secret_value())
        token = control.create_session(profile, sid)
        control.audit(username, company, "login")
        return {"token": token, "max_age": SESSION_SECONDS}
    except HTTPException as error:
        if error.status_code in {401, 403}:
            raise HTTPException(401, "Invalid username or password") from None
        raise
    finally:
        if client:
            client.close()
        control.release(lease)


async def require_session(request: Request, control=Depends(trusted_proxy)):
    token = request.headers.get("x-klynx-session", "")
    profile = await run_in_threadpool(control.session, token)
    from app.features import check_path
    entitlements = await run_in_threadpool(control.features, profile["code"])
    profile.update(entitlements)
    check_path(request.url.path, entitlements["features"])
    if profile["role"] == "viewer" and request.method not in {"GET", "HEAD", "OPTIONS"}:
        raise HTTPException(403, "Your account has read-only access")
    await run_in_threadpool(control.throttle, "requests:" + profile["code"], 600)
    lease = await run_in_threadpool(control.lease, profile["code"])
    client, context_token = None, None
    try:
        client = OdooClient(profile, profile["sid"])
        await run_in_threadpool(client.check)
        context_token = current_client.set(client)
        yield profile
        if request.method not in {"GET", "HEAD", "OPTIONS"}:
            await run_in_threadpool(control.audit, profile["login"], profile["code"], request.method, request.url.path)
    except HTTPException as error:
        if error.status_code == 401:
            await run_in_threadpool(control.revoke, token)
        raise
    finally:
        if context_token is not None:
            current_client.reset(context_token)
        if client:
            await run_in_threadpool(client.close)
        await run_in_threadpool(control.release, lease)


@router.get("/session")
def session(profile=Depends(require_session)):
    return {"username": profile["code"] + "." + profile["login"], "company": profile["name"], "role": profile["role"], "plan": profile["plan"], "features": profile["features"]}


@router.delete("/session")
def logout(request: Request, control=Depends(trusted_proxy)):
    token = request.headers.get("x-klynx-session", "")
    try:
        profile = control.session(token)
    except HTTPException:
        profile = None
    control.revoke(token)
    if profile:
        client = OdooClient(profile, profile["sid"])
        try:
            client.rpc("/web/session/destroy", {})
        except HTTPException:
            pass  # The Klynx token is already revoked, including during an Odoo outage.
        finally:
            client.close()
        control.audit(profile["login"], profile["code"], "logout")
    return {"success": True}
