// AI-ASSISTED: drafted with Claude (Anthropic), reviewed by the human team.
// Pure terrain height model for the 3D view (no three.js, so it runs under Vitest).
// The LOLA skyline is exact: at every horizon azimuth sample the crest vertex sits at elev_deg seen from the mast.
// Everything between the lander and that crest is ILLUSTRATIVE (craters, undulation, ridged relief), and is
// soft-clamped below the line of sight from the mast, so nothing in front of the crest can ever poke above
// the profile (see the "never above the sight line" test).
import type { HorizonFile } from '@contracts/types';
import { ridgeDistances, ridgeHeight } from './astro';

const D2R = Math.PI / 180;

/** Small deterministic PRNG so the illustrative ground is the same on every visit. */
export function rng(seedStr: string) {
  let s = 2166136261;
  for (let i = 0; i < seedStr.length; i++) s = Math.imul(s ^ seedStr.charCodeAt(i), 16777619);
  return () => {
    s += 0x6d2b79f5;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hash2(ix: number, iy: number, seed: number) {
  let h = Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(seed, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
/** 2D value noise in [-1, 1]. */
export function vnoise(x: number, y: number, seed = 0) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy, seed), b = hash2(ix + 1, iy, seed), c = hash2(ix, iy + 1, seed), d = hash2(ix + 1, iy + 1, seed);
  return 2 * (a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy) - 1;
}

/** 3D value noise in [-1, 1] (for rock shapes). */
export function noise3(x: number, y: number, z: number) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const fx = x - ix, fy = y - iy, fz = z - iz;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy), w = fz * fz * (3 - 2 * fz);
  const h = (a: number, b: number, c: number) => hash2(a + Math.imul(c, 7919), b, c);
  const l = (a: number, b: number, t: number) => a + (b - a) * t;
  const z0 = l(l(h(ix, iy, iz), h(ix + 1, iy, iz), u), l(h(ix, iy + 1, iz), h(ix + 1, iy + 1, iz), u), v);
  const z1 = l(l(h(ix, iy, iz + 1), h(ix + 1, iy, iz + 1), u), l(h(ix, iy + 1, iz + 1), h(ix + 1, iy + 1, iz + 1), u), v);
  return 2 * l(z0, z1, w) - 1;
}

export interface Crater { x: number; z: number; r: number; depth: number; rim: number }

/** Polynomial smooth minimum; always <= min(a, b). */
const smin = (a: number, b: number, k: number) => {
  if (k <= 0) return Math.min(a, b);
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - (h * h * k) / 4;
};

export class GroundModel {
  readonly n: number;
  readonly step: number;
  readonly mast: number;
  readonly dist: Float64Array; // drawing distance of each skyline vertex (m)
  readonly ridgeY: Float64Array; // crest height above the ground at the lander (m)
  readonly craters: Crater[] = [];
  private readonly cell = 24;
  private readonly grid = new Map<number, Crater[]>();
  private readonly seed: number;

  constructor(readonly hz: HorizonFile) {
    const n = (this.n = hz.elev_deg.length);
    this.step = 360 / n;
    this.mast = hz.mast_m;
    this.dist = ridgeDistances(hz);
    this.ridgeY = new Float64Array(n);
    for (let i = 0; i < n; i++) this.ridgeY[i] = ridgeHeight(hz.elev_deg[i], this.dist[i], this.mast);
    const rand = rng(hz.site_id + ':ground');
    this.seed = Math.floor(rand() * 1e6);
    // Power-law crater population (many small, few large), kept clear of the lander footprint.
    const add = (count: number, rMin: number, rMax: number, rhoMax: number, alpha: number) => {
      for (let k = 0; k < count; k++) {
        const u = rand();
        const r = rMin * Math.pow(1 - u * (1 - Math.pow(rMin / rMax, alpha)), -1 / alpha);
        const rho = 6 + r * 1.3 + Math.sqrt(rand()) * (rhoMax - r);
        const th = rand() * Math.PI * 2;
        const fresh = rand();
        this.craters.push({ x: rho * Math.sin(th), z: -rho * Math.cos(th), r, depth: r * (0.05 + 0.14 * fresh * fresh), rim: r * (0.012 + 0.04 * fresh * fresh) });
      }
    };
    add(150, 0.6, 6, 110, 1.7);
    add(70, 4, 22, 320, 1.8);
    add(14, 18, 60, 700, 2);
    for (const c of this.craters) {
      const ext = c.r * 2;
      for (let gx = Math.floor((c.x - ext) / this.cell); gx <= Math.floor((c.x + ext) / this.cell); gx++)
        for (let gz = Math.floor((c.z - ext) / this.cell); gz <= Math.floor((c.z + ext) / this.cell); gz++) {
          const key = gx * 100003 + gz;
          let list = this.grid.get(key);
          if (!list) this.grid.set(key, (list = []));
          list.push(c);
        }
    }
  }

