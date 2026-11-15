// AI-ASSISTED: drafted with Claude (Anthropic), reviewed by the human team.
// Checks for the challenge-coverage features against the validated engine (real data in public/data).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { HorizonFile, SitesFile } from '@contracts/types';
import { Ephem, parseUtc } from '../engine/ephem';
import { siteFrame } from '../engine/geometry';
import { windowMetrics } from '../engine/metrics';
import { CountdownCache, countdownText, fmtCountdown, nextChange } from './countdown';
import { augmentSites, checkCustom, customSite, horizonDipDeg, normLon, sphereHorizon } from './custom';
import { bestDates, rhythmDays, scanDates } from './dates';
import { bestIndex, COLS, compareRow, sortRows } from './compare';
import { powerGeometry } from './power';

const root = fileURLToPath(new URL('../../public/data/', import.meta.url));
const json = <T>(p: string) => JSON.parse(readFileSync(root + p, 'utf8')) as T;
const buf = readFileSync(root + 'ephem.bin');
const ephem = new Ephem(json('ephem.header.json'), buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
const sites = json<SitesFile>('sites.json').sites;
const site = (id: string) => sites.find((s) => s.id === id)!;
const hzOf = (id: string) => json<HorizonFile>(`horizon/${id}.json`);
const DAY = 86400;

describe('countdown', () => {
  it('next sunset / Earthset match windowMetrics().next_*_utc within 60 s', () => {
    let checked = 0;
    for (const id of ['im1', 'im2', 'connecting_ridge', 'apollo11', 'chandrayaan3']) {
      const hz = hzOf(id), f = siteFrame(site(id));
      for (const day of [0, 9, 17, 23]) {
        const t0 = parseUtc('2024-01-19T23:20:00Z') + day * DAY;
        const m = windowMetrics(ephem, f, hz, t0, t0 + 30 * DAY, 'limb').metrics;
        for (const body of ['sun', 'earth'] as const) {
          const c = nextChange(ephem, f, hz.elev_deg, t0, body, 'limb');
          const ref = body === 'sun' ? m.next_sunset_utc : m.next_earthset_utc;
          if (!c.visibleNow) continue; // metrics report the set after the next rise; the countdown reports the rise
          if (ref == null) { expect(c.t).toBeNull(); continue; }
          expect(c.t).not.toBeNull();
          expect(Math.abs(c.t! - parseUtc(ref))).toBeLessThanOrEqual(60);
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(8);
  });

  it('a rise is followed by the set that windowMetrics reports', () => {
    const hz = hzOf('im1'), f = siteFrame(site('im1'));
    const t0 = parseUtc('2024-02-05T00:00:00Z');
    const c = nextChange(ephem, f, hz.elev_deg, t0, 'sun', 'limb');
    if (c.visibleNow || c.t == null) return;
    const m = windowMetrics(ephem, f, hz, t0, t0 + 30 * DAY, 'limb').metrics;
    const set = nextChange(ephem, f, hz.elev_deg, c.t + 1, 'sun', 'limb');
    expect(Math.abs(set.t! - parseUtc(m.next_sunset_utc!))).toBeLessThanOrEqual(60);
  });

  it('cache reuses the answer before the event and recomputes after it', () => {
    const hz = hzOf('im1'), f = siteFrame(site('im1'));
    const cache = new CountdownCache();
    const t0 = parseUtc('2024-01-20T00:00:00Z');
    const a = cache.get('im1', ephem, f, hz.elev_deg, t0, 'sun', 'limb');
    expect(cache.get('im1', ephem, f, hz.elev_deg, t0 + 600, 'sun', 'limb')).toBe(a);
    if (a.t) expect(cache.get('im1', ephem, f, hz.elev_deg, a.t + 60, 'sun', 'limb')).not.toBe(a);
  });

  it('formats', () => {
    expect(fmtCountdown(3 * DAY + 4 * 3600 + 59)).toBe('3 d 04 h');
    expect(fmtCountdown(5 * 3600 + 12 * 60)).toBe('5 h 12 min');
    expect(fmtCountdown(30)).toBe('under 1 min');
    const c = { body: 'earth' as const, from: 0, visibleNow: true, t: 10 * DAY, searchedTo: 30 * DAY };
    expect(countdownText(c, 0, 7 * DAY, true).label).toBe('No Earthset in this stay');
    expect(countdownText({ ...c, t: 2 * DAY }, 0, 7 * DAY, true).label).toBe('Earthset in 2 d 00 h');
    expect(countdownText({ ...c, body: 'sun', visibleNow: false, t: 3600 }, 0, 7 * DAY, false).label).toBe('Sunrise in 1 h 00 min');
  });
});

describe('custom sites', () => {
  it('dip for a 2 m mast on R = 1737.4 km is about −0.0869°', () => {
    expect(horizonDipDeg(1737.4, 2)).toBeCloseTo(-0.0869, 4);
    const hz = sphereHorizon({ id: 'x', elev_m: null });
    expect(hz.elev_deg.length).toBe(720);
    expect(hz.elev_deg.every((v) => v === hz.elev_deg[0])).toBe(true);
    expect(hz.dem.product).toBe('sphere');
    expect(hz.occluder.feature_id.every((v) => v === null)).toBe(true);
    expect(sphereHorizon({ id: 'y', elev_m: -5000 }).elev_deg[0]).toBeLessThan(hz.elev_deg[0]); // smaller R, larger dip... in magnitude
  });

  it('normalises longitude to east-positive 0–360', () => {
    expect(normLon(-180)).toBe(180);
    expect(normLon(-0.5)).toBeCloseTo(359.5, 12);
    expect(normLon(360)).toBe(0);
    expect(normLon(0)).toBe(0);
    expect(Object.is(normLon(-0), 0)).toBe(true);
    expect(normLon(206.0148)).toBeCloseTo(206.0148, 12);
  });

  it('validates input', () => {
    expect(checkCustom({ lat: '-89.44', lon: '-137.15', elev: '', name: 'Ridge' }).value).toEqual({ lat: -89.44, lon: 222.85, elev: null, name: 'Ridge' });
    expect(checkCustom({ lat: '91', lon: '0' }).ok).toBe(false);
    expect(checkCustom({ lat: '10', lon: '361' }).ok).toBe(false);
    expect(checkCustom({ lat: '10', lon: '-181' }).ok).toBe(false);
    expect(checkCustom({ lat: '', lon: '5' }).ok).toBe(false);
    expect(checkCustom({ lat: '10', lon: '5', elev: 'abc' }).ok).toBe(false);
    expect(checkCustom({ lat: '90', lon: '5' }).ok).toBe(false); // pole: local frame undefined
  });

  it('synthesizes sphere horizons only for sphere sites, and adds the custom site', () => {
    const s = [{ ...site('slim') }, { ...site('shackleton_sr1') }];
    const m = new Map<string, HorizonFile>();
    augmentSites(s, m, { lat: 10, lon: 20, elev: null, name: '' });
    expect(m.has('slim')).toBe(true);
    expect(m.has('shackleton_sr1')).toBe(false); // LOLA site without a file stays dropped
    expect(m.get('custom')!.dem.product).toBe('sphere');
    expect(s.map((x) => x.id)).toContain('custom');
    expect(customSite({ lat: 10, lon: 20, elev: null, name: 'A' }).lon_e).toBe(20);
  });
});

describe('landing-date explorer', () => {
  it('each sample equals windowMetrics for a stay starting then', () => {
    const id = 'im1', hz = hzOf(id), f = siteFrame(site(id));
    const t0 = parseUtc('2024-01-19T23:20:00Z');
    const s = scanDates(ephem, f, hz.elev_deg, t0, 7, 'limb', 60);
    for (const i of [0, 1, 7, 20, 33, 61, 119]) {
      const m = windowMetrics(ephem, f, hz, t0 + i * s.sampleS, t0 + i * s.sampleS + 7 * DAY, 'limb').metrics;
      expect(s.sun[i]).toBeCloseTo(m.sunlit_h, 6);
      expect(s.both[i]).toBeCloseTo(m.both_visible_h, 6);
      expect((100 * s.earth[i]) / (7 * 24)).toBeCloseTo(m.earth_visible_pct, 6);
    }
    const best = bestDates(s);
    expect(best.length).toBe(3);
    expect(best[0].both).toBeGreaterThanOrEqual(best[1].both);
  });

  it('finds the ~29.5-day rhythm at a mid-latitude site', () => {
    const s = scanDates(ephem, siteFrame(site('apollo11')), hzOf('apollo11').elev_deg, parseUtc('2024-03-01T00:00:00Z'), 7, 'limb', 200);
    const p = rhythmDays(s)!;
    expect(p).toBeGreaterThan(29);
    expect(p).toBeLessThan(30.1);
  });

  it('marks NaN past the end of the ephemeris', () => {
    const t = ephem.tLast - 20 * DAY;
    const s = scanDates(ephem, siteFrame(site('apollo11')), hzOf('apollo11').elev_deg, t - (t % 600), 7, 'limb', 30);
    expect(Number.isNaN(s.sun[s.n - 1])).toBe(true);
    expect(Number.isFinite(s.sun[0])).toBe(true);
  });
});

describe('site comparison', () => {
  it('metrics equal windowMetrics for the same date and stay', () => {
    const t0 = parseUtc('2024-01-19T23:24:00Z');
    const rows = ['im1', 'im2', 'slim'].map((id) => compareRow(ephem, site(id), hzOf(id), t0, 7, 'limb'));
    for (const r of rows) {
      const m = windowMetrics(ephem, siteFrame(r.site), hzOf(r.site.id), t0, t0 + 7 * DAY, 'limb').metrics;
      expect(r.metrics).toEqual(m);
      expect(r.maxSunEl).toBeLessThanOrEqual(90 - Math.abs(r.site.lat) + 1.6);
    }
    expect(rows[2].horizon).toBe('Smooth sphere');
    expect(rows[0].horizon).toBe('LOLA terrain');
    const both = COLS.find((c) => c.key === 'both')!;
    const bi = bestIndex(rows, both);
    if (bi >= 0) expect(rows[bi].metrics.both_visible_h).toBe(Math.max(...rows.map((r) => r.metrics.both_visible_h)));
    const sorted = sortRows(rows, 'sunlit', -1);
    expect(sorted[0].metrics.sunlit_h).toBe(Math.max(...rows.map((r) => r.metrics.sunlit_h)));
  });
});

describe('power geometry', () => {
  it('tracking = disc fraction; horizontal = fraction × sin(el), never negative', () => {
    const p = powerGeometry(30, 2, 1);
    expect(p.tracking).toBe(1);
    expect(p.horizontal).toBeCloseTo(0.5, 12);
    expect(p.clearance).toBe(28);
    expect(powerGeometry(-0.1, -0.5, 0.6).horizontal).toBe(0);
  });
});
