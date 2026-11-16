// AI-assisted; see README.
// Cross-checks the TypeScript engine against Agent C's Python reference (golden vectors, MOCK data),
// against JPL Horizons (Agent A's real fixtures), and checks the cause-line decomposition.
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { FeaturesFile, FixturesFile, HorizonFile, SitesFile } from '@contracts/types';
import { Ephem, parseUtc } from './ephem';
import { observe, siteFrame } from './geometry';
import { discFraction, horizonAt } from './visibility';
import { scanWindow, windowMetrics } from './metrics';
import { causeLines, visibleHours } from './causes';
import { slipOptions } from './slip';

const root = fileURLToPath(new URL('../../..', import.meta.url));
const json = <T>(p: string) => JSON.parse(readFileSync(root + p, 'utf8')) as T;
function load(dir: string) {
  const buf = readFileSync(root + dir + '/ephem.bin');
  const ephem = new Ephem(json(dir + '/ephem.header.json'), buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  const sites = json<SitesFile>(dir + '/sites.json').sites;
  const hz = (id: string) => json<HorizonFile>(`${dir}/horizon/${id}.json`);
  return { ephem, sites, site: (id: string) => sites.find((s) => s.id === id)!, hz };
}
const azGap = (a: number, b: number) => { const d = Math.abs(a - b) % 360; return Math.min(d, 360 - d); };

describe('golden vectors (mock data, Python reference engine)', () => {
  const g = json<any>('tests/golden/engine_vectors.json');
  const tol = g.tolerances;
  const m = load('app/public/data/mock');

  it('instants: az/el, radii, fractions, eclipse flags', () => {
    expect(g.instants.length).toBeGreaterThan(20);
    for (const i of g.instants) {
      const f = siteFrame(m.site(i.site_id));
      const h = m.hz(i.site_id).elev_deg;
      const o = observe(m.ephem, f, parseUtc(i.utc));
      const tag = `${i.site_id} ${i.utc}`;
      expect(azGap(o.sunAz, i.sun.az), tag).toBeLessThanOrEqual(tol.az_el_deg);
      expect(Math.abs(o.sunEl - i.sun.el), tag).toBeLessThanOrEqual(tol.az_el_deg);
      expect(Math.abs(o.sunR - i.sun.radius), tag).toBeLessThanOrEqual(tol.radius_deg);
      expect(Math.abs(discFraction(o.sunEl, o.sunR, horizonAt(h, o.sunAz)) - i.sun.fraction), tag).toBeLessThanOrEqual(tol.fraction);
      expect(azGap(o.earthAz, i.earth.az), tag).toBeLessThanOrEqual(tol.az_el_deg);
      expect(Math.abs(o.earthEl - i.earth.el), tag).toBeLessThanOrEqual(tol.az_el_deg);
      expect(Math.abs(o.earthR - i.earth.radius), tag).toBeLessThanOrEqual(tol.radius_deg);
      expect(Math.abs(discFraction(o.earthEl, o.earthR, horizonAt(h, o.earthAz)) - i.earth.fraction), tag).toBeLessThanOrEqual(tol.fraction);
      expect(Math.abs(o.earthDistKm - i.earth.dist_km), tag).toBeLessThanOrEqual(0.5);
      expect(Math.abs(o.earthElGeocentric - i.earth_el_geocentric), tag).toBeLessThanOrEqual(tol.az_el_deg);
      expect(Math.abs(o.sep - i.sun_earth_sep), tag).toBeLessThanOrEqual(tol.az_el_deg);
      expect(o.eclipsePartial, tag).toBe(i.eclipse_partial);
      expect(o.eclipseTotal, tag).toBe(i.eclipse_total);
    }
  });

  it('windows: metrics, events and bands', () => {
    const cmp = (a: any, b: any, tag: string) => {
      for (const k of ['sunlit_h', 'both_visible_h', 'longest_dark_gap_h', 'eclipse_h']) {
        expect(Math.abs(a[k] - b[k]), `${tag} ${k}`).toBeLessThanOrEqual(tol.hours);
      }
      expect(Math.abs(a.earth_visible_pct - b.earth_visible_pct), tag).toBeLessThanOrEqual(tol.pct);
      for (const k of ['next_sunset_utc', 'next_earthset_utc']) {
        if (b[k] == null) expect(a[k], `${tag} ${k}`).toBeNull();
        else expect(Math.abs(parseUtc(a[k]) - parseUtc(b[k])), `${tag} ${k}`).toBeLessThanOrEqual(tol.event_s);
      }
      expect(a.start_utc).toBe(b.start_utc);
      expect(a.end_utc).toBe(b.end_utc);
    };
    for (const w of g.windows) {
      const t0 = parseUtc(w.metrics.start_utc);
      const r = windowMetrics(m.ephem, siteFrame(m.site(w.metrics.site_id)), m.hz(w.metrics.site_id), t0, t0 + w.days * 86400, w.mode, { band: !!w.metrics.band });
      const tag = `${w.metrics.site_id} ${w.metrics.start_utc} ${w.mode}`;
      cmp(r.metrics, w.metrics, tag);
      if (w.metrics.band) { cmp(r.metrics.band!.lo, w.metrics.band.lo, tag + ' lo'); cmp(r.metrics.band!.hi, w.metrics.band.hi, tag + ' hi'); }
    }
  });

  it('sample refuses to extrapolate', () => {
    expect(() => m.ephem.sample(m.ephem.t0 - 1)).toThrow();
    expect(() => m.ephem.sample(m.ephem.tLast + 1)).toThrow();
  });
});

const REAL = 'app/public/data';
describe.skipIf(!existsSync(root + REAL + '/ephem.bin'))('real data', () => {
  const r = load(REAL);

  it('matches JPL Horizons fixtures within tolerance (Sun and Earth, topocentric)', () => {
    const fx = json<FixturesFile>(REAL + '/fixtures.json').fixtures;
    expect(fx.length).toBeGreaterThan(50);
    let worst = 0;
    for (const x of fx) {
      const o = observe(r.ephem, siteFrame(r.site(x.site_id)), parseUtc(x.utc));
      const [az, el] = x.body === 'sun' ? [o.sunAz, o.sunEl] : [o.earthAz, o.earthEl];
      const dAz = azGap(az, x.horizons_az) * Math.cos((x.horizons_el * Math.PI) / 180);
      const dEl = Math.abs(el - x.horizons_el);
      worst = Math.max(worst, dAz, dEl);
      expect(dAz, `${x.site_id} ${x.utc} ${x.body} az`).toBeLessThanOrEqual(x.tol_deg);
      expect(dEl, `${x.site_id} ${x.utc} ${x.body} el`).toBeLessThanOrEqual(x.tol_deg);
    }
    expect(worst).toBeLessThan(0.01);
  });

  it('Earth parallax: geocentric direction is wrong by up to ~0.26-0.28 deg', () => {
    const f = siteFrame(r.site('im1'));
    let worst = 0;
    for (let t = r.ephem.t0; t < r.ephem.t0 + 366 * 86400; t += 6 * 3600) {
      const o = observe(r.ephem, f, t);
      worst = Math.max(worst, Math.abs(o.earthEl - o.earthElGeocentric));
    }
    expect(worst).toBeGreaterThan(0.2);
    expect(worst).toBeLessThan(0.3);
  });

  it('cause lines (all pieces, threshold off) sum to the change in visible hours per body', () => {
    const features = json<FeaturesFile>(REAL + '/features.json');
    for (const id of ['im1', 'im2', 'connecting_ridge']) {
      const f = siteFrame(r.site(id)), hz = r.hz(id);
      const t0 = parseUtc('2025-03-06T17:30:00Z');
      const a = windowMetrics(r.ephem, f, hz, t0, t0 + 10 * 86400, 'limb');
      const b = windowMetrics(r.ephem, f, hz, t0 + 9 * 86400, t0 + 19 * 86400, 'limb');
      // Reporting threshold off (minH = 0) so every piece is listed.
      const lines = causeLines({ scan: a.scan, hz }, { scan: b.scan, hz }, features, 0);
      for (const body of ['sun', 'earth'] as const) {
        const total = visibleHours(b.scan, body) - visibleHours(a.scan, body);
        const sum = lines.filter((l) => l.body === body).reduce((s, l) => s + l.delta_h, 0);
        expect(Math.abs(total - sum), `${id} ${body}`).toBeLessThan(1e-6);
        for (const l of lines) if (l.kind === 'terrain') expect(l.az_deg).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('Connecting Ridge long-run sunlight is close to the published 92.27% (Gläser 2014)', () => {
    const sc = scanWindow(r.ephem, siteFrame(r.site('connecting_ridge')), r.hz('connecting_ridge').elev_deg, r.ephem.t0, r.ephem.tLast, 'limb', 3600);
    let n = 0;
    for (let k = 0; k < sc.n; k++) n += sc.sunVis[k];
    const pct = (100 * n) / sc.n;
    expect(pct).toBeGreaterThan(89);
    expect(pct).toBeLessThan(95);
  });

  it('slip options: baseline first, deltas consistent', () => {
    // Sites whose horizon file has not been generated yet are skipped, as the app does (C, Sat 23:35).
    const have = r.sites.filter((s) => existsSync(root + 'app/public/data/horizon/' + s.id + '.json'));
    const horizons = new Map(have.map((s) => [s.id, r.hz(s.id)]));
    const opts = slipOptions({ ephem: r.ephem, site: r.site('im2'), horizons, sites: have, features: null,
      tStart: parseUtc('2025-03-06T17:30:00Z'), stayDays: 10, slipDays: 7, mode: 'limb' });
    expect(opts[0].kind).toBe('baseline');
    expect(opts.length).toBeGreaterThan(1);
    for (const o of opts) expect(o.delta.sunlit_h).toBeCloseTo(o.metrics.sunlit_h - opts[0].metrics.sunlit_h, 9);
  });
});
