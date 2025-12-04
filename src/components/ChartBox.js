import React, { useEffect, useState } from 'react';
import { calculateInitialEMA, updateEMA } from '../utils/ema';

export default function ChartBox({ symbol, minutes = 1, emaShort = 9, emaLong = 26 }) {
  const [points, setPoints] = useState(null); // { closes:[], emaS:[], emaL:[] }

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
        setPoints({ closes, emaS: emaSArr, emaL: emaLArr });
      } catch (e) { setPoints(null); }
    })();
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
