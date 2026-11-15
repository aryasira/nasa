// AI-ASSISTED: drafted with Claude (Anthropic), reviewed by the human team.
// 3D mission simulator (hero of the page). Mounted by a small hook in main.ts; state (site, baseline date,
// stay, slip, mode) stays in main.ts's permalink state, the sim only adds view parameters
// (cam, simt, ab, size) to the query string. All Sun/Earth numbers come from the engine's observe().
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { FeaturesFile, HorizonFile, Site } from '@contracts/types';
import type { Ephem } from '../engine/ephem';
import { fmtUtc, parseUtc } from '../engine/ephem';
import { siteFrame, type SiteFrame } from '../engine/geometry';
import { scanWindow, type Scan } from '../engine/metrics';
import { compass } from '../engine/causes';
import type { Mode } from '../engine/visibility';
import { dirFromAzEl, featureIndex, fmtAz, fmtEl, fmtMet, readout, type BodyReadout, type FeatureIndex, type Readout } from './astro';
import { Terrain } from './terrain';
import { Lander } from './lander';
import { Sky, SKY_R } from './sky';
import { Globe } from './globe';
import './sim.css';

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
const SPEEDS = [{ v: 3600, label: '1 h/s' }, { v: 21600, label: '6 h/s' }, { v: 86400, label: '1 day/s' }, { v: 259200, label: '3 days/s' }];
const SIZES = [1, 3, 6, 12];
const CAMS: { id: Cam; label: string }[] = [{ id: 'lander', label: 'Lander cam' }, { id: 'orbit', label: 'Orbit' }, { id: 'globe', label: 'Moon globe' }];
// Captured at import time: main.ts rewrites the query string on every render and keeps only its own keys.
const INITIAL = new URLSearchParams(typeof location === 'undefined' ? '' : location.search);
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const v3 = (a: [number, number, number]) => new THREE.Vector3(a[0], a[1], a[2]);
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const utcMin = (t: number) => fmtUtc(t).slice(0, 16) + 'Z';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', html = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
}

class Simulator {
  readonly root = el('section', 'sim');
  private ctx!: SimContext;
  private site!: Site;
  private hz!: HorizonFile;
  private frameF!: SiteFrame;
  private feats: FeatureIndex = new Map();
  private siteKey = '';
  // time
  private t = 0;
  private ab: AB = (INITIAL.get('ab') === 'b' ? 'b' : 'a');
  private playing = !matchMedia('(prefers-reduced-motion: reduce)').matches && !INITIAL.has('simt');
  private speed = 21600;
  private slipPreview: number | null = null;
  private keepMet: number | null = null; // mission-elapsed time to restore after a commit re-renders the page
  private cam: Cam = (['lander', 'orbit', 'globe'] as const).find((c) => c === INITIAL.get('cam')) ?? 'orbit';
  private size = SIZES.includes(Number(INITIAL.get('size'))) ? Number(INITIAL.get('size')) : 6;
  private pendingSimT: number | null = INITIAL.has('simt') ? (() => { try { return parseUtc(INITIAL.get('simt')!); } catch { return null; } })() : null;
  private ro: Readout | null = null;
  private scan: Scan | null = null;
  // three
  private renderer: THREE.WebGLRenderer | null = null;
  private scene = new THREE.Scene();
  private camLander = new THREE.PerspectiveCamera(70, 1, 0.05, 400_000);
  private camOrbit = new THREE.PerspectiveCamera(58, 1, 0.1, 400_000);
  private insetCam = new THREE.PerspectiveCamera(32, 1, 0.01, 100);
  private orbit: OrbitControls | null = null;
  private globeCtl: OrbitControls | null = null;
  private sunLight = new THREE.DirectionalLight(0xfff3e0, 0);
  private earthLight = new THREE.DirectionalLight(0x9fc9ff, 0);
  private ambient = new THREE.AmbientLight(0xb8c4d6, 0.02);
  private terrain: Terrain | null = null;
  private lander: Lander | null = null;
  private sky: Sky | null = null;
  private globe: Globe | null = null;
  private yaw = 0;
  private pitch = 4;
  private raf = 0;
  private last = 0;
  private dirty = true;
  private onScreen = true;
  private lastHud = 0;
  private lastLive = 0;
  private lastUrl = 0;
  private liveText = '';
  private textCache = new WeakMap<Element, string>();
  // DOM
  private view = el('div', 'sim-view');
  private canvas = el('canvas', 'sim-canvas');
  private compassC = el('canvas', 'sim-compass');
  private labels = el('div', 'sim-labels');
  private lblSun = el('span', 'lbl lbl-sun');
  private lblEarth = el('span', 'lbl lbl-earth');
  private lblSite = el('span', 'lbl lbl-site');
  private hudClock = el('div', 'hud hud-clock');
  private hudSys = el('div', 'hud hud-sys');
  private hudCause = el('div', 'hud hud-cause');
  private hudSize = el('div', 'hud hud-size');
  private siteList = el('div', 'hud sim-sites');
  private fallback = el('div', 'sim-fallback');
  private live = el('p', 'sr-only');
  private q = <T extends Element>(sel: string) => this.root.querySelector(sel) as T;
  private resizeObs: ResizeObserver | null = null;
  private interObs: IntersectionObserver | null = null;
  private drag: { x: number; y: number; moved: boolean; id: number } | null = null;

