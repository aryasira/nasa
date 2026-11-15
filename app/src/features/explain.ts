// AI-ASSISTED: drafted with Claude (Anthropic), reviewed by the human team.
// Plain-language mode: short explanations and a 5-step guided tour. Every site-specific number in the tour is
// computed here from the engine (scanWindow, windowMetrics, observe, ephemeris samples); the only constants are
// general facts (1.54° lunar axial tilt to the ecliptic, ≈29.5-day lunar day).
import type { FixturesFile, HorizonFile, Site } from '@contracts/types';
import type { Ephem } from '../engine/ephem';
import { fmtUtc, parseUtc } from '../engine/ephem';
import { observe, siteFrame } from '../engine/geometry';
import { scanWindow, windowMetrics } from '../engine/metrics';
import type { Mode } from '../engine/visibility';

const DAY = 86400;
export const AXIAL_TILT_DEG = 1.54; // Moon's spin axis to the ecliptic pole (Cassini state); bounds the Sun's polar elevation
const R2D = 180 / Math.PI;

/** Short notes shown next to readouts when "Explain" is on, keyed by the element they sit next to. */
export const NOTES: Record<string, string> = {
  power: 'How much of the Sun’s disc is above the skyline here right now — what a solar panel would see.',
  comm: 'Whether Earth is above the skyline, so an antenna could point straight at it (line of sight only).',
  'h-sum': 'A slip moves the whole stay to later dates. A lunar day lasts about 29.5 Earth days (two weeks of light, two of night at the equator), so a slip of a few days can push a stay into darkness.',
  'h-opt': 'Hours with both the Sun (power) and Earth (direct radio link) in view are what a short mission needs most. Each row says why it gains or loses hours.',
  'h-tl': 'Bars show when the Sun and Earth are above the local skyline. The Moon has no air: no twilight and no refraction, so the Sun is simply up or down, and shadows are black.',
  'h-pan': 'The grey band is the skyline all the way round the lander. Near the poles the Sun never climbs high, so a hill a few degrees tall can hide it for days.',
  'h-val': 'We recompute Sun and Earth directions that NASA JPL’s Horizons service publishes and show the largest difference.',
  'feat-dates': 'Each point is a whole stay starting that day. The ups and downs repeat every lunar day; near the poles the yearly drift of the Sun’s path adds a slow trend.',
  'feat-cmp': 'Same landing date and stay length at every site, so the numbers are a fair side-by-side.',
};

export interface TourCtx {
  ephem: Ephem;
  sites: Site[];
  horizons: Map<string, HorizonFile>;
  fixtures: FixturesFile | null;
  mock: boolean;
  t: number; // current baseline landing (s)
  mode: Mode;
}

export interface TourAction {
  state?: Partial<{ site: string; t: string; stay: number; slip: number; mode: Mode }>;
  sim?: { cam?: 'lander' | 'orbit' | 'globe'; t?: number; look?: 'sun' | 'earth'; ab?: 'a' | 'b' };
  scrollTo?: string;
}
export interface TourStep { title: string; body: string; action: TourAction }

const latTxt = (v: number) => `${Math.abs(v).toFixed(2)}°${v < 0 ? 'S' : 'N'}`;
const minute = (t: number) => fmtUtc(t).slice(0, 16);
const clampT = (e: Ephem, t: number) => Math.min(e.tLast - 40 * DAY, Math.max(e.t0, t));
const has = (c: TourCtx, id: string) => c.sites.some((s) => s.id === id) && c.horizons.has(id);
const pick = (c: TourCtx, ids: string[], fallback: (s: Site) => number) =>
  c.sites.find((s) => s.id === ids.find((i) => has(c, i))) ?? [...c.sites].sort((a, b) => fallback(b) - fallback(a))[0];

export const TOUR_TITLES = [
  'Why does the Sun skim the horizon at the pole?',
  'Why does Earth hardly move in the lunar sky? (libration)',
  'What a launch slip does',
  'Why terrain matters',
  'How we check the numbers',
];

