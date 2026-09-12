# Small Widget Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Scriptable small widget show both pool percents plus on-demand when it exists, with `Usage` as the title and the reset date only as a fallback footer.

**Architecture:** Keep the existing `UsageModel` and medium layout. A tiny pure helper chooses the small footer (`on-demand` | `reset` | `empty`) so the rule is unit-tested in Node. The Scriptable widget copies that helper (same pattern as `parse-usage.js`) and only changes small chrome: title, footer, `lineLimit`, bar width.

**Tech Stack:** Node.js built-in `node:test` (footer helper), Scriptable JavaScript (widget). No new packages.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-09-12-small-widget-layout-design.md`
- Do not change `lib/parse-usage.js`, `scripts/sync-cursor-token`, parser fixtures, or medium layout/copy
- Small title is `Usage`; small bar labels stay `Cursor` and `Others`
- Small footer is one line: on-demand **or** reset date, never both
- `onDemandUsd != null` → footer `On-demand $X.XX` via `toFixed(2)`, purple
- Else if `resetAt` is a non-empty string → footer `d MMM` (existing `formatReset`), muted
- Else no footer text (no `$0.00`, no `reset`)
- No `fetchedAt` / `HH:mm` on small
- Small bar width `118` (not `128`); title and bar label/value `lineLimit = 1`
- Colors, stale percents, error `messageWidget`s, refresh, token, cache: unchanged
- Keep `smallFooter` / `formatOnDemandUsd` in sync between `lib/small-footer.js` and `scriptable/CursorUsage.js` by copy (no bundler)

## File map

| File | Responsibility |
|---|---|
| `lib/small-footer.js` | Pure footer choice + on-demand string. CommonJS. No Scriptable, no network. |
| `tests/small-footer.test.js` | `node:test` coverage of footer kinds and copy. |
| `scriptable/CursorUsage.js` | Copy of the helper; small title/footer/clipping. Medium untouched. |
| `README.md` / `README.ru.md` | Manual checklist for the new small states. |
| `lib/parse-usage.js` | Do not modify. |

---

### Task 1: Small footer helper

**Files:**
- Create: `lib/small-footer.js`
- Create: `tests/small-footer.test.js`

**Interfaces:**
- Consumes: a widget `UsageModel` (or any object with `onDemandUsd` and `resetAt`)
- Produces:
  - `formatOnDemandUsd(usd: number) => string` — always `On-demand $` + `usd.toFixed(2)`
  - `smallFooter(model: { onDemandUsd: number|null, resetAt: string|null }) => { kind: "on-demand", text: string } | { kind: "reset" } | { kind: "empty" }`
  - On-demand wins over `resetAt`. `kind: "reset"` has no `text` — Scriptable formats the date with `formatReset`.

- [ ] **Step 1: Write the failing tests**

`tests/small-footer.test.js`:

```javascript
"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { smallFooter, formatOnDemandUsd } = require("../lib/small-footer.js");

test("formats on-demand dollars with two decimals", () => {
  assert.equal(formatOnDemandUsd(7.38), "On-demand $7.38");
  assert.equal(formatOnDemandUsd(3.4), "On-demand $3.40");
});

test("on-demand wins over reset date", () => {
  const r = smallFooter({
    onDemandUsd: 7.38,
    resetAt: "2026-10-04T00:09:00.000Z",
  });
  assert.deepEqual(r, { kind: "on-demand", text: "On-demand $7.38" });
});

test("reset when on-demand is null", () => {
  const r = smallFooter({
    onDemandUsd: null,
    resetAt: "2026-10-04T00:09:00.000Z",
  });
  assert.deepEqual(r, { kind: "reset" });
});

test("empty when no on-demand and no reset", () => {
  const r = smallFooter({ onDemandUsd: null, resetAt: null });
  assert.deepEqual(r, { kind: "empty" });
});

