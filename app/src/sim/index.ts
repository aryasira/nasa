// AI-ASSISTED: drafted with Claude (Anthropic), reviewed by the human team.
// 3D mission simulator (hero of the page). Mounted by a small hook in main.ts; state (site, baseline date,
// stay, slip, mode) stays in main.ts's permalink state, the sim only adds view parameters
// (cam, simt, ab, size, compass, q) to the query string. All Sun/Earth numbers come from the engine's observe().
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { FeaturesFile, HorizonFile, Site } from '@contracts/types';
import type { Ephem } from '../engine/ephem';
import { fmtUtc, parseUtc } from '../engine/ephem';
import { siteFrame, type SiteFrame } from '../engine/geometry';
import { scanWindow, type Scan } from '../engine/metrics';
import { compass } from '../engine/causes';
import type { Mode } from '../engine/visibility';
import { dirFromAzEl, featureIndex, fmtMet, readout, type BodyReadout, type FeatureIndex, type Readout } from './astro';
import { az3, blockerName, causeLine, commWord, deg2, distText, esc, featuresContaining, powerWord } from './cause';
import { Terrain } from './terrain';
import { Lander, disposeLanderEnv, landerEnv } from './lander';
import { Sky, SKY_R } from './sky';
import { Globe } from './globe';
import { Post } from './post';
import { makeSunUniforms } from './regolith';
import { disposeTextures } from './textures';
import { CAMS, CONSOLE_HTML, ICON, OVERLAY_HTML, STATUS_HTML } from './ui';
import './sim.css';
// --- FEATURE (C): countdowns and geometry-only power factors, see src/features/
import { CountdownCache, countdownText, type CountdownText } from '../features/countdown';
import { powerGeometry } from '../features/power';
import { SPHERE_NOTE } from '../features/custom';

export interface SimState { site: string; t: string; stay: number; slip: number; mode: Mode }
export interface SimContext {
  ephem: Ephem;
  sites: Site[];
  horizons: Map<string, HorizonFile>;
  features: FeaturesFile | null;
  mock: boolean;
  state: SimState;
  /** Writes into the page's single source of truth (main.ts state + permalink) and re-renders the page. */
  setState: (patch: Partial<Pick<SimState, 'site' | 'slip'>>) => void;
}

type Cam = 'lander' | 'orbit' | 'globe';
type AB = 'a' | 'b';
const DAY = 86400, HOUR = 3600;
const SUN_LUX = 6.0; // directional light intensity for the Sun (scene units, tuned with the exposure)
// Captured at import time: main.ts rewrites the query string on every render and keeps only its own keys.
const INITIAL = new URLSearchParams(typeof location === 'undefined' ? '' : location.search);
const REDUCED = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const v3 = (a: [number, number, number]) => new THREE.Vector3(a[0], a[1], a[2]);
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const utcMin = (t: number) => fmtUtc(t).slice(0, 16) + 'Z';
const ease = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const wrap180 = (d: number) => ((d + 540) % 360) - 180;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', html = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
}

interface Pose { pos: THREE.Vector3; quat: THREE.Quaternion; fov: number }

class Simulator {
  readonly root = el('section', 'sim');
  private ctx!: SimContext;
  private site!: Site;
  private hz!: HorizonFile;
  private frameF!: SiteFrame;
  private feats: FeatureIndex = new Map();
  private local = new Set<string>();
  private siteKey = '';
  // time
  private t = 0;
  private ab: AB = (INITIAL.get('ab') === 'b' ? 'b' : 'a');
  private playing = !REDUCED && !INITIAL.has('simt');
  private speed = 21600;
  private slipPreview: number | null = null;
  private keepMet: number | null = null; // mission-elapsed time to restore after a commit re-renders the page
  private cam: Cam = (['lander', 'orbit', 'globe'] as const).find((c) => c === INITIAL.get('cam')) ?? 'lander';
  private size = INITIAL.has('size') && Number(INITIAL.get('size')) > 1 ? 6 : 1;
  private showCompass = INITIAL.get('compass') !== '0';
  private pendingSimT: number | null = INITIAL.has('simt') ? (() => { try { return parseUtc(INITIAL.get('simt')!); } catch { return null; } })() : null;
  private ro: Readout | null = null;
  private scan: Scan | null = null;
  // three
  private renderer: THREE.WebGLRenderer | null = null;
  private post: Post | null = null;
  private scene = new THREE.Scene();
  private camLander = new THREE.PerspectiveCamera(70, 1, 0.05, 400_000);
  private camOrbit = new THREE.PerspectiveCamera(50, 1, 0.1, 400_000);
  private camView = new THREE.PerspectiveCamera(60, 1, 0.05, 400_000);
  private orbit: OrbitControls | null = null;
  private globeCtl: OrbitControls | null = null;
  private sunLight = new THREE.DirectionalLight(0xfff4e6, 0);
  private earthLight = new THREE.DirectionalLight(0xa9c8ff, 0);
  private uni = makeSunUniforms();
  private env: THREE.Texture | null = null;
  private terrain: Terrain | null = null;
  private lander: Lander | null = null;
  private sky: Sky | null = null;
  private globe: Globe | null = null;
  private yaw = 0;
  private pitch = 4;
  private lookTween: { y0: number; p0: number; y1: number; p1: number; t0: number } | null = null;
  private camTween: { from: Pose; t0: number; dur: number } | null = null;
  private globeTween: { d0: number; d1: number; t0: number } | null = null;
  private exposure = -1;
  private quality = INITIAL.get('q') === 'low' ? 0 : 2;
  private qLocked = INITIAL.has('q');
  private frameTimes: number[] = [];
  private raf = 0;
  private last = 0;
  private dirty = true;
  private onScreen = true;
  private lastHud = 0;
  private lastLive = 0;
  private lastUrl = 0;
  private liveText = '';
  private textCache = new WeakMap<Element, string>();
  private cd = new CountdownCache();
  private cdText: { sun: CountdownText | null; earth: CountdownText | null } = { sun: null, earth: null };
  private globeSig = '';
  // DOM
  private stage = el('div', 'sim-stage');
  private view = el('div', 'sim-view');
  private canvas = el('canvas', 'sim-canvas');
  private compassC = el('canvas', 'sim-compass');
  private labels = el('div', 'sim-labels');
  private pinsEl = el('div', 'sim-pins');
  private status = el('div', 'sim-status', STATUS_HTML);
  private cause = el('div', 'sim-cause', '<span class="dot" aria-hidden="true"></span><p data-f="cause"></p>');
  private fallback = el('div', 'sim-fallback');
  private live = el('p', 'sr-only');
  private tags: Record<string, HTMLElement> = {};
  private q = <T extends Element>(sel: string) => this.root.querySelector(sel) as T;
  private resizeObs: ResizeObserver | null = null;
  private interObs: IntersectionObserver | null = null;
  private drag: { x: number; y: number; moved: boolean; id: number } | null = null;

  constructor() {
    this.root.setAttribute('aria-labelledby', 'sim-h');
    this.canvas.setAttribute('role', 'img');
    this.canvas.setAttribute('aria-label', '3D view of the landing site: the terrain skyline from the horizon profile, a generic lander, and the Sun and Earth at their computed positions. The same status is given as text in the cards and the line below the view.');
    this.canvas.tabIndex = 0;
    for (const k of ['sun', 'earth', 'ridge0', 'ridge1', 'gEarth', 'gSun']) {
      const t = el('div', `mk mk-${k.replace(/\d$/, '')}`, '<span class="mk-t"></span>');
      t.hidden = true;
      this.tags[k] = t;
      this.labels.append(t);
    }
    for (const h of [this.labels, this.compassC]) h.setAttribute('aria-hidden', 'true');
    this.fallback.hidden = true;
    this.view.append(this.canvas, this.compassC, this.labels, this.pinsEl, this.fallback);
    this.view.insertAdjacentHTML('beforeend', OVERLAY_HTML);
    this.stage.append(this.view, this.status, this.cause);
    const con = el('div', 'sim-console', CONSOLE_HTML);
    this.root.append(this.stage, con, this.live);
    this.live.setAttribute('aria-live', 'polite');
    this.live.id = 'sim-live';
    this.wireConsole(con);
    this.initThree();
    document.addEventListener('keydown', this.onKey);
    document.addEventListener('pointerdown', this.onDocDown);
    document.addEventListener('fullscreenchange', this.onFs);
  }

