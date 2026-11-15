// AI-ASSISTED: drafted with Claude (Anthropic), reviewed by the human team.
// Challenge-coverage panels, mounted by small hooks in main.ts after each page render:
// custom site entry, landing-date explorer, side-by-side comparison, plain-language mode + guided tour.
// All numbers come from the engine (see the pure modules next to this file).
import type { FeaturesFile, FixturesFile, HorizonFile, Site } from '@contracts/types';
import type { Ephem } from '../engine/ephem';
import { fmtUtc, parseUtc } from '../engine/ephem';
import { siteFrame } from '../engine/geometry';
import type { Mode } from '../engine/visibility';
import { simView } from '../sim';
import { augmentSites, checkCustom, CUSTOM_ID, customSite, isSphere, SPHERE_NOTE, sphereHorizon, type CustomInput } from './custom';
import { bestDates, DateScanner, monthlyMeans, rhythmDays, SPAN_D, type DateSeries } from './dates';
import { bestIndex, COLS, compareRow, sortRows, type ColKey, type CompareRow } from './compare';
import { NOTES, TOUR_TITLES, tourStep, type TourStep } from './explain';
import { FS, writeFeatureParams } from './state';
import './features.css';

export { writeFeatureParams };

export interface FeatData {
  ephem: Ephem; sites: Site[]; horizons: Map<string, HorizonFile>;
  features: FeaturesFile | null; fixtures: FixturesFile | null; mock: boolean;
}
export interface FeatPageState { site: string; t: string; stay: number; slip: number; mode: Mode }
export interface FeatCtx {
  data: FeatData;
  state: FeatPageState;
  setState: (p: Partial<FeatPageState>) => void;
}

const DAY = 86400;
const esc = (s: unknown) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const when = (iso: string | null) => (iso ? iso.slice(0, 16).replace('T', ' ') + ' UTC' : '—');
const day = (t: number) => fmtUtc(t).slice(0, 10);
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monYr = (t: number) => { const d = new Date(t * 1000); return `${MON[d.getUTCMonth()]} ${d.getUTCFullYear()}`; };
const idle = (fn: (deadline: { timeRemaining(): number }) => void) =>
  ('requestIdleCallback' in window ? (window as any).requestIdleCallback(fn, { timeout: 200 }) : setTimeout(() => fn({ timeRemaining: () => 8 }), 16));

/** loadData hook: sphere horizons for sphere sites without a file, plus the custom site from the URL. */
export function addSphereAndCustomSites(sites: Site[], horizons: Map<string, HorizonFile>): void {
  augmentSites(sites, horizons, FS.custom);
}

let ctx: FeatCtx;

/** Called at the end of every main.ts render. */
export function mountFeatures(c: FeatCtx): void {
  ctx = c;
  try {
    mountExplainBar();
    mountCustom();
    mountDates();
    mountCompare();
    sphereLabels();
    applyNotes();
  } catch (e) {
    console.warn('feature panels failed', e);
  }
}

const tStart = () => parseUtc(ctx.state.t + ':00Z');
const curSite = () => ctx.data.sites.find((s) => s.id === ctx.state.site)!;
const mockTag = () => (ctx.data.mock ? ' <span class="tag">mock data</span>' : '');

function insertAfter(ref: Element | null, el: Element) {
  if (ref?.parentElement) ref.parentElement.insertBefore(el, ref.nextSibling);
}
function sectionOf(h2id: string) { return document.getElementById(h2id)?.closest('section') ?? null; }

// ------------------------------------------------------------------------------------------- smooth-sphere labels
function sphereLabels() {
  const hz = ctx.data.horizons.get(ctx.state.site);
  if (!isSphere(hz)) return;
  const note = () => { const p = document.createElement('p'); p.className = 'sphere-note'; p.textContent = SPHERE_NOTE; return p; };
  sectionOf('h-sum')?.append(note());
  const site = sectionOf('h-site');
  if (site) site.querySelector('dl')?.after(note());
}

