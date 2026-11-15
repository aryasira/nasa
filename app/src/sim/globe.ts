// AI-ASSISTED: drafted with Claude (Anthropic), reviewed by the human team.
// "Moon globe": a procedurally shaded Moon (illustrative maria/highlands and craters, not a map) lit from the
// ephemeris sub-solar direction (the Sun unit vector is already in MOON_ME), so the terminator is real.
// Site pins are HTML buttons placed by index.ts (keyboard focus, hover labels); this file gives their positions.
import * as THREE from 'three';
import type { Site } from '@contracts/types';
import type { Vec3 } from '../engine/geometry';
import { moonToScene } from './astro';
import { Stars } from './sky';

const VS = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec3 vN; varying vec3 vP; varying vec3 vW;
void main(){ vN = normalize(mat3(modelMatrix) * normal); vP = position; vW = (modelMatrix * vec4(position, 1.0)).xyz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  #include <logdepthbuf_vertex>
}`;
const FS = /* glsl */ `
#include <logdepthbuf_pars_fragment>
uniform vec3 sunDir;
varying vec3 vN; varying vec3 vP; varying vec3 vW;
float h(vec3 p){ return fract(sin(dot(p, vec3(12.9898,78.233,45.164))) * 43758.5453); }
vec3 h3(vec3 p){ return fract(sin(vec3(dot(p, vec3(127.1,311.7,74.7)), dot(p, vec3(269.5,183.3,246.1)), dot(p, vec3(113.5,271.9,124.6)))) * 43758.5453); }
float noise(vec3 p){ vec3 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(mix(h(i),h(i+vec3(1,0,0)),f.x),mix(h(i+vec3(0,1,0)),h(i+vec3(1,1,0)),f.x),f.y),
             mix(mix(h(i+vec3(0,0,1)),h(i+vec3(1,0,1)),f.x),mix(h(i+vec3(0,1,1)),h(i+vec3(1,1,1)),f.x),f.y),f.z); }
