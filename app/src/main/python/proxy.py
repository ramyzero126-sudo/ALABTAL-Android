#!/usr/bin/env python3
# ALABTAL Desktop Live Proxy
# Uses the normal Desktop login; does not bypass authentication.

import json
import os
import secrets
import threading
import time
import http.cookiejar
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse, parse_qs
from urllib.request import Request, build_opener, HTTPCookieProcessor

BASE_DIR = Path(__file__).resolve().parent
DESKTOP_URL = "https://desktop-f8arjo9.tail547e30.ts.net"
HOST = "127.0.0.1"
PORT = int(os.environ.get("PORT", "8765"))
SESSION_TTL = 8 * 60 * 60

sessions = {}
sessions_lock = threading.Lock()


def desktop_request(path, method="GET", payload=None, token=None):
    """Send a request to Desktop using the official login/session API."""
    url = DESKTOP_URL + path
    headers = {
        "Accept": "application/json",
        "Content-Type": "application/json",
        "User-Agent": "ALABTAL-Live-Proxy/1.0",
    }
    if token:
        headers["Authorization"] = "Bearer " + token

    body = None
    if payload is not None:
        body = json.dumps(payload).encode("utf-8")

    req = Request(url, data=body, headers=headers, method=method)

    try:
        with build_opener().open(req, timeout=25) as response:
            raw = response.read(5 * 1024 * 1024)
            return response.status, json.loads(raw.decode("utf-8"))
    except HTTPError as exc:
        try:
            raw = exc.read(1024 * 1024).decode("utf-8", "replace")
            data = json.loads(raw) if raw else {}
        except Exception:
            data = {}
        return exc.code, data
    except (URLError, TimeoutError, OSError, ValueError) as exc:
        return 502, {"ok": False, "error": "تعذر الاتصال بـ Desktop", "detail": str(exc)}


