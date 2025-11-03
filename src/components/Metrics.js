import React from 'react';

export default function Metrics({ activeSymbol, symbol, lastPrice, lastCandleClosed, cross, confirmedCross, ema9, ema26 }) {
  return (
    <div className="metrics">
      <div className="metric">
        <div className="metric-label">
          <span>Last price</span>
          {activeSymbol === symbol ? (
            lastCandleClosed ? (
              <span className="badge closed">CLOSED</span>
            ) : (
              <span className="badge open">LIVE</span>
            )
          ) : null}
        </div>
        <div>{activeSymbol === symbol ? (lastPrice ?? '—') : '—'}</div>
      </div>
      <div className="metric"><div className="metric-label">Cross (live)</div><div>{activeSymbol === symbol ? (cross ?? '—') : '—'}</div></div>
      <div className="metric"><div className="metric-label">Cross (confirmed)</div><div>{activeSymbol === symbol ? (confirmedCross ?? '—') : '—'}</div></div>
      <div className="metric"><div className="metric-label">EMA9</div><div>{activeSymbol === symbol && ema9 ? ema9.toFixed(4) : '—'}</div></div>
      <div className="metric"><div className="metric-label">EMA26</div><div>{activeSymbol === symbol && ema26 ? ema26.toFixed(4) : '—'}</div></div>
    </div>
  );
}