// ------------------------------------------------------------------------------------------- 6. explain + tour
function mountExplainBar() {
  const slot = document.getElementById('sim-slot');
  if (!slot) return;
  const bar = document.createElement('div');
  bar.className = 'feat-explain noprint';
  bar.innerHTML = `<div class="xp-row">
      <button type="button" class="switch" role="switch" id="xp-toggle" aria-checked="${FS.explain}" aria-describedby="xp-desc"><i></i></button>
      <label for="xp-toggle" class="xp-label">Explain</label>
      <span id="xp-desc" class="note">Plain-language notes next to the readouts, and a 5-step guided tour.</span>
    </div><div id="xp-tour"></div>`;
  slot.before(bar);
  bar.querySelector('#xp-toggle')!.addEventListener('click', () => {
    FS.explain = !FS.explain;
    writeFeatureParams();
    mountTour();
    applyNotes();
    bar.querySelector('#xp-toggle')!.setAttribute('aria-checked', String(FS.explain));
  });
  mountTour();
}

const stepCache = new Map<string, TourStep>();
let focusTour = false;
function mountTour() {
  const box = document.getElementById('xp-tour');
  if (!box) return;
  if (!FS.explain) { box.innerHTML = ''; return; }
  const i = FS.tour;
  const key = `${i}|${ctx.data.mock}|${ctx.state.mode}|${i < 2 ? ctx.state.t : ''}`;
  let st = stepCache.get(key);
  if (!st) {
    try {
      st = tourStep(i, { ...ctx.data, t: tStart(), mode: ctx.state.mode });
      stepCache.set(key, st);
    } catch (e) { st = { title: TOUR_TITLES[i], body: `This step could not be computed (${(e as Error).message}).`, action: {} }; }
  }
  box.innerHTML = `<section class="tour" aria-labelledby="tour-h" aria-live="polite">
    <p class="tour-k">Guided tour · step ${i + 1} of ${TOUR_TITLES.length}</p>
    <h3 id="tour-h" tabindex="-1">${esc(st.title)}</h3>
    <p>${esc(st.body)}</p>
    <div class="row">
      <button type="button" data-tour="prev" ${i === 0 ? 'disabled' : ''}>Back</button>
      <button type="button" data-tour="show">Show me</button>
      <button type="button" data-tour="next" ${i === TOUR_TITLES.length - 1 ? 'disabled' : ''}>Next</button>
      <ol class="tour-dots" aria-label="Tour steps">${TOUR_TITLES.map((t, k) => `<li><button type="button" data-tour-go="${k}" aria-label="Step ${k + 1}: ${esc(t)}" aria-current="${k === i ? 'step' : 'false'}"></button></li>`).join('')}</ol>
    </div></section>`;
  const go = (k: number) => { FS.tour = Math.max(0, Math.min(TOUR_TITLES.length - 1, k)); focusTour = true; runStep(); };
  box.querySelector('[data-tour="prev"]')!.addEventListener('click', () => go(i - 1));
  box.querySelector('[data-tour="next"]')!.addEventListener('click', () => go(i + 1));
  box.querySelector('[data-tour="show"]')!.addEventListener('click', () => { focusTour = true; runStep(); });
  box.querySelectorAll<HTMLButtonElement>('[data-tour-go]').forEach((b) => b.addEventListener('click', () => go(Number(b.dataset.tourGo))));
  if (focusTour) { focusTour = false; box.querySelector<HTMLElement>('#tour-h')?.focus({ preventScroll: true }); }
}

/** Apply the current step: page state first (re-renders everything), then the simulator view. */
function runStep() {
  const key = `${FS.tour}|${ctx.data.mock}|${ctx.state.mode}|${FS.tour < 2 ? ctx.state.t : ''}`;
  let st = stepCache.get(key);
  if (!st) { try { st = tourStep(FS.tour, { ...ctx.data, t: tStart(), mode: ctx.state.mode }); } catch { st = undefined; } }
  const a = st?.action ?? {};
  const changed = a.state && Object.entries(a.state).some(([k, v]) => (ctx.state as any)[k] !== v);
  // Cache the step under the key it will have after the state change, so the text does not change under the reader.
  if (st && a.state?.t) stepCache.set(`${FS.tour}|${ctx.data.mock}|${ctx.state.mode}|${FS.tour < 2 ? a.state.t : ''}`, st);
  if (changed) ctx.setState(a.state!); else mountTour();
  if (a.sim) simView(a.sim);
  if (a.scrollTo) document.getElementById(a.scrollTo)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  else document.querySelector('.feat-explain')?.scrollIntoView({ block: 'start' });
}

