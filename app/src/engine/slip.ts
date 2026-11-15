// AI-ASSISTED: drafted with Claude (Anthropic), reviewed by the human team.
// Slip ranking: baseline vs slipped date vs next date that recovers the baseline vs alternate sites.
import type { CauseLine, FeaturesFile, HorizonFile, Site, SlipOption, WindowMetrics } from '@contracts/types';
import { Ephem, fmtUtc } from './ephem';
import { siteFrame, surfaceDistanceKm } from './geometry';
import { hasBand, windowMetrics, type Scan } from './metrics';
import { causeLines, visibleHours } from './causes';
import type { Mode } from './visibility';

export interface SlipOptionEx extends SlipOption {
  kind: 'baseline' | 'slip' | 'recover' | 'alternate';
  scan: Scan;
  note?: string;
}

export interface SlipInput {
  ephem: Ephem;
  site: Site;
  horizons: Map<string, HorizonFile>;
  sites: Site[];
  features: FeaturesFile | null;
  tStart: number; // baseline landing, POSIX s
  stayDays: number;
  slipDays: number;
  mode: Mode;
  searchDays?: number; // default 60
  maxAlternates?: number; // default 3
  alternateRangeKm?: number; // default 1000
}

const DAY = 86400;
const NUM_KEYS = ['sunlit_h', 'earth_visible_pct', 'both_visible_h', 'longest_dark_gap_h', 'eclipse_h'] as const;

function delta(m: WindowMetrics, base: WindowMetrics): SlipOption['delta'] {
  const d: SlipOption['delta'] = {};
  for (const k of NUM_KEYS) d[k] = m[k] - base[k];
  return d;
}

export function slipOptions(inp: SlipInput): SlipOptionEx[] {
  const { ephem, site, horizons, mode } = inp;
  const stay = inp.stayDays * DAY;
  const hz = horizons.get(site.id);
  if (!hz) throw new Error(`no horizon for ${site.id}`);
  const f = siteFrame(site);
  const fits = (t: number) => ephem.covers(t) && ephem.covers(t + stay);
  if (!fits(inp.tStart)) throw new RangeError('The baseline window is outside the ephemeris coverage.');

  const base = windowMetrics(ephem, f, hz, inp.tStart, inp.tStart + stay, mode, { band: hasBand(hz) });
  const mk = (kind: SlipOptionEx['kind'], label: string, s: Site, h: HorizonFile, t: number, note?: string): SlipOptionEx => {
    const r = kind === 'baseline' ? base : windowMetrics(ephem, siteFrame(s), h, t, t + stay, mode, { band: hasBand(h) });
    return {
      kind, label, site_id: s.id, start_utc: fmtUtc(t), metrics: r.metrics, scan: r.scan, note,
      delta: delta(r.metrics, base.metrics),
      causes: kind === 'baseline' ? [] : causeLines({ scan: base.scan, hz }, { scan: r.scan, hz: h }, inp.features, undefined, names),
    };
  };

  const names = new Map(inp.sites.map((x) => [x.id, x.name]));
  const out: SlipOptionEx[] = [mk('baseline', 'Baseline', site, hz, inp.tStart)];
  const tSlip = inp.tStart + inp.slipDays * DAY;
  const rest: SlipOptionEx[] = [];
  if (inp.slipDays !== 0 && !fits(tSlip)) {
    throw new RangeError(`The ${inp.slipDays > 0 ? '+' : ''}${inp.slipDays} d slipped ${inp.stayDays}-day window is outside the ephemeris coverage.`);
  }
  if (inp.slipDays !== 0) {
    rest.push(mk('slip', `${inp.slipDays > 0 ? '+' : ''}${inp.slipDays} d slip`, site, hz, tSlip));

    // Next date after the slip whose both-visible hours recover the baseline (1-day steps).
    // Only for a real slip (later date): after an advance the baseline itself is still available.
    const search = inp.slipDays > 0 ? inp.searchDays ?? 60 : 0;
    let best: { t: number; both: number } | null = null, hit: number | null = null;
    for (let d = 1; d <= search; d++) {
      const t = tSlip + d * DAY;
      if (!fits(t)) break;
      const both = windowMetrics(ephem, f, hz, t, t + stay, mode).metrics.both_visible_h;
      if (!best || both > best.both + 1e-9) best = { t, both };
      if (both >= base.metrics.both_visible_h - 1e-9) { hit = t; break; }
    }
    const slipBoth = rest[0].metrics.both_visible_h;
    if (hit != null && slipBoth < base.metrics.both_visible_h - 1e-9) {
      const d = Math.round((hit - inp.tStart) / DAY);
      rest.push(mk('recover', `Next date as good as baseline (+${d} d)`, site, hz, hit,
        `First landing date after the slip, in 1-day steps, with at least the baseline's Sun-and-Earth hours.`));
    } else if (hit == null && best && best.both > slipBoth + 1e-9) {
      const d = Math.round((best.t - inp.tStart) / DAY);
      rest.push(mk('recover', `Best date within ${search} d after the slip (+${d} d)`, site, hz, best.t,
        `No date within ${search} days after the slip matches the baseline; this is the best one found.`));
    }

    // Alternate catalogue sites on the slipped date.
    const alts = inp.sites
      .filter((s) => s.id !== site.id && horizons.has(s.id))
      .map((s) => ({ s, km: surfaceDistanceKm(site, s) }))
      .filter((x) => x.km <= (inp.alternateRangeKm ?? 1000))
      .sort((x, y) => x.km - y.km)
      .slice(0, inp.maxAlternates ?? 3);
    for (const { s, km } of alts) {
      rest.push(mk('alternate', `Alternate site: ${s.name}`, s, horizons.get(s.id)!, tSlip,
        `${km.toFixed(0)} km from ${site.name}, same slipped date.`));
    }
  }
  rest.sort((a, b) => (b.delta.both_visible_h ?? 0) - (a.delta.both_visible_h ?? 0));
  return out.concat(rest);
}

export interface BodyChange {
  body: 'sun' | 'earth';
  before_h: number;
  after_h: number;
  delta_h: number;
  /** Largest cause line with the same sign as the change, or null. */
  cause: CauseLine | null;
  /** True when that cause is not larger than the change, so its hours may be quoted as explaining it. */
  causeFits: boolean;
}

/** Net change in visible hours per body (|change| ≥ minH), largest first, with its main same-sign cause. */
export function bodyChanges(base: SlipOptionEx, o: SlipOptionEx, minH = 0.5): BodyChange[] {
  return (['sun', 'earth'] as const).map((body) => {
    const before_h = visibleHours(base.scan, body), after_h = visibleHours(o.scan, body), delta_h = after_h - before_h;
    const cause = o.causes.find((c) => c.body === body && c.delta_h * delta_h > 0) ?? null;
    return { body, before_h, after_h, delta_h, cause, causeFits: !!cause && Math.abs(cause.delta_h) <= Math.abs(delta_h) + 1e-6 };
  }).filter((x) => Math.abs(x.delta_h) >= minH).sort((x, y) => Math.abs(y.delta_h) - Math.abs(x.delta_h));
}
