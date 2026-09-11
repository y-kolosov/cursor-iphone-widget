import base64
import importlib.util
import io
import json
import sqlite3
import sys
import tempfile
import unittest
import urllib.error
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location(
    "sync_cursor_token", ROOT / "scripts" / "sync-cursor-token"
)
mod = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(mod)

TOKEN = "user_01ABC::eyJhbGciOiJIUzI1NiJ9.aaa.bbb"
USER_ID = "user_01JTXNECK3AW7H6VEA6JTKW5T5"


def fake_jwt(sub: str) -> str:
    header = base64.urlsafe_b64encode(b'{"alg":"none"}').rstrip(b"=").decode()
    payload = (
        base64.urlsafe_b64encode(json.dumps({"sub": sub}).encode())
        .rstrip(b"=")
        .decode()
    )
    return f"{header}.{payload}.sig"


def make_db(path: Path, rows: list[tuple[str, str]]) -> None:
    conn = sqlite3.connect(path)
    conn.execute("CREATE TABLE ItemTable (key TEXT PRIMARY KEY, value BLOB)")
    conn.executemany("INSERT INTO ItemTable (key, value) VALUES (?, ?)", rows)
    conn.commit()
    conn.close()


class FindTokenTests(unittest.TestCase):
    def test_reads_access_token_key(self):
        with tempfile.TemporaryDirectory() as tmp:
            db = Path(tmp) / "state.vscdb"
            make_db(db, [("cursorAuth/accessToken", TOKEN)])
            self.assertEqual(mod.find_token_in_db(db), TOKEN)

    def test_scans_values_if_key_missing(self):
        with tempfile.TemporaryDirectory() as tmp:
            db = Path(tmp) / "state.vscdb"
            make_db(db, [("other", TOKEN)])
            self.assertEqual(mod.find_token_in_db(db), TOKEN)

    def test_missing_db_returns_none(self):
        self.assertIsNone(mod.find_token_in_db(Path("/no/such/state.vscdb")))


class SessionCookieTests(unittest.TestCase):
    def test_wraps_bare_jwt_using_sub_claim(self):
        jwt = fake_jwt(f"auth0|{USER_ID}")
        self.assertEqual(mod.to_session_cookie(jwt), f"{USER_ID}::{jwt}")

    def test_keeps_already_prefixed_cookie(self):
        self.assertEqual(mod.to_session_cookie(TOKEN), TOKEN)

    def test_wraps_jwt_using_stored_auth_id_when_sub_missing(self):
        jwt = fake_jwt("no-user-here")
        cookie = mod.to_session_cookie(jwt, user_hint=f"auth0|{USER_ID}")
        self.assertEqual(cookie, f"{USER_ID}::{jwt}")


class WriteTokenTests(unittest.TestCase):
    def test_writes_single_line_and_creates_dirs(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "CursorUsage" / "token.txt"
            mod.write_token(path, TOKEN)
            self.assertEqual(path.read_text(encoding="utf-8"), TOKEN + "\n")


class SyncWrapsDesktopJwtTests(unittest.TestCase):
    def test_writes_user_prefixed_cookie_from_bare_jwt(self):
        jwt = fake_jwt(f"auth0|{USER_ID}")
        seen = []
        with tempfile.TemporaryDirectory() as tmp:
            home = Path(tmp)
            db = home / "state.vscdb"
            make_db(db, [("cursorAuth/accessToken", jwt)])
            token_path = home / "token.txt"
            code = mod.sync(
                db_path=db,
                token_path=token_path,
                verify_fn=lambda t: seen.append(t) or "ok",
            )
            self.assertEqual(code, 0)
            expected = f"{USER_ID}::{jwt}"
            self.assertEqual(seen, [expected])
            self.assertEqual(token_path.read_text(encoding="utf-8").strip(), expected)


class SyncNoVerifyTests(unittest.TestCase):
    def test_missing_db_leaves_existing_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            home = Path(tmp)
            token_path = mod.token_path_for_home(home)
            token_path.parent.mkdir(parents=True)
            token_path.write_text("old-token\n", encoding="utf-8")
            db = home / "missing.vscdb"
            buf = io.StringIO()
            with patch.object(sys, "stderr", buf):
                code = mod.sync(
                    db_path=db,
                    token_path=token_path,
                    verify_fn=lambda t: "ok",
                )
            self.assertEqual(code, 1)
            self.assertEqual(token_path.read_text(encoding="utf-8"), "old-token\n")
            self.assertNotIn(TOKEN, buf.getvalue())
            self.assertIn("WorkosCursorSessionToken", buf.getvalue())

    def test_stdout_does_not_contain_token_on_success(self):
        with tempfile.TemporaryDirectory() as tmp:
            home = Path(tmp)
            db = home / "state.vscdb"
            make_db(db, [("cursorAuth/accessToken", TOKEN)])
            token_path = home / "token.txt"
            stdout = io.StringIO()
            with patch.object(sys, "stdout", stdout):
                code = mod.sync(
                    db_path=db,
                    token_path=token_path,
                    verify_fn=lambda t: "ok",
                )
            self.assertEqual(code, 0)
            self.assertEqual(token_path.read_text(encoding="utf-8").strip(), TOKEN)
            self.assertNotIn(TOKEN, stdout.getvalue())


class VerifyBeforeWriteTests(unittest.TestCase):
    def test_unauthorized_does_not_overwrite(self):
        with tempfile.TemporaryDirectory() as tmp:
            home = Path(tmp)
            db = home / "state.vscdb"
            make_db(db, [("cursorAuth/accessToken", TOKEN)])
            token_path = home / "token.txt"
            token_path.write_text("old-token\n", encoding="utf-8")
            code = mod.sync(
                db_path=db,
                token_path=token_path,
                verify_fn=lambda t: "unauthorized",
            )
            self.assertEqual(code, 1)
            self.assertEqual(token_path.read_text(encoding="utf-8"), "old-token\n")

    def test_network_leaves_existing(self):
        with tempfile.TemporaryDirectory() as tmp:
            home = Path(tmp)
            db = home / "state.vscdb"
            make_db(db, [("cursorAuth/accessToken", TOKEN)])
            token_path = home / "token.txt"
            token_path.write_text("old-token\n", encoding="utf-8")
            code = mod.sync(
                db_path=db,
                token_path=token_path,
                verify_fn=lambda t: "network",
            )
            self.assertEqual(code, 1)
            self.assertEqual(token_path.read_text(encoding="utf-8"), "old-token\n")

    def test_network_writes_when_no_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            home = Path(tmp)
            db = home / "state.vscdb"
            make_db(db, [("cursorAuth/accessToken", TOKEN)])
            token_path = home / "token.txt"
            code = mod.sync(
                db_path=db,
                token_path=token_path,
                verify_fn=lambda t: "network",
            )
            self.assertEqual(code, 0)
            self.assertEqual(token_path.read_text(encoding="utf-8").strip(), TOKEN)

    def test_verify_token_maps_401(self):
        def fake_urlopen(request, timeout=10):
            raise urllib.error.HTTPError(
                url="https://cursor.com/api/usage-summary",
                code=401,
                msg="Unauthorized",
                hdrs=None,
                fp=None,
            )

        self.assertEqual(mod.verify_token("x", urlopen=fake_urlopen), "unauthorized")


if __name__ == "__main__":
    unittest.main()
