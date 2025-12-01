import React, { useEffect, useState } from 'react';

function formatNumberForDisplay(v) {
  if (typeof v !== 'number' || Number.isNaN(v)) return '—';
  // show more precision for small-price assets
  if (Math.abs(v) < 1) return v.toFixed(6);
  if (Math.abs(v) < 100) return v.toFixed(4);
  return v.toFixed(2);
}

export default function Metrics({ activeSymbol, symbol, lastPrice, lastTick, lastCandleClosed, cross, confirmedCross, ema9, ema26, monitorEma1 = 9, monitorEma2 = 26 }) {
  const displayPrice = (activeSymbol === symbol)
    ? (typeof lastTick !== 'undefined' && lastTick !== null ? formatNumberForDisplay(lastTick) : (lastPrice != null ? formatNumberForDisplay(lastPrice) : '—'))
    : '—';

  // dailyDirection: 'bull' | 'bear' | null
  const [dailyDirection, setDailyDirection] = useState(null);

  // Use Binance futures websocket kline stream for 1d to update daily direction in real-time.
  // We still seed once via REST on mount to avoid visual delay while the socket connects.
  useEffect(() => {
    let mounted = true;
    let ws = null;

    async function fetchDailyOnce() {
      try {
        if (!symbol || activeSymbol !== symbol) {
          if (mounted) setDailyDirection(null);
          return;
        }
        const sym = (symbol || '').toString().replace(/[^A-Za-z0-9]/g, '').toUpperCase();
        if (!sym) return;
        const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${sym}&interval=1d&limit=2`;
        const res = await fetch(url);
        if (!res.ok) return;
        const data = await res.json();
        if (!Array.isArray(data) || data.length === 0) return;
        const last = data[data.length - 1];
        const open = parseFloat(last[1]);
        const close = parseFloat(last[4]);
        if (Number.isFinite(open) && Number.isFinite(close)) {
          if (mounted) setDailyDirection(close > open ? 'bull' : (close < open ? 'bear' : 'neutral'));
        }
      } catch (e) {
        // ignore
      }
    }

    // Only operate when this Metrics instance is for the currently-active symbol
    if (!symbol || activeSymbol !== symbol) {
      setDailyDirection(null);
      return () => { mounted = false; };
    }

    // seed current state once
    fetchDailyOnce();

    try {
      const stream = `${(symbol || '').toString().replace(/[^A-Za-z0-9]/g, '').toLowerCase()}@kline_1d`;
      const url = `wss://fstream.binance.com/ws/${stream}`;
      ws = new WebSocket(url);
      ws.onmessage = (ev) => {
        try {
          const payload = JSON.parse(ev.data);
          // payload may be { e: 'kline', k: {...} } or { stream, data }
          const k = payload.k || (payload.data && payload.data.k) || null;
          if (!k) return;
          const o = parseFloat(k.o);
          const c = parseFloat(k.c);
          if (!Number.isFinite(o) || !Number.isFinite(c)) return;
          if (mounted) setDailyDirection(c > o ? 'bull' : (c < o ? 'bear' : 'neutral'));
        } catch (e) {
          // ignore parse errors
        }
      };
      ws.onerror = () => {};
      ws.onclose = () => {};
    } catch (e) {
      // ignore websocket init errors; we already seeded via REST
    }

    return () => { mounted = false; try { if (ws) ws.close(); } catch (e) {} };
  }, [symbol, activeSymbol]);

  // sanity-check EMA mapping: ensure provided monitorEma1 < monitorEma2 (short < long)
  useEffect(() => {
    try {
      if (monitorEma1 >= monitorEma2) {
        // eslint-disable-next-line no-console
        console.warn('[Metrics] monitorEma1 should be the shorter EMA and monitorEma2 the longer EMA. Current values:', monitorEma1, monitorEma2);
      }
      // If the project hardcodes ema9/ema26 but monitorEma props are swapped, warn
      if ((monitorEma1 === 26 && monitorEma2 === 9)) {
        // eslint-disable-next-line no-console
        console.warn('[Metrics] Detected monitor EMA props in reverse order (26/9). Ensure EMA1=short and EMA2=long.');
      }
    } catch (e) {}
  }, [monitorEma1, monitorEma2]);

  const liveBadgeClass = lastCandleClosed ? 'badge closed' : `badge open ${dailyDirection === 'bull' ? 'live-bull' : (dailyDirection === 'bear' ? 'live-bear' : '')}`;

  return (
    <div className="metrics">
      <div className="metric">
        <div className="metric-label">
          <span>Last price</span>
          {activeSymbol === symbol ? (
            lastCandleClosed ? (
              <span className="badge closed">CLOSED</span>
            ) : (
              <span className={liveBadgeClass}>LIVE</span>
            )
          ) : null}
        </div>
          <div className="last" style={{display: 'flex', alignItems: 'center', justifyContent: 'flex-end'}}>
            <div style={{textAlign: 'right', marginRight: '8px'}}>
              <div className="last-label">Last</div>
              <div className="last-value">{displayPrice}</div>
            </div>
            {dailyDirection && (
              <div className={`daily-candle ${dailyDirection}`} title={dailyDirection === 'bull' ? '일봉 상승' : dailyDirection === 'bear' ? '일봉 하락' : '일봉 변동 없음'}>
                <div className="wick" />
                <div className="body" />
              </div>
            )}
          </div>
      </div>
      <div className="metric"><div className="metric-label">Cross (confirmed)</div><div>{activeSymbol === symbol ? (confirmedCross ?? '—') : '—'}</div></div>
      <div className="metric"><div className="metric-label">{`EMA${monitorEma1}`}</div><div>{activeSymbol === symbol && ema9 ? formatNumberForDisplay(ema9) : '—'}</div></div>
      <div className="metric"><div className="metric-label">{`EMA${monitorEma2}`}</div><div>{activeSymbol === symbol && ema26 ? formatNumberForDisplay(ema26) : '—'}</div></div>
    </div>
  );
}
