// AI-ASSISTED: drafted with Claude (Anthropic), reviewed by the human team.
// Sky objects: Sun disc + glow, Earth with phase lighting, starfield. All procedural.
// Angular sizes come from the engine (sunR, earthR) times the user's "body size ×N" factor.
import * as THREE from 'three';

export const SKY_R = 90_000; // m; terrain skyline is clamped to 20 km so the sky is always behind it

function glowTexture(inner: string, outer: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, inner); grd.addColorStop(0.18, inner); grd.addColorStop(0.4, outer); grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const EARTH_VS = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec3 vN; varying vec3 vP;
void main() {
  vN = normalize(mat3(modelMatrix) * normal);
  vP = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  #include <logdepthbuf_vertex>
}`;
// Illustrative surface pattern (not real geography); lit from the true Sun direction, so the phase is real.
const EARTH_FS = /* glsl */ `
#include <logdepthbuf_pars_fragment>
uniform vec3 sunDir; uniform vec3 viewDir;
varying vec3 vN; varying vec3 vP;
float h(vec3 p){ return fract(sin(dot(p, vec3(12.9898,78.233,45.164))) * 43758.5453); }
float noise(vec3 p){ vec3 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(mix(h(i),h(i+vec3(1,0,0)),f.x),mix(h(i+vec3(0,1,0)),h(i+vec3(1,1,0)),f.x),f.y),
             mix(mix(h(i+vec3(0,0,1)),h(i+vec3(1,0,1)),f.x),mix(h(i+vec3(0,1,1)),h(i+vec3(1,1,1)),f.x),f.y),f.z); }
float fbm(vec3 p){ float a=0.5, s=0.0; for(int k=0;k<5;k++){ s+=a*noise(p); p*=2.03; a*=0.5; } return s; }
void main(){
  #include <logdepthbuf_fragment>
  vec3 n = normalize(vN); vec3 q = normalize(vP);
  float land = smoothstep(0.52, 0.56, fbm(q*2.2 + 3.1));
  float cloud = smoothstep(0.5, 0.75, fbm(q*3.5 + vec3(7.0, 1.3, 2.2)));
  float ice = smoothstep(0.82, 0.9, abs(q.y));
  vec3 col = mix(vec3(0.05,0.2,0.48), vec3(0.32,0.38,0.24), land);
  col = mix(col, vec3(0.92), max(cloud*0.85, ice));
  float l = dot(n, normalize(sunDir));
  float day = smoothstep(-0.08, 0.2, l);
  float rim = pow(1.0 - max(0.0, dot(n, normalize(viewDir))), 3.0);
  vec3 c = col * (0.04 + 1.1 * day) + vec3(0.34,0.7,0.91) * rim * (0.15 + 0.85 * day);
  gl_FragColor = vec4(c, 1.0);
  #include <colorspace_fragment>
}`;

export class Sky {
  readonly group = new THREE.Group(); // follows the camera position, so directions are exact from any viewpoint
  readonly sun: THREE.Mesh;
  readonly earth: THREE.Mesh;
  private readonly sunGlow: THREE.Sprite;
  private readonly earthMat: THREE.ShaderMaterial;
  private readonly stars: THREE.Points;
  private readonly disposables: { dispose(): void }[] = [];

  constructor() {
    const sphere = new THREE.SphereGeometry(1, 48, 32);
    const sunMat = new THREE.MeshBasicMaterial({ color: 0xfff4dc, toneMapped: false });
    this.sun = new THREE.Mesh(sphere, sunMat);
    const tex = glowTexture('rgba(255,236,200,0.95)', 'rgba(230,159,0,0.22)');
    const glowMat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
    this.sunGlow = new THREE.Sprite(glowMat);
    this.earthMat = new THREE.ShaderMaterial({
      vertexShader: EARTH_VS, fragmentShader: EARTH_FS,
      uniforms: { sunDir: { value: new THREE.Vector3(0, 1, 0) }, viewDir: { value: new THREE.Vector3(0, 0, 1) } },
    });
    this.earth = new THREE.Mesh(sphere, this.earthMat);
    this.earth.rotation.z = 0.41; // a tilt, for looks only
    // Stars: fixed random directions (illustrative, not a catalogue).
    const N = 2600, p = new Float32Array(N * 3), c = new Float32Array(N * 3);
    let s = 1234567;
    const r = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    for (let i = 0; i < N; i++) {
      const z = 2 * r() - 1, a = 2 * Math.PI * r(), q = Math.sqrt(1 - z * z);
      p.set([q * Math.cos(a) * SKY_R * 1.05, z * SKY_R * 1.05, q * Math.sin(a) * SKY_R * 1.05], i * 3);
      const b = 0.35 + 0.65 * Math.pow(r(), 3);
      c.set([b, b, b * (0.9 + 0.2 * r())], i * 3);
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(p, 3));
    sg.setAttribute('color', new THREE.BufferAttribute(c, 3));
    const sm = new THREE.PointsMaterial({ size: 1.6, sizeAttenuation: false, vertexColors: true, transparent: true, opacity: 0, depthWrite: false });
    this.stars = new THREE.Points(sg, sm);
    this.group.add(this.stars, this.sun, this.sunGlow, this.earth);
    this.disposables.push(sphere, sunMat, tex, glowMat, this.earthMat, sg, sm);
  }

  /**
   * sunDir/earthDir: unit vectors (scene). Radii in degrees (engine), scale = body size factor.
   * starAlpha: 0..1 (stars are only drawn when the Sun is hidden, as a camera exposed for the dark would see them).
   */
  update(sunDir: THREE.Vector3, sunRDeg: number, earthDir: THREE.Vector3, earthRDeg: number, scale: number, starAlpha: number, cam: THREE.Camera,
    sunShown = true, earthShown = true) {
    // A body the engine says is hidden is not drawn at all, so an enlarged disc never peeks over a ridge
    // and contradicts the readout (its true position is still labelled).
    this.sun.visible = this.sunGlow.visible = sunShown;
    this.earth.visible = earthShown;
    const place = (m: THREE.Object3D, d: THREE.Vector3, rDeg: number) => {
      m.position.copy(d).multiplyScalar(SKY_R);
      const rad = SKY_R * Math.tan((rDeg * scale * Math.PI) / 180);
      m.scale.setScalar(rad);
    };
    place(this.sun, sunDir, sunRDeg);
    this.sunGlow.position.copy(this.sun.position);
    this.sunGlow.scale.setScalar(this.sun.scale.x * 7);
    place(this.earth, earthDir, earthRDeg);
    (this.earthMat.uniforms.sunDir.value as THREE.Vector3).copy(sunDir);
    (this.earthMat.uniforms.viewDir.value as THREE.Vector3).copy(earthDir).multiplyScalar(-1);
    (this.stars.material as THREE.PointsMaterial).opacity = starAlpha;
    this.stars.visible = starAlpha > 0.01;
    this.group.position.copy(cam.position);
  }

  dispose() { for (const d of this.disposables) d.dispose(); }
}
