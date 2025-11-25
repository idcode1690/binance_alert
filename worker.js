// Cloudflare Worker entrypoint
// Provides:
//  - GET /health
//  - GET /price?symbol=BTCUSDT
//  - POST /send-alert (Telegram relay)
//  - GET /config, POST /config (서버측 스캔 설정: interval, emaShort, emaLong, scanType)
//  - GET /symbols, POST /symbols (스캔 심볼 관리)
//  - GET /scan-state (최근 매칭/상태 조회)
// 또한 Scheduled Cron(Worker Triggers)으로 백그라운드에서 상시 스캔하고 텔레그램 발송
// 필요 환경변수: TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID
// KV 바인딩: KV_SCAN (설정/상태 저장용)
// CORS: allow cross-origin from any for simplicity (can restrict later).

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  };
}

async function handleHealth(env) {
  const telegramConfigured = !!(env && env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID);
  return new Response(JSON.stringify({ ok: true, worker: true, telegramConfigured, time: Date.now() }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() },
  });
}

async function handlePrice(url) {
  const symbol = (url.searchParams.get('symbol') || 'BTCUSDT').toUpperCase();
  try {
    const apiUrl = `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=1m&limit=2`;
    const resp = await fetch(apiUrl, { cf: { cacheTtl: 0 } });
    if (!resp.ok) {
      return new Response(JSON.stringify({ ok: false, error: 'binance_fetch_failed', status: resp.status }), {
        status: 502,
        headers: { 'Content-Type': 'application/json', ...corsHeaders() },
      });
    }
    const data = await resp.json();
    const closes = Array.isArray(data) ? data.map(k => parseFloat(k[4])) : [];
    const price = closes.length ? closes[closes.length - 1] : null;
    return new Response(JSON.stringify({ ok: true, symbol, price }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=5', ...corsHeaders() },
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: 'price_fetch_exception', detail: String(e) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...corsHeaders() },
    });
  }
}

async function handleSendAlert(request, env) {
  try {
    const botToken = env && env.TELEGRAM_BOT_TOKEN ? String(env.TELEGRAM_BOT_TOKEN) : '';
    const chatId = env && env.TELEGRAM_CHAT_ID ? String(env.TELEGRAM_CHAT_ID) : '';
    if (!botToken || !chatId) {
      return new Response(JSON.stringify({ ok: false, error: 'telegram_not_configured' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...corsHeaders() },
      });
    }
    let bodyJson;
    try { bodyJson = await request.json(); } catch (e) {
      return new Response(JSON.stringify({ ok: false, error: 'invalid_json' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...corsHeaders() },
      });
    }
    const symbol = (bodyJson.symbol || '').toString().toUpperCase();
    const price = typeof bodyJson.price !== 'undefined' ? bodyJson.price : '';
    const emaShort = bodyJson.emaShort || '';
    const emaLong = bodyJson.emaLong || '';
    const tag = emaShort && emaLong ? `EMA${emaShort}/${emaLong}` : 'EMA';
    const msgBase = bodyJson.message || 'Alert';
    const text = [symbol, msgBase, price ? `@ ${price}` : '', tag].filter(Boolean).join(' ');

    const tgResp = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text }),
    });
    const result = await tgResp.json().catch(() => null);
    if (!tgResp.ok) {
      return new Response(JSON.stringify({ ok: false, error: 'telegram_api_failed', status: tgResp.status, detail: result, hint: 'Check TELEGRAM_BOT_TOKEN/CHAT_ID and that the bot has access to the chat. Try /health.' }), {
        status: 502,
        headers: { 'Content-Type': 'application/json', ...corsHeaders() },
      });
    }
    return new Response(JSON.stringify({ ok: true, sent: text, telegram: result }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...corsHeaders() },
    });
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: 'telegram_exception', detail: String(err), hint: 'Network blocked or invalid token/chat id. Validate with Telegram test in UI.' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...corsHeaders() },
    });
  }
}

// ====== Server-side scanner config/state via KV ======
const DEFAULT_CONFIG = { interval: '5m', emaShort: 26, emaLong: 200, scanType: 'golden', crossCooldownMinutes: 30 }; // scanType: 'golden' | 'dead' | 'both'
const DEFAULT_SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT'];

async function kvGetJson(kv, key, fallback = null) {
  if (!kv) return fallback;
  try { const v = await kv.get(key); if (!v) return fallback; return JSON.parse(v); } catch { return fallback; }
}
async function kvPutJson(kv, key, obj) {
  if (!kv) return; try { await kv.put(key, JSON.stringify(obj)); } catch {}
}

