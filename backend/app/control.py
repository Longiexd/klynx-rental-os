"""Small, environment-specific registry. Business data stays in each company's Odoo."""
from contextlib import contextmanager
from dataclasses import dataclass
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import sqlite3
import time

from cryptography.fernet import Fernet, InvalidToken
from fastapi import HTTPException

CODE = re.compile(r"[a-z][a-z0-9-]{1,31}\Z")
LOGIN = re.compile(r"[a-z0-9][a-z0-9_-]{0,63}\Z")
SESSION_SECONDS = 8 * 3600
IDLE_SECONDS = 30 * 60
SESSION_TOUCH_SECONDS = 60
SCHEMA_VERSION = 1


@dataclass(frozen=True)
class Settings:
    environment: str
    state_dir: Path
    cipher_key: bytes
    proxy_key: str

    @classmethod
    def from_env(cls):
        environment = os.environ["APP_ENV"]
        if environment not in {"development", "staging", "production", "test"}:
            raise ValueError("Invalid APP_ENV")
        return cls(environment, Path(os.environ["KLYNX_STATE_DIR"]),
                   Path(os.environ["KLYNX_SESSION_KEY_FILE"]).read_bytes().strip(),
                   Path(os.environ["KLYNX_PROXY_KEY_FILE"]).read_text().strip())


