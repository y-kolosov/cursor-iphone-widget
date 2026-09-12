"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { smallFooter, formatOnDemandUsd, formatResetBadge, formatMediumMeta } = require("../lib/small-footer.js");

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