function applyNotes() {
  document.querySelectorAll('.xp-note').forEach((n) => { (n as HTMLElement).hidden = !FS.explain; });
  if (!FS.explain) return;
  const add = (host: Element | null, key: string, where: 'after' | 'append' = 'after') => {
    if (!host || host.parentElement?.querySelector(`.xp-note[data-k="${key}"]`) || host.querySelector(`.xp-note[data-k="${key}"]`)) return;
    const p = document.createElement('p');
    p.className = 'xp-note'; p.dataset.k = key; p.textContent = NOTES[key];
    if (where === 'after') host.after(p); else host.append(p);
  };
  add(document.querySelector('.card-power header'), 'power');
  add(document.querySelector('.card-comm header'), 'comm');
  for (const id of ['h-sum', 'h-opt', 'h-tl', 'h-pan', 'h-val', 'feat-dates-h', 'feat-cmp-h']) {
    add(document.getElementById(id), id.replace(/-h$/, ''));
  }
}

// ------------------------------------------------------------------------------------------- 2. custom site
function mountCustom() {
  const form = document.getElementById('f');
  if (!form) return;
  const c = FS.custom;
  const sec = document.createElement('section');
  sec.id = 'custom-site';
  sec.className = 'noprint feat-custom';
  sec.setAttribute('aria-labelledby', 'custom-h');
  sec.innerHTML = `<details ${ctx.state.site === CUSTOM_ID ? 'open' : ''}><summary><h2 id="custom-h">Custom site</h2><span class="note">Any point on the Moon: enter coordinates</span></summary>
    <form id="custom-f" class="cgrid" novalidate>
      <div><label for="c-lat">Latitude (°, north +)</label><input id="c-lat" name="lat" inputmode="decimal" autocomplete="off" placeholder="−89.44" value="${c ? c.lat : ''}" aria-describedby="c-lat-e"><span class="err" id="c-lat-e"></span></div>
      <div><label for="c-lon">Longitude (°E, −180 to 360)</label><input id="c-lon" name="lon" inputmode="decimal" autocomplete="off" placeholder="222.85" value="${c ? c.lon : ''}" aria-describedby="c-lon-e"><span class="err" id="c-lon-e"></span></div>
      <div><label for="c-elev">Elevation (m, optional)</label><input id="c-elev" name="elev" inputmode="decimal" autocomplete="off" placeholder="0" value="${c?.elev ?? ''}" aria-describedby="c-elev-e"><span class="err" id="c-elev-e"></span></div>
      <div><label for="c-name">Name (optional)</label><input id="c-name" name="name" maxlength="60" autocomplete="off" value="${esc(c?.name ?? '')}"></div>
      <div class="cbtn"><button type="submit">Show this site</button></div>
    </form>
    <p class="note">Longitude west of 0° can be entered as negative; it is stored east-positive, 0–360°. Elevation is above the 1737.4 km reference sphere.</p>
    <p class="sphere-note">${esc(SPHERE_NOTE)}</p></details>`;
  insertAfter(form, sec);
  sec.querySelector('#custom-f')!.addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = new FormData(e.target as HTMLFormElement);
    const r = checkCustom({ lat: String(fd.get('lat')), lon: String(fd.get('lon')), elev: String(fd.get('elev')), name: String(fd.get('name')) });
    for (const k of ['lat', 'lon', 'elev'] as const) {
      const inp = sec.querySelector<HTMLInputElement>(`#c-${k}`)!;
      sec.querySelector(`#c-${k}-e`)!.textContent = r.errors[k] ?? '';
      inp.setAttribute('aria-invalid', String(!!r.errors[k]));
    }
    if (!r.ok) { sec.querySelector<HTMLInputElement>('[aria-invalid="true"]')?.focus(); return; }
    setCustom(r.value!);
    ctx.setState({ site: CUSTOM_ID });
    document.getElementById('custom-h')?.scrollIntoView({ block: 'nearest' });
  });
}

function setCustom(v: CustomInput) {
  FS.custom = v;
  const s = customSite(v);
  const i = ctx.data.sites.findIndex((x) => x.id === CUSTOM_ID);
  if (i >= 0) ctx.data.sites[i] = s; else ctx.data.sites.push(s);
  ctx.data.horizons.set(CUSTOM_ID, sphereHorizon(s));
  dateJobs.clear(); cmpCache.clear();
  writeFeatureParams();
}

