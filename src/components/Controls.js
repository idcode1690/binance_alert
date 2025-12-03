/* eslint-disable no-unused-vars */
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
    // optional runtime server controls (removed from UI)
    // monitoring controls (parent values)
    monitorMinutes,
    setMonitorMinutes,
    monitorEma1,
    setMonitorEma1,
    monitorEma2,
    setMonitorEma2,
  monitorConfirm, // kept for internal logic (not displayed)
  // setMonitorConfirm removed from UI and not used
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
  // Confirm 입력 UI 제거: 부모 상태는 다른 컴포넌트/알림 로직에서만 사용됨.
  void monitorConfirm;
  const commitTimersRef = useRef({ ema1: null, ema2: null });

  // keep local strings in sync if parent updates (e.g., persisted restore)
  useEffect(() => { setMinsStr(String(monitorMinutes ?? '')); }, [monitorMinutes]);
  useEffect(() => { setEma1Str(String(monitorEma1 ?? '')); }, [monitorEma1]);
  useEffect(() => { setEma2Str(String(monitorEma2 ?? '')); }, [monitorEma2]);
  // Confirm 값 변화에 따른 로컬 UI 처리 제거됨

  // Server URL runtime override UI removed — app will use build-time/default server settings.

  return (
    <div className="panel scanner-panel">
      <div className="scanner-controls-left">
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

        <div className="control-inline-label" style={{ marginLeft: 8 }}>
          <span className="label-text">Mins</span>
          <div className="interval-btns" style={{ display: 'inline-flex', gap: 6, marginLeft: 8 }}>
          {[
            { label: '1m', val: '1' },
            { label: '5m', val: '5' },
            { label: '30m', val: '30' },
            { label: '4h', val: '240' },
          ].map((it) => (
            <button
              key={it.val}
              type="button"
              className={`small-interval-btn ${String(minsStr) === String(it.val) ? 'active' : ''}`}
              onClick={() => {
                setMinsStr(String(it.val));
                try {
                  const p = parseInt(it.val, 10);
                  if (Number.isFinite(p) && p > 0) setMonitorMinutes(p);
                } catch (e) {}
              }}
            >
              {it.label}
            </button>
          ))}
          </div>
        </div>

        <label className="control-inline-label">
          <span className="label-text">EMA1</span>
          <input
            className="ema-input"
            size="5"
            style={{ width: '5ch' }}
            type="number"
            min="1"
            value={ema1Str}
            onChange={(e) => {
              const v = e.target.value;
              setEma1Str(v);
              try {
                if (commitTimersRef.current.ema1) clearTimeout(commitTimersRef.current.ema1);
                commitTimersRef.current.ema1 = setTimeout(() => {
                  const p = parseInt(v, 10);
                  if (!Number.isFinite(p) || p <= 0) return;
                  setMonitorEma1(p);
                }, 600);
              } catch (err) {}
            }}
            onBlur={() => {
              const p = parseInt(ema1Str, 10);
              if (!Number.isFinite(p) || p <= 0) return;
              setMonitorEma1(p);
            }}
          />
        </label>

        <label className="control-inline-label">
          <span className="label-text">EMA2</span>
          <input
            className="ema-input"
            size="5"
            style={{ width: '5ch' }}
            type="number"
            min="1"
            value={ema2Str}
            onChange={(e) => {
              const v = e.target.value;
              setEma2Str(v);
              try {
                if (commitTimersRef.current.ema2) clearTimeout(commitTimersRef.current.ema2);
                commitTimersRef.current.ema2 = setTimeout(() => {
                  const p = parseInt(v, 10);
                  if (!Number.isFinite(p) || p <= 0) return;
                  setMonitorEma2(p);
                }, 600);
              } catch (err) {}
            }}
            onBlur={() => {
              const p = parseInt(ema2Str, 10);
              if (!Number.isFinite(p) || p <= 0) return;
              setMonitorEma2(p);
            }}
          />
        </label>
      </div>

      <div className="scanner-controls">
        <span className="mobile-alert-label" aria-hidden>Mobile Alert</span>
        {/* Replaced Start/Stop with a single Mobile Notify toggle button. */}
        <MobileNotifyToggle validateSymbolOnce={validateSymbolOnce} symbol={symbol} showToast={props.showToast} />
      </div>

    </div>
  );
}

function MobileNotifyToggle({ validateSymbolOnce, symbol, showToast }) {
  const [enabled, setEnabled] = React.useState(() => {
    try {
      const raw = localStorage.getItem('mobileNotifyEnabled');
      if (raw === null) return true; // default ON
      return raw === 'true';
    } catch (e) { return true; }
  });

  const toggle = async () => {
    const next = !enabled;
    try {
      localStorage.setItem('mobileNotifyEnabled', next ? 'true' : 'false');
    } catch (e) {}
    setEnabled(next);
    try { if (showToast) showToast(`Mobile notifications ${next ? 'enabled' : 'disabled'}`); } catch (e) {}
  };

  return (
    <button type="button" className={`mobile-toggle ${enabled ? 'active' : ''}`} title={enabled ? 'Disable mobile notifications' : 'Enable mobile notifications'} onClick={toggle} aria-pressed={!!enabled} aria-label={enabled ? 'Mobile notifications on' : 'Mobile notifications off'}>
      <span className="switch-track" aria-hidden>
        <span className="switch-inner">{enabled ? 'Mobile: ON' : 'Mobile: OFF'}</span>
        <span className="switch-knob" />
      </span>
    </button>
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
  // optional runtime server controls
  // serverUrl / set/clear UI removed — no runtime server override props
};
