// AI-ASSISTED: drafted with Claude (Anthropic), reviewed by the human team.
// 3D terrain around the lander, built from the site's 720-sample horizon profile.
// Polar mesh: one column per horizon azimuth sample, geometric ring spacing (dense at the lander, sparse at the
// ridge). The crest vertex of each column sits at (smoothed, clamped) occluder distance D and height
// mast + tan(elev_deg)·D, so the silhouette seen from the mast equals elev_deg. All relief in front of the crest
// (craters, undulation, ridged mountains, rocks) is illustrative and stays below the mast's line of sight.
import * as THREE from 'three';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { HorizonFile } from '@contracts/types';
import { dirFromAzEl } from './astro';
import { GroundModel, noise3, rng } from './ground';
import { regolithMaterial, type SunUniforms } from './regolith';

const RINGS = 168; // rings from the lander (r = 0) to the crest (s = 1)
const K = 7.2; // geometric spacing: r_j = D (e^{K j/RINGS} − 1)/(e^K − 1)
const SKIRT = [1.12, 1.6, 2.4];
const HF_W = 720, HF_H = 224, HF_R0 = 4, HF_RMAX = 50_000;
const HL_N = 41; // highlight outline: ±10° of azimuth

export class Terrain {
  readonly group = new THREE.Group();
  readonly model: GroundModel;
  readonly n: number;
  private readonly hfTex: THREE.DataTexture;
  private readonly hl: { line: Line2; glow: Line2; geo: LineGeometry; geoGlow: LineGeometry }[] = [];
  private readonly lineMats: LineMaterial[] = [];
  private readonly disposables: { dispose(): void }[] = [];

