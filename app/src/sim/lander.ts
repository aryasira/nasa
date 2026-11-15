// AI-ASSISTED: drafted with Claude (Anthropic), reviewed by the human team.
// A generic, stylised lander built from primitives (not a model of any real spacecraft).
// The solar panel turns to face the Sun and the dish points at Earth (directions from the engine).
import * as THREE from 'three';

export class Lander {
  readonly group = new THREE.Group();
  private readonly panelYaw = new THREE.Group();
  private readonly panelTilt = new THREE.Group();
  private readonly dishPivot = new THREE.Group();
  private readonly disposables: { dispose(): void }[] = [];

  constructor(readonly mastM: number) {
    const foil = this.mat(new THREE.MeshStandardMaterial({ color: 0xc9a24a, metalness: 0.25, roughness: 0.45, emissive: 0x080602 }));
    const white = this.mat(new THREE.MeshStandardMaterial({ color: 0xd9dde2, metalness: 0.1, roughness: 0.6 }));
    const dark = this.mat(new THREE.MeshStandardMaterial({ color: 0x2a2f36, metalness: 0.4, roughness: 0.5 }));
    const cells = this.mat(new THREE.MeshStandardMaterial({ color: 0x1b2f5a, metalness: 0.3, roughness: 0.3, emissive: 0x050a18 }));
    const add = (g: THREE.BufferGeometry, m: THREE.Material, parent: THREE.Object3D = this.group) => {
      this.disposables.push(g);
      const mesh = new THREE.Mesh(g, m);
      mesh.castShadow = true; mesh.receiveShadow = true;
      parent.add(mesh);
      return mesh;
    };

    // Body: an octagonal prism with a white top deck.
    const body = add(new THREE.CylinderGeometry(0.62, 0.7, 0.62, 8), foil);
    body.position.y = 0.78;
    const deck = add(new THREE.CylinderGeometry(0.64, 0.64, 0.06, 8), white);
    deck.position.y = 1.12;
    const engine = add(new THREE.CylinderGeometry(0.12, 0.24, 0.28, 16, 1, true), dark);
    engine.position.y = 0.36;

    // Four legs with footpads.
    for (let k = 0; k < 4; k++) {
      const a = Math.PI / 4 + (k * Math.PI) / 2;
      const top = new THREE.Vector3(Math.cos(a) * 0.55, 0.75, Math.sin(a) * 0.55);
      const foot = new THREE.Vector3(Math.cos(a) * 1.15, 0.06, Math.sin(a) * 1.15);
      const len = top.distanceTo(foot);
      const leg = add(new THREE.CylinderGeometry(0.035, 0.035, len, 8), white);
      leg.position.copy(top).add(foot).multiplyScalar(0.5);
      leg.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), foot.clone().sub(top).normalize());
      const pad = add(new THREE.CylinderGeometry(0.14, 0.16, 0.05, 16), white);
      pad.position.copy(foot).setY(0.03);
    }

    // Mast with the camera head: the "Lander cam" eye sits at the top, at the horizon file's observer height.
    const mast = add(new THREE.CylinderGeometry(0.03, 0.03, mastM - 1.15, 8), white);
    mast.position.set(0, 1.15 + (mastM - 1.15) / 2 - 0.05, 0);
    const head = add(new THREE.BoxGeometry(0.16, 0.1, 0.12), dark);
    head.position.set(0, mastM - 0.1, 0);

    // Solar panel on a yoke beside the body: yaw to the Sun's azimuth, tilt to its elevation.
    this.panelYaw.position.set(0, 1.15, 0);
    this.group.add(this.panelYaw);
    // The panel sits off to the side of the Sun line (local +z) so it never blocks the lander cam's view of the Sun.
    const arm = add(new THREE.CylinderGeometry(0.025, 0.025, 0.95, 8), white, this.panelYaw);
    arm.rotation.x = Math.PI / 2; arm.position.set(0, 0.1, 0.5);
    this.panelTilt.position.set(0, 0.1, 1.25);
    this.panelYaw.add(this.panelTilt);
    const panel = add(new THREE.BoxGeometry(0.9, 0.035, 1.1), cells, this.panelTilt);
    const frame = add(new THREE.BoxGeometry(0.94, 0.02, 1.14), white, this.panelTilt);
    frame.position.y = -0.025;
    panel.position.y = 0;

    // Dish antenna on its own short mast, pointed at Earth.
    // Kept low on the deck edge so it stays out of the mast camera's view of the horizon.
    const dmast = add(new THREE.CylinderGeometry(0.025, 0.025, 0.2, 8), white);
    dmast.position.set(-0.4, 1.25, 0.28);
    this.dishPivot.position.set(-0.4, 1.36, 0.28);
    this.group.add(this.dishPivot);
    const pts: THREE.Vector2[] = [];
    for (let k = 0; k <= 12; k++) { const r = (k / 12) * 0.28; pts.push(new THREE.Vector2(r, (r * r) / 0.5)); }
    const dish = add(new THREE.LatheGeometry(pts, 28), this.mat(new THREE.MeshStandardMaterial({ color: 0xe8eaed, roughness: 0.5, side: THREE.DoubleSide })), this.dishPivot);
    dish.rotation.x = Math.PI / 2; // lathe axis (+y) → +z, so the dish looks along +z
    dish.position.z = -0.05;
    const feed = add(new THREE.CylinderGeometry(0.008, 0.008, 0.26, 6), dark, this.dishPivot);
    feed.rotation.x = Math.PI / 2; feed.position.z = 0.1;
  }

  private mat<T extends THREE.Material>(m: T): T { this.disposables.push(m); return m; }

  /** dirs are unit vectors in scene coordinates (y up, north = −z). */
  point(sun: THREE.Vector3, earth: THREE.Vector3) {
    // Panel: yoke turns about +y so its local +x points along the Sun's horizontal direction... then the panel
    // tilts about the yoke's local z so its normal (+y) faces the Sun.
    const az = Math.atan2(sun.x, -sun.z); // clockwise from north
    this.panelYaw.rotation.y = -az + Math.PI / 2; // local +x → the Sun's azimuth
    const el = Math.asin(Math.max(-1, Math.min(1, sun.y)));
    this.panelTilt.rotation.z = -(Math.PI / 2 - Math.max(0, el)); // normal from +y down toward +x by (90° − el)
    // Dish: look at Earth (Object3D.lookAt points the local +z axis for non-cameras).
    const target = earth.clone().multiplyScalar(10).add(this.dishPivot.getWorldPosition(new THREE.Vector3()));
    this.dishPivot.lookAt(target);
  }

  dispose() {
    for (const d of this.disposables) d.dispose();
    this.group.removeFromParent();
  }
}