async function loadConfig(env) {
  const stored = await kvGetJson(env.KV_SCAN, 'config', {});
  const cfg = { ...DEFAULT_CONFIG, ...(stored || {}) };
  // normalize
  if (typeof cfg.interval === 'number' || /^\d+$/.test(String(cfg.interval || ''))) cfg.interval = `${cfg.interval}m`;
  cfg.emaShort = parseInt(cfg.emaShort, 10) || DEFAULT_CONFIG.emaShort;
  cfg.emaLong = parseInt(cfg.emaLong, 10) || DEFAULT_CONFIG.emaLong;
  if (!['golden', 'dead', 'both'].includes(cfg.scanType)) cfg.scanType = DEFAULT_CONFIG.scanType;
  cfg.crossCooldownMinutes = Math.max(1, parseInt(cfg.crossCooldownMinutes, 10) || DEFAULT_CONFIG.crossCooldownMinutes);
  return cfg;
}
async function saveConfig(env, cfg) { return kvPutJson(env.KV_SCAN, 'config', cfg); }

async function loadSymbols(env) {
  const arr = await kvGetJson(env.KV_SCAN, 'symbols', DEFAULT_SYMBOLS);
  if (!Array.isArray(arr) || !arr.length) return DEFAULT_SYMBOLS;
  return arr.map(s => String(s).toUpperCase()).filter(s => /USDT$/.test(s));
}
async function saveSymbols(env, symbols) { return kvPutJson(env.KV_SCAN, 'symbols', symbols); }

async function loadState(env) {
  const st = await kvGetJson(env.KV_SCAN, 'state', { lastRun: 0, lastError: null, matches: [] });
  if (!st || typeof st !== 'object') return { lastRun: 0, lastError: null, matches: [] };
  if (!Array.isArray(st.matches)) st.matches = [];
  return st;
}
async function saveState(env, st) { return kvPutJson(env.KV_SCAN, 'state', st); }

// 최근 교차 중복 방지용 (심볼/타입 별 최근 교차시각 기록)
async function loadLastCross(env) { return kvGetJson(env.KV_SCAN, 'lastCross', {}); }
async function saveLastCross(env, map) { return kvPutJson(env.KV_SCAN, 'lastCross', map); }

function calculateEma(values, period) {
  if (!Array.isArray(values) || values.length === 0) return [];
  const k = 2 / (period + 1); const out = []; let ema = null;
  for (let i = 0; i < values.length; i++) {
    const v = Number(values[i]); if (isNaN(v)) { out.push(null); continue; }
    if (ema === null) { if (i + 1 >= period) { const slice = values.slice(i + 1 - period, i + 1).map(Number); ema = slice.reduce((a,b)=>a+b,0)/period; out.push(ema); } else { out.push(null); } }
    else { ema = v * k + ema * (1 - k); out.push(ema); }
  }
  return out;
}

function crossed(type, prevShort, prevLong, lastShort, lastLong) {
  if ([prevShort, prevLong, lastShort, lastLong].some(v => typeof v !== 'number')) return false;
  if (type === 'golden') return prevShort <= prevLong && lastShort > lastLong;
  if (type === 'dead') return prevShort >= prevLong && lastShort < lastLong;
  return false;
}

async function sendTelegram(env, text) {
  const botToken = env && env.TELEGRAM_BOT_TOKEN ? String(env.TELEGRAM_BOT_TOKEN) : '';
  const chatId = env && env.TELEGRAM_CHAT_ID ? String(env.TELEGRAM_CHAT_ID) : '';
  if (!botToken || !chatId) return { ok: false, error: 'telegram_not_configured' };
  const r = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: chatId, text })
  });
  const j = await r.json().catch(() => null);
  return r.ok ? { ok: true, result: j } : { ok: false, error: 'telegram_api_failed', detail: j };
}

