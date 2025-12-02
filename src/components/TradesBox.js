/* eslint-disable react-hooks/exhaustive-deps */
/* eslint-disable no-unused-vars */
import React, { useEffect, useRef, useState, useCallback } from 'react';

export default function TradesBox({ symbol }) {
  const [trades, setTrades] = useState([]);
  const wsRef = useRef(null);
  const bufferRef = useRef([]); // incoming trades buffer
  const flushScheduledRef = useRef(false);

  const flushBuffer = useCallback(() => {
    flushScheduledRef.current = false;
    if (bufferRef.current.length === 0) return;
    setTrades((prev) => {
      // newest trades first from buffer (already pushed in arrival order)
      const merged = [...bufferRef.current.reverse(), ...prev];
      bufferRef.current = [];
      return merged.slice(0, 50);
    });
  }, []);

  useEffect(() => {
    try {
      const sym = (symbol || '').toString().replace(/[^A-Za-z0-9]/g, '').toLowerCase();
      if (!sym) return;
      const url = `wss://stream.binance.com:9443/ws/${sym}@trade`;
      const ws = new WebSocket(url);
      wsRef.current = ws;
      ws.onmessage = (ev) => {
        try {
          const data = JSON.parse(ev.data);
          const t = {
            id: data.t,
            price: Number(data.p),
            priceStr: typeof data.p === 'string' ? data.p : String(data.p), // show exact Binance precision
            qty: Number(data.q),
            ts: data.T,
            isBuyerMaker: !!data.m,
          };
          bufferRef.current.push(t);
          // schedule a single flush per animation frame to batch rapid messages
          if (!flushScheduledRef.current) {
            flushScheduledRef.current = true;
            requestAnimationFrame(flushBuffer);
          }
        } catch (e) {}
      };
      ws.onerror = () => {};
      ws.onclose = () => {};
      return () => { try { ws.close(); } catch (e) {} };
    } catch (e) {}
  }, [symbol]);

  // Fast number formatting (avoid toLocaleString for high frequency)
  function fmtNum(n, dpSmall = 4) {
    if (typeof n !== 'number' || Number.isNaN(n)) return '—';
    const abs = Math.abs(n);
    if (abs < 1) return n.toFixed(Math.min(6, dpSmall + 2));
    if (abs < 100) return n.toFixed(dpSmall);
    return n.toFixed(2);
  }

  function fmtTime(ms) {
    if (!ms || typeof ms !== 'number') return '';
    try {
      const d = new Date(ms);
      const hh = String(d.getHours()).padStart(2, '0');
      const mm = String(d.getMinutes()).padStart(2, '0');
      const ss = String(d.getSeconds()).padStart(2, '0');
      return `${hh}:${mm}:${ss}`;
    } catch (e) { return ''; }
  }

  return (
    <div className="trades-box card">
      <div className="trades-list" aria-live="polite">
        {trades.length === 0 ? (
          <div className="trades-empty">No recent trades</div>
        ) : (
          trades.map((t) => (
            <div key={t.id} className={`trade-row ${t.isBuyerMaker ? 'sell' : 'buy'}`}>
              <div className="trade-left">
                <span className="trade-price">{t.priceStr}</span>
                <span className="trade-sep">·</span>
                <span className="trade-qty">{formatQty(t.qty)}</span>
              </div>
              <span className="trade-time" title="Trade time (local)">{fmtTime(t.ts)}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// Quantity formatter extracted outside component (pure)
function formatQty(q) {
  if (typeof q !== 'number' || Number.isNaN(q)) return '—';
  if (q >= 1_000_000) return (q / 1_000_000).toFixed(2) + 'M';
  if (q >= 1_000) return (q / 1_000).toFixed(2) + 'K';
  if (q >= 100) return q.toFixed(2);
  if (q >= 1) return q.toFixed(2);
  return q.toFixed(4);
}
