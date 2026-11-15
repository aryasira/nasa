// AI-ASSISTED: drafted with Claude (Anthropic), reviewed by the human team.
// Pure helpers for the 3D simulator (no three.js import, so they run under Vitest in Node).
// Every number shown in the HUD comes from the validated engine (observe, horizonAt, discFraction);
// this file only classifies those numbers and maps directions into scene coordinates.
import type { FeaturesFile, HorizonFile } from '@contracts/types';
import type { Ephem } from '../engine/ephem';
import { observe, type Observation, type SiteFrame, type Vec3 } from '../engine/geometry';
import { azIndex, discFraction, horizonAt, isVisible, type Mode } from '../engine/visibility';
import { SPHERE_HORIZON_DEG } from '../engine/metrics';

const D2R = Math.PI / 180;

/**
 * Scene frame: +y up, north = −z, east = +x. Azimuth is clockwise from north seen from above,
 * exactly as in the engine (az 0 = N, 90 = E).
 */
export function dirFromAzEl(azDeg: number, elDeg: number): Vec3 {
  const a = azDeg * D2R, e = elDeg * D2R;
  return [Math.sin(a) * Math.cos(e), Math.sin(e), -Math.cos(a) * Math.cos(e)];
}

/** Inverse of dirFromAzEl for a scene direction (any length). */
export function azElFromDir(d: Vec3): { az: number; el: number } {
  let az = Math.atan2(d[0], -d[2]) / D2R;
  if (az < 0) az += 360;
  return { az: az >= 360 ? 0 : az, el: Math.atan2(d[1], Math.hypot(d[0], d[2])) / D2R };
}

/** MOON_ME (x, y, z = north pole) → globe scene (+y = north pole). A proper rotation (det +1). */
export const moonToScene = (v: Vec3): Vec3 => [v[0], v[2], -v[1]];

export type PowerState = 'SUNLIT' | 'SHADOW (terrain)' | 'NIGHT' | 'ECLIPSE';
export type CommState = 'DTE LINK' | 'NO LINK (terrain)' | 'EARTH BELOW HORIZON';

export interface Blocker {
  body: 'sun' | 'earth';
  az: number;
  horizonEl: number; // terrain elevation at the body's azimuth
  bodyEl: number;
  name: string; // features.json name, or "unnamed terrain"
  featureId: string | null;
  distKm: number | null;
}

export interface BodyReadout {
  az: number;
  el: number;
  r: number;
  horizonEl: number;
  frac: number; // engine disc fraction above the local terrain horizon
  visible: boolean;
  aboveFlat: boolean; // visible against a flat 0° horizon (no terrain): engine's "orbital" split
  blocker: Blocker | null; // only when terrain hides a body that a flat horizon would show
}

export interface Readout {
  t: number;
  obs: Observation;
  sun: BodyReadout;
  earth: BodyReadout;
  power: { state: PowerState; pct: number; note: string };
  comm: { state: CommState };
  earthLitFrac: number; // illuminated fraction of Earth's disc seen from the site
}

export type FeatureIndex = Map<string, { name: string; informal: boolean }>;
export function featureIndex(f: FeaturesFile | null): FeatureIndex {
  return new Map((f?.features ?? []).map((x) => [x.id, { name: x.name, informal: x.name_status === 'informal' }]));
}

function body(name: 'sun' | 'earth', az: number, el: number, r: number, hz: HorizonFile, feats: FeatureIndex, mode: Mode): BodyReadout {
  const h = horizonAt(hz.elev_deg, az);
  const frac = discFraction(el, r, h);
  const visible = isVisible(frac, mode);
  const aboveFlat = isVisible(discFraction(el, r, SPHERE_HORIZON_DEG), mode);
  let blocker: Blocker | null = null;
  if (!visible && aboveFlat) {
    const i = azIndex(az);
    const fid = hz.occluder.feature_id[i] ?? null;
    const f = fid ? feats.get(fid) : undefined;
    const dm = hz.occluder.dist_m[i];
    blocker = {
      body: name, az, horizonEl: h, bodyEl: el, featureId: fid,
      name: f ? f.name + (f.informal ? ' (informal name)' : '') : 'unnamed terrain',
      distKm: dm == null ? null : dm / 1000,
    };
  }
  return { az, el, r, horizonEl: h, frac, visible, aboveFlat, blocker };
}

