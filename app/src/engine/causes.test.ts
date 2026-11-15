// AI-ASSISTED: drafted with Claude (Anthropic), reviewed by the human team.
// Cause-line and slip correctness on the real data (REVIEW.md, "For Agent B" items 1-10).
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { CauseLine, FeaturesFile, HorizonFile, SitesFile } from '@contracts/types';
import { Ephem, parseUtc } from './ephem';
import { siteFrame } from './geometry';
import { windowMetrics, type Scan } from './metrics';
import { azIndex } from './visibility';
import { causeLines, causeName, hiddenSamples, siteIsOn, visibleHours } from './causes';
import { bodyChanges, slipOptions, type SlipOptionEx } from './slip';

const root = fileURLToPath(new URL('../../..', import.meta.url));
const D = 'app/public/data';
const json = <T>(p: string) => JSON.parse(readFileSync(root + p, 'utf8')) as T;

describe.skipIf(!existsSync(root + D + '/ephem.bin'))('cause lines and slip options (real data)', () => {
  const buf = readFileSync(root + D + '/ephem.bin');
  const ephem = new Ephem(json(D + '/ephem.header.json'), buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  const sites = json<SitesFile>(D + '/sites.json').sites.filter((s) => existsSync(`${root}${D}/horizon/${s.id}.json`));
  const horizons = new Map(sites.map((s) => [s.id, json<HorizonFile>(`${D}/horizon/${s.id}.json`)]));
  const features = json<FeaturesFile>(D + '/features.json');
  const site = (id: string) => sites.find((s) => s.id === id)!;
  const run = (id: string, t: string, stayDays: number, slipDays: number) => slipOptions({
    alternateRangeKm: 1000, // wide range so alternates exist before the nearby terrain sites arrive (round 2 default is 150 km for polar sites)
    ephem, site: site(id), horizons, sites, features, tStart: parseUtc(t), stayDays, slipDays, mode: 'limb' });
  const win = (id: string, t: number, days: number) => windowMetrics(ephem, siteFrame(site(id)), horizons.get(id)!, t, t + days * 86400, 'limb');
  const sumBody = (ls: CauseLine[], body: string) => ls.filter((l) => l.body === body).reduce((s, l) => s + l.delta_h, 0);
  const IM2: [string, string, number, number] = ['im2', '2025-03-06T17:30:00Z', 10, 7];
  const CR: [string, string, number, number] = ['connecting_ridge', '2025-03-06T17:30:00Z', 10, 7];
  const of = (o: SlipOptionEx[], k: SlipOptionEx['kind']) => o.find((x) => x.kind === k)!;

  it('1. one net non-terrain line per body; no cancelling site-height pieces; headline cause never exceeds the change', () => {
    for (const c of [IM2, CR, ['im1', '2024-01-19T23:24:00Z', 7, 10] as typeof IM2]) {
      const opts = run(...c);
      for (const o of opts.slice(1)) {
        for (const body of ['sun', 'earth'] as const) {
          const orb = o.causes.filter((l) => l.body === body && l.kind === 'orbital');
          expect(orb.length, `${c[0]} ${o.label} ${body}`).toBeLessThanOrEqual(1);
        }
        expect(o.causes.some((l) => l.kind === 'dip'), `${c[0]} ${o.label}`).toBe(false);
        for (const b of bodyChanges(opts[0], o)) {
          if (b.causeFits) expect(Math.abs(b.cause!.delta_h)).toBeLessThanOrEqual(Math.abs(b.delta_h) + 1e-6);
        }
      }
    }
    // IM-2 +7 d: before, Earth "lost 123 h" + "gained 41 h"; now one net line each.
    const im2 = of(run(...IM2), 'slip');
    const e = im2.causes.find((l) => l.body === 'earth')!, s = im2.causes.find((l) => l.body === 'sun')!;
    expect(e.delta_h).toBeCloseTo(-82.33, 1);
    expect(e.text).toMatch(/^Earth lost 82 h — Earth's libration, net of site height/);
    expect(s.delta_h).toBeCloseTo(-90.33, 1);
    expect(s.text).toMatch(/^Sun lost 90 h — lunar day\/night cycle, net of site height/);
    // Connecting Ridge +7 d: before, Sun "+112 h" orbital and "−112 h" site height; now no Sun line, Earth −168 h.
    const cr = of(run(...CR), 'slip');
    expect(cr.causes.filter((l) => l.body === 'sun')).toHaveLength(0);
    expect(cr.causes.map((l) => Math.round(l.delta_h))).toEqual([-168]);
    const why = bodyChanges(run(...CR)[0], cr);
    expect(why.map((b) => b.body)).toEqual(['earth']);
    expect(why[0].causeFits).toBe(true);
  });

  it('2. advance or zero slip never makes a "+0 d" recovery; a slip past the ephemeris throws RangeError', () => {
    for (const slip of [-5, -1, 0]) {
      const opts = run('im1', '2024-01-19T23:24:00Z', 7, slip);
      expect(opts.some((o) => o.kind === 'recover'), `slip ${slip}`).toBe(false);
      expect(opts.some((o) => /\+0 d/.test(o.label)), `slip ${slip}`).toBe(false);
    }
    const late = new Date((ephem.tLast - 5 * 86400) * 1000).toISOString().slice(0, 19) + 'Z';
    expect(() => run('im1', late, 3, 10)).toThrow(RangeError);
    const early = new Date((ephem.t0 + 86400) * 1000).toISOString().slice(0, 19) + 'Z';
    expect(() => run('im1', early, 3, -5)).toThrow(RangeError);
  });

  it('3. alternate sites: the non-terrain line is a location difference, not day/night or libration', () => {
    const alts = run(...IM2).filter((o) => o.kind === 'alternate');
    expect(alts.length).toBeGreaterThan(0);
    for (const o of alts) for (const l of o.causes.filter((x) => x.kind === 'orbital')) {
      expect(l.text).toMatch(/different location and date/);
      expect(l.text).not.toMatch(/day\/night|libration/);
    }
  });

  it('4. per body, listed lines + unlisted pieces (< 0.5 h) = change in visible hours', () => {
    for (const id of ['im1', 'im2', 'connecting_ridge', 'chandrayaan3']) {
      for (const [d0, d1] of [[0, 7], [0, 9], [3, 17]]) {
        const t0 = parseUtc('2025-03-06T17:30:00Z');
        const a = win(id, t0 + d0 * 86400, 10), b = win(id, t0 + d1 * 86400, 10);
        const hz = horizons.get(id)!;
        const all = causeLines({ scan: a.scan, hz }, { scan: b.scan, hz }, features, 0);
        const listed = causeLines({ scan: a.scan, hz }, { scan: b.scan, hz }, features);
        const unlisted = all.filter((l) => Math.abs(l.delta_h) < 0.5);
        expect(listed.length + unlisted.length).toBe(all.length);
        for (const body of ['sun', 'earth'] as const) {
          const total = visibleHours(b.scan, body) - visibleHours(a.scan, body);
          expect(Math.abs(sumBody(all, body) - total), `${id} ${d0}->${d1} ${body}`).toBeLessThan(1e-6);
          expect(Math.abs(sumBody(listed, body) + sumBody(unlisted, body) - total), `${id} ${body}`).toBeLessThan(1e-6);
          for (const l of listed) expect(Math.abs(l.delta_h)).toBeGreaterThanOrEqual(0.5);
        }
      }
    }
  });

  it('5. one unnamed ridge keeps one key across windows (IM-1 2024-02-13 +6 d)', () => {
    const slip = of(run('im1', '2024-02-13T00:00:00Z', 7, 6), 'slip');
    const terr = slip.causes.filter((l) => l.kind === 'terrain' && l.body === 'sun');
    // Before: "gained 67 h at az 82°" and "lost 4.7 h at az 66°" for the same ridge.
    expect(terr).toHaveLength(1);
    expect(terr[0].delta_h).toBeCloseTo(62.83, 1);
    expect(Math.round(terr[0].az_deg!)).toBe(82);
  });

  it('6. distance and azimuth are medians over the hidden samples', () => {
    const opts = run('im1', '2024-01-19T23:24:00Z', 7, 10);
    const slip = of(opts, 'slip');
    const hz = horizons.get('im1')!;
    const west = slip.causes.find((l) => l.kind === 'terrain' && l.delta_h < 0)!;
    expect(Math.round(west.az_deg!)).toBe(264);
    // The hidden samples of this run in the slipped window (W sector), recomputed here.
    const sc: Scan = slip.scan;
    const ks = hiddenSamples(sc, 'sun').filter((k) => Math.abs(sc.sunAz[k] - west.az_deg!) < 20);
    const ds = ks.map((k) => hz.occluder.dist_m[azIndex(sc.sunAz[k])]!).sort((x, y) => x - y);
    const med = ds.length % 2 ? ds[ds.length >> 1] : 0.5 * (ds[ds.length / 2 - 1] + ds[ds.length / 2]);
    expect(west.dist_km! * 1000).toBeCloseTo(med, 6);
    expect(west.text).toMatch(/2\.0 km$/);
  });

  it('7. no distances finer than the DEM can resolve', () => {
    const all = [run('im1', '2024-01-19T23:24:00Z', 7, 10), run('im1', '2024-02-13T00:00:00Z', 7, 6), run(...IM2), run(...CR)].flat();
    for (const o of all) for (const l of o.causes) {
      expect(l.text).not.toMatch(/\b0\.[0-4] km/);
      if (l.kind === 'terrain' && l.dist_km != null && l.dist_km < 0.5) expect(l.text).toMatch(/< 0\.5 km/);
    }
    const ex = of(run('im1', '2024-02-13T00:00:00Z', 7, 6), 'slip').causes.find((l) => l.kind === 'terrain')!;
    expect(ex.text).toBe('Sun gained 63 h — no longer blocked by unnamed terrain at az 82° (E), < 0.5 km');
  });

  it('8. non-terrain lines use az_deg null (contract number | null)', () => {
    for (const o of run(...IM2).slice(1)) for (const l of o.causes) {
      if (l.kind === 'orbital') expect(l.az_deg).toBeNull();
      else expect(Number.isFinite(l.az_deg)).toBe(true);
    }
  });

  it('9. a named feature the site stands on is called "local terrain"', () => {
    const hz = horizons.get('im2')!;
    const f = (id: string) => features.features.find((x) => x.id === id)!;
    expect(siteIsOn(hz, f('mons_mouton'))).toBe(true);
    expect(siteIsOn(hz, f('nobile'))).toBe(false);
    expect(siteIsOn(horizons.get('connecting_ridge')!, f('connecting_ridge_summit'))).toBe(true);
    let seen = 0;
    const t0 = parseUtc('2024-01-10T00:00:00Z');
    for (let d = 0; d < 30; d += 3) {
      const a = win('im2', t0, 7), b = win('im2', t0 + d * 86400, 7);
      for (const l of causeLines({ scan: a.scan, hz }, { scan: b.scan, hz }, features)) {
        expect(l.text).not.toMatch(/Mons Mouton/);
        if (l.feature_id === 'mons_mouton') { expect(l.text).toMatch(/local terrain/); seen++; }
      }
    }
    expect(seen).toBeGreaterThan(0);
  });

  it('10. eclipse hours are counted inside the sunlit hours', () => {
    const base = run(...IM2)[0].metrics;
    expect(base.eclipse_h).toBeGreaterThan(0);
    expect(base.eclipse_h).toBeLessThanOrEqual(base.sunlit_h);
    expect(base.sunlit_h).toBeCloseTo(240, 6); // Sun up the whole stay, eclipse included
  });

  it('IM-1 regression: 7-day stay from 2024-01-19T23:24Z, 10-day slip, 155.3 h -> 82.0 h, next as good +30 d', () => {
    const opts = run('im1', '2024-01-19T23:24:00Z', 7, 10);
    const base = opts[0], slip = of(opts, 'slip'), rec = of(opts, 'recover');
    expect(base.metrics.sunlit_h.toFixed(1)).toBe('155.3');
    expect(slip.metrics.sunlit_h.toFixed(1)).toBe('82.0');
    expect(base.metrics.both_visible_h.toFixed(1)).toBe('155.3');
    expect(slip.metrics.both_visible_h.toFixed(1)).toBe('82.0');
    expect(rec.label).toBe('Next date as good as baseline (+30 d)');
    expect(rec.start_utc).toBe('2024-02-18T23:24:00Z');
    const why = bodyChanges(base, slip);
    expect(why).toHaveLength(1);
    expect(why[0].body).toBe('sun');
    expect(why[0].delta_h).toBeCloseTo(-73.33, 1);
    expect(why[0].causeFits).toBe(true);
    expect(causeName(why[0].cause!)).toBe('lunar day/night cycle');
    expect(why[0].cause!.delta_h).toBeCloseTo(-69, 1);
  });
});

// ---- Agent B, round 2: uncertainty bands on a synthetic horizon, alternate-site rule ----
import { readFileSync as rf2 } from 'node:fs';
import { fileURLToPath as fu2 } from 'node:url';
import { Ephem as Ephem2, parseUtc as parseUtc2 } from './ephem';
import { siteFrame as siteFrame2 } from './geometry';
import { hasBand as hasBand2, windowMetrics as windowMetrics2 } from './metrics';
import { alternateSites as alternateSites2 } from './slip';
import { bandRange, deltaRange, withBand } from '../ui/format';

describe('round 2: bands and alternates', () => {
  const root2 = fu2(new URL('../../..', import.meta.url));
  const J = (p: string) => JSON.parse(rf2(root2 + 'app/public/data/' + p, 'utf8'));
  const buf = rf2(root2 + 'app/public/data/ephem.bin');
  const ephem = new Ephem2(J('ephem.header.json'), buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  const sites: any[] = J('sites.json').sites;
  const site = (id: string) => sites.find((s) => s.id === id);

  it('synthetic ±0.1° band: lowered terrain never shows less, raised never more; formatting', () => {
    const hz = J('horizon/im2.json');
    hz.elev_lo_deg = hz.elev_deg.map((v: number) => v - 0.1);
    hz.elev_hi_deg = hz.elev_deg.map((v: number) => v + 0.1);
    hz.dem.sigma_m = 0.4;
    expect(hasBand2(hz)).toBe(true);
    const t0 = ephem.t0 + 430 * 86400;
    const a = windowMetrics2(ephem, siteFrame2(site('im2')), hz, t0, t0 + 10 * 86400, 'limb', { band: true }).metrics;
    const b = windowMetrics2(ephem, siteFrame2(site('im2')), hz, t0 + 7 * 86400, t0 + 17 * 86400, 'limb', { band: true }).metrics;
    for (const m of [a, b]) for (const k of ['sunlit_h', 'both_visible_h', 'earth_visible_pct'] as const) {
      expect(m.band!.lo[k]!).toBeGreaterThanOrEqual(m[k]);
      expect(m.band!.hi[k]!).toBeLessThanOrEqual(m[k]);
      const r = bandRange(m, k)!;
      expect(r[0]).toBeLessThanOrEqual(m[k]);
      expect(r[1]).toBeGreaterThanOrEqual(m[k]);
    }
    const dr = deltaRange(b, a, 'both_visible_h')!;
    const d = b.both_visible_h - a.both_visible_h;
    expect(dr[0]).toBeLessThanOrEqual(d);
    expect(dr[1]).toBeGreaterThanOrEqual(d);
    expect(withBand('82.0', [78.2, 85.4])).toBe('82.0 (78–85)');
    expect(withBand('−73.3 h', [-78.4, -70.1], true)).toBe('−73.3 h (−78 to −70)');
    expect(withBand('82.0', null)).toBe('82.0');
    void parseUtc2;
  });

  it('polar sites only get terrain-modelled alternates within 150 km', () => {
    const horizons = new Map<string, any>();
    for (const s of sites) { try { horizons.set(s.id, J(`horizon/${s.id}.json`)); } catch { /* horizon not built yet */ } }
    const have = sites.filter((s) => horizons.has(s.id));
    for (const id of ['im1', 'im2', 'connecting_ridge', 'chandrayaan3']) {
      const r = alternateSites2({ site: site(id), sites: have, horizons });
      for (const x of r.alts) { expect(x.s.terrain).toBe('lola'); expect(x.km).toBeLessThanOrEqual(150); }
      if (!r.alts.length) expect(r.note).toContain('No terrain-modelled site within 150 km');
    }
    const eq = alternateSites2({ site: site('apollo11'), sites: have, horizons });
    for (const x of eq.alts) expect(x.km).toBeLessThanOrEqual(1000);
  });
});
