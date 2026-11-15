// AI-ASSISTED: drafted with Claude (Anthropic), reviewed by the human team.
// Cause lines: explain a change in Sun or Earth visibility between two windows.
//
// Method (exact decomposition, no fitting), per body:
//   change in visible hours = Σ terrain pieces + one non-terrain piece
// A terrain piece is the change in hours when a given occluder hides the body (body above a flat 0° horizon,
// below the real one), attributed to the occluder the pipeline stored at the azimuth where the body was hidden.
// The non-terrain piece is what is left: visible(b) − visible(a) − Σ terrain. For the same site it is the Moon's
// own day/night cycle (Sun) or Earth's libration (Earth), net of the hours a high site sees below the flat
// horizon ("site height"). For a different site it is the difference of location (and date), which also
// absorbs the baseline site's own terrain: only the alternate site's terrain is listed separately.
// Pieces under MIN_H are not listed, but they are still in the sum, so the non-terrain piece stays exact.
import type { CauseLine, Feature, FeaturesFile, HorizonFile } from '@contracts/types';
import { R_MOON_KM } from './geometry';
import { STEP_S, type Body, type Scan } from './metrics';
import { azIndex, N_AZ } from './visibility';

const MIN_H = 0.5; // pieces smaller than this are not listed (still counted in the sums)
const RUN_GAP_BINS = 6; // unnamed terrain: 0.5° bins at most 3° apart belong to the same run (one ridge)
const DT_H = STEP_S / 3600;

const arrays = (scan: Scan, body: Body) => body === 'sun'
  ? { vis: scan.sunVis, sph: scan.sunVisSphere, az: scan.sunAz }
  : { vis: scan.earthVis, sph: scan.earthVisSphere, az: scan.earthAz };

/** Sample indices (left samples only) where terrain hides the body: above the flat horizon, below the real one. */
export function hiddenSamples(scan: Scan, body: Body): number[] {
  const { vis, sph } = arrays(scan, body);
  const out: number[] = [];
  for (let k = 0; k < scan.n; k++) if (sph[k] && !vis[k]) out.push(k);
  return out;
}

/** Group occupied 0.5° bins into runs around the circle (gaps ≤ RUN_GAP_BINS). Returns bin → run start bin. */
export function azimuthRuns(occupied: Set<number>): Map<number, number> {
  const out = new Map<number, number>();
  if (!occupied.size) return out;
  const bins = [...occupied].sort((x, y) => x - y);
  // Start after the largest gap so a run that crosses north (359.5° → 0°) is not split.
  let startAt = 0, bestGap = -1;
  for (let i = 0; i < bins.length; i++) {
    const next = bins[(i + 1) % bins.length];
    const gap = (next - bins[i] + N_AZ) % N_AZ || N_AZ;
    if (gap > bestGap) { bestGap = gap; startAt = (i + 1) % bins.length; }
  }
  let runStart = bins[startAt];
  for (let j = 0; j < bins.length; j++) {
    const b = bins[(startAt + j) % bins.length];
    if (j > 0) {
      const prev = bins[(startAt + j - 1) % bins.length];
      if ((b - prev + N_AZ) % N_AZ > RUN_GAP_BINS) runStart = b;
    }
    out.set(b, runStart);
  }
  return out;
}

interface Block { hours: number; ks: number[]; feature: string | null }

/** Hours hidden by terrain, grouped by occluder: named feature id, or the unnamed azimuth run `runs` assigns. */
export function terrainBlocks(scan: Scan, hz: HorizonFile, body: Body, runs?: Map<number, number>): Map<string, Block> {
  const { az } = arrays(scan, body);
  const out = new Map<string, Block>();
  for (const k of hiddenSamples(scan, body)) {
    const i = azIndex(az[k]);
    const feature = hz.occluder.feature_id[i];
    const key = feature ?? `unnamed@${runs?.get(i) ?? i}`;
    let b = out.get(key);
    if (!b) { b = { hours: 0, ks: [], feature }; out.set(key, b); }
    b.hours += DT_H;
    b.ks.push(k);
  }
  return out;
}

/** Bins where terrain with no feature name hides the body in this window. */
function unnamedBins(scan: Scan, hz: HorizonFile, body: Body, into: Set<number>) {
  const { az } = arrays(scan, body);
  for (const k of hiddenSamples(scan, body)) {
    const i = azIndex(az[k]);
    if (hz.occluder.feature_id[i] == null) into.add(i);
  }
}

