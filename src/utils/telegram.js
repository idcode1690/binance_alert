function getRuntimeWorkerUrl() {
  try {
    const w = typeof window !== 'undefined' ? window : undefined;
    const envUrl = (w && w.process && w.process.env && w.process.env.WORKER_URL) || (w && w.WORKER_URL) || '';
    return (envUrl || '').toString().replace(/\/$/, '');
  } catch (e) {
    return '';
  }
}

function resolveEndpoint() {
  const runtime = getRuntimeWorkerUrl();
  if (runtime) return `${runtime}/send-alert`;
  const env = (process && process.env && process.env.WORKER_URL) ? process.env.WORKER_URL.replace(/\/$/, '') : '';
  if (env) return `${env}/send-alert`;
  // Default to deployed Cloudflare Worker when no env/runtime override is present.
  // This ensures GitHub Pages can send alerts without same-origin proxy.
  return 'https://binance-alert.idcode1690.workers.dev/send-alert';
}

export async function sendTelegramMessage({ chatId, message, text, image, confirmed = true, extra = {} } = {}) {
  const endpoint = resolveEndpoint();
  console.log('Sending Telegram via endpoint:', endpoint);
  const payload = { chatId, confirmed, ...extra };
  // Normalize: prefer explicit message; fall back to text
  if (typeof message === 'string' && message.trim()) {
    payload.message = message.trim();
  } else if (typeof text === 'string' && text.trim()) {
    payload.message = text.trim();
  }
  if (typeof image === 'string' && image.length > 32) {
    payload.image = image;
  }
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const msg = await res.text();
    throw new Error(`Send failed: ${res.status} ${msg}`);
  }
  return res.json();
}