// ------------------------------------------------------------------------------------------- 3. landing dates
const dateJobs = new Map<string, DateScanner>();
let activeJob = '';
let cursor = 0; // landing-date cursor, days from the baseline
let chartRO: ResizeObserver | null = null;

function dateKey() {
  const s = curSite();
  return `${s.id}|${s.lat}|${s.lon_e}|${ctx.state.stay}|${ctx.state.mode}|${ctx.state.t}|${ctx.data.mock}`;
}

function mountDates() {
  const after = sectionOf('h-sum');
  if (!after) return;
  const site = curSite();
  const sec = document.createElement('section');
  sec.id = 'feat-dates';
  sec.setAttribute('aria-labelledby', 'feat-dates-h');
  sec.innerHTML = `<h2 id="feat-dates-h">Landing dates over the next 13 lunar months${mockTag()}</h2>
    <p class="note">Hours of a ${ctx.state.stay}-day stay at ${esc(site.name)} for every landing date from the baseline (${esc(when(ctx.state.t + ':00Z'))}) to ${SPAN_D} days later, in 12-hour steps. Same 10-minute engine grid as the table above.</p>
    <div class="row dates-ctl" role="radiogroup" aria-label="Choosing a date sets">
      <span class="note">Choosing a date sets the</span>
      <label class="rad"><input type="radio" name="clk" value="slip" ${FS.clickSets === 'slip' ? 'checked' : ''}> slip</label>
      <label class="rad"><input type="radio" name="clk" value="base" ${FS.clickSets === 'base' ? 'checked' : ''}> baseline date</label>
      <span class="note">(Shift-click or Shift+Enter does the other.)</span>
    </div>
    <div class="dates-chart" id="dates-chart"></div>
    <p class="dates-read num" id="dates-read" aria-hidden="true"></p>
    <div class="legend"><span><span class="sw" style="background:#e69f00"></span>sunlit</span><span><span class="sw" style="background:repeating-linear-gradient(90deg,#56b4e9 0 5px,transparent 5px 8px)"></span>Earth in view</span><span><span class="sw" style="background:#009e73"></span>Sun + Earth</span><span><span class="sw" style="background:#f0e442"></span>slipped date</span><span>1 2 3 = best dates</span></div>
    <div id="dates-sum"></div>
    <p id="dates-status" role="status" class="note"></p>`;
  insertAfter(after, sec);
  sec.querySelectorAll<HTMLInputElement>('input[name="clk"]').forEach((r) => r.addEventListener('change', () => { FS.clickSets = r.value === 'base' ? 'base' : 'slip'; drawDates(); }));
  chartRO?.disconnect();
  chartRO = new ResizeObserver(() => drawDates());
  chartRO.observe(sec.querySelector('#dates-chart')!);
  cursor = Math.max(0, Math.min(SPAN_D, ctx.state.slip > 0 ? ctx.state.slip : cursor));
  startDates();
}

function startDates() {
  const key = dateKey();
  activeJob = key;
  let job = dateJobs.get(key);
  if (!job) {
    try {
      const s = curSite();
      job = new DateScanner(ctx.data.ephem, siteFrame(s), ctx.data.horizons.get(s.id)!.elev_deg, tStart(), ctx.state.stay, ctx.state.mode);
    } catch (e) { setDatesStatus(`Could not compute landing dates: ${(e as Error).message}`); return; }
    if (dateJobs.size > 12) dateJobs.delete(dateJobs.keys().next().value!);
    dateJobs.set(key, job);
  }
  drawDates();
  const tick = (dl: { timeRemaining(): number }) => {
    if (activeJob !== key) return; // a newer scenario took over; this job stays cached half-done
    let done = false;
    const t0 = performance.now();
    do { done = job!.step(1440); } while (!done && dl.timeRemaining() > 3 && performance.now() - t0 < 12);
    if (done) drawDates(); else { setDatesStatus(`Computing… ${Math.round(job!.progress() * 100)}%`, job!.progress()); idle(tick); }
  };
  if (job.progress() < 1) idle(tick);
}

function setDatesStatus(txt: string, p?: number) {
  const el = document.getElementById('dates-status');
  if (!el) return;
  el.innerHTML = p == null ? esc(txt) : `<progress max="1" value="${p.toFixed(3)}" aria-hidden="true"></progress> ${esc(txt)}`;
}

