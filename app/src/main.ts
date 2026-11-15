// AI-ASSISTED: drafted with Claude (Anthropic), reviewed by the human team.
// Slip Impact Brief: UI. All state lives in the query string (permalink).
import { setLinkMargin } from './engine/visibility';
import { download, exportRows, toCsv, toJson, type ExportRow, type ExportScenario } from './ui/export';
import { heatmapSvg, heatmapTable, siteDateGrid } from './features/heatmap';
import { earthClearance, earthPlotSvg } from './features/earthplot';
import '@fontsource-variable/inter/wght.css';
import '@fontsource-variable/public-sans/wght.css';
import '@fontsource/dm-mono/latin-400.css';
import '@fontsource/dm-mono/latin-500.css';
import './style.css';
import type { EphemHeader, FeaturesFile, FixturesFile, HorizonFile, Site, SitesFile } from '@contracts/types';
import { Ephem, fmtUtc, parseUtc } from './engine/ephem';
import { observe, siteFrame } from './engine/geometry';
import { scanWindow, hasBand } from './engine/metrics';
import { alternateSites, slipOptions, slipWords } from './engine/slip';
import { compass, fmtKm } from './engine/causes';
import type { Mode } from './engine/visibility';
import { panoramaSvg, timelineSvg, timelineTable, type TimelineWindow } from './ui/charts';
import { badges, optionBars, verdict, verdictContext } from './ui/brief';
import { mountSim } from './sim'; // SIM HOOK (Agent C): 3D mission simulator, see src/sim/
// --- FEATURE HOOK (C): imports for the challenge-coverage panels, see src/features/
import { addSphereAndCustomSites, mountFeatures, writeFeatureParams } from './features';
// --- END
import './ui/brief.css'; // round 3 design layer; loaded last so it wins over sim.css / features.css

interface State { site: string; t: string; stay: number; slip: number; mode: Mode; margin: number; data: 'real' | 'mock' }
interface Data {
  ephem: Ephem; header: EphemHeader; sites: Site[]; horizons: Map<string, HorizonFile>;
  features: FeaturesFile | null; fixtures: FixturesFile | null; mock: boolean;
}

const LOGO = `<svg class="logo" viewBox="0 0 48 48" width="44" height="44" role="img" aria-label="Moonslip logo"><circle cx="24" cy="24" r="21" fill="#0b0e12" stroke="#3a4656" stroke-width="1.5"/><path d="M24 9a15 15 0 1 0 0 30a11 15 0 0 1 0-30z" fill="#e8edf3"/><path d="M24 9a11 15 0 0 0 0 30" fill="none" stroke="#f0e442" stroke-width="1.6" stroke-dasharray="3 3" transform="translate(7 0)"/><circle cx="38.5" cy="14" r="3" fill="#e69f00"/><circle cx="40" cy="33" r="2.2" fill="#56b4e9"/></svg>`;
const DAY = 86400;
const app = document.getElementById('app')!;
const esc = (s: unknown) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const h1 = (v: number) => v.toFixed(1);
const when = (iso: string | null) => (iso ? iso.slice(0, 16).replace('T', ' ') + ' UTC' : '—');

const PRESETS: { id: string; label: string; state: Partial<State>; note: string }[] = [
  { id: 'im1-slip', label: 'IM-1 +10 d', state: { site: 'im1', t: '2024-01-19T23:24', stay: 7, slip: 10, mode: 'limb' },
    note: 'Illustration with a 7-day surface stay. The January landing is an illustrative baseline date (original launch window 12–16 Jan 2024); the real mission landed 22 Feb 2024.' },
  { id: 'im1-actual', label: 'IM-1 plan vs actual', state: { site: 'im1', t: '2024-01-19T23:24', stay: 7, slip: 34, mode: 'limb' },
    note: 'Compares an illustrative January baseline date (original launch window 12–16 Jan 2024) with the actual landing, 22 Feb 2024 23:24 UTC.' },
  { id: 'im2-slip', label: 'IM-2 +7 d', state: { site: 'im2', t: '2025-03-06T17:29', stay: 10, slip: 7, mode: 'limb' },
    note: 'Illustration: Earth sets at Mons Mouton for part of each month.' },
];

const T_RE = /^\d{4}-\d\d-\d\d[T ]\d\d:\d\d$/;
/** Message shown when a link asks for something this build cannot show (for example a site with no data yet). */
let linkNotice = '';
let lastExport: { scenario: ExportScenario; rows: ExportRow[] } | null = null;

