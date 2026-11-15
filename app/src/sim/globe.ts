// AI-ASSISTED: drafted with Claude (Anthropic), reviewed by the human team.
// "Moon globe": a procedurally shaded Moon (illustrative albedo, not a map) with the day/night terminator
// from the ephemeris sub-solar direction (the Sun unit vector is already in MOON_ME), catalogue sites as
// clickable markers, and arrows toward the Earth and the Sun.
import * as THREE from 'three';
import type { Site } from '@contracts/types';
import type { Vec3 } from '../engine/geometry';
import { moonToScene } from './astro';

const VS = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec3 vN; varying vec3 vP;
void main(){ vN = normalize(mat3(modelMatrix) * normal); vP = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  #include <logdepthbuf_vertex>
}`;
const FS = /* glsl */ `
#include <logdepthbuf_pars_fragment>
uniform vec3 sunDir;
varying vec3 vN; varying vec3 vP;
float h(vec3 p){ return fract(sin(dot(p, vec3(12.9898,78.233,45.164))) * 43758.5453); }
float noise(vec3 p){ vec3 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(mix(h(i),h(i+vec3(1,0,0)),f.x),mix(h(i+vec3(0,1,0)),h(i+vec3(1,1,0)),f.x),f.y),
             mix(mix(h(i+vec3(0,0,1)),h(i+vec3(1,0,1)),f.x),mix(h(i+vec3(0,1,1)),h(i+vec3(1,1,1)),f.x),f.y),f.z); }
float fbm(vec3 p){ float a=0.5, s=0.0; for(int k=0;k<6;k++){ s+=a*noise(p); p*=2.1; a*=0.5; } return s; }
void main(){
  #include <logdepthbuf_fragment>
  vec3 n = normalize(vN); vec3 q = normalize(vP);
  float maria = smoothstep(0.55, 0.62, fbm(q*1.6 + 11.0));
  float grain = fbm(q*18.0);
  float alb = mix(0.5, 0.27, maria) * (0.82 + 0.36 * grain);
  float l = dot(n, normalize(sunDir));
  float lit = smoothstep(-0.015, 0.06, l) * (0.25 + 0.75 * clamp(l, 0.0, 1.0));
  vec3 c = vec3(alb) * (0.035 + 1.15 * lit);
  // Thin terminator line so the day/night boundary reads clearly.
  c = mix(c, vec3(0.94,0.89,0.26), 0.55 * (1.0 - smoothstep(0.0, 0.012, abs(l))));
  gl_FragColor = vec4(c, 1.0);
  #include <colorspace_fragment>
}`;

export const siteDir = (s: Site): Vec3 => {
  const la = (s.lat * Math.PI) / 180, lo = (s.lon_e * Math.PI) / 180;
  return moonToScene([Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la)]);
};

export class Globe {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(32, 1, 0.01, 100);
  readonly markers: THREE.Mesh[] = [];
  private readonly mat: THREE.ShaderMaterial;
  private readonly earthArrow: THREE.ArrowHelper;
  private readonly sunArrow: THREE.ArrowHelper;
  private readonly ring: THREE.Mesh;
  private readonly disposables: { dispose(): void }[] = [];
  selected = '';

  constructor(readonly sites: Site[]) {
    this.mat = new THREE.ShaderMaterial({ vertexShader: VS, fragmentShader: FS, uniforms: { sunDir: { value: new THREE.Vector3(1, 0, 0) } } });
    const g = new THREE.SphereGeometry(1, 128, 96);
    this.scene.add(new THREE.Mesh(g, this.mat));
    this.disposables.push(g, this.mat);
    const mg = new THREE.SphereGeometry(0.018, 16, 12);
    const mm = new THREE.MeshBasicMaterial({ color: 0xf0e442 });
    this.disposables.push(mg, mm);
    for (const s of sites) {
      const m = new THREE.Mesh(mg, mm);
      m.position.set(...siteDir(s)).multiplyScalar(1.004);
      m.userData.siteId = s.id;
      this.markers.push(m);
      this.scene.add(m);
    }
    const rg = new THREE.RingGeometry(0.034, 0.048, 40);
    const rm = new THREE.MeshBasicMaterial({ color: 0x009e73, side: THREE.DoubleSide, depthTest: false, transparent: true });
    this.ring = new THREE.Mesh(rg, rm);
    this.ring.renderOrder = 5;
    this.scene.add(this.ring);
    this.disposables.push(rg, rm);
    this.earthArrow = new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), new THREE.Vector3(), 0.36, 0x56b4e9, 0.1, 0.06);
    this.sunArrow = new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), new THREE.Vector3(), 0.3, 0xe69f00, 0.09, 0.05);
    this.scene.add(this.earthArrow, this.sunArrow);
  }

  /** sunMoonMe: unit vector Moon centre → Sun (MOON_ME). earthMoonMe: Moon centre → Earth, km (MOON_ME). */
  update(sunMoonMe: Vec3, earthMoonMe: Vec3, siteId: string) {
    const sun = new THREE.Vector3(...moonToScene(sunMoonMe)).normalize();
    const earth = new THREE.Vector3(...moonToScene(earthMoonMe)).normalize();
    (this.mat.uniforms.sunDir.value as THREE.Vector3).copy(sun);
    this.earthArrow.position.copy(earth).multiplyScalar(1.05);
    this.earthArrow.setDirection(earth);
    this.sunArrow.position.copy(sun).multiplyScalar(1.05);
    this.sunArrow.setDirection(sun);
    this.selected = siteId;
    const m = this.markers.find((x) => x.userData.siteId === siteId);
    for (const x of this.markers) x.scale.setScalar(x === m ? 1.5 : 1);
    if (m) {
      const n = m.position.clone().normalize();
      this.ring.position.copy(n).multiplyScalar(1.01);
      this.ring.lookAt(n.clone().multiplyScalar(3));
      this.ring.visible = true;
    } else this.ring.visible = false;
  }

  /** Default viewpoint: above the selected site, tilted a little toward the equator so the limb shows. */
  frame(siteId: string, cam = this.camera, dist = 5.6) {
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
    const hit = ray.intersectObjects(this.markers, false)[0];
    if (hit) return hit.object.userData.siteId as string;
    // Generous pick: nearest marker within ~0.06 of the ray, on the visible hemisphere.
    let best: string | null = null, bd = 0.06;
    for (const m of this.markers) {
      const toCam = ray.ray.origin.clone().sub(m.position);
      if (toCam.dot(m.position) <= 0) continue;
      const d = ray.ray.distanceToPoint(m.position);
      if (d < bd) { bd = d; best = m.userData.siteId; }
    }
    return best;
  }

  dispose() {
    for (const d of this.disposables) d.dispose();
    for (const a of [this.earthArrow, this.sunArrow]) a.dispose();
  }
}