  constructor(readonly hz: HorizonFile, u: SunUniforms) {
    const m = (this.model = new GroundModel(hz));
    const n = (this.n = m.n);
    const rings = RINGS + 1 + SKIRT.length;
    const pos = new Float32Array(n * rings * 3);
    const g = (j: number) => (Math.exp((K * j) / RINGS) - 1) / (Math.exp(K) - 1);
    for (let i = 0; i < n; i++) {
      const az = i * m.step;
      const [sx, , sz] = dirFromAzEl(az, 0);
      const D = m.dist[i];
      for (let j = 0; j < rings; j++) {
        const r = j <= RINGS ? D * g(j) : D * SKIRT[j - RINGS - 1];
        const y = j === RINGS ? m.ridgeY[i] : m.heightAt(az, r);
        const o = (i * rings + j) * 3;
        pos[o] = sx * r; pos[o + 1] = y; pos[o + 2] = sz * r;
      }
    }
    const idx = new Uint32Array(n * (rings - 1) * 6);
    let q = 0;
    for (let i = 0; i < n; i++) {
      const a = i * rings, b = ((i + 1) % n) * rings;
      for (let j = 0; j < rings - 1; j++) {
        idx[q++] = a + j; idx[q++] = b + j; idx[q++] = a + j + 1;
        idx[q++] = b + j; idx[q++] = b + j + 1; idx[q++] = a + j + 1;
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.computeVertexNormals();
    // Smooth normals across neighbouring columns, more toward the ridge: per-sample noise in elev_deg and in
    // occluder distance otherwise reads as vertical stripes under a grazing Sun. Positions stay exact.
    const nrm = geo.getAttribute('normal').array as Float32Array;
    const src = Float32Array.from(nrm);
    for (let j = 1; j < rings; j++) {
      const s = j <= RINGS ? g(j) : 1;
      const k = Math.round(1 + 16 * s * s);
      for (let i = 0; i < n; i++) {
        let x = 0, y = 0, z = 0, w = 0;
        for (let d = -k; d <= k; d++) {
          const o = ((((i + d) % n) + n) % n * rings + j) * 3, wt = 1 - Math.abs(d) / (k + 1);
          x += src[o] * wt; y += src[o + 1] * wt; z += src[o + 2] * wt; w += wt;
        }
        const l = Math.hypot(x, y, z) || 1, o = (i * rings + j) * 3;
        nrm[o] = x / l; nrm[o + 1] = y / l; nrm[o + 2] = z / l;
      }
    }
    geo.computeBoundingSphere();
    const mat = regolithMaterial(u, { detail: true });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true; mesh.castShadow = true;
    mesh.name = 'terrain';
    this.group.add(mesh);
    this.disposables.push(geo, mat);

    // Polar heightfield of the same ground, for the soft Sun march in the shader.
    const hf = new Uint16Array(HF_W * HF_H);
    const logK = Math.log(1 + HF_RMAX / HF_R0);
    for (let j = 0; j < HF_H; j++) {
      const r = HF_R0 * (Math.exp(((j + 0.5) / HF_H) * logK) - 1);
      for (let i = 0; i < HF_W; i++) hf[j * HF_W + i] = THREE.DataUtils.toHalfFloat(m.heightAt((i * 360) / HF_W, r));
    }
    this.hfTex = new THREE.DataTexture(hf, HF_W, HF_H, THREE.RedFormat, THREE.HalfFloatType);
    this.hfTex.wrapS = THREE.RepeatWrapping; this.hfTex.wrapT = THREE.ClampToEdgeWrapping;
    this.hfTex.magFilter = this.hfTex.minFilter = THREE.LinearFilter;
    this.hfTex.needsUpdate = true;
    this.disposables.push(this.hfTex);
    u.uHF.value = this.hfTex; u.uHFR0.value = HF_R0; u.uHFLogK.value = logK; u.uHFu0.value = 0.5 / HF_W;

    this.addRocks(u);

    // Blocking-terrain outline (Sun = 0, Earth = 1): thin luminous line along the crest + soft glow.
    for (const color of [0xff6b5e, 0xff6b5e]) {
      const mk = (w: number, op: number) => {
        const lm = new LineMaterial({ color, linewidth: w, transparent: true, opacity: op, depthWrite: false, worldUnits: false });
        lm.toneMapped = false;
        this.lineMats.push(lm); this.disposables.push(lm);
        return lm;
      };
      const lg = new LineGeometry(), gg = new LineGeometry();
      const zero = new Array(HL_N * 3).fill(0);
      lg.setPositions(zero); gg.setPositions(zero);
      const line = new Line2(lg, mk(2, 1)), glow = new Line2(gg, mk(7, 0.22));
      for (const l of [line, glow]) { l.visible = false; l.frustumCulled = false; l.renderOrder = 5; }
      this.group.add(glow, line);
      this.hl.push({ line, glow, geo: lg, geoGlow: gg });
      this.disposables.push(lg, gg);
    }
  }

  private addRocks(u: SunUniforms) {
    const m = this.model;
    const rand = rng(this.hz.site_id + ':rocks');
    const variants: THREE.BufferGeometry[] = [];
    for (let v = 0; v < 4; v++) {
      // Smooth, irregular boulder: an icosphere displaced by 3D value noise, with a few flattened faces.
      const base = mergeVertices(new THREE.IcosahedronGeometry(1, 4));
      const p = base.getAttribute('position') as THREE.BufferAttribute;
      const r2 = rng('rock' + v);
      const cuts = Array.from({ length: 5 }, () => ({ n: new THREE.Vector3(r2() - 0.5, r2() - 0.3, r2() - 0.5).normalize(), d: 0.62 + 0.25 * r2() }));
      const vv = new THREE.Vector3();
      for (let i = 0; i < p.count; i++) {
        vv.fromBufferAttribute(p, i);
        let d = 1 + 0.22 * noise3(vv.x * 1.6 + v * 7, vv.y * 1.6, vv.z * 1.6) + 0.08 * noise3(vv.x * 5 + v, vv.y * 5, vv.z * 5) + 0.025 * noise3(vv.x * 13, vv.y * 13 + v, vv.z * 13);
        for (const c of cuts) { const h = vv.dot(c.n) * d; if (h > c.d) d *= c.d / h + (h - c.d) * 0.15; }
        vv.multiplyScalar(d);
        vv.y *= 0.62;
        p.setXYZ(i, vv.x, vv.y, vv.z);
      }
      base.computeVertexNormals();
      variants.push(base);
    }
    const mat = regolithMaterial(u, { rock: true });
    mat.flatShading = false;
    this.disposables.push(mat, ...variants);
    const per: THREE.Matrix4[][] = variants.map(() => []);
    const place = (count: number, sMin: number, sMax: number, rMin: number, rMax: number, alpha: number) => {
      for (let k = 0; k < count; k++) {
        const size = sMin * Math.pow(1 - rand() * (1 - Math.pow(sMin / sMax, alpha)), -1 / alpha);
        const r = rMin + Math.pow(rand(), 0.8) * (rMax - rMin);
        const az = rand() * 360;
        const ground = m.heightAt(az, r);
        // Keep every rock below the mast's line of sight so the LOLA silhouette stays exact.
        const room = m.sight(az, r) - 0.02 - 0.0015 * r - ground;
        const h = size * 1.05; // generous bound on the top of a tilted, squashed rock above the ground
        const sc = h > room ? size * Math.max(0, room / h) : size;
        if (sc < 0.04) continue;
        const [x, , z] = dirFromAzEl(az, 0);
        const mt = new THREE.Matrix4().compose(
          new THREE.Vector3(x * r, ground - sc * 0.62 * 0.3, z * r),
          new THREE.Quaternion().setFromEuler(new THREE.Euler((rand() - 0.5) * 0.4, rand() * Math.PI * 2, (rand() - 0.5) * 0.4)),
          new THREE.Vector3(sc * (0.8 + 0.5 * rand()), sc, sc * (0.8 + 0.5 * rand())));
        per[Math.floor(rand() * variants.length)].push(mt);
      }
    };
    place(340, 0.05, 0.7, 3.2, 70, 1.6);
    place(60, 0.3, 1.6, 20, 160, 1.8);
    place(14, 1.2, 3.2, 60, 380, 2);
    variants.forEach((g, v) => {
      const im = new THREE.InstancedMesh(g, mat, Math.max(1, per[v].length));
      im.count = per[v].length;
      per[v].forEach((mt, i) => im.setMatrixAt(i, mt));
      im.instanceMatrix.needsUpdate = true;
      im.castShadow = true; im.receiveShadow = true;
      im.computeBoundingSphere();
      this.group.add(im);
    });
  }

  /** Crest point (scene coords) at an azimuth, pulled slightly toward the mast so it draws in front of the ridge. */
  crest(az: number, pull = 0.996): THREE.Vector3 {
    const m = this.model;
    const c = m.column(az);
    const [sx, , sz] = dirFromAzEl(az, 0);
    const y = m.mast + (c.Y - m.mast) * pull;
    return new THREE.Vector3(sx * c.D * pull, y, sz * c.D * pull);
  }

  setResolution(w: number, h: number) { for (const m of this.lineMats) m.resolution.set(w, h); }

  /** Outline the crest around `az` (the stretch of ridge that blocks the body), or hide it. which: 0 = Sun, 1 = Earth. */
  setHighlight(which: 0 | 1, az: number | null) {
    const h = this.hl[which];
    if (az == null) { h.line.visible = h.glow.visible = false; return; }
    const pts: number[] = [];
    for (let k = 0; k < HL_N; k++) {
      const a = az + (k - (HL_N - 1) / 2) * 0.5;
      const p = this.crest(a);
      pts.push(p.x, p.y, p.z);
    }
    h.geo.setPositions(pts); h.geoGlow.setPositions(pts);
    h.line.computeLineDistances(); h.glow.computeLineDistances();
    h.line.visible = h.glow.visible = true;
  }

  dispose() {
    for (const d of this.disposables) d.dispose();
    this.group.removeFromParent();
  }
}
