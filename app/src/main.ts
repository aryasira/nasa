// AI-ASSISTED: drafted with Claude (Anthropic), reviewed by the human team.
// Slip Impact Brief: UI. All state lives in the query string (permalink).
import './style.css';
import type { EphemHeader, FeaturesFile, FixturesFile, HorizonFile, Site, SitesFile } from '@contracts/types';
import { Ephem, fmtUtc, parseUtc } from './engine/ephem';
import { observe, siteFrame } from './engine/geometry';
import { scanWindow, hasBand } from './engine/metrics';
import { alternateSites, bodyChanges, slipOptions, type SlipOptionEx } from './engine/slip';
import { causeName } from './engine/causes';
import type { Mode } from './engine/visibility';
import { panoramaSvg, timelineSvg, timelineTable, type TimelineWindow } from './ui/charts';
import { bandRange, deltaRange, withBand } from './ui/format';
import { mountSim } from './sim'; // SIM HOOK (Agent C): 3D mission simulator, see src/sim/

interface State { site: string; t: string; stay: number; slip: number; mode: Mode; data: 'real' | 'mock' }
interface Data {
  ephem: Ephem; header: EphemHeader; sites: Site[]; horizons: Map<string, HorizonFile>;
  features: FeaturesFile | null; fixtures: FixturesFile | null; mock: boolean;
}

const DAY = 86400;
const app = document.getElementById('app')!;
const esc = (s: unknown) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const h1 = (v: number) => v.toFixed(1);
const when = (iso: string | null) => (iso ? iso.slice(0, 16).replace('T', ' ') + ' UTC' : '—');
const signed = (v: number, unit: string) => `${v > 0 ? '+' : v < 0 ? '−' : '±'}${Math.abs(v).toFixed(1)}${unit}`;
const cls = (v: number, goodIsUp = true) => (Math.abs(v) < 0.05 ? '' : (v > 0) === goodIsUp ? 'pos' : 'neg');

const PRESETS: { id: string; label: string; state: Partial<State>; note: string }[] = [
  { id: 'im1-slip', label: 'IM-1: a 10-day slip', state: { site: 'im1', t: '2024-01-19T23:24', stay: 7, slip: 10, mode: 'limb' },
    note: 'Illustration with a 7-day surface stay. The January landing is an illustrative baseline date (original launch window 12–16 Jan 2024); the real mission landed 22 Feb 2024.' },
  { id: 'im1-actual', label: 'IM-1: January plan vs actual landing', state: { site: 'im1', t: '2024-01-19T23:24', stay: 7, slip: 34, mode: 'limb' },
    note: 'Compares an illustrative January baseline date (original launch window 12–16 Jan 2024) with the actual landing, 22 Feb 2024 23:24 UTC.' },
  { id: 'im2-slip', label: 'IM-2: a 7-day slip', state: { site: 'im2', t: '2025-03-06T17:29', stay: 10, slip: 7, mode: 'limb' },
    note: 'Illustration: Earth sets at Mons Mouton for part of each month.' },
];