/** Everything the HUD shows for one instant. */
export function readout(ephem: Ephem, f: SiteFrame, hz: HorizonFile, feats: FeatureIndex, t: number, mode: Mode): Readout {
  const o = observe(ephem, f, t);
  const sun = body('sun', o.sunAz, o.sunEl, o.sunR, hz, feats, mode);
  const earth = body('earth', o.earthAz, o.earthEl, o.earthR, hz, feats, mode);
  let power: Readout['power'];
  if (sun.visible && o.eclipseTotal) power = { state: 'ECLIPSE', pct: 0, note: 'Earth covers the whole Sun' };
  else if (sun.visible && o.eclipsePartial) power = { state: 'ECLIPSE', pct: sun.frac * 100, note: 'Earth covers part of the Sun (not subtracted)' };
  else if (sun.visible) power = { state: 'SUNLIT', pct: sun.frac * 100, note: sun.frac < 1 ? 'Sun partly behind the horizon' : '' };
  else if (sun.aboveFlat) power = { state: 'SHADOW (terrain)', pct: 0, note: 'Sun is up, but terrain hides it' };
  else power = { state: 'NIGHT', pct: 0, note: 'Sun below the horizon' };
  const comm: Readout['comm'] = { state: earth.visible ? 'DTE LINK' : earth.aboveFlat ? 'NO LINK (terrain)' : 'EARTH BELOW HORIZON' };
  return { t, obs: o, sun, earth, power, comm, earthLitFrac: (1 - Math.cos(o.sep * D2R)) / 2 };
}

/** Horizontal distance (m) used to draw each of the 720 skyline vertices. The silhouette angle is kept exact. */
export function ridgeDistances(hz: HorizonFile, opts: { min?: number; max?: number; fallback?: number; halfWin?: number; box?: number } = {}): Float64Array {
  const n = hz.elev_deg.length, min = opts.min ?? 300, max = opts.max ?? 20000;
  const fallback = opts.fallback ?? (hz.dem.product === 'sphere' ? 3000 : 6000);
  const half = opts.halfWin ?? 10;
  const raw = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const d = hz.occluder.dist_m[i];
    raw[i] = Math.log(Math.min(max, Math.max(min, d == null || !Number.isFinite(d) ? fallback : d)));
  }
  // Circular median then a box mean, in log space: the ridge reads as a ridge instead of a comb of walls.
  // Only the drawing distance is smoothed; each vertex's elevation angle stays exactly elev_deg.
  const med = new Float64Array(n), win: number[] = [];
  for (let i = 0; i < n; i++) {
    win.length = 0;
    for (let k = -half; k <= half; k++) win.push(raw[(i + k + n) % n]);
    win.sort((a, b) => a - b);
    med[i] = win[half];
  }
  const out = new Float64Array(n), box = opts.box ?? 8;
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let k = -box; k <= box; k++) s += med[(i + k + n) % n];
    out[i] = Math.min(max, Math.max(min, Math.exp(s / (2 * box + 1))));
  }
  return out;
}

/** Height (m, above the ground at the lander) of the skyline vertex so that, seen from the mast, it sits at elev_deg. */
export const ridgeHeight = (elDeg: number, distM: number, mastM: number) => mastM + Math.tan(elDeg * D2R) * distM;

export const fmtAz = (v: number) => `${v.toFixed(2).padStart(6, '0')}°`;
export const fmtEl = (v: number) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(2)}°`;
export function fmtMet(s: number): string {
  const neg = s < 0, a = Math.abs(Math.round(s));
  const d = Math.floor(a / 86400), h = Math.floor((a % 86400) / 3600), m = Math.floor((a % 3600) / 60);
  return `${neg ? 'T−' : 'T+'}${d}d ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