float fbm(vec3 p){ float a=0.5, s=0.0; for(int k=0;k<6;k++){ s+=a*noise(p); p=p*2.07+0.31; a*=0.5; } return s; }
// One octave of craters on a 3D cell grid: bowl + raised rim; returns height and a "freshness" (bright rays/ejecta).
vec2 craters(vec3 p, float scale, float density) {
  vec3 q = p * scale; vec3 c = floor(q);
  float hgt = 0.0, fresh = 0.0;
  for (int z = -1; z <= 1; z++) for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec3 cell = c + vec3(x, y, z);
    vec3 rnd = h3(cell);
    if (rnd.z > density) continue;
    vec3 ctr = cell + rnd;
    float r = 0.25 + 0.45 * fract(rnd.x * 7.13);
    float d = length(q - ctr) / r;
    if (d < 1.0) hgt += (d * d - 1.0) * 0.7 + 0.25;
    else if (d < 2.0) hgt += 0.25 * pow(1.0 / d, 3.0) * smoothstep(2.0, 1.0, d);
    if (fract(rnd.y * 3.7) > 0.86) fresh = max(fresh, smoothstep(2.6, 0.6, d));
  }
  return vec2(hgt, fresh);
}
void main(){
  #include <logdepthbuf_fragment>
  vec3 n = normalize(vN); vec3 q = normalize(vP);
  // maria: large dark smooth basins, more on one hemisphere (illustrative)
  float m = fbm(q * 1.35 + vec3(11.0, 2.0, 5.0)) + 0.12 * q.x;
  float maria = smoothstep(0.56, 0.6, m);
  vec2 c1 = craters(q, 7.0, 0.6), c2 = craters(q, 19.0, 0.55);
  float hgt = c1.x * 1.0 + c2.x * 0.35 + fbm(q * 14.0) * 0.25;
  hgt *= mix(1.0, 0.45, maria);
  // screen-space bump from the procedural height
  vec3 dpx = dFdx(vW), dpy = dFdy(vW);
  float dhx = dFdx(hgt), dhy = dFdy(hgt);
  vec3 r1 = cross(dpy, n), r2 = cross(n, dpx);
  float det = dot(dpx, r1);
  vec3 grad = sign(det) * (dhx * r1 + dhy * r2);
  // fade the bump out near the terminator, where per-pixel derivatives would sparkle
  vec3 nb = normalize(abs(det) * n - grad * 0.0022 * smoothstep(0.08, 0.35, dot(n, normalize(sunDir))));
  float alb = mix(0.30, 0.13, maria) * (0.85 + 0.3 * fbm(q * 6.0)) + 0.12 * max(c1.y, c2.y) * (1.0 - maria * 0.5);
  vec3 col = vec3(alb) * mix(vec3(1.0), vec3(0.93, 0.95, 1.0), maria);
  // Lommel-Seeliger: no limb darkening; the terminator is the true sub-solar geometry, softened slightly.
  vec3 L = normalize(sunDir); vec3 V = normalize(cameraPosition - vW);
  float mu0 = max(dot(nb, L), 0.0), mu = max(dot(nb, V), 0.0);
  float ls = 2.0 * mu0 / max(mu0 + mu, 1e-3);
  float term = smoothstep(-0.04, 0.08, dot(n, L));
  vec3 c = col * ls * term * 2.4;
  // Faint earthshine on the night side plus a thin limb rim, so the whole disc reads as a round body
  // and pins on the unlit hemisphere sit visibly on the surface (illustrative brightness, not photometric).
  float rim = pow(1.0 - max(dot(n, V), 0.0), 4.0);
  c += col * (1.0 - term) * 0.16 + vec3(0.55, 0.62, 0.75) * rim * 0.10;
  gl_FragColor = vec4(c, 1.0);
}`;

export const siteDir = (s: Site): Vec3 => {
  const la = (s.lat * Math.PI) / 180, lo = (s.lon_e * Math.PI) / 180;
  return moonToScene([Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la)]);
};

export class Globe {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(32, 1, 0.01, 400_000);
  readonly pins: { id: string; pos: THREE.Vector3 }[] = [];
  readonly sunDir = new THREE.Vector3(1, 0, 0);
  readonly earthDir = new THREE.Vector3(1, 0, 0);
  private readonly mat: THREE.ShaderMaterial;
  private readonly arrows: { line: THREE.Line; cone: THREE.Mesh }[] = [];
  private readonly stars = new Stars(300);
  private readonly disposables: { dispose(): void }[] = [];
  selected = '';

  constructor(readonly sites: Site[]) {
    this.scene.background = new THREE.Color(0x000000);
    this.mat = new THREE.ShaderMaterial({ vertexShader: VS, fragmentShader: FS, uniforms: { sunDir: { value: new THREE.Vector3(1, 0, 0) } } });
    const g = new THREE.SphereGeometry(1, 192, 128);
    this.scene.add(new THREE.Mesh(g, this.mat));
    this.disposables.push(g, this.mat);
    for (const s of sites) this.pins.push({ id: s.id, pos: new THREE.Vector3(...siteDir(s)) });
    this.stars.set(0.9, 1);
    this.scene.add(this.stars.group);
    // Direction indicators: thin line from the limb outward + small cone (Earth = 0, Sun = 1).
    for (const color of [0x56b4e9, 0xe69f00]) {
      const lg = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(1, 0, 0)]);
      const lm = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.85 });
      const line = new THREE.Line(lg, lm);
      const cg = new THREE.ConeGeometry(0.018, 0.06, 16);
      const cm = new THREE.MeshBasicMaterial({ color });
      const cone = new THREE.Mesh(cg, cm);
      this.scene.add(line, cone);
      this.arrows.push({ line, cone });
      this.disposables.push(lg, lm, cg, cm);
    }
  }

  setPixelRatio(px: number) { this.stars.set(0.9, px); }

  /** sunMoonMe: unit vector Moon centre → Sun (MOON_ME). earthMoonMe: Moon centre → Earth, km (MOON_ME). */
  update(sunMoonMe: Vec3, earthMoonMe: Vec3, siteId: string) {
    this.sunDir.set(...moonToScene(sunMoonMe)).normalize();
    this.earthDir.set(...moonToScene(earthMoonMe)).normalize();
    (this.mat.uniforms.sunDir.value as THREE.Vector3).copy(this.sunDir);
    [this.earthDir, this.sunDir].forEach((d, k) => {
      const { line, cone } = this.arrows[k];
      const a = d.clone().multiplyScalar(1.04), b = d.clone().multiplyScalar(k === 0 ? 1.42 : 1.34);
      (line.geometry as THREE.BufferGeometry).setFromPoints([a, b]);
      cone.position.copy(b);
      cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d);
    });
    this.selected = siteId;
  }

  /** Tip of a direction indicator (for its label). 0 = Earth, 1 = Sun. */
  arrowTip(k: 0 | 1) { return this.arrows[k].cone.position.clone(); }

  /** Viewpoint above the selected site, tilted a little toward the equator so the limb shows. */
  frame(siteId: string, cam = this.camera, dist = 5.2) {
    const s = this.sites.find((x) => x.id === siteId);
    const d = s ? new THREE.Vector3(...siteDir(s)) : new THREE.Vector3(0, 0, 1);
    const eq = new THREE.Vector3(d.x, 0, d.z);
    if (eq.lengthSq() < 1e-6) eq.set(0, 0, 1);
    eq.normalize();
    const v = d.clone().multiplyScalar(0.75).add(eq.multiplyScalar(0.45)).normalize().multiplyScalar(dist);
    cam.position.copy(v);
    cam.up.set(0, 1, 0);
    cam.lookAt(0, 0, 0);
  }

  pick(ray: THREE.Raycaster): string | null {
    let best: string | null = null, bd = 0.06;
    for (const p of this.pins) {
      const toCam = ray.ray.origin.clone().sub(p.pos);
      if (toCam.dot(p.pos) <= 0) continue;
      const d = ray.ray.distanceToPoint(p.pos);
      if (d < bd) { bd = d; best = p.id; }
    }
    return best;
  }

  dispose() {
    for (const d of this.disposables) d.dispose();
    this.stars.dispose();
  }
}
