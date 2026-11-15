// AI-ASSISTED: drafted with Claude (Anthropic), reviewed by the human team.
// Sky objects: the Sun (HDR disc for bloom + subtle lens glare), a procedural Earth, and an illustrative star
// field with a faint Milky Way band. Space is black: no fog, no sky colour.
// Directions and angular sizes come from the engine (az, el, sunR, earthR). Everything is in the OPAQUE pass (even
// the additive stars) with low renderOrder and depth test off, so it is drawn first and terrain occludes it exactly;
// the Earth draws over the Sun (it is always nearer).
import * as THREE from 'three';
import { glareTexture } from './textures';

export const SKY_R = 90_000; // m; the drawn skyline is clamped to 20 km, so the sky is always behind it

// ---------------------------------------------------------------- Earth
const EARTH_VS = /* glsl */ `
varying vec3 vN; varying vec3 vP;
void main() {
  vN = normalize(mat3(modelMatrix) * normal);
  vP = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
// Illustrative surface (domain-warped noise, NOT a map of Earth), lit from the true Sun direction so the phase is real.
const EARTH_FS = /* glsl */ `
uniform vec3 sunDir; uniform vec3 viewDir; uniform float spin; uniform float gain;
varying vec3 vN; varying vec3 vP;
float h(vec3 p){ return fract(sin(dot(p, vec3(12.9898,78.233,45.164))) * 43758.5453); }
float noise(vec3 p){ vec3 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(mix(h(i),h(i+vec3(1,0,0)),f.x),mix(h(i+vec3(0,1,0)),h(i+vec3(1,1,0)),f.x),f.y),
             mix(mix(h(i+vec3(0,0,1)),h(i+vec3(1,0,1)),f.x),mix(h(i+vec3(0,1,1)),h(i+vec3(1,1,1)),f.x),f.y),f.z); }
float fbm(vec3 p){ float a=0.5, s=0.0; for(int k=0;k<6;k++){ s+=a*noise(p); p=p*2.02+0.7; a*=0.5; } return s; }
vec3 rotY(vec3 p, float a){ float c=cos(a), s=sin(a); return vec3(c*p.x+s*p.z, p.y, -s*p.x+c*p.z); }
void main(){
  vec3 n = normalize(vN);
  vec3 q = rotY(normalize(vP), spin);
  vec3 w = q * 1.7 + 0.55 * vec3(fbm(q*1.9+1.7), fbm(q*1.9+9.2), fbm(q*1.9+3.3));
  float c = fbm(w * 1.25);
  float land = smoothstep(0.515, 0.545, c);
  float lat = abs(q.y);
  float dry = smoothstep(0.45, 0.62, fbm(w * 2.7 + 5.0)) * (1.0 - smoothstep(0.25, 0.55, abs(lat - 0.33)));
  vec3 ocean = mix(vec3(0.004, 0.018, 0.07), vec3(0.01, 0.05, 0.12), smoothstep(0.4, 0.52, c));
  vec3 ground = mix(vec3(0.035, 0.06, 0.025), vec3(0.2, 0.15, 0.08), dry);
  vec3 col = mix(ocean, ground, land);
  float ice = smoothstep(0.80, 0.86, lat + 0.05 * fbm(q * 9.0));
  col = mix(col, vec3(0.7), ice);
  // clouds: swirled bands, drifting at their own rate
  vec3 cq = rotY(normalize(vP), spin * 0.93 + 0.8);
  vec3 cw = cq * 3.0 + 0.9 * vec3(fbm(cq*2.5+4.0), fbm(cq*2.5+1.0), fbm(cq*2.5+7.0));
  float cloud = smoothstep(0.5, 0.78, fbm(cw * 1.6)) * (0.55 + 0.45 * smoothstep(0.1, 0.5, abs(cq.y)));
  col = mix(col, vec3(0.78), cloud * 0.92);
  vec3 L = normalize(sunDir), V = normalize(viewDir);
  float nl = dot(n, L);
  float day = smoothstep(-0.06, 0.22, nl);
  float diff = max(nl, 0.0) * 0.85 + 0.15 * day;
  // ocean sun glint
  vec3 H = normalize(L + V);
  float glint = pow(max(dot(n, H), 0.0), 70.0) * (1.0 - land) * (1.0 - cloud) * (1.0 - ice) * step(0.0, nl) * 2.5;
  // thin atmosphere: fresnel rim, blue on the day side, reddened at the terminator
  float fres = pow(1.0 - max(dot(n, V), 0.0), 3.0);
  vec3 atmo = mix(vec3(0.9, 0.35, 0.12), vec3(0.22, 0.5, 1.0), smoothstep(-0.05, 0.3, nl)) * fres * smoothstep(-0.25, 0.25, nl);
  vec3 c3 = col * diff + vec3(1.0, 0.95, 0.85) * glint + atmo * 0.9;
  gl_FragColor = vec4(c3 * gain, 1.0);
}`;

// ---------------------------------------------------------------- stars
const STAR_VS = /* glsl */ `
attribute float flux; attribute vec3 tint;
uniform float alpha; uniform float px;
varying vec3 vC; varying float vA;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  float f = flux * alpha;
  gl_PointSize = clamp(1.1 + 2.6 * sqrt(f), 1.0, 4.5) * px;
  vC = tint; vA = min(1.0, f * 1.6 + 0.04 * alpha);
}`;
const STAR_FS = /* glsl */ `
varying vec3 vC; varying float vA;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float r = length(d) * 2.0;
  float a = exp(-r * r * 3.5) * vA;
  if (a < 0.003) discard;
  gl_FragColor = vec4(vC * a * 1.6, 1.0);
}`;
const MW_FS = /* glsl */ `
uniform float alpha; uniform vec3 pole;
varying vec3 vP;
float h(vec3 p){ return fract(sin(dot(p, vec3(12.9898,78.233,45.164))) * 43758.5453); }
float noise(vec3 p){ vec3 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(mix(h(i),h(i+vec3(1,0,0)),f.x),mix(h(i+vec3(0,1,0)),h(i+vec3(1,1,0)),f.x),f.y),
             mix(mix(h(i+vec3(0,0,1)),h(i+vec3(1,0,1)),f.x),mix(h(i+vec3(0,1,1)),h(i+vec3(1,1,1)),f.x),f.y),f.z); }
