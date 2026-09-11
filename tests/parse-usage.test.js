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
