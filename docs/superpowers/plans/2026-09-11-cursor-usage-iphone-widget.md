# Cursor Usage iPhone Widget Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a personal Scriptable Home Screen widget that shows Cursor Models %, Other Models %, billing reset date, and on-demand spend when it exists.

**Architecture:** A Node-tested parser maps `GET https://cursor.com/api/usage-summary` into a small model. A macOS Python helper pulls a session token from Cursor’s `state.vscdb`, verifies it against that endpoint, and writes `iCloud Drive/Scriptable/CursorUsage/token.txt`. The Scriptable script reads the token, fetches live usage, caches the last good model locally, and draws stacked bars for small and medium.

**Tech Stack:** Node.js built-in `node:test` (parser), Python 3.10+ stdlib (helper), Scriptable JavaScript (widget). No npm/pip packages.

## Global Constraints

- Scriptable small + medium only; no WidgetKit, Lock Screen, App Store, or custom server.
- Do not show plan used/limit/remaining (`$12 of $20`).
- Labels in English, matching Spending: `Cursor Models`, `Other Models`.
- Token file: `iCloud Drive/Scriptable/CursorUsage/token.txt` (macOS: `~/Library/Mobile Documents/iCloud~dk~simonbs~Scriptable/Documents/CursorUsage/token.txt`).
- Never log, print, or commit the token.
- If helper cannot extract or verify a new token, do not overwrite an existing `token.txt`.
- On-demand string only when `enabled === true` and `used > 0`; never `$0.00`. On-demand on medium only.
- Percents are rounded integers; bar fill clips at 100%; printed percent may exceed 100.
- Colors: `< 80` system green, `80–99` orange, `≥ 100` red.
- `refreshAfterDate` ≈ now + 5 minutes; tap runs the script; Shortcut is documented, not a binary.
- Parser errors never invent zeros: return `{ ok: false, error: "parse" }`.
- Keep `parseUsageSummary` in `lib/parse-usage.js` and `scriptable/CursorUsage.js` in sync by copy (no bundler).
- Endpoint: `GET https://cursor.com/api/usage-summary` with `Cookie: WorkosCursorSessionToken=<token>`.

## File map

| File | Responsibility |
|---|---|
| `lib/parse-usage.js` | Pure parser. CommonJS. No network, no Scriptable. |
| `tests/parse-usage.test.js` | `node:test` coverage of every fixture. |
| `tests/fixtures/*.json` | Raw `usage-summary` payloads. |
| `scripts/sync-cursor-token` | Python helper: extract, verify, write token. |
| `tests/test_sync_cursor_token.py` | `unittest` for helper with temp sqlite + fake `urlopen`. |
| `scriptable/CursorUsage.js` | Scriptable widget: IO, cache, layout A. |
| `README.md` | Install, cookie fallback, Shortcut, iOS refresh limits, manual checklist. |

---

### Task 1: Usage parser

**Files:**
- Create: `lib/parse-usage.js`
- Create: `tests/parse-usage.test.js`
- Create: `tests/fixtures/happy.json`
- Create: `tests/fixtures/on-demand.json`
- Create: `tests/fixtures/on-demand-zero.json`
- Create: `tests/fixtures/unlimited.json`
- Create: `tests/fixtures/over-100.json`
- Create: `tests/fixtures/fallback-messages.json`
- Create: `tests/fixtures/fallback-broken.json`
- Create: `tests/fixtures/broken.json`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `parseUsageSummary(payload: unknown) => { ok: true, model: UsageModel } | { ok: false, error: "parse" }`
  - `UsageModel = { unlimited: boolean, cursorModelsPct: number|null, otherModelsPct: number|null, resetAt: string|null, onDemandUsd: number|null }`
  - When `unlimited` is true, both percents are `null`.
  - `onDemandUsd` is `used/100` dollars or `null`.
  - `resetAt` is `billingCycleEnd` or `null`.

- [ ] **Step 1: Write fixtures**

`tests/fixtures/happy.json`:

```json
{
  "billingCycleStart": "2026-08-11T00:00:00.000Z",
  "billingCycleEnd": "2026-09-11T00:00:00.000Z",
  "membershipType": "pro",
  "isUnlimited": false,
  "individualUsage": {
    "plan": {
      "enabled": true,
      "autoPercentUsed": 42.4,
      "apiPercentUsed": 80.1
    },
    "onDemand": { "enabled": false, "used": 0 }
  }
}
```