function drawDates() {
  const host = document.getElementById('dates-chart');
  const job = dateJobs.get(activeJob);
  if (!host || !job) return;
  if (job.progress() < 1) {
    host.innerHTML = '<div class="dates-wait" aria-hidden="true"></div>';
    return;
  }
  const s = job.series();
  const W = Math.max(300, Math.round(host.clientWidth || 900)), H = W < 560 ? 190 : 230;
  const L = 40, R = 10, T = 16, B = 24, pw = W - L - R, ph = H - T - B;
  const maxH = ctx.state.stay * 24;
  const x = (i: number) => L + (i / (s.n - 1)) * pw;
  const y = (h: number) => T + (1 - h / maxH) * ph;
  const path = (arr: Float64Array) => {
    let d = '', pen = false;
    for (let i = 0; i < s.n; i++) {
      if (!Number.isFinite(arr[i])) { pen = false; continue; }
      d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y(arr[i]).toFixed(1)}`; pen = true;
    }
    return d;
  };
  const perDay = DAY / s.sampleS;
  let grid = '';
  for (const f of [0, 0.25, 0.5, 0.75, 1]) grid += `<line x1="${L}" x2="${W - R}" y1="${y(f * maxH)}" y2="${y(f * maxH)}" class="g"/><text x="${L - 6}" y="${y(f * maxH) + 4}" text-anchor="end" class="muted">${Math.round(f * maxH)} h</text>`;
  const d0 = new Date(s.tBase * 1000);
  const minGap = W < 560 ? 3 : 1;
  for (let m = 1, c = 0; m <= 14; m++) {
    const t = Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth() + m, 1) / 1000;
    const i = (t - s.tBase) / s.sampleS;
    if (i >= s.n) break;
    grid += `<line x1="${x(i)}" x2="${x(i)}" y1="${T}" y2="${T + ph}" class="g"/>`;
    if (c++ % minGap === 0) grid += `<text x="${x(i) + 3}" y="${H - 8}" class="muted">${MON[new Date(t * 1000).getUTCMonth()]}${new Date(t * 1000).getUTCMonth() === 0 ? ' ' + new Date(t * 1000).getUTCFullYear() : ''}</text>`;
  }
  const best = bestDates(s);
  const bestM = best.map((b, k) => `<g class="best"><circle cx="${x(b.i)}" cy="${y(b.both)}" r="4"/><text x="${x(b.i)}" y="${y(b.both) - 8}" text-anchor="middle">${k + 1}</text></g>`).join('');
  const slip = ctx.state.slip;
  const slipI = slip * perDay;
  const slipM = slip > 0 && slipI < s.n ? `<line x1="${x(slipI)}" x2="${x(slipI)}" y1="${T}" y2="${T + ph}" class="slipm"/><text x="${x(slipI) + 4}" y="${T + 24}" class="slipt">Slipped +${slip} d</text>` : '';
  const ci = Math.min(s.n - 1, Math.round(cursor * perDay));
  const beyond = FS.clickSets === 'slip' && 90 * perDay < s.n
    ? `<rect x="${x(90 * perDay)}" y="${T}" width="${W - R - x(90 * perDay)}" height="${ph}" class="beyond"/><text x="${W - R - 4}" y="${T + ph - 6}" text-anchor="end" class="muted">beyond the 90-day slip range</text>` : '';
  host.innerHTML = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="slider" tabindex="0" id="dates-svg"
      aria-label="Landing date. Arrow keys move one day, Page Up and Page Down one week, Enter applies." aria-valuemin="0" aria-valuemax="${SPAN_D}" aria-valuenow="${cursor}" aria-valuetext="${esc(readText(s, cursor))}">
    ${beyond}${grid}
    <line x1="${L}" x2="${L}" y1="${T}" y2="${T + ph}" class="basem"/><text x="${L + 4}" y="${T + 10}" class="baset">Baseline</text>
    <path d="${path(s.sun)}" class="ln-sun"/><path d="${path(s.earth)}" class="ln-earth"/><path d="${path(s.both)}" class="ln-both"/>
    ${slipM}${bestM}
    <g class="cur"><line x1="${x(ci)}" x2="${x(ci)}" y1="${T}" y2="${T + ph}"/>${Number.isFinite(s.both[ci]) ? `<circle cx="${x(ci)}" cy="${y(s.both[ci])}" r="4"/>` : ''}</g>
  </svg>`;
  document.getElementById('dates-read')!.textContent = readText(s, cursor);
  setDatesStatus('');
  summarize(s, best);
  wireChart(s, x(0), x(s.n - 1));
}

function readText(s: DateSeries, dayN: number): string {
  const i = Math.min(s.n - 1, Math.round((dayN * DAY) / s.sampleS));
  const t = s.tBase + i * s.sampleS;
  if (!Number.isFinite(s.both[i])) return `${when(fmtUtc(t))} (+${dayN} d): beyond the end of the ephemeris`;
  return `Landing ${when(fmtUtc(t))} (+${dayN} d): sunlit ${s.sun[i].toFixed(1)} h · Earth in view ${s.earth[i].toFixed(1)} h · Sun + Earth ${s.both[i].toFixed(1)} h`;
}

function summarize(s: DateSeries, best: ReturnType<typeof bestDates>) {
  const el = document.getElementById('dates-sum');
  if (!el) return;
  const site = curSite();
  const parts: string[] = [];
  const top = best.length ? best[0].both : 0;
  let ties = 0;
  for (let i = 0; i < s.n; i++) if (Number.isFinite(s.both[i]) && s.both[i] >= top - 1e-9) ties++;
  const tieTxt = best.length && ties > 3 ? ` ${Math.round(ties / (DAY / s.sampleS))} days of landing dates in this period reach the maximum, ${top.toFixed(1)} h; the first three are:` : '';
  parts.push(best.length ? `<strong>Best landing dates in this period:</strong>${tieTxt} ${best.map((b, k) => `${k + 1}) ${day(b.t)} (${b.both.toFixed(1)} h with Sun and Earth, +${Math.round((b.t - s.tBase) / DAY)} d)`).join('; ')}.` : 'No landing date in this period has the Sun and Earth in view together.');
  const p = rhythmDays(s, 'sun') ?? rhythmDays(s, 'both');
  parts.push(p ? `The hours rise and fall with a ${p.toFixed(1)}-day rhythm: one lunar day-night cycle (a lunar day lasts about 29.5 Earth days), so a date that misses its window usually waits about a month for the next one.`
    : 'The hours barely follow a monthly rhythm here.');
  if (Math.abs(site.lat) >= 70) {
    const mm = monthlyMeans(s);
    if (mm.length >= 6) {
      const lo = mm.reduce((a, b) => (b.meanSun < a.meanSun ? b : a)), hi = mm.reduce((a, b) => (b.meanSun > a.meanSun ? b : a));
      parts.push(hi.meanSun - lo.meanSun >= 1
        ? `Seasons: averaged over each lunar month, sunlit time per stay ranges from ${lo.meanSun.toFixed(0)} h (landings around ${monYr(lo.t)}) to ${hi.meanSun.toFixed(0)} h (around ${monYr(hi.t)}). Near the pole the Sun's path shifts up and down by about 1.5° over the year, and that small change decides whether it clears the skyline.`
        : 'Seasons: the monthly average of sunlit time hardly changes over this period.');
    }
  }
  if (isSphere(ctx.data.horizons.get(site.id))) parts.push(`<span class="sphere-inline">${esc(SPHERE_NOTE)}</span>`);
  el.innerHTML = parts.map((x) => `<p>${x}</p>`).join('');
}

