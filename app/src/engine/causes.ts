// AI-ASSISTED: drafted with Claude (Anthropic), reviewed by the human team.
// Cause lines: explain a change in Sun or Earth visibility between two windows.
//
// Method (exact decomposition, no fitting):
//   visible hours = (hours above a flat, terrain-free horizon)
//                   - (hours when terrain hides the body)
//                   + (hours seen below the flat horizon, where the real horizon dips under 0 deg)
// so the change between two windows is the sum of the changes in those three pieces.
// The first is the Moon's own day/night or libration cycle ("orbital"); the second is terrain,
// attributed to the occluder stored by the pipeline at the azimuth where the body was hidden;
// the third is a high site looking down past the flat horizon ("dip").
import type { CauseLine, FeaturesFile, HorizonFile } from '@contracts/types';
import { STEP_S, type Body, type Scan } from './metrics';
import { azIndex } from './visibility';

/** `kind` is not in contracts v1 (requested in STATUS-B.md); it extends CauseLine without changing it. */
export type CauseKind = 'terrain' | 'orbital' | 'dip';
export interface CauseLineEx extends CauseLine { kind: CauseKind }

const MIN_H = 0.5; // ignore changes smaller than this
const SECTOR_DEG = 30; // unnamed terrain is grouped by 30-degree compass sector
const DT_H = STEP_S / 3600;

interface Block { hours: number; sx: number; sy: number; feature: string | null }

/** Hours hidden by terrain (above the flat horizon, below the real one), grouped by occluder. */
export function terrainBlocks(scan: Scan, hz: HorizonFile, body: Body): Map<string, Block> {
  const vis = body === 'sun' ? scan.sunVis : scan.earthVis;
  const sph = body === 'sun' ? scan.sunVisSphere : scan.earthVisSphere;
  const az = body === 'sun' ? scan.sunAz : scan.earthAz;
  const out = new Map<string, Block>();
  for (let k = 0; k < scan.n; k++) {
    if (!sph[k] || vis[k]) continue;
    const feature = hz.occluder.feature_id[azIndex(az[k])];
    const key = feature ?? `unnamed@${Math.floor(az[k] / SECTOR_DEG)}`;
    let b = out.get(key);
    if (!b) { b = { hours: 0, sx: 0, sy: 0, feature }; out.set(key, b); }
    b.hours += DT_H;
    b.sx += Math.sin((az[k] * Math.PI) / 180);
    b.sy += Math.cos((az[k] * Math.PI) / 180);
  }
  // Merge unnamed terrain in neighbouring sectors so one ridge is not reported twice.
  const nSec = 360 / SECTOR_DEG;
  for (let i = 0; i < nSec; i++) {
    const a = out.get(`unnamed@${i}`), b = out.get(`unnamed@${(i + 1) % nSec}`);
    if (a && b && a !== b) {
      b.hours += a.hours; b.sx += a.sx; b.sy += a.sy;
      out.delete(`unnamed@${i}`);
    }
  }
  return out;
}

/** Hours seen only because the real horizon dips below the flat one (elevated site). */
export function dipBlock(scan: Scan, body: Body): Block {
  const vis = body === 'sun' ? scan.sunVis : scan.earthVis;
  const sph = body === 'sun' ? scan.sunVisSphere : scan.earthVisSphere;
  const az = body === 'sun' ? scan.sunAz : scan.earthAz;
  const b: Block = { hours: 0, sx: 0, sy: 0, feature: null };
  for (let k = 0; k < scan.n; k++) {
    if (sph[k] || !vis[k]) continue;
    b.hours += DT_H;
    b.sx += Math.sin((az[k] * Math.PI) / 180);
    b.sy += Math.cos((az[k] * Math.PI) / 180);
  }
  return b;
}

export function sphereHours(scan: Scan, body: Body): number {
  const sph = body === 'sun' ? scan.sunVisSphere : scan.earthVisSphere;
  let n = 0;
  for (let k = 0; k < scan.n; k++) n += sph[k];
  return n * DT_H;
}

export function visibleHours(scan: Scan, body: Body): number {
  const v = body === 'sun' ? scan.sunVis : scan.earthVis;
  let n = 0;
  for (let k = 0; k < scan.n; k++) n += v[k];
  return n * DT_H;
}

const meanAz = (b: Block) => ((Math.atan2(b.sx, b.sy) * 180) / Math.PI + 360) % 360;
const fmtH = (h: number) => (Math.abs(h) >= 10 ? Math.abs(h).toFixed(0) : Math.abs(h).toFixed(1));
const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
export const compass = (az: number) => COMPASS[Math.round(az / 22.5) % 16];

