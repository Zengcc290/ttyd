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
from urllib.parse import urlparse

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
    return {
        "id": session_id,
        "name": str(data.get("name") or "未命名终端")[:80],
        "created": int(data.get("created", last_active)),
        "last_active": last_active,
        "running": running,
        "clients": attached_clients(session_id) if running else 0,
        "expires_after": IDLE_TTL,
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
        if path == "/api/sessions":
            with state_lock():
                self.send_json(200, {"sessions": list_sessions(), "idle_ttl": IDLE_TTL})
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
                kill_tmux(session_id)
                activity_path(session_id).touch()
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
