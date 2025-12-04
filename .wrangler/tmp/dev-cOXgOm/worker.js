var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// worker.js
var __DEDUPE_CACHE = /* @__PURE__ */ new Map();
function dedupeCheck(key, ttlMs = 3e4) {
  const now = Date.now();
  const hit = __DEDUPE_CACHE.get(key);
  if (hit && hit > now) return true;
  __DEDUPE_CACHE.set(key, now + ttlMs);
  return false;
}
__name(dedupeCheck, "dedupeCheck");
function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS"
  };
}
__name(corsHeaders, "corsHeaders");
async function handleHealth(env) {
  const telegramConfigured = !!(env && env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID);
  return new Response(JSON.stringify({ ok: true, worker: true, telegramConfigured, time: Date.now() }), {
    status: 200,
    headers: { "Content-Type": "application/json", ...corsHeaders() }
  });
}
__name(handleHealth, "handleHealth");
async function handlePrice(url) {
  const symbol = (url.searchParams.get("symbol") || "BTCUSDT").toUpperCase();
  try {
    const apiUrl = `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=1m&limit=2`;
    const resp = await fetch(apiUrl, { cf: { cacheTtl: 0 } });
    if (!resp.ok) {
      return new Response(JSON.stringify({ ok: false, error: "binance_fetch_failed", status: resp.status }), {
        status: 502,
        headers: { "Content-Type": "application/json", ...corsHeaders() }
      });
    }
    const data = await resp.json();
    const closes = Array.isArray(data) ? data.map((k) => parseFloat(k[4])) : [];
    const price = closes.length ? closes[closes.length - 1] : null;
    return new Response(JSON.stringify({ ok: true, symbol, price }), {
      status: 200,
      headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=5", ...corsHeaders() }
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: "price_fetch_exception", detail: String(e) }), {
      status: 500,
      headers: { "Content-Type": "application/json", ...corsHeaders() }
    });
  }
}
__name(handlePrice, "handlePrice");
async function handleSendAlert(request, env) {
  try {
    const botToken = env && env.TELEGRAM_BOT_TOKEN ? String(env.TELEGRAM_BOT_TOKEN) : "";
    const envChat = env && env.TELEGRAM_CHAT_ID ? String(env.TELEGRAM_CHAT_ID) : "";
    if (!botToken || !envChat) {
      return new Response(JSON.stringify({ ok: false, error: "telegram_not_configured" }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...corsHeaders() }
      });
    }
    let bodyJson;
    try {
      bodyJson = await request.json();
    } catch (e) {
      bodyJson = {};
    }
    let confirmed = bodyJson && bodyJson.confirmed === true;
    let refererAllowed = false;
    try {
      const ref = request.headers.get("referer") || "";
      const allow = env && env.ALLOWED_REFERERS ? String(env.ALLOWED_REFERERS) : "";
      if (allow && ref) {
        const list = allow.split(",").map((s) => s.trim()).filter(Boolean);
        const u = new URL(ref);
        const host = u.host || "";
        const proto = u.protocol || "";
        for (const a of list) {
          if (!a) continue;
          if (a.includes("*")) {
            const m = a.match(/^https?:\/\/\*\.(.+)$/);
            if (m && proto.startsWith("http") && (host.endsWith(m[1]) || host === m[1])) {
              refererAllowed = true;
              break;
            }
          } else {
            if (ref.startsWith(a)) {
              refererAllowed = true;
              break;
            }
          }
        }
      }
    } catch (e) {
      refererAllowed = false;
    }
    if (!confirmed && refererAllowed && bodyJson) {
      if (bodyJson.emaShort && bodyJson.emaLong) {
        confirmed = true;
      } else {
        const m = (bodyJson.message || bodyJson.text || "").toString();
        if (m.startsWith("Binance Alert:")) {
          confirmed = true;
        }
      }
    }
    if (!confirmed) {
      return new Response(JSON.stringify({ ok: false, error: "unconfirmed_event", hint: "Client must send confirmed=true for real EMA cross events.", received: { hasConfirmed: bodyJson && bodyJson.confirmed === true, emaShort: bodyJson && bodyJson.emaShort, emaLong: bodyJson && bodyJson.emaLong, message: bodyJson && (bodyJson.message || bodyJson.text) || null }, refererAllowed }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...corsHeaders() }
      });
    }
    try {
      const ref = request.headers.get("referer") || "";
      const allow = env && env.ALLOWED_REFERERS ? String(env.ALLOWED_REFERERS) : "";
      if (allow && ref) {
        const list = allow.split(",").map((s) => s.trim()).filter(Boolean);
        let ok = false;
        try {
          const u = new URL(ref);
          const host = u.host || "";
          const proto = u.protocol || "";
          for (const a of list) {
            if (!a) continue;
            if (a.includes("*")) {
              const m = a.match(/^https?:\/\/\*\.(.+)$/);
              if (m && proto.startsWith("http") && (host.endsWith(m[1]) || host === m[1])) {
                ok = true;
                break;
              }
            } else {
              if (ref.startsWith(a)) {
                ok = true;
                break;
              }
            }
          }
        } catch (e) {
        }
        if (!ok) {
          return new Response(JSON.stringify({ ok: false, error: "referer_not_allowed", referer: ref }), {
            status: 403,
            headers: { "Content-Type": "application/json", ...corsHeaders() }
          });
        }
      }
    } catch (e) {
    }
    const symbol = (bodyJson.symbol || "").toString().toUpperCase();
    const price = typeof bodyJson.price !== "undefined" ? bodyJson.price : "";
    const emaShort = bodyJson.emaShort || "";
    const emaLong = bodyJson.emaLong || "";
    const tag = emaShort && emaLong ? `EMA${emaShort}/${emaLong}` : "";
    let text = "";
    if (typeof bodyJson.text === "string" && bodyJson.text.trim()) {
      text = bodyJson.text.trim();
    } else {
      const msgBase = (bodyJson.message || "Alert").toString();
      const parts = [msgBase, symbol, price ? `@ ${price}` : "", tag].filter(Boolean);
      text = parts.join(" ").trim();
    }
    let chatId = typeof bodyJson.chatId !== "undefined" && bodyJson.chatId !== null ? String(bodyJson.chatId) : envChat;
    const n = Number(chatId);
    if (!Number.isNaN(n) && String(n) === String(chatId)) chatId = n;
    try {
      const ua = request.headers.get("user-agent") || "";
      const ref = request.headers.get("referer") || "";
      const safe = { ev: "send-alert", ts: Date.now(), symbol, text, ua, ref, confirmed: true };
      console.log(JSON.stringify(safe));
    } catch (e) {
    }
    const useToken = bodyJson.token ? String(bodyJson.token) : botToken;
    const apiBase = `https://api.telegram.org/bot${useToken}`;
    const imageData = typeof bodyJson.image === "string" && bodyJson.image.length > 32 ? String(bodyJson.image) : null;
    const dedupeKey = `${String(chatId)}|${text}`;
    if (dedupeCheck(dedupeKey, 3e4)) {
      return new Response(JSON.stringify({ ok: true, skippedDuplicate: true, sent: null }), {
        status: 200,
        headers: { "Content-Type": "application/json", ...corsHeaders() }
      });
    }
    const maxRetries = 2;
    let attempt = 0;
    let last = null;
    while (attempt <= maxRetries) {
      let tgResp, result;
      if (imageData) {
        try {
          let mime = "image/png";
          let base64 = imageData;
          const m = imageData.match(/^data:(.*?);base64,(.*)$/);
          if (m) {
            mime = m[1] || "image/png";
            base64 = m[2] || "";
          }
          const bin = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
          const fd = new FormData();
          fd.append("chat_id", String(chatId));
          fd.append("caption", text);
          fd.append("photo", new Blob([bin.buffer], { type: mime }), `chart.${mime.includes("jpeg") ? "jpg" : mime.includes("png") ? "png" : "bin"}`);
          tgResp = await fetch(`${apiBase}/sendPhoto`, { method: "POST", body: fd });
        } catch (e) {
          tgResp = await fetch(`${apiBase}/sendMessage`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chat_id: chatId, text }) });
        }
        result = await tgResp.json().catch(() => null);
      } else {
        tgResp = await fetch(`${apiBase}/sendMessage`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chat_id: chatId, text }) });
        result = await tgResp.json().catch(() => null);
      }
      if (tgResp.ok && result && result.ok) {
        return new Response(JSON.stringify({ ok: true, sent: text, hasImage: !!imageData, telegram: result }), {
          status: 200,
          headers: { "Content-Type": "application/json", ...corsHeaders() }
        });
      }
      last = { status: tgResp.status, detail: result };
      if (tgResp.status >= 500 || tgResp.status === 429) {
        await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
        attempt += 1;
        continue;
      }
      break;
    }
    return new Response(JSON.stringify({ ok: false, error: "telegram_api_failed", ...last, hint: "Verify chat_id and bot permissions. Try direct API with same payload." }), {
      status: 502,
      headers: { "Content-Type": "application/json", ...corsHeaders() }
    });
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: "telegram_exception", detail: String(err) }), {
      status: 500,
      headers: { "Content-Type": "application/json", ...corsHeaders() }
    });
  }
}
__name(handleSendAlert, "handleSendAlert");
var DEFAULT_CONFIG = { interval: "5m", emaShort: 26, emaLong: 200, scanType: "golden", crossCooldownMinutes: 30 };
var DEFAULT_SYMBOLS = ["BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT"];
async function kvGetJson(kv, key, fallback = null) {
  if (!kv) return fallback;
  try {
    const v = await kv.get(key);
    if (!v) return fallback;
    return JSON.parse(v);
  } catch {
    return fallback;
  }
}
__name(kvGetJson, "kvGetJson");
async function kvPutJson(kv, key, obj) {
  if (!kv) return;
  try {
    await kv.put(key, JSON.stringify(obj));
  } catch {
  }
}
__name(kvPutJson, "kvPutJson");
async function loadConfig(env) {
  const stored = await kvGetJson(env.KV_SCAN, "config", {});
  const cfg = { ...DEFAULT_CONFIG, ...stored || {} };
  if (typeof cfg.interval === "number" || /^\d+$/.test(String(cfg.interval || ""))) cfg.interval = `${cfg.interval}m`;
  cfg.emaShort = parseInt(cfg.emaShort, 10) || DEFAULT_CONFIG.emaShort;
  cfg.emaLong = parseInt(cfg.emaLong, 10) || DEFAULT_CONFIG.emaLong;
  if (!["golden", "dead", "both"].includes(cfg.scanType)) cfg.scanType = DEFAULT_CONFIG.scanType;
  cfg.crossCooldownMinutes = Math.max(1, parseInt(cfg.crossCooldownMinutes, 10) || DEFAULT_CONFIG.crossCooldownMinutes);
  return cfg;
}
__name(loadConfig, "loadConfig");
async function saveConfig(env, cfg) {
  return kvPutJson(env.KV_SCAN, "config", cfg);
}
__name(saveConfig, "saveConfig");
async function loadSymbols(env) {
  const arr = await kvGetJson(env.KV_SCAN, "symbols", DEFAULT_SYMBOLS);
  if (!Array.isArray(arr) || !arr.length) return DEFAULT_SYMBOLS;
  return arr.map((s) => String(s).toUpperCase()).filter((s) => /USDT$/.test(s));
}
__name(loadSymbols, "loadSymbols");
async function saveSymbols(env, symbols) {
  return kvPutJson(env.KV_SCAN, "symbols", symbols);
}
__name(saveSymbols, "saveSymbols");
async function loadState(env) {
  const st = await kvGetJson(env.KV_SCAN, "state", { lastRun: 0, lastError: null, matches: [] });
  if (!st || typeof st !== "object") return { lastRun: 0, lastError: null, matches: [] };
  if (!Array.isArray(st.matches)) st.matches = [];
  return st;
}
__name(loadState, "loadState");
async function saveState(env, st) {
  return kvPutJson(env.KV_SCAN, "state", st);
}
__name(saveState, "saveState");
async function loadLastCross(env) {
  return kvGetJson(env.KV_SCAN, "lastCross", {});
}
__name(loadLastCross, "loadLastCross");
async function saveLastCross(env, map) {
  return kvPutJson(env.KV_SCAN, "lastCross", map);
}
__name(saveLastCross, "saveLastCross");
function calculateEma(values, period) {
  if (!Array.isArray(values) || values.length === 0) return [];
  const k = 2 / (period + 1);
  const out = [];
  let ema = null;
  for (let i = 0; i < values.length; i++) {
    const v = Number(values[i]);
    if (isNaN(v)) {
      out.push(null);
      continue;
    }
    if (ema === null) {
      if (i + 1 >= period) {
        const slice = values.slice(i + 1 - period, i + 1).map(Number);
        ema = slice.reduce((a, b) => a + b, 0) / period;
        out.push(ema);
      } else {
        out.push(null);
      }
    } else {
      ema = v * k + ema * (1 - k);
      out.push(ema);
    }
  }
  return out;
}
__name(calculateEma, "calculateEma");
function crossed(type, prevShort, prevLong, lastShort, lastLong) {
  if ([prevShort, prevLong, lastShort, lastLong].some((v) => typeof v !== "number")) return false;
  if (type === "golden") return prevShort <= prevLong && lastShort > lastLong;
  if (type === "dead") return prevShort >= prevLong && lastShort < lastLong;
  return false;
}
__name(crossed, "crossed");
async function sendTelegram(env, text) {
  const botToken = env && env.TELEGRAM_BOT_TOKEN ? String(env.TELEGRAM_BOT_TOKEN) : "";
  const chatId = env && env.TELEGRAM_CHAT_ID ? String(env.TELEGRAM_CHAT_ID) : "";
  if (!botToken || !chatId) return { ok: false, error: "telegram_not_configured" };
  const r = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text })
  });
  const j = await r.json().catch(() => null);
  return r.ok ? { ok: true, result: j } : { ok: false, error: "telegram_api_failed", detail: j };
}
__name(sendTelegram, "sendTelegram");
async function runScanOnce(env, overrides = {}) {
  const scanEnabled = String(env && env.SCAN_ENABLED || "").toLowerCase() === "true";
  const kvAvailable = !!(env && env.KV_SCAN);
  const allowSends = scanEnabled && kvAvailable;
  const storedCfg = await loadConfig(env);
  const cfg = { ...storedCfg, ...overrides || {} };
  if (typeof overrides.interval !== "undefined") {
    let v = overrides.interval;
    if (typeof v === "number" || /^\d+$/.test(String(v))) v = `${v}m`;
    cfg.interval = String(v);
  }
  if (typeof overrides.emaShort !== "undefined") cfg.emaShort = parseInt(overrides.emaShort, 10) || cfg.emaShort;
  if (typeof overrides.emaLong !== "undefined") cfg.emaLong = parseInt(overrides.emaLong, 10) || cfg.emaLong;
  if (typeof overrides.scanType !== "undefined") {
    const t = String(overrides.scanType);
    cfg.scanType = ["golden", "dead", "both"].includes(t) ? t : cfg.scanType;
  }
  const symbols = await loadSymbols(env);
  const state = await loadState(env);
  const lastMap = await loadLastCross(env);
  const endpointBase = "https://fapi.binance.com/fapi/v1/klines";
  const interval = cfg.interval;
  const emaShort = parseInt(cfg.emaShort, 10);
  const emaLong = parseInt(cfg.emaLong, 10);
  const needed = Math.max(emaShort, emaLong) + 10;
  const limit = Math.min(1e3, Math.max(needed + 10, 120));
  const concurrency = 8;
  const cooldownMs = Math.max(1, parseInt(cfg.crossCooldownMinutes, 10) || DEFAULT_CONFIG.crossCooldownMinutes) * 60 * 1e3;
  let idx = 0;
  const matches = [];
  const startTime = Date.now();
  let scannedCount = 0;
  async function processSymbol(sym) {
    const url = `${endpointBase}?symbol=${encodeURIComponent(sym)}&interval=${encodeURIComponent(interval)}&limit=${limit}`;
    const resp = await fetch(url, { cf: { cacheTtl: 0 } });
    if (!resp.ok) return;
    const data = await resp.json();
    const closes = Array.isArray(data) ? data.map((d) => parseFloat(d[4])) : [];
    if (!closes.length || closes.length < needed + 1) return;
    const emaS = calculateEma(closes, emaShort);
    const emaL = calculateEma(closes, emaLong);
    const lastClosedIdx = closes.length - 2;
    const prevIdx = lastClosedIdx - 1;
    const prevShort = emaS[prevIdx];
    const prevLong = emaL[prevIdx];
    const lastShort = emaS[lastClosedIdx];
    const lastLong = emaL[lastClosedIdx];
    const now = Date.now();
    const typesToCheck = cfg.scanType === "both" ? ["golden", "dead"] : [cfg.scanType];
    for (const t of typesToCheck) {
      if (crossed(t, prevShort, prevLong, lastShort, lastLong)) {
        const key = `${sym}:${t}`;
        const lastTs = lastMap[key] || 0;
        if (now - lastTs < cooldownMs) continue;
        const msg = (t === "golden" ? "[\uACE8\uB4E0]" : "[\uB370\uB4DC]") + ` ${sym} ${interval} EMA${emaShort}/${emaLong} @ ${(/* @__PURE__ */ new Date()).toLocaleString("ko-KR")}`;
        if (allowSends) {
          const sent = await sendTelegram(env, msg);
          if (sent && sent.ok) {
            lastMap[key] = now;
          }
        }
        matches.push({ symbol: sym, type: t, interval, emaShort, emaLong, time: (/* @__PURE__ */ new Date()).toISOString() });
      }
    }
  }
  __name(processSymbol, "processSymbol");
  try {
    while (idx < symbols.length) {
      const batch = symbols.slice(idx, idx + concurrency);
      await Promise.all(batch.map((s) => processSymbol(s)));
      idx += batch.length;
      scannedCount += batch.length;
      if (idx < symbols.length) await new Promise((r) => setTimeout(r, 150));
    }
    state.lastRun = Date.now();
    state.lastError = null;
    state.matches = Array.isArray(state.matches) ? [...matches, ...state.matches].slice(0, 200) : matches.slice(0, 200);
    state.lastScanDuration = Date.now() - startTime;
    state.scannedCount = scannedCount;
    state.newMatches = matches.length;
    await saveState(env, state);
    if (kvAvailable) await saveLastCross(env, lastMap);
    return { ok: true, count: matches.length, sends: allowSends ? "sent-if-match" : "disabled" };
  } catch (err) {
    state.lastRun = Date.now();
    state.lastError = String(err);
    state.lastScanDuration = Date.now() - startTime;
    state.scannedCount = scannedCount;
    state.newMatches = matches.length;
    await saveState(env, state);
    return { ok: false, error: "scan_exception", detail: String(err) };
  }
}
__name(runScanOnce, "runScanOnce");
async function handleGetConfig(env) {
  const cfg = await loadConfig(env);
  return new Response(JSON.stringify({ ok: true, config: cfg }), { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders() } });
}
__name(handleGetConfig, "handleGetConfig");
async function handlePostConfig(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ ok: false, error: "invalid_json" }), { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders() } });
  }
  const next = await loadConfig(env);
  if (typeof body.interval !== "undefined") {
    let v = body.interval;
    if (typeof v === "number" || /^\d+$/.test(String(v))) v = `${v}m`;
    next.interval = String(v);
  }
  if (typeof body.emaShort !== "undefined") next.emaShort = parseInt(body.emaShort, 10) || DEFAULT_CONFIG.emaShort;
  if (typeof body.emaLong !== "undefined") next.emaLong = parseInt(body.emaLong, 10) || DEFAULT_CONFIG.emaLong;
  if (typeof body.scanType !== "undefined") {
    const t = String(body.scanType);
    next.scanType = ["golden", "dead", "both"].includes(t) ? t : next.scanType;
  }
  if (typeof body.crossCooldownMinutes !== "undefined") {
    next.crossCooldownMinutes = Math.max(1, parseInt(body.crossCooldownMinutes, 10) || DEFAULT_CONFIG.crossCooldownMinutes);
  }
  await saveConfig(env, next);
  return new Response(JSON.stringify({ ok: true, config: next }), { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders() } });
}
__name(handlePostConfig, "handlePostConfig");
async function handleGetSymbols(env) {
  const list = await loadSymbols(env);
  return new Response(JSON.stringify({ ok: true, symbols: list }), { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders() } });
}
__name(handleGetSymbols, "handleGetSymbols");
async function handlePostSymbols(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ ok: false, error: "invalid_json" }), { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders() } });
  }
  let arr = Array.isArray(body) ? body : Array.isArray(body.symbols) ? body.symbols : [];
  arr = arr.map((s) => String(s).toUpperCase()).filter((s) => /USDT$/.test(s));
  if (!arr.length) return new Response(JSON.stringify({ ok: false, error: "empty_symbols" }), { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders() } });
  await saveSymbols(env, arr);
  return new Response(JSON.stringify({ ok: true, symbols: arr }), { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders() } });
}
__name(handlePostSymbols, "handlePostSymbols");
async function handleGetScanState(env) {
  const st = await loadState(env);
  return new Response(JSON.stringify({ ok: true, state: st }), { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders() } });
}
__name(handleGetScanState, "handleGetScanState");
async function handleScanNow(request, env) {
  let overrides = {};
  try {
    overrides = await request.json();
  } catch (e) {
    overrides = {};
  }
  const res = await runScanOnce(env, overrides);
  return new Response(JSON.stringify(res), { status: res.ok ? 200 : 500, headers: { "Content-Type": "application/json", ...corsHeaders() } });
}
__name(handleScanNow, "handleScanNow");
var workerExport = {
  async fetch(request, env) {
    const url = new URL(request.url);
    const pathname = url.pathname;
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }
    if ((pathname === "/" || pathname === "") && request.method === "GET") {
      return new Response(
        JSON.stringify({
          ok: true,
          version: "worker-routes-v2",
          routes: {
            health: "GET /health",
            price: "GET /price?symbol=BTCUSDT",
            sendAlert: "POST /send-alert",
            getConfig: "GET /config",
            postConfig: "POST /config",
            getSymbols: "GET /symbols",
            postSymbols: "POST /symbols",
            scanState: "GET /scan-state",
            scanNow: "POST /scan-now"
          }
        }),
        { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders() } }
      );
    }
    if (pathname === "/health" && request.method === "GET") return handleHealth(env);
    if (pathname === "/price" && request.method === "GET") return handlePrice(url);
    if (pathname === "/send-alert" && request.method === "POST") return handleSendAlert(request, env);
    if (pathname === "/config" && request.method === "GET") return handleGetConfig(env);
    if (pathname === "/config" && request.method === "POST") return handlePostConfig(request, env);
    if (pathname === "/symbols" && request.method === "GET") return handleGetSymbols(env);
    if (pathname === "/symbols" && request.method === "POST") return handlePostSymbols(request, env);
    if (pathname === "/scan-state" && request.method === "GET") return handleGetScanState(env);
    if (pathname === "/scan-now" && request.method === "POST") return handleScanNow(request, env);
    return new Response("not found", { status: 404, headers: corsHeaders() });
  },
  // Cloudflare Scheduled (cron) handler: 상시 스캔 수행
  async scheduled(controller, env, ctx) {
    const scanEnabled = String(env && env.SCAN_ENABLED || "").toLowerCase() === "true";
    if (!scanEnabled) return;
    if (!env.KV_SCAN) return;
    if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) return;
    const res = await runScanOnce(env);
    if (!res.ok) {
      try {
        console.log("scan failed", res);
      } catch (e) {
      }
    }
  }
};
var worker_default = workerExport;

