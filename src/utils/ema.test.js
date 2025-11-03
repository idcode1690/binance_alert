import { calculateInitialEMA, updateEMA, sma } from './ema';

test('sma calculates average', () => {
  expect(sma([1, 2, 3, 4])).toBe(2.5);
});

test('calculateInitialEMA throws on insufficient data', () => {
  expect(() => calculateInitialEMA([1, 2], 3)).toThrow();
});

test('calculateInitialEMA and updateEMA produce consistent results', () => {
  // simple sequence
  const closes = [10, 11, 12, 13, 14, 15, 16];
  const period = 3;

  // compute initial EMA across the whole array
  const emaFull = calculateInitialEMA(closes, period);

  // compute EMA on first (n-1) then update with last value
  const emaPartial = calculateInitialEMA(closes.slice(0, closes.length - 1), period);
  const updated = updateEMA(emaPartial, closes[closes.length - 1], period);

  // They should be very close
  expect(Math.abs(emaFull - updated)).toBeLessThan(1e-9);
});