/** Hours seen only because the real horizon dips below the flat one (elevated site). */
export function dipHours(scan: Scan, body: Body): number {
  const { vis, sph } = arrays(scan, body);
  let n = 0;
  for (let k = 0; k < scan.n; k++) if (!sph[k] && vis[k]) n++;
  return n * DT_H;
}

export function sphereHours(scan: Scan, body: Body): number {
  const { sph } = arrays(scan, body);
  let n = 0;
  for (let k = 0; k < scan.n; k++) n += sph[k];
  return n * DT_H;
}

export function visibleHours(scan: Scan, body: Body): number {
  const { vis } = arrays(scan, body);
  let n = 0;
  for (let k = 0; k < scan.n; k++) n += vis[k];
  return n * DT_H;
}

const median = (v: number[]) => {
  if (!v.length) return null;
  const s = [...v].sort((x, y) => x - y), m = s.length >> 1;
  return s.length % 2 ? s[m] : 0.5 * (s[m - 1] + s[m]);
};

/** Median azimuth of the samples (unwrapped around the first one, so runs across north work) and median occluder distance. */
export function blockPosition(scan: Scan, hz: HorizonFile, body: Body, ks: number[]): { az: number; distM: number | null } {
  const { az } = arrays(scan, body);
  const ref = az[ks[0]];
  const offs = ks.map((k) => ((az[k] - ref + 540) % 360) - 180);
  const a = ((ref + median(offs)! + 360) % 360);
  const d = ks.map((k) => hz.occluder.dist_m[azIndex(az[k])]).filter((x): x is number => x != null);
  return { az: a, distM: median(d) };
}

/** Distance below which the DEM cannot resolve where the occluder is: 3 grid cells, at least 0.5 km. */
export function nearLimitM(hz: HorizonFile): number {
  return Math.max(500, 3 * (hz.dem.res_m ?? 0));
}
export function fmtKm(distM: number, hz: HorizonFile): string {
  const lim = nearLimitM(hz);
  if (distM < lim) return `< ${(Math.ceil(lim / 100) / 10).toFixed(1)} km`;
  const km = distM / 1000;
  return `${km < 10 ? km.toFixed(1) : km.toFixed(0)} km`;
}

function gcKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const r = Math.PI / 180;
  const c = Math.sin(lat1 * r) * Math.sin(lat2 * r) + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.cos((lon1 - lon2) * r);
  return R_MOON_KM * Math.acos(Math.max(-1, Math.min(1, c)));
}

/** True when the named feature is the ground the site stands on (the site is inside its radius). */
export function siteIsOn(hz: HorizonFile, f: Feature): boolean {
  const su = (hz as HorizonFile & { site_used?: { lat: number; lon_e: number; stands_on?: string | null } }).site_used;
  if (!su) return false;
  if (su.stands_on != null) return su.stands_on === f.id;
  return f.radius_km != null && gcKm(su.lat, su.lon_e, f.lat, f.lon_e) <= f.radius_km;
}

/** One rounding rule for hours everywhere on the page: one decimal. */
const fmtH = (h: number) => Math.abs(h).toFixed(1);
const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
export const compass = (az: number) => COMPASS[Math.round(az / 22.5) % 16];

/** Short name of a cause (the text after the dash, up to any ": "), for the headline. */
export const causeName = (c: CauseLine) => {
  const i = c.text.indexOf(' — '), r = i < 0 ? c.text : c.text.slice(i + 3), j = r.indexOf(': ');
  return (j < 0 ? r : r.slice(0, j)).replace(' (not terrain)', '');
};

export interface CauseInput { scan: Scan; hz: HorizonFile }

