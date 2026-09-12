# Small Widget Reset Chrome Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On the small widget, show a short `→ d MMM` reset badge in the header when on-demand occupies the footer, and otherwise show the exact same reset/time string medium already uses in its header.

**Architecture:** Keep `UsageModel` and medium behavior. Add two pure string helpers (`formatResetBadge`, `formatMediumMeta`) next to the existing footer helper so Node tests lock the copy (`→` not `->`, medium join rules). The Scriptable widget copies those helpers and uses `formatMediumMeta` for both the small no-on-demand footer and the medium header, so the strings cannot drift.

**Tech Stack:** Node.js built-in `node:test`, Scriptable JavaScript. No new packages.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-09-12-small-widget-reset-chrome-design.md`
- Do not change `lib/parse-usage.js`, token helper, parser fixtures, bar labels, title `Usage`, or medium meaning
- Arrow is Unicode `→` (U+2192) plus one space plus `d MMM`; never ASCII `->`
- Badge only when `onDemandUsd != null` and formatted reset is non-empty; no `reset` word, no `HH:mm` on the badge
- Without on-demand, header right is empty; footer is `formatMediumMeta(reset, time)` — same as medium header
- Medium header must call `formatMediumMeta(reset, time)` so the string is identical
- `smallFooter` still: on-demand wins; `kind: "reset"` only means “not on-demand and there is a resetAt” — the widget must not use that kind to decide the footer text. Footer without on-demand is meta even when only `HH:mm` exists (`smallFooter` may be `empty`)
- Keep helpers in sync between `lib/small-footer.js` and `scriptable/CursorUsage.js` by copy
- Colors, stale percents, error widgets, refresh: unchanged
- Tests: `node --test tests/*.js`

## File map

| File | Responsibility |
|---|---|
| `lib/small-footer.js` | `formatOnDemandUsd`, `smallFooter`, `formatResetBadge`, `formatMediumMeta` |
| `tests/small-footer.test.js` | Node tests for badge and meta strings |
| `scriptable/CursorUsage.js` | Copy helpers; small header badge; small footer meta; medium header uses `formatMediumMeta` |
| `README.md` / `README.ru.md` | Manual checklist for the two small states |

---

### Task 1: Badge and medium-meta helpers

**Files:**
- Modify: `lib/small-footer.js`
- Modify: `tests/small-footer.test.js`

**Interfaces:**
- Consumes: formatted date/time strings (`"4 Oct"`, `"00:09"`), not ISO
- Produces:
  - `formatResetBadge(reset: string) => string` — `→ ${reset}` if `reset` is a non-empty string, else `""`
  - `formatMediumMeta(reset: string, time: string) => string` — `[reset ? \`reset ${reset}\` : "", time].filter(Boolean).join(" · ")`
  - existing `formatOnDemandUsd` / `smallFooter` unchanged

- [ ] **Step 1: Add failing tests**

Append to `tests/small-footer.test.js` (keep the existing five tests and the current `require`):

```javascript
const { smallFooter, formatOnDemandUsd, formatResetBadge, formatMediumMeta } = require("../lib/small-footer.js");
```

Add:

```javascript
test("reset badge uses unicode arrow and a space", () => {
  assert.equal(formatResetBadge("4 Oct"), "→ 4 Oct");
  assert.equal(formatResetBadge("4 Oct").includes("->"), false);
});

test("reset badge is empty without a date", () => {
  assert.equal(formatResetBadge(""), "");
  assert.equal(formatResetBadge(null), "");
});

test("medium meta joins reset and time like the medium header", () => {
  assert.equal(formatMediumMeta("4 Oct", "00:09"), "reset 4 Oct · 00:09");
  assert.equal(formatMediumMeta("4 Oct", ""), "reset 4 Oct");
  assert.equal(formatMediumMeta("", "00:09"), "00:09");
  assert.equal(formatMediumMeta("", ""), "");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/small-footer.test.js`

Expected: FAIL — `formatResetBadge` / `formatMediumMeta` are not functions.

- [ ] **Step 3: Implement the helpers**

Replace `lib/small-footer.js` with:

```javascript
"use strict";

function formatOnDemandUsd(usd) {
  return `On-demand $${usd.toFixed(2)}`;
}

function formatResetBadge(reset) {
  if (typeof reset !== "string" || reset.length === 0) return "";
  return `→ ${reset}`;
}

function formatMediumMeta(reset, time) {
  return [reset ? `reset ${reset}` : "", time || ""].filter(Boolean).join(" · ");
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
  formatResetBadge,
  formatMediumMeta,
  smallFooter,
};
```

- [ ] **Step 4: Run helper tests**

Run: `node --test tests/small-footer.test.js`

Expected: PASS (8 tests).

- [ ] **Step 5: Run the full Node suite**

Run: `node --test tests/*.js`

Expected: PASS, 14 parser + 8 footer = 17 tests (parser file still 9). Count: 9 + 8 = 17.

- [ ] **Step 6: Commit**

```bash
git add lib/small-footer.js tests/small-footer.test.js
git commit -m "feat: format small reset badge and medium header meta"
```

---

### Task 2: Wire small header/footer and checklist

**Files:**
- Modify: `scriptable/CursorUsage.js`
- Modify: `README.md`
- Modify: `README.ru.md`

**Interfaces:**
- Consumes: `formatResetBadge(reset: string) => string`, `formatMediumMeta(reset: string, time: string) => string` from Task 1 (copied, no `require`)
- Produces: small header right badge when on-demand + reset; small footer on-demand or medium-meta; medium header text via `formatMediumMeta`

- [ ] **Step 1: Copy the new helpers into Scriptable**

In `scriptable/CursorUsage.js`, immediately after the existing `formatOnDemandUsd` / `smallFooter` pair, add the same two functions as in `lib/small-footer.js` (no `module.exports`):

```javascript
function formatResetBadge(reset) {
  if (typeof reset !== "string" || reset.length === 0) return "";
  return `→ ${reset}`;
}

function formatMediumMeta(reset, time) {
  return [reset ? `reset ${reset}` : "", time || ""].filter(Boolean).join(" · ");
}
```

Update the file header comment so it still says to keep `smallFooter` / `formatOnDemandUsd` / `formatResetBadge` / `formatMediumMeta` in sync with `lib/small-footer.js`.

- [ ] **Step 2: Replace `usageWidget` header and footers**

Replace the entire `usageWidget` function with:

```javascript
function usageWidget(family, model, stale) {
  const w = new ListWidget();
  w.backgroundColor = Color.dynamic(Color.white(), new Color("#1c1c1e"));
  const width = family === "small" ? 118 : 292;
  const reset = formatReset(model.resetAt);
  const time = formatTime(model.fetchedAt);
  const meta = formatMediumMeta(reset, time);
  const onDemand = model.onDemandUsd != null;

  const header = w.addStack();
  header.layoutHorizontally();
  const title = header.addText(family === "small" ? "Usage" : "Cursor usage");
  title.font = Font.semiboldSystemFont(10);
  title.textColor = mutedColor();
  title.lineLimit = 1;
  const headerRight = family === "small"
    ? onDemand
      ? formatResetBadge(reset)
      : ""
    : meta;
  if (headerRight) {
    header.addSpacer();
    const side = header.addText(headerRight);
    side.font = Font.systemFont(10);
    side.textColor = mutedColor();
    side.lineLimit = 1;
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
    if (onDemand) {
      w.addSpacer();
      const od = w.addText(formatOnDemandUsd(model.onDemandUsd));
      od.font = Font.systemFont(10);
      od.textColor = Color.purple();
      od.lineLimit = 1;
    } else if (meta) {
      w.addSpacer();
      const foot = w.addText(meta);
      foot.font = Font.systemFont(10);
      foot.textColor = mutedColor();
      foot.lineLimit = 1;
    } else {
      w.addSpacer();
    }
  } else if (onDemand) {
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

Do not edit `addBar`, `messageWidget`, `buildWidget`, `loadState`, or parser functions. Do not decide the small footer from `smallFooter(...).kind === "reset"` — that would drop a time-only footer.

- [ ] **Step 3: Update README checklists**

In `README.md`, replace the first two small checklist items with:

```markdown
- [ ] Small with on-demand: title `Usage`, right header `→ d MMM` (unicode arrow), footer `On-demand $X.XX`, no `reset` in the footer, labels not clipped
- [ ] Small without on-demand: right header empty, footer matches medium header (`reset d MMM · HH:mm`; time only if date missing)
- [ ] Medium: two bars, reset + time, on-demand only if Spending shows extra spend
```

In `README.ru.md`, replace the first two small items with:

```markdown
- [ ] Small с on-demand: заголовок `Usage`, справа `→ d MMM` (юникод-стрелка), футер `On-demand $X.XX`, внизу нет `reset`, подписи не обрезаны
- [ ] Small без on-demand: справа пусто, футер как шапка medium (`reset d MMM · HH:mm`; только время, если даты нет)
- [ ] Medium: две полоски, сброс + время, on-demand только если Spending показывает доп. расход
```

Leave the remaining checklist rows as they are.

- [ ] **Step 4: Run automated tests**

Run: `node --test tests/*.js`

Expected: PASS, 17 tests.

- [ ] **Step 5: Commit**

```bash
git add scriptable/CursorUsage.js README.md README.ru.md
git commit -m "fix: show reset badge or medium meta on the small widget"
```

---

## Spec coverage (self-review)

| Spec item | Task |
|---|---|
| `→ d MMM` when on-demand + resetAt | 1, 2 |
| Unicode `→`, not `->` | 1 (assert), 2 |
| No badge without resetAt | 1, 2 |
| No badge without on-demand | 2 |
| Footer `$` when on-demand | 2 |
| Footer = medium meta when no on-demand | 1, 2 |
| Time-only footer | 1, 2 (meta, not `smallFooter` kind) |
| Empty footer when no meta | 2 |
| Medium header same string | 2 (`formatMediumMeta`) |
| Errors / stale / unlimited / parser untouched | 2 (no edits to those paths) |
| README checklist | 2 |
