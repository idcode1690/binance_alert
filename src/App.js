import './App.css';
import React, { useEffect, useRef, useState } from 'react';
import useEmaCross from './hooks/useEmaCross';
import Alerts from './components/Alerts';
import Metrics from './components/Metrics';
import Controls from './components/Controls';
import DebugPanel from './components/DebugPanel';
import Notes from './components/Notes';
import Header from './components/Header';
import TopMenu from './components/TopMenu';
import ScannerPage from './pages/ScannerPage';
import scannerManager from './lib/scannerManager';

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
  const [symbol, setSymbol] = useState(() => {
    try {
      const raw = localStorage.getItem('lastSymbol');
      if (raw && typeof raw === 'string') return raw.toString().replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    } catch (e) {}
    return 'BTCUSDT';
  });
  const [autoStart, setAutoStart] = useState(true);
  const [symbolValid, setSymbolValid] = useState(null); // null=unknown, true/false
  // symbolValidateTimer moved into Controls component
  const [availableSymbols, setAvailableSymbols] = useState(null);
  const [showDebug] = useState(false);
  const [suggestions, setSuggestions] = useState([]);
  // monitoring inputs (minutes + EMA short/long)
  const [monitorMinutes, setMonitorMinutes] = useState(() => {
    try {
      const raw = localStorage.getItem('lastMonitor');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed.monitorMinutes !== 'undefined') return Number(parsed.monitorMinutes) || 5;
      }
    } catch (e) {}
    return 5;
  });
  const [monitorEma1, setMonitorEma1] = useState(() => {
    try {
      const raw = localStorage.getItem('lastMonitor');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed.monitorEma1 !== 'undefined') return Number(parsed.monitorEma1) || 26;
      }
    } catch (e) {}
    return 26;
  });
  const [monitorEma2, setMonitorEma2] = useState(() => {
    try {
      const raw = localStorage.getItem('lastMonitor');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed.monitorEma2 !== 'undefined') return Number(parsed.monitorEma2) || 200;
      }
    } catch (e) {}
    return 200;
  });
  const [monitorConfirm] = useState(() => {
    try {
      const raw = localStorage.getItem('lastMonitor');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed.monitorConfirm !== 'undefined') return Number(parsed.monitorConfirm) || 1;
      }
    } catch (e) {}
    return 1;
  });
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
  // fetch full symbol list once on mount for reliable validation
  // eslint-disable-next-line react-hooks/exhaustive-deps
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
  // Disable hook autoConnect: App will control connecting so we can update server monitor symbol first
  const { ema9, ema26, lastPrice, lastTick, lastCandleClosed, cross, confirmedCross, confirmedSource, connected, status, connect, disconnect, activeSymbol } = useEmaCross({ symbol, autoConnect: true, debug: showDebug, interval: `${monitorMinutes}m`, emaShort: monitorEma1, emaLong: monitorEma2, confirmClosedCandles: monitorConfirm });

  
  
  const [events, setEvents] = useState([]);
  const [toast, setToast] = useState(null);
  // Helper: detect duplicate events and add only if not duplicate
  // Dedup logic: consider events duplicate if symbol + type match and their timestamps are within 5s,
  // or if price matches exactly and symbol+type match. This helps avoid server+client duplicate alerts.
  const isDuplicateEvent = React.useCallback((newEv, existing) => {
    try {
      if (!existing || !newEv) return false;
      const aSym = (existing.symbol || '').toString().replace(/[^A-Za-z0-9]/g, '').toUpperCase();
      const bSym = (newEv.symbol || '').toString().replace(/[^A-Za-z0-9]/g, '').toUpperCase();
      if (!aSym || !bSym || aSym !== bSym) return false;
      if ((existing.type || '') !== (newEv.type || '')) return false;
      // exact price match
      if (typeof existing.price !== 'undefined' && typeof newEv.price !== 'undefined' && String(existing.price) === String(newEv.price)) return true;
      // timestamp proximity (use ts if available, otherwise parse time)
      const aTs = typeof existing.ts === 'number' ? existing.ts : (Date.parse(existing.time || '') || 0);
      const bTs = typeof newEv.ts === 'number' ? newEv.ts : (Date.parse(newEv.time || '') || 0);
      if (aTs && bTs && Math.abs(aTs - bTs) <= 5000) return true;
    } catch (e) {}
    return false;
  }, []);

  const addEvent = React.useCallback((ev) => {
    setEvents((prev) => {
      try {
        if (Array.isArray(prev) && prev.some((p) => isDuplicateEvent(ev, p))) {
          if (showDebug) console.debug('[App] suppressed duplicate event', ev);
          return prev;
        }
      } catch (e) {}
      return [ev, ...prev].slice(0, 500);
    });
  }, [isDuplicateEvent, showDebug]);
  // Wire scannerManager to provide available symbols and forward matches into App events
  useEffect(() => {
    try {
      scannerManager.setGetSymbols(() => availableSymbols || []);
      const off = scannerManager.onUpdate((s) => {
        try {
          // s.results contains matches; forward them as 'alert' events into the main events list
          if (s && Array.isArray(s.results) && s.results.length > 0) {
            for (const r of s.results) {
              try {
                const priceVal = (typeof r.lastShort !== 'undefined' && r.lastShort != null) ? r.lastShort : ((typeof r.lastLong !== 'undefined' && r.lastLong != null) ? r.lastLong : (typeof r.price !== 'undefined' ? r.price : null));
                const ev = { ts: Date.now(), time: r.time || new Date().toLocaleString(), type: 'alert', price: priceVal, symbol: (r.symbol || '').toString().replace(/[^A-Za-z0-9]/g, '').toUpperCase(), source: 'scanner' };
                addEvent(ev);
              } catch (e) {}
            }
          }
        } catch (e) {}
      });
      return () => { try { off(); } catch (e) {} };
    } catch (e) {}
  }, [availableSymbols, addEvent]);
  const showToast = React.useCallback((message, ok = true) => {
    try {
      setToast({ message, ok, ts: Date.now() });
      // auto-dismiss after 5s
      setTimeout(() => {
        try { setToast(null); } catch (e) {}
      }, 5000);
    } catch (e) {}
  }, []);
  const lastNotified = useRef(null);
  const [sseConnected, setSseConnected] = useState(false);
  const [serverSymbol, setServerSymbol] = useState(null);
  const [lastHealthyAt, setLastHealthyAt] = useState(null);
  const [telegramConfigured, setTelegramConfigured] = useState(null); // null=unknown, true/false
  const [view, setView] = useState('alerts');
  // serverUrl is provided at build-time via REACT_APP_SERVER_URL; when not set
  // the app should run in "client-only" mode (no SSE, no server Telegram relay).
  const serverUrl = (process.env.REACT_APP_SERVER_URL && process.env.REACT_APP_SERVER_URL.length > 0) ? process.env.REACT_APP_SERVER_URL : null;

  // Debug helper: simulate a confirmed cross from the frontend (calls /send-alert and adds local event)
  const simulateConfirmedCross = React.useCallback((forceType) => {
    try {
      const type = forceType || (confirmedCross || 'bull');
      const sym = (activeSymbol || symbol || '').toString().replace(/[^A-Za-z0-9]/g, '').toUpperCase();
      const price = lastPrice || 0;
      const text = `${sym} ${type === 'bull' ? 'Bullish EMA9 > EMA26' : 'Bearish EMA9 < EMA26'} @ ${price}`;
      // add local event
      const ev = { ts: Date.now(), time: new Date().toLocaleString(), type: type === 'bull' ? 'bull' : 'bear', price, symbol: sym, source: 'client-sim' };
      addEvent(ev);
      // fire server send
      (async () => {
        if (!serverUrl) {
          // no server configured (static mode): inform user that Telegram relay is disabled
          try { showToast('Telegram disabled: no server configured', false); } catch (e) {}
          if (showDebug) console.debug('[App] simulateConfirmedCross skipped POST /send-alert because serverUrl is not set');
          return;
        }
        try {
          if (showDebug) console.debug('[App] simulate sending /send-alert', { url: `${serverUrl}/send-alert`, payload: { symbol: sym, price, message: text } });
          const res = await fetch(`${serverUrl}/send-alert`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ symbol: sym, price, message: text }) });
          let json = null;
          try { json = await res.json(); } catch (e) { json = null; }
          const sendEv = { ts: Date.now(), time: new Date().toLocaleString(), type: 'telegram_send', symbol: sym, source: 'client-send', ok: res.ok, status: res.status, body: json };
          addEvent(sendEv);
          // show immediate toast to user
          try { showToast(res.ok ? `Telegram send OK (${sym})` : `Telegram send failed (${res.status})`, res.ok); } catch (e) {}
          if (showDebug) console.debug('[App] simulate /send-alert response', sendEv);
        } catch (e) {
          const errEv = { ts: Date.now(), time: new Date().toLocaleString(), type: 'telegram_send', symbol: sym, source: 'client-send', ok: false, error: String(e) };
          addEvent(errEv);
          try { showToast(`Telegram send error: ${String(e)}`, false); } catch (err) {}
          if (showDebug) console.debug('[App] simulate send-alert failed', e);
        }
      })();
    } catch (e) { if (showDebug) console.debug('[App] simulateConfirmedCross error', e); }
  }, [activeSymbol, symbol, lastPrice, addEvent, showDebug, confirmedCross, showToast, serverUrl]);

 

  // Subscribe to server-sent events from server (realtime alerts emitted by server)
  useEffect(() => {
    // If no server URL is configured (static/client-only), skip creating SSE
    if (!serverUrl) {
      setSseConnected(false);
      return undefined;
    }
    if (!window.EventSource) return undefined;
    let es;
    try {
      es = new EventSource(`${serverUrl}/events`);
      es.onopen = () => {
        setSseConnected(true);
        // fetch health once when SSE opens to sync server-side monitored symbol
        try {
          fetch(`${serverUrl}/health`).then((r) => r.json()).then((j) => { if (j && j.symbol) setServerSymbol((j.symbol || '').toString().toUpperCase()); }).catch(() => {});
        } catch (e) {}
      };
      es.onmessage = (e) => {
        try {
          const obj = JSON.parse(e.data);
          if (!obj) return;
          // handle server alert events and telegram_sent confirmations
          if (obj.type === 'alert') {
            // prefer the activeSymbol from the hook, fallback to the selected symbol
            const current = (activeSymbol || symbol || '').toString().replace(/[^A-Za-z0-9]/g, '').toUpperCase();
            const incoming = (obj.symbol || '').toString().replace(/[^A-Za-z0-9]/g, '').toUpperCase();
            // require incoming symbol to be present and match the currently-active symbol
            if (!incoming || !current || incoming !== current) {
              if (showDebug) console.debug('[App] dropping SSE alert for different symbol', { incoming, current, obj });
              return;
            }

            const evObj = { ts: obj.ts || Date.now(), time: obj.when ? new Date(obj.when).toLocaleString() : new Date().toLocaleString(), type: obj.alert === 'bull' ? 'bull' : 'bear', price: obj.price, symbol: incoming, source: 'server' };
            // use centralized dedupe/add helper
            try { addEvent(evObj); } catch (e) { setEvents((prev) => [evObj, ...prev].slice(0, 500)); }
          } else if (obj.type === 'telegram_sent') {
            // server confirmed it sent a telegram; add a small event so UI reflects it
            try {
              const sym = (obj.symbol || '').toString().replace(/[^A-Za-z0-9]/g, '').toUpperCase() || (activeSymbol || symbol || '').toString().toUpperCase();
              const ev = { ts: obj.ts || Date.now(), time: new Date(obj.ts || Date.now()).toLocaleString(), type: 'telegram', price: obj.price || lastPrice, symbol: sym, source: 'server-telegram', ok: obj.ok };
              addEvent(ev);
            } catch (e) {}
          }
        } catch (err) {}
      };
      es.onerror = () => {
        setSseConnected(false);
        try { es.close(); } catch (e) {}
      };
    } catch (e) {}
    return () => { try { es && es.close(); } catch (e) {} };
  }, [symbol, activeSymbol, showDebug, addEvent, lastPrice, serverUrl]);

  // helper to ask server to monitor a symbol, then connect the client
  const setServerAndConnect = React.useCallback(async (sym, opts) => {
    const q = (sym || '').toString().replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  let interval = (opts && typeof opts.interval !== 'undefined') ? opts.interval : monitorMinutes;
    // normalize interval to a string accepted by Binance (e.g., '5m'). If a plain number is provided, treat as minutes.
    if (typeof interval === 'number' || (typeof interval === 'string' && /^\d+$/.test(String(interval)))) {
      interval = `${interval}m`;
    }
  const emaShort = (opts && typeof opts.emaShort !== 'undefined') ? opts.emaShort : monitorEma1;
  const emaLong = (opts && typeof opts.emaLong !== 'undefined') ? opts.emaLong : monitorEma2;
  const confirmCandles = (opts && typeof opts.confirmCandles !== 'undefined') ? opts.confirmCandles : monitorConfirm;
    if (!q) {
      try { connect(sym); } catch (e) {}
      return;
    }
    try {
      // update UI optimistically so the menu reflects the user's requested symbol
      // even if the server is temporarily unreachable. Then notify the server.
      setServerSymbol(q);
      // call server endpoint to change monitored symbol and monitoring params
      const paramsObj = { symbol: q, interval: String(interval), emaShort: String(emaShort), emaLong: String(emaLong) };
      if (typeof confirmCandles !== 'undefined' && confirmCandles !== null) paramsObj.confirmCandles = String(confirmCandles);
      const params = new URLSearchParams(paramsObj);
      try {
        await fetch(`${serverUrl}/set-symbol?${params.toString()}`, { method: 'GET' });
      } catch (err) {
        // server may be down; keep the optimistic UI state but inform user
        try { showToast(`Server set-symbol failed: ${String(err)}`, false); } catch (e) {}
        if (showDebug) console.debug('[App] /set-symbol request failed', err);
      }
    } catch (e) {
      // ignore server errors and proceed to connect locally
    }
    try { connect(q); } catch (e) {}
    // persist the last-used monitor inputs so Alerts/Controls can restore them
    try {
      const toStore = { monitorMinutes: (typeof interval === 'string' && interval.endsWith('m')) ? Number(interval.replace(/m$/, '')) : Number(interval), monitorEma1: Number(emaShort), monitorEma2: Number(emaLong), lastSymbol: q };
      localStorage.setItem('lastMonitor', JSON.stringify(toStore));
    } catch (e) {}
  }, [connect, monitorMinutes, monitorEma1, monitorEma2, monitorConfirm, showDebug, showToast, serverUrl]);

  

  // 자동 연결: symbol이 유효하고 autoStart가 켜져 있으면 Start 버튼을 누르지 않아도 connect 호출
  useEffect(() => {
    try {
      const q = (symbol || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
      // only attempt auto-start after the hook has initialized its EMA seed
      if (q && symbolValid === true && autoStart && status === 'initialized') {
        if (!activeSymbol || activeSymbol.toString().toUpperCase() !== q) {
          // ensure server monitor symbol is updated before connecting
          try { setServerAndConnect(q); } catch (e) { connect(q); }
        }
      }
    } catch (e) {
      // ignore
    }
  }, [symbol, symbolValid, autoStart, activeSymbol, connect, setServerAndConnect, status]);

  // fetch server health on mount in case SSE isn't available yet
  useEffect(() => {
    if (!serverUrl) {
      // no server configured (static mode)
      setTelegramConfigured(false);
      return;
    }
    try {
      fetch(`${serverUrl}/health`).then((r) => r.json()).then((j) => { if (j && j.symbol) setServerSymbol((j.symbol || '').toString().toUpperCase()); if (j) { setLastHealthyAt(Date.now()); if (typeof j?.telegramConfigured !== 'undefined') setTelegramConfigured(!!j.telegramConfigured); } }).catch(() => {});
    } catch (e) {}
  }, [serverUrl]);

  // poll /health periodically so UI can show last healthy time; keeps serverSymbol and telegramConfigured in sync
  useEffect(() => {
    if (!serverUrl) return undefined;
    let mounted = true;
    async function poll() {
      try {
        const r = await fetch(`${serverUrl}/health`);
        if (!mounted) return;
        const j = await r.json();
        if (j && j.symbol) setServerSymbol((j.symbol || '').toString().toUpperCase());
        if (j) {
          setLastHealthyAt(Date.now());
          if (typeof j?.telegramConfigured !== 'undefined') setTelegramConfigured(!!j.telegramConfigured);
        }
      } catch (e) {
        // keep lastHealthyAt as-is on error
      }
    }
    // initial poll
    poll();
    const id = setInterval(poll, 15000);
    return () => { mounted = false; clearInterval(id); };
  }, [serverUrl]);

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
        const normTarget = (symbol || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
        const filtered = saved.filter((ev) => {
          if (!ev) return false;
          if (typeof ev.ts === 'number' && ev.ts < cutoff) return false;
          // try parse time string as fallback
          if (typeof ev.ts !== 'number') {
            const parsed = Date.parse(ev.time || '');
            if (isNaN(parsed) || parsed < cutoff) return false;
          }
          // require event symbol to match the current selected symbol to avoid showing other-pair alerts
          const evSym = (ev.symbol || '').toString().replace(/[^A-Za-z0-9]/g, '').toUpperCase();
          return evSym === normTarget;
        });
        setEvents(filtered);
      }
    } catch (e) {}
  }, [symbol]);

  // Persist monitor inputs whenever they change so UI values are remembered
  useEffect(() => {
    try {
      const toStore = { monitorMinutes, monitorEma1, monitorEma2, monitorConfirm, lastSymbol: symbol };
      localStorage.setItem('lastMonitor', JSON.stringify(toStore));
    } catch (e) {}
  }, [monitorMinutes, monitorEma1, monitorEma2, monitorConfirm, symbol]);

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
      const symToShowRaw = activeSymbol || symbol || '';
      const symToShow = (symToShowRaw || '').toString().replace(/[^A-Za-z0-9]/g, '').toUpperCase();
        // Determine the authoritative price to show/send. Prefer closed-candle `lastPrice`,
        // but fall back to the most recent live tick (`lastTick`) when a closed price
        // isn't yet available. Still skip only when this is the initial seeded value.
        const priceToUse = (typeof lastPrice !== 'undefined' && lastPrice !== null) ? lastPrice : ((typeof lastTick !== 'undefined' && lastTick !== null) ? lastTick : null);
        if (confirmedSource === 'init') {
          // do not notify for seed values
          lastNotified.current = confirmedCross;
          return;
        }
        if (priceToUse == null) {
          // If we truly have no price at all, skip but log in debug so user can inspect
          if (showDebug) console.debug('[App] skipping notification: no price available (lastPrice & lastTick are null)', { confirmedCross, confirmedSource, activeSymbol, symbol });
          lastNotified.current = confirmedCross;
          return;
        }
        const body = `${symToShow} ${type} @ ${priceToUse}`;

      // Also request the server to send a Telegram message for this confirmed cross.
      // In static/client-only mode (no serverUrl) skip server relay and show a toast.
      (async () => {
        if (!serverUrl) {
          try { showToast('Telegram disabled: no server configured', false); } catch (e) {}
          if (showDebug) console.debug('[App] confirmedCross skipped POST /send-alert because serverUrl is not set');
          return;
        }
        const payload = { symbol: symToShow, price: priceToUse, message: type + ' @ ' + priceToUse };
        // debug: log state used for send-alert so we can trace mismatched alerts
        try {
          console.log('[App] sending /send-alert', { sendSym: symToShow, selectedSymbol: symbol, activeSymbol, confirmedCross, confirmedSource, ema9, ema26, lastPrice, lastTick });
        } catch (e) {}
        // also show a brief UI toast with the same debug info so it's visible without DevTools
        try {
          const dbg = `${symToShow} ${confirmedCross} | active:${activeSymbol || '—'} | ema:${(typeof ema9==='number'?ema9.toFixed(4):'—')}/${(typeof ema26==='number'?ema26.toFixed(4):'—')} | price:${(typeof lastPrice!=='undefined'&&lastPrice!==null)?lastPrice:'—'}`;
          try { showToast(`[DEBUG] ${dbg}`, true); } catch (e) { console.log('[App] showToast debug failed', e); }
        } catch (e) {}
        const maxAttempts = 3;
        let attempt = 0;
        let lastError = null;
        while (attempt < maxAttempts) {
          attempt += 1;
          try {
            if (showDebug) console.debug('[App] confirmedCross sending /send-alert attempt', attempt, payload);
            const res = await fetch(`${serverUrl}/send-alert`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload),
            });
            let json = null;
            try { json = await res.json(); } catch (e) { json = null; }
            const sendEv = { ts: Date.now(), time: new Date().toLocaleString(), type: 'telegram_send', symbol: symToShow, source: 'client-confirmed', ok: res.ok, status: res.status, body: json, attempt };
            try { addEvent(sendEv); } catch (e) { setEvents((prev) => [sendEv, ...prev].slice(0, 500)); }
            try { showToast(res.ok ? `Telegram send OK (${symToShow})` : `Telegram send failed (${res.status})`, res.ok); } catch (e) {}
            if (res.ok) break; // success
            lastError = new Error(`HTTP ${res.status}`);
          } catch (e) {
            lastError = e;
            if (showDebug) console.debug('[App] confirmedCross send attempt failed', attempt, e);
          }
          // exponential backoff before retrying
          if (attempt < maxAttempts) {
            const delay = 500 * Math.pow(2, attempt - 1); // 500ms, 1000ms
            await new Promise((r) => setTimeout(r, delay));
          }
        }
        if (lastError && showDebug) console.debug('[App] confirmedCross final send error', lastError);
      })();

      // browser notification
      if ('Notification' in window && Notification.permission === 'granted') {
        new Notification(type, { body });
      }

      // beep and log
      beep();
      const evObj = { ts: Date.now(), time: new Date().toLocaleString(), type: confirmedCross, price: lastPrice, symbol: symToShow, source: confirmedSource || 'unknown' };
      if (showDebug) console.debug('[App] created confirmedCross event', evObj);
      setEvents((s) => [evObj, ...s].slice(0, 500));
      lastNotified.current = confirmedCross;
    }
  }, [confirmedCross, lastPrice, lastTick, symbol, activeSymbol, confirmedSource, showDebug, addEvent, showToast, ema9, ema26, serverUrl]);

  // 심볼이 바뀔 때 이전 심볼의 알림 상태가 남아 있어 잘못된 알림이 뜨는 문제 방지
  // 심볼을 변경하면 lastNotified를 초기화해서 다음 confirmedCross는 초기 시드로 처리되도록 한다.
  useEffect(() => {
    try {
      lastNotified.current = null;
    } catch (e) {}
    // also clear displayed events when symbol changes to avoid mixing alerts from different symbols
    try { setEvents([]); } catch (e) {}
  }, [symbol]);

  // persist last selected symbol so the app remembers it between sessions
  useEffect(() => {
    try {
      if (!symbol) return;
      const norm = (symbol || '').toString().replace(/[^A-Za-z0-9]/g, '').toUpperCase();
      localStorage.setItem('lastSymbol', norm);
    } catch (e) {}
  }, [symbol]);

  // theme (darkMode) persisted in localStorage
  const [darkMode, setDarkMode] = useState(() => { try { return localStorage.getItem('darkMode') === '1'; } catch (e) { return false; } });
  const toggleDark = React.useCallback(() => {
    try {
      setDarkMode((d) => { const next = !d; try { localStorage.setItem('darkMode', next ? '1' : '0'); } catch (e) {} ; return next; });
    } catch (e) {}
  }, []);

  return (
    <div className={`App ${darkMode ? 'dark' : ''}`}>
  <TopMenu onNavigate={setView} view={view} darkMode={darkMode} toggleDark={toggleDark} serverSymbol={serverSymbol} sseConnected={sseConnected} lastHealthyAt={lastHealthyAt} telegramConfigured={telegramConfigured} />
      <div className="container">
  <div className={`card ${view === 'alerts' ? 'view-alerts' : ''}`}>
              {view === 'scanner' ? (
            <ScannerPage availableSymbols={availableSymbols} fetchExchangeInfo={fetchExchangeInfo} monitorMinutes={monitorMinutes} setMonitorMinutes={setMonitorMinutes} monitorEma1={monitorEma1} setMonitorEma1={setMonitorEma1} monitorEma2={monitorEma2} setMonitorEma2={setMonitorEma2} />
          ) : (
            <>
              <Header />
              {/* inline toast for quick feedback */}
              {toast && (
                <div className={`toast ${toast.ok ? 'toast-ok' : 'toast-err'}`} role="status" aria-live="polite">
                  <div className="toast-title">{toast.ok ? 'Success' : 'Error'}</div>
                  <div className="toast-body">{toast.message}</div>
                </div>
              )}

              <Controls
                symbol={symbol}
                setSymbol={setSymbol}
                
                symbolValid={symbolValid}
                setSymbolValid={setSymbolValid}
                suggestions={suggestions}
                setSuggestions={setSuggestions}
                availableSymbols={availableSymbols}
                validateSymbolOnce={validateSymbolOnce}
                connect={setServerAndConnect}
                disconnect={disconnect}
                status={status}
                connected={connected}
                // monitoring inputs
                monitorMinutes={monitorMinutes}
                setMonitorMinutes={setMonitorMinutes}
                monitorEma1={monitorEma1}
                setMonitorEma1={setMonitorEma1}
                monitorEma2={monitorEma2}
                setMonitorEma2={setMonitorEma2}
                
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
                            try { if (autoStart) setServerAndConnect(s); } catch (e) {}
                          }}>{s}</button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {view === 'debug' ? (
                <DebugPanel availableSymbols={availableSymbols} fetchExchangeInfo={fetchExchangeInfo} showDebug={showDebug} setMarketCheckResult={setMarketCheckResult} marketCheckResult={marketCheckResult} symbol={symbol} onSimulateAlert={simulateConfirmedCross} />
              ) : null}

              <div className="status">
                Status: <strong>{status}</strong> {connected ? <span className="status-connected">(connected)</span> : <span className="status-disconnected">(disconnected)</span>}
              </div>

              <Metrics activeSymbol={activeSymbol} symbol={symbol} lastPrice={lastPrice} lastTick={lastTick} lastCandleClosed={lastCandleClosed} cross={cross} confirmedCross={confirmedCross} ema9={ema9} ema26={ema26} monitorEma1={monitorEma1} monitorEma2={monitorEma2} />

              <Alerts
                events={events}
                removeAlertByTs={removeAlertByTs}
                symbol={symbol}
                symbolValid={symbolValid}
                status={status}
                connect={setServerAndConnect}
                disconnect={disconnect}
                monitorMinutes={monitorMinutes}
                monitorEma1={monitorEma1}
                monitorEma2={monitorEma2}
                monitorConfirm={monitorConfirm}
              />

              <Notes>Notes: This app uses Binance public REST + websocket. Make sure network allows wss access to stream.binance.com.</Notes>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default App;