test("empty resetAt string is empty footer", () => {
  const r = smallFooter({ onDemandUsd: null, resetAt: "" });
  assert.deepEqual(r, { kind: "empty" });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/small-footer.test.js`

Expected: FAIL, `Cannot find module` for `../lib/small-footer.js`.

- [ ] **Step 3: Write the helper**

`lib/small-footer.js`:

```javascript
"use strict";

function formatOnDemandUsd(usd) {
  return `On-demand $${usd.toFixed(2)}`;
}

function smallFooter(model) {
  if (model.onDemandUsd != null) {
    return { kind: "on-demand", text: formatOnDemandUsd(model.onDemandUsd) };
  }
  if (typeof model.resetAt === "string" && model.resetAt.length > 0) {
    return { kind: "reset" };
  }
  return { kind: "empty" };
}

module.exports = {
  formatOnDemandUsd,
  smallFooter,
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/small-footer.test.js`

Expected: PASS, 5 tests.

- [ ] **Step 5: Confirm parser tests still pass**

Run: `node --test tests/parse-usage.test.js`

Expected: PASS (this task must not edit `lib/parse-usage.js`).

- [ ] **Step 6: Commit**

```bash
git add lib/small-footer.js tests/small-footer.test.js
git commit -m "feat: choose small widget footer as on-demand or reset"
```

---

### Task 2: Small widget chrome and checklist

**Files:**
- Modify: `scriptable/CursorUsage.js`
- Modify: `README.md`
- Modify: `README.ru.md`

**Interfaces:**
- Consumes: `smallFooter` / `formatOnDemandUsd` from Task 1 (copied as plain functions; no `require`)
- Produces: small widget with title `Usage`, bars `Cursor` / `Others`, footer from `smallFooter`; medium still uses `Cursor usage`, header `reset … · HH:mm`, and bottom on-demand via `formatOnDemandUsd`

- [ ] **Step 1: Copy helpers into the Scriptable script**

In `scriptable/CursorUsage.js`, change the file header comment to:

```javascript
// CursorUsage — Scriptable widget.
// KEEP parse helpers in sync with lib/parse-usage.js
// KEEP smallFooter / formatOnDemandUsd in sync with lib/small-footer.js
```

Insert these two functions immediately after `formatTime` and before `formatPct` (do not add `module.exports`):

```javascript
function formatOnDemandUsd(usd) {
  return `On-demand $${usd.toFixed(2)}`;
}

function smallFooter(model) {
  if (model.onDemandUsd != null) {
    return { kind: "on-demand", text: formatOnDemandUsd(model.onDemandUsd) };
  }
  if (typeof model.resetAt === "string" && model.resetAt.length > 0) {
    return { kind: "reset" };
  }
  return { kind: "empty" };
}
```

- [ ] **Step 2: Stop label clipping on bars**

In `addBar`, after creating `name` and `value`, set `lineLimit = 1` on both:

```javascript
  const name = row.addText(label);
  name.font = Font.systemFont(fontSize);
  name.textColor = stale ? mutedColor() : textColor();
  name.lineLimit = 1;
  row.addSpacer();
  const value = row.addText(pctText);
  value.font = Font.semiboldSystemFont(fontSize);
  value.textColor = color;
  value.lineLimit = 1;
```

Leave bar height, colors, fill-clip, and track drawing unchanged.

- [ ] **Step 3: Change small title, width, and footer**

Replace the body of `usageWidget` with:

```javascript
function usageWidget(family, model, stale) {
  const w = new ListWidget();
  w.backgroundColor = Color.dynamic(Color.white(), new Color("#1c1c1e"));
  const width = family === "small" ? 118 : 292;
  const reset = formatReset(model.resetAt);
  const time = formatTime(model.fetchedAt);

  const header = w.addStack();
  header.layoutHorizontally();
  const title = header.addText(family === "small" ? "Usage" : "Cursor usage");
  title.font = Font.semiboldSystemFont(10);
  title.textColor = mutedColor();
  title.lineLimit = 1;
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
    const footer = smallFooter(model);
    if (footer.kind === "on-demand") {
      w.addSpacer();
      const od = w.addText(footer.text);
      od.font = Font.systemFont(10);
      od.textColor = Color.purple();
      od.lineLimit = 1;
    } else if (footer.kind === "reset") {
      w.addSpacer();
      const foot = w.addText(reset);
      foot.font = Font.systemFont(10);
      foot.textColor = mutedColor();
      foot.lineLimit = 1;
    } else {
      w.addSpacer();
    }
  } else if (model.onDemandUsd != null) {
    w.addSpacer();
    const od = w.addText(formatOnDemandUsd(model.onDemandUsd));
    od.font = Font.systemFont(12);
    od.textColor = Color.purple();
  } else {
    w.addSpacer();
  }
  return w;
}
```

Do not edit `messageWidget`, `buildWidget`, `loadState`, or parser functions.

- [ ] **Step 4: Update README checklists**

In `README.md`, replace the first two manual checklist items with:

```markdown
- [ ] Small with on-demand: title `Usage`, bars `Cursor` / `Others`, footer `On-demand $X.XX`, no reset date, labels not clipped
- [ ] Small without on-demand: footer is reset date `d MMM` (empty footer if `resetAt` is missing)
- [ ] Medium: two bars, reset + time, on-demand only if Spending shows extra spend
```

In `README.ru.md`, replace the first two checklist items with:

```markdown
- [ ] Small с on-demand: заголовок `Usage`, бары `Cursor` / `Others`, футер `On-demand $X.XX`, без даты, подписи не обрезаны
- [ ] Small без on-demand: в футере дата сброса `d MMM` (пустой футер, если `resetAt` нет)
- [ ] Medium: две полоски, сброс + время, on-demand только если Spending показывает доп. расход
```

Leave the remaining checklist rows as they are.

- [ ] **Step 5: Run automated tests**

Run: `node --test tests/small-footer.test.js tests/parse-usage.test.js`

Expected: PASS, all footer tests and all parser tests.

- [ ] **Step 6: Commit**

```bash
git add scriptable/CursorUsage.js README.md README.ru.md
git commit -m "fix: show on-demand or reset date on the small widget"
```

---

## Spec coverage (self-review)

| Spec item | Task |
|---|---|
| Title `Usage` | 2 |
| Bars `Cursor` / `Others` + integer `%` / `∞` | 2 (labels already there; `formatPct` unchanged) |
| Footer on-demand `$X.XX` when `onDemandUsd != null` | 1, 2 |
| Else reset `d MMM` | 1, 2 |
| Else empty footer, never `$0.00` | 1, 2 |
| No fetch time on small | 2 (header meta still medium-only) |
| `lineLimit = 1`, bar width 118 | 2 |
| Medium unchanged | 2 |
| Parser / token / cache / errors / stale percents unchanged | 1 (new files only), 2 (no edits to those paths) |
| README / README.ru checklist | 2 |
| Helper kept in sync by copy | 1, 2 |
