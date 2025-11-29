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
import { render, screen } from '@testing-library/react';
import App from '../App';

// Ensure fetch exists and capture calls
const originalFetch = global.fetch;
beforeEach(() => {
  process.env.REACT_APP_SERVER_URL = 'https://binance-alert.idcode1690.workers.dev';
  try { window.localStorage.setItem('serverUrl', 'https://binance-alert.idcode1690.workers.dev'); } catch (e) {}
  global.fetch = jest.fn(async (url, opts) => ({ ok: true, status: 200, json: async () => ({ ok: true }) }));
});

afterEach(() => {
  global.fetch = originalFetch;
});

test.skip('Test Telegram button was removed from UI', async () => {
  render(<App />);
  expect(screen.queryByText('Test Telegram')).toBeNull();
});
