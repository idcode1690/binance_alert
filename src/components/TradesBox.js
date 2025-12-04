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
      // Use Binance USD-M futures stream for consistency with the app
      const url = `wss://fstream.binance.com/ws/${sym}@trade`;
      const ws = new WebSocket(url);
      wsRef.current = ws;
      ws.onmessage = (ev) => {
        try {
          const raw = JSON.parse(ev.data);
          const data = raw && raw.data ? raw.data : raw; // support combined stream shape
          if (!data || typeof data.t === 'undefined' || typeof data.p === 'undefined') return;
          const priceNum = Number(data.p);
          const qtyNum = Number(data.q);
          // Guard against occasional zero/invalid values from stream; skip nonsensical trades
          if (!Number.isFinite(priceNum) || !Number.isFinite(qtyNum) || priceNum <= 0 || qtyNum <= 0) return;
          const t = {
            id: data.t,
            price: priceNum,
            priceStr: typeof data.p === 'string' ? data.p : String(data.p),
            qty: qtyNum,
            notional: priceNum * qtyNum,
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

  function formatPrice(n) {
    if (typeof n !== 'number' || Number.isNaN(n)) return '—';
    const abs = Math.abs(n);
    // Binance-like: show thousand separators and adaptive decimals
    // High prices (>= 1000): 1 decimal
    // Mid (>= 100): 2 decimals
    // Low (< 100): up to 3-4 decimals for readability
    let minFD = 1; let maxFD = 1;
    if (abs >= 1000) { minFD = 1; maxFD = 1; }
    else if (abs >= 100) { minFD = 2; maxFD = 2; }
    else if (abs >= 1) { minFD = 3; maxFD = 3; }
    else { minFD = 4; maxFD = 4; }
    try {
      return new Intl.NumberFormat('en-US', { minimumFractionDigits: minFD, maximumFractionDigits: maxFD }).format(n);
    } catch (e) {
      return n.toFixed(maxFD);
    }
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
                <span className="trade-price">{formatPrice(t.price)}</span>
                <span className="trade-sep">·</span>
                <span className="trade-qty">{formatNotional(t.notional)}</span>
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
// Format notional (quote asset, e.g., USDT) similar to Binance trade size display
function formatNotional(v) {
  if (typeof v !== 'number' || Number.isNaN(v)) return '—';
  if (v >= 1_000_000) return (v / 1_000_000).toFixed(2) + 'M';
  if (v >= 1_000) return (v / 1_000).toFixed(2) + 'K';
  try { return new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v); } catch (e) { return v.toFixed(2); }
}
