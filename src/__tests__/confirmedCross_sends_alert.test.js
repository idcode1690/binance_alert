/* eslint-disable import/first */
// IMPORTANT: mock BEFORE importing App so the hook is intercepted
jest.mock('../hooks/useEmaCross', () => ({
  __esModule: true,
  default: jest.fn(() => ({
    ema9: 100,
    ema26: 99,
    lastPrice: 123.45,
    lastTick: 123.4,
    lastCandleClosed: true,
    cross: null,
    confirmedCross: 'bull',
    confirmedSource: 'live',
    connected: true,
    status: 'initialized', // triggers auto connect path
    connect: jest.fn(),
    disconnect: jest.fn(),
    activeSymbol: 'BTCUSDT',
  })),
}));

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import App from '../App';

// Ensure fetch exists and capture calls
const originalFetch = global.fetch;
beforeEach(() => {
  process.env.REACT_APP_SERVER_URL = 'https://binance-alert.idcode1690.workers.dev';
  process.env.REACT_APP_SHOW_SERVER_BUTTONS = '1';
  // Provide localStorage with serverUrl override so App picks it immediately
  Object.defineProperty(window, 'localStorage', {
    value: {
      getItem: (k) => (k === 'serverUrl' ? 'https://binance-alert.idcode1690.workers.dev' : null),
      setItem: jest.fn(),
      removeItem: jest.fn(),
    },
    configurable: true,
  });
  global.fetch = jest.fn(async (url, opts) => ({ ok: true, status: 200, json: async () => ({ ok: true }) }));
});

afterEach(() => {
  global.fetch = originalFetch;
});

test('Test Telegram button triggers /send-alert POST', async () => {
  render(<App />);
  // Click the Test Telegram button to force a send
  const btn = await screen.findByText('Test Telegram');
  fireEvent.click(btn);
  // Wait for the network call
  let calls = [];
  for (let i = 0; i < 10; i++) {
    await new Promise((r) => setTimeout(r, 100));
    calls = global.fetch.mock.calls.filter(([url]) => /\/send-alert$/.test(String(url)));
    if (calls.length > 0) break;
  }
  expect(calls.length).toBeGreaterThan(0);
  const [url, opts] = calls[0];
  expect(String(url)).toMatch(/\/send-alert$/);
  expect(opts && opts.method).toBe('POST');
});
