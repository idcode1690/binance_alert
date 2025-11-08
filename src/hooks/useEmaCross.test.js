import React from 'react';
import { act, render, waitFor } from '@testing-library/react';
import useEmaCross from './useEmaCross';

// Helper harness to expose hook return values to the test via callback
function Harness({ symbol, autoConnect = false, debug = false, onReady }) {
  const vals = useEmaCross({ symbol, autoConnect, debug });
  React.useEffect(() => {
    if (onReady) onReady(vals);
  }, [vals, onReady]);
  return null;
}

describe('useEmaCross closed-candle behavior', () => {
  const originalFetch = global.fetch;
  const OriginalWebSocket = global.WebSocket;

  // create deterministic klines: increasing close prices -> initial bull
  function makeKlines(count = 60, start = 100, step = 1) {
    const now = Date.now();
    const out = [];
    for (let i = 0; i < count; i++) {
      const openTime = now - (count - i) * 60000;
      const close = start + i * step;
      // klines array: [openTime, open, high, low, close, volume, closeTime, ...]
      out.push([openTime, String(close - 0.1), String(close + 0.1), String(close - 0.2), String(close), '0', openTime + 60000]);
    }
    return out;
  }

  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
    global.fetch = originalFetch;
    global.WebSocket = OriginalWebSocket;
    jest.resetAllMocks();
  });

  test('confirmedCross only updates on closed candles', async () => {
    // Mock fetch for initial klines and any polling calls
    global.fetch = jest.fn().mockImplementation((url) => {
      // return 1m klines response shape
      return Promise.resolve({ ok: true, json: () => Promise.resolve(makeKlines(60, 100, 1)) });
    });

    // Fake WebSocket implementation to let test drive onmessage
    let wsInstance = null;
    class FakeWS {
      constructor(url) {
        this.url = url;
        this.readyState = 1;
        wsInstance = this;
        // handlers
        this.onopen = null;
        this.onmessage = null;
        this.onclose = null;
        this.onerror = null;
        // emulate async open
        setTimeout(() => { if (this.onopen) this.onopen(); }, 0);
      }
      send() {}
      close() { this.readyState = 3; if (this.onclose) this.onclose(); }
    }
    global.WebSocket = FakeWS;

    let captured = null;
    render(<Harness symbol="TESTUSDT" autoConnect={false} debug={false} onReady={(v) => { captured = v; }} />);

    // Helper defined outside loops to avoid no-loop-func lint warning
    async function fireWsMessage(stream, payload) {
      await act(async () => {
        wsInstance.onmessage({ data: JSON.stringify({ stream, data: payload }) });
      });
    }

    // wait until initial seeding completed (confirmedSource === 'init')
    await waitFor(() => expect(captured.confirmedSource).toBe('init'));
    const initial = captured.confirmedCross;

    // Now connect (will create FakeWS)
    await act(async () => {
      await captured.connect('TESTUSDT');
    });
    // FakeWS onopen은 setTimeout(0)으로 비동기이므로 타이머 한 틱 진행
    act(() => { jest.advanceTimersByTime(1); });

    // Send an aggTrade message that would move preview EMAs (but should NOT change confirmedCross)
    const aggMsg = { e: 'aggTrade', p: String(50) };
    await fireWsMessage('testusdt@aggTrade', aggMsg);

    // confirmedCross should remain unchanged
    expect(captured.confirmedCross).toBe(initial);

  // 만약 아직 교차가 바뀌지 않았다면(EMA 관성으로 인한 지연), 추가로 더 많은 닫힌 캔들을 전송한다.
    // Send a partial kline (k.x = false) - should also NOT update confirmedCross
    const partialK = { k: { x: false, c: String(200), T: Date.now() } };
    await fireWsMessage('testusdt@kline_1m', partialK);
    expect(captured.confirmedCross).toBe(initial);

    // Send a CLOSED kline (k.x = true) with price that will invert EMAs enough to change cross
    // Use a price much lower than historical to force a bearish cross
    const closedK = { k: { x: true, c: String(10), T: Date.now() + 60000 } };
    await fireWsMessage('testusdt@kline_1m', closedK);

    if (captured.confirmedCross === initial) {
      const tStart = Date.now() + 2 * 60000;
      for (let j = 0; j < 20; j++) {
        const closedK2 = { k: { x: true, c: String(1), T: tStart + j * 60000 } };
        // eslint-disable-next-line no-await-in-loop
        await fireWsMessage('testusdt@kline_1m', closedK2);
        if (captured.confirmedCross !== initial) break;
      }
    }

    // wait until confirmedCross changed (poll/event loop)
    await waitFor(() => expect(captured.confirmedSource).toBe('ws'));
    expect(captured.confirmedCross).not.toBe(initial);
  });
});
