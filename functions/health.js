export const onRequestGet = async (context) => {
  try {
    const { env } = context;
    const telegramConfigured = !!(env && env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID);
    return new Response(
      JSON.stringify({ ok: true, pages: true, telegramConfigured, time: Date.now() }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      }
    );
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }
};