  constructor() {
    this.root.setAttribute('aria-labelledby', 'sim-h');
    this.root.innerHTML = `
      <div class="sim-head"><h2 id="sim-h">Mission simulator</h2><span class="sim-where"></span><span class="sim-mock" hidden>MOCK DATA — synthetic, not results</span></div>`;
    this.canvas.setAttribute('role', 'img');
    this.canvas.setAttribute('aria-label', '3D view of the landing site: the terrain skyline from the horizon profile, a generic lander, and the Sun and Earth at their computed positions. The same status is given as text below.');
    this.canvas.tabIndex = 0;
    this.labels.append(this.lblSun, this.lblEarth, this.lblSite);
    for (const h of [this.hudClock, this.hudSys, this.hudCause, this.hudSize, this.labels, this.compassC]) h.setAttribute('aria-hidden', 'true');
    this.fallback.hidden = true;
    this.view.append(this.canvas, this.compassC, this.labels, this.hudClock, this.hudSys, this.hudCause, this.hudSize, this.siteList, this.fallback);
    this.root.append(this.view, this.buildConsole(), this.live);
    this.live.setAttribute('aria-live', 'polite');
    this.live.id = 'sim-live';
    this.hudClock.innerHTML = `<div class="k">UTC</div><div class="clock" data-f="utc"></div>
      <div class="row2"><span class="k">MET</span> <span data-f="met"></span></div>
      <div class="row2"><span class="k">STAY</span> <span data-f="stay"></span></div>
      <div class="row2 view-row"><span class="k">VIEW</span> <span data-f="view"></span></div>`;
    this.hudSys.innerHTML = `
      <div class="sys sys-sun"><div class="sys-h"><span class="k">POWER</span><span class="state" data-f="pstate"></span></div>
        <div class="bar"><i data-f="pbar"></i></div><div class="pct" data-f="ppct"></div>
        <dl><dt>SUN AZ</dt><dd data-f="saz"></dd><dt>SUN EL</dt><dd data-f="sel"></dd><dt>HORIZON</dt><dd data-f="sh"></dd></dl></div>
      <div class="sys sys-earth"><div class="sys-h"><span class="k">COMM</span><span class="state" data-f="cstate"></span></div>
        <div class="bar"><i data-f="cbar"></i></div><div class="pct" data-f="cpct"></div>
        <dl><dt>EARTH AZ</dt><dd data-f="eaz"></dd><dt>EARTH EL</dt><dd data-f="eel"></dd><dt>HORIZON</dt><dd data-f="eh"></dd></dl></div>`;
    this.hudCause.innerHTML = `<div class="cause-line" data-f="csun"></div><div class="cause-line" data-f="cearth"></div>`;
    this.initThree();
    document.addEventListener('keydown', this.onKey);
  }

