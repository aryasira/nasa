// AI-ASSISTED: drafted with Claude (Anthropic), reviewed by the human team.
// Countdown to the next sunset / sunrise / Earthset / Earthrise against the local terrain horizon.
// Pure (no DOM). Uses only the validated engine: observe → horizonAt → discFraction → isVisible.
import type { Ephem } from '../engine/ephem';
import { observe, type SiteFrame } from '../engine/geometry';
import { discFraction, horizonAt, isVisible, type Mode } from '../engine/visibility';

export type Body = 'sun' | 'earth';
export const SEARCH_STEP_S = 600; // 10-minute coarse search, same grid as the window metrics
export const BISECT_TO_S = 60; // refine to 1 minute
export const MAX_SEARCH_DAYS = 30;

export function visibleAt(ephem: Ephem, f: SiteFrame, h: ArrayLike<number>, t: number, body: Body, mode: Mode): boolean {
  const o = observe(ephem, f, t);
  return body === 'sun'
    ? isVisible(discFraction(o.sunEl, o.sunR, horizonAt(h, o.sunAz)), mode)
    : isVisible(discFraction(o.earthEl, o.earthR, horizonAt(h, o.earthAz)), mode);
}

export interface NextChange {
  body: Body;
  from: number; // query time (s)
  visibleNow: boolean;
  /** First time (s, refined to ≤ 1 min) at which visibility flips; null if none before `searchedTo`. */
  t: number | null;
  searchedTo: number;
}

/**
 * Next visibility change of `body` after `t`: step forward 10 minutes at a time (up to 30 days, never past the
 * ephemeris), then bisect the bracketing step to 1 minute. Same rule as metrics.ts next_sunset_utc (which uses
 * 1 s); changes shorter than 10 minutes between grid points are skipped, as in the metrics.
 */
export function nextChange(ephem: Ephem, f: SiteFrame, h: ArrayLike<number>, t: number, body: Body, mode: Mode, maxDays = MAX_SEARCH_DAYS): NextChange {
  const end = Math.min(t + maxDays * 86400, ephem.tLast);
  const v0 = visibleAt(ephem, f, h, t, body, mode);
  let prev = t;
  for (let k = 1; ; k++) {
    const tk = t + k * SEARCH_STEP_S;
    if (tk > end) break;
    if (visibleAt(ephem, f, h, tk, body, mode) !== v0) {
      let lo = prev, hi = tk;
      while (hi - lo > BISECT_TO_S) {
        const mid = 0.5 * (lo + hi);
        if (visibleAt(ephem, f, h, mid, body, mode) === v0) lo = mid; else hi = mid;
      }
      return { body, from: t, visibleNow: v0, t: hi, searchedTo: end };
    }
    prev = tk;
  }
  return { body, from: t, visibleNow: v0, t: null, searchedTo: end };
}

/**
 * Cache so playback stays smooth: between the query time and the found event the state cannot change (at the
 * 10-minute grid), so any later time before the event reuses the answer. "No event" answers are reused for 1 hour.
 */
export class CountdownCache {
  private last = new Map<string, NextChange>();
  get(key: string, ephem: Ephem, f: SiteFrame, h: ArrayLike<number>, t: number, body: Body, mode: Mode): NextChange {
    const k = `${key}|${body}|${mode}`;
    const c = this.last.get(k);
    if (c && t >= c.from && (c.t != null ? t < c.t : t < c.from + 3600)) return c;
    const r = nextChange(ephem, f, h, t, body, mode);
    this.last.set(k, r);
    return r;
  }
  clear() { this.last.clear(); }
}

/** "3 d 04 h", "5 h 12 min", "12 min", "under 1 min". */
export function fmtCountdown(s: number): string {
  s = Math.max(0, s);
  if (s < 60) return 'under 1 min';
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d} d ${String(h).padStart(2, '0')} h`;
  if (h > 0) return `${h} h ${String(m).padStart(2, '0')} min`;
  return `${m} min`;
}

export interface CountdownText { label: string; long: string }

/**
 * Words for the card. `aboveFlat` = the body is above a flat (0°) horizon right now, so a hidden body is behind
 * terrain rather than set. `stayEnd` limits set events to the current stay ("No Earthset in this stay").
 */
export function countdownText(c: NextChange, now: number, stayEnd: number, aboveFlat: boolean): CountdownText {
  const N = c.body === 'sun' ? { set: 'Sunset', rise: 'Sunrise', back: 'Sun back in view', name: 'sunset' }
    : { set: 'Earthset', rise: 'Earthrise', back: 'Earth back in view', name: 'Earthset' };
  const days = Math.round((c.searchedTo - c.from) / 86400);
  if (c.visibleNow) {
    if (c.t == null || c.t > stayEnd) {
      const label = now <= stayEnd ? `No ${N.name} in this stay` : `No ${N.name} in the next ${days} days`;
      return { label, long: c.t == null ? `${label}.` : `${label}; next ${N.name} in ${fmtCountdown(c.t - now)}.` };
    }
    const label = `${N.set} in ${fmtCountdown(c.t - now)}`;
    return { label, long: `${label}.` };
  }
  const word = aboveFlat ? N.back : N.rise;
  if (c.t == null) {
    const label = aboveFlat ? `${c.body === 'sun' ? 'Sun' : 'Earth'} not back in view in the next ${days} days` : `No ${N.rise.toLowerCase() === 'sunrise' ? 'sunrise' : 'Earthrise'} in the next ${days} days`;
    return { label, long: `${label}.` };
  }
  const label = `${word} in ${fmtCountdown(c.t - now)}`;
  return { label, long: `${label}.` };
}