/** Build one tour step (lazy: steps 1–4 each scan the engine once). */
export function tourStep(i: number, c: TourCtx): TourStep {
  const mk = (title: string, body: string, action: TourAction) => ({ title, body, action });
  if (i === 0) {
    const s = pick(c, ['connecting_ridge', 'im2', 'im1'], (x) => Math.abs(x.lat));
    const t0 = clampT(c.ephem, c.t);
    const sc = scanWindow(c.ephem, siteFrame(s), c.horizons.get(s.id)!.elev_deg, t0, Math.min(c.ephem.tLast, t0 + 365 * DAY), c.mode, 3600);
    let k = 0;
    for (let j = 1; j <= sc.n; j++) if (sc.sunEl[j] > sc.sunEl[k]) k = j;
    const tMax = t0 + 3600 * k, limit = 90 - Math.abs(s.lat) + AXIAL_TILT_DEG;
    return mk(TOUR_TITLES[0],
      `At ${s.name} (${latTxt(s.lat)}) the Sun can never climb higher than about (90° − ${Math.abs(s.lat).toFixed(2)}°) + ${AXIAL_TILT_DEG}° = ${limit.toFixed(2)}°, because the Moon’s axis is tilted only ${AXIAL_TILT_DEG}° from the plane of Earth’s orbit. ` +
      `Over the 12 months from this date the engine finds the Sun’s highest point here at ${sc.sunEl[k].toFixed(2)}° (${minute(tMax)} UTC). So the Sun circles the sky low on the horizon, and a modest hill can hide it. “Show me” turns the lander camera to the Sun at that moment.`,
      { state: { site: s.id, t: minute(tMax - DAY), slip: 0 }, sim: { cam: 'lander', t: tMax, look: 'sun', ab: 'a' } });
  }
  if (i === 1) {
    const s = pick(c, ['im2', 'im1', 'connecting_ridge'], (x) => Math.abs(x.lat));
    const t0 = clampT(c.ephem, c.t);
    let lo = [Infinity, Infinity], hi = [-Infinity, -Infinity];
    for (let t = t0; t <= Math.min(c.ephem.tLast, t0 + 365 * DAY); t += 6 * 3600) {
      const e = c.ephem.sample(t).earth, r = Math.hypot(e[0], e[1], e[2]);
      let lon = Math.atan2(e[1], e[0]) * R2D; if (lon > 180) lon -= 360;
      const lat = Math.asin(e[2] / r) * R2D;
      lo = [Math.min(lo[0], lon), Math.min(lo[1], lat)]; hi = [Math.max(hi[0], lon), Math.max(hi[1], lat)];
    }
    const sc = scanWindow(c.ephem, siteFrame(s), c.horizons.get(s.id)!.elev_deg, t0, t0 + 30 * DAY, c.mode, 1800);
    let aMin = Infinity, aMax = -Infinity, eMin = Infinity, eMax = -Infinity, kMax = 0, down = 0;
    for (let k = 0; k <= sc.n; k++) {
      const a = ((sc.earthAz[k] + 540) % 360) - 180; // around north/south without a wrap
      aMin = Math.min(aMin, a); aMax = Math.max(aMax, a); eMin = Math.min(eMin, sc.earthEl[k]); eMax = Math.max(eMax, sc.earthEl[k]);
      if (sc.earthEl[k] > sc.earthEl[kMax]) kMax = k;
      if (k < sc.n && !sc.earthVis[k]) down++;
    }
    const azW = (aMax - aMin).toFixed(1);
    const f = (v: number) => `${v < 0 ? '−' : '+'}${Math.abs(v).toFixed(1)}°`;
    return mk(TOUR_TITLES[1],
      `The Moon turns once per orbit, so it keeps the same face toward Earth and Earth hangs almost still in its sky. It only wobbles in a small box — libration. ` +
      `Over the 12 months from this date the point on the Moon directly below Earth moves between ${f(lo[0])} and ${f(hi[0])} in longitude and ${f(lo[1])} and ${f(hi[1])} in latitude. ` +
      `Seen from ${s.name}, Earth stays within a ${azW}°-wide strip of sky over the next 30 days, at elevations from ${eMin.toFixed(1)}° to ${eMax.toFixed(1)}°` +
      (down > 0 ? `, so it is out of view for about ${Math.round((100 * down) / sc.n)}% of that month.` : ', always above the skyline.'),
      { state: { site: s.id, t: minute(t0), slip: 0 }, sim: { cam: 'lander', t: t0 + 1800 * kMax, look: 'earth', ab: 'a' } });
  }
  if (i === 2) {
    const s = pick(c, ['im1'], () => 0);
    const tb = has(c, 'im1') ? parseUtc('2024-01-19T23:24:00Z') : clampT(c.ephem, c.t);
    const hz = c.horizons.get(s.id)!, f = siteFrame(s);
    const a = windowMetrics(c.ephem, f, hz, tb, tb + 7 * DAY, c.mode).metrics;
    const b = windowMetrics(c.ephem, f, hz, tb + 10 * DAY, tb + 17 * DAY, c.mode).metrics;
    return mk(TOUR_TITLES[2],
      `A launch slip moves the whole surface stay later. At ${s.name}, a 7-day stay from ${minute(tb)} UTC has ${a.sunlit_h.toFixed(1)} h of sunlight and ${a.both_visible_h.toFixed(1)} h with both Sun and Earth in view; ` +
      `slipping it 10 days gives ${b.sunlit_h.toFixed(1)} h and ${b.both_visible_h.toFixed(1)} h. A lunar day lasts about 29.5 Earth days, so 10 days is a third of the way round the day-night cycle. ` +
      `“Show me” loads this example; the brief below lists each cause.`,
      { state: { site: s.id, t: minute(tb), stay: 7, slip: 10 }, sim: { cam: 'orbit', t: tb + 10 * DAY + 3600, ab: 'b' } });
  }
  if (i === 3) {
    const lola = c.sites.filter((x) => { const h = c.horizons.get(x.id); return h && h.dem.product !== 'sphere'; });
    const s = lola.find((x) => x.id === 'im1') ?? lola[0] ?? c.sites[0];
    const tb = s.id === 'im1' ? parseUtc('2024-01-19T23:24:00Z') : clampT(c.ephem, c.t);
    const sc = scanWindow(c.ephem, siteFrame(s), c.horizons.get(s.id)!.elev_deg, tb, tb + 7 * DAY, c.mode);
    let flat = 0, terr = 0, kb = -1;
    for (let k = 0; k < sc.n; k++) { flat += sc.sunVisSphere[k]; terr += sc.sunVis[k]; if (kb < 0 && sc.sunVisSphere[k] && !sc.sunVis[k]) kb = k; }
    const lost = (flat - terr) / 6;
    return mk(TOUR_TITLES[3],
      `On a smooth ball the Sun would be up for ${(flat / 6).toFixed(1)} h of a 7-day stay at ${s.name} from ${minute(tb)} UTC. With the real LOLA terrain skyline the engine counts ${(terr / 6).toFixed(1)} h` +
      (Math.abs(lost) >= 0.5 ? ` — terrain ${lost > 0 ? 'removes' : 'adds'} ${Math.abs(lost).toFixed(1)} h.` : ' — almost the same this time.') +
      ` With no air there is no twilight and no refraction: when the skyline covers the Sun, the lander is in hard, black shadow. ${kb >= 0 ? '“Show me” jumps to such a moment.' : ''}`,
      { state: { site: s.id, t: minute(tb), stay: 7, slip: 0 }, sim: { cam: 'lander', t: kb >= 0 ? tb + 600 * kb : tb, look: 'sun', ab: 'a' } });
  }
  // i === 4
  let n = 0, worst = 0;
  const bySite = new Set<string>();
  if (c.fixtures && !c.fixtures.meta?.mock) {
    for (const x of c.fixtures.fixtures) {
      const s = c.sites.find((v) => v.id === x.site_id);
      const t = parseUtc(x.utc);
      if (!s || !c.ephem.covers(t)) continue;
      const o = observe(c.ephem, siteFrame(s), t);
      const [a, e] = x.body === 'sun' ? [o.sunAz, o.sunEl] : [o.earthAz, o.earthEl];
      let da = Math.abs(a - x.horizons_az) % 360;
      da = Math.min(da, 360 - da) * Math.cos((x.horizons_el * Math.PI) / 180);
      worst = Math.max(worst, da, Math.abs(e - x.horizons_el));
      n++; bySite.add(x.site_id);
    }
  }
  return mk(TOUR_TITLES[4], n
    ? `We asked NASA JPL’s Horizons service for ${n} Sun and Earth directions at ${bySite.size} landing sites and recompute every one in your browser: the largest difference just now is ${worst.toFixed(4)}°, far smaller than the Sun’s disc (about 0.53° across). Earth is computed from the site itself, not from the Moon’s centre. Details are in “How far to trust this”.`
    : 'No Horizons check points are loaded for this data set, so there is nothing to compare here. With the real data this step recomputes NASA JPL Horizons positions in your browser.',
  { scrollTo: 'h-val' });
}
