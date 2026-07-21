import importlib.util
import json
import tempfile
import time
import unittest
from pathlib import Path


MODULE_PATH = Path(__file__).resolve().parents[1] / "lib" / "webterm-manager.py"
SPEC = importlib.util.spec_from_file_location("webterm_manager", MODULE_PATH)
manager = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(manager)


class TerminalLockTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.state_dir = Path(self.temp_dir.name)
        manager.STATE_DIR = self.state_dir
        manager.LOCK_FILE = self.state_dir / ".lock"
        manager.TMUX_SOCKET = self.state_dir / "tmux.sock"
        manager.LOCK_TTL_SECONDS = 120
        self.session_id = "s-0123456789abcdef"
        self.token = "1" * 32

    def tearDown(self):
        self.temp_dir.cleanup()

    def uri(self, path: str, page_id: str = "") -> str:
        suffix = f"&page_id={page_id}" if page_id else ""
        return f"{path}?arg={self.session_id}&lock_token={self.token}{suffix}"

    def test_websocket_claim_is_exclusive_per_page(self):
        manager.write_lock(self.session_id, self.token, "test browser")

        allowed, _ = manager.terminal_access_allowed(self.uri("/terminal/"))
        self.assertTrue(allowed)

        first_page = "a" * 32
        second_page = "b" * 32
        allowed, _ = manager.terminal_access_allowed(self.uri("/terminal/ws", first_page))
        self.assertTrue(allowed)
        self.assertEqual(manager.read_lock(self.session_id)["page_id"], first_page)

        allowed, _ = manager.terminal_access_allowed(self.uri("/terminal/ws", second_page))
        self.assertFalse(allowed)
        allowed, _ = manager.terminal_access_allowed(self.uri("/terminal/ws", first_page))
        self.assertTrue(allowed)

    def test_missing_or_wrong_token_is_rejected(self):
        manager.write_lock(self.session_id, self.token, "test browser")
        self.assertFalse(manager.terminal_access_allowed("/terminal/")[0])
        wrong = f"/terminal/?arg={self.session_id}&lock_token={'2' * 32}"
        self.assertFalse(manager.terminal_access_allowed(wrong)[0])

    def test_page_claim_is_preserved_by_heartbeat(self):
        first_page = "a" * 32
        manager.write_lock(self.session_id, self.token, "test browser", first_page)
        current = manager.read_lock(self.session_id)
        renewed = manager.write_lock(
            self.session_id,
            self.token,
            current["owner"],
            current["page_id"],
            current["locked_at"],
        )
        self.assertEqual(renewed["page_id"], first_page)
        self.assertEqual(renewed["locked_at"], current["locked_at"])

    def test_expired_lock_is_rejected_and_removed(self):
        manager.write_lock(self.session_id, self.token, "test browser")
        lock = manager.read_lock(self.session_id)
        lock["expires_at"] = int(time.time()) - 1
        manager.lock_path(self.session_id).write_text(json.dumps(lock), encoding="utf-8")

        self.assertFalse(manager.terminal_access_allowed(self.uri("/terminal/"))[0])
        self.assertFalse(manager.lock_path(self.session_id).exists())


if __name__ == "__main__":
    unittest.main()
