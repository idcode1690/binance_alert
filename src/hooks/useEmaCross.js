import { useEffect, useRef, useState, useCallback } from 'react';
// telegram sending is handled by App-level flow after alert list updates
import { calculateInitialEMA, updateEMA } from '../utils/ema';

// Hook options: { symbol }
export default function useEmaCross({ symbol = 'BTCUSDT', autoConnect = true, debug = false, interval = '1m', emaShort = 9, emaLong = 26, confirmClosedCandles = 1, klineLimit = 1000, autoSendTelegram = false } = {}) {
  const [ema9, setEma9] = useState(null);
  const [ema26, setEma26] = useState(null);
  const [lastPrice, setLastPrice] = useState(null);
  // lastTick represents the most recent trade/partial-candle price (live preview).
  // lastPrice remains reserved for the most recent CLOSED candle price and is
  // used when emitting confirmed alerts/notifications.
  // eslint-disable-next-line no-unused-vars
  const [lastTick, setLastTick] = useState(null);

  // when debug is enabled, log lastTick updates so the variable is visibly used
  // inside this module (and also helpful for debugging live preview values).
  useEffect(() => {
    try {
      if (debug && typeof lastTick !== 'undefined' && lastTick !== null) {
        // lightweight debug output
        // eslint-disable-next-line no-console
        console.debug('[useEmaCross] lastTick', lastTick);
      }
    } catch (e) {}
  }, [lastTick, debug]);
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
  const candidateConfirmedRef = useRef(null);
  const candidateCountRef = useRef(0);
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

  // Normalize interval strings for Binance API compatibility.
  // Binance accepts tokens like '1m','3m','5m','15m','30m','1h','2h','4h', etc.
  // The app sometimes passes numeric minute strings like '240m' or '240';
  // convert minute multiples of 60 to '4h' style tokens so REST requests don't 400.
  const normalizeIntervalForBinance = (raw) => {
    try {
      let s = String(raw || '').trim();
      if (!s) return s;
      s = s.toLowerCase();
      const allowed = new Set(['1m','3m','5m','15m','30m','1h','2h','4h','6h','8h','12h','1d','3d','1w','1m']);
      if (allowed.has(s)) return s;
      // plain number like '240' -> minutes
      const numMatch = s.match(/^([0-9]+)$/);
      if (numMatch) {
        const n = Number(numMatch[1]);
        if (n % 60 === 0) return `${n/60}h`;
        return `${n}m`;
      }
      // matches like '240m'
      const mMatch = s.match(/^([0-9]+)m$/);
      if (mMatch) {
        const n = Number(mMatch[1]);
        if (n % 60 === 0) return `${n/60}h`;
        return `${n}m`;
      }
      // matches like '4h'
      const hMatch = s.match(/^([0-9]+)h$/);
      if (hMatch) return `${Number(hMatch[1])}h`;
      return s;
    } catch (e) { return String(raw); }
  };
  const fetchAndInit = useCallback(async (target = symbol) => {
    try {
      const t = (target || symbol).toString();
      setStatus('fetching historical klines');
      const norm = t.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  // use Binance Futures (USDT-M) REST endpoint for klines; interval is configurable
  // normalize interval to Binance-accepted token (e.g., convert '240m' -> '4h')
  const bi = normalizeIntervalForBinance(interval);
  // request up to 1000 candles to provide long historical context for EMA calculations
  const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${norm}&interval=${bi}&limit=${Math.max(100, Math.min(1000, Number(klineLimit) || 1000))}`;
    const res = await fetch(url);
      if (!res.ok) throw new Error(`Failed to fetch klines: ${res.status}`);
      const data = await res.json();
      // kline array: [ openTime, open, high, low, close, ... ]
  const closes = data.map((k) => parseFloat(k[4]));

  if (closes.length < emaLong) throw new Error(`Not enough historical candles to initialize EMA${emaLong}`);

    // Determine sensible history windows for initial EMA calculation
    const shortWindow = Math.max(emaShort * 10, 100);
    const longWindow = Math.max(emaLong * 12, 300);

  // Use the close history to compute EMA short/long
  if (debug) console.debug('[useEmaCross] fetchAndInit params', { symbol: norm, interval, emaShort, emaLong, shortWindow, longWindow, closesLength: closes.length });
  const initEma9 = calculateInitialEMA(closes.slice(-shortWindow), emaShort);
  const initEma26 = calculateInitialEMA(closes.slice(-longWindow), emaLong);

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
    if (debug) console.debug('[useEmaCross] initial EMAs', { initEma9, initEma26, initialCross });
      prevCrossRef.current = initialCross;
  setCross(initialCross);
  prevConfirmedRef.current = initialCross;
  setConfirmedCross(initialCross);
  setConfirmedSource('init');
    } catch (err) {
      setStatus(`init error: ${err.message}`);
      console.error(err);
    }
  }, [symbol, interval, emaShort, emaLong, debug, klineLimit]);

  const connect = useCallback(async (overrideSymbol) => {
    const targetSymbol = (overrideSymbol || symbol).toString();
    const targetNorm = targetSymbol.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    // if a websocket exists for same symbol, no-op
    if (wsRef.current) {
      if (currentSymbolRef.current === targetNorm) return;
      // do NOT close the existing socket here; create a new socket and let the
      // new socket's onopen handler replace/close the old socket to avoid a
      // brief disconnected state in the UI.
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
    // Use combined stream: kline interval (configurable) + aggTrade for higher-frequency trade updates
    const biLocal = normalizeIntervalForBinance(interval);
    const klineStream = `${targetNorm.toLowerCase()}@kline_${biLocal}`;
  const tradeStream = `${targetNorm.toLowerCase()}@aggTrade`;
    const streams = `${klineStream}/${tradeStream}`;
  // use Binance Futures (USDT-M) websocket (fstream) combined stream
  const url = `wss://fstream.binance.com/stream?streams=${streams}`;
  console.log('Connecting websocket for', targetSymbol, 'url=', url);
  const ws = new WebSocket(url);
    // Do not overwrite wsRef.current immediately. Create a new socket and only replace the
    // existing one after the new socket successfully opens. This allows a seamless symbol
    // switch without briefly showing disconnected state in the UI.
  const oldWs = wsRef.current;

    ws.onopen = () => {
      // mark as successful open
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

      // If there was a previous socket, mark it as replaced so its onclose handler
      // skips reconnect logic, then close it.
      try {
        if (oldWs) {
          oldWs.__replaced = true;
          try { oldWs.close(); } catch (e) {}
        }
      } catch (e) {}

      // now adopt the new socket as the active socket
      wsRef.current = ws;
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
        // NOTE: previously we only ignored messages when currentSymbolRef was set;
        // that left a small window during symbol switches where messages could be
        // processed while currentSymbolRef was null. Be stricter: if the message
        // contains a source symbol it must match the initialized symbol, otherwise
        // ignore it.
        if (sourceSymbol) {
          if (!currentSymbolRef.current || currentSymbolRef.current.toString().toUpperCase() !== sourceSymbol.toString().toUpperCase()) {
            return; // ignore messages from other symbols or while switching
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
          // update live tick price only; do NOT overwrite the last closed price
          // which should be used for confirmed alerts.
          setLastTick(price);

          if (ema9Ref.current == null || ema26Ref.current == null) return;

          // update EMA using trade price to provide higher-frequency preview
          const newEma9 = updateEMA(ema9Ref.current, price, emaShort);
          const newEma26 = updateEMA(ema26Ref.current, price, emaLong);
          // preview EMAs only
          ema9Ref.current = newEma9;
          ema26Ref.current = newEma26;
          setEma9(newEma9);
          setEma26(newEma26);

          // Do not update `cross` from trade ticks — keep cross decision tied to closed candles.
        }

        // kline messages contain a 'k' object
        if (payload.k) {
          if (debug) console.log('[useEmaCross] kline payload x=', payload.k.x, 'close=', payload.k.c);
          const k = payload.k;
          const close = parseFloat(k.c);
          // for partial candles, update live tick display; for closed candles
          // update the confirmed lastPrice (closed price) which will be used
          // for confirmedCross/notifications.
          setLastTick(close);
          setLastCandleClosed(Boolean(k.x));

          // candidate cross detected for this kline (set when closed candle processed)
          let detectedCross = null;

          if (ema9Ref.current == null || ema26Ref.current == null) return;

          // update EMA using kline close
          // For partial candle: update preview EMA only
          if (!k.x) {
            const newEma9 = updateEMA(ema9Ref.current, close, emaShort);
            const newEma26 = updateEMA(ema26Ref.current, close, emaLong);
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
            const prevShort = (typeof ema9ConfirmedRef.current === 'number') ? ema9ConfirmedRef.current : null;
            const prevLong = (typeof ema26ConfirmedRef.current === 'number') ? ema26ConfirmedRef.current : null;
            const newEma9c = updateEMA(ema9ConfirmedRef.current, close, emaShort);
            const newEma26c = updateEMA(ema26ConfirmedRef.current, close, emaLong);
            // update confirmed refs
            ema9ConfirmedRef.current = newEma9c;
            ema26ConfirmedRef.current = newEma26c;
            // sync preview to confirmed after closed candle to avoid drift
            ema9Ref.current = newEma9c;
            ema26Ref.current = newEma26c;
            setEma9(newEma9c);
            setEma26(newEma26c);
            // closed candle: also record the closed price as the authoritative lastPrice
            setLastPrice(close);
            // Determine whether an actual cross occurred between the previous confirmed
            // EMAs and the newly computed confirmed EMAs. A cross is defined as a
            // sign change: prevShort <= prevLong && newShort > newLong => golden
            // prevShort >= prevLong && newShort < newLong => dead
            detectedCross = null;
            try {
              if (prevShort != null && prevLong != null) {
                if (prevShort <= prevLong && newEma9c > newEma26c) detectedCross = 'bull';
                else if (prevShort >= prevLong && newEma9c < newEma26c) detectedCross = 'bear';
                else detectedCross = null; // no crossing event
              }
            } catch (e) { detectedCross = null; }
          }

          // Do not update `cross` for preview/partial candles here; cross will be
          // determined and updated only when a candle is closed (confirmed).
          // If candle is closed (k.x === true) and it's a new closed candle, update processed time and set confirmed cross
          if (Boolean(k.x)) {
            try {
              const closeTime = k.T || k.t || null; // k.T is close time in ms
              if (closeTime && (!lastProcessedCloseRef.current || closeTime > lastProcessedCloseRef.current)) {
                lastProcessedCloseRef.current = closeTime;
                // compute confirmed cross using confirmed EMA refs (fallback to preview values)
                // Only consider a confirmed cross when we detect an actual crossing event
                // between the previous confirmed EMAs and the newly computed confirmed EMAs.
                if (debug) console.debug('[useEmaCross] closed candle detected', { closeTime, close, ema9Confirmed: ema9ConfirmedRef.current, ema26Confirmed: ema26ConfirmedRef.current, ema9Preview: ema9Ref.current, ema26Preview: ema26Ref.current, detectedCross });
                // If we didn't detect an explicit sign-change event, fall back to
                // comparing the current confirmed EMAs. This ensures confirmedCross
                // updates on closed candles even when previous values are not set
                // or edge-cases occur during initialization.
                let candidate = detectedCross;
                if (candidate == null) {
                  if (ema9ConfirmedRef.current != null && ema26ConfirmedRef.current != null) {
                    candidate = (ema9ConfirmedRef.current > ema26ConfirmedRef.current) ? 'bull' : 'bear';
                  }
                }
                if (candidate != null) {
                  if (candidateConfirmedRef.current === candidate) {
                    candidateCountRef.current = (candidateCountRef.current || 0) + 1;
                  } else {
                    candidateConfirmedRef.current = candidate;
                    candidateCountRef.current = 1;
                  }
                  if (debug) console.debug('[useEmaCross] candidateConfirmed state', { candidateConfirmed: candidateConfirmedRef.current, candidateCount: candidateCountRef.current, required: confirmClosedCandles });
                  if (candidateCountRef.current >= confirmClosedCandles) {
                    if (prevConfirmedRef.current !== candidate) {
                      prevConfirmedRef.current = candidate;
                      setConfirmedCross(candidate);
                      setConfirmedSource('ws');
                      // also update public `cross` so UI reflects the closed-candle decision
                      if (prevCrossRef.current !== candidate) {
                        prevCrossRef.current = candidate;
                        setCross(candidate);
                      }
                    }
                  }
                } else {
                  // No crossing event: reset candidate tracking so we only detect real cross events
                  candidateConfirmedRef.current = null;
                  candidateCountRef.current = 0;
                }
                
              }
              } catch (e) {
              // fallback: if we couldn't compute confirmed EMAs, fall back to
              // preview EMAs (if available) to set a confirmed-like value.
              const fallback = (ema9Ref.current != null && ema26Ref.current != null) ? (ema9Ref.current > ema26Ref.current ? 'bull' : 'bear') : null;
              if (fallback && prevConfirmedRef.current !== fallback) {
                prevConfirmedRef.current = fallback;
                setConfirmedCross(fallback);
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
      // if this socket was intentionally replaced by a new one, ignore errors
      if (ws.__replaced) {
        if (debug) console.log('[useEmaCross] ignored error on replaced socket');
        return;
      }
      console.error('ws error', e);
      setStatus('websocket error');
      // close to trigger backoff reconnect
      try { ws.close(); } catch (err) {}
    };

    ws.onclose = () => {
      // if this socket was intentionally replaced by a new one, skip close handling
      if (ws.__replaced) {
        if (debug) console.log('[useEmaCross] websocket was replaced; skipping onclose handling');
        return;
      }
      setConnected(false);
      setStatus('websocket closed');
      wsRef.current = null;
      if (debug) console.log('[useEmaCross] websocket closed');

      // capture intended reconnect target now (before we nullify refs)
      const reconnectTarget = currentSymbolRef.current || symbol;
      // clear active symbol immediately for UI, but keep reconnectTarget for retries
      setActiveSymbol(null);

      // start polling for closed candles while websocket is down
      try {
        if (!pollingTimerRef.current) {
              pollingTimerRef.current = setInterval(async () => {
            try {
              const sym = (reconnectTarget || symbol || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
              if (!sym) return;
                  const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${sym}&interval=${normalizeIntervalForBinance(interval)}&limit=10`;
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
                  const prevShort = (typeof ema9ConfirmedRef.current === 'number') ? ema9ConfirmedRef.current : null;
                  const prevLong = (typeof ema26ConfirmedRef.current === 'number') ? ema26ConfirmedRef.current : null;
                  const newEma9c = updateEMA(ema9ConfirmedRef.current, close, emaShort);
                  const newEma26c = updateEMA(ema26ConfirmedRef.current, close, emaLong);
                  ema9ConfirmedRef.current = newEma9c;
                  ema26ConfirmedRef.current = newEma26c;
                  // sync preview to confirmed
                  ema9Ref.current = newEma9c;
                  ema26Ref.current = newEma26c;
                  setEma9(newEma9c);
                  setEma26(newEma26c);
                  // detect actual crossing event between previous confirmed EMAs and new confirmed EMAs
                  let detectedCross = null;
                  try {
                    if (prevShort != null && prevLong != null) {
                      if (prevShort <= prevLong && newEma9c > newEma26c) detectedCross = 'bull';
                      else if (prevShort >= prevLong && newEma9c < newEma26c) detectedCross = 'bear';
                      else detectedCross = null;
                    }
                  } catch (e) { detectedCross = null; }
                  if (detectedCross != null) {
                    if (candidateConfirmedRef.current === detectedCross) {
                      candidateCountRef.current = (candidateCountRef.current || 0) + 1;
                    } else {
                      candidateConfirmedRef.current = detectedCross;
                      candidateCountRef.current = 1;
                    }
                    if (candidateCountRef.current >= confirmClosedCandles) {
                      if (prevConfirmedRef.current !== detectedCross) {
                        prevConfirmedRef.current = detectedCross;
                        setConfirmedCross(detectedCross);
                        setConfirmedSource('poll');
                        if (prevCrossRef.current !== detectedCross) {
                          prevCrossRef.current = detectedCross;
                          setCross(detectedCross);
                        }
                      }
                    }
                  } else {
                    candidateConfirmedRef.current = null;
                    candidateCountRef.current = 0;
                  }
                  lastProcessedCloseRef.current = k[6];
                  // polling provides closed-candle prices, so update authoritative lastPrice
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
          // prefer reconnecting to the captured target
          const target = reconnectTarget || symbol;
          try { connect(target); } catch (e) { connect(target); }
        }
      }, delay + jitter);

      // finally clear the currentSymbolRef to reflect that socket is closed
      currentSymbolRef.current = null;
    };
  }, [symbol, fetchAndInit, debug, interval, emaShort, emaLong, confirmClosedCandles]);

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
    // Reset EMA/cross state for the new symbol, but do NOT forcibly close the existing websocket
    // to avoid a visible disconnect during a symbol switch. We keep the socket open until the
    // new connection is established by `connect` (which will replace the old socket).
    try {
      // clear reconnect timers and attempts
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      reconnectAttemptsRef.current = 0;

      // reset refs and state for EMA and cross (prepare for new seed)
      prevCrossRef.current = null;
      currentSymbolRef.current = null;
      ema9Ref.current = null;
      ema26Ref.current = null;
      // also clear confirmed/candidate tracking to avoid leaking state between symbols
      ema9ConfirmedRef.current = null;
      ema26ConfirmedRef.current = null;
      prevConfirmedRef.current = null;
      candidateConfirmedRef.current = null;
      candidateCountRef.current = 0;
      lastProcessedCloseRef.current = null;
      setEma9(null);
      setEma26(null);
      setLastPrice(null);
      setCross(null);
      setConfirmedCross(null);
      setLastCandleClosed(false);
      // Set status to reloading while we fetch/init for the new symbol; do NOT set connected=false here,
      // so the UI remains 'connected' until the replacement socket opens (smoother UX).
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

  // Auto-send Telegram only once per confirmed cross event on a closed candle.
  // Debounce by symbol/interval/EMA pair and closed candle time to avoid duplicates.
  // Disable hook-level auto Telegram sending to ensure messages only fire
  // when the UI alert list actually records a cross (handled in App.js).

  return {
    ema9,
    ema26,
    lastPrice,
    lastTick,
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
