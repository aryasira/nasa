// AI-assisted; see README.
// Custom coordinates and smooth-sphere horizons (pure, no DOM).
// A site without a terrain model gets a flat 720-point horizon at the true geometric dip of the horizon seen from
// a 2 m mast on an airless sphere: dip = −acos(R / (R + h)), R = 1737.4 km + site elevation.
import type { HorizonFile, Site } from '@contracts/types';
import { R_MOON_KM } from '../engine/geometry';
import { N_AZ } from '../engine/visibility';

export const MAST_M = 2;
export const CUSTOM_ID = 'custom';
export const SPHERE_NOTE = 'Smooth-sphere horizon — no terrain model for this point; real terrain can shorten these windows a lot near the poles (or, from a high ridge, lengthen them).';

/** Geometric dip of the horizon (degrees, negative) for an observer `mastM` above a sphere of radius `rKm`. */
export function horizonDipDeg(rKm: number, mastM = MAST_M): number {
  const h = mastM / 1000;
  return (-Math.acos(rKm / (rKm + h)) * 180) / Math.PI;
}

/** East longitude in [0, 360) from any input in −180…360. */
export function normLon(lon: number): number {
  let x = lon % 360;
  if (x < 0) x += 360;
  if (x >= 360) x = 0;
  return x === 0 ? 0 : x; // no −0
}

export interface CustomInput { lat: number; lon: number; elev: number | null; name: string }
export interface Checked { ok: boolean; errors: Partial<Record<'lat' | 'lon' | 'elev' | 'name', string>>; value?: CustomInput }

const num = (s: string | null | undefined) => (s == null || s.trim() === '' ? NaN : Number(s.trim()));

/** Validate raw strings (form fields or URL params). Latitude −90…90 (poles excluded: the local frame is undefined there). */
export function checkCustom(raw: { lat?: string | null; lon?: string | null; elev?: string | null; name?: string | null }): Checked {
  const errors: Checked['errors'] = {};
  const lat = num(raw.lat), lon = num(raw.lon);
  const elevS = (raw.elev ?? '').trim();
  const elev = elevS === '' ? null : Number(elevS);
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) errors.lat = 'Latitude must be a number from −90 to 90 (south negative).';
  else if (Math.abs(lat) > 89.99) errors.lat = 'Pick a point at least 0.01° from the pole (north and east are undefined exactly at a pole).';
  if (!Number.isFinite(lon) || lon < -180 || lon > 360) errors.lon = 'Longitude must be a number from −180 to 360 (east positive).';
  if (elev != null && (!Number.isFinite(elev) || elev < -10000 || elev > 11000)) errors.elev = 'Elevation must be blank or a number of metres from −10000 to 11000.';
  const name = (raw.name ?? '').trim().slice(0, 60);
  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, errors, value: { lat, lon: normLon(lon), elev, name } };
}

const latTxt = (v: number) => `${Math.abs(v).toFixed(3)}°${v < 0 ? 'S' : 'N'}`;

export function customSite(c: CustomInput): Site {
  return {
    id: CUSTOM_ID,
    name: c.name ? `${c.name} (custom)` : `Custom site ${latTxt(c.lat)} ${c.lon.toFixed(3)}°E`,
    kind: 'candidate',
    lat: c.lat,
    lon_e: c.lon,
    elev_m: c.elev,
    frame: 'MOON_ME',
    landing_utc: null,
    source: { org: 'Coordinates entered by the user', url: '#custom-site' },
    name_status: 'informal',
    terrain: 'sphere',
    validation_use: 'none',
  };
}

/** Flat horizon at the geometric dip for a site with no terrain model. */
export function sphereHorizon(site: Pick<Site, 'id' | 'elev_m'>): HorizonFile {
  const dip = horizonDipDeg(R_MOON_KM + (site.elev_m ?? 0) / 1000);
  const flat = () => new Array<number>(N_AZ).fill(dip);
  const nul = () => new Array<null>(N_AZ).fill(null);
  return {
    schema_version: 1,
    site_id: site.id,
    mast_m: MAST_M,
    az_step_deg: 0.5,
    elev_deg: flat(), elev_lo_deg: flat(), elev_hi_deg: flat(),
    occluder: { dist_m: nul(), lat: nul(), lon_e: nul(), feature_id: nul() },
    dem: { product: 'sphere', res_m: null, sigma_m: null, max_range_km: null },
    meta: { ai_generated: true, generated_by: 'app/src/features/custom.ts (smooth sphere, computed in the browser)', mock: false },
  };
}

export const isSphere = (hz: HorizonFile | undefined) => !!hz && hz.dem.product === 'sphere';

/**
 * loadData hook: give catalogue sites with `terrain: "sphere"` and no shipped horizon file a synthesized sphere
 * horizon (LOLA sites without a file stay dropped), and add the custom site if the URL carries valid coordinates.
 */
export function augmentSites(sites: Site[], horizons: Map<string, HorizonFile>, custom: CustomInput | null): void {
  for (const s of sites) if (!horizons.has(s.id) && s.terrain === 'sphere') horizons.set(s.id, sphereHorizon(s));
  if (custom && !sites.some((s) => s.id === CUSTOM_ID)) {
    const s = customSite(custom);
    sites.push(s);
    horizons.set(s.id, sphereHorizon(s));
  }
}
