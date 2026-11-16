// AI-assisted; see README.
// Post-processing: HDR scene → restrained bloom (only the Sun disc is bright enough) → ACES tone mapping + sRGB.
// Multisampled half-float target for antialiasing. Bloom can be switched off when frames are slow.
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

export class Post {
  readonly composer: EffectComposer;
  private readonly pass: RenderPass;
  private readonly bloom: UnrealBloomPass;
  private readonly target: THREE.WebGLRenderTarget;

  constructor(private readonly r: THREE.WebGLRenderer, samples: number) {
    this.target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples });
    this.composer = new EffectComposer(r, this.target);
    this.pass = new RenderPass(new THREE.Scene(), new THREE.PerspectiveCamera());
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.55, 0.55, 2.2);
    this.composer.addPass(this.pass);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
  }

  setSize(w: number, h: number) {
    this.composer.setPixelRatio(this.r.getPixelRatio());
    this.composer.setSize(w, h);
  }

  set bloomOn(v: boolean) { this.bloom.enabled = v; }
  get bloomOn() { return this.bloom.enabled; }

  render(scene: THREE.Scene, cam: THREE.Camera) {
    this.pass.scene = scene;
    this.pass.camera = cam;
    this.composer.render();
  }

  dispose() {
    this.bloom.dispose();
    this.composer.dispose();
    this.target.dispose();
  }
}
