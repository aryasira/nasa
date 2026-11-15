// AI-ASSISTED: drafted with Claude (Anthropic), reviewed by the human team.
// 3D terrain around the lander, built from the site's 720-sample horizon profile.
// Each azimuth column runs from the lander out to a skyline vertex at (smoothed, clamped) occluder distance D
// and height mast + tan(elev_deg)·D, so the silhouette seen from the mast matches elev_deg at every azimuth.
// The profile between the lander and the skyline is monotone in elevation angle (it never pokes above the
// skyline from the mast); craters and bumps near the lander are illustrative, not LOLA data.
import * as THREE from 'three';
import type { HorizonFile } from '@contracts/types';
import { dirFromAzEl, ridgeDistances, ridgeHeight } from './astro';

const NEAR_RINGS = 60; // 2 m spacing out to 120 m
const NEAR_STEP = 2;
const FAR_RINGS = 34;
const SKIRT = [[1.12, 0.06], [1.6, 0.3]] as const; // behind the skyline: (r/D, drop/D)

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

interface Crater { x: number; z: number; r: number }

export class Terrain {
  readonly group = new THREE.Group();
  readonly n: number;
  readonly dist: Float64Array;
  readonly ridgeY: Float64Array;
  private readonly mesh: THREE.Mesh;
  private readonly crest: THREE.Line;
  private readonly hl: { mesh: THREE.Mesh; line: THREE.Line; geo: THREE.BufferGeometry; lineGeo: THREE.BufferGeometry }[] = [];
  private readonly disposables: { dispose(): void }[] = [];

