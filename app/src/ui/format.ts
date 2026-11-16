// AI-assisted; see README.
// Number formatting for the brief, including terrain-uncertainty bands: "82.0 h (78–85)".
import type { WindowMetrics } from '@contracts/types';

export type HourKey = 'sunlit_h' | 'both_visible_h' | 'longest_dark_gap_h' | 'earth_visible_pct';

/** Low and high ends of a metric across the lowered-terrain and raised-terrain horizons, or null without a band. */
export function bandRange(m: WindowMetrics, key: HourKey): [number, number] | null {
  const lo = m.band?.lo[key], hi = m.band?.hi[key];
  if (typeof lo !== 'number' || typeof hi !== 'number') return null;
  return [Math.min(lo, hi, m[key]), Math.max(lo, hi, m[key])];
}

/** Band of the change against a baseline: each terrain case compared with the same case of the baseline. */
export function deltaRange(m: WindowMetrics, base: WindowMetrics, key: HourKey): [number, number] | null {
  const a = m.band, b = base.band;
  if (!a || !b) return null;
  const ds = [m[key] - base[key]];
  for (const side of ['lo', 'hi'] as const) {
    const x = a[side][key], y = b[side][key];
    if (typeof x !== 'number' || typeof y !== 'number') return null;
    ds.push(x - y);
  }
  return [Math.min(...ds), Math.max(...ds)];
}

const minus = (v: number, digits: number) => (v < 0 ? '−' : '') + Math.abs(v).toFixed(digits);

/** "82.0 (78–85)"; the band is omitted when absent or when both ends round to the value itself. */
export function withBand(value: string, range: [number, number] | null, signedEnds = false): string {
  if (!range) return value;
  if (Math.round(range[0]) === Math.round(range[1])) return value; // an empty band adds nothing
  const f = (v: number) => (signedEnds ? (v > 0 ? '+' : '') + minus(v, 0) : minus(v, 0));
  return `${value} (${f(range[0])}${signedEnds ? ' to ' : '–'}${f(range[1])})`;
}
