'use strict';

const DEFAULT_PUBLIC_INTERVAL = 120_000;
const MIN_AUTHENTICATED_INTERVAL = 5_000;

function getPollInterval(requested, authenticated) {
  const minimum = authenticated ? MIN_AUTHENTICATED_INTERVAL : DEFAULT_PUBLIC_INTERVAL;
  const interval = Number(requested);
  if (!Number.isFinite(interval) || interval <= 0) return minimum;
  return Math.max(Math.floor(interval), minimum);
}

module.exports = { getPollInterval, DEFAULT_PUBLIC_INTERVAL, MIN_AUTHENTICATED_INTERVAL };
