/* eslint-disable no-restricted-globals */
/* global globalThis */
// Cloudflare Worker: lightweight alert relay + health + price fetch cache.
// Endpoints:
//   GET /health              -> { ok, worker, time }
//   GET /price?symbol=BTCUSDT -> { ok, symbol, price }
//   POST /send-alert         -> forwards a message to Telegram (requires secrets)
// CORS: permissive for demo (adjust origins for production).

addEventListener('fetch', (event) => {
  event.respondWith(handle(event.request));
});

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      ...extraHeaders,
    },
  });
}

async function handle(request) {
  const { method } = request;
  const url = new URL(request.url);

  // Preflight CORS
  if (method === 'OPTIONS') {
    return new Response('', {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Max-Age': '86400',
      },
    });
  }

  // Health endpoint
  if (method === 'GET' && url.pathname === '/health') {
    return json({ ok: true, worker: true, time: Date.now() });
  }

  // Simple price fetch with edge cache (Binance Futures last close)
  if (method === 'GET' && url.pathname === '/price') {
    const symbol = (url.searchParams.get('symbol') || 'BTCUSDT').toUpperCase();
    const cacheKey = new Request(`https://cache.internal/price?symbol=${symbol}`);
    const cache = caches.default;
    let cached = await cache.match(cacheKey);
    if (cached) {
      return cached;
    }
    try {
      const apiUrl = `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=1m&limit=2`;
      const resp = await fetch(apiUrl, { cf: { cacheTtl: 0 } });
      if (!resp.ok) return json({ ok: false, error: 'binance_fetch_failed', status: resp.status }, 502);
      const data = await resp.json();
      const closes = Array.isArray(data) ? data.map((k) => parseFloat(k[4])) : [];
      const price = closes.length ? closes[closes.length - 1] : null;
      const out = json({ ok: true, symbol, price });
      // Cache for short period (5s) to reduce upstream hits
      const cacheable = new Response(await out.text(), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'public, max-age=5',
        },
      });
      eventWait(cache.put(cacheKey, cacheable));
      return cacheable;
    } catch (e) {
      return json({ ok: false, error: 'price_fetch_exception', detail: String(e) }, 500);
    }
  }

  // Alert relay
  if (method === 'POST' && url.pathname === '/send-alert') {
    let body;
    try { body = await request.json(); } catch (e) {
      return json({ ok: false, error: 'invalid_json' }, 400);
    }
    const botToken = (globalThis && globalThis.TELEGRAM_BOT_TOKEN) ? String(globalThis.TELEGRAM_BOT_TOKEN) : '';
    const chatId = (globalThis && globalThis.TELEGRAM_CHAT_ID) ? String(globalThis.TELEGRAM_CHAT_ID) : '';
    if (!botToken || !chatId) {
      return json({ ok: false, error: 'telegram_not_configured' }, 400);
    }
    const symbol = (body.symbol || '').toString().toUpperCase();
    const price = typeof body.price !== 'undefined' ? body.price : '';
    const emaShort = body.emaShort || '';
    const emaLong = body.emaLong || '';
    const tag = emaShort && emaLong ? `EMA${emaShort}/${emaLong}` : 'EMA';
    const msgBase = body.message || 'Alert';
    const text = [symbol, msgBase, price ? `@ ${price}` : '', tag].filter(Boolean).join(' ');
    try {
      const tg = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text }),
      });
      const result = await tg.json().catch(() => null);
      if (!tg.ok) return json({ ok: false, error: 'telegram_api_failed', detail: result }, 502);
      return json({ ok: true, sent: text, telegram: result });
    } catch (err) {
      return json({ ok: false, error: 'telegram_exception', detail: String(err) }, 500);
    }
  }

  // Fallback
  if (method === 'GET' && url.pathname === '/') {
    return new Response('binance-alert-worker', {
      status: 200,
      headers: { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' },
    });
  }

  return json({ ok: false, error: 'not_found' }, 404);
}

// Helper to wait for async side-effects without blocking response creation
function eventWait(promise) {
  try { if (typeof event !== 'undefined' && event && event.waitUntil) event.waitUntil(promise); } catch (e) {}
}

