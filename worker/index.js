addEventListener('fetch', event => {
  event.respondWith(handle(event.request, event));
});

async function handle(req, event) {
  const url = new URL(req.url);
  // allow a simple health check
  if (req.method === 'GET' && url.pathname === '/health') {
    return new Response(JSON.stringify({ ok: true, worker: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }

  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const body = await req.json();
    const botToken = TELEGRAM_BOT_TOKEN || (typeof TW_TELEGRAM_BOT_TOKEN !== 'undefined' && TW_TELEGRAM_BOT_TOKEN) || '';
    const chatId = TELEGRAM_CHAT_ID || (typeof TW_TELEGRAM_CHAT_ID !== 'undefined' && TW_TELEGRAM_CHAT_ID) || '';
    if (!botToken || !chatId) {
      return new Response(JSON.stringify({ ok: false, error: 'Telegram not configured' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    const text = `${body.symbol || ''} ${body.message || 'Alert'} @ ${body.price || ''}`;

    const tgRes = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text }),
    });

    const result = await tgRes.json().catch(() => null);
    if (!tgRes.ok) {
      return new Response(JSON.stringify({ ok: false, error: 'Telegram API failed', detail: result }), { status: 502, headers: { 'Content-Type': 'application/json' } });
    }

    return new Response(JSON.stringify({ ok: true, result }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: String(err) }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