def desktop_request_raw(path, method="GET", body=None, content_type=None,
                        token=None, accept=None):
    """Forward raw requests only to the configured Desktop API host."""
    from urllib.parse import unquote
    parsed = urlparse(path)
    decoded = unquote(parsed.path or "")
    if (parsed.scheme or parsed.netloc or not decoded.startswith("/api/")
            or ".." in decoded.split("/")
            or any(ord(c) < 32 for c in path)):
        return 400, b'{"ok":false,"error":"Invalid API path"}', "application/json; charset=utf-8", {}

    headers = {
        "User-Agent": "ALABTAL-Desktop-Proxy/1.1",
        "Accept": accept or "*/*",
    }
    if token:
        headers["Authorization"] = "Bearer " + token
    if content_type:
        headers["Content-Type"] = content_type

    data = body if method in ("POST", "PUT", "PATCH", "DELETE") else None
    req = Request(DESKTOP_URL + path, data=data, headers=headers, method=method)

    try:
        with build_opener().open(req, timeout=45) as response:
            raw = response.read(25 * 1024 * 1024 + 1)
            if len(raw) > 25 * 1024 * 1024:
                return 502, b'{"ok":false,"error":"Upstream response too large"}', "application/json; charset=utf-8", {}
            extra = {k: v for k, v in response.headers.items()
                     if k.lower() in ("content-disposition", "last-modified", "etag")}
            return response.status, raw, response.headers.get("Content-Type", "application/octet-stream"), extra
    except HTTPError as exc:
        try:
            raw = exc.read(25 * 1024 * 1024 + 1)
        except Exception:
            raw = b""
        if len(raw) > 25 * 1024 * 1024:
            raw = b'{"ok":false,"error":"Upstream response too large"}'
            ctype = "application/json; charset=utf-8"
        else:
            ctype = exc.headers.get("Content-Type", "application/json; charset=utf-8") if exc.headers else "application/json; charset=utf-8"
        extra = {k: v for k, v in (exc.headers.items() if exc.headers else [])
                 if k.lower() in ("content-disposition", "last-modified", "etag")}
        return exc.code, raw, ctype, extra
    except (URLError, TimeoutError, OSError, ValueError) as exc:
        raw = json.dumps({"ok": False, "error": "تعذر الاتصال بـ Desktop",
                          "detail": str(exc)}, ensure_ascii=False).encode("utf-8")
        return 502, raw, "application/json; charset=utf-8", {}


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(BASE_DIR), **kwargs)

    def log_message(self, fmt, *args):
        print("[ALABTAL]", fmt % args)

    def send_json(self, status, data, extra_headers=None):
        raw = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        if extra_headers:
            for key, value in extra_headers.items():
                self.send_header(key, value)
        self.end_headers()
        self.wfile.write(raw)

    def get_session(self):
        cookie = self.headers.get("Cookie", "")
        token = ""
        for part in cookie.split(";"):
            key, sep, value = part.strip().partition("=")
            if sep and key == "alabtal_session":
                token = value
                break
        if not token:
            return None
        with sessions_lock:
            session = sessions.get(token)
            if not session:
                return None
            if session["expires"] < time.time():
                sessions.pop(token, None)
                return None
            return session

    def proxy_api_request(self, method):
        parsed = urlparse(self.path)
        path = parsed.path or "/"
        if not path.startswith("/api/"):
            self.send_json(404, {"ok": False, "error": "المسار غير موجود"})
            return
        if path in ("/api/login", "/api/logout", "/api/health", "/api/session"):
            self.send_json(405, {"ok": False, "error": "طريقة الطلب غير مسموحة"})
            return

        from urllib.parse import unquote
        decoded = unquote(path)
        if ".." in decoded.split("/") or any(ord(c) < 32 for c in self.path):
            self.send_json(400, {"ok": False, "error": "مسار API غير صالح"})
            return

        session = self.get_session()
        if not session:
            self.send_json(401, {"ok": False, "error": "انتهت الجلسة؛ سجّل الدخول مرة أخرى"})
            return

        body = None
        if method in ("POST", "PUT", "PATCH", "DELETE"):
            try:
                length = int(self.headers.get("Content-Length", "0"))
            except ValueError:
                self.send_json(400, {"ok": False, "error": "حجم الطلب غير صالح"})
                return
            if length < 0 or length > 20 * 1024 * 1024:
                self.send_json(413, {"ok": False, "error": "حجم الطلب يتجاوز 20 MB"})
                return
            body = self.rfile.read(length) if length else None
            if length and len(body) != length:
                self.send_json(400, {"ok": False, "error": "الطلب غير مكتمل"})
                return

        upstream_path = path + (("?" + parsed.query) if parsed.query else "")
        status, raw, ctype, extra = desktop_request_raw(
            upstream_path, method=method, body=body,
            content_type=self.headers.get("Content-Type"),
            token=session["desktop_token"],
            accept=self.headers.get("Accept", "*/*"),
        )
        self.send_response(status)
        self.send_header("Content-Type", ctype or "application/octet-stream")
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        for key, value in extra.items():
            if key.lower() in ("content-disposition", "last-modified", "etag"):
                self.send_header(key, value)
        self.end_headers()
        if method != "HEAD" and status not in (204, 304) and raw:
            self.wfile.write(raw)

    def do_PUT(self):
        self.proxy_api_request("PUT")

    def do_PATCH(self):
        self.proxy_api_request("PATCH")

    def do_DELETE(self):
        self.proxy_api_request("DELETE")

    def do_HEAD(self):
        self.proxy_api_request("HEAD")

    def do_POST(self):
        path = urlparse(self.path).path

        if path == "/api/logout":
            cookie = self.headers.get("Cookie", "")
            for part in cookie.split(";"):
                key, sep, value = part.strip().partition("=")
                if sep and key == "alabtal_session":
                    with sessions_lock:
                        sessions.pop(value, None)
            self.send_json(
                200,
                {"ok": True},
                {"Set-Cookie": "alabtal_session=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict"},
            )
            return

        if path != "/api/login":
            self.proxy_api_request("POST")
            return

        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length < 1 or length > 20000:
                raise ValueError("حجم الطلب غير صحيح")
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
            username = str(payload.get("username", "")).strip()
            password = str(payload.get("password", ""))
            if not username or not password:
                raise ValueError("أدخل اسم المستخدم وكلمة المرور")
        except Exception:
            self.send_json(400, {"ok": False, "error": "بيانات تسجيل الدخول غير مكتملة"})
            return

        # Authenticate against Desktop itself. Credentials are not saved to disk.
        status, result = desktop_request(
            "/api/login",
            method="POST",
            payload={"username": username, "password": password},
        )

        remote_token = result.get("token") if isinstance(result, dict) else None
        # Safe diagnostics: print only status and response field names, never values.
        print("[LOGIN DIAGNOSTIC] upstream_status =", status)
        print("[LOGIN DIAGNOSTIC] response_type =", type(result).__name__)
        if isinstance(result, dict):
            print("[LOGIN DIAGNOSTIC] response_keys =", sorted(result.keys()))
            print("[LOGIN DIAGNOSTIC] ok_flag =", bool(result.get("ok")))
            print("[LOGIN DIAGNOSTIC] has_token =", bool(remote_token))
        if status != 200 or not isinstance(result, dict) or not result.get("ok") or not remote_token:
            message = "فشل تسجيل الدخول إلى Desktop"
            if isinstance(result, dict) and result.get("error"):
                message = str(result["error"])
            self.send_json(
                status if status in (400, 401, 403) else 502,
                {"ok": False, "error": message},
            )
            return

        local_token = secrets.token_urlsafe(32)
        session = {
            "username": username,
            "role": result.get("role", "user"),
            "desktop_token": remote_token,
            "expires": time.time() + SESSION_TTL,
        }
        with sessions_lock:
            sessions[local_token] = session

        self.send_json(
            200,
            {"ok": True, "username": username, "role": session["role"]},
            {
                "Set-Cookie": (
                    f"alabtal_session={local_token}; Path=/; Max-Age={SESSION_TTL}; "
                    "HttpOnly; SameSite=Strict"
                )
            },
        )

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path
        query = parse_qs(parsed.query)

        if path == "/api/health":
            self.send_json(200, {
                "ok": True,
                "service": "ALABTAL Desktop Live Proxy",
                "desktop": DESKTOP_URL,
            })
            return

        if path == "/api/session":
            session = self.get_session()
            if not session:
                self.send_json(401, {"ok": False})
            else:
                self.send_json(200, {
                    "ok": True,
                    "username": session["username"],
                    "role": session["role"],
                })
            return

        if path.startswith("/api/"):
            session = self.get_session()
            if not session:
                self.send_json(401, {"ok": False, "error": "سجّل الدخول أولاً"})
                return

            if path == "/api/cities":
                status, data = desktop_request(
                    "/api/cities",
                    token=session["desktop_token"],
                )
                if isinstance(data, dict):
                    print("[CITIES DIAGNOSTIC] upstream_status =", status)
                    print("[CITIES DIAGNOSTIC] response_keys =", sorted(data.keys()))
                    cities = data.get("cities")
                    print("[CITIES DIAGNOSTIC] city_count =", len(cities) if isinstance(cities, (dict, list)) else "unknown")
                self.send_json(status, data)
                return

            if path == "/api/notbooked":
                city = (query.get("city") or [""])[0].strip()
                day = (query.get("day") or [""])[0].strip()
                if not city or len(city) > 150 or len(day) != 10:
                    self.send_json(400, {"ok": False, "error": "المدينة أو التاريخ غير صحيح"})
                    return
                from urllib.parse import urlencode
                upstream_path = "/api/notbooked?" + urlencode({"city": city, "day": day})
                status, data = desktop_request(
                    upstream_path,
                    token=session["desktop_token"],
                )
                if isinstance(data, dict):
                    print("[BOOKINGS] status =", status)
                    print("[BOOKINGS] keys =", sorted(data.keys()))
                    for key in ("booked", "notBooked"):
                        rows = data.get(key)
                        print("[BOOKINGS]", key, "=", len(rows) if isinstance(rows, list) else type(rows).__name__)
                self.send_json(status, data)
                return

            if path == "/api/live-ops":
                city = (query.get("city") or [""])[0].strip()
                if not city or len(city) > 150 or any(ord(c) < 32 for c in city):
                    self.send_json(400, {"ok": False, "error": "مفتاح المدينة غير صحيح"})
                    return
                from urllib.parse import urlencode
                upstream_path = "/api/live-ops?" + urlencode({"city": city})
                status, data = desktop_request(
                    upstream_path,
                    token=session["desktop_token"],
                )
                # Safe diagnostics: field names and types only.
                print("[LIVE DIAGNOSTIC] upstream_status =", status)
                print("[LIVE DIAGNOSTIC] response_type =", type(data).__name__)
                if isinstance(data, dict):
                    print("[LIVE DIAGNOSTIC] response_keys =", sorted(data.keys()))
                    stats = data.get("stats")
                    if isinstance(stats, dict):
                        print("[STATS VALUES]", {k: v for k, v in stats.items() if isinstance(v, (int, float, bool)) or v is None})

                    lines = ["STATS"]
                    stats = data.get("stats")
                    if isinstance(stats, dict):
                        lines.extend(
                            f"{k}: {type(v).__name__}"
                            for k, v in sorted(stats.items())
                        )
                    lines.append("CARD FIELDS")
                    cards = data.get("cards")
                    if isinstance(cards, list) and cards and isinstance(cards[0], dict):
                        lines.extend(
                            f"{k}: {type(v).__name__}"
                            for k, v in sorted(cards[0].items())
                        )
                    lines.append("ACTIVE ORDERS")
                    found = 0
                    if isinstance(cards, list):
                        for i, rider in enumerate(cards):
                            if not isinstance(rider, dict):
                                continue
                            active = rider.get("activeOrders")
                            if isinstance(active, dict):
                                orders = [active]
                            elif isinstance(active, list):
                                orders = [o for o in active if isinstance(o, dict)]
                            else:
                                orders = []
                            for j, order in enumerate(orders):
                                found += 1
                                lines.append(f"ORDER {found} rider_index={i} order_index={j}")
                                for k, v in sorted(order.items()):
                                    lines.append(f"{k}: {type(v).__name__}")
                                    if isinstance(v, dict):
                                        lines.extend(f"  {k}.{sk}: {type(sv).__name__}" for sk, sv in sorted(v.items()))
                                if found >= 5:
                                    break
                            if found >= 5:
                                break
                    lines.append("orders_found: " + str(found))
                    if found == 0:
                        lines.append("No active order objects in returned cards")
                    Path("live_structure.txt").write_text(
                        "\n".join(lines), encoding="utf-8"
                    )
                    print("[LIVE DIAGNOSTIC] cards_count =", len(cards) if isinstance(cards, list) else "not-a-list")
                    print("[LIVE DIAGNOSTIC] ok_flag =", data.get("ok"))
                else:
                    print("[LIVE DIAGNOSTIC] response is not a JSON object")
                self.send_json(status, data)
                return

            self.proxy_api_request("GET")
            return

        # Serve index.html, app.js, styles.css and other local project files.
        if path == "/":
            self.path = "/index.html"
        super().do_GET()


def main():
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print("=" * 44)
    print("ALABTAL DESKTOP LIVE PROXY")
    print("Local URL: http://127.0.0.1:" + str(PORT))
    print("Desktop: " + DESKTOP_URL)
    print("Live API: /api/live-ops?city=214")
    print("Stop with Ctrl+C")
    print("=" * 44)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping proxy...")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