function readState(sites: Site[] | null): State {
  const q = new URLSearchParams(location.search);
  const num = (k: string, d: number, lo: number, hi: number) => {
    const v = Number(q.get(k));
    return q.has(k) && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d;
  };
  const site = q.get('site') ?? 'im1';
  return {
    site: !sites || sites.some((s) => s.id === site) ? site : sites[0].id,
    t: /^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(q.get('t') ?? '') ? q.get('t')! : '2024-01-19T23:24',
    stay: num('stay', 7, 1, 60),
    slip: Math.round(num('slip', 10, -90, 90)),
    mode: q.get('mode') === 'centre' ? 'centre' : 'limb',
    data: q.get('data') === 'mock' ? 'mock' : 'real',
  };
}
function writeState(s: State) {
  const q = new URLSearchParams({ site: s.site, t: s.t, stay: String(s.stay), slip: String(s.slip), mode: s.mode });
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
  return `<form class="controls" id="f" aria-label="Scenario">
    <div class="wide"><label for="site">Landing site</label><select id="site" name="site">${opts}</select></div>
    <div class="wide"><label for="t">Baseline landing (UTC)</label><input id="t" name="t" type="datetime-local" value="${s.t}" min="${fmtUtc(d.ephem.t0).slice(0, 16)}" max="${fmtUtc(d.ephem.tLast).slice(0, 16)}" required></div>
    <div><label for="stay">Surface stay (days)</label><input id="stay" name="stay" type="number" min="1" max="60" step="1" value="${s.stay}" required></div>
    <div><label for="slip">Slip (days)</label><input id="slip" name="slip" type="number" min="-90" max="90" step="1" value="${s.slip}" required></div>
    <div class="wide"><label for="mode">Counts as visible when</label><select id="mode" name="mode">
      <option value="limb" ${s.mode === 'limb' ? 'selected' : ''}>any part of the disc shows</option>
      <option value="centre" ${s.mode === 'centre' ? 'selected' : ''}>at least half the disc shows</option></select></div>
    <div class="wide row"><button type="button" id="print">Print one-page brief</button><button type="button" id="copy">Copy link</button><span id="copied" role="status" class="note"></span></div>
    <div class="wide" style="grid-column:1/-1"><span class="note">Examples:</span>
      <span class="row" style="display:inline-flex">${PRESETS.filter((p) => d.sites.some((x) => x.id === p.state.site)).map((p) => `<button type="button" data-preset="${p.id}">${esc(p.label)}</button>`).join('')}</span></div>
  </form>`;
}

function optionRows(opts: SlipOptionEx[], d: Data): string {
  const base = opts[0].metrics;
  return opts.map((o) => {
    const m = o.metrics, isBase = o.kind === 'baseline';
    const hz = d.horizons.get(o.site_id)!;
    const B = hasBand(hz) && hasBand(d.horizons.get(opts[0].site_id)!); // show bands only when the terrain sigma is real
    const dBoth = m.both_visible_h - base.both_visible_h;
    const shown = o.causes.slice(0, 4), more = o.causes.slice(4);
    const li = (c: SlipOptionEx['causes'][number]) => `<li class="${c.delta_h < 0 ? 'lost' : 'gained'}">${esc(c.text)}${c.kind === 'orbital' ? `<span class="tag">${o.kind === 'alternate' ? 'location' : 'orbit'}, not terrain</span>` : c.kind === 'dip' ? '<span class="tag">site height</span>' : '<span class="tag">terrain</span>'}</li>`;
    const causes = isBase ? '' : `<tr class="causes k-${o.kind}"><td colspan="7">${o.note ? `<small>${esc(o.note)}</small>` : ''}
      ${shown.length ? `<ul class="cause" aria-label="Causes for ${esc(o.label)}">${shown.map(li).join('')}</ul>` : '<small> No change of half an hour or more in Sun or Earth visibility.</small>'}
      ${more.length ? `<details class="extra"><summary>${more.length} smaller cause${more.length > 1 ? 's' : ''}</summary><ul class="cause">${more.map(li).join('')}</ul></details>` : ''}</td></tr>`;
    return `<tr class="${isBase ? 'base' : ''}"><td><strong>${esc(o.label)}</strong></td>
      <td class="num">${when(o.start_utc)}</td>
      <td class="num">${withBand(h1(m.sunlit_h), B ? bandRange(m, 'sunlit_h') : null)}</td><td class="num">${withBand(m.earth_visible_pct.toFixed(0) + '%', B ? bandRange(m, 'earth_visible_pct') : null)}</td>
      <td class="num"><strong>${h1(m.both_visible_h)}</strong>${withBand('', B ? bandRange(m, 'both_visible_h') : null)}</td>
      <td class="num">${withBand(h1(m.longest_dark_gap_h), B ? bandRange(m, 'longest_dark_gap_h') : null)}</td>
      <td class="num delta ${cls(dBoth)}">${isBase ? '—' : withBand(signed(dBoth, ' h'), B ? deltaRange(m, base, 'both_visible_h') : null, true)}</td></tr>${causes}`;
  }).join('');
}

