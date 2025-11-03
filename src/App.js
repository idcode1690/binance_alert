import './App.css';
import React, { useEffect, useRef, useState } from 'react';
import useEmaCross from './hooks/useEmaCross';
import Alerts from './components/Alerts';
import Metrics from './components/Metrics';
import Controls from './components/Controls';
import DebugPanel from './components/DebugPanel';
import Notes from './components/Notes';

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

function App() {
  const [symbol, setSymbol] = useState('BTCUSDT');
  const [autoStart, setAutoStart] = useState(true);
  const [symbolValid, setSymbolValid] = useState(null); // null=unknown, true/false
  // symbolValidateTimer moved into Controls component
  const [availableSymbols, setAvailableSymbols] = useState(null);
  const [showDebug, setShowDebug] = useState(false);
  const [suggestions, setSuggestions] = useState([]);
  const [marketCheckResult, setMarketCheckResult] = useState(null);
  // helper to fetch exchangeInfo and populate availableSymbols
  async function fetchExchangeInfo() {
    try {
      // default to Binance Futures (USDT-M) exchangeInfo for symbols
      const res = await fetch('https://fapi.binance.com/fapi/v1/exchangeInfo');
      if (!res.ok) {
        console.warn('exchangeInfo fetch failed', res.status);
        setAvailableSymbols([]);
        return;
      }
      const data = await res.json();
      const syms = (data.symbols || []).map(s => s.symbol);
      setAvailableSymbols(syms);
    } catch (e) {
      console.warn('exchangeInfo fetch error', e);
      setAvailableSymbols([]);
    }
  }

  // fetch full symbol list once on mount for reliable validation
  useEffect(() => {
    fetchExchangeInfo();
  }, []);

  // helper to validate a symbol (returns true/false)
  async function validateSymbolOnce(s) {
    const q = (s || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    if (!q) return false;
    // If we have a cached symbol list, compare using a normalized form (strip non-alnum, uppercase)
    if (availableSymbols && availableSymbols.length > 0) {
      const normQ = q;
      for (const sym of availableSymbols) {
        const normSym = (sym || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
        if (normSym === normQ) return true;
      }
      return false;
    }
    // Fallback to exchangeInfo query for the single symbol
    try {
      // fallback to Binance Futures exchangeInfo lookup
      const res = await fetch(`https://fapi.binance.com/fapi/v1/exchangeInfo?symbol=${q}`);
      if (!res.ok) return false;
      const data = await res.json();
      // if API returned an object with matching symbol(s), accept it
      if (data && Array.isArray(data.symbols) && data.symbols.length > 0) return true;
      if (data && data.symbol) return true;
      return false;
    } catch (e) {
      return false;
    }
  }

  // if symbol becomes invalid, disable autoStart and disconnect to avoid wrong subscriptions
  // (moved below after hook initialization because it depends on connected/disconnect)
  const { ema9, ema26, lastPrice, lastCandleClosed, cross, confirmedCross, confirmedSource, connected, status, connect, disconnect, activeSymbol } = useEmaCross({ symbol, autoConnect: autoStart, debug: showDebug });

  // 자동 연결: symbol이 유효하고 autoStart가 켜져 있으면 Start 버튼을 누르지 않아도 connect 호출
  useEffect(() => {
    try {
      const q = (symbol || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
      if (q && symbolValid === true && autoStart) {
        // avoid calling connect if already active for this symbol
        if (!activeSymbol || activeSymbol.toString().toUpperCase() !== q) {
          connect(q);
        }
      }
    } catch (e) {
      // ignore
    }
  }, [symbol, symbolValid, autoStart, activeSymbol, connect]);
  const [events, setEvents] = useState([]);
  const lastNotified = useRef(null);

  // clearAlerts will be handled inline if needed; no export/import UI

  // --- localStorage에 Alerts 저장/복원 헬퍼 ---
  const ALERTS_LS_KEY = 'alerts';
  function saveAlertsToLocalStorage(arr) {
    try {
      if (!Array.isArray(arr)) return;
      // 저장 크기 제한을 위해 최신 500개(로컬스토리지라 쿠키보다 여유)
      const toStore = JSON.stringify(arr.slice(0, 500));
      localStorage.setItem(ALERTS_LS_KEY, toStore);
    } catch (e) {
      // ignore
    }
  }

  function loadAlertsFromLocalStorage() {
    try {
      const raw = localStorage.getItem(ALERTS_LS_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
      return null;
    } catch (e) {
      return null;
    }
  }

  // 복원: 마운트 시 localStorage에서 alerts 복원 (7일 초과 항목은 제거)
  useEffect(() => {
    try {
      const saved = loadAlertsFromLocalStorage();
      if (saved && Array.isArray(saved) && saved.length > 0) {
        const cutoff = Date.now() - 1000 * 60 * 60 * 24 * 7; // 7 days
        const filtered = saved.filter((ev) => {
          if (!ev) return false;
          if (typeof ev.ts === 'number') return ev.ts >= cutoff;
          // try parse time string as fallback
          const parsed = Date.parse(ev.time || '');
          if (!isNaN(parsed)) return parsed >= cutoff;
          return false;
        });
        setEvents(filtered);
      }
    } catch (e) {}
  }, []);

  // 저장: events가 바뀔 때마다 localStorage에 반영 (저장 전에 7일 초과 항목 제거)
  useEffect(() => {
    try {
      const cutoff = Date.now() - 1000 * 60 * 60 * 24 * 7; // 7 days
      const filtered = (events || []).filter((ev) => {
        if (!ev) return false;
        if (typeof ev.ts === 'number') return ev.ts >= cutoff;
        const parsed = Date.parse(ev.time || '');
        if (!isNaN(parsed)) return parsed >= cutoff;
        return false;
      });
      saveAlertsToLocalStorage(filtered);
    } catch (e) {}
  }, [events]);

  // Alerts 항목 삭제 핸들러 (ts 기반으로 고유 항목 제거)
  function removeAlertByTs(ts) {
    try {
      const next = (events || []).filter((ev) => ev && ev.ts !== ts);
      setEvents(next);
    } catch (e) {}
  }

  // if symbol becomes invalid, disable autoStart and disconnect to avoid wrong subscriptions
  useEffect(() => {
    if (symbolValid === false) {
      if (autoStart) setAutoStart(false);
      // ensure disconnected
      if (connected) disconnect();
    }
    // include dependencies to avoid stale closures
  }, [symbolValid, autoStart, connected, disconnect]);

  // Ask for notification permission on first user interaction
  useEffect(() => {
    const handle = () => {
      if ('Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission().then(() => {});
      }
      window.removeEventListener('click', handle);
    };
    window.addEventListener('click', handle);
    return () => window.removeEventListener('click', handle);
  }, []);

  // react to confirmed cross changes and notify (skip initial)
  useEffect(() => {
    if (!confirmedCross) return;
    // If the confirmed signal came from initial seeding, don't notify — treat as seeded state
    if (confirmedSource === 'init') {
      // ensure we don't trigger notification for seed values
      lastNotified.current = confirmedCross;
      return;
    }
    if (lastNotified.current == null) {
      // seed without notifying
      lastNotified.current = confirmedCross;
      return;
    }

    if (lastNotified.current !== confirmedCross) {
      const type = confirmedCross === 'bull' ? 'Bullish EMA9 > EMA26' : 'Bearish EMA9 < EMA26';
      const symToShow = activeSymbol || symbol;
      const body = `${symToShow} ${type} @ ${lastPrice ?? 'N/A'}`;

      // browser notification
      if ('Notification' in window && Notification.permission === 'granted') {
        new Notification(type, { body });
      }

      // beep and log
      beep();
      const evObj = { ts: Date.now(), time: new Date().toLocaleString(), type: confirmedCross, price: lastPrice, symbol: symToShow, source: confirmedSource || 'unknown' };
      setEvents((s) => [evObj, ...s].slice(0, 500));
      lastNotified.current = confirmedCross;
    }
  }, [confirmedCross, lastPrice, symbol, activeSymbol, confirmedSource]);

  // 심볼이 바뀔 때 이전 심볼의 알림 상태가 남아 있어 잘못된 알림이 뜨는 문제 방지
  // 심볼을 변경하면 lastNotified를 초기화해서 다음 confirmedCross는 초기 시드로 처리되도록 한다.
  useEffect(() => {
    try {
      lastNotified.current = null;
    } catch (e) {}
  }, [symbol]);

  return (
    <div className="App">
      <div className="container">
        <div className="card">
          <div className="header">
            <div className="title">Binance EMA Cross Alert</div>
            <div className="header-right">1m · EMA9 / EMA26</div>
          </div>

          <Controls
            symbol={symbol}
            setSymbol={setSymbol}
            autoStart={autoStart}
            setAutoStart={setAutoStart}
            symbolValid={symbolValid}
            setSymbolValid={setSymbolValid}
            suggestions={suggestions}
            setSuggestions={setSuggestions}
            availableSymbols={availableSymbols}
            validateSymbolOnce={validateSymbolOnce}
            connect={connect}
            disconnect={disconnect}
            status={status}
            connected={connected}
            showDebug={showDebug}
            setShowDebug={setShowDebug}
          />
          {/* 간단한 로딩 표시: 심볼 변경으로 상태가 reloading일 때 보임 */}
          {status === 'reloading' && (
            <div className="loading-text">초기화 중... 잠시만 기다려주세요</div>
          )}
          {symbolValid === false && (
            <div className="invalid-msg">
              Invalid symbol — please check the trading pair (e.g. BTCUSDT)
              {suggestions && suggestions.length > 0 && (
                <div className="suggestions-wrap">
                  <div className="suggestions-title">Did you mean:</div>
                  <div className="suggestions-list">
                    {suggestions.map((s) => (
                      <button key={s} className="suggestion-btn" onClick={() => {
                        setSymbol(s);
                        setSymbolValid(true);
                        setSuggestions([]);
                        try { if (autoStart) connect(s); } catch (e) {}
                      }}>{s}</button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          <DebugPanel availableSymbols={availableSymbols} fetchExchangeInfo={fetchExchangeInfo} showDebug={showDebug} setMarketCheckResult={setMarketCheckResult} marketCheckResult={marketCheckResult} symbol={symbol} />

          <div className="status">
            Status: <strong>{status}</strong> {connected ? <span className="status-connected">(connected)</span> : <span className="status-disconnected">(disconnected)</span>}
          </div>

          <Metrics activeSymbol={activeSymbol} symbol={symbol} lastPrice={lastPrice} lastCandleClosed={lastCandleClosed} cross={cross} confirmedCross={confirmedCross} ema9={ema9} ema26={ema26} />

          <Alerts events={events} removeAlertByTs={removeAlertByTs} />

          <Notes>Notes: This app uses Binance public REST + websocket. Make sure network allows wss access to stream.binance.com.</Notes>
        </div>
      </div>
    </div>
  );
}

export default App;
