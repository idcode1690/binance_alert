import React, { useEffect, useMemo, useState, useRef, useCallback } from 'react';
import scannerManager from '../lib/scannerManager';

export default function ScannerPage({ availableSymbols, fetchExchangeInfo, monitorMinutes, setMonitorMinutes, monitorEma1, setMonitorEma1, monitorEma2, setMonitorEma2 }) {
  const symbols = useMemo(() => (Array.isArray(availableSymbols) ? availableSymbols.slice() : []), [availableSymbols]);
  const [state, setState] = useState(scannerManager.getState());

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
      const mins = parseInt(minsStr, 10);
      const ema1 = parseInt(ema1Str, 10);
      const ema2 = parseInt(ema2Str, 10);
      const opts = {
        interval: Number.isFinite(mins) && mins > 0 ? mins : monitorMinutes,
        emaShort: Number.isFinite(ema1) && ema1 > 0 ? ema1 : monitorEma1,
        emaLong: Number.isFinite(ema2) && ema2 > 0 ? ema2 : monitorEma2,
        // conservative runtime options to avoid hitting API rate limits on start
        concurrency: 1,
        batchDelay: 1000,
        maxConcurrency: 2,
      };
      scannerManager.start('golden', opts);
      // persist scanner choices as defaults
      saveScannerDefaults(opts.interval, opts.emaShort, opts.emaLong);
    } catch (e) {}
  }, [minsStr, ema1Str, ema2Str, monitorMinutes, monitorEma1, monitorEma2, saveScannerDefaults]);

  const startDead = useCallback(() => {
    try {
      const mins = parseInt(minsStr, 10);
      const ema1 = parseInt(ema1Str, 10);
      const ema2 = parseInt(ema2Str, 10);
      const opts = {
        interval: Number.isFinite(mins) && mins > 0 ? mins : monitorMinutes,
        emaShort: Number.isFinite(ema1) && ema1 > 0 ? ema1 : monitorEma1,
        emaLong: Number.isFinite(ema2) && ema2 > 0 ? ema2 : monitorEma2,
        // conservative runtime options to avoid hitting API rate limits on start
        concurrency: 1,
        batchDelay: 1000,
        maxConcurrency: 2,
      };
      scannerManager.start('dead', opts);
      // persist scanner choices as defaults
      saveScannerDefaults(opts.interval, opts.emaShort, opts.emaLong);
    } catch (e) {}
  }, [minsStr, ema1Str, ema2Str, monitorMinutes, monitorEma1, monitorEma2, saveScannerDefaults]);
  function stopScan() { try { scannerManager.stop(); } catch (e) {} }

  const running = !!state.running;
  const currentSymbol = state.currentSymbol;
  const progress = state.progress || { done: 0, total: 0 };
  const results = useMemo(() => (Array.isArray(state.results) ? state.results.slice() : []), [state.results]);

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
      if (!results || results.length === 0) return;
      const top = results[0];
      if (!top) return;
      const id = (top && top.id) ? top.id : `${top.symbol || ''}::${top.time || ''}::${top.emaShort || ''}::${top.emaLong || ''}`;
      if (shownResultsRef.current.has(id)) return;
      // mark shown and play beep only for new results
      shownResultsRef.current.add(id);
      try { beep(); } catch (e) {}
    } catch (e) {}
  }, [results]);

  return (
  <div className="alerts">
      {/* modal removed: only play beep when a new match is detected */}
      <div className="alerts-title">Binance EMA Cross Scanner</div>
  <div className="panel scanner-panel">
        <div className="scanner-controls-left">
          <label className="control-inline-label">
            <span className="label-text">Mins</span>
            <input type="number" min="1" value={minsStr} onChange={(e) => setMinsStr(e.target.value)} onBlur={() => {
              const p = parseInt(minsStr, 10);
              if (Number.isFinite(p) && p > 0) saveScannerDefaults(p, parseInt(ema1Str, 10) || '', parseInt(ema2Str, 10) || '');
            }} />
          </label>
          <label className="control-inline-label">
            <span className="label-text">EMA1</span>
            <input type="number" min="1" value={ema1Str} onChange={(e) => setEma1Str(e.target.value)} onBlur={() => {
              const p = parseInt(ema1Str, 10);
              if (Number.isFinite(p) && p > 0) saveScannerDefaults(parseInt(minsStr, 10) || '', p, parseInt(ema2Str, 10) || '');
            }} />
          </label>
          <label className="control-inline-label">
            <span className="label-text">EMA2</span>
            <input type="number" min="1" value={ema2Str} onChange={(e) => setEma2Str(e.target.value)} onBlur={() => {
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
            return (
              <div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} className="progress-fill" style={{ width: `${pct}%` }} />
            );
          })()}
        </div>
      </div>

      <ul className="alerts-list">
        {results.length === 0 ? (
          <li className="alert-item no-results">No matches yet.</li>
        ) : (
          results.map((r, idx) => (
            <li key={r.id || `${r.symbol}-${idx}`} className="alert-item">
              <div className="alert-left">
                <span className={`alert-indicator bull`} />
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
                        // fallback for older browsers
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
                  <div className="alert-type-short">Match</div>
                  <div className="alert-time">{r.time}</div>
                </div>
                <div className="alert-right">
                  <div className="alert-price">{
                    Number.isFinite(Number(r.lastShort ?? r.last26)) ? Number(r.lastShort ?? r.last26).toFixed(6) : '-'
                  } / {
                    Number.isFinite(Number(r.lastLong ?? r.last200)) ? Number(r.lastLong ?? r.last200).toFixed(6) : '-'
                  }</div>
                  <button type="button" className="delete-result" title="Remove" onClick={() => { try { scannerManager.removeResult(r.id); } catch (e) {} }}>
                    ✕
                  </button>
                </div>
              </div>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}
