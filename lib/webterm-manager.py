#!/usr/bin/env python3
import json
import fcntl
import os
import re
import secrets
import subprocess
import threading
import time
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

HOST = "127.0.0.1"
PORT = 7684
HOME = Path("/home/webterm")
STATE_DIR = HOME / ".local" / "share" / "webterm-sessions"
TMUX_SOCKET = STATE_DIR / "tmux.sock"
LOCK_FILE = STATE_DIR / ".lock"
ID_RE = re.compile(r"^s-[a-f0-9]{16}$")
IDLE_TTL = int(os.environ.get("WEBTERM_IDLE_TTL_SECONDS", "604800"))
CLEANUP_INTERVAL = int(os.environ.get("WEBTERM_CLEANUP_INTERVAL_SECONDS", "600"))
LOCK = threading.RLock()

FORCE_UNLOCK_SECRET = os.environ.get("WEBTERM_FORCE_UNLOCK_SECRET", "")
LOCK_TTL_SECONDS = int(os.environ.get("WEBTERM_LOCK_TTL_SECONDS", "120"))


def lock_path(session_id: str) -> Path:
    return STATE_DIR / f"{session_id}.lock.json"


def read_lock(session_id: str) -> dict | None:
    path = lock_path(session_id)
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(data, dict):
            return None
        return data
    except (OSError, ValueError, TypeError):
        return None


def write_lock(
    session_id: str,
    token: str,
    owner: str = "",
    page_id: str = "",
    locked_at: int | None = None,
) -> dict:
    now = int(time.time())
    data = {
        "session_id": session_id,
        "token": token,
        "owner": (owner or "")[:120],
        "page_id": page_id,
        "locked_at": locked_at or now,
        "heartbeat_at": now,
        "expires_at": now + LOCK_TTL_SECONDS,
    }
    target = lock_path(session_id)
    temp = target.with_suffix(".lock.json.tmp")
    temp.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    os.replace(temp, target)
    return data


def clear_lock(session_id: str) -> None:
    lock_path(session_id).unlink(missing_ok=True)


def lock_active(lock: dict | None) -> bool:
    if not lock:
        return False
    try:
        expires = int(lock.get("expires_at", 0))
    except (TypeError, ValueError):
        return False
    if expires <= int(time.time()):
        return False
    return bool(lock.get("token"))


def public_lock_info(lock: dict | None) -> dict:
    active = lock_active(lock)
    if not active:
        return {"locked": False}
    return {
        "locked": True,
        "owner": str(lock.get("owner") or ""),
        "locked_at": int(lock.get("locked_at", 0)),
        "heartbeat_at": int(lock.get("heartbeat_at", 0)),
        "expires_at": int(lock.get("expires_at", 0)),
        "ttl": LOCK_TTL_SECONDS,
    }


def purge_expired_lock(session_id: str) -> None:
    lock = read_lock(session_id)
    if lock and not lock_active(lock):
        clear_lock(session_id)


def terminal_access_allowed(original_uri: str) -> tuple[bool, str]:
    """Validate the lock token carried by a terminal page or websocket URL."""
    query = parse_qs(urlparse(original_uri).query, keep_blank_values=True)
    session_id = next(
        (
            value
            for key in ("arg", "arg[]")
            for value in query.get(key, [])
            if valid_id(value)
        ),
        "",
    )
    token = next((value for value in query.get("lock_token", []) if value), "")
    page_id = next(
        (value for value in query.get("page_id", []) if re.fullmatch(r"[a-f0-9]{32}", value)),
        "",
    )
    if not session_id or not token:
        return False, session_id

    purge_expired_lock(session_id)
    current = read_lock(session_id)
    current_token = str(current.get("token") or "") if lock_active(current) else ""
    if not current_token or not secrets.compare_digest(current_token, token):
        return False, session_id

    # The HTML navigation validates the reservation. The websocket is the
    # authoritative per-page claim, preventing a copied URL opening twice.
    if urlparse(original_uri).path == "/terminal/ws":
        if not page_id:
            return False, session_id
        claimed_page = str(current.get("page_id") or "")
        if claimed_page and not secrets.compare_digest(claimed_page, page_id):
            return False, session_id
        if not claimed_page:
            write_lock(
                session_id,
                current_token,
                str(current.get("owner") or ""),
                page_id,
                int(current.get("locked_at") or time.time()),
            )
    return True, session_id



