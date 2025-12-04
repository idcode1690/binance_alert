import React, { useEffect, useRef, useState } from 'react';
import { calculateInitialEMA, updateEMA } from '../utils/ema';

export default function ChartBox({ symbol, minutes = 1, emaShort = 9, emaLong = 26 }) {
  const [points, setPoints] = useState(null); // { closes:[], emaS:[], emaL:[] }
  const wsRef = useRef(null);
  const latestRef = useRef({ closes: [], emaS: [], emaL: [], emaSVal: null, emaLVal: null });

  useEffect(() => {
    const q = (symbol || '').toString().replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    const interval = `${Number(minutes) || 1}m`;
    if (!q) return;
    (async () => {
      try {
        const res = await fetch(`https://fapi.binance.com/fapi/v1/klines?symbol=${q}&interval=${interval}&limit=120`);
        if (!res.ok) return;
        const data = await res.json();
        const closes = (data || []).map(k => Number(k[4])).filter(n => Number.isFinite(n));
        if (closes.length < Math.max(emaShort, emaLong)) { setPoints({ closes, emaS: [], emaL: [] }); return; }
        let emaS = null; let emaL = null; const emaSArr = []; const emaLArr = [];
        emaS = calculateInitialEMA(closes.slice(0, emaShort), emaShort);
        emaL = calculateInitialEMA(closes.slice(0, emaLong), emaLong);
        emaSArr.push(emaS); emaLArr.push(emaL);
        for (let i = Math.max(emaShort, emaLong); i < closes.length; i++) {
          emaS = updateEMA(emaS, closes[i], emaShort);
          emaL = updateEMA(emaL, closes[i], emaLong);
          emaSArr.push(emaS);
          emaLArr.push(emaL);
        }
        latestRef.current = { closes, emaS: emaSArr, emaL: emaLArr, emaSVal: emaSArr[emaSArr.length - 1], emaLVal: emaLArr[emaLArr.length - 1] };
        setPoints({ closes, emaS: emaSArr, emaL: emaLArr });
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
          const close = Number(k.c);
          const isClosed = !!k.x; // true if candle closed
          if (!Number.isFinite(close)) return;
          let { closes, emaS, emaL, emaSVal, emaLVal } = latestRef.current;
          if (!closes || closes.length === 0) return;
          if (isClosed) {
            closes = [...closes, close].slice(-200);
            emaSVal = updateEMA(emaSVal ?? emaS[emaS.length - 1], close, emaShort);
            emaLVal = updateEMA(emaLVal ?? emaL[emaL.length - 1], close, emaLong);
            emaS = [...emaS, emaSVal].slice(-200);
            emaL = [...emaL, emaLVal].slice(-200);
          } else {
            const lastIdx = closes.length - 1;
            const previewCloses = closes.slice();
            previewCloses[lastIdx] = close;
            const prevES = emaS[emaS.length - 1];
            const prevEL = emaL[emaL.length - 1];
            const previewES = updateEMA(prevES, close, emaShort);
            const previewEL = updateEMA(prevEL, close, emaLong);
            latestRef.current = { closes, emaS, emaL, emaSVal, emaLVal };
            setPoints({ closes: previewCloses, emaS: [...emaS.slice(0, -1), previewES], emaL: [...emaL.slice(0, -1), previewEL] });
            return;
          }
          latestRef.current = { closes, emaS, emaL, emaSVal, emaLVal };
          setPoints({ closes, emaS, emaL });
        } catch (e) {}
      };
      ws.onerror = () => {};
      ws.onclose = () => {};
    } catch (e) {}
    return () => { try { if (wsRef.current) wsRef.current.close(); } catch (e) {} };
  }, [symbol, minutes, emaShort, emaLong]);

  if (!points || !points.closes || points.closes.length === 0) {
    return (
      <div className="chart-box card">
        <div className="trades-empty">No chart data</div>
      </div>
    );
  }

  const w = 800; const h = 160; const pad = 8; // width will be 100%; w used for viewBox
  const startIdx = Math.max(0, points.closes.length - 80);
  const slice = points.closes.slice(startIdx);
  const min = Math.min(...slice); const max = Math.max(...slice);
  const y = (v) => {
    if (max === min) return h / 2;
    return pad + (h - 2 * pad) * (1 - (v - min) / (max - min));
  };
  const x = (i) => pad + (w - 2 * pad) * (i / Math.max(1, slice.length - 1));
  const toPath = (arr) => arr.slice(startIdx).map((v, i) => `${i === 0 ? 'M' : 'L'} ${x(i)} ${y(v)}`).join(' ');

  const pricePath = toPath(points.closes);
  const emaSPath = toPath(points.emaS.length ? points.emaS : slice);
  const emaLPath = toPath(points.emaL.length ? points.emaL : slice);

  return (
    <div className="chart-box">
      <svg className="chart-svg" width="100%" height={h} viewBox={`0 0 ${w} ${h}`}>
        <path d={pricePath} fill="none" stroke="var(--text)" strokeWidth="1.2" />
        <path d={emaSPath} fill="none" stroke="#10b981" strokeWidth="1.2" />
        <path d={emaLPath} fill="none" stroke="#ef4444" strokeWidth="1.2" />
      </svg>
      <div className="chart-legend">
        <span className="legend-item">Price</span>
        <span className="legend-item" style={{ color: '#10b981' }}>{`EMA${emaShort}`}</span>
        <span className="legend-item" style={{ color: '#ef4444' }}>{`EMA${emaLong}`}</span>
      </div>
    </div>
  );
}
