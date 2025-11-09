// Cloudflare Worker entrypoint bundling previous Pages Functions logic.
// Provides: GET /health, GET /price?symbol=BTCUSDT, POST /send-alert (Telegram relay)
// Assumes environment variables TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID.
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
      return new Response(JSON.stringify({ ok: false, error: 'telegram_api_failed', detail: result }), {
        status: 502,
        headers: { 'Content-Type': 'application/json', ...corsHeaders() },
      });
    }
    return new Response(JSON.stringify({ ok: true, sent: text, telegram: result }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...corsHeaders() },
    });
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: 'telegram_exception', detail: String(err) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...corsHeaders() },
    });
  }
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
          routes: {
            health: 'GET /health',
            price: 'GET /price?symbol=BTCUSDT',
            sendAlert: 'POST /send-alert',
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json', ...corsHeaders() } }
      );
    }

    if (pathname === '/health' && request.method === 'GET') return handleHealth(env);
    if (pathname === '/price' && request.method === 'GET') return handlePrice(url);
    if (pathname === '/send-alert' && request.method === 'POST') return handleSendAlert(request, env);

    return new Response('not found', { status: 404, headers: corsHeaders() });
  }
};

export default workerExport;