function readState(sites: Site[] | null): State {
  const q = new URLSearchParams(location.search);
  const num = (k: string, d: number, lo: number, hi: number) => {
    const v = Number(q.get(k));
    return q.has(k) && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d;
  };
  const site = q.get('site') ?? 'im1';
  return {
    site: !sites || sites.some((s) => s.id === site) ? site : sites[0].id,
    t: T_RE.test(q.get('t') ?? '') ? q.get('t')!.replace(' ', 'T') : '2024-01-19T23:24',
    stay: num('stay', 7, 1, 60),
    slip: Math.round(num('slip', 10, -90, 90)),
    mode: /^cent(re|er)$/i.test(q.get('mode') ?? '') ? 'centre' : 'limb',
    margin: Math.round(num('margin', 0, 0, 10)), // Earth link margin, degrees above the skyline
    data: q.get('data') === 'mock' ? 'mock' : 'real',
  };
}
function writeState(s: State) {
  const q = new URLSearchParams({ site: s.site, t: s.t, stay: String(s.stay), slip: String(s.slip), mode: s.mode });
  if (s.margin > 0) q.set('margin', String(s.margin));
  if (s.data === 'mock') q.set('data', 'mock');
  history.replaceState(null, '', `${location.pathname}?${q}`);
}

async function getJson<T>(url: string, optional = false): Promise<T | null> {
  try {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`${r.status}`);
    return (await r.json()) as T;
  } catch (e) {
    if (optional) return null;
    throw new Error(`Could not load ${url} (${(e as Error).message})`);
  }
}

async function loadData(kind: State['data']): Promise<Data> {
  const base = kind === 'mock' ? 'data/mock/' : 'data/'; // the one switch between mock and real data
  const [header, sitesFile, features, fixtures, bin] = await Promise.all([
    getJson<EphemHeader>(base + 'ephem.header.json'),
    getJson<SitesFile>(base + 'sites.json'),
    getJson<FeaturesFile>(base + 'features.json', true),
    getJson<FixturesFile>(base + 'fixtures.json', true),
    fetch(base + 'ephem.bin').then((r) => { if (!r.ok) throw new Error('Could not load ephem.bin'); return r.arrayBuffer(); }),
  ]);
  const horizons = new Map<string, HorizonFile>();
  await Promise.all(sitesFile!.sites.map(async (s) => {
    const hz = await getJson<HorizonFile>(`${base}horizon/${s.id}.json`, true);
    if (hz) horizons.set(s.id, hz);
  }));
  // --- FEATURE HOOK (C): sphere horizon for terrain:"sphere" sites without a file; custom site from the URL
  addSphereAndCustomSites(sitesFile!.sites, horizons);
  // --- END
  const sites = sitesFile!.sites.filter((s) => horizons.has(s.id));
  const mock = [header!.meta, sitesFile!.meta, ...[...horizons.values()].map((x) => x.meta)].some((m) => m?.mock === true);
  return { ephem: new Ephem(header!, bin), header: header!, sites, horizons, features, fixtures, mock };
}

function residuals(d: Data) {
  if (!d.fixtures || d.fixtures.meta?.mock) return null;
  let n = 0, az = 0, el = 0;
  const bySite = new Set<string>();
  for (const x of d.fixtures.fixtures) {
    const s = d.sites.find((v) => v.id === x.site_id);
    const t = parseUtc(x.utc);
    if (!s || !d.ephem.covers(t)) continue;
    const o = observe(d.ephem, siteFrame(s), t);
    const [a, e] = x.body === 'sun' ? [o.sunAz, o.sunEl] : [o.earthAz, o.earthEl];
    let da = Math.abs(a - x.horizons_az) % 360;
    da = Math.min(da, 360 - da) * Math.cos((x.horizons_el * Math.PI) / 180);
    az = Math.max(az, da); el = Math.max(el, Math.abs(e - x.horizons_el));
    n++; bySite.add(x.site_id);
  }
  return n ? { n, az, el, sites: bySite.size } : null;
}

