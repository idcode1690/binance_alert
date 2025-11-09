export const onRequestGet = async ({ request }) => {
  const url = new URL(request.url);
  const symbol = (url.searchParams.get('symbol') || 'BTCUSDT').toUpperCase();
  try {
    const apiUrl = `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=1m&limit=2`;
    const resp = await fetch(apiUrl, { cf: { cacheTtl: 0 } });
    if (!resp.ok) return new Response(JSON.stringify({ ok: false, error: 'binance_fetch_failed', status: resp.status }), { status: 502, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
    const data = await resp.json();
    const closes = Array.isArray(data) ? data.map((k) => parseFloat(k[4])) : [];
    const price = closes.length ? closes[closes.length - 1] : null;
    return new Response(JSON.stringify({ ok: true, symbol, price }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=5',
      },
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: 'price_fetch_exception', detail: String(e) }), { status: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
  }
};
