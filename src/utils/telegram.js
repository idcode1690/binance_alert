export async function sendTelegramMessage({ chatId, text }) {
  const res = await fetch('/api/send-alert', {
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