/** Long-run sunlit share on the loaded terrain, to compare with a published figure. Hourly samples over the whole ephemeris. */
const BENCH: Record<string, { pct: string; cite: string }> = {
  connecting_ridge: { pct: '92.27%', cite: 'Gläser et al. 2014, Icarus 243, 2 m above ground' },
};
const benchCache = new Map<string, { pct: number; years: number }>();
function longRunSunlit(d: Data, site: Site, mode: Mode): { pct: number; years: number } {
  const key = `${site.id}|${mode}`;
  let r = benchCache.get(key);
  if (!r) {
    const sc = scanWindow(d.ephem, siteFrame(site), d.horizons.get(site.id)!.elev_deg, d.ephem.t0, d.ephem.tLast, mode, 3600);
    let n = 0;
    for (let k = 0; k < sc.n; k++) n += sc.sunVis[k];
    r = { pct: (100 * n) / sc.n, years: (d.ephem.tLast - d.ephem.t0) / (365.25 * DAY) };
    benchCache.set(key, r);
  }
  return r;
}

function controls(d: Data, s: State): string {
  const groups: Record<string, Site[]> = {};
  for (const x of d.sites) (groups[x.kind] ??= []).push(x);
  const names: Record<string, string> = { landed: 'Landed missions', planned: 'Planned', candidate: 'Candidate sites' };
  const opts = Object.entries(groups).map(([k, v]) => `<optgroup label="${esc(names[k] ?? k)}">${v.map((x) =>
    `<option value="${esc(x.id)}" ${x.id === s.site ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</optgroup>`).join('');
  return `<form class="controls bar" id="f" aria-label="Scenario">
    <div class="fld f-site"><label for="site">Landing site</label><select id="site" name="site">${opts}</select></div>
    <div class="fld f-t"><label for="t">Planned landing (UTC)</label><input id="t" name="t" type="text" inputmode="numeric" autocomplete="off" value="${s.t.replace('T', ' ')}" pattern="\\d{4}-\\d\\d-\\d\\d[ T]\\d\\d:\\d\\d" title="Year-month-day and 24-hour time in UTC, for example 2024-01-19 23:24" placeholder="YYYY-MM-DD HH:MM" required></div>
    <div class="fld f-n"><label for="stay">Days on the surface</label><input id="stay" name="stay" type="number" min="1" max="60" step="1" value="${s.stay}" required></div>
    <div class="fld f-slip"><label for="slip">Landing slips by (days)</label><span class="stepper"><button type="button" data-step="-1" aria-label="Slip one day earlier">−</button><input id="slip" name="slip" type="number" min="-90" max="90" step="1" value="${s.slip}" required><button type="button" data-step="1" aria-label="Slip one day later">+</button></span></div>
    <div class="chips" role="group" aria-label="Examples"><span class="chips-k">Try an example</span>${PRESETS.filter((p) => d.sites.some((x) => x.id === p.state.site)).map((p) => `<button type="button" class="chip" data-preset="${p.id}">${esc(p.label)}</button>`).join('')}</div>
    <details class="adv"><summary>Advanced settings and export</summary><div class="adv-in">
    <div class="fld f-mode"><label for="mode">In view when</label><select id="mode" name="mode">
      <option value="limb" ${s.mode === 'limb' ? 'selected' : ''}>any of the disc shows</option>
      <option value="centre" ${s.mode === 'centre' ? 'selected' : ''}>half the disc shows</option></select></div>
    <div class="fld f-margin"><label for="margin">Earth link margin</label><select id="margin" name="margin">${[0, 2, 5, 10].concat([0, 2, 5, 10].includes(s.margin) ? [] : [s.margin]).sort((a, b) => a - b).map((m) =>
      `<option value="${m}" ${s.margin === m ? 'selected' : ''}>${m === 0 ? '0°, line of sight' : `${m}° above skyline`}</option>`).join('')}</select></div>
    <div class="tools"><button type="button" id="print">Print</button><button type="button" id="copy">Copy link</button><button type="button" id="dl-csv">CSV</button><button type="button" id="dl-json">JSON</button><span id="copied" role="status" class="fine"></span></div>
    </div></details>
  </form>`;
}

/** Width available to the charts, so SVG text stays readable on a phone instead of being scaled down. */
const chartW = () => Math.max(300, Math.min(1240, document.documentElement.clientWidth - 40));

let lastW = 0, resizeBound = false;
let rerender: (() => void) | null = null;

function render(d: Data, s: State) {
  setLinkMargin(s.margin);
  lastExport = null;
  writeState(s);
  // --- FEATURE HOOK (C): keep lat, lon, elev, name, cmp, explain in the permalink
  writeFeatureParams();
  // --- END
  const site = d.sites.find((x) => x.id === s.site)!;
  const hz = d.horizons.get(site.id)!;
  const preset = PRESETS.find((p) => Object.entries(p.state).every(([k, v]) => (s as any)[k] === v));
  let results = '', top = '', heroLine = '';
  const notes: string[] = [];
  try {
    const tStart = parseUtc(s.t + ':00Z');
    const opts = slipOptions({ ephem: d.ephem, site, horizons: d.horizons, sites: d.sites, features: d.features,
      tStart, stayDays: s.stay, slipDays: s.slip, mode: s.mode });
    lastExport = { rows: exportRows(opts), scenario: { site_id: site.id, site_name: site.name, baseline_utc: s.t + ':00Z', stay_days: s.stay, slip_days: s.slip,
      visible_rule: s.mode === 'limb' ? 'any part of the disc shows' : 'at least half the disc shows', earth_link_margin_deg: s.margin, page_url: location.href } };
    const same = opts.filter((o) => o.site_id === site.id);
    const t0 = Math.max(d.ephem.t0, Math.min(...same.map((o) => o.scan.tStart)) - 2 * DAY);
    const t1 = Math.min(d.ephem.tLast, Math.max(...same.map((o) => o.scan.tEnd)) + 2 * DAY);
    const wide = scanWindow(d.ephem, siteFrame(site), hz.elev_deg, t0, t1, s.mode);
    const wins: TimelineWindow[] = same.map((o) => ({ label: o.kind === 'baseline' ? 'Planned' : o.kind === 'slip' ? 'Slipped' : 'Recovery', tStart: o.scan.tStart, tEnd: o.scan.tEnd, emphasis: o.kind === 'slip' }));
    const slip = opts.find((o) => o.kind === 'slip');
    const tracks = [{ label: 'Planned', scan: opts[0].scan, dashed: false }];
    if (slip) tracks.push({ label: 'Slipped', scan: slip.scan, dashed: true });
    const sphere = hz.dem.product === 'sphere';
    const W = chartW();
    // Blocking terrain for the horizon plot: hours, then height of the skyline there, distance and bearing.
    const markers = (slip?.causes ?? []).filter((c) => c.kind === 'terrain' && c.az_deg != null && Math.abs(c.delta_h) >= 1).slice(0, 3)
      .map((c) => {
        const az = c.az_deg as number;
        return { az, label: `${c.body === 'sun' ? 'Sun' : 'Earth'} ${c.delta_h < 0 ? '−' : '+'}${Math.abs(c.delta_h).toFixed(1)} h`,
          sub: `skyline ${hz.elev_deg[Math.round(az * 2) % 720].toFixed(1)}°${c.dist_km == null ? '' : ' · ' + fmtKm(c.dist_km * 1000, hz)} · ${compass(az)}` };
      });
    const altNote = s.slip !== 0 ? alternateSites({ site, sites: d.sites, horizons: d.horizons }).note : null;
    notes.push(`Each stay is ${s.stay} days from landing, sampled every 10 minutes. Per body, the cause lines sum to the change in that body's visible hours, apart from pieces under half an hour, which are not listed.`,
      'Sunlit hours include time when Earth covers part or all of the Sun.' + (opts.some((o) => o.metrics.eclipse_h > 0) ? ` Eclipse (Earth covers the Sun): ${opts.filter((o) => o.metrics.eclipse_h > 0).map((o) => `${esc(o.label)} ${h1(o.metrics.eclipse_h)} h`).join(', ')}.` : ''),
      hasBand(hz) ? `Figures in brackets are the range when the terrain is lowered or raised by its published height error (σ = ${hz.dem.sigma_m} m).` : 'No terrain-error band is shown: the horizon file carries no terrain height error.',
      'Timeline: a pink tick above the Sun row marks Earth covering part of the Sun. Horizon plot: the vertical scale is stretched, and paths above the top of the plot are cut off.');
    if (altNote) notes.push(esc(altNote));
    {
      const sl = opts.find((o) => o.kind === 'slip'), rc = opts.find((o) => o.kind === 'recover');
      const nm = esc(site.name.replace(/ \(.*$/, ''));
      const n = Math.abs(s.slip);
      heroLine = sl
        ? `<span class="hv-t">If ${nm} lands <b>${n} day${n === 1 ? '' : 's'} ${s.slip > 0 ? 'late' : 'early'}</b>, Sun + Earth time ${sl.metrics.both_visible_h < opts[0].metrics.both_visible_h - 0.05 ? 'falls' : sl.metrics.both_visible_h > opts[0].metrics.both_visible_h + 0.05 ? 'rises' : 'stays'} from <b class="num">${h1(opts[0].metrics.both_visible_h)} h</b> to <b class="num ${sl.metrics.both_visible_h < opts[0].metrics.both_visible_h - 0.05 ? 'neg' : ''}">${h1(sl.metrics.both_visible_h)} h</b>.${rc && rc.label.startsWith('Next') && s.slip > 0 ? ` Next date as good: <b class="num">+${Math.round((parseUtc(rc.start_utc) - parseUtc(opts[0].start_utc)) / DAY)} d</b>.` : ''}</span>`
        : `<span class="hv-t">${nm}, landing as planned: <b class="num">${h1(opts[0].metrics.both_visible_h)} h</b> with Sun and Earth both in view over a ${s.stay}-day stay.</span>`;
    }
    top = `${verdict({ opts, site, stay: s.stay, slip: s.slip, illustrative: !!preset && /illustrative/i.test(preset.note) })}
      <p class="why">Why it matters: NASA's site-selection team keeps more than one candidate landing region to protect launch-timing flexibility, and prefers regions with more Earth visibility for direct-to-Earth radio (<a href="https://ntrs.nasa.gov/citations/20250011660" rel="noopener">George et al., LPSC 2026</a>).</p>
      <details class="more"><summary>Context</summary>${verdictContext(opts)}${preset ? `<p>${esc(preset.note)}${site.story ? ' ' + esc(site.story) : ''}</p>` : ''}</details>`;
    results = `
    <section aria-labelledby="h-opt" class="s-opt"><h2 id="h-opt">Your options, ranked</h2>
      <p class="lead">Longer bar = more hours with both Sun and Earth in view. The white tick is the planned landing.</p>
      ${optionBars(opts, d.horizons, s.stay)}
      ${altNote ? `<p class="fine">${esc(altNote)}</p>` : ''}
      ${s.margin > 0 ? `<p class="fine"><strong>Earth counts as in view only when it clears the skyline by ${s.margin}° (link margin).</strong></p>` : ''}</section>
    <section aria-labelledby="h-heat" class="s-heat"><h2 id="h-heat">All terrain sites by landing date</h2>
      <p class="fine">Hours with both Sun and Earth in view for a ${s.stay}-day stay, every site with a terrain horizon, over the 384 days after the planned date. Lighter is more. Sampled every 30 minutes, so values can differ slightly from the 10-minute figures.</p>
      <div class="tools"><button type="button" id="heat-go">Show the site-by-date map</button><span id="heat-note" role="status" class="fine"></span></div>
      <div id="heat-out"></div></section>
    <section aria-labelledby="h-earth" class="s-earth"><h2 id="h-earth">Earth above the skyline, 30 days</h2>
      ${(() => { const es = earthClearance(d.ephem, site, hz, parseUtc(s.t + ':00Z') - 2 * DAY, 32);
        return `<div class="chart">${earthPlotSvg(es, s.margin, same.map((o) => ({ label: o.kind === 'baseline' ? 'Planned' : o.kind === 'slip' ? (s.slip < 0 ? 'Earlier' : 'Slipped') : 'Recovery', tStart: o.scan.tStart, tEnd: o.scan.tEnd })))}</div>
      <p class="fine">Height of Earth's centre above the local skyline, hour by hour: from ${es.min.toFixed(1)}° to ${es.max.toFixed(1)}° in this period. Earth stays in nearly the same part of the sky and drifts up and down as the Moon wobbles on its orbit. ${es.min > 0 ? 'Here it never drops below the skyline.' : es.max < 0 ? 'Here it never clears the skyline.' : 'Where the line dips under the skyline, the direct link to Earth is lost.'}${s.margin > 0 ? ` With the ${s.margin}° link margin, Earth counts only above the dashed line.` : ''}</p>`; })()}</section>
    <section aria-labelledby="h-tl" class="s-tl"><h2 id="h-tl">Hour by hour</h2>
      <p class="lead">Coloured bars show when the Sun, Earth, or both are in view. Brackets mark each stay.</p>
      <div class="chart">${timelineSvg(wide, wins, `Sun, Earth and both visible at ${site.name} from ${fmtUtc(t0).slice(0, 10)} to ${fmtUtc(t1).slice(0, 10)}, with the planned and slipped stays marked`, 'Three rows show when the Sun, Earth and both are above the local horizon. Brackets underneath mark each stay. The same intervals are listed in the table below the chart.', W)}</div>
      <p class="prov">Ephemeris: NASA/NAIF SPICE DE440 · ${sphere ? 'Horizon: smooth sphere, no terrain' : `Terrain: LRO LOLA ${hz.dem.res_m ?? ''} m`} · 10-minute steps · UTC</p>
      <details class="more"><summary>As a table</summary><div class="scroll">${timelineTable(wide)}</div></details></section>
    <section aria-labelledby="h-pan" class="s-pan"><h2 id="h-pan">View from the site${sphere ? ' <span class="tagx warn">smooth sphere, no terrain model</span>' : ''}</h2>
      <p class="lead">Turn all the way around at the landing site: grey is the ${sphere ? 'horizon' : 'terrain skyline'}. The <b class="c-sun">Sun</b> and <b class="c-earth">Earth</b> are in view only while their paths are above it.</p>
      <div class="chart">${panoramaSvg(hz, tracks, markers, `Horizon at ${site.name} over 360 degrees of azimuth with the Sun and Earth paths for the planned and slipped stays`, 'The grey shape is the horizon by compass direction. A body is in view where its path is above the grey shape. Yellow labels mark terrain that blocks the Sun or Earth.', hasBand(hz), W)}</div>
      <p class="prov">${sphere ? 'Horizon: smooth sphere, no terrain model' : `Skyline: LRO LOLA ${hz.dem.res_m ?? ''} m grid, ${hz.mast_m} m above ground${hz.dem.max_range_km ? `, out to ${hz.dem.max_range_km} km` : ''}${hasBand(hz) ? ' · yellow band: terrain raised or lowered by its height error (±1σ)' : ''}`} · Paths: NASA/NAIF SPICE DE440</p></section>`;
  } catch (e) {
    top = `<div class="error" role="alert">${esc((e as Error).message)} Ephemeris covers ${when(fmtUtc(d.ephem.t0))} to ${when(fmtUtc(d.ephem.tLast))}.</div>`;
  }
  document.title = `${site.name}, ${slipWords(s.slip)} — Moonslip`;
  const res = residuals(d);
  const altUsed = site.elev_m == null ? ' (catalogue elevation not published; 0 m used for the site vector)' : '';
  const benchSite = d.sites.find((x) => BENCH[x.id]);
  const bench = !d.mock && benchSite ? { ...longRunSunlit(d, benchSite, 'limb'), published: BENCH[benchSite.id].pct, name: benchSite.name.replace(/ \(.*$/, ''), cite: BENCH[benchSite.id].cite } : null;
  app.innerHTML = `
  <header class="top">${LOGO}<div><h1><span class="wm">Moonslip</span><span class="wm-sub">Slip Impact Brief</span></h1>
    <p>If your Moon landing slips, what happens to sunlight and the link to Earth, and why.</p></div></header>
  ${linkNotice ? `<div class="error" role="alert">${esc(linkNotice)}</div>` : ''}
  ${d.mock ? '<div class="banner" role="alert">MOCK DATA — synthetic values for development. Not results.</div>' : ''}
  ${heroLine ? `<div class="hero-v">${heroLine}${res && !d.mock ? `<a class="hv-chip num" href="#h-val" title="Sun and Earth positions recomputed in your browser and compared with NASA JPL Horizons">✓ matches JPL Horizons within ${Math.max(res.az, res.el) < 0.001 ? '0.001' : '0.01'}° · ${res.n} checks</a>` : ''}</div>` : ''}
  <div id="sim-slot"></div>
  <main id="main" class="brief" tabindex="-1">
  <p class="brief-h" id="h-brief">Mission brief</p>
  <p class="printonly"><strong>Scenario:</strong> ${esc(site.name)} · planned landing ${when(s.t + ':00Z')} · ${s.stay}-day stay · ${slipWords(s.slip)} · ${s.mode === 'limb' ? 'any part of the disc' : 'half the disc'} · ${esc(location.href)}</p>
  <section aria-labelledby="h-sum" class="s-verdict">
    <h2 id="h-in">Your plan</h2>
    ${controls(d, s)}
    <h2 id="h-sum" class="h-res">What the slip costs</h2><div aria-live="polite" class="res">${top}</div>
  </section>
  ${results}
  <section aria-labelledby="h-val" class="s-val"><h2 id="h-val">Validation</h2>
    ${badges({ res, bench: bench ? { pct: bench.pct, published: bench.published, name: bench.name } : null, hz })}
    <p class="siteline"><span class="k">Site</span> ${esc(site.name)} <span class="num">${Math.abs(site.lat).toFixed(4)}°${site.lat < 0 ? 'S' : 'N'} ${site.lon_e.toFixed(4)}°E</span> · <a href="${esc(site.source.url)}" rel="noopener">${esc(site.source.org)}</a> · ${site.name_status === 'iau' ? 'IAU name' : 'informal name'}</p>
    <details class="more" id="method"><summary>Method and limits</summary>
      <h3 id="h-site">Site</h3><dl>
        <dt>Position</dt><dd class="mono">${Math.abs(site.lat).toFixed(4)}°${site.lat < 0 ? 'S' : 'N'}, ${site.lon_e.toFixed(4)}°E${site.elev_m != null ? `, ${site.elev_m} m` : ''}</dd>
        <dt>Source</dt><dd><a href="${esc(site.source.url)}" rel="noopener">${esc(site.source.org)}</a>${altUsed}</dd>
        <dt>Horizon</dt><dd>${esc(hz.dem.product)}${hz.dem.res_m ? `, ${hz.dem.res_m} m grid` : ''}${hz.dem.max_range_km ? `, out to ${hz.dem.max_range_km} km` : ''}; observer ${hz.mast_m} m above ground</dd>
        ${site.landing_utc ? `<dt>Landed</dt><dd class="mono">${when(site.landing_utc)}</dd>` : ''}</dl>
      <h3>Checks</h3><dl>
        <dt>JPL Horizons</dt><dd>${res ? `${res.n} Sun and Earth positions at ${res.sites} landing sites, recomputed in your browser just now: largest gap <span class="mono">${res.az.toFixed(4)}°</span> in azimuth and <span class="mono">${res.el.toFixed(4)}°</span> in elevation.` : 'No Horizons fixtures loaded for this data set.'}</dd>
        ${bench ? `<dt>Published benchmark</dt><dd>${esc(bench.name)}: sunlit <span class="mono">${bench.pct.toFixed(1)}%</span> of the time over ${bench.years.toFixed(0)} years (${fmtUtc(d.ephem.t0).slice(0, 4)}–${fmtUtc(d.ephem.tLast).slice(0, 4)}, any part of the disc), computed just now. Published: ${esc(bench.published)} (${esc(bench.cite)}). A different time span and a newer terrain model, so a close match is the test, not an exact one.</dd>` : ''}
        <dt>Ephemeris</dt><dd>${esc(d.header.spice_version)}, frame ${esc(d.header.frame)}, hourly, ${esc(d.header.kernels.join(', '))}</dd>
        <dt>Earth</dt><dd>Seen from the site, not from the Moon's centre (the difference reaches about 0.28°, hours of Earthrise time near the poles).</dd>
        <dt>Not modelled</dt><dd>Lander tilt and attitude, solar-panel pointing, thermal limits, radio link budget, relay satellites. "In view" means line of sight only.</dd></dl>
      <h3>Notes</h3><ul class="notes">${notes.map((n) => `<li>${n}</li>`).join('')}</ul>
      <p>Data: NASA/NAIF SPICE kernels (DE440), NASA JPL Horizons, LRO LOLA topography (NASA GSFC PGDA), LROC landing-site coordinates, USGS/IAU Gazetteer of Planetary Nomenclature.</p>
    </details></section>
  </main>
  <footer><p>Built for NASA Space Apps 2026 by team Space City Ad Lunam, with AI assistance (Anthropic Claude) for research, code, tests and documentation, reviewed by the team. NASA does not endorse this project.</p></footer>`;

  const f = document.getElementById('f') as HTMLFormElement;
  f.addEventListener('change', () => {
    if (!f.reportValidity()) return;
    const fd = new FormData(f);
    if (String(fd.get('site')) !== s.site) linkNotice = '';
    render(d, { ...s, site: String(fd.get('site')), t: String(fd.get('t')).trim().slice(0, 16).replace(' ', 'T'), stay: Number(fd.get('stay')), slip: Math.round(Number(fd.get('slip'))), mode: fd.get('mode') === 'centre' ? 'centre' : 'limb', margin: Number(fd.get('margin')) || 0 });
    document.getElementById(document.activeElement?.id || 'site')?.focus();
  });
  f.addEventListener('submit', (e) => e.preventDefault());
  f.querySelectorAll<HTMLButtonElement>('button[data-step]').forEach((b) => b.addEventListener('click', () => {
    const next = Math.max(-90, Math.min(90, s.slip + Number(b.dataset.step)));
    render(d, { ...s, slip: next });
    document.querySelector<HTMLButtonElement>(`button[data-step="${b.dataset.step}"]`)?.focus();
  }));
  app.querySelectorAll<HTMLButtonElement>('button[data-why]').forEach((b) => b.addEventListener('click', () => {
    const box = document.getElementById(`ob-why-${b.dataset.why}`)!;
    box.hidden = !box.hidden;
    b.setAttribute('aria-expanded', String(!box.hidden));
  }));
  // Charts are drawn at the real pixel width; redraw when the width changes (rotation, window resize).
  lastW = chartW();
  if (!resizeBound) {
    resizeBound = true;
    let timer = 0;
    window.addEventListener('resize', () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => { if (Math.abs(chartW() - lastW) > 24) rerender?.(); }, 200);
    });
  }
  rerender = () => render(d, s);
  document.getElementById('print')!.addEventListener('click', () => window.print());
  const dl = (kind: 'csv' | 'json') => () => {
    if (!lastExport) return;
    const name = `slip-brief_${s.site}_${s.t.slice(0, 10)}_slip${s.slip}.${kind}`;
    download(name, kind === 'csv' ? toCsv(lastExport.scenario, lastExport.rows) : toJson(lastExport.scenario, lastExport.rows), kind === 'csv' ? 'text/csv' : 'application/json');
  };
  document.getElementById('dl-csv')?.addEventListener('click', dl('csv'));
  document.getElementById('dl-json')?.addEventListener('click', dl('json'));
  document.getElementById('heat-go')?.addEventListener('click', () => {
    const out = document.getElementById('heat-out')!, note = document.getElementById('heat-note')!;
    const terrain = d.sites.filter((x) => d.horizons.get(x.id)!.dem.product !== 'sphere' || x.id === s.site);
    try {
      const g = siteDateGrid(d.ephem, terrain, d.horizons, parseUtc(s.t + ':00Z'), 384, 2, s.stay, s.mode);
      out.innerHTML = `<div style="overflow-x:auto">${heatmapSvg(g, s.site)}</div>
        <details class="extra"><summary>The same numbers as a table</summary><div style="overflow-x:auto">${heatmapTable(g)}</div></details>`;
      note.textContent = `${g.rows.length} sites, ${g.dates.length} landing dates, 2 days apart.`;
    } catch (e) { note.textContent = (e as Error).message; }
  });
  document.getElementById('copy')!.addEventListener('click', async () => {
    const out = document.getElementById('copied')!;
    try { await navigator.clipboard.writeText(location.href); out.textContent = 'Link copied.'; }
    catch { out.textContent = 'Copy the address from the address bar.'; }
  });
  f.querySelectorAll<HTMLButtonElement>('button[data-preset]').forEach((b) => b.addEventListener('click', () => {
    const p = PRESETS.find((x) => x.id === b.dataset.preset)!;
    render(d, { ...s, ...p.state });
  }));

  // --- SIM HOOK (Agent C): mount the 3D mission simulator into #sim-slot; it reads and writes this same state. ---
  mountSim(document.getElementById('sim-slot'), { ephem: d.ephem, sites: d.sites, horizons: d.horizons, features: d.features,
    mock: d.mock, state: s, setState: (p) => render(d, { ...s, ...p }) });
  // --- END SIM HOOK ---
  // --- FEATURE HOOK (C): custom site, landing-date explorer, site comparison, plain-language mode
  mountFeatures({ data: d, state: s, setState: (p) => render(d, { ...s, ...p }) });
  // --- END
}

(async () => {
  const s0 = readState(null);
  try {
    const d = await loadData(s0.data);
    const st = readState(d.sites);
    if (s0.site !== st.site) {
      linkNotice = `This link asks for the site "${s0.site}", which has no data in this build yet. Showing ${d.sites.find((x) => x.id === st.site)?.name ?? st.site} instead.`;
    }
    render(d, { ...st, data: s0.data });
  } catch (e) {
    app.innerHTML = `<div class="error" role="alert">${esc((e as Error).message)}. If the real data is not built yet, open <a href="?data=mock">the mock data</a>.</div>`;
  }
})();

// Offline reload support (service worker owned by Agent C; not on localhost).
if ('serviceWorker' in navigator && location.hostname !== 'localhost') navigator.serviceWorker.register('./sw.js').catch(() => {});
