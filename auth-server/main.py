import hashlib
import os
import secrets
import re
from datetime import datetime, timedelta, timezone

import psycopg
from fastapi import FastAPI, Request, Response, HTTPException
from pydantic import BaseModel, Field
from pwdlib import PasswordHash

app = FastAPI(title="ALABTAL Auth API", docs_url=None, redoc_url=None)
password_hash = PasswordHash.recommended()

DATABASE_URL = os.environ.get("DATABASE_URL", "")
ADMIN_USERNAME = os.environ.get("ADMIN_USERNAME", "").strip().lower()
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "")
SESSION_TTL = 8 * 60 * 60
COOKIE_NAME = "alabtal_session"


class LoginInput(BaseModel):
    username: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=1, max_length=256)


class CreateUserInput(BaseModel):
    username: str = Field(min_length=3, max_length=32)
    password: str = Field(min_length=12, max_length=256)
    role: str = "user"


def db_connect():
    if not DATABASE_URL:
        raise RuntimeError("DATABASE_URL is not configured")
    url = DATABASE_URL
    if url.startswith("postgres://"):
        url = "postgresql://" + url[len("postgres://"):]
    return psycopg.connect(url, connect_timeout=10)


def token_digest(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def initialize_database():
    if not ADMIN_USERNAME or not ADMIN_PASSWORD:
        raise RuntimeError(
            "Set ADMIN_USERNAME and ADMIN_PASSWORD in Render Environment Variables"
        )
    if len(ADMIN_PASSWORD) < 12:
        raise RuntimeError("ADMIN_PASSWORD must contain at least 12 characters")
    if not re.fullmatch(r"[a-z0-9_.-]{3,32}", ADMIN_USERNAME):
        raise RuntimeError(
            "ADMIN_USERNAME must be 3-32 characters: a-z, 0-9, underscore, dot or hyphen"
        )

    with db_connect() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS auth_users (
                id BIGSERIAL PRIMARY KEY,
                username VARCHAR(32) NOT NULL UNIQUE,
                password_hash TEXT NOT NULL,
                role VARCHAR(16) NOT NULL DEFAULT 'user',
                active BOOLEAN NOT NULL DEFAULT TRUE,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS auth_sessions (
                token_hash CHAR(64) PRIMARY KEY,
                user_id BIGINT NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
                expires_at TIMESTAMPTZ NOT NULL,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """)
        row = conn.execute(
            "SELECT id FROM auth_users WHERE username = %s",
            (ADMIN_USERNAME,),
        ).fetchone()
        if row is None:
            conn.execute(
                """INSERT INTO auth_users (username, password_hash, role)
                   VALUES (%s, %s, 'admin')""",
                (ADMIN_USERNAME, password_hash.hash(ADMIN_PASSWORD)),
            )


@app.on_event("startup")
def startup():
    initialize_database()


@app.get("/health")
def health():
    try:
        with db_connect() as conn:
            conn.execute("SELECT 1")
        return {"ok": True, "service": "alabtal-auth-api", "database": "connected"}
    except Exception:
        raise HTTPException(status_code=503, detail="Database unavailable")


def current_user(request: Request):
    token = request.cookies.get(COOKIE_NAME, "")
    if not token or len(token) > 200:
        return None

    with db_connect() as conn:
        row = conn.execute("""
            SELECT u.id, u.username, u.role
            FROM auth_sessions s
            JOIN auth_users u ON u.id = s.user_id
            WHERE s.token_hash = %s
              AND s.expires_at > NOW()
              AND u.active = TRUE
        """, (token_digest(token),)).fetchone()

    if not row:
        return None
    return {"id": row[0], "username": row[1], "role": row[2]}


@app.post("/api/login")
def login(data: LoginInput, response: Response):
    username = data.username.strip().lower()
    if not re.fullmatch(r"[a-z0-9_.-]{3,32}", username):
        raise HTTPException(status_code=401, detail="اسم المستخدم أو كلمة المرور غير صحيحة")

    with db_connect() as conn:
        user = conn.execute("""
            SELECT id, username, password_hash, role
            FROM auth_users
            WHERE username = %s AND active = TRUE
        """, (username,)).fetchone()

        if not user or not password_hash.verify(data.password, user[2]):
            raise HTTPException(
                status_code=401,
                detail="اسم المستخدم أو كلمة المرور غير صحيحة",
            )

        token = secrets.token_urlsafe(32)
        expires = datetime.now(timezone.utc) + timedelta(seconds=SESSION_TTL)
        conn.execute("""
            INSERT INTO auth_sessions (token_hash, user_id, expires_at)
            VALUES (%s, %s, %s)
        """, (token_digest(token), user[0], expires))

    response.set_cookie(
        key=COOKIE_NAME,
        value=token,
        max_age=SESSION_TTL,
        httponly=True,
        secure=True,
        samesite="strict",
        path="/",
    )
    return {"ok": True, "username": user[1], "role": user[3]}


@app.get("/api/session")
def session(request: Request):
    user = current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="انتهت الجلسة، سجّل الدخول")
    return {"ok": True, "username": user["username"], "role": user["role"]}


@app.post("/api/logout")
def logout(request: Request, response: Response):
    token = request.cookies.get(COOKIE_NAME, "")
    if token:
        with db_connect() as conn:
            conn.execute(
                "DELETE FROM auth_sessions WHERE token_hash = %s",
                (token_digest(token),),
            )
    response.delete_cookie(
        key=COOKIE_NAME, path="/", secure=True, httponly=True, samesite="strict"
    )
    return {"ok": True}


@app.post("/api/admin/users")
def create_user(data: CreateUserInput, request: Request):
    admin = current_user(request)
    if not admin or admin["role"] != "admin":
        raise HTTPException(status_code=403, detail="غير مصرح")

    username = data.username.strip().lower()
    if not re.fullmatch(r"[a-z0-9_.-]{3,32}", username):
        raise HTTPException(status_code=400, detail="صيغة اسم المستخدم غير صحيحة")
    if data.role not in ("user", "admin"):
        raise HTTPException(status_code=400, detail="الدور غير صحيح")

    try:
        with db_connect() as conn:
            conn.execute("""
                INSERT INTO auth_users (username, password_hash, role)
                VALUES (%s, %s, %s)
            """, (username, password_hash.hash(data.password), data.role))
    except psycopg.errors.UniqueViolation:
        raise HTTPException(status_code=409, detail="اسم المستخدم موجود بالفعل")

    return {"ok": True, "username": username, "role": data.role}
