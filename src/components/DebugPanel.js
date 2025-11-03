import React from 'react';
import PropTypes from 'prop-types';

export default function DebugPanel({ availableSymbols, fetchExchangeInfo, showDebug, setMarketCheckResult, marketCheckResult, symbol }) {
  if (!showDebug) return null;
  return (
    <div className="debug-panel">
      <div className="debug-title">Debug info</div>
      <div className="debug-available">Available symbols: {availableSymbols ? availableSymbols.length : 'loading'}</div>
      <div className="debug-block">
        Normalized match for <strong>{symbol}</strong>: {
          (() => {
            try {
              if (!availableSymbols || availableSymbols.length === 0) return 'no data';
              const q = (symbol || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
              const found = availableSymbols.some(sy => (sy || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase() === q);
              return found ? 'YES' : 'NO';
            } catch (e) { return 'err'; }
          })()
        }
      </div>
      <div className="debug-actions">
        <button className="small-btn" onClick={() => fetchExchangeInfo()}>Reload symbols</button>
        <button className="small-btn" onClick={() => console.log('availableSymbols sample', (availableSymbols || []).slice(0, 50))}>Log sample</button>
        <button className="small-btn" onClick={async () => {
          setMarketCheckResult('checking...');
          try {
            const q = (symbol || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
            if (!q) { setMarketCheckResult('No symbol entered'); return; }
            const endpoints = [
              { name: 'Spot (api.binance.com)', url: `https://api.binance.com/api/v3/exchangeInfo` },
              { name: 'Futures USDT-M (fapi.binance.com)', url: `https://fapi.binance.com/fapi/v1/exchangeInfo` },
              { name: 'Futures COIN-M (dapi.binance.com)', url: `https://dapi.binance.com/dapi/v1/exchangeInfo` },
            ];
            const results = [];
            for (const e of endpoints) {
              try {
                const res = await fetch(e.url);
                if (!res.ok) { results.push(`${e.name}: fetch failed ${res.status}`); continue; }
                const data = await res.json();
                const found = Array.isArray(data.symbols) && data.symbols.some(s => ((s.symbol||'').replace(/[^A-Za-z0-9]/g,'').toUpperCase()) === q);
                results.push(`${e.name}: ${found ? 'FOUND' : 'not found'}`);
              } catch (err) {
                results.push(`${e.name}: error`);
              }
            }
            setMarketCheckResult(results.join(' | '));
            console.log('market check', results);
          } catch (err) {
            setMarketCheckResult('error');
          }
        }}>Check markets</button>
      </div>
      {marketCheckResult && <div className="market-result">{marketCheckResult}</div>}
    </div>
  );
}

DebugPanel.propTypes = {
  availableSymbols: PropTypes.array,
  fetchExchangeInfo: PropTypes.func.isRequired,
  showDebug: PropTypes.bool.isRequired,
  setMarketCheckResult: PropTypes.func.isRequired,
  marketCheckResult: PropTypes.string,
  symbol: PropTypes.string,
};