  constructor(readonly hz: HorizonFile) {
    const n = (this.n = hz.elev_deg.length);
    const mast = hz.mast_m;
    this.dist = ridgeDistances(hz);
    this.ridgeY = new Float64Array(n);
    for (let i = 0; i < n; i++) this.ridgeY[i] = ridgeHeight(hz.elev_deg[i], this.dist[i], mast);

    const rand = rng(hz.site_id);
    const craters: Crater[] = [];
    for (let k = 0; k < 70; k++) {
      const r = 1.5 + Math.pow(rand(), 2.2) * 9;
      const rho = 8 + r + rand() * (110 - r), th = rand() * Math.PI * 2;
      craters.push({ x: rho * Math.sin(th), z: -rho * Math.cos(th), r });
    }
    // Ground relief near the lander: never more than +0.3 m, far below the 2 m mast, so the skyline stays exact.
    const relief = (x: number, z: number, r: number) => {
      if (r > 118) return 0;
      let y = 0.12 * Math.sin(x * 0.11 + 1.3) * Math.cos(z * 0.09 - 0.4) + 0.06 * Math.sin(x * 0.37 - z * 0.29);
      for (const c of craters) {
        const d = Math.hypot(x - c.x, z - c.z) / c.r;
        if (d < 1) y -= 0.09 * c.r * (1 - d * d);
        else if (d < 1.5) y += Math.min(0.15, 0.03 * c.r) * (1 - (d - 1) / 0.5);
      }
      const fade = r < 112 ? 1 : (118 - r) / 6;
      return Math.min(0.3, y) * fade * Math.min(1, r / 6);
    };

    const rings = NEAR_RINGS + FAR_RINGS + SKIRT.length + 1;
    const pos = new Float32Array(n * rings * 3);
    const basePos = new Float32Array(n * rings * 3); // same mesh without the illustrative relief
    const col = new Float32Array(n * rings * 3);
    const base = new THREE.Color(0x8a8a86);
    for (let i = 0; i < n; i++) {
      const az = (i * 360) / n;
      const [sx, , sz] = dirFromAzEl(az, 0);
      const D = this.dist[i], Y = this.ridgeY[i];
      const profile = (r: number) => { const s = r / D; return Y > 0 ? Y * s * s : Y * s; };
      for (let j = 0; j < rings; j++) {
        let r: number, y: number;
        if (j <= NEAR_RINGS) { r = j * NEAR_STEP; y = profile(r); }
        else if (j <= NEAR_RINGS + FAR_RINGS) {
          const q = (j - NEAR_RINGS) / FAR_RINGS;
          r = NEAR_RINGS * NEAR_STEP * Math.pow(D / (NEAR_RINGS * NEAR_STEP), q);
          y = profile(r);
        } else {
          const [k, drop] = SKIRT[j - NEAR_RINGS - FAR_RINGS - 1];
          r = D * k; y = Y - D * drop;
        }
        const x = sx * r, z = sz * r;
        const o = (i * rings + j) * 3;
        basePos[o] = x; basePos[o + 1] = y; basePos[o + 2] = z;
        y += relief(x, z, r);
        pos[o] = x; pos[o + 1] = y; pos[o + 2] = z;
        const v = 0.86 + 0.14 * Math.sin(x * 0.05 + z * 0.031) * Math.cos(z * 0.043) + (rand() - 0.5) * 0.06;
        col[o] = base.r * v; col[o + 1] = base.g * v; col[o + 2] = base.b * v;
      }
    }
    const idx: number[] = [];
    for (let i = 0; i < n; i++) {
      const a = i * rings, b = ((i + 1) % n) * rings;
      for (let j = 0; j < rings - 1; j++) {
        // Winding so faces point up (toward +y) when seen from above.
        idx.push(a + j, b + j, a + j + 1, b + j, b + j + 1, a + j + 1);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setIndex(idx);
    // Shading normals = (base-profile normal, smoothed over ±K azimuth columns) + (relief detail).
    // Per-sample noise in elev_deg and in occluder distance otherwise corrugates the slopes into vertical
    // stripes under a grazing Sun. Only normals are smoothed; vertex positions (and the skyline) are exact.
    geo.setAttribute('position', new THREE.BufferAttribute(basePos, 3));
    geo.computeVertexNormals();
    const nb = Float32Array.from(geo.getAttribute('normal').array as Float32Array);
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.computeVertexNormals();
    const dst = geo.getAttribute('normal').array as Float32Array, K = 10;
    for (let j = 1; j < rings; j++) {
      for (let i = 0; i < n; i++) {
        let x = 0, y = 0, z = 0;
        for (let k = -K; k <= K; k++) {
          const o = ((((i + k) % n) + n) % n * rings + j) * 3;
          x += nb[o]; y += nb[o + 1]; z += nb[o + 2];
        }
        const l = Math.hypot(x, y, z) || 1, o = (i * rings + j) * 3;
        const fx = x / l + dst[o] - nb[o], fy = y / l + dst[o + 1] - nb[o + 1], fz = z / l + dst[o + 2] - nb[o + 2];
        const m = Math.hypot(fx, fy, fz) || 1;
        dst[o] = fx / m; dst[o + 1] = fy / m; dst[o + 2] = fz / m;
      }
    }
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.97, metalness: 0, side: THREE.DoubleSide });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.receiveShadow = true;
    this.mesh.name = 'terrain';
    this.group.add(this.mesh);
    this.disposables.push(geo, mat);

    // Faint crest line: the LOLA skyline itself.
    const cp = new Float32Array((n + 1) * 3);
    for (let i = 0; i <= n; i++) this.crestPoint(i % n, cp, i * 3, 0.999);
    const cgeo = new THREE.BufferGeometry();
    cgeo.setAttribute('position', new THREE.BufferAttribute(cp, 3));
    const cmat = new THREE.LineBasicMaterial({ color: 0x9fb4c8, transparent: true, opacity: 0.35 });
    this.crest = new THREE.Line(cgeo, cmat);
    this.group.add(this.crest);
    this.disposables.push(cgeo, cmat);

    // Highlight ribbons for the sector that blocks the Sun (0) or Earth (1).
    for (const color of [0xe69f00, 0x56b4e9]) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(HL_N * 2 * 3), 3));
      const ii: number[] = [];
      for (let k = 0; k < HL_N - 1; k++) ii.push(2 * k, 2 * k + 1, 2 * k + 2, 2 * k + 2, 2 * k + 1, 2 * k + 3);
      g.setIndex(ii);
      const m = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
        depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
      const mesh = new THREE.Mesh(g, m);
      mesh.visible = false; mesh.renderOrder = 2; mesh.frustumCulled = false;
      const lg = new THREE.BufferGeometry();
      lg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(HL_N * 3), 3));
      const lm = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 1, depthTest: false });
      const line = new THREE.Line(lg, lm);
      line.visible = false; line.renderOrder = 3; line.frustumCulled = false;
      this.group.add(mesh, line);
      this.hl.push({ mesh, line, geo: g, lineGeo: lg });
      this.disposables.push(g, m, lg, lm);
    }
  }

  private crestPoint(i: number, out: Float32Array, o: number, scale = 1) {
    const [sx, , sz] = dirFromAzEl((i * 360) / this.n, 0);
    out[o] = sx * this.dist[i] * scale; out[o + 1] = this.ridgeY[i] * scale + (1 - scale) * this.hz.mast_m; out[o + 2] = sz * this.dist[i] * scale;
  }

  /** Tint the skyline sector around `az` (or hide it with null). which: 0 = Sun, 1 = Earth. */
  setHighlight(which: 0 | 1, az: number | null) {
    const h = this.hl[which];
    if (az == null) { h.mesh.visible = h.line.visible = false; return; }
    const p = h.geo.getAttribute('position') as THREE.BufferAttribute;
    const l = h.lineGeo.getAttribute('position') as THREE.BufferAttribute;
    const step = 360 / this.n;
    const c = Math.round(az / step);
    for (let k = 0; k < HL_N; k++) {
      const i = (((c + k - (HL_N - 1) / 2) % this.n) + this.n) % this.n;
      const arr = p.array as Float32Array;
      // Pull the ribbon a little toward the mast so it sits in front of the terrain face.
      this.crestPoint(i, arr, 6 * k, 0.985);
      const [sx, , sz] = dirFromAzEl(i * step, 0);
      // Lower edge on the terrain profile at 0.45·D; the chord to the crest lies on or above the (convex) profile.
      const D = this.dist[i], Y = this.ridgeY[i], s = 0.45;
      const y = Y > 0 ? Y * s * s : Y * s;
      arr[6 * k + 3] = sx * D * s * 0.985; arr[6 * k + 4] = y + 0.01 * D * (1 - s); arr[6 * k + 5] = sz * D * s * 0.985;
      this.crestPoint(i, l.array as Float32Array, 3 * k, 0.995);
    }
    p.needsUpdate = true; l.needsUpdate = true;
    h.geo.computeBoundingSphere(); h.lineGeo.computeBoundingSphere();
    h.mesh.visible = h.line.visible = true;
  }

  dispose() {
    for (const d of this.disposables) d.dispose();
    this.group.removeFromParent();
  }
}
const HL_N = 33; // 16 samples either side = ±8° of azimuth