float fbm(vec3 p){ float a=0.5, s=0.0; for(int k=0;k<5;k++){ s+=a*noise(p); p=p*2.1+1.3; a*=0.5; } return s; }
void main() {
  vec3 d = normalize(vP);
  float b = dot(d, pole);
  float band = exp(-b * b / 0.022) + 0.35 * exp(-b * b / 0.12);
  float cloud = fbm(d * 7.0);
  float dust = smoothstep(0.45, 0.7, fbm(d * 11.0 + 3.0)) * exp(-b * b / 0.004);
  float v = band * (0.45 + 0.75 * cloud) * (1.0 - 0.75 * dust);
  gl_FragColor = vec4(vec3(0.75, 0.78, 0.9) * v * 0.022 * alpha, 1.0);
}`;
const MW_VS = /* glsl */ `varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

/** Illustrative star field (not a catalogue): magnitude-limited counts ~10^(0.5 m), colour by a random temperature. */
export class Stars {
  readonly group = new THREE.Group();
  private readonly mat: THREE.ShaderMaterial;
  private readonly mwMat: THREE.ShaderMaterial;
  private readonly disposables: { dispose(): void }[] = [];
  constructor(radius = SKY_R * 1.02) {
    const N = 7000;
    const p = new Float32Array(N * 3), fx = new Float32Array(N), tint = new Float32Array(N * 3);
    let s = 1234567;
    const r = () => ((s = (Math.imul(s, 1103515245) + 12345) & 0x7fffffff) / 0x7fffffff);
    const pole = new THREE.Vector3(0.32, 0.55, -0.77).normalize();
    const tmp = new THREE.Vector3();
    const mMax = 6.5, mMin = -1;
    for (let i = 0; i < N; i++) {
      // concentrate a third of the stars toward the galactic band
      const z = 2 * r() - 1, a = 2 * Math.PI * r();
      const q = Math.sqrt(1 - z * z);
      tmp.set(q * Math.cos(a), z, q * Math.sin(a));
      if (i % 3 === 0) {
        const b = tmp.dot(pole);
        tmp.addScaledVector(pole, -b * 0.75).normalize();
      }
      p.set([tmp.x * radius, tmp.y * radius, tmp.z * radius], i * 3);
      // inverse CDF of N(<m) ∝ 10^(0.5 m) between mMin and mMax
      const u = r();
      const m = 2 * Math.log10(Math.pow(10, 0.5 * mMin) + u * (Math.pow(10, 0.5 * mMax) - Math.pow(10, 0.5 * mMin)));
      fx[i] = Math.pow(10, -0.4 * (m - 1.0));
      const t = r();
      const c = t < 0.12 ? [0.75, 0.83, 1.0] : t < 0.6 ? [1.0, 0.98, 0.95] : t < 0.85 ? [1.0, 0.9, 0.75] : [1.0, 0.78, 0.6];
      tint.set(c, i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(p, 3));
    g.setAttribute('flux', new THREE.BufferAttribute(fx, 1));
    g.setAttribute('tint', new THREE.BufferAttribute(tint, 3));
    this.mat = new THREE.ShaderMaterial({ vertexShader: STAR_VS, fragmentShader: STAR_FS, uniforms: { alpha: { value: 0 }, px: { value: 1 } },
      transparent: false, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending });
    const pts = new THREE.Points(g, this.mat);
    pts.frustumCulled = false; pts.renderOrder = -19;
    const sg = new THREE.SphereGeometry(radius * 1.01, 48, 24);
    this.mwMat = new THREE.ShaderMaterial({ vertexShader: MW_VS, fragmentShader: MW_FS, side: THREE.BackSide,
      uniforms: { alpha: { value: 0 }, pole: { value: pole } }, depthTest: false, depthWrite: false, transparent: false, blending: THREE.AdditiveBlending });
    const mw = new THREE.Mesh(sg, this.mwMat);
    mw.frustumCulled = false; mw.renderOrder = -20;
    this.group.add(mw, pts);
    this.disposables.push(g, this.mat, sg, this.mwMat);
  }
  set(alpha: number, pixelRatio: number) {
    this.mat.uniforms.alpha.value = alpha;
    this.mat.uniforms.px.value = pixelRatio;
    this.mwMat.uniforms.alpha.value = alpha;
    this.group.visible = alpha > 0.005;
  }
  dispose() { for (const d of this.disposables) d.dispose(); }
}

export class Sky {
  readonly group = new THREE.Group(); // follows the camera position, so directions are exact from any viewpoint
  readonly sun: THREE.Mesh;
  readonly earth: THREE.Mesh;
  readonly stars = new Stars();
  private readonly glare: THREE.Sprite;
  private readonly glareMat: THREE.SpriteMaterial;
  private readonly earthMat: THREE.ShaderMaterial;
  private readonly disposables: { dispose(): void }[] = [];