function wireChart(s: DateSeries, x0: number, x1: number) {
  const svg = document.getElementById('dates-svg') as SVGSVGElement | null;
  if (!svg) return;
  const perDay = DAY / s.sampleS;
  const maxDay = Math.floor((s.n - 1) / perDay);
  const dayAt = (ev: MouseEvent) => {
    const r = svg.getBoundingClientRect();
    const f = (ev.clientX - r.left - x0 * (r.width / svg.width.baseVal.value)) / ((x1 - x0) * (r.width / svg.width.baseVal.value));
    return Math.max(0, Math.min(maxDay, Math.round(f * (s.n - 1) / perDay)));
  };
  const moveCursor = (d: number) => {
    cursor = Math.max(0, Math.min(maxDay, d));
    const ci = Math.min(s.n - 1, Math.round(cursor * perDay));
    const cur = svg.querySelector('.cur');
    const W = svg.width.baseVal.value, L = 40, R = 10;
    const cx = L + (ci / (s.n - 1)) * (W - L - R);
    cur?.querySelector('line')?.setAttribute('x1', String(cx));
    cur?.querySelector('line')?.setAttribute('x2', String(cx));
    const c = cur?.querySelector('circle');
    if (c) {
      if (Number.isFinite(s.both[ci])) { c.setAttribute('cx', String(cx)); c.setAttribute('cy', String(16 + (1 - s.both[ci] / (ctx.state.stay * 24)) * (svg.height.baseVal.value - 40))); c.removeAttribute('visibility'); }
      else c.setAttribute('visibility', 'hidden');
    }
    svg.setAttribute('aria-valuenow', String(cursor));
    svg.setAttribute('aria-valuetext', readText(s, cursor));
    document.getElementById('dates-read')!.textContent = readText(s, cursor);
  };
  const apply = (d: number, other: boolean) => {
    const mode = other ? (FS.clickSets === 'slip' ? 'base' : 'slip') : FS.clickSets;
    const i = Math.min(s.n - 1, Math.round(d * perDay));
    if (!Number.isFinite(s.both[i])) { setDatesStatus('That date is past the end of the ephemeris.'); return; }
    if (mode === 'slip') {
      if (d > 90) { setDatesStatus('Slips are limited to 90 days. Choose “baseline date” (or Shift) to move the baseline here.'); return; }
      ctx.setState({ slip: d });
    } else {
      cursor = 0;
      ctx.setState({ t: fmtUtc(s.tBase + d * DAY).slice(0, 16) });
    }
    document.getElementById('dates-svg')?.focus({ preventScroll: true });
  };
  svg.addEventListener('pointermove', (e) => moveCursor(dayAt(e)));
  svg.addEventListener('click', (e) => { const d = dayAt(e); moveCursor(d); apply(d, e.shiftKey); });
  svg.addEventListener('keydown', (e) => {
    const step: Record<string, number> = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1, PageUp: 7, PageDown: -7 };
    if (e.key in step) { e.preventDefault(); moveCursor(cursor + step[e.key]); }
    else if (e.key === 'Home') { e.preventDefault(); moveCursor(0); }
    else if (e.key === 'End') { e.preventDefault(); moveCursor(maxDay); }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); apply(cursor, e.shiftKey); }
  });
}