class Control:
    def __init__(self, settings):
        self.settings = settings
        self.path = settings.state_dir / "control.sqlite3"
        self.cipher = Fernet(settings.cipher_key)
        if len(settings.proxy_key) < 32:
            raise ValueError("A strong proxy key is required")

    @contextmanager
    def db(self, write=False):
        connection = sqlite3.connect(self.path.as_uri() + "?mode=rw", uri=True, timeout=5)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys=ON")
        try:
            if write:
                connection.execute("BEGIN IMMEDIATE")
            yield connection
            connection.commit()
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()

    def initialize(self):
        self.path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        if self.path.exists():
            self.verify()
            return
        with sqlite3.connect(self.path) as db:
            db.executescript("""
                PRAGMA journal_mode=WAL;
                PRAGMA foreign_keys=ON;
                CREATE TABLE metadata(version INTEGER, environment TEXT);
                CREATE TABLE companies(
                    code TEXT PRIMARY KEY, name TEXT NOT NULL, endpoint TEXT NOT NULL,
                    database_name TEXT NOT NULL,
                    status TEXT NOT NULL CHECK(status IN ('provisioning','active','suspended','failed')));
                CREATE TABLE users(
                    company TEXT REFERENCES companies(code), login TEXT, uid INTEGER NOT NULL,
                    role TEXT NOT NULL CHECK(role IN ('operator','viewer')),
                    active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)), PRIMARY KEY(company,login));
                CREATE TABLE sessions(
                    token_hash TEXT PRIMARY KEY, company TEXT, login TEXT, encrypted_sid BLOB NOT NULL,
                    expires REAL NOT NULL, touched REAL NOT NULL,
                    FOREIGN KEY(company,login) REFERENCES users(company,login));
                CREATE INDEX sessions_expiry ON sessions(expires);
                CREATE TABLE buckets(key TEXT PRIMARY KEY, count INTEGER, expires REAL);
                CREATE TABLE leases(id TEXT PRIMARY KEY, company TEXT, expires REAL);
                CREATE TABLE audit(id INTEGER PRIMARY KEY, created REAL, actor TEXT,
                                   company TEXT, event TEXT, detail TEXT);
            """)
            db.execute("INSERT INTO metadata VALUES (?,?)", (SCHEMA_VERSION, self.settings.environment))
        self.path.chmod(0o600)

    def verify(self):
        with self.db() as db:
            row = db.execute("SELECT version,environment FROM metadata").fetchone()
            if tuple(row or ()) != (SCHEMA_VERSION, self.settings.environment):
                raise RuntimeError("Control database version/environment mismatch")

    def lookup(self, company, login):
        with self.db() as db:
            row = db.execute("""SELECT c.*, u.login,u.uid,u.role FROM companies c JOIN users u
                ON c.code=u.company WHERE c.code=? AND u.login=? AND c.status='active' AND u.active=1""",
                             (company, login)).fetchone()
            return dict(row) if row else None

    def features(self, company):
        from app.features import resolve
        with self.db() as db:
            exists = db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='company_features'").fetchone()
            row = db.execute("SELECT plan,overrides FROM company_features WHERE company=?", (company,)).fetchone() if exists else None
        # Preserve existing clients until the owner explicitly assigns a plan.
        plan, overrides = (row["plan"], json.loads(row["overrides"])) if row else ("premium", {})
        return {"plan": plan, "overrides": overrides, "features": resolve(plan, overrides)}

    def set_features(self, company, plan=None, overrides=None, reset=False):
        from app.features import resolve
        with self.db(True) as db:
            if not db.execute("SELECT 1 FROM companies WHERE code=?", (company,)).fetchone():
                raise ValueError("Company not found")
            db.execute("""CREATE TABLE IF NOT EXISTS company_features(
                company TEXT PRIMARY KEY REFERENCES companies(code), plan TEXT NOT NULL,
                overrides TEXT NOT NULL)""")
            row = db.execute("SELECT plan,overrides FROM company_features WHERE company=?", (company,)).fetchone()
            chosen = plan or (row["plan"] if row else "premium")
            switches = {} if reset or plan else (json.loads(row["overrides"]) if row else {})
            switches.update(overrides or {})
            resolved = resolve(chosen, switches)
            db.execute("INSERT INTO company_features VALUES (?,?,?) ON CONFLICT(company) DO UPDATE SET plan=excluded.plan,overrides=excluded.overrides",
                       (company, chosen, json.dumps(switches, sort_keys=True)))
            db.execute("INSERT INTO audit(created,actor,company,event,detail) VALUES (?,?,?,?,?)",
                       (time.time(), "klynx", company, "features", json.dumps({"plan": chosen, "features": resolved})))
        return self.features(company)

    def audit(self, actor, company, event, detail=""):
        with self.db(True) as db:
            db.execute("INSERT INTO audit(created,actor,company,event,detail) VALUES (?,?,?,?,?)",
                       (time.time(), actor, company, event, detail[:500]))

    def throttle(self, key, limit, seconds=60):
        now = time.time()
        digest = hashlib.sha256(key.encode()).hexdigest()
        with self.db(True) as db:
            db.execute("DELETE FROM buckets WHERE expires<?", (now,))
            row = db.execute("SELECT count FROM buckets WHERE key=?", (digest,)).fetchone()
            if row and row[0] >= limit:
                raise HTTPException(429, "Please try again later", headers={"Retry-After": str(seconds)})
            db.execute("""INSERT INTO buckets VALUES (?,1,?)
                ON CONFLICT(key) DO UPDATE SET count=count+1""", (digest, now + seconds))

    def create_session(self, profile, sid):
        token = secrets.token_urlsafe(32)
        now = time.time()
        with self.db(True) as db:
            db.execute("DELETE FROM sessions WHERE expires<? OR touched<?", (now, now-IDLE_SECONDS))
            db.execute("INSERT INTO sessions VALUES (?,?,?,?,?,?)", (
                hashlib.sha256(token.encode()).hexdigest(), profile["code"], profile["login"],
                self.cipher.encrypt(sid.encode()), now+SESSION_SECONDS, now))
        return token

    def session(self, token):
        if not token or len(token) > 128:
            raise HTTPException(401, "Please sign in")
        now = time.time()
        digest = hashlib.sha256(token.encode()).hexdigest()
        query = """SELECT c.*,u.login,u.uid,u.role,s.encrypted_sid,s.touched FROM sessions s
                JOIN companies c ON c.code=s.company JOIN users u ON u.company=s.company AND u.login=s.login
                WHERE s.token_hash=? AND s.expires>? AND s.touched>? AND c.status='active' AND u.active=1"""
        parameters = (digest, now, now-IDLE_SECONDS)
        with self.db() as db:
            row = db.execute(query, parameters).fetchone()
        if not row:
            raise HTTPException(401, "Please sign in")
        if now - row["touched"] >= SESSION_TOUCH_SECONDS:
            with self.db(True) as db:
                # Revalidate after acquiring the writer lock: a revoke/disable
                # may have happened since the read. Never cache authorization.
                row = db.execute(query, parameters).fetchone()
                if not row:
                    raise HTTPException(401, "Please sign in")
                if now - row["touched"] >= SESSION_TOUCH_SECONDS:
                    db.execute("UPDATE sessions SET touched=? WHERE token_hash=?", (now, digest))
        profile = dict(row)
        profile.pop("touched")
        try:
            profile["sid"] = self.cipher.decrypt(profile.pop("encrypted_sid")).decode()
        except InvalidToken:
            raise HTTPException(401, "Please sign in") from None
        return profile

    def revoke(self, token):
        with self.db(True) as db:
            db.execute("DELETE FROM sessions WHERE token_hash=?", (hashlib.sha256(token.encode()).hexdigest(),))

    def lease(self, company):
        now = time.time()
        identifier = secrets.token_hex(16)
        with self.db(True) as db:
            db.execute("DELETE FROM leases WHERE expires<?", (now,))
            if db.execute("SELECT COUNT(*) FROM leases WHERE company=?", (company,)).fetchone()[0] >= 8:
                raise HTTPException(429, "Company is busy; please retry", headers={"Retry-After": "5"})
            db.execute("INSERT INTO leases VALUES (?,?,?)", (identifier, company, now+300))
        return identifier

    def release(self, identifier):
        with self.db(True) as db:
            db.execute("DELETE FROM leases WHERE id=?", (identifier,))
