// EMA utilities for server (CommonJS)
function sma(values) {
  if (!values || values.length === 0) return null;
  const sum = values.reduce((s, v) => s + v, 0);
  return sum / values.length;
}

function calculateInitialEMA(values, period) {
  if (!Array.isArray(values) || values.length < period) {
    throw new Error('Not enough data to calculate initial EMA');
  }

  let ema = sma(values.slice(0, period));
  const multiplier = 2 / (period + 1);

  for (let i = period; i < values.length; i++) {
    const price = values[i];
    ema = (price - ema) * multiplier + ema;
  }

  return ema;
}

function updateEMA(prevEMA, price, period) {
  const multiplier = 2 / (period + 1);
  return (price - prevEMA) * multiplier + prevEMA;
}

module.exports = { sma, calculateInitialEMA, updateEMA };