// ------------------------------------------------------------------------------------------- 4. compare
const cmpCache = new Map<string, CompareRow>();
let sortKey: ColKey | null = null;
let sortDir: 1 | -1 = -1;

function mountCompare() {
  const after = sectionOf('h-pan') ?? sectionOf('h-sum');
  if (!after) return;
  const sec = document.createElement('section');
  sec.id = 'feat-cmp';
  sec.setAttribute('aria-labelledby', 'feat-cmp-h');
  insertAfter(after, sec);
  renderCompare();
}

function cmpIds(): string[] {
  const ok = FS.cmp.filter((id) => ctx.data.sites.some((s) => s.id === id));
  return ok.length ? ok : [ctx.state.site];
}

function renderCompare() {
  const sec = document.getElementById('feat-cmp');
  if (!sec) return;
  const ids = cmpIds();
  const full = ids.length >= 4;
  const t0 = tStart();
  sec.innerHTML = `<h2 id="feat-cmp-h">Compare sites${mockTag()}</h2>
    <p class="note">Same landing date (${esc(when(fmtUtc(t0)))}) and ${ctx.state.stay}-day stay at every site.</p>
    <fieldset class="cmp-pick noprint"><legend>Sites to compare (up to 4)</legend>
      ${ctx.data.sites.map((s) => { const on = ids.includes(s.id); return `<label class="chk"><input type="checkbox" value="${esc(s.id)}" ${on ? 'checked' : ''} ${!on && full ? 'disabled' : ''}> ${esc(s.name)}</label>`; }).join('')}
    </fieldset>
    <div id="cmp-table" class="cmp-wrap"><p class="note">Computing…</p></div>`;
  sec.querySelectorAll<HTMLInputElement>('.cmp-pick input').forEach((cb) => cb.addEventListener('change', () => {
    const cur = cmpIds();
    FS.cmp = cb.checked ? [...cur.filter((x) => x !== cb.value), cb.value].slice(0, 4) : cur.filter((x) => x !== cb.value);
    writeFeatureParams();
    renderCompare();
    sec.querySelector<HTMLInputElement>(`.cmp-pick input[value="${CSS.escape(cb.value)}"]`)?.focus();
  }));
  idle(() => fillCompare(ids, t0));
}

