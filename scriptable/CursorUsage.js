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
  let json;
  try {
    json = await req.loadJSON();
  } catch (_) {
    // loadJSON throws on non-JSON bodies; statusCode is still on req.response
  }
  const status = req.response && req.response.statusCode;
  const err = new Error(`http ${status}`);
  err.statusCode = status;
  if (status === 401 || status === 403) throw err;
  if (status && (status < 200 || status >= 300)) throw err;
  if (json === undefined) throw err;
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
  track.layoutHorizontally();
  track.size = new Size(width, barH);
  track.cornerRadius = 99;
  track.spacing = 0;
  const fillW = unlimited || typeof pct !== "number" ? 0 : (Math.min(Math.max(pct, 0), 100) / 100) * width;
  if (fillW >= width) {
    track.backgroundColor = color;
  } else {
    track.backgroundColor = new Color("#2c2c2e", 0.35);
    if (fillW > 0) {
      const fill = track.addStack();
      fill.size = new Size(fillW, barH);
      fill.backgroundColor = color;
      track.addSpacer();
    }
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