function headline(opts: SlipOptionEx[], site: Site, s: State): string {
  const base = opts[0], slip = opts.find((o) => o.kind === 'slip'), rec = opts.find((o) => o.kind === 'recover');
  if (!slip) return `<p class="headline">At <strong>${esc(site.name)}</strong>, a ${s.stay}-day stay from ${when(base.start_utc)} has <strong>${h1(base.metrics.both_visible_h)} h</strong> with both the Sun and Earth in view. Enter a slip to see what changes.</p>`;
  const d = slip.metrics.both_visible_h - base.metrics.both_visible_h;
  const verb = Math.abs(d) < 0.05 ? 'does not change' : d < 0 ? 'cuts' : 'adds to';
  let txt = `<p class="headline">A <strong>${Math.abs(s.slip)}-day ${s.slip < 0 ? 'advance' : 'slip'}</strong> at ${esc(site.name)} ${verb} the time with both Sun and Earth in view`
    + (Math.abs(d) < 0.05 ? ` (${h1(base.metrics.both_visible_h)} h of a ${s.stay}-day stay).` : `: <strong>${h1(base.metrics.both_visible_h)} h → ${h1(slip.metrics.both_visible_h)} h</strong> (<strong class="${d < 0 ? 'loss' : 'gain'}">${withBand(signed(d, ' h'), deltaRange(slip.metrics, base.metrics, 'both_visible_h'), true)}</strong>) over a ${s.stay}-day stay.`) + '</p>';
  // Per body: net change in visible hours and its largest same-sign cause; the cause's hours are quoted only if not larger than the change.
  const why = bodyChanges(base, slip).map((x) => `${x.body === 'sun' ? 'Sun' : 'Earth'} in view ${h1(x.before_h)} h → ${h1(x.after_h)} h (${signed(x.delta_h, ' h')})`
    + (!x.cause ? '' : x.causeFits ? `; main cause: ${esc(causeName(x.cause))} (${signed(x.cause.delta_h, ' h')})` : `; main cause: ${esc(causeName(x.cause))}, partly offset by other changes`));
  const terr = slip.causes.filter((c) => c.kind === 'terrain').slice(0, 2).map((c) => esc(c.text));
  if (why.length) txt += `<p class="headline why"><strong>Why:</strong> ${why.join('. ')}.</p>`;
  txt += `<p><strong>Terrain:</strong> ${terr.length ? terr.join('. ') + '.' : 'no terrain change of half an hour or more.'}</p>`;
  if (rec) {
    const days = Math.round((parseUtc(rec.start_utc) - parseUtc(base.start_utc)) / DAY);
    txt += rec.label.startsWith('Next')
      ? `<p><strong>Knock-on effect:</strong> the next landing date that is as good as the baseline is <strong>${when(rec.start_utc)}</strong>, ${days} days after the baseline. A ${Math.abs(s.slip)}-day slip becomes a ${days}-day wait.</p>`
      : `<p><strong>Knock-on effect:</strong> no date in the 60 days after the slip matches the baseline; the best is ${when(rec.start_utc)} (${days} days after the baseline).</p>`;
  }
  return txt;
}

