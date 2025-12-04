import React, { useEffect, useImperativeHandle, useRef, useState, forwardRef } from 'react';
import { calculateInitialEMA, updateEMA } from '../utils/ema';

// Render a live candlestick chart seeded from REST and updated via websocket,
// with EMA overlays. Keeps desktop layout and mobile responsiveness intact.
const ChartBox = ({ symbol, minutes = 1, emaShort = 9, emaLong = 26 }, ref) => {
  // points: { candles: [{o,h,l,c,t}], emaS: number[], emaL: number[] }
  const [points, setPoints] = useState(null);
  const [seedReady, setSeedReady] = useState(false);
  const wsRef = useRef(null);
  const latestRef = useRef({ candles: [], emaS: [], emaL: [], emaSVal: null, emaLVal: null });
  const reconnectRef = useRef({ attempt: 0, timer: null, hadMessage: false });
  const svgRef = useRef(null);

  // When EMA inputs change, recompute EMA arrays from current candles immediately
  // so overlays reflect the new values without waiting for REST reseed timing.
  useEffect(() => {
    try {
      const seeded = latestRef.current && Array.isArray(latestRef.current.candles) ? latestRef.current.candles : null;
      if (!seeded || seeded.length === 0) return;
      const closes = seeded.map(c => c.c).filter(Number.isFinite);
      if (closes.length < Math.max(emaShort, emaLong)) {
        latestRef.current = { candles: seeded, emaS: [], emaL: [], emaSVal: null, emaLVal: null };
        setPoints(p => ({ candles: seeded, emaS: [], emaL: [] }));
        return;
      }
      let es = calculateInitialEMA(closes.slice(0, emaShort), emaShort);
      let el = calculateInitialEMA(closes.slice(0, emaLong), emaLong);
      const emaSArr = [es];
      const emaLArr = [el];
      for (let i = Math.max(emaShort, emaLong); i < closes.length; i++) {
        es = updateEMA(es, closes[i], emaShort);
        el = updateEMA(el, closes[i], emaLong);
        emaSArr.push(es);
        emaLArr.push(el);
      }
      latestRef.current = { candles: seeded, emaS: emaSArr, emaL: emaLArr, emaSVal: emaSArr[emaSArr.length - 1], emaLVal: emaLArr[emaLArr.length - 1] };
      setPoints(p => ({ candles: seeded, emaS: emaSArr, emaL: emaLArr }));
    } catch (e) {}
  }, [emaShort, emaLong]);

  useEffect(() => {
    const q = (symbol || '').toString().replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    const interval = `${Number(minutes) || 1}m`;
    if (!q) return;
    setSeedReady(false);
    (async () => {
      try {
        const res = await fetch(`https://fapi.binance.com/fapi/v1/klines?symbol=${q}&interval=${interval}&limit=120`);
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
        let es = calculateInitialEMA(closes.slice(0, emaShort), emaShort);
        let el = calculateInitialEMA(closes.slice(0, emaLong), emaLong);
        const emaSArr = [es];
        const emaLArr = [el];
        for (let i = Math.max(emaShort, emaLong); i < closes.length; i++) {
          es = updateEMA(es, closes[i], emaShort);
          el = updateEMA(el, closes[i], emaLong);
          emaSArr.push(es);
          emaLArr.push(el);
        }
        latestRef.current = { candles, emaS: emaSArr, emaL: emaLArr, emaSVal: emaSArr[emaSArr.length - 1], emaLVal: emaLArr[emaLArr.length - 1] };
        setPoints({ candles, emaS: emaSArr, emaL: emaLArr });
        setSeedReady(true);
      } catch (e) { setPoints(null); }
    })();
  }, [symbol, minutes, emaShort, emaLong]);

  // Live updates via Binance futures websocket kline stream with auto-reconnect and endpoint fallback.
  useEffect(() => {
    if (!seedReady) return; // wait until REST seed is ready to avoid dropping early messages
    const q = (symbol || '').toString().replace(/[^A-Za-z0-9]/g, '').toLowerCase();
    const interval = `${Number(minutes) || 1}m`;
    if (!q) return;
    const stream = `${q}@kline_${interval}`;

    let disposed = false;
    const resetState = () => {
      try {
        if (wsRef.current) { wsRef.current.onopen = null; wsRef.current.onmessage = null; wsRef.current.onerror = null; wsRef.current.onclose = null; wsRef.current.close(); }
      } catch (e) {}
      wsRef.current = null;
      if (reconnectRef.current.timer) { clearTimeout(reconnectRef.current.timer); reconnectRef.current.timer = null; }
      reconnectRef.current.attempt = 0;
      reconnectRef.current.hadMessage = false;
    };

    const endpoints = [
      `wss://fstream.binance.com/ws/${stream}`,
      `wss://fstream.binance.com/stream?streams=${stream}`
    ];

    const connectWS = (endpointIdx = 0) => {
      if (disposed) return;
      const url = endpoints[Math.min(endpointIdx, endpoints.length - 1)];
      let switched = false;
      try {
        const ws = new WebSocket(url);
        wsRef.current = ws;
        ws.onopen = () => { reconnectRef.current.attempt = 0; };
        ws.onmessage = (ev) => {
          reconnectRef.current.hadMessage = true;
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
        ws.onerror = () => {
          // if no messages yet on this endpoint, try fallback endpoint immediately once
          if (!switched && !reconnectRef.current.hadMessage && endpointIdx + 1 < endpoints.length) {
            switched = true;
            try { ws.close(); } catch (e) {}
            connectWS(endpointIdx + 1);
          }
        };
        ws.onclose = () => {
          if (disposed) return;
          const attempt = ++reconnectRef.current.attempt;
          const delay = Math.min(30000, 500 * Math.pow(2, attempt - 1));
          reconnectRef.current.timer = setTimeout(() => {
            reconnectRef.current.hadMessage = false;
            connectWS(0); // retry from primary endpoint
          }, delay);
        };
      } catch (e) {}
    };

    connectWS(0);
    return () => { disposed = true; resetState(); };
  }, [symbol, minutes, emaShort, emaLong, seedReady]);

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

  return (
    <div className="chart-box">
      <svg ref={svgRef} className="chart-svg" width="100%" height={h} viewBox={`0 0 ${w} ${h}`}>
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
        <span className="legend-item" style={{ color: '#10b981' }}>{`EMA${emaShort}`}</span>
        <span className="legend-item" style={{ color: '#ef4444' }}>{`EMA${emaLong}`}</span>
      </div>
    </div>
  );
};

export default forwardRef(function ChartBoxWithRef(props, ref) {
  const innerRef = useRef(null);

  useImperativeHandle(ref, () => ({
    async getSnapshotPng() {
      try {
        // Find svg element inside the rendered component
        const host = (innerRef.current && innerRef.current.querySelector) ? innerRef.current : null;
        const svg = host ? host.querySelector('svg.chart-svg') : null;
        if (!svg) return null;
        const serializer = new XMLSerializer();
        const svgStr = serializer.serializeToString(svg);
        const blob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        try {
          const img = new Image();
          const vb = (svg.getAttribute('viewBox') || '0 0 800 200').split(/\s+/).map(Number);
          const cw = (vb && vb.length === 4) ? vb[2] : 800;
          const ch = (vb && vb.length === 4) ? vb[3] : 200;
          await new Promise((res, rej) => {
            img.onload = () => res();
            img.onerror = (e) => rej(e);
            img.src = url;
          });
          const canvas = document.createElement('canvas');
          canvas.width = cw; canvas.height = ch;
          const ctx = canvas.getContext('2d');
          ctx.fillStyle = getComputedStyle(document.body).getPropertyValue('--bg') || '#0b0f14';
          ctx.fillRect(0, 0, cw, ch);
          ctx.drawImage(img, 0, 0);
          const dataUrl = canvas.toDataURL('image/png');
          return dataUrl;
        } finally {
          URL.revokeObjectURL(url);
        }
      } catch (e) { return null; }
    }
  }), []);

  // Wrap original chart in a container div to allow querying its children
  return <div ref={innerRef}><ChartBox {...props} /></div>;
});
