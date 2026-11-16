// AI-assisted; see README.
// TypeScript mirror of contracts/*.json — schema_version 1, frozen Sat 14 Nov 2026 17:00 CT.
// Agent B imports these. Do not edit without a human OK and a schema_version bump.

export interface Meta {
  ai_generated: true;
  generated_by?: string;
  git_sha?: string;
  mock?: boolean;
}

export interface SourceRef {
  org: string;
  url: string;
  quote?: string;
}

// ---------- ephem.bin ----------
export interface EphemHeader {
  schema_version: 1;
  t0_utc: string; // "2024-01-01T00:00:00Z"
  step_s: number; // 3600
  n: number; // rows
  layout: [
    'sun_ux', 'sun_uy', 'sun_uz', 'sun_au',
    'earth_x_km', 'earth_y_km', 'earth_z_km',
  ];
  dtype: 'float32';
  endianness: 'little';
  record_bytes: 28;
  frame: 'MOON_ME';
  observer: string;
  abcorr: 'LT+S';
  kernels: string[];
  spice_version: string;
  meta: Meta;
}
/** Column offsets inside one 7-float record. */
export const EPHEM = {
  SUN_UX: 0, SUN_UY: 1, SUN_UZ: 2, SUN_AU: 3,
  EARTH_X: 4, EARTH_Y: 5, EARTH_Z: 6, STRIDE: 7,
} as const;

// ---------- sites.json ----------
export type SiteKind = 'landed' | 'planned' | 'candidate';
export type NameStatus = 'iau' | 'informal';

export interface Site {
  id: string;
  name: string;
  kind: SiteKind;
  lat: number; // deg, north positive
  lon_e: number; // deg, east positive, [0, 360)
  elev_m: number | null; // above 1737.4 km sphere
  frame: 'MOON_ME';
  landing_utc?: string | null;
  source: SourceRef;
  alternates?: { lat: number; lon_e: number; elev_m?: number | null; source: SourceRef }[];
  name_status: NameStatus;
  gazetteer_id?: number | null;
  terrain: 'lola' | 'sphere';
  story?: string;
  validation_use?: 'numeric' | 'qualitative' | 'none';
}
export interface SitesFile { schema_version: 1; sites: Site[]; meta: Meta }

// ---------- horizon/<site_id>.json ----------
export interface HorizonFile {
  schema_version: 1;
  site_id: string;
  mast_m: number;
  az_step_deg: 0.5;
  elev_deg: number[]; // 720, index i = azimuth i*0.5 deg clockwise from north
  elev_lo_deg: number[]; // terrain lowered by sigma
  elev_hi_deg: number[]; // terrain raised by sigma
  occluder: {
    dist_m: (number | null)[]; // null = no terrain above the sphere horizon
    lat: (number | null)[];
    lon_e: (number | null)[];
    feature_id: (string | null)[]; // id in features.json, or null = unnamed terrain
  };
  dem: { product: string; res_m: number | null; sigma_m?: number | null; max_range_km?: number | null };
  meta: Meta;
}

// ---------- features.json ----------
export interface Feature {
  id: string;
  name: string;
  name_status: NameStatus;
  gazetteer_id?: number | null;
  type?: string;
  lat: number;
  lon_e: number;
  radius_km?: number | null;
  source: SourceRef;
}
export interface FeaturesFile { schema_version: 1; features: Feature[]; meta: Meta }

// ---------- fixtures.json ----------
export interface Fixture {
  site_id: string;
  utc: string;
  body: 'sun' | 'earth';
  horizons_az: number;
  horizons_el: number;
  tol_deg: number;
  query_url: string;
}
export interface FixturesFile { schema_version: 1; fixtures: Fixture[]; meta: Meta }

// ---------- engine outputs (B produces, UI consumes; not a file format) ----------
export interface WindowMetrics {
  site_id: string;
  start_utc: string;
  end_utc: string;
  sunlit_h: number;
  earth_visible_pct: number;
  both_visible_h: number;
  longest_dark_gap_h: number;
  next_sunset_utc: string | null;
  next_earthset_utc: string | null;
  eclipse_h: number; // Earth blocking the Sun, computed from geometry
  band?: { lo: Partial<WindowMetrics>; hi: Partial<WindowMetrics> }; // from elev_lo/elev_hi
}

export interface CauseLine {
  body: 'sun' | 'earth';
  // Added Sat 23:15 CT at Agent B's request (engine output only, no data file changes, schema_version stays 1):
  // 'orbital' = lunar day/night or libration, 'terrain' = blocked by an occluder, 'dip' = site sees below the flat horizon.
  kind: 'terrain' | 'orbital' | 'dip';
  delta_h: number; // negative = lost
  az_deg: number | null; // null for orbital lines
  dist_km: number | null;
  feature_id: string | null; // null => "unnamed terrain"
  text: string; // e.g. "Sun lost 31 h — blocked by Malapert massif at az 172°, 14 km"
}

export interface SlipOption {
  label: string; // "Baseline", "+7 d", "Nearest better date", "Nearby: IM-2"
  site_id: string;
  start_utc: string;
  metrics: WindowMetrics;
  delta: Partial<Record<keyof WindowMetrics, number>>;
  causes: CauseLine[];
}