  /** Column parameters at a fractional azimuth (linear between samples, like the engine's horizonAt). */
  column(azDeg: number) {
    const x = ((((azDeg % 360) + 360) % 360) / this.step);
    const i0 = Math.floor(x) % this.n, i1 = (i0 + 1) % this.n, f = x - Math.floor(x);
    const D = Math.exp(Math.log(this.dist[i0]) * (1 - f) + Math.log(this.dist[i1]) * f);
    const e = this.hz.elev_deg[i0] * (1 - f) + this.hz.elev_deg[i1] * f;
    const tanE = Math.tan(e * D2R);
    return { D, tanE, Y: this.mast + tanE * D };
  }

  /** Smooth profile from the lander to the crest and a skirt that drops away behind it. */
  static base(r: number, D: number, Y: number) {
    const s = r / D;
    if (s <= 1) return Y > 0 ? Y * s * s : Y * s;
    if (s <= 1.12) return Y - D * 0.06 * ((s - 1) / 0.12);
    if (s <= 1.6) return Y - D * (0.06 + 0.24 * ((s - 1.12) / 0.48));
    return Y - D * (0.3 + 0.5 * (s - 1.6));
  }

  craterRelief(x: number, z: number) {
    const list = this.grid.get(Math.floor(x / this.cell) * 100003 + Math.floor(z / this.cell));
    if (!list) return 0;
    let h = 0;
    for (const c of list) {
      const dx = x - c.x, dz = z - c.z;
      const d2 = (dx * dx + dz * dz) / (c.r * c.r);
      if (d2 >= 4) continue;
      const d = Math.sqrt(d2);
      if (d < 1) h += c.rim + c.depth * (d2 - 1) * (1 - 0.25 * (1 - d2)); // bowl, slightly flat floor
      else { const t = (2 - d); h += c.rim * Math.pow(1 / d, 3) * t * t * (3 - 2 * t); } // raised rim, ejecta falloff
    }
    return h;
  }

  /** Illustrative relief before clamping (m). */
  relief(x: number, z: number, r: number, s: number) {
    if (r < 3.5) return 0;
    const near = Math.min(1, (r - 3.5) / 8);
    let h = this.craterRelief(x, z) * near;
    // gentle undulation in the near field
    const u = Math.min(1, (r - 3.5) / 25);
    h += u * (0.5 * vnoise(x / 70, z / 70, this.seed) + 0.22 * vnoise(x / 23, z / 23, this.seed + 1) + 0.08 * vnoise(x / 7, z / 7, this.seed + 2));
    // ridged mountain relief that grows with distance and vanishes at the crest
    if (r > 120 && s < 1) {
      const env = Math.min(1, (r - 120) / 900) * Math.sqrt(1 - s);
      let a = 0, amp = 1, f = 1 / 2600;
      for (let o = 0; o < 4; o++) {
        const nv = 1 - Math.abs(vnoise(x * f, z * f, this.seed + 10 + o));
        a += amp * (nv * nv - 0.35);
        amp *= 0.5; f *= 2.1;
      }
      h += env * a * Math.min(0.06 * r, 420);
    }
    return h;
  }

  /** Height of the drawn ground at (azimuth, horizontal range from the lander). */
  heightAt(azDeg: number, r: number) {
    const { D, tanE, Y } = this.column(azDeg);
    const s = r / D;
    const b = GroundModel.base(r, D, Y);
    if (s >= 0.9995) return b;
    const a = azDeg * D2R;
    const x = Math.sin(a) * r, z = -Math.cos(a) * r;
    const sight = this.mast + tanE * r - (0.02 + 0.0015 * r); // a little below the line of sight from the mast
    // The base profile never rises above the sight line, so neither does the cap.
    const cap = Math.max(b, sight), gap = cap - b;
    let rel = this.relief(x, z, r, s);
    // Positive relief is compressed smoothly into the room left under the sight line (no flat clamped facets),
    // then smin() (always <= min) makes the bound strict. The crest vertex itself stays exact.
    if (rel > 0) rel = gap > 1e-6 ? 0.85 * gap * Math.tanh(rel / (0.85 * gap)) : 0;
    return smin(b + rel, cap, Math.max(0.02, 0.01 * r) * (1 - s));
  }

  /** Line-of-sight height from the mast at azimuth/range (for tests). */
  sight(azDeg: number, r: number) {
    return this.mast + this.column(azDeg).tanE * r;
  }
}