  // ---------------------------------------------------------------- console (real controls)
  private wireConsole(c: HTMLElement) {
    this.root.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('button');
      if (!b || !this.root.contains(b)) return;
      const a = b.dataset.a;
      if (a === 'play') this.setPlaying(!this.playing);
      else if (a === 'back') this.step(-HOUR);
      else if (a === 'fwd') this.step(HOUR);
      else if (a === 'fs') this.toggleFullscreen();
      else if (a === 'compass') { this.showCompass = !this.showCompass; this.syncButtons(); this.writeUrl(true); this.dirty = true; }
      else if (b.dataset.speed) { this.speed = Number(b.dataset.speed); this.syncButtons(); }
      else if (b.dataset.ab) this.setAB(b.dataset.ab as AB);
      else if (b.dataset.cam) this.setCam(b.dataset.cam as Cam);
      else if (b.dataset.look) this.look(b.dataset.look as 'sun' | 'earth');
      else if (b.dataset.size) { this.size = Number(b.dataset.size); this.syncButtons(); this.writeUrl(true); this.dirty = true; }
      else if (b.dataset.pop) this.togglePop(b.dataset.pop);
      else if (b.dataset.site) { if (b.dataset.site !== this.site.id) this.commit({ site: b.dataset.site }); }
    });
    const scrub = c.querySelector<HTMLInputElement>('#sim-scrub')!;
    scrub.addEventListener('input', () => {
      this.t = Number(scrub.value);
      const [a, b] = this.stays();
      if (b && (this.t < (this.ab === 'a' ? a.t0 : b.t0) || this.t > (this.ab === 'a' ? a.t1 : b.t1))) {
        this.ab = this.t >= b.t0 && this.t <= b.t1 ? 'b' : 'a';
        this.syncButtons();
      }
      this.dirty = true;
    });
    scrub.addEventListener('change', () => this.writeUrl(true));
    const slip = c.querySelector<HTMLInputElement>('#sim-slip')!;
    const slipN = c.querySelector<HTMLInputElement>('#sim-slip-n')!;
    slip.addEventListener('input', () => {
      // Preview the slipped stay locally; commit to the page state on release.
      const met = this.t - this.activeStart();
      this.slipPreview = Number(slip.value);
      if (this.ab === 'b') this.t = this.activeStart() + met;
      slipN.value = slip.value;
      this.afterStaysChange();
    });
    const commitSlip = (v: number) => {
      v = Math.round(clamp(v, -90, 90));
      this.keepMet = this.t - this.activeStart(); // measured against the previewed stay
      this.slipPreview = null;
      if (this.ab === 'b' && v === 0) this.ab = 'a';
      this.commit({ slip: v });
    };
    slip.addEventListener('change', () => commitSlip(Number(slip.value)));
    slipN.addEventListener('change', () => { if (slipN.value !== '' && Number.isFinite(Number(slipN.value))) commitSlip(Number(slipN.value)); });
    c.querySelectorAll<HTMLElement>('.pop').forEach((p) => p.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); this.closePops(true); }
    }));
    this.view.querySelector<HTMLSelectElement>('.site-select')!.addEventListener('change', (e) => {
      const id = (e.target as HTMLSelectElement).value;
      if (id !== this.site.id) this.commit({ site: id });
    });
  }

  private togglePop(id: string) {
    const p = this.q<HTMLElement>(`#sim-pop-${id}`);
    const open = p.hidden;
    this.closePops(false);
    if (open) {
      p.hidden = false;
      this.q<HTMLElement>(`[data-pop="${id}"]`).setAttribute('aria-expanded', 'true');
      p.querySelector<HTMLElement>('button')?.focus({ preventScroll: true });
    }
  }
  private closePops(refocus: boolean) {
    this.root.querySelectorAll<HTMLElement>('.pop').forEach((p) => {
      if (p.hidden) return;
      p.hidden = true;
      const b = this.q<HTMLElement>(`[data-pop="${p.id.replace('sim-pop-', '')}"]`);
      b.setAttribute('aria-expanded', 'false');
      if (refocus) b.focus({ preventScroll: true });
    });
  }
  private onDocDown = (e: PointerEvent) => {
    const t = e.target as HTMLElement;
    if (!t.closest('.pop') && !t.closest('[data-pop]')) this.closePops(false);
  };

  private toggleFullscreen() {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void this.root.requestFullscreen?.().catch(() => {});
  }
  private onFs = () => {
    const fs = document.fullscreenElement === this.root;
    const b = this.q<HTMLButtonElement>('[data-a="fs"]');
    b.innerHTML = fs ? ICON.shrink : ICON.expand;
    b.setAttribute('aria-label', fs ? 'Exit full screen' : 'Full screen');
    b.title = fs ? 'Exit full screen (Esc)' : 'Full screen';
  };

  private commit(patch: Partial<Pick<SimState, 'site' | 'slip'>>) {
    const f = document.activeElement as HTMLElement | null;
    const sel = f && this.root.contains(f) ? (f.id ? `#${CSS.escape(f.id)}` : f.dataset.site ? `[data-site="${CSS.escape(f.dataset.site)}"]` : f.dataset.a ? `[data-a="${f.dataset.a}"]` : null) : null;
    this.ctx.setState(patch);
    if (sel && document.activeElement !== f) this.root.querySelector<HTMLElement>(sel)?.focus({ preventScroll: true });
  }

  // ---------------------------------------------------------------- three.js
  private initThree() {
    try {
      // Probe on a throwaway canvas so three.js gets the real canvas with its own context attributes.
      if (!document.createElement('canvas').getContext('webgl2')) throw new Error('WebGL 2 is not available');
      this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: false, logarithmicDepthBuffer: true, powerPreference: 'high-performance' });
    } catch (e) {
      this.renderer = null;
      this.showFallback(`The 3D view needs WebGL 2, which this browser or device does not provide (${(e as Error).message}). The status cards, cause line and controls still work, and so does the mission brief.`);
      return;
    }
    const r = this.renderer;
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1;
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.setClearColor(0x000000, 1);
    this.canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); this.showFallback('The 3D view lost its graphics context. Reload the page to restore it; the readouts below still work.'); });
    this.post = new Post(r, 4);
    this.env = landerEnv(r);

    this.scene.background = new THREE.Color(0x000000);
    this.sunLight.castShadow = true; // must stay the only shadow caster: it is directional light 0 in the shaders
    this.sunLight.shadow.mapSize.set(2048, 2048);
    this.sunLight.shadow.bias = -0.0004;
    this.sunLight.shadow.normalBias = 0.03;
    this.sunLight.shadow.radius = 2.5;
    this.scene.add(this.sunLight, this.sunLight.target, this.earthLight, this.earthLight.target);
    this.sky = new Sky();
    this.scene.add(this.sky.group);
    this.camLander.rotation.order = 'YXZ';

    this.orbit = new OrbitControls(this.camOrbit, this.canvas);
    this.orbit.enableDamping = !REDUCED;
    this.orbit.dampingFactor = 0.1;
    this.orbit.minDistance = 3; this.orbit.maxDistance = 70;
    this.orbit.maxPolarAngle = Math.PI * 0.49;
    this.orbit.target.set(0, 1.1, 0);
    this.orbit.addEventListener('change', () => { this.dirty = true; });
    this.orbit.enabled = this.cam === 'orbit';

    this.canvas.addEventListener('pointerdown', this.onDown);
    this.canvas.addEventListener('pointermove', this.onMove);
    this.canvas.addEventListener('pointerup', this.onUp);
    this.canvas.addEventListener('pointercancel', () => { this.drag = null; });
    // Page scroll wins over the 3D view: a plain wheel scrolls the page; Ctrl/Cmd + wheel (a trackpad pinch
    // arrives as Ctrl + wheel) zooms. Capture phase on the wrapper, so the camera controls never see plain wheels.
    this.view.addEventListener('wheel', (e) => {
      if (e.ctrlKey || e.metaKey) return;
      e.stopPropagation();
      if (this.cam !== 'lander') this.flashZoomHint();
    }, { capture: true });
    this.resizeObs = new ResizeObserver(() => this.resize());
    this.resizeObs.observe(this.view);
    this.interObs = new IntersectionObserver((es) => { this.onScreen = es.some((x) => x.isIntersecting); if (this.onScreen) this.dirty = true; }, { threshold: 0.02 });
    this.interObs.observe(this.view);
    this.applyQuality();
  }

  private applyQuality() {
    if (!this.renderer || !this.post) return;
    const q = this.quality;
    this.post.bloomOn = q >= 2;
    const size = q >= 2 ? 2048 : 1024;
    if (this.sunLight.shadow.mapSize.x !== size) {
      this.sunLight.shadow.mapSize.set(size, size);
      this.sunLight.shadow.map?.dispose();
      this.sunLight.shadow.map = null;
    }
    this.renderer.setPixelRatio(q >= 1 ? Math.min(window.devicePixelRatio || 1, 2) : 1);
    this.uni.uHFOn.value = q >= 1 ? 1 : 0;
    const label = ['Low', 'Medium', 'High'][q];
    const note = this.q<HTMLElement>('[data-f="quality"]');
    if (note) note.textContent = `Render quality: ${label}${this.qLocked ? ' (fixed by the link)' : ' (adapts to frame time)'}.`;
    this.resize();
  }

  private showFallback(msg: string) {
    this.fallback.hidden = false;
    this.fallback.setAttribute('role', 'note');
    this.fallback.textContent = msg;
    this.canvas.hidden = true;
    this.view.classList.add('no-gl');
    // Camera and drawing controls have nothing to drive without WebGL.
    this.root.querySelectorAll<HTMLButtonElement>('[data-cam], [data-look], [data-size], [data-a="compass"]').forEach((x) => { x.disabled = true; });
  }

  // ---------------------------------------------------------------- mounting
  attach(slot: HTMLElement, ctx: SimContext) {
    if (this.root.parentElement !== slot) slot.appendChild(this.root);
    const prev = this.ctx;
    const oldStart = prev ? this.activeStart() : 0;
    const met = this.keepMet ?? (prev ? this.t - oldStart : 0);
    this.keepMet = null;
    this.ctx = ctx;
    const site = ctx.sites.find((s) => s.id === ctx.state.site);
    const hz = site && ctx.horizons.get(site.id);
    if (!site || !hz) { this.showFallback('No site loaded.'); return; }
    if (ctx.state.slip === 0 && this.ab === 'b') this.ab = 'a';
    this.feats = featureIndex(ctx.features);
    this.local = featuresContaining(site, ctx.features);
    const key = `${site.id}|${site.lat}|${site.lon_e}|${site.elev_m}|${ctx.mock}`;
    const siteChanged = key !== this.siteKey;
    this.site = site; this.hz = hz; this.frameF = siteFrame(site);
    if (siteChanged) { this.siteKey = key; this.buildSite(); }
    const sig = ctx.sites.map((s) => `${s.id}:${s.lat}:${s.lon_e}`).join('|');
    if (this.globe && sig !== this.globeSig) { this.globe.dispose(); this.globe = null; this.globeCtl?.dispose(); this.globeCtl = null; }
    if (!this.globe && this.renderer) {
      this.globe = new Globe([...ctx.sites]); this.globeSig = sig; this.setupGlobeControls();
      const w = Math.max(1, this.view.clientWidth), h = Math.max(1, this.view.clientHeight);
      this.globe.camera.aspect = w / h; this.globe.camera.updateProjectionMatrix(); this.globe.setPixelRatio(this.renderer.getPixelRatio());
    }
    if (siteChanged) this.cd.clear();
    // Keep mission-elapsed time across re-renders; first mount honours ?simt=.
    const [a] = this.stays();
    if (this.pendingSimT != null) {
      this.t = this.pendingSimT; this.pendingSimT = null;
      const [, b] = this.stays();
      if (this.ab === 'b' && b && (this.t < b.t0 || this.t > b.t1)) this.ab = 'a';
    } else if (prev) this.t = met + this.activeStart();
    else {
      // First open with no ?simt=: start at the first hour of the stay with the Sun in view (if any), so the
      // lander view does not open on a black sky. The transport bar still covers the whole stay.
      this.t = a.t0;
      let firstLit: number | null = null;
      for (let t = a.t0; t <= a.t1; t += 3600) {
        const sun = readout(ctx.ephem, this.frameF, hz, this.feats, t, ctx.state.mode).sun;
        if (sun.visible && firstLit == null) firstLit = t;
        if (sun.visible && sun.frac >= 1) { this.t = t; firstLit = null; break; } // whole disc clear of the skyline
      }
      if (firstLit != null) this.t = firstLit;
    }
    if (!Number.isFinite(this.t)) this.t = a.t0;
    this.q<HTMLElement>('.sim-mock').hidden = !ctx.mock;
    const sel = this.view.querySelector<HTMLSelectElement>('.site-select')!;
    sel.innerHTML = ctx.sites.map((s) => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join('');
    sel.value = site.id;
    this.set('coords', `${Math.abs(site.lat).toFixed(3)}°${site.lat < 0 ? 'S' : 'N'}  ${site.lon_e.toFixed(3)}°E`);
    this.buildPins();
    const sphere = hz.dem.product === 'sphere';
    this.set('note', sphere
      ? `${SPHERE_NOTE} Sun and Earth positions are computed; ground, Earth pattern and stars are illustrative.`
      : 'Skyline from the LOLA horizon profile (exact elevation angles); ground detail, rocks, Earth pattern and stars are illustrative.');
    this.set('about', [
      sphere ? `${SPHERE_NOTE} The skyline is flat, at the geometric dip of the horizon seen from the mast.`
        : 'The skyline is the LOLA horizon profile: seen from the mast, each of the 720 azimuth samples sits at its exact elevation angle. Ridge distances are smoothed and clamped to 0.3–20 km for drawing only.',
      'Sun and Earth positions, disc fractions, the status cards and the line under the view come from the validated engine (JPL ephemeris, topocentric Earth).',
      'Illustrative only: craters, rocks and ground texture in front of the skyline (kept below the line of sight), far-terrain shading, the lander design, Earth’s surface pattern and the star field.',
      'Lighting: airless — black shadows, no fill light except faint earthshine. The ground uses a lunar (Lommel-Seeliger) reflectance with an opposition surge.',
      this.size === 1 ? 'Sun and Earth are drawn at true angular size.' : 'Sun and Earth are drawn 6× larger than their true angular size.',
    ].map((x) => `<li>${esc(x)}</li>`).join(''), true);
    if (siteChanged || !prev) this.frameCameras();
    this.afterStaysChange();
    this.syncButtons();
    this.writeUrl(true);
    if (!this.raf) { this.last = performance.now(); this.raf = requestAnimationFrame(this.loop); }
  }

  private buildSite() {
    if (!this.renderer) return;
    this.terrain?.dispose();
    this.lander?.dispose();
    this.terrain = new Terrain(this.hz, this.uni);
    this.lander = new Lander(this.hz.mast_m, this.uni, this.env);
    this.scene.add(this.terrain.group, this.lander.group);
    this.camLander.position.set(0, this.hz.mast_m, 0);
    this.terrain.setResolution(this.view.clientWidth, this.view.clientHeight);
  }

  private zoomHint: HTMLElement | null = null;
  private zoomHintTimer = 0;
  private flashZoomHint() {
    if (!this.zoomHint) {
      this.zoomHint = el('div', 'sim-zoomhint');
      this.zoomHint.textContent = `Hold ${/Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl'} and scroll to zoom`;
      this.zoomHint.setAttribute('aria-hidden', 'true');
      this.view.append(this.zoomHint);
    }
    this.zoomHint.classList.add('on');
    clearTimeout(this.zoomHintTimer);
    this.zoomHintTimer = window.setTimeout(() => this.zoomHint?.classList.remove('on'), 1400);
  }
  private buildPins() {
    this.pinsEl.innerHTML = this.ctx.sites.map((s) =>
      `<button type="button" class="pin" data-site="${esc(s.id)}" aria-pressed="${s.id === this.site.id}" aria-label="Select site ${esc(s.name)}"><i></i><span>${esc(s.name)}</span></button>`).join('');
  }

  private setupGlobeControls() {
    if (!this.globe || !this.renderer) return;
    this.globeCtl = new OrbitControls(this.globe.camera, this.canvas);
    this.globeCtl.enablePan = false;
    this.globeCtl.minDistance = 1.5; this.globeCtl.maxDistance = 9;
    this.globeCtl.enableDamping = !REDUCED;
    this.globeCtl.rotateSpeed = 0.6;
    this.globeCtl.addEventListener('change', () => { this.dirty = true; });
    this.globeCtl.enabled = this.cam === 'globe';
  }

  private frameCameras() {
    if (!this.ctx) return;
    // Orbit: low 3/4 view toward the Sun (or Earth if the Sun is down) so the lit side and the skyline both show.
    const t0 = this.activeStart();
    const r = readout(this.ctx.ephem, this.frameF, this.hz, this.feats, clamp(this.t || t0, this.ctx.ephem.t0, this.ctx.ephem.tLast), this.ctx.state.mode);
    const sunUp = r.sun.aboveFlat || r.sun.visible, earthUp = r.earth.aboveFlat || r.earth.visible;
    let az = sunUp ? r.sun.az : r.earth.az;
    const gap = wrap180(r.earth.az - r.sun.az);
    const both = sunUp && earthUp && Math.abs(gap) < 70;
    if (both) az = r.sun.az + gap / 2;
    const look = dirFromAzEl(az + (both ? 0 : 28), 0);
    this.camOrbit.position.set(-look[0] * 8.5, 2.6, -look[2] * 8.5);
    this.orbit?.target.set(0, 1.25, 0);
    this.orbit?.update();
    this.yaw = az; this.pitch = clamp((r.sun.aboveFlat ? r.sun.el : r.earth.el) * 0.5, -10, 30);
    if (this.globe) { this.globe.frame(this.site.id); this.globeCtl?.update(); }
    this.camTween = null;
  }

  // ---------------------------------------------------------------- time & stays
  private slipDays() { return this.slipPreview ?? this.ctx.state.slip; }
  private stays(): [{ t0: number; t1: number }, { t0: number; t1: number } | null] {
    const e = this.ctx.ephem;
    let t0: number;
    try { t0 = parseUtc(this.ctx.state.t + ':00Z'); } catch { t0 = e.t0; }
    const len = this.ctx.state.stay * DAY;
    const fit = (x: number) => clamp(x, e.t0, e.tLast);
    const a = { t0: fit(t0), t1: fit(t0 + len) };
    const s = this.slipDays();
    const bt = t0 + s * DAY;
    const b = s !== 0 && e.covers(bt) ? { t0: fit(bt), t1: fit(bt + len) } : null;
    return [a, b];
  }
  private activeStart() { const [a, b] = this.stays(); return this.ab === 'b' && b ? b.t0 : a.t0; }
  private span() {
    const [a, b] = this.stays();
    return b ? { t0: Math.min(a.t0, b.t0), t1: Math.max(a.t1, b.t1) } : a;
  }

  private afterStaysChange() {
    const sp = this.span();
    this.t = clamp(this.t, sp.t0, sp.t1);
    // Visibility strip along the scrub bar (engine scan, coarse step for drawing only).
    const step = Math.max(600, Math.ceil((sp.t1 - sp.t0) / 900 / 600) * 600);
    try { this.scan = scanWindow(this.ctx.ephem, this.frameF, this.hz.elev_deg, sp.t0, sp.t1, this.ctx.state.mode, step); } catch { this.scan = null; }
    this.drawScrub();
    this.syncButtons();
    this.dirty = true;
  }

  private drawScrub() {
    if (!this.ctx) return;
    const sp = this.span(), [a, b] = this.stays();
    const scrub = this.q<HTMLInputElement>('#sim-scrub');
    scrub.min = String(sp.t0); scrub.max = String(sp.t1);
    const pct = (t: number) => (100 * (t - sp.t0)) / Math.max(1, sp.t1 - sp.t0);
    const range = (x: { t0: number; t1: number }, cls: string, label: string) =>
      `<div class="rng ${cls}" style="left:${pct(x.t0).toFixed(3)}%;width:${(pct(x.t1) - pct(x.t0)).toFixed(3)}%"><span>${label}</span></div>`;
    const day = (x: { t0: number }) => fmtUtc(x.t0).slice(5, 10).replace('-', '/');
    this.q<HTMLElement>('.tl-ranges').innerHTML = range(a, 'rng-a' + (this.ab === 'a' ? ' on' : ''), `Baseline · ${day(a)}`)
      + (b ? range(b, 'rng-b' + (this.ab === 'b' ? ' on' : ''), `Slipped · ${day(b)}`) : '');
    const cv = this.q<HTMLCanvasElement>('.tl-strip');
    const dpr = Math.min(2, devicePixelRatio || 1);
    const w = Math.max(100, cv.clientWidth || 600), h = Math.max(20, cv.clientHeight || 26);
    cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
    const g = cv.getContext('2d');
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    const rowH = Math.floor((h - 6) / 2);
    g.fillStyle = 'rgba(255,255,255,0.05)';
    g.fillRect(0, 0, w, rowH); g.fillRect(0, h - rowH, w, rowH);
    // day ticks
    g.fillStyle = 'rgba(255,255,255,0.12)';
    for (let t = Math.ceil(sp.t0 / DAY) * DAY; t <= sp.t1; t += DAY) g.fillRect(Math.round((pct(t) / 100) * w), 0, 1, h);
    if (!this.scan) return;
    const s = this.scan;
    for (let k = 0; k < s.n; k++) {
      const x0 = (k / s.n) * w, x1 = ((k + 1) / s.n) * w;
      if (s.sunVis[k]) { g.fillStyle = '#e69f00'; g.fillRect(x0, 0, x1 - x0 + 0.5, rowH); }
      if (s.earthVis[k]) { g.fillStyle = '#56b4e9'; g.fillRect(x0, h - rowH, x1 - x0 + 0.5, rowH); }
      if (s.sunVis[k] && s.earthVis[k]) { g.fillStyle = '#009e73'; g.fillRect(x0, rowH + 2, x1 - x0 + 0.5, h - 2 * rowH - 4); }
    }
  }

  private setPlaying(p: boolean) {
    this.playing = p;
    if (p) { const sp = this.span(); if (this.t >= sp.t1 - 1) this.t = this.activeStart(); }
    this.syncButtons();
    if (!p) this.writeUrl(true);
    this.dirty = true;
  }
  private step(dt: number) {
    const sp = this.span();
    this.t = clamp(Math.round((this.t + dt) / 60) * 60, sp.t0, sp.t1);
    this.dirty = true;
    this.writeUrl(true);
    this.announce(true);
  }
  private setAB(ab: AB) {
    const [, b] = this.stays();
    if (ab === 'b' && !b) return;
    const met = this.t - this.activeStart();
    this.ab = ab;
    this.t = this.activeStart() + met;
    this.afterStaysChange();
    this.writeUrl(true);
    this.announce(true);
  }

  private pose(c: THREE.PerspectiveCamera): Pose { return { pos: c.position.clone(), quat: c.quaternion.clone(), fov: c.fov }; }
  private setCam(c: Cam) {
    if (c === this.cam) return;
    const prev = this.cam;
    const instant = REDUCED || !this.renderer;
    if (prev !== 'globe' && c !== 'globe' && !instant) this.camTween = { from: this.pose(this.camView), t0: performance.now(), dur: 950 };
    else this.camTween = null;
    if ((prev === 'globe' || c === 'globe') && !instant) {
      this.canvas.classList.add('fade');
      setTimeout(() => this.canvas.classList.remove('fade'), 180);
      if (c === 'globe' && this.globe) {
        this.globe.frame(this.site.id, this.globe.camera, 1.6);
        this.globeTween = { d0: 1.6, d1: 5.2, t0: performance.now() + 120 };
      }
      if (prev === 'globe') this.camTween = { from: { pos: new THREE.Vector3(0, 40, 0).add(this.camOrbit.position.clone().multiplyScalar(3)), quat: this.camOrbit.quaternion.clone(), fov: 50 }, t0: performance.now(), dur: 1100 };
    } else if (c === 'globe' && this.globe) this.globe.frame(this.site.id);
    this.cam = c;
    if (this.orbit) this.orbit.enabled = c === 'orbit';
    if (this.globeCtl) this.globeCtl.enabled = c === 'globe';
    this.syncButtons();
    this.writeUrl(true);
    this.dirty = true;
  }
  private look(which: 'sun' | 'earth') {
    if (!this.ro) return;
    if (this.cam !== 'lander') this.setCam('lander');
    const b = which === 'sun' ? this.ro.sun : this.ro.earth;
    const y1 = this.yaw + wrap180(b.az - this.yaw), p1 = clamp(b.el, -20, 75);
    if (REDUCED) { this.yaw = b.az; this.pitch = p1; }
    else this.lookTween = { y0: this.yaw, p0: this.pitch, y1, p1, t0: performance.now() };
    this.dirty = true;
  }

  private syncButtons() {
    if (!this.ctx) return;
    const play = this.q<HTMLButtonElement>('[data-a="play"]');
    play.innerHTML = this.playing ? ICON.pause : ICON.play;
    play.setAttribute('aria-label', this.playing ? 'Pause' : 'Play');
    play.setAttribute('aria-pressed', String(this.playing));
    const [, b] = this.stays();
    const press = (sel: string, on: (x: HTMLButtonElement) => boolean) => this.root.querySelectorAll<HTMLButtonElement>(sel).forEach((x) => x.setAttribute('aria-pressed', String(on(x))));
    press('[data-ab]', (x) => x.dataset.ab === this.ab);
    this.root.querySelectorAll<HTMLButtonElement>('[data-ab="b"]').forEach((x) => { x.disabled = !b; x.title = b ? '' : 'Set a launch slip to compare a slipped stay'; });
    press('[data-cam]', (x) => x.dataset.cam === this.cam);
    press('[data-speed]', (x) => Number(x.dataset.speed) === this.speed);
    press('[data-size]', (x) => Number(x.dataset.size) === this.size);
    press('.pin', (x) => x.dataset.site === this.site.id);
    this.q<HTMLElement>('[data-a="compass"]').setAttribute('aria-checked', String(this.showCompass));
    const slip = this.q<HTMLInputElement>('#sim-slip'), slipN = this.q<HTMLInputElement>('#sim-slip-n');
    const s = this.slipDays();
    if (document.activeElement !== slip) slip.value = String(clamp(s, 0, 60));
    if (document.activeElement !== slipN) slipN.value = String(s);
    slip.setAttribute('aria-valuetext', `${s} days`);
    this.view.dataset.cam = this.cam;
    this.root.classList.toggle('cam-globe', this.cam === 'globe');
  }

  private writeUrl(force = false) {
    const now = performance.now();
    if (!force && this.playing && now - this.lastUrl < 2000) return;
    this.lastUrl = now;
    const q = new URLSearchParams(location.search);
    q.set('cam', this.cam);
    q.set('simt', utcMin(this.t));
    if (this.ab === 'b') q.set('ab', 'b'); else q.delete('ab');
    if (this.size !== 1) q.set('size', String(this.size)); else q.delete('size');
    if (!this.showCompass) q.set('compass', '0'); else q.delete('compass');
    if (this.qLocked) q.set('q', this.quality === 0 ? 'low' : 'high');
    history.replaceState(history.state, '', `${location.pathname}?${q}`);
  }

  // ---------------------------------------------------------------- input
  private onKey = (e: KeyboardEvent) => {
    if (!this.root.isConnected || !this.onScreen || e.altKey || e.ctrlKey || e.metaKey) return;
    const tg = e.target as HTMLElement | null;
    if (tg && (tg.closest('input, select, textarea, button, a, [contenteditable="true"], summary, .pop'))) return;
    if (e.key === ' ' || e.code === 'Space') { e.preventDefault(); this.setPlaying(!this.playing); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); this.step(-HOUR); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); this.step(HOUR); }
    else { const c = CAMS.find((x) => x.key === e.key); if (c && this.renderer) this.setCam(c.id); }
  };
  private onDown = (e: PointerEvent) => {
    this.drag = { x: e.clientX, y: e.clientY, moved: false, id: e.pointerId };
    if (this.cam === 'lander') this.canvas.setPointerCapture(e.pointerId);
  };
  private onMove = (e: PointerEvent) => {
    if (!this.drag || this.drag.id !== e.pointerId) return;
    const dx = e.clientX - this.drag.x, dy = e.clientY - this.drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) this.drag.moved = true;
    if (this.cam === 'lander') {
      this.lookTween = null;
      const k = this.camLander.fov / Math.max(200, this.canvas.clientHeight);
      this.yaw = (((this.yaw - dx * k) % 360) + 360) % 360;
      this.pitch = clamp(this.pitch + dy * k, -60, 85);
      this.drag.x = e.clientX; this.drag.y = e.clientY;
      this.dirty = true;
    }
  };
  private onUp = (e: PointerEvent) => {
    const d = this.drag;
    this.drag = null;
    if (!d || d.moved || this.cam !== 'globe' || !this.globe) return;
    const rect = this.canvas.getBoundingClientRect();
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1), this.globe.camera);
    const id = this.globe.pick(ray);
    if (id && id !== this.site.id) this.commit({ site: id });
  };

  // ---------------------------------------------------------------- frame loop
  private resize() {
    if (!this.renderer || !this.post) return;
    const w = Math.max(1, this.view.clientWidth), h = Math.max(1, this.view.clientHeight);
    this.renderer.setSize(w, h, false);
    this.post.setSize(w, h);
    for (const c of [this.camLander, this.camOrbit, this.camView]) { c.aspect = w / h; c.updateProjectionMatrix(); }
    // Keep the lander view's horizontal field reasonable on tall (mobile) screens.
    this.camLander.fov = w / h < 1 ? 82 : 66; this.camLander.updateProjectionMatrix();
    this.camOrbit.fov = w / h < 1 ? 64 : 48; this.camOrbit.updateProjectionMatrix();
    if (this.globe) { this.globe.camera.aspect = w / h; this.globe.camera.updateProjectionMatrix(); this.globe.setPixelRatio(this.renderer.getPixelRatio()); }
    this.terrain?.setResolution(w, h);
    const dpr = Math.min(2, devicePixelRatio || 1);
    this.compassC.width = Math.round(w * dpr);
    this.compassC.height = Math.round(44 * dpr);
    this.drawScrub();
    // Resizing clears the canvas: redraw now (ResizeObserver runs before paint) instead of on the next frame.
    if (this.ctx) this.update(performance.now()); else this.dirty = true;
  }

  private loop = (now: number) => {
    this.raf = requestAnimationFrame(this.loop);
    const dtMs = now - this.last;
    const dt = Math.min(0.1, dtMs / 1000);
    this.last = now;
    if (!this.ctx) return;
    let continuous = false;
    if (this.playing) {
      const sp = this.span();
      this.t += dt * this.speed;
      if (this.t >= sp.t1) { this.t = sp.t1; this.setPlaying(false); }
      this.dirty = continuous = true;
    }
    if (this.orbit?.enabled && this.orbit.update()) this.dirty = continuous = true;
    if (this.globeCtl?.enabled && this.globeCtl.update()) this.dirty = continuous = true;
    if (this.camTween || this.lookTween || this.globeTween || this.drag?.moved) this.dirty = continuous = true;
    if (!this.dirty || !this.onScreen) return;
    this.dirty = false;
    if (continuous && this.renderer) this.trackFrame(dtMs);
    this.update(now);
  };

  /** Degrade gracefully: if sustained frames are slow, drop bloom, then shadow size, pixel ratio and the march. */
  private trackFrame(ms: number) {
    if (this.qLocked || this.quality === 0 || document.hidden) return;
    this.frameTimes.push(ms);
    if (this.frameTimes.length < 90) return;
    const avg = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
    this.frameTimes.length = 0;
    if (avg > 40) { this.quality--; this.applyQuality(); console.info(`[sim] average frame ${avg.toFixed(0)} ms: render quality lowered to ${this.quality}`); }
  }

  private update(now: number) {
    const ctx = this.ctx;
    let r: Readout;
    try { r = readout(ctx.ephem, this.frameF, this.hz, this.feats, this.t, ctx.state.mode); }
    catch { return; }
    this.ro = r;
    if (now - this.lastHud > 66 || !this.playing) { this.lastHud = now; this.updateHud(r); }
    this.announce(false);
    if (this.playing) this.writeUrl();
    if (!this.renderer || !this.post || !this.sky || !this.terrain || !this.lander) return;

    const sunDir = v3(dirFromAzEl(r.sun.az, r.sun.el));
    const earthDir = v3(dirFromAzEl(r.earth.az, r.earth.el));
    const sunK = r.power.pct / 100; // disc fraction above terrain at the lander (0 when hidden or totally eclipsed)
    const night = !r.sun.aboveFlat && !r.sun.visible;
    // Sun light: on whenever any part of the Sun is above the true horizon somewhere; the shaders apply the
    // engine's disc fraction at the lander and the terrain march elsewhere.
    this.uni.uSunW.value.copy(sunDir);
    this.uni.uSunR.value = (r.sun.r * Math.PI) / 180;
    this.uni.uSunK.value = sunK;
    this.sunLight.intensity = r.sun.el > -3 ? SUN_LUX : 0;
    const earthK = r.earth.visible ? r.earth.frac * r.earthLitFrac : 0;
    this.earthLight.intensity = 0.2 * earthK; // earthshine: faint, the only "fill" in an airless scene
    this.earthLight.position.copy(earthDir).multiplyScalar(100);
    this.uni.uEnvK.value = 0.04 + 0.96 * sunK;
    this.lander.point(sunDir, earthDir);
    this.terrain.setHighlight(0, r.sun.blocker ? r.sun.blocker.az : null);
    this.terrain.setHighlight(1, r.earth.blocker ? r.earth.blocker.az : null);

    // Cameras: tweens between lander and orbit; lander look tween.
    if (this.lookTween) {
      const k = clamp((now - this.lookTween.t0) / 700, 0, 1), e = ease(k);
      this.yaw = ((this.lookTween.y0 + (this.lookTween.y1 - this.lookTween.y0) * e) % 360 + 360) % 360;
      this.pitch = this.lookTween.p0 + (this.lookTween.p1 - this.lookTween.p0) * e;
      if (k >= 1) this.lookTween = null;
    }
    this.camLander.rotation.set((this.pitch * Math.PI) / 180, (-this.yaw * Math.PI) / 180, 0, 'YXZ');
    this.camLander.updateMatrixWorld();
    const target = this.cam === 'orbit' ? this.camOrbit : this.camLander;
    if (this.camTween) {
      const k = clamp((now - this.camTween.t0) / this.camTween.dur, 0, 1), e = ease(k);
      const f = this.camTween.from;
      this.camView.position.lerpVectors(f.pos, target.position, e);
      this.camView.quaternion.slerpQuaternions(f.quat, target.quaternion, e);
      this.camView.fov = f.fov + (target.fov - f.fov) * e;
      if (k >= 1) this.camTween = null;
    } else {
      this.camView.position.copy(target.position);
      this.camView.quaternion.copy(target.quaternion);
      this.camView.fov = target.fov;
    }
    this.camView.updateProjectionMatrix();
    this.camView.updateMatrixWorld();
    const cam = this.camView;

    // Shadow frustum: tight around what the camera looks at (lander or orbit target).
    const center = this.cam === 'orbit' ? this.orbit!.target.clone().setY(0) : new THREE.Vector3();
    const rad = this.cam === 'orbit' ? clamp(this.camOrbit.position.distanceTo(this.orbit!.target) * 2.4, 18, 64) : 40;
    const sc = this.sunLight.shadow.camera;
    if (sc.right !== rad) { sc.left = -rad; sc.right = rad; sc.top = rad; sc.bottom = -rad; sc.near = 1; sc.far = 1600; sc.updateProjectionMatrix(); }
    this.sunLight.target.position.copy(center);
    this.sunLight.position.copy(center).addScaledVector(sunDir, 700);
    this.sunLight.target.updateMatrixWorld();

    // Exposure ("auto-exposure feel"): bright when sunlit, opened up in shadow, wide open at night (earthshine).
    const sunScreen = this.project(sunDir, cam);
    const w = this.view.clientWidth, h = this.view.clientHeight;
    const sunInFrame = !!sunScreen && sunScreen.x > -0.15 * w && sunScreen.x < 1.15 * w && sunScreen.y > -0.15 * h && sunScreen.y < 1.15 * h;
    const target2 = night ? 5.5 : sunK > 0 ? (sunInFrame && r.sun.visible ? 0.85 : 1.0) : 4.0;
    if (this.exposure < 0 || REDUCED) this.exposure = target2;
    else {
      this.exposure += (target2 - this.exposure) * (1 - Math.exp(-Math.min(0.1, (now - this.last) / 1000 + 0.016) * 3));
      if (Math.abs(target2 - this.exposure) > 0.01) this.dirty = true;
    }
    this.renderer.toneMappingExposure = this.exposure;
    const starAlpha = night ? 1 : sunK === 0 ? 0.45 : sunInFrame ? 0 : 0.1;
    this.sky.update({ sunDir, sunRDeg: r.sun.r, earthDir, earthRDeg: r.earth.r, scale: this.size, starAlpha, glare: sunInFrame ? sunK : 0,
      cam, sunShown: r.sun.visible, earthShown: r.earth.visible, tSec: this.t, pixelRatio: this.renderer.getPixelRatio() });
    if (this.globe) {
      const s = ctx.ephem.sample(this.t);
      this.globe.update(s.sun, s.earth, this.site.id);
      if (this.globeTween) {
        const k = clamp((now - this.globeTween.t0) / 1100, 0, 1), e = ease(k);
        const d = this.globeTween.d0 + (this.globeTween.d1 - this.globeTween.d0) * e;
        this.globe.camera.position.setLength(d);
        this.globeCtl?.update();
        if (k >= 1) this.globeTween = null;
      }
    }
    if (this.cam === 'globe' && this.globe) {
      this.renderer.toneMappingExposure = 1;
      this.post.render(this.globe.scene, this.globe.camera);
    } else this.post.render(this.scene, cam);
    this.placeLabels(r, cam, sunDir, earthDir);
    this.drawCompass(r);
  }

  // ---------------------------------------------------------------- HUD
  private set(f: string, v: string, html = false) {
    const e = this.root.querySelector(`[data-f="${f}"]`);
    if (!e || this.textCache.get(e) === v) return;
    this.textCache.set(e, v);
    if (html) e.innerHTML = v; else e.textContent = v;
  }

  private updateHud(r: Readout) {
    const [a, b] = this.stays();
    const start = this.ab === 'b' && b ? b.t0 : a.t0;
    const stayDays = this.ctx.state.stay;
    const ctx0 = this.ctx;
    const dayN = (this.t - start) / DAY;
    this.set('utc', fmtUtc(this.t).slice(0, 16).replace('T', ' '));
    this.set('met', fmtMet(this.t - start));
    this.set('stay', `${this.ab === 'b' ? 'Slipped' : 'Baseline'} stay · ${dayN < 0 ? 'before landing' : dayN > stayDays ? 'after the stay' : `day ${Math.min(stayDays, Math.floor(dayN) + 1)} of ${stayDays}`}`);
    const pw = powerWord(r), cw = commWord(r);
    const card = (k: 'power' | 'comm', word: { word: string; tone: string }, body: BodyReadout, frac: number, more: [string, string][]) => {
      const c = this.q<HTMLElement>(`.card-${k}`);
      if (c.dataset.tone !== word.tone) c.dataset.tone = word.tone;
      this.set(`${k}-state`, word.word);
      this.q<HTMLElement>(`[data-f="${k}-bar"]`).style.transform = `scaleX(${clamp(frac, 0, 1)})`;
      this.set(`${k}-az`, `${body.az.toFixed(1)}°`);
      this.set(`${k}-el`, deg2(body.el));
      this.set(`${k}-clr`, deg2(body.el - body.horizonEl));
      this.set(`${k}-more`, more.map(([dt, dd]) => (dt === '*' ? `<dt class="fn">* ${esc(dd)}</dt>` : `<dt>${dt}</dt><dd class="num">${esc(dd)}</dd>`)).join(''), true);
    };
    // --- FEATURE (C): countdown to the next sunset/sunrise and Earthset/Earthrise (engine visibility, cached)
    const stayEnd = start + stayDays * DAY;
    for (const k of ['sun', 'earth'] as const) {
      try {
        const c = this.cd.get(this.siteKey, ctx0.ephem, this.frameF, this.hz.elev_deg, this.t, k, ctx0.state.mode);
        this.cdText[k] = countdownText(c, this.t, stayEnd, r[k].aboveFlat);
      } catch { this.cdText[k] = null; }
      this.set(`${k === 'sun' ? 'power' : 'comm'}-cd`, this.cdText[k]?.label ?? '');
    }
    const pg = powerGeometry(r.sun.el, r.sun.horizonEl, r.sun.frac);
    const pct = (x: number) => `${(x * 100).toFixed(0)}%`;
    card('power', pw, r.sun, r.power.pct / 100, [
      ['Elevation above horizontal', deg2(pg.sunEl)],
      ['Clearance above terrain', deg2(pg.clearance)],
      ['Sun disc visible', pct(pg.discFrac)],
      ['Sun-tracking panel*', pct(pg.tracking)],
      ['Fixed flat panel*', pct(pg.horizontal)],
      ['Power (disc in view)', `${r.power.pct.toFixed(0)}%`],
      [`Skyline at ${r.sun.az.toFixed(1)}°`, deg2(r.sun.horizonEl)],
      ['Sun radius', `${r.sun.r.toFixed(3)}°`],
      ...(r.power.note ? [['Note', r.power.note] as [string, string]] : []),
      ['*', 'Relative panel output: geometric factor, not a power model (flat panel = disc × sin elevation).'],
    ]);
    card('comm', cw, r.earth, r.earth.frac, [
      ['Disc above skyline', `${(r.earth.frac * 100).toFixed(0)}%`],
      [`Skyline at ${r.earth.az.toFixed(1)}°`, deg2(r.earth.horizonEl)],
      ['Earth lit (phase)', `${(r.earthLitFrac * 100).toFixed(0)}%`],
      ['Earth radius', `${r.earth.r.toFixed(3)}°`],
    ]);
    const c = causeLine(r, this.local);
    if (this.cause.dataset.tone !== c.tone) this.cause.dataset.tone = c.tone;
    this.set('cause', c.parts.map((p) => `<span class="cp" data-tone="${p.tone}">${p.html}</span>`).join(' '), true);
    const scrub = this.q<HTMLInputElement>('#sim-scrub');
    if (document.activeElement !== scrub) scrub.value = String(this.t);
    scrub.setAttribute('aria-valuetext', `${fmtUtc(this.t).slice(0, 16).replace('T', ' ')} UTC, ${fmtMet(this.t - start)} since ${this.ab === 'b' ? 'slipped' : 'baseline'} landing`);
  }

  private announce(force: boolean) {
    const r = this.ro;
    if (!r) return;
    const now = performance.now();
    if (!force && now - this.lastLive < 1000) return;
    const c = causeLine(r, this.local);
    const cdl = [this.cdText.sun?.long, this.cdText.earth?.long].filter(Boolean).join(' ');
    const states = `Power ${powerWord(r).word}, ${r.power.pct.toFixed(0)} percent. Comm ${commWord(r).word}. ${c.text} ${cdl}`;
    // While playing only state changes are announced; when paused or stepping, the time too.
    const txt = this.playing ? `Power ${powerWord(r).word}. Comm ${commWord(r).word}.`
      : `${fmtUtc(this.t).slice(0, 16).replace('T', ' ')} UTC. ${states}`;
    this.lastLive = now;
    if (txt !== this.liveText) { this.liveText = txt; this.live.textContent = txt; }
  }

  private project(dir: THREE.Vector3, cam: THREE.Camera, dist = SKY_R): { x: number; y: number } | null {
    const p = dir.clone().multiplyScalar(dist).add(cam.position).project(cam);
    if (p.z > 1 || p.z < -1) return null;
    const w = this.view.clientWidth, h = this.view.clientHeight;
    return { x: ((p.x + 1) / 2) * w, y: ((1 - p.y) / 2) * h };
  }
  private projectPoint(v: THREE.Vector3, cam: THREE.Camera): { x: number; y: number } | null {
    const p = v.clone().project(cam);
    if (p.z > 1 || p.z < -1) return null;
    return { x: ((p.x + 1) / 2) * this.view.clientWidth, y: ((1 - p.y) / 2) * this.view.clientHeight };
  }

  private putTag(key: string, p: { x: number; y: number } | null, html: string, cls: string, extra: Record<string, string> = {}) {
    const t = this.tags[key];
    const w = this.view.clientWidth, h = this.view.clientHeight;
    if (!p || p.x < -20 || p.x > w + 20 || p.y < -20 || p.y > h + 20) { if (!t.hidden) t.hidden = true; return; }
    t.hidden = false;
    t.style.transform = `translate(${Math.round(p.x)}px, ${Math.round(p.y)}px)`;
    if (t.dataset.cls !== cls) { t.dataset.cls = cls; t.className = `mk mk-${key.replace(/\d$/, '')} ${cls}`; }
    for (const [k, v] of Object.entries(extra)) t.style.setProperty(k, v);
    const span = t.firstElementChild as HTMLElement;
    if (this.textCache.get(span) !== html) { this.textCache.set(span, html); span.innerHTML = html; }
  }

  private placeLabels(r: Readout, cam: THREE.PerspectiveCamera, sunDir: THREE.Vector3, earthDir: THREE.Vector3) {
    const w = this.view.clientWidth, h = this.view.clientHeight;
    if (this.cam === 'globe' && this.globe) {
      const g = this.globe;
      for (const k of ['sun', 'earth', 'ridge0', 'ridge1']) this.tags[k].hidden = true;
      this.putTag('gEarth', this.projectPoint(g.arrowTip(0), g.camera), 'To Earth', '');
      this.putTag('gSun', this.projectPoint(g.arrowTip(1), g.camera), 'To Sun', '');
      const camPos = g.camera.position;
      this.pinsEl.hidden = false;
      this.pinsEl.querySelectorAll<HTMLButtonElement>('.pin').forEach((b) => {
        const pin = g.pins.find((x) => x.id === b.dataset.site);
        if (!pin) { b.hidden = true; return; }
        const facing = camPos.clone().sub(pin.pos).dot(pin.pos) > 0.02;
        const p = facing ? this.projectPoint(pin.pos, g.camera) : null;
        const show = !!p && p.x > 0 && p.x < w && p.y > 0 && p.y < h;
        if (b.hidden === show) b.hidden = !show;
        if (show) b.style.transform = `translate(${Math.round(p!.x)}px, ${Math.round(p!.y)}px)`;
      });
      return;
    }
    this.pinsEl.hidden = true;
    this.tags.gEarth.hidden = this.tags.gSun.hidden = true;
    // Body markers: the true position, with a ring of the drawn disc size; hidden bodies get a dashed ring.
    const f = h / 2 / Math.tan((cam.fov * Math.PI) / 360);
    const discPx = (rDeg: number) => Math.max(5, f * Math.tan((rDeg * this.size * Math.PI) / 180));
    const body = (key: 'sun' | 'earth', b: BodyReadout, dir: THREE.Vector3, name: string) => {
      const state = b.blocker ? 'blocked' : b.visible ? 'clear' : 'down';
      const label = b.blocker ? `${name} · hidden` : b.visible ? name : `${name} · below horizon`;
      this.putTag(key, this.project(dir, cam), esc(label), `st-${state}`, { '--r': `${discPx(b.r).toFixed(1)}px` });
    };
    body('sun', r.sun, sunDir, 'Sun');
    body('earth', r.earth, earthDir, 'Earth');
    // Blocking ridge: label with a leader line, anchored on the crest at the body's azimuth.
    const ridge = (k: 0 | 1, b: BodyReadout, other: BodyReadout, name: string) => {
      const key = `ridge${k}`;
      if (!b.blocker || !this.terrain) { this.tags[key].hidden = true; return; }
      if (k === 1 && other.blocker && Math.abs(wrap180(other.blocker.az - b.blocker.az)) < 6) { this.tags[key].hidden = true; return; }
      const both = k === 0 && other.blocker && Math.abs(wrap180(other.blocker.az - b.blocker.az)) < 6;
      const who = blockerName(b.blocker, this.local);
      const d = distText(b.blocker.distKm);
      const html = `<b>${esc(who.charAt(0).toUpperCase() + who.slice(1))}</b><small>blocks ${both ? 'Sun and Earth' : name}${d ? ` · <span class="num">${esc(d.replace(' km', ''))}</span> km` : ''} · <span class="num">${az3(b.blocker.az)}</span> ${compass(b.blocker.az)}</small>`;
      this.putTag(key, this.projectPoint(this.terrain.crest(b.blocker.az), cam), html, '');
    };
    ridge(0, r.sun, r.earth, 'Sun');
    ridge(1, r.earth, r.sun, 'Earth');
  }

  private drawCompass(r: Readout) {
    const c = this.compassC;
    const show = this.cam === 'lander' && this.showCompass && !!this.renderer;
    if (c.hidden === show) c.hidden = !show;
    this.view.classList.toggle('has-compass', show);
    if (!show) return;
    const g = c.getContext('2d');
    if (!g) return;
    const W = c.width, H = c.height, k = W / Math.max(1, this.view.clientWidth);
    g.clearRect(0, 0, W, H);
    const grd = g.createLinearGradient(0, 0, 0, H);
    grd.addColorStop(0, 'rgba(0,0,0,0.55)'); grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd; g.fillRect(0, 0, W, H);
    const cam = this.camView;
    const xOf = (az: number) => {
      const p = this.project(new THREE.Vector3(...dirFromAzEl(az, this.pitch)), cam);
      return p ? p.x * k : null;
    };
    const names: Record<number, string> = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' };
    g.textAlign = 'center';
    g.textBaseline = 'alphabetic';
    const mid = W / 2, fade = (x: number) => Math.max(0, 1 - Math.pow(Math.abs(x - mid) / (W * 0.5), 3));
    for (let az = 0; az < 360; az += 5) {
      if (Math.abs(wrap180(az - this.yaw)) > 80) continue;
      const x = xOf(az);
      if (x == null || x < 0 || x > W) continue;
      const a = fade(x);
      const major = az % 15 === 0;
      g.fillStyle = `rgba(230,236,242,${(major ? 0.7 : 0.35) * a})`;
      g.fillRect(Math.round(x), H - (major ? 12 : 7) * k, Math.max(1, k), (major ? 8 : 4) * k);
      if (major && Math.abs(x - mid) > 34 * k) {
        g.font = `${names[az] ? 600 : 400} ${11 * k}px Inter, system-ui, sans-serif`;
        g.fillStyle = `rgba(230,236,242,${(names[az] ? 0.95 : 0.6) * a})`;
        g.fillText(names[az] ?? String(az), x, 17 * k);
      }
    }
    const mark = (b: BodyReadout, color: string) => {
      const d = wrap180(b.az - this.yaw);
      let x = Math.abs(d) <= 80 ? xOf(b.az) : null;
      const off = x == null || x < 8 * k || x > W - 8 * k;
      if (off) x = d < 0 ? 10 * k : W - 10 * k;
      const y = H - 16 * k;
      g.lineWidth = 1.5 * k;
      g.strokeStyle = color; g.fillStyle = color;
      if (off) {
        g.beginPath();
        const s = d < 0 ? -1 : 1;
        g.moveTo(x! + s * 5 * k, y); g.lineTo(x! - s * 2 * k, y - 4 * k); g.lineTo(x! - s * 2 * k, y + 4 * k); g.closePath(); g.fill();
      } else {
        g.beginPath(); g.arc(x!, y, 4 * k, 0, Math.PI * 2);
        if (b.visible) g.fill(); else g.stroke();
      }
    };
    mark(r.sun, '#e69f00');
    mark(r.earth, '#56b4e9');
    // heading readout
    const hd = `${String(Math.round(this.yaw) % 360).padStart(3, '0')}° ${compass(this.yaw)}`;
    g.font = `500 ${12 * k}px "JetBrains Mono", "SF Mono", ui-monospace, Menlo, Consolas, "DejaVu Sans Mono", monospace`;
    const tw = g.measureText(hd).width + 14 * k;
    g.fillStyle = 'rgba(12,16,22,0.8)';
    g.strokeStyle = 'rgba(255,255,255,0.18)'; g.lineWidth = k;
    g.beginPath(); g.roundRect(mid - tw / 2, 4 * k, tw, 18 * k, 4 * k); g.fill(); g.stroke();
    g.fillStyle = '#f2f5f8';
    g.fillText(hd, mid, 17 * k);
    g.fillRect(mid - 0.5 * k, 24 * k, k, 10 * k);
  }

  // --- FEATURE (C): external view control for the guided tour (src/features/explain.ts)
  setView(v: { cam?: Cam; t?: number; look?: 'sun' | 'earth'; ab?: AB }) {
    if (!this.ctx) return;
    this.setPlaying(false);
    if (v.ab) this.setAB(v.ab);
    if (v.t != null) {
      const sp = this.span();
      this.t = clamp(v.t, sp.t0, sp.t1);
      try { this.ro = readout(this.ctx.ephem, this.frameF, this.hz, this.feats, this.t, this.ctx.state.mode); } catch { /* keep */ }
    }
    if (v.cam && this.renderer) this.setCam(v.cam);
    if (v.look && this.renderer) this.look(v.look);
    this.dirty = true;
    this.writeUrl(true);
    this.announce(true);
  }

  dispose() {
    cancelAnimationFrame(this.raf); this.raf = 0;
    document.removeEventListener('keydown', this.onKey);
    document.removeEventListener('pointerdown', this.onDocDown);
    document.removeEventListener('fullscreenchange', this.onFs);
    this.resizeObs?.disconnect(); this.interObs?.disconnect();
    this.terrain?.dispose(); this.lander?.dispose(); this.sky?.dispose(); this.globe?.dispose();
    this.orbit?.dispose(); this.globeCtl?.dispose();
    this.sunLight.shadow.map?.dispose();
    this.post?.dispose();
    disposeLanderEnv();
    disposeTextures();
    this.renderer?.dispose();
    this.root.remove();
  }
}

let sim: Simulator | null = null;

/** Mount (or re-attach) the simulator into `slot`. Safe to call on every page render. */
export function mountSim(slot: HTMLElement | null, ctx: SimContext): void {
  if (!slot) return;
  try {
    sim ??= new Simulator();
    sim.attach(slot, ctx);
  } catch (e) {
    console.warn('simulator failed to mount', e);
    slot.innerHTML = `<p class="sim-fallback" role="note">The 3D simulator could not start (${esc(String((e as Error).message))}). The mission brief below still works.</p>`;
  }
}

/** Set camera / time / pointing from outside (guided tour). No-op before the simulator mounts. */
export function simView(v: { cam?: Cam; t?: number; look?: 'sun' | 'earth'; ab?: AB }): void {
  sim?.setView(v);
}

/** Tear everything down (WebGL context, geometries, listeners, cached textures). */
export function unmountSim(): void {
  sim?.dispose();
  sim = null;
}
