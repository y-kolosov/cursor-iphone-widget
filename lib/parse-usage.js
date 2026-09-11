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
