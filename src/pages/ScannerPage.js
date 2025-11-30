import React, { useEffect, useMemo, useState, useRef, useCallback } from 'react';
import scannerManager from '../lib/scannerManager';

export default function ScannerPage({ availableSymbols, fetchExchangeInfo, monitorMinutes, setMonitorMinutes, monitorEma1, setMonitorEma1, monitorEma2, setMonitorEma2 }) {
  const symbols = useMemo(() => (Array.isArray(availableSymbols) ? availableSymbols.slice() : []), [availableSymbols]);
  const [state, setState] = useState(scannerManager.getState());
  // local UI-only scan type to immediately reflect button clicks in the progress bar
  const [uiScanType, setUiScanType] = useState(null);

  // Local string inputs so Scanner page inputs are independent from the Alerts/Controls inputs.
  // Initialize from localStorage (scannerDefaults) when available so the Scanner retains its own
  // saved defaults across navigation. IMPORTANT: if no scannerDefaults exist, do NOT read
  // parent `monitor*` props — instead use fixed sane defaults so the Scanner will not follow
  // the Alerts/Controls values.
  function readScannerDefaults() {
    try {
      const raw = localStorage.getItem('scannerDefaults');
      if (raw) {
        const p = JSON.parse(raw);
        return {
          mins: typeof p.mins !== 'undefined' ? String(p.mins) : '5',
          ema1: typeof p.ema1 !== 'undefined' ? String(p.ema1) : '26',
          ema2: typeof p.ema2 !== 'undefined' ? String(p.ema2) : '200',
        };
      }
    } catch (e) {}
    // NO parent prop usage here — return fixed defaults to avoid following Alerts values
    return { mins: '5', ema1: '26', ema2: '200' };
  }

  const initialScanner = readScannerDefaults();
  const [minsStr, setMinsStr] = useState(initialScanner.mins);
  const [ema1Str, setEma1Str] = useState(initialScanner.ema1);
  const [ema2Str, setEma2Str] = useState(initialScanner.ema2);

  // Note: intentionally do NOT re-sync local scanner inputs when parent monitor values change.
  // This keeps Scanner inputs independent from the Alerts/Controls values after initial mount.

  useEffect(() => {
    // provide symbol list provider to manager
    scannerManager.setGetSymbols(() => symbols || []);
  }, [symbols]);

  useEffect(() => {
    // ensure we have exchange info loaded
    if ((!symbols || symbols.length === 0) && typeof fetchExchangeInfo === 'function') {
      try { fetchExchangeInfo(); } catch (e) {}
    }
  }, [symbols, fetchExchangeInfo]);

  // modal state for newly detected matches (removed modal display; we keep beep only)
  const shownResultsRef = useRef(new Set());

  useEffect(() => {
    // On mount, migrate old localStorage scanner results that lack the new `type` field.
    // Only run a simple cleanup to avoid showing stale results without scan type.
    try {
      const raw = localStorage.getItem('scannerResults');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.some((r) => !r || typeof r.type === 'undefined')) {
          console.info('scannerResults migration: removing old results missing `type` field');
          localStorage.removeItem('scannerResults');
        }
      }
    } catch (e) {
      // ignore parse errors and continue
    }

    // subscribe to manager updates
    const off = scannerManager.onUpdate((s) => setState(s));
    // initialize state and mark any existing results as already shown so we don't beep on mount
    const init = scannerManager.getState();
    setState(init);
    try {
      const existing = Array.isArray(init.results) ? init.results : [];
      for (const r of existing) {
        const rid = (r && r.id) ? r.id : `${r && r.symbol ? r.symbol : ''}::${r && r.time ? r.time : ''}::${r && r.emaShort ? r.emaShort : ''}::${r && r.emaLong ? r.emaLong : ''}`;
        shownResultsRef.current.add(rid);
      }
    } catch (e) {}
    return () => off();
  }, []);

  const saveScannerDefaults = useCallback((mins, ema1, ema2) => {
    try {
      const obj = { mins: mins, ema1: ema1, ema2: ema2 };
      localStorage.setItem('scannerDefaults', JSON.stringify(obj));
    } catch (e) {}
  }, []);

  // Note: do NOT auto-persist parent monitor values on mount; that would copy Alerts values
  // into Scanner and re-create the follow behavior. Scanner defaults are only set when the
  // user explicitly starts a scan (startGolden/startDead) which persists their choices.

  const startGolden = useCallback(() => {
    try {
      // immediately set UI scan type so progress bar color changes on click
      setUiScanType('golden');
      const mins = parseInt(minsStr, 10);
      const ema1 = parseInt(ema1Str, 10);
      const ema2 = parseInt(ema2Str, 10);
      // validate EMA ordering (short < long)
      if (Number.isFinite(ema1) && Number.isFinite(ema2) && ema1 >= ema2) {
        // user likely swapped fields; prevent a confusing scan
        // use a simple alert so user notices immediately
        try { window.alert('Invalid EMA values: EMA1 must be smaller than EMA2'); } catch (e) {}
        setUiScanType(null);
        return;
      }
      const intervalVal = Number.isFinite(mins) && mins > 0 ? mins : monitorMinutes;
      // normalize interval value to Binance-compatible token (e.g. 240 -> '4h', 5 -> '5m')
      const normalizeInterval = (val) => {
        try {
          const n = Number(val);
          if (!Number.isFinite(n) || n <= 0) return String(val);
          if (n % 60 === 0) return `${n / 60}h`;
          return `${n}m`;
        } catch (e) { return String(val); }
      };
      const intervalToken = normalizeInterval(intervalVal);
      const opts = {
        interval: intervalToken,
        emaShort: Number.isFinite(ema1) && ema1 > 0 ? ema1 : monitorEma1,
        emaLong: Number.isFinite(ema2) && ema2 > 0 ? ema2 : monitorEma2,
        // explicitly request 1000 candles for scanning to ensure stable EMA seeding
        klineLimit: 1000,
        // real-time monitoring mode
        monitor: true,
        pollIntervalMs: (Number.isFinite(intervalVal) ? (intervalVal * 60 * 1000 + 5000) : undefined),
        // conservative runtime options to avoid hitting API rate limits on start
        concurrency: 2,
        batchDelay: 200,
        maxConcurrency: 4,
      };
      scannerManager.start('golden', opts);
      // clear any previously-shown result IDs so we re-list and beep for new matches
      try { if (shownResultsRef && shownResultsRef.current) shownResultsRef.current.clear(); } catch (e) {}
      // persist scanner choices as defaults
      saveScannerDefaults(opts.interval, opts.emaShort, opts.emaLong);
    } catch (e) {}
  }, [minsStr, ema1Str, ema2Str, monitorMinutes, monitorEma1, monitorEma2, saveScannerDefaults]);

  const startDead = useCallback(() => {
    try {
      // immediately set UI scan type so progress bar color changes on click
      setUiScanType('dead');
      const mins = parseInt(minsStr, 10);
      const ema1 = parseInt(ema1Str, 10);
      const ema2 = parseInt(ema2Str, 10);
      // validate EMA ordering (short < long)
      if (Number.isFinite(ema1) && Number.isFinite(ema2) && ema1 >= ema2) {
        try { window.alert('Invalid EMA values: EMA1 must be smaller than EMA2'); } catch (e) {}
        setUiScanType(null);
        return;
      }
      const intervalVal2 = Number.isFinite(mins) && mins > 0 ? mins : monitorMinutes;
      // normalize interval value to Binance-compatible token
      const normalizeInterval = (val) => {
        try {
          const n = Number(val);
          if (!Number.isFinite(n) || n <= 0) return String(val);
          if (n % 60 === 0) return `${n / 60}h`;
          return `${n}m`;
        } catch (e) { return String(val); }
      };
      const intervalToken2 = normalizeInterval(intervalVal2);
      const opts = {
        interval: intervalToken2,
        emaShort: Number.isFinite(ema1) && ema1 > 0 ? ema1 : monitorEma1,
        emaLong: Number.isFinite(ema2) && ema2 > 0 ? ema2 : monitorEma2,
        // explicitly request 1000 candles for scanning to ensure stable EMA seeding
        klineLimit: 1000,
        monitor: true,
        pollIntervalMs: (Number.isFinite(intervalVal2) ? (intervalVal2 * 60 * 1000 + 5000) : undefined),
        concurrency: 2,
        batchDelay: 200,
        maxConcurrency: 4,
      };
      scannerManager.start('dead', opts);
      // clear any previously-shown result IDs so we re-list and beep for new matches
      try { if (shownResultsRef && shownResultsRef.current) shownResultsRef.current.clear(); } catch (e) {}
      // persist scanner choices as defaults
      saveScannerDefaults(opts.interval, opts.emaShort, opts.emaLong);
    } catch (e) {}
  }, [minsStr, ema1Str, ema2Str, monitorMinutes, monitorEma1, monitorEma2, saveScannerDefaults]);
  function stopScan() { try { scannerManager.stop(); } catch (e) {} setUiScanType(null); }

  // keep UI scan type in sync with manager state when manager finishes or changes
  const managerScanType = (state && state.scanType) ? state.scanType : null;
  useEffect(() => {
    if (!managerScanType) setUiScanType(null);
    else setUiScanType(managerScanType);
  }, [managerScanType]);

  const running = !!state.running;
  const currentSymbol = state.currentSymbol;
  const progress = state.progress || { done: 0, total: 0 };
  // sort results by volume (descending) so high-volume matches appear first
  const results = useMemo(() => {
    const arr = Array.isArray(state.results) ? state.results.slice() : [];
    try {
      arr.sort((a, b) => {
        const va = (a && typeof a.volume === 'number') ? a.volume : (a && a.volume ? Number(a.volume) : 0);
        const vb = (b && typeof b.volume === 'number') ? b.volume : (b && b.volume ? Number(b.volume) : 0);
        return (vb || 0) - (va || 0);
      });
    } catch (e) {}
    return arr;
  }, [state.results]);

  // also provide a sorted active list by volume so active monitoring shows highest-volume first
  const sortedActive = useMemo(() => {
    const arr = Array.isArray(state.active) ? state.active.slice() : [];
    try {
      arr.sort((a, b) => {
        const va = (a && typeof a.volume === 'number') ? a.volume : (a && a.volume ? Number(a.volume) : 0);
        const vb = (b && typeof b.volume === 'number') ? b.volume : (b && b.volume ? Number(b.volume) : 0);
        return (vb || 0) - (va || 0);
      });
    } catch (e) {}
    return arr;
  }, [state.active]);

  // use a ticking 'now' so we can compute elapsed from manager's persistent scanStartTime
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  function formatElapsed(ms) {
    if (!ms || ms <= 0) return '0:00';
    const totalSec = Math.floor(ms / 1000);
    const hrs = Math.floor(totalSec / 3600);
    const mins = Math.floor((totalSec % 3600) / 60);
    const secs = totalSec % 60;
    const pad = (n) => n.toString().padStart(2, '0');
    if (hrs > 0) return `${hrs}:${pad(mins)}:${pad(secs)}`;
    return `${mins}:${pad(secs)}`;
  }

  // copied symbol feedback
  const [copiedSymbol, setCopiedSymbol] = useState(null);

  // small beep helper (reuse pattern from App.beep)
  function beep() {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      const ctx = new AudioCtx();
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine';
      o.frequency.value = 880;
      o.connect(g);
      g.connect(ctx.destination);
      o.start();
      g.gain.setValueAtTime(0.0001, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.1, ctx.currentTime + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.6);
      setTimeout(() => {
        o.stop();
        try { ctx.close(); } catch (e) {}
      }, 700);
    } catch (e) {
      // ignore
    }
  }

  // play beep when a new match is detected (no modal)
  useEffect(() => {
    try {
      // prefer active list for monitoring notifications
      const active = Array.isArray(state.active) ? state.active : [];
      if (active && active.length > 0) {
        const top = active[0];
        const id = (top && top.id) ? top.id : `${top.symbol || ''}::${top.time || ''}::${top.emaShort || ''}::${top.emaLong || ''}`;
        if (!shownResultsRef.current.has(id)) {
          shownResultsRef.current.add(id);
          try { beep(); } catch (e) {}
        }
      } else {
        // fallback to historical results
        if (!results || results.length === 0) return;
        const top = results[0];
        if (!top) return;
        const id = (top && top.id) ? top.id : `${top.symbol || ''}::${top.time || ''}::${top.emaShort || ''}::${top.emaLong || ''}`;
        if (shownResultsRef.current.has(id)) return;
        shownResultsRef.current.add(id);
        try { beep(); } catch (e) {}
      }
    } catch (e) {}
  }, [results, state.active]);

  function formatVolume(v) {
    try {
      const n = Number(v || 0);
      if (!Number.isFinite(n)) return '-';
      if (Math.abs(n) >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
      if (Math.abs(n) >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
      if (Math.abs(n) >= 1e3) return `${(n / 1e3).toFixed(2)}k`;
      return n.toString();
    } catch (e) { return '-'; }
  }

  return (
  <div className="alerts scanner-root">
      {/* modal removed: only play beep when a new match is detected */}
      <div className="alerts-title">Binance EMA Cross Scanner</div>
  <div className="panel scanner-panel">
        <div className="scanner-controls-left">
          <div className="control-inline-label">
            <span className="label-text">Mins (candle interval)</span>
            <div className="interval-btns" style={{ display: 'inline-flex', gap: 6, marginLeft: 8 }}>
              {[{ label: '1m', val: '1' }, { label: '5m', val: '5' }, { label: '30m', val: '30' }, { label: '4h', val: '240' }].map((it) => (
                <button key={it.val} type="button" className={`small-interval-btn ${String(minsStr) === String(it.val) ? 'active' : ''}`} onClick={() => {
                  setMinsStr(String(it.val));
                  const p = parseInt(it.val, 10);
                  if (Number.isFinite(p) && p > 0) saveScannerDefaults(p, parseInt(ema1Str, 10) || '', parseInt(ema2Str, 10) || '');
                }}>{it.label}</button>
              ))}
            </div>
          </div>
          <label className="control-inline-label">
            <span className="label-text">EMA1</span>
            <input className="ema-input" size="5" style={{width: '5ch'}} type="text" inputMode="numeric" pattern="\d*" value={ema1Str} onChange={(e) => setEma1Str(e.target.value)} onBlur={() => {
              const p = parseInt(ema1Str, 10);
              if (Number.isFinite(p) && p > 0) saveScannerDefaults(parseInt(minsStr, 10) || '', p, parseInt(ema2Str, 10) || '');
            }} />
          </label>
          <label className="control-inline-label">
            <span className="label-text">EMA2</span>
            <input className="ema-input" size="5" style={{width: '5ch'}} type="text" inputMode="numeric" pattern="\d*" value={ema2Str} onChange={(e) => setEma2Str(e.target.value)} onBlur={() => {
              const p = parseInt(ema2Str, 10);
              if (Number.isFinite(p) && p > 0) saveScannerDefaults(parseInt(minsStr, 10) || '', parseInt(ema1Str, 10) || '', p);
            }} />
          </label>
        </div>

        <div className="scanner-controls">
          <button onClick={startGolden} disabled={running} className="scanner-btn green">Golden</button>
          <button onClick={startDead} disabled={running} className="scanner-btn red">Dead</button>
          <button onClick={stopScan} disabled={!running} className="scanner-btn stop">Stop</button>
        </div>
      </div>

      {/* progress bar: shows scanning progress below the buttons */}
      <div className="progress-wrap" aria-hidden={!running}>
        <div className="scanner-progress-container">
          <div className="scanner-progress-left">{running ? `Scanning: ${currentSymbol || '...'}` : 'Idle'}</div>
          <div className="scanner-progress-right">
            {/* elapsed time shown left of the numeric progress (persists across pages) */}
            <span className="scanner-elapsed">{state && state.scanStartTime && running ? formatElapsed(Math.max(0, now - state.scanStartTime)) : ''}</span>
            <span className="scanner-progress-numbers">{progress.done}/{progress.total || (symbols || []).filter(s => /USDT$/i.test(s)).length}</span>
          </div>
        </div>
        <div className="progress-track">
          {(() => {
            const total = (progress && progress.total) ? progress.total : ((symbols || []).filter(s => /USDT$/i.test(s)).length || 0);
            const done = (progress && progress.done) ? progress.done : 0;
            const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
            // color progress fill to match scanner type (golden=green, dead=red)
            // prefer immediate UI scan type (set on button click) to reflect the user's action
            const scanType = uiScanType || (state && state.scanType ? state.scanType : null);
            const fillClass = `progress-fill ${scanType === 'dead' ? 'dead' : (scanType === 'golden' ? 'golden' : '')}`.trim();
            return (
              <div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} className={fillClass} style={{ width: `${pct}%` }} />
            );
          })()}
        </div>
      </div>

      {/* Active monitoring list: shows currently-active crosses (real-time). Falls back to historical results. */}
      <ul className="alerts-list">
        {Array.isArray(sortedActive) && sortedActive.length > 0 ? (
          sortedActive.map((r, idx) => (
            <li key={r.id || `${r.symbol}-active-${idx}`} className="alert-item">
              <div className="alert-left">
                {(() => {
                  const t = (r && r.type) ? r.type : (state && state.scanType ? state.scanType : null);
                  const cls = t === 'dead' ? 'bear' : (t === 'golden' ? 'bull' : 'bull');
                  return <span className={`alert-indicator ${cls}`} />;
                })()}
                <button type="button" className={`alert-symbol copy-btn ${copiedSymbol === r.symbol ? 'copied' : ''}`} title="Copy symbol" onClick={async (e) => { e.preventDefault(); try { if (navigator && navigator.clipboard && navigator.clipboard.writeText) { await navigator.clipboard.writeText(r.symbol); } else { const ta = document.createElement('textarea'); ta.value = r.symbol; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta); } setCopiedSymbol(r.symbol); setTimeout(() => setCopiedSymbol(null), 1200); } catch (err) {} }}>
                  {r.symbol}
                </button>
              </div>
              <div className="alert-body">
                <div className="alert-info">
                  {(() => { const tt = (r && r.type) ? r.type : (state && state.scanType ? state.scanType : null); const label = tt === 'dead' ? 'Bear' : (tt === 'golden' ? 'Bull' : 'Match'); return <div className="alert-type-short">{label}</div>; })()}
                  <div className="alert-time">{r.time}</div>
                </div>
                <div className="alert-right">
                  <div className="alert-volume" title={`Volume: ${r.volume || 0}`}>Vol: {formatVolume(r.volume)}</div>
                  <button type="button" className="delete-result" title="Remove from active" onClick={() => { try { scannerManager.removeActive(r.symbol); } catch (e) {} }}>
                    ✕
                  </button>
                </div>
              </div>
            </li>
          ))
        ) : (
          results.length === 0 ? (
            <li className="alert-item no-results">No matches yet.</li>
          ) : (
            results.map((r, idx) => (
              <li key={r.id || `${r.symbol}-${idx}`} className="alert-item">
                <div className="alert-left">
                  {(() => {
                    const t = (r && r.type) ? r.type : (state && state.scanType ? state.scanType : null);
                    const cls = t === 'dead' ? 'bear' : (t === 'golden' ? 'bull' : 'bull');
                    return <span className={`alert-indicator ${cls}`} />;
                  })()}
                  <button
                    type="button"
                    className={`alert-symbol copy-btn ${copiedSymbol === r.symbol ? 'copied' : ''}`}
                    title="Copy symbol to clipboard"
                    onClick={async (e) => {
                      e.preventDefault();
                      try {
                        if (navigator && navigator.clipboard && navigator.clipboard.writeText) {
                          await navigator.clipboard.writeText(r.symbol);
                        } else {
                          const ta = document.createElement('textarea');
                          ta.value = r.symbol;
                          document.body.appendChild(ta);
                          ta.select();
                          document.execCommand('copy');
                          document.body.removeChild(ta);
                        }
                        setCopiedSymbol(r.symbol);
                        setTimeout(() => setCopiedSymbol(null), 1200);
                      } catch (err) {
                        // ignore copy failures
                      }
                    }}
                  >
                    {r.symbol}
                  </button>
                </div>
                <div className="alert-body">
                  <div className="alert-info">
                  {(() => {
                    const tt = (r && r.type) ? r.type : (state && state.scanType ? state.scanType : null);
                    const label = tt === 'dead' ? 'Bear' : (tt === 'golden' ? 'Bull' : 'Match');
                    return <div className="alert-type-short">{label}</div>;
                  })()}
                    <div className="alert-time">{r.time}</div>
                  </div>
                    <div className="alert-right">
                    <div className="alert-volume" title={`Volume: ${r.volume || 0}`}>
                      Vol: {formatVolume(r.volume)}
                    </div>
                    <button type="button" className="delete-result" title="Remove" onClick={() => { try { scannerManager.removeResult(r.id); } catch (e) {} }}>
                      ✕
                    </button>
                  </div>
                </div>
              </li>
            ))
          )
        )}
      </ul>
    </div>
  );
}
