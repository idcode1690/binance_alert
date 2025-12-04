import React, { useEffect, useImperativeHandle, useRef, useState, useCallback } from 'react';
import { calculateInitialEMA, updateEMA } from '../utils/ema';

// Render a live candlestick chart seeded from REST and updated via websocket,
// with EMA overlays. Keeps desktop layout and mobile responsiveness intact.
const ChartBox = React.forwardRef(function ChartBox({ symbol, minutes = 1, emaShort = 9, emaLong = 26 }, ref) {
  const MAX_HISTORY = 1000;
  const [points, setPoints] = useState(null);
  const wsRef = useRef(null);
  const latestRef = useRef({ candles: [], emaS: [], emaL: [], emaSVal: null, emaLVal: null });
  
  const reconnectAttemptsRef = useRef(0);
  const containerRef = useRef(null);
  const lastActivityRef = useRef(0);
  const watchdogTimerRef = useRef(null);
  const wsModeRef = useRef('combined');
  const pollTimerRef = useRef(null);
  const hadActivityRef = useRef(false);
  const gotKlineRef = useRef(false);
  

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current) { try { clearInterval(pollTimerRef.current); } catch (e) {} pollTimerRef.current = null; }
  }, []);

  const recalcAndSet = useCallback((candles) => {
    try {
      const full = (candles || []).slice(-MAX_HISTORY);
      const closes = full.map(c => c.c);
      const need = Math.max(Number(emaShort) || 9, Number(emaLong) || 26);
      if (!closes.length || closes.length < need) {
        latestRef.current = { candles: full, emaS: [], emaL: [], emaSVal: null, emaLVal: null };
        setPoints({ candles: full, emaS: [], emaL: [] });
        return;
      }
      let es = calculateInitialEMA(closes.slice(0, emaShort), emaShort);
      const emaSFull = [es];
      for (let i = emaShort; i < closes.length; i++) { es = updateEMA(es, closes[i], emaShort); emaSFull.push(es); }
      let el = calculateInitialEMA(closes.slice(0, emaLong), emaLong);
      const emaLFull = [el];
      for (let i = emaLong; i < closes.length; i++) { el = updateEMA(el, closes[i], emaLong); emaLFull.push(el); }
      const align = Math.max(1, closes.length - Math.max(emaShort, emaLong) + 1);
      const emaSArr = emaSFull.slice(emaSFull.length - align);
      const emaLArr = emaLFull.slice(emaLFull.length - align);
      latestRef.current = { candles: full, emaS: emaSArr, emaL: emaLArr, emaSVal: emaSArr[emaSArr.length - 1], emaLVal: emaLArr[emaLArr.length - 1] };
      setPoints({ candles: full, emaS: emaSArr, emaL: emaLArr });
    } catch (e) {}
  }, [emaShort, emaLong]);

  const startPolling = useCallback(() => {
    if (pollTimerRef.current) return;
    const qUp = (symbol || '').toString().replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    const intv = `${Number(minutes) || 1}m`;
    const stepMs = 3000;
    const pollOnce = async () => {
      try {
        const res = await fetch(`https://fapi.binance.com/fapi/v1/klines?symbol=${qUp}&interval=${intv}&limit=2`);
        if (!res.ok) return;
        const data = await res.json();
        if (!Array.isArray(data) || data.length === 0) return;
        const last = data[data.length - 1];
        const t = Number(last[0]);
        const o = Number(last[1]);
        const h = Number(last[2]);
        const l = Number(last[3]);
        const c = Number(last[4]);
        const closeTime = Number(last[6]);
        if (![t,o,h,l,c,closeTime].every(Number.isFinite)) return;
        const isClosed = Date.now() >= closeTime;
        const { candles } = latestRef.current;
        if (!candles || candles.length === 0) return;
        const lastLocal = candles[candles.length - 1];
        if (lastLocal && lastLocal.t === t) {
          if (isClosed) {
            const nextCandles = candles.slice(0, -1).concat({ o, h, l, c, t }).slice(-MAX_HISTORY);
            recalcAndSet(nextCandles);
          } else {
            const prev = candles[candles.length - 1];
            const merged = { o: prev.o, h: Math.max(prev.h, h), l: Math.min(prev.l, l), c, t };
            const previewCandles = candles.slice(0, -1).concat(merged);
            recalcAndSet(previewCandles);
          }
        } else {
          if (isClosed) {
            const nextCandles = [...candles, { o, h, l, c, t }].slice(-MAX_HISTORY);
            recalcAndSet(nextCandles);
          } else {
            const previewCandles = [...candles, { o, h, l, c, t }].slice(-MAX_HISTORY);
            recalcAndSet(previewCandles);
          }
        }
      } catch (e) {}
    };
    pollTimerRef.current = setInterval(pollOnce, stepMs);
    pollOnce();
  }, [symbol, minutes, recalcAndSet]);
  // Expose snapshot method before any early returns
  useImperativeHandle(ref, () => ({
    async getSnapshotPng() {
      try {
        const svg = containerRef.current ? containerRef.current.querySelector('svg') : null;
        if (!svg) return null;
        const vb = svg.getAttribute('viewBox');
        let W = 800, H = 200;
        try {
          if (vb) {
            const parts = vb.split(/\s+/).map(Number);
            if (parts.length === 4 && parts.every((n) => Number.isFinite(n))) { W = parts[2]; H = parts[3]; }
          }
        } catch (e) {}
        const xml = new XMLSerializer().serializeToString(svg);
        const svgBlob = new Blob([xml], { type: 'image/svg+xml;charset=utf-8' });
        const url = URL.createObjectURL(svgBlob);
        const img = new Image();
        const dataUrl = await new Promise((resolve) => {
          img.onload = () => {
            try {
              const canvas = document.createElement('canvas');
              canvas.width = W; canvas.height = H;
              const ctx = canvas.getContext('2d');
              ctx.fillStyle = '#0b0f14';
              ctx.fillRect(0, 0, W, H);
              ctx.drawImage(img, 0, 0, W, H);
              URL.revokeObjectURL(url);
              resolve(canvas.toDataURL('image/png'));
            } catch (e) { resolve(null); }
          };
          try { img.src = url; } catch (e) { resolve(null); }
        });
        return dataUrl;
      } catch (e) { return null; }
    }
  }), []);

  useEffect(() => {
    const qREST = (symbol || '').toString().replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    const qWS = qREST.toLowerCase();
    const interval = `${Number(minutes) || 1}m`;
    if (!qREST) return;
    let closed = false;
    // reset seed gate when starting a new seed
    (async () => {
      try {
        const need = Math.max(Number(emaShort) || 9, Number(emaLong) || 26) + 120;
        const limit = Math.min(1000, Math.max(need, 300));
        const res = await fetch(`https://fapi.binance.com/fapi/v1/klines?symbol=${qREST}&interval=${interval}&limit=${limit}`);
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
        const fullCandles = candles.slice(-MAX_HISTORY);

        latestRef.current = { candles: fullCandles, emaS: emaSArr, emaL: emaLArr, emaSVal: emaSArr[emaSArr.length - 1], emaLVal: emaLArr[emaLArr.length - 1] };
        setPoints({ candles: fullCandles, emaS: emaSArr, emaL: emaLArr });
        
        // reset reconnect attempts on fresh seed
        reconnectAttemptsRef.current = 0;
      } catch (e) { /* ignore */ }
    })();

    const connectWs = () => {
      if (closed) return;
      try {
        const stream = `${qWS}@kline_${interval}`;
        const tradeStream = `${qWS}@aggTrade`;
        const mode = wsModeRef.current || 'single';
        const url = mode === 'combined'
          ? `wss://fstream.binance.com/stream?streams=${stream}/${tradeStream}`
          : `wss://fstream.binance.com/ws/${stream}`;
        const ws = new WebSocket(url);
        wsRef.current = ws;
        ws.onopen = () => {
          reconnectAttemptsRef.current = 0;
          lastActivityRef.current = Date.now();
          hadActivityRef.current = false;
          gotKlineRef.current = false;
          // start or reset watchdog
          if (watchdogTimerRef.current) { try { clearInterval(watchdogTimerRef.current); } catch (e) {} watchdogTimerRef.current = null; }
          watchdogTimerRef.current = setInterval(() => {
            try {
              const idleMs = Date.now() - (lastActivityRef.current || 0);
              // if idle > 10s, ensure REST polling is running as fallback
              if (idleMs > 10000) {
                startPolling();
              }
              // if no messages for 30s, force reconnect
              if (idleMs > 30000) {
                if (wsRef.current) { try { wsRef.current.close(); } catch (e) {} }
              }
            } catch (e) {}
          }, 15000);
        };
        ws.onmessage = (ev) => {
          try {
            const payload = JSON.parse(ev.data);
            const root = payload.data || payload;
            // mark activity and stop polling (WS is providing data)
            lastActivityRef.current = Date.now();
            if (!hadActivityRef.current) {
              hadActivityRef.current = true;
            }
            // only stop REST polling once we confirm kline traffic
            if (root && (root.k || root.stream?.includes('@kline_'))) {
              gotKlineRef.current = true;
              stopPolling();
            }
            // Handle aggTrade updates to keep the preview candle moving smoothly
            if (root && (root.e === 'aggTrade' || root.stream?.endsWith('@aggTrade'))) {
              const price = Number(root.p);
              const tradeTime = Number(root.T || root.E || Date.now());
              if (!Number.isFinite(price) || !Number.isFinite(tradeTime)) return;
              let { candles } = latestRef.current;
              if (!candles || candles.length === 0) return;
              const last = candles[candles.length - 1];
              const m = Math.max(1, Number(minutes) || 1);
              const intervalMs = m * 60 * 1000;
              // only preview-update within current candle time window
              if (tradeTime >= last.t && tradeTime < (last.t + intervalMs)) {
                const o = last.o;
                const h = Math.max(last.h, price);
                const l = Math.min(last.l, price);
                const c = price;
                const t = last.t;
                const previewCandles = candles.slice(0, -1).concat({ o, h, l, c, t });
                recalcAndSet(previewCandles);
                return;
              }
              // else ignore; kline event will open/close candles
            }

            // Handle kline payloads (single or combined)
            const k = root.k || null;
            if (!k) return;
            const o = Number(k.o); const h = Number(k.h); const l = Number(k.l); const c = Number(k.c); const t = Number(k.t);
            const isClosed = !!k.x;
            if (![o,h,l,c,t].every(Number.isFinite)) return;
            // confirm kline traffic and stop polling
            if (!gotKlineRef.current) { gotKlineRef.current = true; stopPolling(); }
            let { candles } = latestRef.current;
            if (!candles || candles.length === 0) return;
            const last = candles[candles.length - 1];
            if (last && last.t === t) {
              if (isClosed) {
                const updated = { o, h, l, c, t };
                const nextCandles = candles.slice(0, -1).concat(updated).slice(-MAX_HISTORY);
                recalcAndSet(nextCandles);
              } else {
                const prev = candles[candles.length - 1];
                const merged = { o: prev.o, h: Math.max(prev.h, h), l: Math.min(prev.l, l), c, t };
                const previewCandles = candles.slice(0, -1).concat(merged);
                recalcAndSet(previewCandles);
              }
            } else {
              if (isClosed) {
                const nextCandles = [...candles, { o, h, l, c, t }].slice(-MAX_HISTORY);
                recalcAndSet(nextCandles);
              } else {
                // new preview candle opened
                const previewCandles = [...candles, { o, h, l, c, t }].slice(-MAX_HISTORY);
                recalcAndSet(previewCandles);
              }
            }
          } catch (e) {}
        };
        ws.onerror = () => {};
        ws.onclose = () => {
          if (closed) return;
          // stop watchdog
          if (watchdogTimerRef.current) { try { clearInterval(watchdogTimerRef.current); } catch (e) {} watchdogTimerRef.current = null; }
          const attempt = reconnectAttemptsRef.current || 0;
          const backoff = Math.min(30000, 1000 * Math.pow(2, attempt));
          reconnectAttemptsRef.current = attempt + 1;
          // toggle mode after a few failed attempts to increase chances
          if (reconnectAttemptsRef.current >= 2) {
            wsModeRef.current = (wsModeRef.current === 'single') ? 'combined' : 'single';
          }
          // start REST polling while we wait to reconnect
          startPolling();
          setTimeout(connectWs, backoff);
        };
      } catch (e) {}
    };
    connectWs();
    return () => {
      closed = true;
      try { if (wsRef.current) wsRef.current.close(); } catch (e) {}
      if (watchdogTimerRef.current) { try { clearInterval(watchdogTimerRef.current); } catch (e) {} watchdogTimerRef.current = null; }
      stopPolling();
    };
  }, [symbol, minutes, emaShort, emaLong, recalcAndSet, startPolling, stopPolling]);

  // Recompute EMA overlays immediately when periods change
  useEffect(() => {
    try {
      const { candles } = latestRef.current || {};
      if (!candles || candles.length === 0) return;
      recalcAndSet(candles);
    } catch (e) {}
  }, [emaShort, emaLong, recalcAndSet]);

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

  // Detect EMA cross points within the current view window
  const emaSWin = points.emaS.length ? points.emaS.slice(Math.max(0, points.emaS.length - viewCandles.length)) : [];
  const emaLWin = points.emaL.length ? points.emaL.slice(Math.max(0, points.emaL.length - viewCandles.length)) : [];
  const crossIdxs = [];
  const crossLen = Math.min(emaSWin.length, emaLWin.length);
  if (crossLen >= 2) {
    for (let i = 1; i < crossLen; i++) {
      const dPrev = emaSWin[i - 1] - emaLWin[i - 1];
      const dNow = emaSWin[i] - emaLWin[i];
      if (!Number.isFinite(dPrev) || !Number.isFinite(dNow)) continue;
      if (dPrev === 0 || dPrev * dNow < 0) {
        crossIdxs.push(i);
      }
    }
  }
  

  return (
    <div className="chart-box" ref={containerRef}>
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
        {crossIdxs.map((i) => {
          const cx = x(i);
          const cy = y((emaSWin[i] + emaLWin[i]) / 2);
          return <circle key={`cross-${i}`} cx={cx} cy={cy} r={2.3} fill="#ffffff" stroke="#000000" strokeWidth="0.4" />;
        })}
      </svg>
      <div className="chart-legend">
        <span className="legend-item" style={{ color: '#10b981' }}>{`EMA${emaShort}${lastEmaS!=null?`: ${lastEmaS.toFixed(2)}`:''}`}</span>
        <span className="legend-item" style={{ color: '#ef4444' }}>{`EMA${emaLong}${lastEmaL!=null?`: ${lastEmaL.toFixed(2)}`:''}`}</span>
      </div>
    </div>
  );
});

export default ChartBox;
