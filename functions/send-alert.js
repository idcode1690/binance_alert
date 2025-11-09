export const onRequestPost = async (context) => {
  const { request, env } = context;
  // CORS preflight handled by Pages automatically for same-origin; add header for cross-origin local tests
  try {
    let body;
    try { body = await request.json(); } catch (e) {
      return new Response(JSON.stringify({ ok: false, error: 'invalid_json' }), { status: 400, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
    }
    const botToken = env && env.TELEGRAM_BOT_TOKEN ? String(env.TELEGRAM_BOT_TOKEN) : '';
    const chatId = env && env.TELEGRAM_CHAT_ID ? String(env.TELEGRAM_CHAT_ID) : '';
    if (!botToken || !chatId) {
      return new Response(JSON.stringify({ ok: false, error: 'telegram_not_configured' }), { status: 400, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' } });
    }
    const symbol = (body.symbol || '').toString().toUpperCase();
    const price = typeof body.price !== 'undefined' ? body.price : '';
    const emaShort = body.emaShort || '';
    const emaLong = body.emaLong || '';
    const tag = emaShort && emaLong ? `EMA${emaShort}/${emaLong}` : 'EMA';
    const msgBase = body.message || 'Alert';
    const text = [symbol, msgBase, price ? `@ ${price}` : '', tag].filter(Boolean).join(' ');

    const tg = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text }),
    });
    const result = await tg.json().catch(() => null);
    if (!tg.ok) return new Response(JSON.stringify({ ok: false, error: 'telegram_api_failed', detail: result }), { status: 502, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' } });
    return new Response(JSON.stringify({ ok: true, sent: text, telegram: result }), { status: 200, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' } });
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: 'telegram_exception', detail: String(err) }), { status: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' } });
  }
};

// Explicit CORS preflight support for cross-origin POST from GitHub Pages
export const onRequestOptions = async () => {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Vary': 'Origin',
    },
  });
};
