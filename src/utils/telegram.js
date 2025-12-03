const WORKER_URL = (process.env.WORKER_URL || '').replace(/\/$/, '');
function resolveEndpoint() {
  if (WORKER_URL) return `${WORKER_URL}/send-alert`;
  return '/api/send-alert';
}

export async function sendTelegramMessage({ chatId, text }) {
  const endpoint = resolveEndpoint();
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chatId, text }),
  });
  if (!res.ok) {
    const msg = await res.text();
    throw new Error(`Send failed: ${res.status} ${msg}`);
  }
  return res.json();
}
