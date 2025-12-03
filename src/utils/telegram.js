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
  return '/api/send-alert';
}

export async function sendTelegramMessage({ chatId, text }) {
  const endpoint = resolveEndpoint();
  console.log('Sending Telegram via endpoint:', endpoint);
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