def run_tmux(*args: str, check: bool = False) -> subprocess.CompletedProcess:
    return subprocess.run(
        ["/usr/bin/tmux", "-S", str(TMUX_SOCKET), *args],
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        check=check,
    )


@contextmanager
def state_lock():
    with LOCK:
        with LOCK_FILE.open("a+", encoding="utf-8") as lock_handle:
            fcntl.flock(lock_handle, fcntl.LOCK_EX)
            try:
                yield
            finally:
                fcntl.flock(lock_handle, fcntl.LOCK_UN)


def valid_id(session_id: str) -> bool:
    return bool(ID_RE.fullmatch(session_id))


def meta_path(session_id: str) -> Path:
    return STATE_DIR / f"{session_id}.json"


def activity_path(session_id: str) -> Path:
    return STATE_DIR / f"{session_id}.last"


def has_session(session_id: str) -> bool:
    return run_tmux("has-session", "-t", session_id).returncode == 0


def attached_clients(session_id: str) -> int:
    result = run_tmux("list-clients", "-t", session_id, "-F", "#{client_pid}")
    if result.returncode != 0:
        return 0
    return len([line for line in result.stdout.splitlines() if line.strip()])


def kill_tmux(session_id: str) -> None:
    if has_session(session_id):
        run_tmux("kill-session", "-t", session_id)


def detach_tmux_clients(session_id: str) -> None:
    if has_session(session_id):
        run_tmux("detach-client", "-s", session_id)


def write_meta(session_id: str, name: str, created: int | None = None) -> dict:
    created = created or int(time.time())
    data = {"id": session_id, "name": name[:80], "created": created}
    target = meta_path(session_id)
    temp = target.with_suffix(".json.tmp")
    temp.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    os.replace(temp, target)
    activity_path(session_id).touch()
    return data


def read_meta(path: Path) -> dict | None:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        if not valid_id(str(data.get("id", ""))):
            return None
        return data
    except (OSError, ValueError, TypeError):
        return None


def session_record(data: dict) -> dict:
    session_id = data["id"]
    marker = activity_path(session_id)
    try:
        last_active = int(marker.stat().st_mtime)
    except FileNotFoundError:
        last_active = int(data.get("created", time.time()))
    running = has_session(session_id)
    purge_expired_lock(session_id)
    lock = read_lock(session_id)
    lock_info = public_lock_info(lock)
    return {
        "id": session_id,
        "name": str(data.get("name") or "未命名终端")[:80],
        "created": int(data.get("created", last_active)),
        "last_active": last_active,
        "running": running,
        "clients": attached_clients(session_id) if running else 0,
        "expires_after": IDLE_TTL,
        "locked": lock_info.get("locked", False),
        "lock": lock_info,
    }


def list_sessions() -> list[dict]:
    records = []
    for path in STATE_DIR.glob("s-*.json"):
        data = read_meta(path)
        if data:
            records.append(session_record(data))
    records.sort(key=lambda item: item["last_active"], reverse=True)
    return records


def cleanup_stale() -> int:
    cutoff = time.time() - IDLE_TTL
    removed = 0
    with state_lock():
        for path in list(STATE_DIR.glob("s-*.json")):
            data = read_meta(path)
            if not data:
                continue
            session_id = data["id"]
            marker = activity_path(session_id)
            try:
                last_active = marker.stat().st_mtime
            except FileNotFoundError:
                last_active = path.stat().st_mtime
            if last_active >= cutoff:
                continue
            kill_tmux(session_id)
            path.unlink(missing_ok=True)
            marker.unlink(missing_ok=True)
            lock_path(session_id).unlink(missing_ok=True)
            removed += 1
    return removed