  constructor() {
    const sphere = new THREE.SphereGeometry(1, 64, 32);
    const sunMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.96, 0.9).multiplyScalar(14), depthTest: false, depthWrite: false });
    this.sun = new THREE.Mesh(sphere, sunMat);
    this.sun.renderOrder = -12;
    this.glareMat = new THREE.SpriteMaterial({ map: glareTexture(), transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending });
    this.glare = new THREE.Sprite(this.glareMat);
    this.glare.renderOrder = 10;
    this.earthMat = new THREE.ShaderMaterial({
      vertexShader: EARTH_VS, fragmentShader: EARTH_FS, depthTest: false, depthWrite: false,
      uniforms: { sunDir: { value: new THREE.Vector3(0, 1, 0) }, viewDir: { value: new THREE.Vector3(0, 0, 1) }, spin: { value: 0 }, gain: { value: 3.2 } },
    });
    this.earth = new THREE.Mesh(sphere, this.earthMat);
    this.earth.renderOrder = -11;
    this.earth.rotation.z = 0.41; // a tilt, for looks only
    this.group.add(this.stars.group, this.sun, this.earth, this.glare);
    this.disposables.push(sphere, sunMat, this.glareMat, this.earthMat);
  }

  /**
   * sunDir/earthDir: unit vectors (scene). Radii in degrees (engine), scale = body size factor.
   * starAlpha 0..1, glare 0..1 (how much of the Sun is in view), tSec: simulation time (Earth's spin, illustrative).
   */
  update(o: { sunDir: THREE.Vector3; sunRDeg: number; earthDir: THREE.Vector3; earthRDeg: number; scale: number; starAlpha: number;
    glare: number; cam: THREE.Camera; sunShown: boolean; earthShown: boolean; tSec: number; pixelRatio: number }) {
    // A body the engine says is hidden is not drawn at all, so an enlarged disc never peeks over a ridge
    // and contradicts the readout (its true position is still marked).
    this.sun.visible = o.sunShown;
    this.earth.visible = o.earthShown;
    const place = (m: THREE.Object3D, d: THREE.Vector3, rDeg: number) => {
      m.position.copy(d).multiplyScalar(SKY_R);
      m.scale.setScalar(SKY_R * Math.tan((rDeg * o.scale * Math.PI) / 180));
    };
    place(this.sun, o.sunDir, o.sunRDeg);
    place(this.earth, o.earthDir, o.earthRDeg);
    this.glare.visible = o.sunShown && o.glare > 0.01;
    this.glare.position.copy(this.sun.position);
    this.glare.scale.setScalar(SKY_R * Math.tan((9 * Math.PI) / 180) * (0.7 + 0.3 * Math.sqrt(o.scale)));
    this.glareMat.opacity = 0.85 * o.glare;
    (this.earthMat.uniforms.sunDir.value as THREE.Vector3).copy(o.sunDir);
    (this.earthMat.uniforms.viewDir.value as THREE.Vector3).copy(o.earthDir).multiplyScalar(-1);
    this.earthMat.uniforms.spin.value = ((o.tSec / 86164.1) % 1) * Math.PI * 2;
    this.stars.set(o.starAlpha, o.pixelRatio);
    this.group.position.copy(o.cam.position);
  }

  dispose() { for (const d of this.disposables) d.dispose(); this.stars.dispose(); }
}
