import React, { useEffect, useRef, useState } from 'react';
import { calculateInitialEMA, updateEMA } from '../utils/ema';

// Render a live candlestick chart seeded from REST and updated via websocket,
// with EMA overlays. Keeps desktop layout and mobile responsiveness intact.
export default function ChartBox({ symbol, minutes = 1, emaShort = 9, emaLong = 26 }) {
  // points: { candles: [{o,h,l,c,t}], emaS: number[], emaL: number[] }
  const [points, setPoints] = useState(null);
  const wsRef = useRef(null);
  const latestRef = useRef({ candles: [], emaS: [], emaL: [], emaSVal: null, emaLVal: null });

  useEffect(() => {
    const q = (symbol || '').toString().replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    const interval = `${Number(minutes) || 1}m`;
    if (!q) return;
    (async () => {
      try {
        const need = Math.max(Number(emaShort) || 9, Number(emaLong) || 26) + 120;
        const limit = Math.min(1000, Math.max(need, 300));
        const res = await fetch(`https://fapi.binance.com/fapi/v1/klines?symbol=${q}&interval=${interval}&limit=${limit}`);
        if (!res.ok) return;
        const data = await res.json();
        const candles = (data || []).map(k => ({
          o: Number(k[1]), h: Number(k[2]), l: Number(k[3]), c: Number(k[4]), t: Number(k[0])
        })).filter(c => Number.isFinite(c.o) && Number.isFinite(c.h) && Number.isFinite(c.l) && Number.isFinite(c.c));
        const closes = candles.map(c => c.c);
        if (closes.length < Math.max(emaShort, emaLong)) {
          setPoints({ candles, emaS: [], emaL: [] });
          return;
        }
        // Build full EMA sequences then align both to the same tail length
        let es = calculateInitialEMA(closes.slice(0, emaShort), emaShort);
        const emaSFull = [es];
        for (let i = emaShort; i < closes.length; i++) {
          es = updateEMA(es, closes[i], emaShort);
          emaSFull.push(es);
        }

        let el = calculateInitialEMA(closes.slice(0, emaLong), emaLong);
        const emaLFull = [el];
        for (let i = emaLong; i < closes.length; i++) {
          el = updateEMA(el, closes[i], emaLong);
          emaLFull.push(el);
        }

        // Align to the same number of trailing points so both end on the latest candle
        const align = closes.length - Math.max(emaShort, emaLong) + 1;
        const emaSArr = emaSFull.slice(emaSFull.length - align);
        const emaLArr = emaLFull.slice(emaLFull.length - align);
        const alignedCandles = candles.slice(candles.length - align);

        latestRef.current = { candles: alignedCandles, emaS: emaSArr, emaL: emaLArr, emaSVal: emaSArr[emaSArr.length - 1], emaLVal: emaLArr[emaLArr.length - 1] };
        setPoints({ candles: alignedCandles, emaS: emaSArr, emaL: emaLArr });
      } catch (e) { setPoints(null); }
    })();
  }, [symbol, minutes, emaShort, emaLong]);

  // Live updates via Binance futures websocket kline stream, mirroring Binance behavior.
  useEffect(() => {
    const q = (symbol || '').toString().replace(/[^A-Za-z0-9]/g, '').toLowerCase();
    const interval = `${Number(minutes) || 1}m`;
    if (!q) return;
    const stream = `${q}@kline_${interval}`;
    const url = `wss://fstream.binance.com/ws/${stream}`;
    try {
      const ws = new WebSocket(url);
      wsRef.current = ws;
      ws.onmessage = (ev) => {
        try {
          const payload = JSON.parse(ev.data);
          const k = payload.k || (payload.data && payload.data.k) || null;
          if (!k) return;
          const o = Number(k.o); const h = Number(k.h); const l = Number(k.l); const c = Number(k.c); const t = Number(k.t);
          const isClosed = !!k.x; // true if candle closed
          if (![o,h,l,c,t].every(Number.isFinite)) return;
          let { candles, emaS, emaL, emaSVal, emaLVal } = latestRef.current;
          if (!candles || candles.length === 0) return;
          const last = candles[candles.length - 1];
          if (last && last.t === t) {
            if (isClosed) {
              const updated = { o, h, l, c, t };
              const nextCandles = candles.slice(0, -1).concat(updated).slice(-200);
              emaSVal = updateEMA(emaSVal ?? emaS[emaS.length - 1], c, emaShort);
              emaLVal = updateEMA(emaLVal ?? emaL[emaL.length - 1], c, emaLong);
              const nextES = [...emaS.slice(0, -1), emaSVal].slice(-200);
              const nextEL = [...emaL.slice(0, -1), emaLVal].slice(-200);
              latestRef.current = { candles: nextCandles, emaS: nextES, emaL: nextEL, emaSVal, emaLVal };
              setPoints({ candles: nextCandles, emaS: nextES, emaL: nextEL });
            } else {
              const preview = { o, h, l, c, t };
              const previewCandles = candles.slice(0, -1).concat(preview);
              const prevES = emaS[emaS.length - 1];
              const prevEL = emaL[emaL.length - 1];
              const previewES = updateEMA(prevES, c, emaShort);
              const previewEL = updateEMA(prevEL, c, emaLong);
              setPoints({ candles: previewCandles, emaS: [...emaS.slice(0, -1), previewES], emaL: [...emaL.slice(0, -1), previewEL] });
            }
          } else {
            if (isClosed) {
              const nextCandles = [...candles, { o, h, l, c, t }].slice(-200);
              emaSVal = updateEMA(emaSVal ?? emaS[emaS.length - 1], c, emaShort);
              emaLVal = updateEMA(emaLVal ?? emaL[emaL.length - 1], c, emaLong);
              const nextES = [...emaS, emaSVal].slice(-200);
              const nextEL = [...emaL, emaLVal].slice(-200);
              latestRef.current = { candles: nextCandles, emaS: nextES, emaL: nextEL, emaSVal, emaLVal };
              setPoints({ candles: nextCandles, emaS: nextES, emaL: nextEL });
            } else {
              // new preview candle opened
              const previewCandles = [...candles, { o, h, l, c, t }].slice(-200);
              const previewES = updateEMA(emaS[emaS.length - 1], c, emaShort);
              const previewEL = updateEMA(emaL[emaL.length - 1], c, emaLong);
              setPoints({ candles: previewCandles, emaS: [...emaS, previewES].slice(-200), emaL: [...emaL, previewEL].slice(-200) });
            }
          }
        } catch (e) {}
      };
      ws.onerror = () => {};
      ws.onclose = () => {};
    } catch (e) {}
    return () => { try { if (wsRef.current) wsRef.current.close(); } catch (e) {} };
  }, [symbol, minutes, emaShort, emaLong]);

  if (!points || !points.candles || points.candles.length === 0) {
    return (
      <div className="chart-box card">
        <div className="trades-empty">No chart data</div>
      </div>
    );
  }

  const w = 800; const h = 200; const pad = 8; // responsive width via viewBox
  const visible = 80;
  const startIdx = Math.max(0, points.candles.length - visible);
  const viewCandles = points.candles.slice(startIdx);
  const lows = viewCandles.map(c => c.l);
  const highs = viewCandles.map(c => c.h);
  const min = Math.min(...lows);
  const max = Math.max(...highs);
  const y = (v) => {
    if (max === min) return h / 2;
    return pad + (h - 2 * pad) * (1 - (v - min) / (max - min));
  };
  const x = (i) => pad + (w - 2 * pad) * (i / Math.max(1, viewCandles.length - 1));
  const step = (w - 2 * pad) / Math.max(1, viewCandles.length - 1);
  const bodyW = Math.max(1, Math.min(10, step * 0.6));

  const closesForPath = points.candles.map(c => c.c);
  const toPath = (arr) => arr.slice(Math.max(0, arr.length - viewCandles.length)).map((v, i) => `${i === 0 ? 'M' : 'L'} ${x(i)} ${y(v)}`).join(' ');
  const emaSPath = toPath(points.emaS.length ? points.emaS : closesForPath);
  const emaLPath = toPath(points.emaL.length ? points.emaL : closesForPath);
  const lastEmaS = points.emaS.length ? points.emaS[points.emaS.length - 1] : null;
  const lastEmaL = points.emaL.length ? points.emaL[points.emaL.length - 1] : null;

  return (
    <div className="chart-box">
      <svg className="chart-svg" width="100%" height={h} viewBox={`0 0 ${w} ${h}`}>
        {viewCandles.map((c, i) => {
          const isUp = c.c >= c.o;
          const cx = x(i);
          const openY = y(c.o);
          const closeY = y(c.c);
          const highY = y(c.h);
          const lowY = y(c.l);
          const top = Math.min(openY, closeY);
          const height = Math.max(1, Math.abs(closeY - openY));
          const color = isUp ? '#10b981' : '#ef4444';
          return (
            <g key={c.t || i}>
              <line x1={cx} x2={cx} y1={highY} y2={lowY} stroke={color} strokeWidth="1" />
              <rect x={cx - bodyW / 2} y={top} width={bodyW} height={height} fill={color} />
            </g>
          );
        })}
        <path d={emaSPath} fill="none" stroke="#10b981" strokeWidth="1.2" />
        <path d={emaLPath} fill="none" stroke="#ef4444" strokeWidth="1.2" />
      </svg>
      <div className="chart-legend">
        <span className="legend-item" style={{ color: '#10b981' }}>{`EMA${emaShort}${lastEmaS!=null?`: ${lastEmaS.toFixed(2)}`:''}`}</span>
        <span className="legend-item" style={{ color: '#ef4444' }}>{`EMA${emaLong}${lastEmaL!=null?`: ${lastEmaL.toFixed(2)}`:''}`}</span>
      </div>
    </div>
  );
}
