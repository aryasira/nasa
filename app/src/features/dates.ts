// AI-assisted; see README.
// Landing-date explorer (pure, no DOM): for every landing date over the next 13 lunar months, the sunlit,
// Earth-in-view and both-in-view hours of a stay starting then. One long engine scan (scanWindow, 10-minute grid
// aligned with the baseline) is computed in chunks; each stay is then a difference of prefix sums, which gives
// exactly the left-sample counts that windowMetrics uses for the same start time.
import type { Ephem } from '../engine/ephem';
import type { SiteFrame } from '../engine/geometry';
import { scanWindow, STEP_S } from '../engine/metrics';
import type { Mode } from '../engine/visibility';

export const SYNODIC_D = 29.530589; // mean synodic month (lunar day-night cycle), days
export const SPAN_D = 384; // ≈ 13 lunar months
export const SAMPLE_S = 43200; // one landing date every 12 h
const PER_DAY = 86400 / STEP_S; // 144

export interface DateSeries {
  tBase: number;
  stayDays: number;
  sampleS: number;
  /** Landing time of sample i is tBase + i·sampleS; values in hours, NaN when the ephemeris ends before the stay does. */
  sun: Float64Array;
  earth: Float64Array;
  both: Float64Array;
  n: number;
}

/** Incremental scanner: call step() until it returns true (done). progress() in 0…1. */
export class DateScanner {
  private sunC: Int32Array;
  private earthC: Int32Array;
  private bothC: Int32Array;
  private k = 0; // samples filled
  readonly total: number;
  private result: DateSeries | null = null;

  constructor(private ephem: Ephem, private f: SiteFrame, private h: ArrayLike<number>, readonly tBase: number,
    readonly stayDays: number, private mode: Mode, readonly spanDays = SPAN_D, readonly sampleS = SAMPLE_S) {
    const want = Math.round((spanDays + stayDays) * PER_DAY);
    const avail = Math.max(0, Math.floor((ephem.tLast - tBase) / STEP_S));
    this.total = Math.max(0, Math.min(want, avail));
    this.sunC = new Int32Array(this.total + 1);
    this.earthC = new Int32Array(this.total + 1);
    this.bothC = new Int32Array(this.total + 1);
  }

  progress() { return this.total ? this.k / this.total : 1; }

  /** Scan up to `maxSamples` more 10-minute samples. */
  step(maxSamples = 2880): boolean {
    if (this.k >= this.total) return true;
    const n = Math.min(maxSamples, this.total - this.k);
    const a = this.tBase + this.k * STEP_S;
    const s = scanWindow(this.ephem, this.f, this.h, a, a + n * STEP_S, this.mode);
    for (let i = 0; i < n; i++) { // left samples only
      const j = this.k + i;
      this.sunC[j + 1] = this.sunC[j] + s.sunVis[i];
      this.earthC[j + 1] = this.earthC[j] + s.earthVis[i];
      this.bothC[j + 1] = this.bothC[j] + (s.sunVis[i] & s.earthVis[i]);
    }
    this.k += n;
    return this.k >= this.total;
  }

  series(): DateSeries {
    if (this.result) return this.result;
    const stayN = Math.round(this.stayDays * PER_DAY);
    const stepK = Math.round(this.sampleS / STEP_S);
    const n = Math.floor((this.spanDays * 86400) / this.sampleS) + 1;
    const sun = new Float64Array(n), earth = new Float64Array(n), both = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const k0 = i * stepK, k1 = k0 + stayN;
      if (k1 > this.k) { sun[i] = earth[i] = both[i] = NaN; continue; }
      sun[i] = (this.sunC[k1] - this.sunC[k0]) / 6;
      earth[i] = (this.earthC[k1] - this.earthC[k0]) / 6;
      both[i] = (this.bothC[k1] - this.bothC[k0]) / 6;
    }
    const r = { tBase: this.tBase, stayDays: this.stayDays, sampleS: this.sampleS, sun, earth, both, n };
    if (this.k >= this.total) this.result = r;
    return r;
  }
}

/** Run a scanner to the end synchronously (tests, small jobs). */
export function scanDates(ephem: Ephem, f: SiteFrame, h: ArrayLike<number>, tBase: number, stayDays: number, mode: Mode, spanDays = SPAN_D, sampleS = SAMPLE_S): DateSeries {
  const s = new DateScanner(ephem, f, h, tBase, stayDays, mode, spanDays, sampleS);
  while (!s.step(1e9));
  return s.series();
}

export interface BestDate { i: number; t: number; both: number; sun: number; earth: number }

/** Best landing dates by both-in-view hours, at least `minGapD` days apart. */
export function bestDates(s: DateSeries, count = 3, minGapD = 10): BestDate[] {
  const idx = [...Array(s.n).keys()].filter((i) => Number.isFinite(s.both[i]));
  idx.sort((a, b) => s.both[b] - s.both[a] || a - b);
  const out: BestDate[] = [];
  const gap = (minGapD * 86400) / s.sampleS;
  for (const i of idx) {
    if (out.length >= count) break;
    if (out.some((o) => Math.abs(o.i - i) < gap)) continue;
    out.push({ i, t: s.tBase + i * s.sampleS, both: s.both[i], sun: s.sun[i], earth: s.earth[i] });
  }
  return out;
}

/**
 * Dominant repeat period (days) of a series, from the autocorrelation peak between 20 and 40 days.
 * Returns null when the series is flat (e.g. Sun always up) or too short.
 */
export function rhythmDays(s: DateSeries, which: 'sun' | 'both' = 'sun'): number | null {
  const x = Array.from(s[which]).filter(Number.isFinite);
  const n = x.length;
  if (n < (80 * 86400) / s.sampleS) return null;
  const mean = x.reduce((a, b) => a + b, 0) / n;
  const d = x.map((v) => v - mean);
  const v0 = d.reduce((a, b) => a + b * b, 0);
  if (v0 < 1e-6 * n) return null;
  let best = -Infinity, lag = 0;
  for (let L = Math.round((20 * 86400) / s.sampleS); L <= Math.round((40 * 86400) / s.sampleS); L++) {
    let c = 0;
    for (let i = 0; i + L < n; i++) c += d[i] * d[i + L];
    c /= n - L;
    if (c > best) { best = c; lag = L; }
  }
  return best > 0.2 * (v0 / n) ? (lag * s.sampleS) / 86400 : null;
}

export interface MonthBlock { t: number; meanSun: number }

/** Mean sunlit hours per stay for landing dates in consecutive lunar-month blocks (the seasonal trend). */
export function monthlyMeans(s: DateSeries): MonthBlock[] {
  const per = (SYNODIC_D * 86400) / s.sampleS;
  const out: MonthBlock[] = [];
  for (let b = 0; (b + 1) * per <= s.n; b++) {
    let sum = 0, c = 0;
    for (let i = Math.round(b * per); i < Math.round((b + 1) * per); i++) if (Number.isFinite(s.sun[i])) { sum += s.sun[i]; c++; }
    if (c > 0.8 * per) out.push({ t: s.tBase + Math.round((b + 0.5) * per) * s.sampleS, meanSun: sum / c });
  }
  return out;
}
