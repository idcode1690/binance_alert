import React from 'react';
import { render, screen, act } from '@testing-library/react';
import App from '../App';

// Mock the hook to control confirmedCross transitions
jest.mock('../hooks/useEmaCross', () => {
  const React = require('react');
  const state = {
    ema9: 0,
    ema26: 0,
    lastPrice: 100,
    lastTick: 100,
    lastCandleClosed: true,
    cross: null,
    confirmedCross: null,
    confirmedIsActualCross: false,
    confirmedSource: 'init',
    connected: true,
    status: 'initialized',
    activeSymbol: 'BTCUSDT',
  };
  let setVals;
  function HookMock() {
    const [vals, set] = React.useState(state);
    setVals = set;
    return {
      ...vals,
      connect: () => {},
      disconnect: () => {},
    };
  }
  HookMock.__setState = (next) => setVals && setVals(prev => ({ ...prev, ...next }));
  return {
    __esModule: true,
    default: HookMock,
  };
});

const useEmaCross = require('../hooks/useEmaCross').default;

describe('Alerts list adds on confirmed cross', () => {
  test('adds a bull alert when confirmedCross changes on closed candle', async () => {
    render(<App />);
    // assert empty alerts state specifically via role traversal
    const emptyNode = screen.getByText('No alerts yet.');
    expect(emptyNode).toBeInTheDocument();

    // simulate a real cross event (closed candle) after init
    await act(async () => {
      useEmaCross.__setState({
        confirmedCross: 'bull',
        confirmedIsActualCross: true,
        confirmedSource: 'ws',
        lastPrice: 101,
        activeSymbol: 'BTCUSDT',
        status: 'connected',
      });
    });

    // alert item should appear with Bull label and symbol
    expect(screen.getByText('Bull')).toBeInTheDocument();
    expect(screen.getByText('BTCUSDT')).toBeInTheDocument();
  });
});
