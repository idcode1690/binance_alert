import { useEffect, useRef, useState, useCallback } from 'react';
import { calculateInitialEMA, updateEMA } from '../utils/ema';

// Hook options: { symbol }
export default function useEmaCross({ symbol = 'BTCUSDT', autoConnect = true, debug = false } = {}) {
  const [ema9, setEma9] = useState(null);
  const [ema26, setEma26] = useState(null);
  const [lastPrice, setLastPrice] = useState(null);
  const [cross, setCross] = useState(null); // preview (live) cross
  const [confirmedCross, setConfirmedCross] = useState(null); // only updated on closed candles (confirmed)
  const [confirmedSource, setConfirmedSource] = useState(null); // 'ws' | 'poll' | 'init'
  const [connected, setConnected] = useState(false);
  const [status, setStatus] = useState('idle');
  const [lastCandleClosed, setLastCandleClosed] = useState(false);
  const [activeSymbol, setActiveSymbol] = useState(null); // which symbol the hook has initialized/connected for

  const wsRef = useRef(null);
  const prevCrossRef = useRef(null);
  const prevConfirmedRef = useRef(null);
  const ema9Ref = useRef(null);
  const ema26Ref = useRef(null);
  // confirmed EMAs updated only on closed candles (kline.x === true) or polling
  const ema9ConfirmedRef = useRef(null);
  const ema26ConfirmedRef = useRef(null);
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimerRef = useRef(null);
  const currentSymbolRef = useRef(null);
  const lastProcessedCloseRef = useRef(null); // timestamp (ms) of last processed closed candle
  const pollingTimerRef = useRef(null);

  const fetchAndInit = useCallback(async (target = symbol) => {
    try {
      const t = (target || symbol).toString();
      setStatus('fetching historical klines');
      const norm = t.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  // use Binance Futures (USDT-M) REST endpoint for klines (1m)
  const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${norm}&interval=1m&limit=500`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Failed to fetch klines: ${res.status}`);
      const data = await res.json();
      // kline array: [ openTime, open, high, low, close, ... ]
  const closes = data.map((k) => parseFloat(k[4]));

      if (closes.length < 26) throw new Error('Not enough historical candles to initialize EMA26');

      // Use the close history to compute EMA9 and EMA26
      const initEma9 = calculateInitialEMA(closes.slice(-100), 9);
      const initEma26 = calculateInitialEMA(closes.slice(-300), 26);

    // initialize both preview and confirmed EMAs from historical closes
    ema9Ref.current = initEma9;
    ema26Ref.current = initEma26;
    ema9ConfirmedRef.current = initEma9;
    ema26ConfirmedRef.current = initEma26;
      // record which symbol these EMAs correspond to
      currentSymbolRef.current = norm;
      setActiveSymbol(norm);
      // record last processed closed candle time (closeTime at index 6)
      try { lastProcessedCloseRef.current = data[data.length - 1][6]; } catch (e) { lastProcessedCloseRef.current = null; }
    setEma9(initEma9);
    setEma26(initEma26);
    setLastPrice(closes[closes.length - 1]);
      setStatus('initialized');
      // set initial cross
    const initialCross = initEma9 > initEma26 ? 'bull' : 'bear';
      prevCrossRef.current = initialCross;
  setCross(initialCross);
  prevConfirmedRef.current = initialCross;
  setConfirmedCross(initialCross);
  setConfirmedSource('init');
    } catch (err) {
      setStatus(`init error: ${err.message}`);
      console.error(err);
    }
  }, [symbol]);

  const connect = useCallback(async (overrideSymbol) => {
    const targetSymbol = (overrideSymbol || symbol).toString();
    const targetNorm = targetSymbol.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    // if a websocket exists for same symbol, no-op
    if (wsRef.current) {
      if (currentSymbolRef.current === targetNorm) return;
      try { wsRef.current.close(); } catch (e) {}
      wsRef.current = null;
    }
    // Ensure EMA is initialized for the target symbol before connecting
    try {
      const targetNorm = targetSymbol.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
      if (currentSymbolRef.current !== targetNorm || ema9Ref.current == null || ema26Ref.current == null) {
        await fetchAndInit(targetNorm);
      }
    } catch (err) {
      setStatus(`init error: ${err.message}`);
      return;
    }

    setStatus('connecting websocket');
    // Use combined stream: kline_1m + aggTrade for higher-frequency trade updates
  const klineStream = `${targetNorm.toLowerCase()}@kline_1m`;
  const tradeStream = `${targetNorm.toLowerCase()}@aggTrade`;
    const streams = `${klineStream}/${tradeStream}`;
  // use Binance Futures (USDT-M) websocket (fstream) combined stream
  const url = `wss://fstream.binance.com/stream?streams=${streams}`;
  console.log('Connecting websocket for', targetSymbol, 'url=', url);
  const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      // reset backoff attempts on successful open
      reconnectAttemptsRef.current = 0;
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      // stop polling if it was started while socket was down
      if (pollingTimerRef.current) {
        clearInterval(pollingTimerRef.current);
        pollingTimerRef.current = null;
      }
      currentSymbolRef.current = targetSymbol;
      currentSymbolRef.current = targetNorm;
      setActiveSymbol(targetNorm);
      if (debug) console.log('[useEmaCross] websocket open for', targetNorm);
      setConnected(true);
      setStatus('connected');
    };

    ws.onmessage = (ev) => {
      try {
        const payloadWrapper = JSON.parse(ev.data);
        // combined stream returns { stream, data }
        const payload = payloadWrapper.data || payloadWrapper;

        // determine the source symbol for this message (if available)
        let sourceSymbol = null;
        try {
          if (payload && payload.s) sourceSymbol = payload.s.toString().toUpperCase();
          else if (payloadWrapper && payloadWrapper.stream) {
            const streamName = payloadWrapper.stream.toString(); // e.g. trxusdt@aggTrade
            sourceSymbol = streamName.split('@')[0].toUpperCase();
          }
        } catch (e) { sourceSymbol = null; }

        // If the message is not for the currently-initialized symbol, ignore it.
        if (currentSymbolRef.current && sourceSymbol) {
            if (currentSymbolRef.current.toString().toUpperCase() !== sourceSymbol.toString().toUpperCase()) {
            return; // ignore messages from other symbols
          }
        }

        // aggTrade messages have event type 'aggTrade' and price in p
        if (debug) {
          try {
            const streamName = payloadWrapper.stream || payload.e || 'unknown';
            console.log('[useEmaCross] incoming', { stream: streamName, sourceSymbol, event: payload.e || null });
          } catch (e) {}
        }
        if (payload.e === 'aggTrade') {
          const price = parseFloat(payload.p);
          setLastPrice(price);

          if (ema9Ref.current == null || ema26Ref.current == null) return;

          // update EMA using trade price to provide higher-frequency preview
          const newEma9 = updateEMA(ema9Ref.current, price, 9);
          const newEma26 = updateEMA(ema26Ref.current, price, 26);
          // preview EMAs only
          ema9Ref.current = newEma9;
          ema26Ref.current = newEma26;
          setEma9(newEma9);
          setEma26(newEma26);

          const newCross = newEma9 > newEma26 ? 'bull' : 'bear';
          if (prevCrossRef.current !== newCross) {
            prevCrossRef.current = newCross;
            setCross(newCross);
          }
        }

        // kline messages contain a 'k' object
        if (payload.k) {
          if (debug) console.log('[useEmaCross] kline payload x=', payload.k.x, 'close=', payload.k.c);
          const k = payload.k;
          const close = parseFloat(k.c);
          setLastPrice(close);
          setLastCandleClosed(Boolean(k.x));

          if (ema9Ref.current == null || ema26Ref.current == null) return;

          // update EMA using kline close
          // For partial candle: update preview EMA only
          if (!k.x) {
            const newEma9 = updateEMA(ema9Ref.current, close, 9);
            const newEma26 = updateEMA(ema26Ref.current, close, 26);
            ema9Ref.current = newEma9;
            ema26Ref.current = newEma26;
            setEma9(newEma9);
            setEma26(newEma26);
          } else {
            // closed candle: update confirmed EMAs only (and sync preview to confirmed)
            if (ema9ConfirmedRef.current == null || ema26ConfirmedRef.current == null) {
              // defensive: fall back to preview if confirmed not initialized
              ema9ConfirmedRef.current = ema9Ref.current;
              ema26ConfirmedRef.current = ema26Ref.current;
            }
            const newEma9c = updateEMA(ema9ConfirmedRef.current, close, 9);
            const newEma26c = updateEMA(ema26ConfirmedRef.current, close, 26);
            ema9ConfirmedRef.current = newEma9c;
            ema26ConfirmedRef.current = newEma26c;
            // sync preview to confirmed after closed candle to avoid drift
            ema9Ref.current = newEma9c;
            ema26Ref.current = newEma26c;
            setEma9(newEma9c);
            setEma26(newEma26c);
          }

          // compute preview (live) cross from preview EMAs
          const previewCross = (ema9Ref.current != null && ema26Ref.current != null) ? (ema9Ref.current > ema26Ref.current ? 'bull' : 'bear') : null;
          if (previewCross && prevCrossRef.current !== previewCross) {
            prevCrossRef.current = previewCross;
            setCross(previewCross);
          }
          // If candle is closed (k.x === true) and it's a new closed candle, update processed time and set confirmed cross
          if (Boolean(k.x)) {
            try {
              const closeTime = k.T || k.t || null; // k.T is close time in ms
              if (closeTime && (!lastProcessedCloseRef.current || closeTime > lastProcessedCloseRef.current)) {
                lastProcessedCloseRef.current = closeTime;
                // compute confirmed cross using confirmed EMA refs (fallback to previewCross)
                const confirmedNewCross = (ema9ConfirmedRef.current != null && ema26ConfirmedRef.current != null) ? (ema9ConfirmedRef.current > ema26ConfirmedRef.current ? 'bull' : 'bear') : previewCross;
                if (prevConfirmedRef.current !== confirmedNewCross) {
                  prevConfirmedRef.current = confirmedNewCross;
                  setConfirmedCross(confirmedNewCross);
                  setConfirmedSource('ws');
                }
              }
            } catch (e) {
              // fallback: always set cross if changed (use preview cross)
              if (prevConfirmedRef.current !== previewCross) {
                prevConfirmedRef.current = previewCross;
                setConfirmedCross(previewCross);
                setConfirmedSource('ws');
              }
            }
          } else {
            // partial candle: preview already updated above
          }
        }
      } catch (err) {
        console.error('ws message parse error', err);
      }
    };

    ws.onerror = (e) => {
      console.error('ws error', e);
      setStatus('websocket error');
      // close to trigger backoff reconnect
      try { ws.close(); } catch (err) {}
    };

    ws.onclose = () => {
      setConnected(false);
      setStatus('websocket closed');
      wsRef.current = null;
      currentSymbolRef.current = null;
      setActiveSymbol(null);
      if (debug) console.log('[useEmaCross] websocket closed');
      // start polling for closed candles while websocket is down
      try {
        if (!pollingTimerRef.current) {
          pollingTimerRef.current = setInterval(async () => {
            try {
              const sym = (symbol || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
              if (!sym) return;
              const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${sym}&interval=1m&limit=10`;
              const res = await fetch(url);
              if (!res.ok) return;
              const data = await res.json();
              // iterate candles in chronological order and process any closed candles newer than lastProcessedCloseRef
              const newClosed = [];
              for (const k of data) {
                const closeTime = k[6];
                if (closeTime && (!lastProcessedCloseRef.current || closeTime > lastProcessedCloseRef.current)) {
                  newClosed.push(k);
                }
              }
              if (newClosed.length > 0) {
                // sort by closeTime asc
                newClosed.sort((a, b) => a[6] - b[6]);
                  for (const k of newClosed) {
                    const close = parseFloat(k[4]);
                    // update EMAs using closed candle
                    if (ema9Ref.current == null || ema26Ref.current == null) continue;
                    // update confirmed EMAs using closed candle (polling)
                    if (ema9ConfirmedRef.current == null || ema26ConfirmedRef.current == null) {
                      ema9ConfirmedRef.current = ema9Ref.current;
                      ema26ConfirmedRef.current = ema26Ref.current;
                    }
                    const newEma9c = updateEMA(ema9ConfirmedRef.current, close, 9);
                    const newEma26c = updateEMA(ema26ConfirmedRef.current, close, 26);
                    ema9ConfirmedRef.current = newEma9c;
                    ema26ConfirmedRef.current = newEma26c;
                    // sync preview to confirmed
                    ema9Ref.current = newEma9c;
                    ema26Ref.current = newEma26c;
                    setEma9(newEma9c);
                    setEma26(newEma26c);
                    const newCross = newEma9c > newEma26c ? 'bull' : 'bear';
                      if (prevConfirmedRef.current !== newCross) {
                        prevConfirmedRef.current = newCross;
                          setConfirmedCross(newCross);
                          setConfirmedSource('poll');
                      }
                    lastProcessedCloseRef.current = k[6];
                    setLastPrice(parseFloat(k[4]));
                    setLastCandleClosed(true);
                  }
              }
            } catch (e) {
              // ignore polling errors
            }
          }, 10 * 1000); // poll every 10s
        }
      } catch (e) {}
      // exponential backoff reconnect with jitter
      const attempt = reconnectAttemptsRef.current || 0;
      const base = 1000; // 1s
      const delay = Math.min(30000, base * Math.pow(2, attempt));
      const jitter = Math.floor(Math.random() * 1000);
      reconnectAttemptsRef.current = attempt + 1;
      reconnectTimerRef.current = setTimeout(() => {
        reconnectTimerRef.current = null;
        if (!wsRef.current) {
          // prefer reconnecting to the currently requested symbol if available
          const target = currentSymbolRef.current || symbol;
          try { connect(target); } catch (e) { connect(target); }
        }
      }, delay + jitter);
    };
  }, [symbol, fetchAndInit, debug]);

  const disconnect = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setConnected(false);
    setStatus('disconnected');
    setActiveSymbol(null);
    if (pollingTimerRef.current) {
      clearInterval(pollingTimerRef.current);
      pollingTimerRef.current = null;
    }
    // clear reconnect attempts/timers
    try {
      reconnectAttemptsRef.current = 0;
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
    } catch (e) {}
  }, []);

  useEffect(() => {
    // initialize on mount (or when symbol changes)
    // Reset current state immediately so previous symbol's values don't show while new symbol initializes
    try {
      // close any existing websocket
      if (wsRef.current) {
        try { wsRef.current.close(); } catch (e) {}
        wsRef.current = null;
      }

      // clear reconnect timers and attempts
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      reconnectAttemptsRef.current = 0;

      // reset refs and state for EMA and cross
    prevCrossRef.current = null;
    currentSymbolRef.current = null;
    ema9Ref.current = null;
    ema26Ref.current = null;
  setActiveSymbol(null);
    setEma9(null);
    setEma26(null);
      setLastPrice(null);
      setCross(null);
      setLastCandleClosed(false);
      setConnected(false);
      setStatus('reloading');
    } catch (e) {}
    // fetch history for the (new) symbol and initialize
    fetchAndInit();
    // cleanup on unmount
    return () => {
      if (wsRef.current) wsRef.current.close();
      if (pollingTimerRef.current) {
        clearInterval(pollingTimerRef.current);
        pollingTimerRef.current = null;
      }
    };
  }, [fetchAndInit]);

  // auto connect after initialization if requested
  useEffect(() => {
    if (status === 'initialized' && autoConnect) {
      // call connect once after initialization
      connect();
    }
    // only run when status or autoConnect changes
  }, [status, autoConnect, connect]);

  return {
    ema9,
    ema26,
    lastPrice,
    lastCandleClosed,
    cross,
    confirmedCross,
    confirmedSource,
    connected,
    status,
    connect,
    disconnect,
    activeSymbol,
  };
}