/** Cause lines for the change from window `a` (baseline) to window `b` (option). Sorted by size. */
export function causeLines(a: CauseInput, b: CauseInput, features: FeaturesFile | null, minH = MIN_H,
  siteNames?: Map<string, string>): CauseLine[] {
  const names = new Map((features?.features ?? []).map((f) => [f.id, f]));
  const sameSite = a.hz.site_id === b.hz.site_id;
  const lines: CauseLine[] = [];
  for (const body of ['sun', 'earth'] as const) {
    const Body = body === 'sun' ? 'Sun' : 'Earth';
    const total = visibleHours(b.scan, body) - visibleHours(a.scan, body);

    // 1. Terrain pieces, one per occluder. Unnamed terrain is grouped into azimuth runs built from the
    //    union of both windows' blocked bins, so one ridge has one key. Keys carry the site.
    const runsFor = (hz: HorizonFile, wins: Scan[]) => { const s = new Set<number>(); for (const w of wins) unnamedBins(w, hz, body, s); return azimuthRuns(s); };
    const runsA = runsFor(a.hz, sameSite ? [a.scan, b.scan] : [a.scan]);
    const runsB = sameSite ? runsA : runsFor(b.hz, [b.scan]);
    const A = terrainBlocks(a.scan, a.hz, body, runsA), B = terrainBlocks(b.scan, b.hz, body, runsB);
    const keys = new Set<string>();
    for (const k of A.keys()) keys.add(`${a.hz.site_id}|${k}`);
    for (const k of B.keys()) keys.add(`${b.hz.site_id}|${k}`);
    let terrainSum = 0;
    for (const full of keys) {
      const [sid, k] = full.split('|');
      const ba = sid === a.hz.site_id ? A.get(k) : undefined;
      const bb = sid === b.hz.site_id ? B.get(k) : undefined;
      const d = (ba?.hours ?? 0) - (bb?.hours ?? 0); // more hidden hours in b = lost
      // Different site: terrain at the baseline site is part of "different location", not a line of its own
      // (otherwise every alternate row repeats the baseline site's terrain line).
      if (!sameSite && sid === a.hz.site_id) continue;
      terrainSum += d;
      if (Math.abs(d) < minH || d === 0) continue;
      const lost = d < 0;
      const src = lost ? bb! : ba!; // the window where this terrain hides the body for longer
      const w = lost ? b : a;
      const { az, distM } = blockPosition(w.scan, w.hz, body, src.ks);
      const feat = src.feature ? names.get(src.feature) : undefined;
      const on = !!feat && siteIsOn(w.hz, feat);
      const near = distM != null && distM < nearLimitM(w.hz);
      const fname = feat ? feat.name + (feat.name_status === 'informal' ? ' (informal name)' : '') : '';
      // A named feature the site stands on keeps its name ("local" would mislead at 20 km); close unnamed
      // or sub-cell blockers are "nearby terrain"; everything else unnamed stays "unnamed terrain".
      const name = on ? `${fname} (the feature the site stands on)`
        : feat && !near ? fname
        : near ? 'nearby terrain' : 'unnamed terrain';
      const at = sameSite ? '' : `, at ${siteNames?.get(w.hz.site_id) ?? w.hz.site_id}`;
      const where = `az ${az.toFixed(0)}° (${compass(az)})` + (distM == null ? '' : `, ${fmtKm(distM, w.hz)}`) + at;
      lines.push({
        kind: 'terrain', body, delta_h: d, az_deg: az, dist_km: distM == null ? null : distM / 1000, feature_id: src.feature,
        text: lost
          ? `${Body} lost ${fmtH(d)} h — blocked by ${name} at ${where}`
          : `${Body} gained ${fmtH(d)} h — no longer blocked by ${name} at ${where}`,
      });
    }

    // 2. One non-terrain piece: everything that is not a terrain piece (exact remainder).
    const dRest = total - terrainSum;
    if (Math.abs(dRest) >= minH && Math.abs(dRest) > 1e-9) {
      const lost = dRest < 0;
      let why: string;
      if (sameSite) {
        const dip = dipHours(a.scan, body) > 0 || dipHours(b.scan, body) > 0 ? ', net of site height' : '';
        why = body === 'sun'
          ? `lunar day/night cycle${dip} (not terrain): the Sun is up for ${lost ? 'less' : 'more'} of this window`
          : `Earth's libration${dip} (not terrain): Earth is above the horizon for ${lost ? 'less' : 'more'} of this window`;
      } else {
        const sameDate = a.scan.tStart === b.scan.tStart;
        why = `different location${sameDate ? '' : ' and date'} (not terrain): ${body === 'sun' ? 'the Sun is up' : 'Earth is above the horizon'} for ${lost ? 'less' : 'more'} of this window`
          + ` at ${siteNames?.get(b.hz.site_id) ?? b.hz.site_id}`;
      }
      lines.push({ kind: 'orbital', body, delta_h: dRest, az_deg: null, dist_km: null, feature_id: null,
        text: `${Body} ${lost ? 'lost' : 'gained'} ${fmtH(dRest)} h — ${why}` });
    }
  }
  return lines.sort((x, y) => Math.abs(y.delta_h) - Math.abs(x.delta_h));
}