async function runScanOnce(env, overrides = {}) {
  // Load stored config and merge overrides (overrides come from client form / API)
  const storedCfg = await loadConfig(env);
  const cfg = { ...storedCfg, ...(overrides || {}) };
  // Normalize interval override if provided (allow numeric minutes)
  if (typeof overrides.interval !== 'undefined') {
    let v = overrides.interval;
    if (typeof v === 'number' || /^\d+$/.test(String(v))) v = `${v}m`;
    cfg.interval = String(v);
  }
  // Ensure EMA values are integers
  if (typeof overrides.emaShort !== 'undefined') cfg.emaShort = parseInt(overrides.emaShort, 10) || cfg.emaShort;
  if (typeof overrides.emaLong !== 'undefined') cfg.emaLong = parseInt(overrides.emaLong, 10) || cfg.emaLong;
  if (typeof overrides.scanType !== 'undefined') {
    const t = String(overrides.scanType);
    cfg.scanType = ['golden', 'dead', 'both'].includes(t) ? t : cfg.scanType;
  }

  const symbols = await loadSymbols(env);
  const state = await loadState(env);
  const lastMap = await loadLastCross(env);
  const endpointBase = 'https://fapi.binance.com/fapi/v1/klines';
  const interval = cfg.interval;
  const emaShort = parseInt(cfg.emaShort, 10);
  const emaLong = parseInt(cfg.emaLong, 10);
  const needed = Math.max(emaShort, emaLong) + 10;
  const limit = Math.min(1000, Math.max(needed + 10, 120));
  const concurrency = 8; // conservative
  const cooldownMs = Math.max(1, parseInt(cfg.crossCooldownMinutes, 10) || DEFAULT_CONFIG.crossCooldownMinutes) * 60 * 1000;

  let idx = 0; const matches = [];
  const startTime = Date.now(); let scannedCount = 0;
  async function processSymbol(sym) {
    const url = `${endpointBase}?symbol=${encodeURIComponent(sym)}&interval=${encodeURIComponent(interval)}&limit=${limit}`;
    const resp = await fetch(url, { cf: { cacheTtl: 0 } });
    if (!resp.ok) return;
    const data = await resp.json();
    const closes = Array.isArray(data) ? data.map(d => parseFloat(d[4])) : [];
    if (!closes.length || closes.length < needed) return;
    const emaS = calculateEma(closes, emaShort); const emaL = calculateEma(closes, emaLong);
    const lastIdx = closes.length - 1; const prevIdx = lastIdx - 1;
    const prevShort = emaS[prevIdx]; const prevLong = emaL[prevIdx];
    const lastShort = emaS[lastIdx]; const lastLong = emaL[lastIdx];
    const now = Date.now();
    const typesToCheck = cfg.scanType === 'both' ? ['golden','dead'] : [cfg.scanType];
    for (const t of typesToCheck) {
      if (crossed(t, prevShort, prevLong, lastShort, lastLong)) {
        const key = `${sym}:${t}`;
        const lastTs = lastMap[key] || 0;
        // cooldown guard
        if (now - lastTs < cooldownMs) continue;
        const msg = (t === 'golden' ? '[골든]' : '[데드]') + ` ${sym} ${interval} EMA${emaShort}/${emaLong} @ ${new Date().toLocaleString('ko-KR')}`;
        const sent = await sendTelegram(env, msg);
        if (sent && sent.ok) { lastMap[key] = now; }
        matches.push({ symbol: sym, type: t, interval, emaShort, emaLong, time: new Date().toISOString() });
      }
    }
  }
  try {
    while (idx < symbols.length) {
      const batch = symbols.slice(idx, idx + concurrency);
      await Promise.all(batch.map(s => processSymbol(s)));
      idx += batch.length;
      scannedCount += batch.length;
      if (idx < symbols.length) await new Promise(r => setTimeout(r, 150));
    }
    state.lastRun = Date.now(); state.lastError = null;
    state.matches = Array.isArray(state.matches) ? [...matches, ...state.matches].slice(0, 200) : matches.slice(0, 200);
    state.lastScanDuration = Date.now() - startTime;
    state.scannedCount = scannedCount;
    state.newMatches = matches.length;
    await saveState(env, state);
    await saveLastCross(env, lastMap);
    return { ok: true, count: matches.length };
  } catch (err) {
    state.lastRun = Date.now(); state.lastError = String(err);
    state.lastScanDuration = Date.now() - startTime;
    state.scannedCount = scannedCount;
    state.newMatches = matches.length;
    await saveState(env, state);
    return { ok: false, error: 'scan_exception', detail: String(err) };
  }
}