// ../../../AppData/Roaming/npm/node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
var drainBody = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default = drainBody;

// ../../../AppData/Roaming/npm/node_modules/wrangler/templates/middleware/middleware-miniflare3-json-error.ts
function reduceError(e) {
  return {
    name: e?.name,
    message: e?.message ?? String(e),
    stack: e?.stack,
    cause: e?.cause === void 0 ? void 0 : reduceError(e.cause)
  };
}
__name(reduceError, "reduceError");
var jsonError = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } catch (e) {
    const error = reduceError(e);
    return Response.json(error, {
      status: 500,
      headers: { "MF-Experimental-Error-Stack": "true" }
    });
  }
}, "jsonError");
var middleware_miniflare3_json_error_default = jsonError;

// .wrangler/tmp/bundle-5XdF5D/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default,
  middleware_miniflare3_json_error_default
];
var middleware_insertion_facade_default = worker_default;

// ../../../AppData/Roaming/npm/node_modules/wrangler/templates/middleware/common.ts
var __facade_middleware__ = [];
function __facade_register__(...args) {
  __facade_middleware__.push(...args.flat());
}
__name(__facade_register__, "__facade_register__");
function __facade_invokeChain__(request, env, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env, ctx, middlewareCtx);
}
__name(__facade_invokeChain__, "__facade_invokeChain__");
function __facade_invoke__(request, env, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__(request, env, ctx, dispatch, [
    ...__facade_middleware__,
    finalMiddleware
  ]);
}
__name(__facade_invoke__, "__facade_invoke__");

