/** The two numeric helpers every scoring module was defining for itself. */

export function clamp(value: number, low = 0, high = 1): number {
  return Math.min(high, Math.max(low, value));
}

/** Round to `places` decimals — one by default, which is what scores display. */
export function round(value: number, places = 1): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}
