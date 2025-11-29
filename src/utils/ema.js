// Lightweight EMA utilities
export function sma(values) {
  if (!values || values.length === 0) return null;
  const sum = values.reduce((s, v) => s + v, 0);
  return sum / values.length;
}

// Calculate the last EMA value for an array of closing prices.
// values: array of numbers (chronological oldest->newest), period: integer
export function calculateInitialEMA(values, period) {
  if (!Array.isArray(values) || values.length < period) {
    throw new Error('Not enough data to calculate initial EMA');
  }

  // Start with SMA of the first `period` values
  let ema = sma(values.slice(0, period));
  const multiplier = 2 / (period + 1);

  // Apply EMA formula for the rest of the values
  for (let i = period; i < values.length; i++) {
    const price = values[i];
    ema = (price - ema) * multiplier + ema;
  }

  return ema;
}

// Update EMA given previous EMA and the latest price
export function updateEMA(prevEMA, price, period) {
  const multiplier = 2 / (period + 1);
  return (price - prevEMA) * multiplier + prevEMA;
}

const ema = { sma, calculateInitialEMA, updateEMA };
export default ema;
