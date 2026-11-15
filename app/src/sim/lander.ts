// AI-ASSISTED: drafted with Claude (Anthropic), reviewed by the human team.
// A generic lander built from primitives with PBR materials (not a model of any real spacecraft, no branding).
// The solar array turns to face the Sun and the high-gain dish points at Earth (directions from the engine).
// A small procedural environment map is used for reflections only (diffuse image lighting is switched off in
// patchSunVis), so metal reads as metal while shadows stay black.
import * as THREE from 'three';
import { patchSunVis, type SunUniforms } from './regolith';
import { contactShadow, foilNormal, solarCells } from './textures';

const ENV_VS = `varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
// Black sky above, sunlit grey regolith below, a slightly brighter band at the horizon.
const ENV_FS = `varying vec3 vD; void main(){
  float y = vD.y;
  vec3 ground = vec3(0.30, 0.29, 0.28) * (0.65 + 0.35 * smoothstep(0.0, -0.6, y));
  vec3 c = mix(ground, vec3(0.0), smoothstep(-0.02, 0.03, y)) + vec3(0.5) * exp(-abs(y) * 40.0) * step(y, 0.0);
  gl_FragColor = vec4(c, 1.0); }`;

let envRT: THREE.WebGLRenderTarget | null = null;
/** PMREM environment for metal reflections (generated once per renderer). */
export function landerEnv(renderer: THREE.WebGLRenderer): THREE.Texture {
  if (envRT) return envRT.texture;
  const scene = new THREE.Scene();
  const geo = new THREE.SphereGeometry(10, 64, 32);
  const mat = new THREE.ShaderMaterial({ vertexShader: ENV_VS, fragmentShader: ENV_FS, side: THREE.BackSide });
  scene.add(new THREE.Mesh(geo, mat));
  const pm = new THREE.PMREMGenerator(renderer);
  envRT = pm.fromScene(scene, 0.02);
  pm.dispose(); geo.dispose(); mat.dispose();
  return envRT.texture;
}
export function disposeLanderEnv() { envRT?.dispose(); envRT = null; }

export class Lander {
  readonly group = new THREE.Group();
  private readonly panelYaw = new THREE.Group();
  private readonly panelTilt = new THREE.Group();
  private readonly dishPivot = new THREE.Group();
  private readonly disposables: { dispose(): void }[] = [];

  constructor(readonly mastM: number, u: SunUniforms, env: THREE.Texture | null) {
    const std = (p: THREE.MeshStandardMaterialParameters) => this.mat(new THREE.MeshStandardMaterial({ envMap: env, ...p }), u);
    const phys = (p: THREE.MeshPhysicalMaterialParameters) => this.mat(new THREE.MeshPhysicalMaterial({ envMap: env, ...p }), u);
    const fn = foilNormal();
    const goldMap = fn.clone(); goldMap.repeat.set(14, 5); goldMap.needsUpdate = true;
    const silverMap = fn.clone(); silverMap.repeat.set(1.4, 1.4); silverMap.needsUpdate = true;
    this.disposables.push(goldMap, silverMap);
    const gold = std({ color: new THREE.Color(1.0, 0.71, 0.29), metalness: 1, roughness: 0.4, normalMap: goldMap, normalScale: new THREE.Vector2(0.22, 0.22) });
    const silver = std({ color: new THREE.Color(0.86, 0.87, 0.89), metalness: 1, roughness: 0.3, normalMap: silverMap, normalScale: new THREE.Vector2(0.3, 0.3) });
    const blackMli = std({ color: 0x0b0b0c, metalness: 0.2, roughness: 0.55, normalMap: silverMap, normalScale: new THREE.Vector2(0.5, 0.5) });
    const alu = std({ color: new THREE.Color(0.9, 0.91, 0.92), metalness: 1, roughness: 0.34 });
    const darkAlu = std({ color: new THREE.Color(0.32, 0.33, 0.35), metalness: 1, roughness: 0.42 });
    const white = std({ color: new THREE.Color(0.82, 0.83, 0.84), metalness: 0, roughness: 0.42 });
    const nozzle = std({ color: new THREE.Color(0.2, 0.19, 0.18), metalness: 1, roughness: 0.38, side: THREE.DoubleSide });
    const lens = phys({ color: 0x050608, metalness: 0, roughness: 0.18, clearcoat: 1, clearcoatRoughness: 0.15 });
    const cellTex = solarCells();
    // Bifacial-looking array: cells on both faces, clearcoat so the sunlit ground and the Sun give it a sheen.
    const cells = phys({ map: cellTex, metalness: 0.5, roughness: 0.28, clearcoat: 1, clearcoatRoughness: 0.2, envMapIntensity: 1.6 });
    const dishMat = std({ color: new THREE.Color(0.86, 0.86, 0.85), metalness: 0, roughness: 0.48, side: THREE.FrontSide });

    const add = (g: THREE.BufferGeometry, m: THREE.Material, parent: THREE.Object3D = this.group) => {
      this.disposables.push(g);
      const mesh = new THREE.Mesh(g, m);
      mesh.castShadow = true; mesh.receiveShadow = true;
      parent.add(mesh);
      return mesh;
    };
    const strut = (a: THREE.Vector3, b: THREE.Vector3, r: number, m: THREE.Material, parent: THREE.Object3D = this.group) => {
      const len = a.distanceTo(b);
      const s = add(new THREE.CylinderGeometry(r, r, len, 10), m, parent);
      s.position.copy(a).add(b).multiplyScalar(0.5);
      s.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
      return s;
    };
    const P = (r: number, angRad: number, y: number) => new THREE.Vector3(Math.cos(angRad) * r, y, Math.sin(angRad) * r);

    // Bus: octagonal prism in gold MLI with two silver panels, black MLI skirt, white radiator deck.
    const bus = add(new THREE.CylinderGeometry(0.74, 0.74, 0.62, 8, 1), gold);
    bus.position.y = 0.94; bus.rotation.y = Math.PI / 8;
    for (const k of [1, 5]) {
      const a = (k * Math.PI) / 4;
      const pnl = add(new THREE.BoxGeometry(0.5, 0.5, 0.012), silver);
      pnl.position.copy(P(0.69, a, 0.94));
      pnl.lookAt(P(2, a, 0.94));
    }
    const skirt = add(new THREE.CylinderGeometry(0.6, 0.7, 0.16, 8, 1), blackMli);
    skirt.position.y = 0.55; skirt.rotation.y = Math.PI / 8;
    const deck = add(new THREE.CylinderGeometry(0.76, 0.76, 0.045, 8), white);
    deck.position.y = 1.275; deck.rotation.y = Math.PI / 8;
    // Propellant tank domes on the deck
    for (const k of [0, 2]) {
      const t = add(new THREE.SphereGeometry(0.2, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), silver);
      t.position.copy(P(0.36, (k * Math.PI) / 2 + Math.PI / 4, 1.29));
    }

    // Main engine bell
    const bell: THREE.Vector2[] = [];
    for (let k = 0; k <= 16; k++) { const v = k / 16; bell.push(new THREE.Vector2(0.07 + 0.17 * Math.pow(v, 0.7), -0.34 * v)); }
    const eng = add(new THREE.LatheGeometry(bell, 32), nozzle);
    eng.position.y = 0.48;

    // Four landing legs: primary strut with a shock-absorber sleeve, two secondary struts, dished footpad.
    for (let k = 0; k < 4; k++) {
      const a = Math.PI / 4 + (k * Math.PI) / 2;
      const top = P(0.66, a, 0.98), foot = P(1.5, a, 0.12);
      strut(top, foot, 0.028, alu);
      const sleeveEnd = top.clone().lerp(foot, 0.45);
      strut(top, sleeveEnd, 0.047, darkAlu);
      const knee = top.clone().lerp(foot, 0.62);
      for (const da of [-0.42, 0.42]) strut(P(0.6, a + da, 0.5), knee, 0.02, alu);
      const padProfile: THREE.Vector2[] = [new THREE.Vector2(0, 0), new THREE.Vector2(0.17, 0.004), new THREE.Vector2(0.2, 0.03), new THREE.Vector2(0.19, 0.06), new THREE.Vector2(0, 0.045)];
      const pad = add(new THREE.LatheGeometry(padProfile, 24), alu);
      pad.position.copy(foot).setY(0.005);
      const ball = add(new THREE.SphereGeometry(0.045, 12, 8), darkAlu);
      ball.position.copy(foot).setY(0.09);
    }

    // RCS thruster pods at the deck corners (box + three small nozzles each)
    for (let k = 0; k < 4; k++) {
      const a = (k * Math.PI) / 2;
      const pod = new THREE.Group();
      pod.position.copy(P(0.78, a, 1.2));
      pod.lookAt(P(3, a, 1.2));
      this.group.add(pod);
      add(new THREE.BoxGeometry(0.11, 0.09, 0.07), darkAlu, pod);
      for (const [rx, ry] of [[0, 0], [Math.PI / 2, 0], [-Math.PI / 2, 0]]) {
        const nz = add(new THREE.CylinderGeometry(0.008, 0.022, 0.05, 10, 1, true), nozzle, pod);
        nz.rotation.set(Math.PI / 2 + rx, ry, 0);
        nz.position.set(0, rx > 0 ? 0.05 : rx < 0 ? -0.05 : 0, rx === 0 ? 0.06 : 0.0);
      }
    }

    // Hazard-camera boxes on the bus sides, looking out and down
    for (const k of [0, 2, 4, 6]) {
      const a = (k * Math.PI) / 4 + Math.PI / 8;
      const box = new THREE.Group();
      box.position.copy(P(0.77, a, 0.72));
      box.lookAt(P(3, a, -0.2));
      this.group.add(box);
      add(new THREE.BoxGeometry(0.1, 0.07, 0.07), darkAlu, box);
      const l = add(new THREE.CylinderGeometry(0.018, 0.018, 0.02, 16), lens, box);
      l.rotation.x = Math.PI / 2; l.position.z = 0.04;
    }

    // Camera mast: the "Lander cam" eye sits at its top, at the horizon file's observer height.
    // The head sits just below the eye so the lander cam never looks into it.
    const mast = add(new THREE.CylinderGeometry(0.022, 0.028, mastM - 1.5, 10), alu);
    mast.position.set(0, 1.3 + (mastM - 1.5) / 2, 0);
    const head = add(new THREE.BoxGeometry(0.17, 0.1, 0.12), darkAlu);
    head.position.set(0, mastM - 0.17, 0);
    // Omni antenna whip
    const whip = add(new THREE.CylinderGeometry(0.005, 0.008, 0.45, 6), alu);
    whip.position.copy(P(0.55, Math.PI * 1.25, 1.52));

    // Solar array on a yoke beside the bus: yaw to the Sun's azimuth, tilt to its elevation.
    this.panelYaw.position.set(0, 1.3, 0);
    this.group.add(this.panelYaw);
    // Offset to local +z so the array never blocks the lander cam's view of the Sun.
    strut(new THREE.Vector3(0, 0.02, 0.35), new THREE.Vector3(0, 0.12, 0.92), 0.02, alu, this.panelYaw);
    this.panelTilt.position.set(0, 0.12, 1.42);
    this.panelYaw.add(this.panelTilt);
    const panel = add(new THREE.BoxGeometry(1.1, 0.022, 0.95), cells, this.panelTilt);
    panel.position.y = 0.012;
    const back = add(new THREE.BoxGeometry(1.1, 0.012, 0.95), cells, this.panelTilt);
    back.position.y = -0.008;
    // thin aluminium frame on all four edges
    for (const sx of [-1, 1]) {
      const rail = add(new THREE.BoxGeometry(0.025, 0.04, 0.99), alu, this.panelTilt);
      rail.position.set(sx * 0.5625, 0.002, 0);
      const end = add(new THREE.BoxGeometry(1.15, 0.04, 0.025), alu, this.panelTilt);
      end.position.set(0, 0.002, sx * 0.4875);
    }

    // High-gain dish on a gimbal at the deck edge, pointed at Earth; kept low so it stays out of the mast view.
    const gpost = add(new THREE.CylinderGeometry(0.03, 0.035, 0.22, 10), darkAlu);
    gpost.position.set(-0.42, 1.39, 0.3);
    this.dishPivot.position.set(-0.42, 1.52, 0.3);
    this.group.add(this.dishPivot);
    const pts: THREE.Vector2[] = [];
    for (let k = 0; k <= 16; k++) { const r = (k / 16) * 0.32; pts.push(new THREE.Vector2(r, (r * r) / 0.9)); }
    const dish = add(new THREE.LatheGeometry(pts, 40), dishMat, this.dishPivot);
    dish.rotation.x = Math.PI / 2; // lathe axis (+y) → +z, so the dish looks along +z
    dish.position.z = -0.06;
    const backPts = pts.map((p) => new THREE.Vector2(p.x, p.y - 0.006)).reverse();
    const dback = add(new THREE.LatheGeometry(backPts, 40), alu, this.dishPivot);
    dback.rotation.x = Math.PI / 2; dback.position.z = -0.06;
    const focus = new THREE.Vector3(0, 0, -0.06 + 0.225);
    for (let k = 0; k < 3; k++) {
      const a = (k * 2 * Math.PI) / 3;
      strut(new THREE.Vector3(Math.cos(a) * 0.31, Math.sin(a) * 0.31, -0.06 + 0.107), focus, 0.004, alu, this.dishPivot);
    }
    const feed = add(new THREE.CylinderGeometry(0.02, 0.03, 0.06, 12), darkAlu, this.dishPivot);
    feed.rotation.x = Math.PI / 2; feed.position.copy(focus);

    // Soft contact shadow under the lander (only visible where the ground is lit).
    const cs = new THREE.MeshBasicMaterial({ map: contactShadow(), color: 0x000000, transparent: true, opacity: 0.55, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    const cg = new THREE.PlaneGeometry(4.2, 4.2);
    const decal = new THREE.Mesh(cg, cs);
    decal.rotation.x = -Math.PI / 2; decal.position.y = 0.012; decal.renderOrder = 1;
    this.group.add(decal);
    this.disposables.push(cs, cg);
  }

  private mat<T extends THREE.Material>(m: T, u: SunUniforms): T { patchSunVis(m, u); this.disposables.push(m); return m; }

  /** dirs are unit vectors in scene coordinates (y up, north = −z). */
  point(sun: THREE.Vector3, earth: THREE.Vector3) {
    const az = Math.atan2(sun.x, -sun.z); // clockwise from north
    this.panelYaw.rotation.y = -az + Math.PI / 2; // local +x → the Sun's azimuth
    const el = Math.asin(Math.max(-1, Math.min(1, sun.y)));
    this.panelTilt.rotation.z = -(Math.PI / 2 - Math.max(0, el)); // normal from +y down toward +x by (90° − el)
    const target = earth.clone().multiplyScalar(10).add(this.dishPivot.getWorldPosition(new THREE.Vector3()));
    this.dishPivot.lookAt(target);
  }

  dispose() {
    for (const d of this.disposables) d.dispose();
    this.group.removeFromParent();
  }
}