export interface CauseInput { scan: Scan; hz: HorizonFile }

/** Cause lines for the change from window `a` (baseline) to window `b` (option). Sorted by size. */
export function causeLines(a: CauseInput, b: CauseInput, features: FeaturesFile | null, minH = MIN_H,
  siteNames?: Map<string, string>): CauseLineEx[] {
  const names = new Map((features?.features ?? []).map((f) => [f.id, f]));
  const lines: CauseLineEx[] = [];
  for (const body of ['sun', 'earth'] as const) {
    const Body = body === 'sun' ? 'Sun' : 'Earth';
    // 1. Orbital term: change in hours above a terrain-free horizon.
    const dOrb = sphereHours(b.scan, body) - sphereHours(a.scan, body);
    if (Math.abs(dOrb) >= minH && Math.abs(dOrb) > 0) {
      const why = body === 'sun'
        ? 'the lunar day/night cycle puts the Sun below a terrain-free horizon for'
        : "the Moon's libration puts Earth below a terrain-free horizon for";
      lines.push({
        kind: 'orbital', body, delta_h: dOrb, az_deg: NaN, dist_km: null, feature_id: null,
        text: `${Body} ${dOrb < 0 ? 'lost' : 'gained'} ${fmtH(dOrb)} h — ${why} ${dOrb < 0 ? 'more' : 'less'} of this window (not terrain)`,
      });
    }
    // 2. Terrain terms, one per occluder. Keys carry the site so different sites never merge.
    const A = terrainBlocks(a.scan, a.hz, body), B = terrainBlocks(b.scan, b.hz, body);
    const keys = new Set<string>();
    for (const k of A.keys()) keys.add(`${a.hz.site_id}|${k}`);
    for (const k of B.keys()) keys.add(`${b.hz.site_id}|${k}`);
    for (const full of keys) {
      const [sid, k] = full.split('|');
      const ba = sid === a.hz.site_id ? A.get(k) : undefined;
      const bb = sid === b.hz.site_id ? B.get(k) : undefined;
      const d = -((bb?.hours ?? 0) - (ba?.hours ?? 0));
      if (Math.abs(d) < minH || d === 0) continue;
      const lost = d < 0;
      const src = lost ? bb! : ba!; // the window where this terrain hides the body for longer
      const hz = (lost ? b : a).hz;
      const az = meanAz(src);
      const distM = hz.occluder.dist_m[azIndex(az)];
      const distKm = distM == null ? null : distM / 1000;
      const feat = src.feature ? names.get(src.feature) : undefined;
      const name = feat ? feat.name + (feat.name_status === 'informal' ? ' (informal name)' : '') : 'unnamed terrain';
      const at = a.hz.site_id !== b.hz.site_id ? `, at ${siteNames?.get(hz.site_id) ?? hz.site_id}` : '';
      const where = `az ${az.toFixed(0)}° (${compass(az)})` + (distKm == null ? '' : `, ${distKm < 10 ? distKm.toFixed(1) : distKm.toFixed(0)} km`) + at;
      lines.push({
        kind: 'terrain', body, delta_h: d, az_deg: az, dist_km: distKm, feature_id: src.feature,
        text: lost
          ? `${Body} lost ${fmtH(d)} h — blocked by ${name} at ${where}`
          : `${Body} gained ${fmtH(d)} h — no longer blocked by ${name} at ${where}`,
      });
    }
    // 3. Dip term: hours seen below the flat horizon because the site stands above its surroundings.
    const da = dipBlock(a.scan, body), db = dipBlock(b.scan, body);
    const dDip = db.hours - da.hours;
    if (Math.abs(dDip) >= minH && dDip !== 0) {
      const az = meanAz(dDip > 0 ? db : da);
      lines.push({
        kind: 'dip', body, delta_h: dDip, az_deg: az, dist_km: null, feature_id: null,
        text: `${Body} ${dDip < 0 ? 'lost' : 'gained'} ${fmtH(dDip)} h — the site stands above the terrain toward az ${az.toFixed(0)}° (${compass(az)}), `
          + `so the ${Body} is seen below a flat horizon there for ${dDip < 0 ? 'less' : 'more'} of this window`,
      });
    }
  }
  return lines.sort((x, y) => Math.abs(y.delta_h) - Math.abs(x.delta_h));
}
