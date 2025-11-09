import React, { useRef, useState, useEffect } from 'react';
import PropTypes from 'prop-types';

export default function Controls(props) {
  const {
    symbol,
    setSymbol,
    symbolValid,
    setSymbolValid,
    suggestions,
    setSuggestions,
    availableSymbols,
    validateSymbolOnce,
    connect,
    disconnect,
  status,
    // monitoring controls (parent values)
    monitorMinutes,
    setMonitorMinutes,
    monitorEma1,
    setMonitorEma1,
    monitorEma2,
    setMonitorEma2,
    monitorConfirm,
    setMonitorConfirm,
  } = props;

  const symbolValidateTimer = useRef(null);
  // reference suggestions to avoid lint 'assigned but not used' when parent passes it
  void suggestions;

  // Local string states to avoid writing parent numeric values on every keystroke.
  // This lets the user clear the field (empty string) and type a single digit without it
  // snapping back to 0. We commit the numeric value to the parent onBlur or when Start is pressed.
  const [minsStr, setMinsStr] = useState(String(monitorMinutes ?? ''));
  const [ema1Str, setEma1Str] = useState(String(monitorEma1 ?? ''));
  const [ema2Str, setEma2Str] = useState(String(monitorEma2 ?? ''));
  const [confirmStr, setConfirmStr] = useState(String(monitorConfirm ?? ''));

  // keep local strings in sync if parent updates (e.g., persisted restore)
  useEffect(() => { setMinsStr(String(monitorMinutes ?? '')); }, [monitorMinutes]);
  useEffect(() => { setEma1Str(String(monitorEma1 ?? '')); }, [monitorEma1]);
  useEffect(() => { setEma2Str(String(monitorEma2 ?? '')); }, [monitorEma2]);
  useEffect(() => { setConfirmStr(String(monitorConfirm ?? '')); }, [monitorConfirm]);

  return (
    <div className="controls">
      <label className="controls-label">
        <span className="label-text">Symbol</span>
        <input type="text" value={symbol} onChange={(e) => {
          const v = e.target.value.toUpperCase();
          setSymbol(v);
          setSymbolValid(null);
          if (symbolValidateTimer.current) clearTimeout(symbolValidateTimer.current);
          symbolValidateTimer.current = setTimeout(() => {
            try {
              const q = v.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
              const pool = availableSymbols || [];
              if (pool.length > 0) {
                const normQ = q;
                const exact = pool.some(sy => (sy || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase() === normQ) || pool.includes(q);
                if (exact) {
                  setSymbolValid(true);
                  setSuggestions([]);
                  return;
                }
                const found = pool.filter(s => s.includes(q) || s.startsWith(q) || q.startsWith(s)).slice(0, 8);
                setSuggestions(found);
                setSymbolValid(found.length > 0 ? null : false);
                return;
              }

              (async () => {
                try {
                  const url = `https://api.binance.com/api/v3/exchangeInfo?symbol=${q}`;
                  const res = await fetch(url);
                  if (!res.ok) { setSymbolValid(false);return; }
                  const data = await res.json();
                  if (data && (data.symbols || data.symbol)) setSymbolValid(true);
                  else setSymbolValid(false);
                } catch (err) { setSymbolValid(false); }
              })();
            } catch (err) { setSymbolValid(false); setSuggestions([]); }
          }, 600);
        }} />
      </label>

      <label className="control-inline-label" style={{marginLeft:8}}>
        <span className="label-text">Mins</span>
        <input type="number" min="1" value={minsStr} onChange={(e) => { setMinsStr(e.target.value); }} onBlur={() => {
          // commit only on blur: avoid forcing 0 while typing
          const p = parseInt(minsStr, 10);
          if (!Number.isFinite(p) || p <= 0) return; // don't overwrite parent's valid value with empty/invalid
          setMonitorMinutes(p);
        }} />
      </label>

      <label className="control-inline-label">
        <span className="label-text">EMA1</span>
        <input type="number" min="1" value={ema1Str} onChange={(e) => { setEma1Str(e.target.value); }} onBlur={() => {
          const p = parseInt(ema1Str, 10);
          if (!Number.isFinite(p) || p <= 0) return;
          setMonitorEma1(p);
        }} />
      </label>

      <label className="control-inline-label">
        <span className="label-text">EMA2</span>
        <input type="number" min="1" value={ema2Str} onChange={(e) => { setEma2Str(e.target.value); }} onBlur={() => {
          const p = parseInt(ema2Str, 10);
          if (!Number.isFinite(p) || p <= 0) return;
          setMonitorEma2(p);
        }} />
      </label>

      <label className="control-inline-label">
        <span className="label-text">Confirm</span>
        <input type="number" min="1" value={confirmStr} onChange={(e) => { setConfirmStr(e.target.value); }} onBlur={() => {
          const p = parseInt(confirmStr, 10);
          if (!Number.isFinite(p) || p <= 0) return;
          setMonitorConfirm(p);
        }} />
      </label>

      <button disabled={!(symbolValid === true) || status === 'reloading'} title={!(symbolValid === true) ? '유효한 심볼을 입력하세요' : (status === 'reloading' ? '초기화 중...' : 'Start')} onClick={async () => {
        const ok = await validateSymbolOnce(symbol);
        if (!ok) { setSymbolValid(false); return; }
        setSymbolValid(true);
        // commit any local input values before connecting
        const mins = parseInt(minsStr, 10);
        const ema1 = parseInt(ema1Str, 10);
        const ema2 = parseInt(ema2Str, 10);
        if (Number.isFinite(mins) && mins > 0) setMonitorMinutes(mins);
        if (Number.isFinite(ema1) && ema1 > 0) setMonitorEma1(ema1);
        if (Number.isFinite(ema2) && ema2 > 0) setMonitorEma2(ema2);
        // pass monitoring options to connect (App will accept and forward to server)
        try {
          connect(symbol, { interval: mins > 0 ? mins : monitorMinutes, emaShort: ema1 > 0 ? ema1 : monitorEma1, emaLong: ema2 > 0 ? ema2 : monitorEma2 });
        } catch (e) {
          connect(symbol);
        }
      }}>Start</button>

      <button className="secondary" onClick={() => disconnect()}>Stop</button>

      <button className="secondary" style={{marginLeft:8}}
        title="Set Cloudflare Worker URL for Telegram relay"
        onClick={() => {
          try {
            const cur = (typeof localStorage !== 'undefined') ? (localStorage.getItem('serverUrl') || '') : '';
            const v = window.prompt('Set Worker URL (e.g. https://<name>.workers.dev)', cur);
            if (v == null) return;
            const trimmed = String(v).trim();
            if (trimmed) localStorage.setItem('serverUrl', trimmed);
            else localStorage.removeItem('serverUrl');
            window.location.reload();
          } catch (e) {}
        }}>
        Set Server URL
      </button>

      <button className="secondary" style={{marginLeft:8}}
        title="Send a test Telegram message via /send-alert"
        onClick={async () => {
          try {
            const serverUrl = (() => {
              try { const s = localStorage.getItem('serverUrl') || ''; if (s) return s.replace(/\/$/, ''); } catch (e) {}
              return '';
            })();
            if (!serverUrl) { alert('No serverUrl set. Click Set Server URL first.'); return; }
            const sym = (symbol || '').toString().replace(/[^A-Za-z0-9]/g,'').toUpperCase() || 'TESTUSDT';
            const payload = { symbol: sym, message: `[TEST] manual send from UI`, emaShort: Number(monitorEma1)||26, emaLong: Number(monitorEma2)||200 };
            const res = await fetch(`${serverUrl}/send-alert`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
            const json = await res.json().catch(() => null);
            alert(`send-alert ${res.ok ? 'OK' : 'FAIL'} (${res.status})\n${JSON.stringify(json)}`);
          } catch (e) {
            alert('send-alert error: ' + String(e));
          }
        }}>
        Test Telegram
      </button>

      {/* removed Auto-start and Debug checkboxes as requested */}

    </div>
  );
}

Controls.propTypes = {
  symbol: PropTypes.string.isRequired,
  setSymbol: PropTypes.func.isRequired,
  symbolValid: PropTypes.bool,
  setSymbolValid: PropTypes.func.isRequired,
  setSuggestions: PropTypes.func.isRequired,
  availableSymbols: PropTypes.array,
  validateSymbolOnce: PropTypes.func.isRequired,
  connect: PropTypes.func.isRequired,
  disconnect: PropTypes.func.isRequired,
  status: PropTypes.string,
  connected: PropTypes.bool,
  // monitoring props
  monitorMinutes: PropTypes.number.isRequired,
  setMonitorMinutes: PropTypes.func.isRequired,
  monitorEma1: PropTypes.number.isRequired,
  setMonitorEma1: PropTypes.func.isRequired,
  monitorEma2: PropTypes.number.isRequired,
  setMonitorEma2: PropTypes.func.isRequired,
  monitorConfirm: PropTypes.number.isRequired,
  setMonitorConfirm: PropTypes.func.isRequired,
};