def cleanup_worker() -> None:
    while True:
        try:
            cleanup_stale()
        except Exception as exc:
            print(f"cleanup error: {exc}", flush=True)
        time.sleep(CLEANUP_INTERVAL)


class Handler(BaseHTTPRequestHandler):
    server_version = "WebTermManager/1.0"

    def log_message(self, fmt: str, *args) -> None:
        print(f"{self.address_string()} - {fmt % args}", flush=True)

    def send_json(self, status: int, payload: dict | list) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(body)

    def read_json(self) -> dict:
        if self.headers.get("X-Webterm-Request") != "1":
            raise ValueError("missing request header")
        content_type = self.headers.get("Content-Type", "")
        if not content_type.startswith("application/json"):
            raise ValueError("content type must be application/json")
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError as exc:
            raise ValueError("invalid content length") from exc
        if length < 0 or length > 4096:
            raise ValueError("request body too large")
        if length == 0:
            return {}
        value = json.loads(self.rfile.read(length).decode("utf-8"))
        if not isinstance(value, dict):
            raise ValueError("json object required")
        return value

    def do_GET(self) -> None:
        path = urlparse(self.path).path.rstrip("/")
        if path == "/internal/terminal-access":
            original_uri = self.headers.get("X-Webterm-Original-URI", "")
            with state_lock():
                allowed, session_id = terminal_access_allowed(original_uri)
                if not allowed:
                    self.send_json(403, {"error": "terminal locked or invalid token"})
                    return
                self.send_json(200, {"ok": True, "id": session_id})
            return
        if path == "/api/sessions":
            with state_lock():
                self.send_json(200, {"sessions": list_sessions(), "idle_ttl": IDLE_TTL})
            return
        lock_match = re.fullmatch(r"/api/sessions/(s-[a-f0-9]{16})/lock", path)
        if lock_match:
            session_id = lock_match.group(1)
            with state_lock():
                data = read_meta(meta_path(session_id))
                if not data and not lock_path(session_id).exists():
                    self.send_json(404, {"error": "session not found"})
                    return
                purge_expired_lock(session_id)
                self.send_json(200, {"id": session_id, **public_lock_info(read_lock(session_id))})
            return
        if path == "/api/health":
            self.send_json(200, {"ok": True})
            return
        self.send_json(404, {"error": "not found"})

    def do_POST(self) -> None:
        path = urlparse(self.path).path.rstrip("/")
        try:
            payload = self.read_json()
        except (ValueError, json.JSONDecodeError) as exc:
            self.send_json(400, {"error": str(exc)})
            return

        if path == "/api/sessions":
            with state_lock():
                session_id = f"s-{secrets.token_hex(8)}"
                requested_name = str(payload.get("name") or "").strip()
                if not requested_name:
                    requested_name = f"终端 {time.strftime('%m-%d %H:%M')}"
                data = write_meta(session_id, requested_name)
                self.send_json(201, session_record(data))
            return

        lock_action = re.fullmatch(r"/api/sessions/(s-[a-f0-9]{16})/(acquire|heartbeat|release|force-unlock)", path)
        if lock_action:
            session_id, action = lock_action.groups()
            with state_lock():
                data = read_meta(meta_path(session_id))
                if not data:
                    self.send_json(404, {"error": "session not found"})
                    return
                purge_expired_lock(session_id)
                current = read_lock(session_id)

                if action == "acquire":
                    owner = str(payload.get("owner") or "").strip()[:120]
                    if lock_active(current):
                        self.send_json(409, {
                            "error": "session locked",
                            "id": session_id,
                            **public_lock_info(current),
                        })
                        return
                    token = secrets.token_hex(16)
                    lock = write_lock(session_id, token, owner)
                    self.send_json(200, {
                        "ok": True,
                        "id": session_id,
                        "token": token,
                        **public_lock_info(lock),
                    })
                    return

                if action == "heartbeat":
                    token = str(payload.get("token") or "")
                    page_id = str(payload.get("page_id") or "")
                    if not lock_active(current) or current.get("token") != token:
                        self.send_json(409, {
                            "error": "lock not held",
                            "id": session_id,
                            **public_lock_info(current),
                        })
                        return
                    claimed_page = str(current.get("page_id") or "")
                    if (
                        not re.fullmatch(r"[a-f0-9]{32}", page_id)
                        or (claimed_page and not secrets.compare_digest(claimed_page, page_id))
                    ):
                        self.send_json(409, {"error": "lock held by another page", "id": session_id})
                        return
                    lock = write_lock(
                        session_id,
                        token,
                        str(current.get("owner") or ""),
                        page_id,
                        int(current.get("locked_at") or time.time()),
                    )
                    self.send_json(200, {"ok": True, "id": session_id, **public_lock_info(lock)})
                    return

                if action == "release":
                    token = str(payload.get("token") or "")
                    page_id = str(payload.get("page_id") or "")
                    claimed_page = str(current.get("page_id") or "") if current else ""
                    page_matches = bool(
                        re.fullmatch(r"[a-f0-9]{32}", page_id)
                        and (
                            not claimed_page
                            or secrets.compare_digest(claimed_page, page_id)
                        )
                    )
                    if current and current.get("token") == token and page_matches:
                        clear_lock(session_id)
                        self.send_json(200, {"ok": True, "id": session_id, "locked": False})
                        return
                    if not lock_active(current):
                        clear_lock(session_id)
                        self.send_json(200, {"ok": True, "id": session_id, "locked": False})
                        return
                    self.send_json(403, {"error": "token mismatch", "id": session_id, **public_lock_info(current)})
                    return

                if action == "force-unlock":
                    secret = str(payload.get("secret") or "")
                    if not FORCE_UNLOCK_SECRET:
                        self.send_json(503, {"error": "force unlock is not configured"})
                        return
                    if not secrets.compare_digest(secret, FORCE_UNLOCK_SECRET):
                        self.send_json(403, {"error": "invalid force unlock secret"})
                        return
                    # End the previous ttyd attachment as well as invalidating its token.
                    detach_tmux_clients(session_id)
                    clear_lock(session_id)
                    self.send_json(200, {"ok": True, "id": session_id, "locked": False, "forced": True})
                    return

        match = re.fullmatch(r"/api/sessions/(s-[a-f0-9]{16})/(reset|rename)", path)
        if not match:
            self.send_json(404, {"error": "not found"})
            return
        session_id, action = match.groups()
        with state_lock():
            path_obj = meta_path(session_id)
            data = read_meta(path_obj)
            if not data:
                self.send_json(404, {"error": "session not found"})
                return
            if action == "reset":
                purge_expired_lock(session_id)
                current = read_lock(session_id)
                if lock_active(current):
                    self.send_json(409, {
                        "error": "session locked",
                        "id": session_id,
                        **public_lock_info(current),
                    })
                    return
                kill_tmux(session_id)
                activity_path(session_id).touch()
                clear_lock(session_id)
            elif action == "rename":
                name = str(payload.get("name") or "").strip()[:80]
                if not name:
                    self.send_json(400, {"error": "name required"})
                    return
                data = write_meta(session_id, name, int(data.get("created", time.time())))
            self.send_json(200, session_record(data))

    def do_DELETE(self) -> None:
        path = urlparse(self.path).path.rstrip("/")
        if self.headers.get("X-Webterm-Request") != "1":
            self.send_json(400, {"error": "missing request header"})
            return
        match = re.fullmatch(r"/api/sessions/(s-[a-f0-9]{16})", path)
        if not match:
            self.send_json(404, {"error": "not found"})
            return
        session_id = match.group(1)
        with state_lock():
            kill_tmux(session_id)
            meta_path(session_id).unlink(missing_ok=True)
            activity_path(session_id).unlink(missing_ok=True)
            clear_lock(session_id)
        self.send_json(200, {"deleted": True, "id": session_id})


def main() -> None:
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    cleanup_stale()
    threading.Thread(target=cleanup_worker, daemon=True).start()
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"webterm manager listening on http://{HOST}:{PORT}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