function render(d: Data, s: State) {
  writeState(s);
  const site = d.sites.find((x) => x.id === s.site)!;
  const hz = d.horizons.get(site.id)!;
  const preset = PRESETS.find((p) => Object.entries(p.state).every(([k, v]) => (s as any)[k] === v));
  let results = '';
  try {
    const tStart = parseUtc(s.t + ':00Z');
    const opts = slipOptions({ ephem: d.ephem, site, horizons: d.horizons, sites: d.sites, features: d.features,
      tStart, stayDays: s.stay, slipDays: s.slip, mode: s.mode });
    const same = opts.filter((o) => o.site_id === site.id);
    const t0 = Math.max(d.ephem.t0, Math.min(...same.map((o) => o.scan.tStart)) - 2 * DAY);
    const t1 = Math.min(d.ephem.tLast, Math.max(...same.map((o) => o.scan.tEnd)) + 2 * DAY);
    const wide = scanWindow(d.ephem, siteFrame(site), hz.elev_deg, t0, t1, s.mode);
    const wins: TimelineWindow[] = same.map((o) => ({ label: o.kind === 'baseline' ? 'Baseline' : o.kind === 'slip' ? 'Slipped' : 'Recovery', tStart: o.scan.tStart, tEnd: o.scan.tEnd, emphasis: o.kind === 'slip' }));
    const slip = opts.find((o) => o.kind === 'slip');
    const tracks = [{ label: 'Baseline', scan: opts[0].scan, dashed: false }];
    if (slip) tracks.push({ label: 'Slipped', scan: slip.scan, dashed: true });
    const markers = (slip?.causes ?? []).filter((c) => c.kind === 'terrain' && c.az_deg != null && Math.abs(c.delta_h) >= 1).slice(0, 3)
      .map((c) => ({ az: c.az_deg as number, label: `${c.body === 'sun' ? 'Sun' : 'Earth'} ${c.delta_h < 0 ? '−' : '+'}${Math.abs(c.delta_h).toFixed(0)} h` }));
    const sphere = hz.dem.product === 'sphere';
    results = `
    <section aria-labelledby="h-sum" aria-live="polite"><h2 id="h-sum">What the slip does</h2>${headline(opts, site, s)}
      ${preset ? `<p class="note">${esc(preset.note)}${site.story ? ' ' + esc(site.story) : ''}</p>` : ''}</section>
    <section aria-labelledby="h-opt"><h2 id="h-opt">Options, ranked by time with both Sun and Earth in view</h2>
      <div style="overflow-x:auto"><table><thead><tr><th scope="col">Option</th><th scope="col">Landing</th><th scope="col">Sunlit (h)</th><th scope="col">Earth in view</th><th scope="col">Sun + Earth (h)</th><th scope="col">Longest dark gap (h)</th><th scope="col">Change vs baseline</th></tr></thead>
      <tbody>${optionRows(opts, d)}</tbody></table></div>
      <p class="note">Each stay is ${s.stay} days from landing, sampled every 10 minutes. Per body, the cause lines sum to the change in that body's visible hours, apart from pieces under half an hour, which are not listed.
      Sunlit hours include time when Earth covers part or all of the Sun.${opts.some((o) => o.metrics.eclipse_h > 0) ? ` Eclipse (Earth covers the Sun): ${opts.filter((o) => o.metrics.eclipse_h > 0).map((o) => `${esc(o.label)} ${h1(o.metrics.eclipse_h)} h`).join(', ')}.` : ''}
      ${hasBand(hz) ? `Figures in brackets are the range when the terrain is lowered or raised by its published height error (σ = ${hz.dem.sigma_m} m).` : 'No terrain-error band is shown: the horizon file carries no terrain height error.'}
      ${s.slip !== 0 ? esc(alternateSites({ site, sites: d.sites, horizons: d.horizons }).note ?? '') : ''}</p></section>
    <section aria-labelledby="h-tl"><h2 id="h-tl">Timeline at ${esc(site.name)}</h2>
      ${timelineSvg(wide, wins, `Sun, Earth and both visible at ${site.name} from ${fmtUtc(t0).slice(0, 10)} to ${fmtUtc(t1).slice(0, 10)}, with the baseline and slipped stays marked`, 'Three rows show when the Sun, Earth and both are above the local horizon. Bars underneath mark each stay. The same intervals are listed in the table below the chart.')}
      <details class="extra"><summary>Timeline as a table</summary><div style="overflow-x:auto">${timelineTable(wide)}</div></details>
      <div class="legend"><span><span class="sw" style="background:#e69f00"></span>Sun above the local horizon</span><span><span class="sw" style="background:repeating-linear-gradient(45deg,#56b4e9 0 3px,#0b3d5c 3px 5px)"></span>Earth above the local horizon (hatched)</span><span><span class="sw" style="background:#009e73"></span>both (cross-hatched)</span><span><span class="sw" style="background:#cc79a7"></span>Earth covers part of the Sun</span><span><span class="sw" style="background:#f0e442"></span>slipped stay</span></div></section>
    <section aria-labelledby="h-pan"><h2 id="h-pan">Local horizon, all the way round</h2>
      ${panoramaSvg(hz, tracks, markers, `Terrain horizon at ${site.name} over 360 degrees of azimuth with the Sun and Earth paths for the baseline and slipped stays`, 'The grey shape is the horizon by compass direction. A body is in view where its path is above the grey shape.', hasBand(hz))}
      <div class="legend"><span><span class="sw" style="background:#6b7686"></span>${sphere ? 'smooth-sphere horizon (no terrain model for this site)' : 'terrain (LOLA)'}</span><span><span class="sw" style="background:#e69f00"></span>Sun path</span><span><span class="sw" style="background:#56b4e9"></span>Earth path</span><span>solid = baseline stay, dashed = slipped stay</span>${hasBand(hz) ? '<span><span class="sw" style="background:#f0e44259"></span>horizon with terrain lowered or raised by its height error</span>' : ''}<span>yellow line = a terrain cause from the table</span></div>
      <p class="note">Vertical scale is stretched; paths above the top of the plot are cut off.</p></section>`;
  } catch (e) {
    results = `<div class="error" role="alert">${esc((e as Error).message)} Ephemeris covers ${when(fmtUtc(d.ephem.t0))} to ${when(fmtUtc(d.ephem.tLast))}.</div>`;
  }
  document.title = `${site.name}, ${s.slip > 0 ? '+' : ''}${s.slip} d slip — Slip Impact Brief`;
  const res = residuals(d);
  const bench = !d.mock && BENCH[site.id] ? { ...BENCH[site.id], ...longRunSunlit(d, site, s.mode) } : null;
  const altUsed = site.elev_m == null ? ' (catalogue elevation not published; 0 m used for the site vector)' : '';
  app.innerHTML = `
  <header class="top"><h1>Slip Impact Brief</h1>
    <p>When a lunar landing slips, see which sunlight and direct-to-Earth windows a site gains or loses, and what causes each change: the terrain that blocks the view, its direction and its distance, or the Moon's own cycle.</p></header>
  ${d.mock ? '<div class="banner" role="alert">MOCK DATA — synthetic values for development. Not results.</div>' : ''}
  <div id="sim-slot"></div><h2 class="brief-h" id="h-brief">Mission brief</h2>
  ${controls(d, s)}
  <main id="main" tabindex="-1">
  <p class="printonly"><strong>Scenario:</strong> ${esc(site.name)} · baseline landing ${when(s.t + ':00Z')} · ${s.stay}-day stay · slip ${s.slip} d · ${s.mode === 'limb' ? 'any part of the disc' : 'half the disc'} · ${esc(location.href)}</p>
  ${results}
  <div class="grid2" style="margin-top:14px">
    <section aria-labelledby="h-site"><h2 id="h-site">Site</h2><dl>
      <dt>Name</dt><dd>${esc(site.name)} <span class="tag">${site.name_status === 'iau' ? 'IAU name' : 'informal name'}</span></dd>
      <dt>Position</dt><dd class="mono">${Math.abs(site.lat).toFixed(4)}°${site.lat < 0 ? 'S' : 'N'}, ${site.lon_e.toFixed(4)}°E${site.elev_m != null ? `, ${site.elev_m} m` : ''}</dd>
      <dt>Source</dt><dd><a href="${esc(site.source.url)}" rel="noopener">${esc(site.source.org)}</a>${altUsed}</dd>
      <dt class="ph">Horizon</dt><dd class="ph">${esc(hz.dem.product)}${hz.dem.res_m ? `, ${hz.dem.res_m} m grid` : ''}${hz.dem.max_range_km ? `, out to ${hz.dem.max_range_km} km` : ''}; observer ${hz.mast_m} m above ground</dd>
      ${site.landing_utc ? `<dt>Landed</dt><dd class="mono">${when(site.landing_utc)}</dd>` : ''}</dl></section>
    <section aria-labelledby="h-val"><h2 id="h-val">How far to trust this</h2><dl>
      <dt>Checked against</dt><dd>${res ? `NASA JPL Horizons, ${res.n} Sun and Earth positions at ${res.sites} landing sites, recomputed in your browser just now: largest gap <span class="mono">${res.az.toFixed(4)}°</span> in azimuth and <span class="mono">${res.el.toFixed(4)}°</span> in elevation.` : 'No Horizons fixtures loaded for this data set.'}</dd>
      ${bench ? `<dt>Published benchmark</dt><dd>Sunlit <span class="mono">${bench.pct.toFixed(1)}%</span> of the time here over ${bench.years.toFixed(0)} years (${fmtUtc(d.ephem.t0).slice(0, 4)}–${fmtUtc(d.ephem.tLast).slice(0, 4)}, ${s.mode === 'limb' ? 'any part of the disc' : 'half the disc'}), computed just now. Published: ${esc(BENCH[site.id].pct)} (${esc(bench.cite)}). A different time span and a newer terrain model, so a close match is the test, not an exact one.</dd>` : ''}
      <dt class="ph">Ephemeris</dt><dd class="ph">${esc(d.header.spice_version)}, frame ${esc(d.header.frame)}, hourly, ${esc(d.header.kernels.join(', '))}</dd>
      <dt class="ph">Earth</dt><dd class="ph">Seen from the site, not from the Moon's centre (the difference reaches about 0.28°, hours of Earthrise time near the poles).</dd>
      <dt>Not modelled</dt><dd>Lander tilt and attitude, solar-panel pointing, thermal limits, radio link budget, relay satellites. "In view" means line of sight only.</dd></dl></section>
  </div>
  </main>
  <footer><p>Built during NASA Space Apps Challenge 2026 by team Space City Ad Lunam. This project was built with AI assistance (Anthropic Claude) for research, code, tests and documentation, reviewed by the human team.
    Data: NASA/NAIF SPICE kernels (DE440), NASA JPL Horizons, LRO LOLA topography (NASA GSFC PGDA), LROC landing-site coordinates, USGS/IAU Gazetteer of Planetary Nomenclature. NASA does not endorse this project.</p></footer>`;

  const f = document.getElementById('f') as HTMLFormElement;
  f.addEventListener('change', () => {
    if (!f.reportValidity()) return;
    const fd = new FormData(f);
    render(d, { ...s, site: String(fd.get('site')), t: String(fd.get('t')).slice(0, 16), stay: Number(fd.get('stay')), slip: Math.round(Number(fd.get('slip'))), mode: fd.get('mode') === 'centre' ? 'centre' : 'limb' });
    document.getElementById(document.activeElement?.id || 'site')?.focus();
  });
  f.addEventListener('submit', (e) => e.preventDefault());
  document.getElementById('print')!.addEventListener('click', () => window.print());
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
}

(async () => {
  const s0 = readState(null);
  try {
    const d = await loadData(s0.data);
    render(d, { ...readState(d.sites), data: s0.data });
  } catch (e) {
    app.innerHTML = `<div class="error" role="alert">${esc((e as Error).message)}. If the real data is not built yet, open <a href="?data=mock">the mock data</a>.</div>`;
  }
})();

// Offline reload support (service worker owned by Agent C; not on localhost).
if ('serviceWorker' in navigator && location.hostname !== 'localhost') navigator.serviceWorker.register('./sw.js').catch(() => {});
