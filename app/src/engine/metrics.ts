// AI-ASSISTED: drafted with Claude (Anthropic), reviewed by the human team.
// Window scan and metrics. Implements docs/engine-spec.md section 5.
import type { HorizonFile, WindowMetrics } from '@contracts/types';
import { Ephem, fmtUtc } from './ephem';
import { observe, type SiteFrame } from './geometry';
import { discFraction, horizonAt, isVisible, type Mode } from './visibility';

export const STEP_S = 600;
const BISECT_TOL_S = 1;
/** Flat horizon used as the "no terrain" comparison (same value the pipeline gives sphere sites). */
export const SPHERE_HORIZON_DEG = 0;

export type HorizonKey = 'elev_deg' | 'elev_lo_deg' | 'elev_hi_deg';
export type Body = 'sun' | 'earth';

export interface Scan {
  tStart: number;
  tEnd: number;
  n: number; // number of 10-minute intervals; arrays hold n + 1 samples (k = 0..n, k = n is the window end)
  sunVis: Uint8Array;
  earthVis: Uint8Array;
  sunVisSphere: Uint8Array; // same test against a flat 0 deg horizon (no terrain)
  earthVisSphere: Uint8Array;
  eclipse: Uint8Array; // Earth partly covers the Sun, pure geometry
  sunAz: Float32Array;
  sunEl: Float32Array;
  earthAz: Float32Array;
  earthEl: Float32Array;
}

function bodyVisible(ephem: Ephem, f: SiteFrame, h: ArrayLike<number>, t: number, body: Body, mode: Mode): boolean {
  const o = observe(ephem, f, t);
  return body === 'sun'
    ? isVisible(discFraction(o.sunEl, o.sunR, horizonAt(h, o.sunAz)), mode)
    : isVisible(discFraction(o.earthEl, o.earthR, horizonAt(h, o.earthAz)), mode);
}

export function scanWindow(ephem: Ephem, f: SiteFrame, h: ArrayLike<number>, tStart: number, tEnd: number, mode: Mode): Scan {
  const n = Math.round((tEnd - tStart) / STEP_S);
  const m = n + 1;
  const s: Scan = {
    tStart, tEnd, n,
    sunVis: new Uint8Array(m), earthVis: new Uint8Array(m),
    sunVisSphere: new Uint8Array(m), earthVisSphere: new Uint8Array(m), eclipse: new Uint8Array(m),
    sunAz: new Float32Array(m), sunEl: new Float32Array(m), earthAz: new Float32Array(m), earthEl: new Float32Array(m),
  };
  for (let k = 0; k < m; k++) {
    const o = observe(ephem, f, tStart + STEP_S * k);
    s.sunVis[k] = +isVisible(discFraction(o.sunEl, o.sunR, horizonAt(h, o.sunAz)), mode);
    s.earthVis[k] = +isVisible(discFraction(o.earthEl, o.earthR, horizonAt(h, o.earthAz)), mode);
    s.sunVisSphere[k] = +isVisible(discFraction(o.sunEl, o.sunR, SPHERE_HORIZON_DEG), mode);
    s.earthVisSphere[k] = +isVisible(discFraction(o.earthEl, o.earthR, SPHERE_HORIZON_DEG), mode);
    s.eclipse[k] = +o.eclipsePartial;
    s.sunAz[k] = o.sunAz; s.sunEl[k] = o.sunEl; s.earthAz[k] = o.earthAz; s.earthEl[k] = o.earthEl;
  }
  return s;
}

function nextSet(ephem: Ephem, f: SiteFrame, h: ArrayLike<number>, s: Scan, body: Body, mode: Mode): string | null {
  const v = body === 'sun' ? s.sunVis : s.earthVis;
  for (let k = 0; k < s.n; k++) {
    if (v[k] && !v[k + 1]) {
      let lo = s.tStart + STEP_S * k, hi = lo + STEP_S;
      while (hi - lo > BISECT_TOL_S) {
        const mid = 0.5 * (lo + hi);
        if (bodyVisible(ephem, f, h, mid, body, mode)) lo = mid; else hi = mid;
      }
      return fmtUtc(hi);
    }
  }
  return null;
}

export function metricsFromScan(ephem: Ephem, f: SiteFrame, h: ArrayLike<number>, s: Scan, mode: Mode): WindowMetrics {
  let sun = 0, earth = 0, both = 0, ecl = 0, run = 0, longest = 0;
  for (let k = 0; k < s.n; k++) { // left samples only
    sun += s.sunVis[k]; earth += s.earthVis[k]; both += s.sunVis[k] & s.earthVis[k];
    ecl += s.sunVis[k] & s.eclipse[k];
    run = s.sunVis[k] ? 0 : run + 1;
    if (run > longest) longest = run;
  }
  const dtH = STEP_S / 3600;
  return {
    site_id: f.site.id,
    start_utc: fmtUtc(s.tStart),
    end_utc: fmtUtc(s.tEnd),
    sunlit_h: sun * dtH,
    earth_visible_pct: s.n ? (100 * earth) / s.n : 0,
    both_visible_h: both * dtH,
    longest_dark_gap_h: longest * dtH,
    next_sunset_utc: nextSet(ephem, f, h, s, 'sun', mode),
    next_earthset_utc: nextSet(ephem, f, h, s, 'earth', mode),
    eclipse_h: ecl * dtH,
  };
}

export interface WindowResult { metrics: WindowMetrics; scan: Scan }

/** True when the horizon file carries a real uncertainty band (Agent A: do not show one until sigma is set). */
export function hasBand(hz: HorizonFile): boolean {
  return hz.dem.sigma_m != null;
}

export function windowMetrics(
  ephem: Ephem, f: SiteFrame, hz: HorizonFile, tStart: number, tEnd: number, mode: Mode,
  opts: { band?: boolean } = {},
): WindowResult {
  const scan = scanWindow(ephem, f, hz.elev_deg, tStart, tEnd, mode);
  const metrics = metricsFromScan(ephem, f, hz.elev_deg, scan, mode);
  if (opts.band) {
    const one = (key: HorizonKey) => metricsFromScan(ephem, f, hz[key], scanWindow(ephem, f, hz[key], tStart, tEnd, mode), mode);
    metrics.band = { lo: one('elev_lo_deg'), hi: one('elev_hi_deg') };
  }
  return { metrics, scan };
}
