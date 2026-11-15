// AI-ASSISTED: drafted with Claude (Anthropic), reviewed by the human team.
// Site vector, local East-North-Up frame, azimuth/elevation. Implements docs/engine-spec.md section 3.
import type { Site } from '@contracts/types';
import type { Ephem } from './ephem';

export const R_MOON_KM = 1737.4;
export const R_EARTH_KM = 6378.137;
export const SUN_RADIUS_1AU_DEG = 0.2666;
const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

export type Vec3 = [number, number, number];
export const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

export interface SiteFrame {
  site: Site;
  siteKm: Vec3;
  E: Vec3;
  N: Vec3;
  U: Vec3;
}

export function siteFrame(site: Site): SiteFrame {
  const la = site.lat * D2R, lo = site.lon_e * D2R;
  const R = R_MOON_KM + (site.elev_m ?? 0) / 1000;
  const U: Vec3 = [Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la)];
  return {
    site,
    siteKm: [R * U[0], R * U[1], R * U[2]],
    E: [-Math.sin(lo), Math.cos(lo), 0],
    N: [-Math.sin(la) * Math.cos(lo), -Math.sin(la) * Math.sin(lo), Math.cos(la)],
    U,
  };
}

/** Direction (any length) -> azimuth clockwise from north in [0, 360), elevation in degrees. */
export function azEl(d: Vec3, f: SiteFrame): { az: number; el: number } {
  const e = dot(d, f.E), n = dot(d, f.N), u = dot(d, f.U);
  let az = (Math.atan2(e, n) * R2D) % 360;
  if (az < 0) az += 360;
  if (az >= 360) az = 0;
  return { az, el: Math.atan2(u, Math.hypot(e, n)) * R2D };
}

export interface Observation {
  sunAz: number; sunEl: number; sunR: number;
  earthAz: number; earthEl: number; earthR: number; earthDistKm: number;
  earthAzGeocentric: number; earthElGeocentric: number; // parallax test only, never for visibility
  sep: number; // Sun-Earth centre separation seen from the site, degrees
  eclipsePartial: boolean;
  eclipseTotal: boolean;
}

export function observe(ephem: Ephem, f: SiteFrame, t: number): Observation {
  const s = ephem.sample(t);
  const sun = azEl(s.sun, f); // Sun at infinity: unit vector as is
  const sunR = SUN_RADIUS_1AU_DEG / s.sunAu;
  // Mandatory topocentric Earth: subtract the site vector.
  const topo: Vec3 = [s.earth[0] - f.siteKm[0], s.earth[1] - f.siteKm[1], s.earth[2] - f.siteKm[2]];
  const dist = Math.hypot(topo[0], topo[1], topo[2]);
  const earth = azEl(topo, f);
  const geo = azEl(s.earth, f);
  const earthR = Math.asin(R_EARTH_KM / dist) * R2D;
  const cx = s.sun[1] * topo[2] - s.sun[2] * topo[1];
  const cy = s.sun[2] * topo[0] - s.sun[0] * topo[2];
  const cz = s.sun[0] * topo[1] - s.sun[1] * topo[0];
  const sep = Math.atan2(Math.hypot(cx, cy, cz), dot(s.sun, topo)) * R2D;
  return {
    sunAz: sun.az, sunEl: sun.el, sunR,
    earthAz: earth.az, earthEl: earth.el, earthR, earthDistKm: dist,
    earthAzGeocentric: geo.az, earthElGeocentric: geo.el,
    sep, eclipsePartial: sep < earthR + sunR, eclipseTotal: sep < earthR - sunR,
  };
}

/** Great-circle distance between two sites on the reference sphere, km. */
export function surfaceDistanceKm(a: Site, b: Site): number {
  const fa = siteFrame(a).U, fb = siteFrame(b).U;
  return R_MOON_KM * Math.acos(Math.max(-1, Math.min(1, dot(fa, fb))));
}