function fillCompare(ids: string[], t0: number) {
  const host = document.getElementById('cmp-table');
  if (!host) return;
  let rows: CompareRow[];
  try {
    rows = ids.map((id) => {
      const s = ctx.data.sites.find((x) => x.id === id)!;
      const key = `${id}|${s.lat}|${s.lon_e}|${t0}|${ctx.state.stay}|${ctx.state.mode}|${ctx.data.mock}`;
      let r = cmpCache.get(key);
      if (!r) { r = compareRow(ctx.data.ephem, s, ctx.data.horizons.get(id)!, t0, ctx.state.stay, ctx.state.mode); cmpCache.set(key, r); }
      return r;
    });
  } catch (e) { host.innerHTML = `<p class="error" role="alert">${esc((e as Error).message)}</p>`; return; }
  const shown = sortKey ? sortRows(rows, sortKey, sortDir) : rows;
  const fmt = (r: CompareRow, k: ColKey): string => {
    const m = r.metrics;
    switch (k) {
      case 'name': return `<th scope="row">${esc(r.site.name)}</th>`;
      case 'sunlit': return m.sunlit_h.toFixed(1);
      case 'earth': return `${m.earth_visible_pct.toFixed(0)}%`;
      case 'both': return m.both_visible_h.toFixed(1);
      case 'gap': return m.longest_dark_gap_h.toFixed(1);
      case 'maxel': return `${r.maxSunEl.toFixed(2)}°`;
      case 'sunset': return m.next_sunset_utc ? m.next_sunset_utc.slice(0, 16).replace('T', ' ') : 'none in stay';
      case 'earthset': return m.next_earthset_utc ? m.next_earthset_utc.slice(0, 16).replace('T', ' ') : 'none in stay';
      case 'horizon': return r.horizon === 'Smooth sphere' ? 'Smooth sphere*' : 'LOLA terrain';
    }
  };
  const bests = new Map(COLS.map((c) => [c.key, bestIndex(shown, c)]));
  const th = COLS.map((c) => {
    const sorted = sortKey === c.key;
    return `<th scope="col" aria-sort="${sorted ? (sortDir === 1 ? 'ascending' : 'descending') : 'none'}"><button type="button" class="sortb" data-sort="${c.key}">${esc(c.label)}<span aria-hidden="true">${sorted ? (sortDir === 1 ? ' ▲' : ' ▼') : ''}</span></button></th>`;
  }).join('');
  const body = shown.map((r, i) => `<tr>${COLS.map((c) => {
    if (c.key === 'name') return fmt(r, c.key);
    const best = bests.get(c.key) === i;
    return `<td class="${c.key === 'horizon' ? 'hz' : 'num'}${best ? ' best' : ''}">${fmt(r, c.key)}${best ? '<span class="sr-only"> (best)</span>' : ''}</td>`;
  }).join('')}</tr>`).join('');
  const anySphere = rows.some((r) => r.horizon === 'Smooth sphere');
  host.innerHTML = `<table class="cmp"><caption class="sr-only">Sites compared for the same landing date and stay; select a column heading to sort</caption><thead><tr>${th}</tr></thead><tbody>${body}</tbody></table>
    <p class="note">${rows.length > 1 ? 'Underlined = best in its column. ' : 'Tick more sites to compare. '}Max Sun elevation is above the local horizontal plane, not above terrain. “None in stay” = no sunset (or Earthset) inside the stay.${anySphere ? ` <span class="sphere-inline">* ${esc(SPHERE_NOTE)}</span>` : ''}</p>`;
  host.querySelectorAll<HTMLButtonElement>('[data-sort]').forEach((b) => b.addEventListener('click', () => {
    const k = b.dataset.sort as ColKey;
    if (sortKey === k) sortDir = sortDir === 1 ? -1 : 1; else { sortKey = k; sortDir = k === 'name' || k === 'gap' || k === 'horizon' ? 1 : -1; }
    fillCompare(ids, t0);
    host.querySelector<HTMLButtonElement>(`[data-sort="${k}"]`)?.focus();
  }));
}