`tests/fixtures/on-demand.json`: same as happy, but `"onDemand": { "enabled": true, "used": 340 }`.

`tests/fixtures/on-demand-zero.json`: `"onDemand": { "enabled": true, "used": 0 }`.

`tests/fixtures/unlimited.json`: happy plus `"isUnlimited": true`.

`tests/fixtures/over-100.json`: `"autoPercentUsed": 120`, `"apiPercentUsed": 80.1`, on-demand disabled.

`tests/fixtures/fallback-messages.json`:

```json
{
  "billingCycleEnd": "2026-09-23T00:00:00.000Z",
  "isUnlimited": false,
  "autoModelSelectedDisplayMessage": "You've used 42% of your included total usage",
  "namedModelSelectedDisplayMessage": "You've used 80% of your included API usage",
  "individualUsage": {}
}
```

`tests/fixtures/fallback-broken.json`: same but omit `namedModelSelectedDisplayMessage`.

`tests/fixtures/broken.json`:

```json
{ "foo": 1 }
```

- [ ] **Step 2: Write the failing tests**

`tests/parse-usage.test.js`:

```javascript
"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { parseUsageSummary } = require("../lib/parse-usage.js");

function load(name) {
  const p = path.join(__dirname, "fixtures", name);
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

test("happy path rounds percents and keeps reset, no on-demand", () => {
  const r = parseUsageSummary(load("happy.json"));
  assert.equal(r.ok, true);
  assert.equal(r.model.unlimited, false);
  assert.equal(r.model.cursorModelsPct, 42);
  assert.equal(r.model.otherModelsPct, 80);
  assert.equal(r.model.resetAt, "2026-09-11T00:00:00.000Z");
  assert.equal(r.model.onDemandUsd, null);
});

test("on-demand used cents become dollars", () => {
  const r = parseUsageSummary(load("on-demand.json"));
  assert.equal(r.ok, true);
  assert.equal(r.model.onDemandUsd, 3.4);
});

test("on-demand enabled but used 0 is omitted", () => {
  const r = parseUsageSummary(load("on-demand-zero.json"));
  assert.equal(r.ok, true);
  assert.equal(r.model.onDemandUsd, null);
});

test("unlimited clears percents and keeps reset", () => {
  const r = parseUsageSummary(load("unlimited.json"));
  assert.equal(r.ok, true);
  assert.equal(r.model.unlimited, true);
  assert.equal(r.model.cursorModelsPct, null);
  assert.equal(r.model.otherModelsPct, null);
  assert.equal(r.model.resetAt, "2026-09-11T00:00:00.000Z");
});

test("percents over 100 are kept", () => {
  const r = parseUsageSummary(load("over-100.json"));
  assert.equal(r.ok, true);
  assert.equal(r.model.cursorModelsPct, 120);
  assert.equal(r.model.otherModelsPct, 80);
});

test("fallback parses both display messages", () => {
  const r = parseUsageSummary(load("fallback-messages.json"));
  assert.equal(r.ok, true);
  assert.equal(r.model.cursorModelsPct, 42);
  assert.equal(r.model.otherModelsPct, 80);
  assert.equal(r.model.resetAt, "2026-09-23T00:00:00.000Z");
});

test("single display message is a parse error", () => {
  const r = parseUsageSummary(load("fallback-broken.json"));
  assert.deepEqual(r, { ok: false, error: "parse" });
});

test("broken payload is a parse error, not zeros", () => {
  const r = parseUsageSummary(load("broken.json"));
  assert.deepEqual(r, { ok: false, error: "parse" });
});

test("null payload is a parse error", () => {
  const r = parseUsageSummary(null);
  assert.deepEqual(r, { ok: false, error: "parse" });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `node --test tests/parse-usage.test.js`

Expected: FAIL, `Cannot find module` for `../lib/parse-usage.js` (or `parseUsageSummary is not a function`).

- [ ] **Step 4: Write the parser**

`lib/parse-usage.js`:

```javascript
"use strict";

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function roundPct(n) {
  if (typeof n !== "number" || !Number.isFinite(n)) return null;
  return Math.round(n);
}

function parsePercentFromMessage(msg) {
  if (typeof msg !== "string") return null;
  const match = msg.match(/(\d+(?:\.\d+)?)\s*%/);
  if (!match) return null;
  return roundPct(Number(match[1]));
}