  // ---------------------------------------------------------------- console (real controls)
  private buildConsole(): HTMLElement {
    const c = el('div', 'sim-console');
    c.innerHTML = `
      <div class="c-row c-transport" role="group" aria-label="Time controls">
        <button type="button" data-a="back" aria-label="Step back 1 hour">−1 h</button>
        <button type="button" data-a="play" class="btn-play" aria-label="Play"></button>
        <button type="button" data-a="fwd" aria-label="Step forward 1 hour">+1 h</button>
        <label class="inline">Speed <select data-a="speed">${SPEEDS.map((s) => `<option value="${s.v}">${s.label}</option>`).join('')}</select></label>
        <span class="c-hint">Space: play/pause · ←/→: step 1 h</span>
      </div>
      <div class="c-row c-scrub">
        <label for="sim-scrub" class="k">TIME</label>
        <div class="scrub">
          <div class="scrub-bands"></div>
          <canvas class="scrub-strip" aria-hidden="true"></canvas>
          <input id="sim-scrub" type="range" min="0" max="1" step="600" aria-describedby="sim-scrub-help">
        </div>
        <span id="sim-scrub-help" class="c-legend"><span class="sw-sun"></span>Sun in view <span class="sw-earth"></span>Earth in view</span>
      </div>
      <div class="c-row c-setup">
        <div class="slipbox"><label for="sim-slip">LAUNCH SLIP: <output data-f="slipv"></output></label>
          <input id="sim-slip" type="range" min="0" max="60" step="1" class="slip"><div class="ticks" aria-hidden="true"><span>0</span><span>15</span><span>30</span><span>45</span><span>60 d</span></div></div>
        <div class="seg" role="group" aria-label="Which stay to play">
          <button type="button" data-ab="a">BASELINE</button><button type="button" data-ab="b">SLIPPED</button></div>
        <div class="seg" role="group" aria-label="Camera">${CAMS.map((x) => `<button type="button" data-cam="${x.id}">${x.label}</button>`).join('')}</div>
        <label class="inline">Body size <select data-a="size">${SIZES.map((s) => `<option value="${s}">×${s}${s === 1 ? ' (true size)' : ''}</option>`).join('')}</select></label>
        <span class="look" role="group" aria-label="Point the lander cam"><button type="button" data-look="sun">Look at Sun</button><button type="button" data-look="earth">Look at Earth</button></span>
      </div>
      <p class="sim-caption"></p>`;
    c.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('button');
      if (!b) return;
      if (b.dataset.a === 'play') this.setPlaying(!this.playing);
      else if (b.dataset.a === 'back') this.step(-HOUR);
      else if (b.dataset.a === 'fwd') this.step(HOUR);
      else if (b.dataset.ab) this.setAB(b.dataset.ab as AB);
      else if (b.dataset.cam) this.setCam(b.dataset.cam as Cam);
      else if (b.dataset.look) this.look(b.dataset.look as 'sun' | 'earth');
    });
    const speed = c.querySelector<HTMLSelectElement>('[data-a="speed"]')!;
    speed.value = String(this.speed);
    speed.addEventListener('change', () => { this.speed = Number(speed.value); });
    const size = c.querySelector<HTMLSelectElement>('[data-a="size"]')!;
    size.value = String(this.size);
    size.addEventListener('change', () => { this.size = Number(size.value); this.dirty = true; this.writeUrl(); });
    const scrub = c.querySelector<HTMLInputElement>('#sim-scrub')!;
    scrub.addEventListener('input', () => {
      this.t = Number(scrub.value);
      const [a, b] = this.stays();
      if (b && (this.t < (this.ab === 'a' ? a.t0 : b.t0) || this.t > (this.ab === 'a' ? a.t1 : b.t1))) {
        this.ab = this.t >= b.t0 && this.t <= b.t1 ? 'b' : 'a';
      }
      this.dirty = true;
    });
    scrub.addEventListener('change', () => this.writeUrl());
    const slip = c.querySelector<HTMLInputElement>('#sim-slip')!;
    slip.addEventListener('input', () => {
      // Preview the slipped stay locally; commit to the page state on release.
      const met = this.t - this.activeStart();
      this.slipPreview = Number(slip.value);
      if (this.ab === 'b') this.t = this.activeStart() + met;
      this.afterStaysChange();
    });
    slip.addEventListener('change', () => {
      const v = Number(slip.value);
      this.keepMet = this.t - this.activeStart(); // measured against the previewed stay
      this.slipPreview = null;
      if (this.ab === 'b' && v === 0) this.ab = 'a';
      this.commit({ slip: v });
    });
    return c;
  }

  private commit(patch: Partial<Pick<SimState, 'site' | 'slip'>>) {
    const f = document.activeElement as HTMLElement | null;
    this.ctx.setState(patch);
    if (f && this.root.contains(f) && document.activeElement !== f) f.focus({ preventScroll: true });
    else if (f?.dataset.site) this.siteList.querySelector<HTMLButtonElement>(`button[data-site="${CSS.escape(f.dataset.site)}"]`)?.focus({ preventScroll: true });
  }

  // ---------------------------------------------------------------- three.js
  private initThree() {
    try {
      // Probe on a throwaway canvas so three.js gets the real canvas with its own context attributes.
      if (!document.createElement('canvas').getContext('webgl2')) throw new Error('WebGL 2 is not available');
      this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, logarithmicDepthBuffer: true, powerPreference: 'high-performance' });
    } catch (e) {
      this.renderer = null;
      this.showFallback(`The 3D view needs WebGL 2, which this browser or device does not provide (${(e as Error).message}). The readouts and controls below still work, and so does the mission brief.`);
      return;
    }
    const r = this.renderer;
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.VSMShadowMap; // soft, without the streaks PCF gives at grazing Sun angles
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.05;
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.setClearColor(0x020306, 1);
    this.canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); this.showFallback('The 3D view lost its graphics context. Reload the page to restore it; the readouts below still work.'); });

    this.scene.background = new THREE.Color(0x020306);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.set(2048, 2048);
    const sc = this.sunLight.shadow.camera;
    sc.left = -14; sc.right = 14; sc.top = 14; sc.bottom = -14; sc.near = 1; sc.far = 600;
    this.sunLight.shadow.bias = -0.0005;
    this.sunLight.shadow.normalBias = 0.04;
    this.sunLight.shadow.radius = 3;
    this.sunLight.shadow.blurSamples = 10;
    this.scene.add(this.sunLight, this.sunLight.target, this.earthLight, this.earthLight.target, this.ambient);
    this.sky = new Sky();
    this.scene.add(this.sky.group);
    this.camLander.rotation.order = 'YXZ';

    this.orbit = new OrbitControls(this.camOrbit, this.canvas);
    this.orbit.enableDamping = true;
    this.orbit.dampingFactor = 0.12;
    this.orbit.minDistance = 3; this.orbit.maxDistance = 90;
    this.orbit.maxPolarAngle = Math.PI * 0.495;
    this.orbit.target.set(0, 1.1, 0);
    this.orbit.addEventListener('change', () => { this.dirty = true; });

    this.canvas.addEventListener('pointerdown', this.onDown);
    this.canvas.addEventListener('pointermove', this.onMove);
    this.canvas.addEventListener('pointerup', this.onUp);
    this.canvas.addEventListener('pointercancel', () => { this.drag = null; });
    this.resizeObs = new ResizeObserver(() => this.resize());
    this.resizeObs.observe(this.view);
    this.interObs = new IntersectionObserver((es) => { this.onScreen = es.some((x) => x.isIntersecting); if (this.onScreen) this.dirty = true; }, { threshold: 0.05 });
    this.interObs.observe(this.view);
  }

  private showFallback(msg: string) {
    this.fallback.hidden = false;
    this.fallback.setAttribute('role', 'note');
    this.fallback.textContent = msg;
    this.canvas.hidden = true;
    this.view.classList.add('no-gl');
    // Camera and drawing controls have nothing to drive without WebGL.
    this.root.querySelectorAll<HTMLButtonElement | HTMLSelectElement>('[data-cam], [data-look], [data-a="size"]').forEach((x) => { x.disabled = true; });
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
    const key = `${site.id}|${ctx.mock}`;
    const siteChanged = key !== this.siteKey;
    this.site = site; this.hz = hz; this.frameF = siteFrame(site);
    if (siteChanged) { this.siteKey = key; this.buildSite(); }
    if (!this.globe && this.renderer) { this.globe = new Globe(ctx.sites); this.setupGlobeControls(); }
    // Keep mission-elapsed time across re-renders; first mount honours ?simt=.
    const [a] = this.stays();
    if (this.pendingSimT != null) {
      this.t = this.pendingSimT; this.pendingSimT = null;
      const [, b] = this.stays();
      if (this.ab === 'b' && b && (this.t < b.t0 || this.t > b.t1)) this.ab = 'a';
    } else this.t = (prev ? met : 0) + this.activeStart();
    if (!Number.isFinite(this.t)) this.t = a.t0;
    this.q<HTMLElement>('.sim-mock').hidden = !ctx.mock;
    this.q<HTMLElement>('.sim-where').textContent =
      `${site.name} · ${Math.abs(site.lat).toFixed(3)}°${site.lat < 0 ? 'S' : 'N'} ${site.lon_e.toFixed(3)}°E`;
    this.q<HTMLElement>('.sim-caption').textContent = hz.dem.product === 'sphere'
      ? 'No terrain model for this site: smooth-sphere (flat) horizon. Near-field ground and lander are illustrative. Sun and Earth positions are computed; their drawn size is enlarged by the body-size factor.'
      : 'Terrain silhouette from the LOLA horizon profile; near-field ground is illustrative. Ridge distances are clamped to 0.3–20 km for drawing (elevation angles are exact). Sun and Earth positions are computed; their drawn size is enlarged by the body-size factor.';
    this.siteList.innerHTML = `<div class="k">SITES — click to select</div>` + ctx.sites.map((s) =>
      `<button type="button" data-site="${esc(s.id)}" aria-pressed="${s.id === site.id}">${esc(s.name)}</button>`).join('');
    this.siteList.querySelectorAll<HTMLButtonElement>('button[data-site]').forEach((b) =>
      b.addEventListener('click', () => { if (b.dataset.site !== this.site.id) this.commit({ site: b.dataset.site! }); }));
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
    this.terrain = new Terrain(this.hz);
    this.lander = new Lander(this.hz.mast_m);
    this.scene.add(this.terrain.group, this.lander.group);
    this.camLander.position.set(0, this.hz.mast_m, 0);
  }

  private setupGlobeControls() {
    if (!this.globe || !this.renderer) return;
    this.globeCtl = new OrbitControls(this.globe.camera, this.canvas);
    this.globeCtl.enablePan = false;
    this.globeCtl.minDistance = 1.6; this.globeCtl.maxDistance = 9;
    this.globeCtl.enableDamping = true;
    this.globeCtl.addEventListener('change', () => { this.dirty = true; });
    this.globeCtl.enabled = this.cam === 'globe';
  }

  private frameCameras() {
    if (!this.ctx) return;
    // Orbit: low, 3/4 view toward the Sun (or Earth if the Sun is down) so the lit side and the skyline both show.
    const t0 = this.activeStart();
    const r = readout(this.ctx.ephem, this.frameF, this.hz, this.feats, clamp(this.t || t0, this.ctx.ephem.t0, this.ctx.ephem.tLast), this.ctx.state.mode);
    // Aim between the Sun and Earth when both are up and close enough to share the frame.
    const sunUp = r.sun.aboveFlat || r.sun.visible, earthUp = r.earth.aboveFlat || r.earth.visible;
    let az = sunUp ? r.sun.az : r.earth.az;
    const gap = ((r.earth.az - r.sun.az + 540) % 360) - 180;
    const both = sunUp && earthUp && Math.abs(gap) < 60;
    if (both) az = r.sun.az + gap / 2;
    const look = dirFromAzEl(az + (both ? 0 : 22), 0);
    this.camOrbit.position.set(-look[0] * 9.5, 2.3, -look[2] * 9.5);
    this.orbit?.target.set(0, 1.6, 0);
    this.orbit?.update();
    this.yaw = az; this.pitch = clamp((r.sun.aboveFlat ? r.sun.el : r.earth.el) * 0.5, -10, 30);
    if (this.globe) {
      this.globe.frame(this.site.id);
      this.globeCtl?.update();
      this.globe.frame(this.site.id, this.insetCam, 3.4);
    }
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
    this.dirty = true;
  }

  private drawScrub() {
    const sp = this.span(), [a, b] = this.stays();
    const scrub = this.q<HTMLInputElement>('#sim-scrub');
    scrub.min = String(sp.t0); scrub.max = String(sp.t1);
    const pct = (t: number) => (100 * (t - sp.t0)) / Math.max(1, sp.t1 - sp.t0);
    const band = (x: { t0: number; t1: number }, cls: string, label: string) =>
      `<div class="band ${cls}" style="left:${pct(x.t0)}%;width:${pct(x.t1) - pct(x.t0)}%"><span>${label}</span></div>`;
    this.q<HTMLElement>('.scrub-bands').innerHTML = band(a, 'band-a', 'BASELINE') + (b ? band(b, 'band-b', 'SLIPPED') : '');
    const cv = this.q<HTMLCanvasElement>('.scrub-strip');
    const w = Math.max(200, cv.clientWidth || 600), h = 14;
    cv.width = w; cv.height = h;
    const g = cv.getContext('2d');
    if (!g || !this.scan) return;
    g.clearRect(0, 0, w, h);
    const s = this.scan;
    for (let k = 0; k < s.n; k++) {
      const x0 = Math.floor((k / s.n) * w), x1 = Math.ceil(((k + 1) / s.n) * w);
      if (s.sunVis[k]) { g.fillStyle = '#e69f00'; g.fillRect(x0, 0, x1 - x0, 6); }
      if (s.earthVis[k]) { g.fillStyle = '#56b4e9'; g.fillRect(x0, 8, x1 - x0, 6); }
    }
  }

  private setPlaying(p: boolean) {
    this.playing = p;
    if (p) { const sp = this.span(); if (this.t >= sp.t1 - 1) this.t = this.activeStart(); }
    this.syncButtons();
    if (!p) this.writeUrl();
    this.dirty = true;
  }
  private step(dt: number) {
    const sp = this.span();
    this.t = clamp(Math.round((this.t + dt) / 60) * 60, sp.t0, sp.t1);
    this.dirty = true;
    this.writeUrl();
    this.announce(true);
  }
  private setAB(ab: AB) {
    const [, b] = this.stays();
    if (ab === 'b' && !b) return;
    const met = this.t - this.activeStart();
    this.ab = ab;
    this.t = this.activeStart() + met;
    this.afterStaysChange();
    this.syncButtons();
    this.writeUrl();
    this.announce(true);
  }
  private setCam(c: Cam) {
    this.cam = c;
    if (this.orbit) this.orbit.enabled = c === 'orbit';
    if (this.globeCtl) this.globeCtl.enabled = c === 'globe';
    this.syncButtons();
    this.writeUrl();
    this.dirty = true;
  }
  private look(which: 'sun' | 'earth') {
    if (!this.ro) return;
    if (this.cam !== 'lander') this.setCam('lander');
    const b = which === 'sun' ? this.ro.sun : this.ro.earth;
    this.yaw = b.az; this.pitch = clamp(b.el, -20, 75);
    this.dirty = true;
  }

  private syncButtons() {
    const play = this.q<HTMLButtonElement>('[data-a="play"]');
    play.textContent = this.playing ? '❚❚ PAUSE' : '▶ PLAY';
    play.setAttribute('aria-label', this.playing ? 'Pause' : 'Play');
    play.setAttribute('aria-pressed', String(this.playing));
    const [, b] = this.stays();
    this.root.querySelectorAll<HTMLButtonElement>('[data-ab]').forEach((x) => {
      x.setAttribute('aria-pressed', String(x.dataset.ab === this.ab));
      x.disabled = x.dataset.ab === 'b' && !b;
    });
    this.root.querySelectorAll<HTMLButtonElement>('[data-cam]').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.cam === this.cam)));
    this.q<HTMLElement>('.look').hidden = this.cam === 'globe';
    const slip = this.q<HTMLInputElement>('#sim-slip');
    const s = this.slipDays();
    if (document.activeElement !== slip) slip.value = String(clamp(s, 0, 60));
    this.q<HTMLOutputElement>('[data-f="slipv"]').textContent = `${s >= 0 ? '+' : '−'}${Math.abs(s)} days${s < 0 || s > 60 ? ' (set in the brief controls)' : ''}`;
    this.view.dataset.cam = this.cam;
  }

  private writeUrl(force = false) {
    const now = performance.now();
    if (!force && this.playing && now - this.lastUrl < 2000) return;
    this.lastUrl = now;
    const q = new URLSearchParams(location.search);
    q.set('cam', this.cam);
    q.set('simt', utcMin(this.t));
    if (this.ab === 'b') q.set('ab', 'b'); else q.delete('ab');
    q.set('size', String(this.size));
    history.replaceState(history.state, '', `${location.pathname}?${q}`);
  }

  // ---------------------------------------------------------------- input
  private onKey = (e: KeyboardEvent) => {
    if (!this.root.isConnected || !this.onScreen || e.altKey || e.ctrlKey || e.metaKey) return;
    const tg = e.target as HTMLElement | null;
    if (tg && (tg.closest('input, select, textarea, button, a, [contenteditable="true"], summary'))) return;
    if (e.key === ' ' || e.code === 'Space') { e.preventDefault(); this.setPlaying(!this.playing); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); this.step(-HOUR); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); this.step(HOUR); }
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
    if (!d || d.moved) return;
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left, y = e.clientY - rect.top;
    if (this.cam === 'globe' && this.globe) {
      const ray = new THREE.Raycaster();
      ray.setFromCamera(new THREE.Vector2((x / rect.width) * 2 - 1, -(y / rect.height) * 2 + 1), this.globe.camera);
      const id = this.globe.pick(ray);
      if (id && id !== this.site.id) this.commit({ site: id });
    } else {
      const ins = this.insetRect();
      if (ins && x >= ins.x && x <= ins.x + ins.s && y >= rect.height - ins.y - ins.s && y <= rect.height - ins.y) this.setCam('globe');
    }
  };

  // ---------------------------------------------------------------- frame loop
  private resize() {
    if (!this.renderer) return;
    const w = Math.max(1, this.view.clientWidth), h = Math.max(1, this.view.clientHeight);
    this.renderer.setSize(w, h, false);
    for (const c of [this.camLander, this.camOrbit]) { c.aspect = w / h; c.updateProjectionMatrix(); }
    if (this.globe) { this.globe.camera.aspect = w / h; this.globe.camera.updateProjectionMatrix(); }
    this.compassC.width = w * Math.min(2, devicePixelRatio || 1);
    this.compassC.height = 40 * Math.min(2, devicePixelRatio || 1);
    this.drawScrub();
    // Resizing clears the canvas: redraw now (ResizeObserver runs before paint) instead of on the next frame.
    if (this.ctx) this.update(performance.now()); else this.dirty = true;
  }

  private insetRect() {
    if (this.cam === 'globe' || !this.renderer) return null;
    const w = this.view.clientWidth;
    const s = w < 700 ? 0 : w < 1000 ? 120 : 150;
    return s ? { x: 12, y: 12, s } : null;
  }

  private loop = (now: number) => {
    this.raf = requestAnimationFrame(this.loop);
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    if (!this.ctx) return;
    if (this.playing) {
      const sp = this.span();
      this.t += dt * this.speed;
      if (this.t >= sp.t1) { this.t = sp.t1; this.setPlaying(false); }
      this.dirty = true;
    }
    if (this.orbit?.enabled && this.orbit.update()) this.dirty = true;
    if (this.globeCtl?.enabled && this.globeCtl.update()) this.dirty = true;
    if (!this.dirty || !this.onScreen) return;
    this.dirty = false;
    this.update(now);
  };

  private update(now: number) {
    const ctx = this.ctx;
    let r: Readout;
    try { r = readout(ctx.ephem, this.frameF, this.hz, this.feats, this.t, ctx.state.mode); }
    catch { return; }
    this.ro = r;
    if (now - this.lastHud > 60 || !this.playing) { this.lastHud = now; this.updateHud(r); }
    this.announce(false);
    if (this.playing) this.writeUrl();
    if (!this.renderer || !this.sky || !this.terrain || !this.lander) return;

    const sunDir = v3(dirFromAzEl(r.sun.az, r.sun.el));
    const earthDir = v3(dirFromAzEl(r.earth.az, r.earth.el));
    const sunK = r.power.pct / 100; // disc fraction above terrain (0 when hidden or totally eclipsed)
    this.sunLight.intensity = 3.2 * sunK;
    this.sunLight.position.copy(sunDir).multiplyScalar(300);
    this.sunLight.visible = sunK > 0;
    const earthK = r.earth.visible ? r.earth.frac * r.earthLitFrac : 0;
    this.earthLight.intensity = 0.7 * earthK; // earthshine, strongly exaggerated so the night scene is readable
    this.earthLight.position.copy(earthDir).multiplyScalar(300);
    this.ambient.intensity = 0.02 + 0.22 * sunK + 0.06 * earthK; // regolith bounce when sunlit
    this.lander.point(sunDir, earthDir);
    this.terrain.setHighlight(0, r.sun.blocker ? r.sun.az : null);
    this.terrain.setHighlight(1, r.earth.blocker ? r.earth.az : null);

    const cam = this.cam === 'orbit' ? this.camOrbit : this.camLander;
    if (this.cam === 'lander') this.camLander.rotation.set((this.pitch * Math.PI) / 180, (-this.yaw * Math.PI) / 180, 0, 'YXZ');
    this.sky.update(sunDir, r.sun.r, earthDir, r.earth.r, this.size, sunK > 0.02 ? 0 : 1, cam, r.sun.visible, r.earth.visible);
    if (this.globe) {
      const s = ctx.ephem.sample(this.t);
      this.globe.update(s.sun, s.earth, this.site.id);
    }
    const R = this.renderer;
    const w = this.view.clientWidth, h = this.view.clientHeight;
    R.setScissorTest(false);
    R.setViewport(0, 0, w, h);
    if (this.cam === 'globe' && this.globe) R.render(this.globe.scene, this.globe.camera);
    else {
      R.render(this.scene, cam);
      const ins = this.insetRect();
      if (ins && this.globe) {
        this.insetCam.aspect = 1; this.insetCam.updateProjectionMatrix();
        R.setScissorTest(true);
        R.setViewport(ins.x, ins.y, ins.s, ins.s); R.setScissor(ins.x, ins.y, ins.s, ins.s);
        R.setClearColor(0x05080d, 1); R.clear();
        R.render(this.globe.scene, this.insetCam);
        R.setScissorTest(false); R.setClearColor(0x020306, 1);
        R.setViewport(0, 0, w, h);
      }
      this.view.style.setProperty('--inset', ins ? `${ins.s + 12}px` : '0px');
    }
    this.placeLabels(r, cam, sunDir, earthDir);
        this.drawCompass(r);
  }

  private set(f: string, v: string, html = false) {
    const e = this.root.querySelector(`[data-f="${f}"]`);
    if (!e || this.textCache.get(e) === v) return;
    this.textCache.set(e, v);
    if (html) e.innerHTML = v; else e.textContent = v;
  }

  private updateHud(r: Readout) {
    const [a, b] = this.stays();
    const start = this.ab === 'b' && b ? b.t0 : a.t0;
    const inStay = this.t >= start && this.t <= start + this.ctx.state.stay * DAY;
    this.set('utc', fmtUtc(this.t).replace('T', ' ').replace('Z', ''));
    this.set('met', `${fmtMet(this.t - start)} since landing`);
    this.set('stay', `${this.ab === 'b' ? 'SLIPPED' : 'BASELINE'} · day ${((this.t - start) / DAY).toFixed(1)} of ${this.ctx.state.stay}${inStay ? '' : ' (outside stay)'}`);
    this.set('view', this.cam === 'lander' ? `mast cam · heading ${this.yaw.toFixed(0).padStart(3, '0')}° (${compass(this.yaw)}) · pitch ${fmtEl(this.pitch)}` : this.cam === 'orbit' ? 'orbit · drag, wheel to zoom' : 'globe · drag, click a site');
    this.set('pstate', r.power.state);
    this.set('ppct', `${r.power.pct.toFixed(0)}% of Sun disc above terrain${r.power.note ? ' · ' + r.power.note : ''}`);
    (this.q<HTMLElement>('[data-f="pbar"]')).style.width = `${r.power.pct}%`;
    this.set('saz', fmtAz(r.sun.az)); this.set('sel', fmtEl(r.sun.el)); this.set('sh', `${fmtEl(r.sun.horizonEl)} @ ${r.sun.az.toFixed(1)}°`);
    this.set('cstate', r.comm.state);
    this.set('cpct', `${(r.earth.frac * 100).toFixed(0)}% of Earth disc above terrain · Earth ${(r.earthLitFrac * 100).toFixed(0)}% lit`);
    (this.q<HTMLElement>('[data-f="cbar"]')).style.width = `${r.earth.frac * 100}%`;
    this.set('eaz', fmtAz(r.earth.az)); this.set('eel', fmtEl(r.earth.el)); this.set('eh', `${fmtEl(r.earth.horizonEl)} @ ${r.earth.az.toFixed(1)}°`);
    this.hudSys.dataset.power = r.power.state.split(' ')[0];
    this.hudSys.dataset.comm = r.comm.state.split(' ')[0];
    this.set('csun', this.causeHtml('Sun', r.sun, r), true);
    this.set('cearth', this.causeHtml('Earth', r.earth, r), true);
    this.q<HTMLElement>('[data-f="csun"]').dataset.blocked = String(!!r.sun.blocker);
    this.q<HTMLElement>('[data-f="cearth"]').dataset.blocked = String(!!r.earth.blocker);
    const sizeTxt = `BODY SIZE ×${this.size}${this.size === 1 ? ' (true size)' : ' (enlarged)'}`;
    if (this.textCache.get(this.hudSize) !== sizeTxt) { this.textCache.set(this.hudSize, sizeTxt); this.hudSize.textContent = sizeTxt; }
    const scrub = this.q<HTMLInputElement>('#sim-scrub');
    if (document.activeElement !== scrub) scrub.value = String(this.t);
    scrub.setAttribute('aria-valuetext', `${fmtUtc(this.t).slice(0, 16).replace('T', ' ')} UTC, ${fmtMet(this.t - start)} since ${this.ab === 'b' ? 'slipped' : 'baseline'} landing`);
  }

  private causeHtml(name: string, b: BodyReadout, r: Readout): string {
    const cls = name === 'Sun' ? 'c-sun' : 'c-earth';
    if (b.blocker) {
      const k = b.blocker;
      return `<span class="${cls} tagb">${name.toUpperCase()} BLOCKED</span> by <strong>${esc(k.name)}</strong> · az ${k.az.toFixed(1)}° (${compass(k.az)})`
        + (k.distKm != null ? ` · ${k.distKm < 10 ? k.distKm.toFixed(1) : k.distKm.toFixed(0)} km away` : '')
        + ` · ridge ${fmtEl(k.horizonEl)} vs ${name} ${fmtEl(k.bodyEl)}`;
    }
    if (b.visible) {
      const extra = name === 'Sun' && r.obs.eclipsePartial ? ' · Earth is covering part of the Sun' : '';
      return `<span class="${cls} tagb ok">${name.toUpperCase()} IN VIEW</span> clear line of sight · ${fmtEl(b.el - b.horizonEl)} above the local skyline${extra}`;
    }
    return `<span class="${cls} tagb dim">${name.toUpperCase()} DOWN</span> below the horizon — ${name === 'Sun' ? 'lunar night' : "the Moon's libration"} (orbital, not terrain)`;
  }

  private announce(force: boolean) {
    const r = this.ro;
    if (!r) return;
    const now = performance.now();
    if (!force && now - this.lastLive < 1000) return;
    const blk = (b: BodyReadout) => (b.blocker ? ` blocked by ${b.blocker.name} at azimuth ${b.blocker.az.toFixed(0)} degrees` : '');
    const states = `Power ${r.power.state}, ${r.power.pct.toFixed(0)} percent${blk(r.sun)}. Comm ${r.comm.state}${blk(r.earth)}.`;
    // While playing only state changes are announced; when paused or stepping, the time too.
    const txt = this.playing ? states
      : `${fmtUtc(this.t).slice(0, 16).replace('T', ' ')} UTC. ${states} Sun azimuth ${r.sun.az.toFixed(1)}, elevation ${r.sun.el.toFixed(1)}. Earth azimuth ${r.earth.az.toFixed(1)}, elevation ${r.earth.el.toFixed(1)}.`;
    this.lastLive = now;
    if (txt !== this.liveText) { this.liveText = txt; this.live.textContent = txt; }
  }

  private project(dir: THREE.Vector3, cam: THREE.Camera): { x: number; y: number } | null {
    const p = dir.clone().multiplyScalar(SKY_R).add(cam.position).project(cam);
    if (p.z > 1 || p.z < -1) return null;
    const w = this.view.clientWidth, h = this.view.clientHeight;
    return { x: ((p.x + 1) / 2) * w, y: ((1 - p.y) / 2) * h };
  }

  private placeLabels(r: Readout, cam: THREE.Camera, sunDir: THREE.Vector3, earthDir: THREE.Vector3) {
    const w = this.view.clientWidth, h = this.view.clientHeight;
    const put = (lbl: HTMLElement, p: { x: number; y: number } | null, text: string, hidden: boolean) => {
      if (!p || p.x < -40 || p.x > w + 40 || p.y < -20 || p.y > h + 20) { lbl.style.display = 'none'; return; }
      lbl.style.display = '';
      lbl.style.transform = `translate(${Math.round(p.x)}px, ${Math.round(p.y)}px)`;
      lbl.classList.toggle('hidden-body', hidden);
      if (this.textCache.get(lbl) !== text) { this.textCache.set(lbl, text); lbl.textContent = text; }
    };
    if (this.cam === 'globe' && this.globe) {
      const g = this.globe;
      const sp = new THREE.Vector3(...g.markers.find((m) => m.userData.siteId === this.site.id)!.position.toArray()).project(g.camera);
      const facing = g.camera.position.clone().dot(g.markers.find((m) => m.userData.siteId === this.site.id)!.position) > 0;
      put(this.lblSite, facing ? { x: ((sp.x + 1) / 2) * w, y: ((1 - sp.y) / 2) * h } : null, this.site.name, false);
      const s = this.ctx.ephem.sample(this.t);
      const tip = (v: [number, number, number], len: number) => {
        const d = new THREE.Vector3(v[0], v[2], -v[1]).normalize().multiplyScalar(1.05 + len).project(g.camera);
        return { x: ((d.x + 1) / 2) * w, y: ((1 - d.y) / 2) * h };
      };
      put(this.lblEarth, tip(s.earth, 0.36), 'to Earth', false);
      put(this.lblSun, tip(s.sun, 0.3), 'to Sun', false);
      return;
    }
    this.lblSite.style.display = 'none';
    const name = (b: BodyReadout, n: string) => (b.blocker ? `${n} — behind ${b.blocker.name}` : b.visible ? n : `${n} (below horizon)`);
    put(this.lblSun, this.project(sunDir, cam), name(r.sun, 'SUN'), !r.sun.visible);
    put(this.lblEarth, this.project(earthDir, cam), name(r.earth, 'EARTH'), !r.earth.visible);
  }

  private drawCompass(r: Readout) {
    const c = this.compassC;
    if (this.cam !== 'lander') { c.style.display = 'none'; return; }
    c.style.display = '';
    const g = c.getContext('2d');
    if (!g) return;
    const k = c.width / Math.max(1, this.view.clientWidth);
    const W = c.width, H = c.height;
    g.clearRect(0, 0, W, H);
    g.fillStyle = 'rgba(4,8,14,0.72)'; g.fillRect(0, 0, W, H);
    const xOf = (az: number) => {
      const p = this.project(new THREE.Vector3(...dirFromAzEl(az, this.pitch)), this.camLander);
      return p ? p.x * k : null;
    };
    g.font = `${11 * k}px ui-monospace, Menlo, Consolas, monospace`;
    g.textAlign = 'center';
    const names: Record<number, string> = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' };
    for (let az = 0; az < 360; az += 5) {
      const d = ((az - this.yaw + 540) % 360) - 180;
      if (Math.abs(d) > 75) continue;
      const x = xOf(az);
      if (x == null || x < 0 || x > W) continue;
      const major = az % 15 === 0;
      g.strokeStyle = 'rgba(200,215,230,0.6)'; g.lineWidth = k;
      g.beginPath(); g.moveTo(x, H); g.lineTo(x, H - (major ? 9 : 5) * k); g.stroke();
      if (major) {
        g.fillStyle = names[az] ? '#f0e442' : 'rgba(220,230,240,0.85)';
        g.fillText(names[az] ?? String(az), x, 12 * k);
      }
    }
    const mark = (b: BodyReadout, color: string, label: string) => {
      const d = ((b.az - this.yaw + 540) % 360) - 180;
      let x = Math.abs(d) <= 75 ? xOf(b.az) : null;
      let edge = false;
      if (x == null || x < 0 || x > W) { x = d < 0 ? 10 * k : W - 10 * k; edge = true; }
      g.fillStyle = color;
      g.beginPath(); g.moveTo(x, H - 1 * k); g.lineTo(x - 6 * k, H - 11 * k); g.lineTo(x + 6 * k, H - 11 * k); g.closePath();
      if (b.visible) g.fill(); else { g.strokeStyle = color; g.lineWidth = 1.5 * k; g.stroke(); }
      g.fillText(edge ? (d < 0 ? `◂ ${label} ${b.az.toFixed(0)}°` : `${label} ${b.az.toFixed(0)}° ▸`) : `${label} ${b.az.toFixed(0)}°`, x + (edge ? (d < 0 ? 40 : -40) * k : 0), H - 14 * k);
    };
    mark(r.sun, '#e69f00', 'SUN');
    mark(r.earth, '#56b4e9', 'EARTH');
    // Centre index (where the camera points).
    g.fillStyle = '#f0e442';
    g.fillRect(W / 2 - k, 14 * k, 2 * k, 8 * k);
  }

  dispose() {
    cancelAnimationFrame(this.raf); this.raf = 0;
    document.removeEventListener('keydown', this.onKey);
    this.resizeObs?.disconnect(); this.interObs?.disconnect();
    this.terrain?.dispose(); this.lander?.dispose(); this.sky?.dispose(); this.globe?.dispose();
    this.orbit?.dispose(); this.globeCtl?.dispose();
    this.sunLight.shadow.map?.dispose();
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

/** Tear everything down (WebGL context, geometries, listeners). */
export function unmountSim(): void {
  sim?.dispose();
  sim = null;
}
