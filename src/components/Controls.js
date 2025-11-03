import React, { useRef } from 'react';
import PropTypes from 'prop-types';

export default function Controls(props) {
  const {
    symbol,
    setSymbol,
    autoStart,
    setAutoStart,
    symbolValid,
  setSymbolValid,
  suggestions,
  setSuggestions,
    availableSymbols,
    validateSymbolOnce,
    connect,
    disconnect,
    status,
    connected,
    showDebug,
    setShowDebug,
  } = props;

  const symbolValidateTimer = useRef(null);
  // reference suggestions to avoid lint 'assigned but not used' when parent passes it
  void suggestions;

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
                  try { if (autoStart) connect(q); } catch (e) {}
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

      <button disabled={!(symbolValid === true) || status === 'reloading'} title={!(symbolValid === true) ? '유효한 심볼을 입력하세요' : (status === 'reloading' ? '초기화 중...' : 'Start')} onClick={async () => {
        const ok = await validateSymbolOnce(symbol);
        if (!ok) { setSymbolValid(false); return; }
        setSymbolValid(true);
        connect(symbol);
      }}>Start</button>

      <button className="secondary" onClick={() => disconnect()}>Stop</button>

      <label className="control-inline-label">
        <input type="checkbox" checked={autoStart} onChange={(e) => {
          const val = e.target.checked;
          setAutoStart(val);
          if (!val) disconnect();
          if (val && status === 'initialized' && !connected) connect();
        }} />
        <span className="label-text">Auto-start</span>
      </label>

      <label className="control-inline-label">
        <input type="checkbox" checked={showDebug} onChange={(e) => setShowDebug(e.target.checked)} />
        <span className="label-text">Debug</span>
      </label>

    </div>
  );
}

Controls.propTypes = {
  symbol: PropTypes.string.isRequired,
  setSymbol: PropTypes.func.isRequired,
  autoStart: PropTypes.bool.isRequired,
  setAutoStart: PropTypes.func.isRequired,
  symbolValid: PropTypes.bool,
  setSymbolValid: PropTypes.func.isRequired,
  setSuggestions: PropTypes.func.isRequired,
  availableSymbols: PropTypes.array,
  validateSymbolOnce: PropTypes.func.isRequired,
  connect: PropTypes.func.isRequired,
  disconnect: PropTypes.func.isRequired,
  status: PropTypes.string,
  connected: PropTypes.bool,
  showDebug: PropTypes.bool.isRequired,
  setShowDebug: PropTypes.func.isRequired,
};