function onDemandUsdFrom(onDemand) {
  if (!isObject(onDemand)) return null;
  if (onDemand.enabled !== true) return null;
  if (typeof onDemand.used !== "number" || !Number.isFinite(onDemand.used)) return null;
  if (onDemand.used <= 0) return null;
  return onDemand.used / 100;
}

function buildModel(payload, cursorModelsPct, otherModelsPct, unlimited) {
  const resetAt =
    typeof payload.billingCycleEnd === "string" && payload.billingCycleEnd.length > 0
      ? payload.billingCycleEnd
      : null;
  const onDemand = isObject(payload.individualUsage)
    ? payload.individualUsage.onDemand
    : null;
  return {
    unlimited: Boolean(unlimited),
    cursorModelsPct: unlimited ? null : cursorModelsPct,
    otherModelsPct: unlimited ? null : otherModelsPct,
    resetAt,
    onDemandUsd: onDemandUsdFrom(onDemand),
  };
}

function parseUsageSummary(payload) {
  if (!isObject(payload)) return { ok: false, error: "parse" };

  const unlimited = payload.isUnlimited === true;
  const plan = isObject(payload.individualUsage) ? payload.individualUsage.plan : null;

  if (isObject(plan)) {
    const cursorModelsPct = roundPct(plan.autoPercentUsed);
    const otherModelsPct = roundPct(plan.apiPercentUsed);
    if (!unlimited && (cursorModelsPct === null || otherModelsPct === null)) {
      return { ok: false, error: "parse" };
    }
    return {
      ok: true,
      model: buildModel(payload, cursorModelsPct, otherModelsPct, unlimited),
    };
  }

  const cursorModelsPct = parsePercentFromMessage(payload.autoModelSelectedDisplayMessage);
  const otherModelsPct = parsePercentFromMessage(payload.namedModelSelectedDisplayMessage);
  if (cursorModelsPct === null || otherModelsPct === null) {
    if (unlimited) {
      return { ok: true, model: buildModel(payload, null, null, true) };
    }
    return { ok: false, error: "parse" };
  }
  return {
    ok: true,
    model: buildModel(payload, cursorModelsPct, otherModelsPct, unlimited),
  };
}

module.exports = {
  parseUsageSummary,
  parsePercentFromMessage,
  roundPct,
};
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test tests/parse-usage.test.js`

Expected: PASS, 9 tests.

- [ ] **Step 6: Commit**

```bash
git add lib/parse-usage.js tests/parse-usage.test.js tests/fixtures
git commit -m "feat: parse Cursor usage-summary into widget model"
```

---

### Task 2: Token helper extract and write

**Files:**
- Create: `scripts/sync-cursor-token`
- Create: `tests/test_sync_cursor_token.py`

**Interfaces:**
- Consumes: nothing from Task 1
- Produces:
  - `find_token_in_db(db_path: Path) -> str | None`
  - `token_path_for_home(home: Path) -> Path` → `home / "Library/Mobile Documents/iCloud~dk~simonbs~Scriptable/Documents/CursorUsage/token.txt"`
  - `default_db_path(home: Path) -> Path` → `home / "Library/Application Support/Cursor/User/globalStorage/state.vscdb"`
  - `write_token(path: Path, token: str) -> None` (creates parent dirs, writes one line + newline)
  - `COOKIE_HINT` string for stderr (no secrets)
  - `main` does not run on import

Token match: first `ItemTable.value` that contains `user_` + `::`, or a JWT starting with `eyJ`. Prefer key `cursorAuth/accessToken` if its value matches. Strip whitespace. Do not print the token.

- [ ] **Step 1: Write failing helper tests (extract/write only)**

`tests/test_sync_cursor_token.py`:

```python
import importlib.util
import io
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location(
    "sync_cursor_token", ROOT / "scripts" / "sync-cursor-token"
)
mod = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(mod)

TOKEN = "user_01ABC::eyJhbGciOiJIUzI1NiJ9.aaa.bbb"


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