async function handleGetConfig(env) { const cfg = await loadConfig(env); return new Response(JSON.stringify({ ok: true, config: cfg }), { status: 200, headers: { 'Content-Type': 'application/json', ...corsHeaders() } }); }
async function handlePostConfig(request, env) {
  let body; try { body = await request.json(); } catch { return new Response(JSON.stringify({ ok: false, error: 'invalid_json' }), { status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders() } }); }
  const next = await loadConfig(env);
  if (typeof body.interval !== 'undefined') { let v = body.interval; if (typeof v === 'number' || /^\d+$/.test(String(v))) v = `${v}m`; next.interval = String(v); }
  if (typeof body.emaShort !== 'undefined') next.emaShort = parseInt(body.emaShort, 10) || DEFAULT_CONFIG.emaShort;
  if (typeof body.emaLong !== 'undefined') next.emaLong = parseInt(body.emaLong, 10) || DEFAULT_CONFIG.emaLong;
  if (typeof body.scanType !== 'undefined') { const t = String(body.scanType); next.scanType = ['golden','dead','both'].includes(t) ? t : next.scanType; }
  if (typeof body.crossCooldownMinutes !== 'undefined') {
    next.crossCooldownMinutes = Math.max(1, parseInt(body.crossCooldownMinutes, 10) || DEFAULT_CONFIG.crossCooldownMinutes);
  }
  await saveConfig(env, next);
  return new Response(JSON.stringify({ ok: true, config: next }), { status: 200, headers: { 'Content-Type': 'application/json', ...corsHeaders() } });
}

async function handleGetSymbols(env) { const list = await loadSymbols(env); return new Response(JSON.stringify({ ok: true, symbols: list }), { status: 200, headers: { 'Content-Type': 'application/json', ...corsHeaders() } }); }
async function handlePostSymbols(request, env) {
  let body; try { body = await request.json(); } catch { return new Response(JSON.stringify({ ok: false, error: 'invalid_json' }), { status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders() } }); }
  let arr = Array.isArray(body) ? body : (Array.isArray(body.symbols) ? body.symbols : []);
  arr = arr.map(s => String(s).toUpperCase()).filter(s => /USDT$/.test(s));
  if (!arr.length) return new Response(JSON.stringify({ ok: false, error: 'empty_symbols' }), { status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders() } });
  await saveSymbols(env, arr);
  return new Response(JSON.stringify({ ok: true, symbols: arr }), { status: 200, headers: { 'Content-Type': 'application/json', ...corsHeaders() } });
}

async function handleGetScanState(env) { const st = await loadState(env); return new Response(JSON.stringify({ ok: true, state: st }), { status: 200, headers: { 'Content-Type': 'application/json', ...corsHeaders() } }); }
async function handleScanNow(request, env) {
  let overrides = {};
  try { overrides = await request.json(); } catch (e) { overrides = {}; }
  const res = await runScanOnce(env, overrides);
  return new Response(JSON.stringify(res), { status: res.ok ? 200 : 500, headers: { 'Content-Type': 'application/json', ...corsHeaders() } });
}

const workerExport = {
  async fetch(request, env) {
    const url = new URL(request.url);
    const pathname = url.pathname;

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    if ((pathname === '/' || pathname === '') && request.method === 'GET') {
      return new Response(
        JSON.stringify({
          ok: true,
          version: 'worker-routes-v2',
          routes: {
            health: 'GET /health',
            price: 'GET /price?symbol=BTCUSDT',
            sendAlert: 'POST /send-alert',
            getConfig: 'GET /config',
            postConfig: 'POST /config',
            getSymbols: 'GET /symbols',
            postSymbols: 'POST /symbols',
            scanState: 'GET /scan-state',
            scanNow: 'POST /scan-now'
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json', ...corsHeaders() } }
      );
    }

    if (pathname === '/health' && request.method === 'GET') return handleHealth(env);
    if (pathname === '/price' && request.method === 'GET') return handlePrice(url);
    if (pathname === '/send-alert' && request.method === 'POST') return handleSendAlert(request, env);
    if (pathname === '/config' && request.method === 'GET') return handleGetConfig(env);
    if (pathname === '/config' && request.method === 'POST') return handlePostConfig(request, env);
    if (pathname === '/symbols' && request.method === 'GET') return handleGetSymbols(env);
    if (pathname === '/symbols' && request.method === 'POST') return handlePostSymbols(request, env);
  if (pathname === '/scan-state' && request.method === 'GET') return handleGetScanState(env);
  if (pathname === '/scan-now' && request.method === 'POST') return handleScanNow(request, env);

    return new Response('not found', { status: 404, headers: corsHeaders() });
  },
  // Cloudflare Scheduled (cron) handler: 상시 스캔 수행
  async scheduled(controller, env, ctx) {
    // 간단 보호: 텔레그램 미설정 시 스킵
    if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) return;
    const res = await runScanOnce(env);
    // 선택적으로 로깅
    if (!res.ok) { /* eslint-disable no-console */ try { console.log('scan failed', res); } catch (e) {} }
  }
};

export default workerExport;
