// AI-assisted; see README.
// Checks that the simulator's HUD numbers are the engine's numbers, that scene directions follow the
// engine's azimuth convention, and that the 3D skyline reproduces elev_deg exactly from the mast.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { FeaturesFile, HorizonFile, SitesFile } from '@contracts/types';
import { Ephem, parseUtc } from '../engine/ephem';
import { observe, siteFrame } from '../engine/geometry';
import { azElFromDir, dirFromAzEl, featureIndex, moonToScene, readout, ridgeDistances, ridgeHeight } from './astro';

const root = fileURLToPath(new URL('../../public/data/', import.meta.url));
const json = <T>(p: string) => JSON.parse(readFileSync(root + p, 'utf8')) as T;
const buf = readFileSync(root + 'ephem.bin');
const ephem = new Ephem(json('ephem.header.json'), buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
const sites = json<SitesFile>('sites.json').sites;
const feats = featureIndex(json<FeaturesFile>('features.json'));

describe('sim/astro', () => {
  it('scene directions: az clockwise from north (N = −z, E = +x), round trip', () => {
    const close = (a: number[], b: number[]) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], 12));
    close(dirFromAzEl(0, 0), [0, 0, -1]);
    close(dirFromAzEl(90, 0), [1, 0, 0]);
    close(dirFromAzEl(180, 0), [0, 0, 1]);
    close(dirFromAzEl(0, 90), [0, 1, 0]);
    for (const [az, el] of [[12.5, 3], [181, -2], [359.5, 40]]) {
      const r = azElFromDir(dirFromAzEl(az, el));
      expect(r.az).toBeCloseTo(az, 9); expect(r.el).toBeCloseTo(el, 9);
    }
    // MOON_ME → globe scene is a proper rotation: z (north pole) → +y.
    expect(moonToScene([0, 0, 1])).toEqual([0, 1, -0]);
  });

  it('HUD readout equals engine observe() and horizon lookup', () => {
    const s = sites.find((x) => x.id === 'connecting_ridge')!;
    const hz = json<HorizonFile>('horizon/connecting_ridge.json');
    const f = siteFrame(s);
    for (const iso of ['2024-03-01T00:00:00Z', '2025-07-04T12:34:56Z', '2027-11-20T06:00:00Z']) {
      const t = parseUtc(iso);
      const o = observe(ephem, f, t);
      const r = readout(ephem, f, hz, feats, t, 'limb');
      expect(r.sun.az).toBe(o.sunAz); expect(r.sun.el).toBe(o.sunEl);
      expect(r.earth.az).toBe(o.earthAz); expect(r.earth.el).toBe(o.earthEl);
      expect(r.power.pct).toBeGreaterThanOrEqual(0); expect(r.power.pct).toBeLessThanOrEqual(100);
    }
  });

  it('terrain-blocked instants name the occluder from the horizon file', () => {
    const s = sites.find((x) => x.id === 'im2')!;
    const hz = json<HorizonFile>('horizon/im2.json');
    const f = siteFrame(s);
    let found = 0;
    for (let t = ephem.t0; t < ephem.t0 + 400 * 86400 && found < 5; t += 3600) {
      const r = readout(ephem, f, hz, feats, t, 'limb');
      if (r.sun.blocker) {
        found++;
        expect(r.power.state).toBe('SHADOW (terrain)');
        expect(r.sun.blocker.horizonEl).toBeGreaterThan(r.sun.el - r.sun.r);
        expect(r.sun.blocker.name.length).toBeGreaterThan(0);
      }
    }
    expect(found).toBeGreaterThan(0);
  });

  it('3D skyline vertex sits exactly at elev_deg seen from the mast', () => {
    for (const id of ['connecting_ridge', 'im1', 'im2', 'slim']) {
      const hz = json<HorizonFile>(`horizon/${id}.json`);
      const D = ridgeDistances(hz);
      for (let i = 0; i < hz.elev_deg.length; i += 7) {
        expect(D[i]).toBeGreaterThanOrEqual(299.999); expect(D[i]).toBeLessThanOrEqual(20000.001);
        const y = ridgeHeight(hz.elev_deg[i], D[i], hz.mast_m);
        const seen = (Math.atan2(y - hz.mast_m, D[i]) * 180) / Math.PI;
        expect(seen).toBeCloseTo(hz.elev_deg[i], 9);
      }
    }
  });
});