class WriteTokenTests(unittest.TestCase):
    def test_writes_single_line_and_creates_dirs(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "CursorUsage" / "token.txt"
            mod.write_token(path, TOKEN)
            self.assertEqual(path.read_text(encoding="utf-8"), TOKEN + "\n")


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


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python3 -m unittest tests.test_sync_cursor_token -v`

Expected: FAIL, cannot load `scripts/sync-cursor-token`.

- [ ] **Step 3: Write the helper (verify hook included, always `"ok"` still tested via `verify_fn`)**

`scripts/sync-cursor-token`:

```python
#!/usr/bin/env python3
"""Copy a Cursor session token into Scriptable's iCloud folder."""

from __future__ import annotations

import re
import sqlite3
import sys
import urllib.error
import urllib.request
from pathlib import Path
from typing import Callable, Optional

USAGE_SUMMARY_URL = "https://cursor.com/api/usage-summary"
COOKIE_HINT = (
    "Could not update token. Paste WorkosCursorSessionToken from "
    "cursor.com DevTools → Cookies into iCloud Drive/Scriptable/CursorUsage/token.txt"
)
USER_TOKEN_RE = re.compile(r"user_[A-Za-z0-9]+::\S+")
JWT_RE = re.compile(r"eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+")


def default_db_path(home: Path) -> Path:
    return (
        home
        / "Library"
        / "Application Support"
        / "Cursor"
        / "User"
        / "globalStorage"
        / "state.vscdb"
    )


def token_path_for_home(home: Path) -> Path:
    return (
        home
        / "Library"
        / "Mobile Documents"
        / "iCloud~dk~simonbs~Scriptable"
        / "Documents"
        / "CursorUsage"
        / "token.txt"
    )


def _decode(value: object) -> str:
    if isinstance(value, bytes):
        return value.decode("utf-8", errors="ignore")
    return str(value)


def _extract_token(text: str) -> Optional[str]:
    match = USER_TOKEN_RE.search(text)
    if match:
        return match.group(0).strip()
    match = JWT_RE.search(text)
    if match:
        return match.group(0).strip()
    return None


def find_token_in_db(db_path: Path) -> Optional[str]:
    if not db_path.is_file():
        return None
    try:
        conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    except sqlite3.Error:
        return None
    try:
        rows = list(conn.execute("SELECT key, value FROM ItemTable"))
    except sqlite3.Error:
        return None
    finally:
        conn.close()

    preferred = None
    fallback = None
    for key, value in rows:
        token = _extract_token(_decode(value))
        if not token:
            continue
        if key == "cursorAuth/accessToken":
            preferred = token
            break
        if fallback is None:
            fallback = token
    return preferred or fallback


def write_token(path: Path, token: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(token.strip() + "\n", encoding="utf-8")


def verify_token(
    token: str,
    urlopen: Callable = urllib.request.urlopen,
) -> str:
    request = urllib.request.Request(
        USAGE_SUMMARY_URL,
        headers={"Cookie": f"WorkosCursorSessionToken={token}"},
        method="GET",
    )
    try:
        with urlopen(request, timeout=10) as resp:
            status = getattr(resp, "status", 200)
            if status in (401, 403):
                return "unauthorized"
            if 200 <= int(status) < 300:
                return "ok"
            return "network"
    except urllib.error.HTTPError as exc:
        if exc.code in (401, 403):
            return "unauthorized"
        return "network"
    except Exception:
        return "network"


def sync(
    db_path: Path,
    token_path: Path,
    verify_fn: Optional[Callable[[str], str]] = None,
) -> int:
    verify = verify_fn or verify_token
    token = find_token_in_db(db_path)
    if not token:
        print(COOKIE_HINT, file=sys.stderr)
        return 1

    status = verify(token)
    if status == "unauthorized":
        print(COOKIE_HINT, file=sys.stderr)
        return 1
    if status == "network":
        if token_path.is_file():
            print(
                "Could not verify token (network). Left existing token.txt in place.",
                file=sys.stderr,
            )
            print(COOKIE_HINT, file=sys.stderr)
            return 1
        write_token(token_path, token)
        print(
            "Wrote token without verification (network error). Path: Scriptable/CursorUsage/token.txt"
        )
        return 0

    write_token(token_path, token)
    print("Updated Scriptable/CursorUsage/token.txt")
    return 0


def main() -> int:
    home = Path.home()
    return sync(default_db_path(home), token_path_for_home(home))


if __name__ == "__main__":
    sys.exit(main())
```

Then: `chmod +x scripts/sync-cursor-token`

- [ ] **Step 4: Run tests to verify they pass**

Run: `python3 -m unittest tests.test_sync_cursor_token -v`

Expected: PASS (extract/write/sync-with-ok-verify).

- [ ] **Step 5: Commit**

```bash
git add scripts/sync-cursor-token tests/test_sync_cursor_token.py
git commit -m "feat: sync Cursor token into Scriptable iCloud folder"
```

---

### Task 3: Token helper verify-before-write

**Files:**
- Modify: `tests/test_sync_cursor_token.py` (append classes below)
- Modify: `scripts/sync-cursor-token` only if a test fails (logic already in Task 2)

**Interfaces:**
- Consumes: `sync(db_path, token_path, verify_fn)`, `verify_token(token, urlopen=...)`
- Produces: same `sync` contract:
  - `verify_fn -> "ok"` writes file, exit 0
  - `"unauthorized"` does not overwrite, exit 1
  - `"network"` + existing file: no overwrite, exit 1
  - `"network"` + no file: write, exit 0
  - stdout/stderr never contain the token

- [ ] **Step 1: Add verify tests**

Add `import urllib.error` to the existing import block at the top of `tests/test_sync_cursor_token.py`.

Append this class to the same file:

```python
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
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `python3 -m unittest tests.test_sync_cursor_token -v`

Expected: PASS. `verify_token` already lives in `scripts/sync-cursor-token` from Task 2. If `HTTPError(..., hdrs=None, fp=None)` raises `TypeError` on this Python, change `hdrs` to `email.message.Message()` and keep `fp=None`.

- [ ] **Step 3: Commit**

```bash
git add tests/test_sync_cursor_token.py scripts/sync-cursor-token
git commit -m "test: refuse to overwrite Cursor token on 401"
```

---

### Task 4: Scriptable widget (layout A)

**Files:**
- Create: `scriptable/CursorUsage.js`

**Interfaces:**
- Consumes: `parseUsageSummary` from Task 1 (copied verbatim into this file, including `isObject`, `roundPct`, `parsePercentFromMessage`, `onDemandUsdFrom`, `buildModel`)
- Produces: Scriptable script named `CursorUsage` that:
  - reads `FileManager.iCloud()` / `documentsDirectory()` / `CursorUsage/token.txt`
  - `GET https://cursor.com/api/usage-summary` with the cookie
  - caches last good model (plus `fetchedAt` ISO string) at `FileManager.local()` / `cursor-usage-cache.json`
  - small: title `Cursor`, two bars, reset `d MMM`, no on-demand
  - medium: title `Cursor usage`, `reset <date> · HH:mm`, two bars, `On-demand $X.XX` when `onDemandUsd !== null`
  - `refreshAfterDate` = now + 5 minutes
  - `widget.url = URLScheme.forRunningScript()`
  - statuses: `Add token`, `Token expired` (+ medium hint), stale cache (gray percents), `Offline`, `Can't parse`

Scriptable has no `require`. Copy the parser functions as plain `function` declarations (no `module.exports`). Put a one-line comment: `KEEP IN SYNC with lib/parse-usage.js`.

- [ ] **Step 1: Write `scriptable/CursorUsage.js`**

```javascript
// CursorUsage — Scriptable widget. KEEP parse helpers in sync with lib/parse-usage.js

const USAGE_URL = "https://cursor.com/api/usage-summary";
const TOKEN_DIR = "CursorUsage";
const TOKEN_FILE = "token.txt";
const CACHE_FILE = "cursor-usage-cache.json";
const REFRESH_MS = 5 * 60 * 1000;

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function roundPct(n) {
  if (typeof n !== "number" || !Number.isFinite(n)) return null;
  return Math.round(n);
}

function parsePercentFromMessage(msg) {
  if (typeof msg !== "string") return null;
  const match = msg.match(/(\d+(?:\.\d+)?)\s*%/);
  if (!match) return null;
  return roundPct(Number(match[1]));
}

function onDemandUsdFrom(onDemand) {
  if (!isObject(onDemand)) return null;
  if (onDemand.enabled !== true) return null;
  if (typeof onDemand.used !== "number" || !Number.isFinite(onDemand.used)) return null;
  if (onDemand.used <= 0) return null;
  return onDemand.used / 100;
}

function buildModel(payload, cursorModelsPct, otherModelsPct, unlimited) {
  const resetAt =
    typeof payload.billingCycleEnd === "string" && payload.billingCycleEnd.length > 0
      ? payload.billingCycleEnd
      : null;
  const onDemand = isObject(payload.individualUsage)
    ? payload.individualUsage.onDemand
    : null;
  return {
    unlimited: Boolean(unlimited),
    cursorModelsPct: unlimited ? null : cursorModelsPct,
    otherModelsPct: unlimited ? null : otherModelsPct,
    resetAt,
    onDemandUsd: onDemandUsdFrom(onDemand),
  };
}

function parseUsageSummary(payload) {
  if (!isObject(payload)) return { ok: false, error: "parse" };

  const unlimited = payload.isUnlimited === true;
  const plan = isObject(payload.individualUsage) ? payload.individualUsage.plan : null;

  if (isObject(plan)) {
    const cursorModelsPct = roundPct(plan.autoPercentUsed);
    const otherModelsPct = roundPct(plan.apiPercentUsed);
    if (!unlimited && (cursorModelsPct === null || otherModelsPct === null)) {
      return { ok: false, error: "parse" };
    }
    return {
      ok: true,
      model: buildModel(payload, cursorModelsPct, otherModelsPct, unlimited),
    };
  }

  const cursorModelsPct = parsePercentFromMessage(payload.autoModelSelectedDisplayMessage);
  const otherModelsPct = parsePercentFromMessage(payload.namedModelSelectedDisplayMessage);
  if (cursorModelsPct === null || otherModelsPct === null) {
    if (unlimited) {
      return { ok: true, model: buildModel(payload, null, null, true) };
    }
    return { ok: false, error: "parse" };
  }
  return {
    ok: true,
    model: buildModel(payload, cursorModelsPct, otherModelsPct, unlimited),
  };
}

function poolColor(pct) {
  if (pct >= 100) return Color.red();
  if (pct >= 80) return Color.orange();
  return Color.green();
}

function textColor() {
  return Color.dynamic(Color.black(), Color.white());
}

function mutedColor() {
  return Color.gray();
}

function formatReset(iso) {
  if (!iso) return "";
  const df = new DateFormatter();
  df.dateFormat = "d MMM";
  return df.string(new Date(iso));
}

function formatTime(iso) {
  if (!iso) return "";
  const df = new DateFormatter();
  df.dateFormat = "HH:mm";
  return df.string(new Date(iso));
}

function formatPct(model, key) {
  if (model.unlimited) return "∞";
  const n = model[key];
  if (typeof n !== "number") return "–";
  return `${n}%`;
}

async function readToken() {
  const fm = FileManager.iCloud();
  const dir = fm.joinPath(fm.documentsDirectory(), TOKEN_DIR);
  const path = fm.joinPath(dir, TOKEN_FILE);
  if (!fm.fileExists(path)) return "";
  await fm.downloadFileFromiCloud(path);
  return fm.readString(path).split("\n")[0].trim();
}

function cachePath() {
  const fm = FileManager.local();
  return fm.joinPath(fm.documentsDirectory(), CACHE_FILE);
}

function loadCache() {
  const fm = FileManager.local();
  const path = cachePath();
  if (!fm.fileExists(path)) return null;
  try {
    const parsed = JSON.parse(fm.readString(path));
    return isObject(parsed) ? parsed : null;
  } catch (e) {
    return null;
  }
}

function saveCache(model) {
  const fm = FileManager.local();
  fm.writeString(cachePath(), JSON.stringify(model));
}

async function fetchSummary(token) {
  const req = new Request(USAGE_URL);
  req.headers = { Cookie: `WorkosCursorSessionToken=${token}` };
  req.timeoutInterval = 15;
  const json = await req.loadJSON();
  const status = req.response && req.response.statusCode;
  const err = new Error(`http ${status}`);
  err.statusCode = status;
  if (status === 401 || status === 403) throw err;
  if (status && (status < 200 || status >= 300)) throw err;
  return json;
}

async function loadState() {
  const token = await readToken();
  if (!token) return { status: "add-token", model: null };
  try {
    const json = await fetchSummary(token);
    const parsed = parseUsageSummary(json);
    if (!parsed.ok) return { status: "parse", model: null };
    const model = Object.assign({}, parsed.model, {
      fetchedAt: new Date().toISOString(),
    });
    saveCache(model);
    return { status: "ok", model };
  } catch (e) {
    if (e.statusCode === 401 || e.statusCode === 403) {
      return { status: "expired", model: null };
    }
    const cached = loadCache();
    if (cached) return { status: "stale", model: cached };
    return { status: "offline", model: null };
  }
}

function addBar(widget, width, family, label, pctText, pct, unlimited, stale) {
  const barH = family === "small" ? 6 : 8;
  const fontSize = family === "small" ? 11 : 13;
  const color = stale
    ? mutedColor()
    : unlimited
      ? mutedColor()
      : poolColor(typeof pct === "number" ? pct : 0);

  const row = widget.addStack();
  row.layoutHorizontally();
  const name = row.addText(label);
  name.font = Font.systemFont(fontSize);
  name.textColor = stale ? mutedColor() : textColor();
  row.addSpacer();
  const value = row.addText(pctText);
  value.font = Font.semiboldSystemFont(fontSize);
  value.textColor = color;

  widget.addSpacer(4);
  const track = widget.addStack();
  track.size = new Size(width, barH);
  track.cornerRadius = 99;
  track.backgroundColor = new Color("#2c2c2e", 0.35);
  const fillW = unlimited || typeof pct !== "number" ? 0 : (Math.min(Math.max(pct, 0), 100) / 100) * width;
  if (fillW > 0) {
    const fill = track.addStack();
    fill.size = new Size(fillW, barH);
    fill.backgroundColor = color;
  }
}

function messageWidget(family, title, subtitle) {
  const w = new ListWidget();
  w.backgroundColor = Color.dynamic(Color.white(), new Color("#1c1c1e"));
  const t = w.addText(title);
  t.font = Font.semiboldSystemFont(family === "small" ? 14 : 16);
  t.textColor = textColor();
  if (subtitle) {
    w.addSpacer(6);
    const s = w.addText(subtitle);
    s.font = Font.systemFont(12);
    s.textColor = mutedColor();
    s.numberOfLines = 3;
  }
  return w;
}

function usageWidget(family, model, stale) {
  const w = new ListWidget();
  w.backgroundColor = Color.dynamic(Color.white(), new Color("#1c1c1e"));
  const width = family === "small" ? 128 : 292;
  const reset = formatReset(model.resetAt);
  const time = formatTime(model.fetchedAt);

  const header = w.addStack();
  header.layoutHorizontally();
  const title = header.addText(family === "small" ? "Cursor" : "Cursor usage");
  title.font = Font.semiboldSystemFont(10);
  title.textColor = mutedColor();
  if (family !== "small") {
    header.addSpacer();
    const meta = header.addText(
      [reset ? `reset ${reset}` : "", time].filter(Boolean).join(" · ")
    );
    meta.font = Font.systemFont(10);
    meta.textColor = mutedColor();
  }

  w.addSpacer(10);
  addBar(
    w,
    width,
    family,
    family === "small" ? "Cursor" : "Cursor Models",
    formatPct(model, "cursorModelsPct"),
    model.cursorModelsPct,
    model.unlimited,
    stale
  );
  w.addSpacer(10);
  addBar(
    w,
    width,
    family,
    family === "small" ? "Others" : "Other Models",
    formatPct(model, "otherModelsPct"),
    model.otherModelsPct,
    model.unlimited,
    stale
  );

  if (family === "small") {
    w.addSpacer();
    const foot = w.addText(reset);
    foot.font = Font.systemFont(10);
    foot.textColor = mutedColor();
  } else if (model.onDemandUsd != null) {
    w.addSpacer();
    const od = w.addText(`On-demand $${model.onDemandUsd.toFixed(2)}`);
    od.font = Font.systemFont(12);
    od.textColor = Color.purple();
  } else {
    w.addSpacer();
  }
  return w;
}

function buildWidget(family, state) {
  if (state.status === "add-token") {
    return messageWidget(family, "Add token", "iCloud Drive/Scriptable/CursorUsage/token.txt");
  }
  if (state.status === "expired") {
    return messageWidget(
      family,
      "Token expired",
      family === "medium" ? "Update token.txt with the Mac helper or a cookie." : ""
    );
  }
  if (state.status === "parse") {
    return messageWidget(family, "Can't parse", "");
  }
  if (state.status === "offline") {
    return messageWidget(family, "Offline", "");
  }
  return usageWidget(family, state.model, state.status === "stale");
}

const family = config.widgetFamily || "medium";
const state = await loadState();
const widget = buildWidget(family, state);
widget.refreshAfterDate = new Date(Date.now() + REFRESH_MS);
widget.url = URLScheme.forRunningScript();

if (config.runsInWidget) {
  Script.setWidget(widget);
} else if (family === "small") {
  await widget.presentSmall();
} else {
  await widget.presentMedium();
}
Script.complete();
```

- [ ] **Step 2: Confirm parser tests still pass (widget is not unit-tested here)**

Run: `node --test tests/parse-usage.test.js && python3 -m unittest tests.test_sync_cursor_token -v`

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add scriptable/CursorUsage.js
git commit -m "feat: add Scriptable Cursor usage widget"
```

---

### Task 5: README, Shortcut steps, manual checklist

**Files:**
- Create: `README.md`

**Interfaces:**
- Consumes: paths and behaviors from Tasks 1–4
- Produces: install docs a person can follow on Mac + iPhone without this plan

- [ ] **Step 1: Write README.md**

```markdown
# Cursor Usage widget (Scriptable)

iPhone Home Screen widget for Cursor Spending: Cursor Models %, Other Models %, reset date, and on-demand dollars when they exist.

There is no official personal usage API. The widget calls the same unofficial `https://cursor.com/api/usage-summary` endpoint as the web dashboard. It can break if Cursor changes that payload.

## Install

1. iPhone: install [Scriptable](https://scriptable.app), enable iCloud Drive for it, open the app once so `iCloud Drive/Scriptable` appears.
2. Copy `scriptable/CursorUsage.js` into a new Scriptable script named **CursorUsage**.
3. Mac: run `python3 scripts/sync-cursor-token` (Cursor desktop must have been used on this Mac).
4. Confirm `iCloud Drive/Scriptable/CursorUsage/token.txt` exists and has one line. Wait for iCloud to reach the phone.
5. iPhone Home Screen → Edit → Add Widget → Scriptable → Small and/or Medium → pick script **CursorUsage**.

## Manual cookie fallback

If the helper prints that it could not update the token:

1. Desktop browser → https://cursor.com/dashboard/spending → DevTools → Application → Cookies → `WorkosCursorSessionToken`.
2. Paste that value as the only line in `iCloud Drive/Scriptable/CursorUsage/token.txt`.
3. Tap the widget (or run the script in Scriptable) to refresh.

The helper never overwrites `token.txt` with a token that got HTTP 401/403.

## Refresh (not true realtime)

iOS decides when widgets redraw. This script asks for a refresh in 5 minutes; the system often waits 15–60 minutes.

Faster:

- Tap the widget (opens Scriptable and re-runs the script).
- Shortcuts: Automation → Personal → Time of Day / Repeat every 15 minutes → Run Script → CursorUsage. Or add a Shortcut “Refresh Cursor Usage” that runs that script and pin it to Lock Screen / Control Center.

## Tests

```bash
node --test tests/parse-usage.test.js
python3 -m unittest tests.test_sync_cursor_token -v
```

## Manual checklist

- [ ] Small: two bars, %, reset date, no on-demand line
- [ ] Medium: two bars, reset + time, on-demand only if Spending shows extra spend
- [ ] Light and dark Home Screen
- [ ] Empty/missing token → Add token
- [ ] Bad token → Token expired
- [ ] Airplane mode after a successful load → gray stale numbers, old time on medium
- [ ] Tap refreshes
- [ ] Percents match https://cursor.com/dashboard/spending
```

- [ ] **Step 2: Run automated tests once more**

Run: `node --test tests/parse-usage.test.js && python3 -m unittest tests.test_sync_cursor_token -v`

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: explain Scriptable Cursor usage widget setup"
```

---

## Spec coverage (self-review)

| Spec item | Task |
|---|---|
| small + medium stacked bars | 4 |
| Cursor/Other % from `autoPercentUsed` / `apiPercentUsed` | 1, 4 |
| reset from `billingCycleEnd` | 1, 4 |
| on-demand only if enabled and used > 0; medium only | 1, 4 |
| no plan used/limit/remaining | 4 (not rendered) |
| iCloud Scriptable `token.txt` | 2, 4, 5 |
| helper reads `state.vscdb`, no stdout token | 2 |
| do not overwrite on failed extract / 401 | 2, 3 |
| verify GET usage-summary before write; network rules | 3 |
| cookie fallback copy | 2 (`COOKIE_HINT`), 5 |
| display-message fallback, both required | 1 |
| unlimited → ∞ | 1, 4 |
| >100 percent, bar clip | 1, 4 |
| cache + stale / offline / parse / expired / add token | 4 |
| colors 80 / 100 | 4 |
| refreshAfterDate 5 min, tap, Shortcut docs | 4, 5 |
| parser tests + helper tests + README checklist | 1, 2, 3, 5 |
| English Spending labels | 4, 5 |
| unofficial endpoint warning | 5 |