// .wrangler/tmp/bundle-5XdF5D/middleware-loader.entry.ts
var __Facade_ScheduledController__ = class ___Facade_ScheduledController__ {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  static {
    __name(this, "__Facade_ScheduledController__");
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof ___Facade_ScheduledController__)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
function wrapExportedHandler(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name(function(request, env, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env, ctx) {
      const dispatcher = /* @__PURE__ */ __name(function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__(request, env, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler, "wrapExportedHandler");
function wrapWorkerEntrypoint(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  return class extends klass {
    #fetchDispatcher = /* @__PURE__ */ __name((request, env, ctx) => {
      this.env = env;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    }, "#fetchDispatcher");
    #dispatcher = /* @__PURE__ */ __name((type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    }, "#dispatcher");
    fetch(request) {
      return __facade_invoke__(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY;
if (typeof middleware_insertion_facade_default === "object") {
  WRAPPED_ENTRY = wrapExportedHandler(middleware_insertion_facade_default);
} else if (typeof middleware_insertion_facade_default === "function") {
  WRAPPED_ENTRY = wrapWorkerEntrypoint(middleware_insertion_facade_default);
}
var middleware_loader_entry_default = WRAPPED_ENTRY;
export {
  __INTERNAL_WRANGLER_MIDDLEWARE__,
  middleware_loader_entry_default as default
};
//# sourceMappingURL=worker.js.map
