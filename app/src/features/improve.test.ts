// AI-ASSISTED: drafted with Claude (Anthropic), reviewed by the human team.
// Earth link margin, CSV/JSON export and the site-by-date map, on the real data.
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import type { FeaturesFile, HorizonFile, SitesFile } from '@contracts/types';
import { Ephem, parseUtc } from '../engine/ephem';
import { siteFrame } from '../engine/geometry';
import { windowMetrics } from '../engine/metrics';
import { slipOptions } from '../engine/slip';
import { linkMargin, setLinkMargin } from '../engine/visibility';
import { exportRows, toCsv, toJson } from '../ui/export';
import { heatColor, heatmapSvg, heatmapTable, siteDateGrid } from './heatmap';
import { earthClearance, earthPlotSvg } from './earthplot';

const root = fileURLToPath(new URL('../../..', import.meta.url));
const D = 'app/public/data';
const json = <T>(p: string) => JSON.parse(readFileSync(root + p, 'utf8')) as T;

describe.skipIf(!existsSync(root + D + '/ephem.bin'))('improvements (real data)', () => {
  const buf = readFileSync(root + D + '/ephem.bin');
  const ephem = new Ephem(json(D + '/ephem.header.json'), buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  const sites = json<SitesFile>(D + '/sites.json').sites.filter((s) => existsSync(`${root}${D}/horizon/${s.id}.json`));
  const horizons = new Map(sites.map((s) => [s.id, json<HorizonFile>(`${D}/horizon/${s.id}.json`)]));
  const features = json<FeaturesFile>(D + '/features.json');
  const site = (id: string) => sites.find((s) => s.id === id)!;
  const t0 = parseUtc('2027-06-10T00:00:00Z');
  const win = (id: string) => windowMetrics(ephem, siteFrame(site(id)), horizons.get(id)!, t0, t0 + 14 * 86400, 'limb').metrics;
  afterEach(() => setLinkMargin(0));

  it('link margin: default is 0 and changes nothing; a larger margin never adds Earth time and never touches the Sun', () => {
    expect(linkMargin()).toBe(0);
    const base = win('connecting_ridge');
    let prev = base.earth_visible_pct;
    for (const m of [2, 5, 10]) {
      setLinkMargin(m);
      const w = win('connecting_ridge');
      expect(w.sunlit_h).toBe(base.sunlit_h);
      expect(w.earth_visible_pct).toBeLessThanOrEqual(prev);
      expect(w.both_visible_h).toBeLessThanOrEqual(base.both_visible_h);
      prev = w.earth_visible_pct;
    }
    expect(prev).toBeLessThan(base.earth_visible_pct); // Earth sits low at the pole, so 10 deg must cost something
    setLinkMargin(0);
    expect(win('connecting_ridge')).toEqual(base);
    setLinkMargin(-3); expect(linkMargin()).toBe(0);
    setLinkMargin(NaN); expect(linkMargin()).toBe(0);
  });

  it('export: one row per option, numbers match the table, CSV quotes text with commas', () => {
    const opts = slipOptions({ ephem, site: site('im2'), horizons, sites, features, tStart: parseUtc('2025-03-06T17:30:00Z'), stayDays: 10, slipDays: 7, mode: 'limb' });
    const rows = exportRows(opts);
    expect(rows).toHaveLength(opts.length);
    expect(rows[0].kind).toBe('baseline');
    expect(rows[0].change_vs_baseline_h).toBe(0);
    const slip = rows.find((r) => r.kind === 'slip')!, o = opts.find((x) => x.kind === 'slip')!;
    expect(slip.sun_and_earth_h).toBeCloseTo(o.metrics.both_visible_h, 1);
    expect(slip.causes).toEqual(o.causes.map((c) => c.text));
    const sc = { site_id: 'im2', site_name: 'IM-2', baseline_utc: '2025-03-06T17:30:00Z', stay_days: 10, slip_days: 7, visible_rule: 'any', earth_link_margin_deg: 0, page_url: 'x' };
    const csv = toCsv(sc, rows).trim().split('\n');
    const head = csv.findIndex((l) => l.startsWith('option,'));
    expect(head).toBeGreaterThan(0);
    expect(csv.length - head - 1).toBe(rows.length);
    expect(csv.some((l) => l.startsWith('# ai_generated: true'))).toBe(true);
    expect(toCsv(sc, [{ ...rows[0], causes: ['a, b', 'say "hi"'] }])).toContain('"a, b | say ""hi"""');
    const j = JSON.parse(toJson(sc, rows));
    expect(j.meta.ai_generated).toBe(true);
    expect(j.options).toHaveLength(rows.length);
  });

  it('Earth clearance plot: matches the engine, Earth sits low and drifts at the pole', () => {
    const cr = site('connecting_ridge'), hz = horizons.get('connecting_ridge')!;
    const es = earthClearance(ephem, cr, hz, t0, 30);
    expect(es.t).toHaveLength(30 * 24 + 1);
    expect(es.max).toBeLessThan(12);
    expect(es.max - es.min).toBeGreaterThan(3); // the monthly drift is several degrees
    const w = win('connecting_ridge'); // Earth is in view part of the time, so the line must cross the skyline
    if (w.earth_visible_pct > 1 && w.earth_visible_pct < 99) { expect(es.min).toBeLessThan(0.3); expect(es.max).toBeGreaterThan(-0.3); }
    const svg = earthPlotSvg(es, 5, [{ label: 'Baseline', tStart: t0, tEnd: t0 + 14 * 86400 }]);
    expect(svg).toContain('link margin 5°');
    expect(svg).toContain('skyline');
    expect(earthPlotSvg(es, 0, [])).not.toContain('link margin');
    const edge = earthClearance(ephem, cr, hz, ephem.tLast - 5 * 86400, 30); // stops at the end of the ephemeris
    expect(edge.t[edge.t.length - 1]).toBeLessThanOrEqual(ephem.tLast);
  });

  it('site-by-date map: bounded, matches the engine at a grid point, best marker is the maximum', () => {
    const terrain = sites.filter((s) => horizons.get(s.id)!.dem.product !== 'sphere');
    expect(terrain.length).toBeGreaterThanOrEqual(4);
    const g = siteDateGrid(ephem, terrain, horizons, t0, 60, 2, 7, 'limb');
    expect(g.dates).toHaveLength(31);
    for (const r of g.rows) {
      for (const h of r.both_h) { expect(h).toBeGreaterThanOrEqual(0); expect(h).toBeLessThanOrEqual(168); }
      expect(r.both_h[r.best]).toBe(Math.max(...r.both_h));
    }
    const cr = g.rows.find((r) => r.site.id === 'connecting_ridge')!;
    const exact = windowMetrics(ephem, siteFrame(site('connecting_ridge')), horizons.get('connecting_ridge')!, g.dates[5], g.dates[5] + 7 * 86400, 'limb').metrics.both_visible_h;
    expect(Math.abs(cr.both_h[5] - exact)).toBeLessThanOrEqual(3); // 30-minute samples against 10-minute samples
    const svg = heatmapSvg(g, 'connecting_ridge');
    expect((svg.match(/<rect /g) ?? []).length).toBeGreaterThanOrEqual(g.rows.length * g.dates.length);
    expect(svg).toContain('role="img"');
    expect(heatmapTable(g)).toContain('<th scope="row"');
    expect(heatColor(0)).toBe('rgb(18,38,58)');
    expect(heatColor(1)).toBe('rgb(159,211,255)');
    expect(heatColor(7)).toBe(heatColor(1));
    // the map near the end of the ephemeris stops instead of throwing
    const late = siteDateGrid(ephem, terrain.slice(0, 1), horizons, ephem.tLast - 20 * 86400, 384, 2, 7, 'limb');
    expect(late.dates.length).toBeGreaterThan(0);
    expect(late.dates.length).toBeLessThan(10);
  });
});
