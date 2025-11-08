import React from 'react';
import { render, waitFor, act } from '@testing-library/react';
import useEmaCross from './useEmaCross';

function Harness({ symbol, onUpdate }) {
  const vals = useEmaCross({ symbol, autoConnect: false, debug: false });
  React.useEffect(() => {
    if (onUpdate) onUpdate(vals);
  }, [vals, onUpdate]);
  return null;
}

describe('useEmaCross symbol switch reconnect behavior', () => {
  const origFetch = global.fetch;
  const OrigWS = global.WebSocket;

  beforeEach(() => jest.useFakeTimers());
  afterEach(() => {
    jest.useRealTimers();
    global.fetch = origFetch;
    global.WebSocket = OrigWS;
    jest.resetAllMocks();
  });

  test('connected should not briefly go false when replacing socket', async () => {
    // mock initial klines
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(new Array(60).fill(0).map((_, i) => [i, '1', '1', '1', String(100 + i), '0', i + 1])) });

    // fake websocket that allows controlling open timing
    const instances = [];
    class FakeWS {
      constructor(url) {
        this.url = url;
        this.readyState = 0;
        this.onopen = null;
        this.onmessage = null;
        this.onclose = null;
        this.onerror = null;
        instances.push(this);
        // do not auto-open; tests will call open()
      }
      open() { this.readyState = 1; if (this.onopen) this.onopen(); }
      close() { this.readyState = 3; if (this.onclose) this.onclose(); }
      send() {}
    }
    global.WebSocket = FakeWS;

    const updates = [];
    render(<Harness symbol="AAAUSDT" onUpdate={(v) => updates.push({ connected: v.connected, active: v.activeSymbol, status: v.status })} />);

    // wait for initial seeding to finish
    await waitFor(() => expect(updates.some(u => u.status === 'initialized')).toBe(true));

  // call connect for symbol AAAUSDT -> creates first WS instance

    // We need access to the hook's connect function. Render Harness doesn't give direct handle,
    // so re-render a harness that exposes the hook via a ref-like callback.
    let currentVals = null;
    function Expose() {
      const v = useEmaCross({ symbol: 'AAAUSDT', autoConnect: false, debug: false });
      React.useEffect(() => { currentVals = v; });
      return null;
    }
    render(<Expose />);

  // call connect to create ws0 (wrap in act to avoid state update warnings)
  await waitFor(() => expect(currentVals).not.toBeNull());
  await act(async () => { currentVals.connect('AAAUSDT'); });
  // wait for the websocket instance to be created (fetchAndInit may be async)
  await waitFor(() => expect(instances.length).toBeGreaterThanOrEqual(1));
  // simulate ws0 open immediately
  await act(async () => { instances[0].open(); });

  // now connected should be true
  await waitFor(() => expect(currentVals.connected).toBe(true));

  // Now initiate connect to BBBUSDT but delay its open to simulate network lag
  await act(async () => { currentVals.connect('BBBUSDT'); });
  // wait for second instance to appear
  await waitFor(() => expect(instances.length).toBeGreaterThanOrEqual(2));

  // Do NOT open the second socket yet; check that connected remains true
  expect(currentVals.connected).toBe(true);

  // Now open the second socket (simulate successful replacement)
  await act(async () => { instances[1].open(); });

  // After open, connected should remain true and activeSymbol updated
  await waitFor(() => expect(currentVals.connected).toBe(true));
  await waitFor(() => expect(currentVals.activeSymbol).toBe('BBBUSDT'));
  });
});
