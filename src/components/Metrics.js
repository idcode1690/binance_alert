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

  // Fetch the last 1d candle for the active symbol to determine daily direction
  useEffect(() => {
    let mounted = true;
    async function fetchDaily() {
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
        // Use the last closed daily candle (last element)
        const last = data[data.length - 1];
        const open = parseFloat(last[1]);
        const close = parseFloat(last[4]);
        if (Number.isFinite(open) && Number.isFinite(close)) {
          if (mounted) setDailyDirection(close > open ? 'bull' : (close < open ? 'bear' : 'neutral'));
        }
      } catch (e) {
        // ignore fetch errors
      }
    }
    fetchDaily();
    // refresh daily direction every 5 minutes while the component is mounted
    const t = setInterval(fetchDaily, 5 * 60 * 1000);
    return () => { mounted = false; clearInterval(t); };
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
