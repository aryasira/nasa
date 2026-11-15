// AI-ASSISTED: drafted with Claude (Anthropic), reviewed by the human team.
// Simulator overhaul checks: the illustrative ground never rises above the mast's line of sight (so the LOLA
// silhouette stays exact), and the cause line / status words only word the engine's readout.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { FeaturesFile, HorizonFile, SitesFile } from '@contracts/types';
import { Ephem } from '../engine/ephem';
import { observe, siteFrame } from '../engine/geometry';
import { featureIndex, readout } from './astro';
import { causeLine, commWord, distText, featuresContaining, powerWord } from './cause';
import { GroundModel } from './ground';

const root = fileURLToPath(new URL('../../public/data/', import.meta.url));
const json = <T>(p: string) => JSON.parse(readFileSync(root + p, 'utf8')) as T;
const buf = readFileSync(root + 'ephem.bin');
const ephem = new Ephem(json('ephem.header.json'), buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
const sites = json<SitesFile>('sites.json').sites;
const ff = json<FeaturesFile>('features.json');
const feats = featureIndex(ff);

describe('sim/ground', () => {
  it('drawn ground stays below the line of sight from the mast; crest vertices are exact', () => {
    for (const id of ['connecting_ridge', 'im1', 'im2', 'slim']) {
      const hz = json<HorizonFile>(`horizon/${id}.json`);
      const m = new GroundModel(hz);
      for (let i = 0; i < m.n; i += 3) {
        const az = i * m.step, D = m.dist[i];
        for (const s of [0.002, 0.01, 0.03, 0.1, 0.2, 0.35, 0.5, 0.7, 0.85, 0.95, 0.99, 0.999]) {
          const r = D * s;
          const h = m.heightAt(az, r);
          const seen = (Math.atan2(h - hz.mast_m, r) * 180) / Math.PI;
          expect(seen).toBeLessThanOrEqual(hz.elev_deg[i] + 1e-9);
        }
        const crest = (Math.atan2(m.heightAt(az, D) - hz.mast_m, D) * 180) / Math.PI;
        expect(crest).toBeCloseTo(hz.elev_deg[i], 9);
      }
    }
  });
});

describe('sim/cause', () => {
  it('distances: "< 0.5 km" below half a kilometre', () => {
    expect(distText(0.3)).toBe('< 0.5 km');
    expect(distText(2.43)).toBe('2.4 km');
    expect(distText(26.4)).toBe('26 km');
    expect(distText(null)).toBeNull();
  });

  it('cause line words the engine readout (blocked → feature, az, ridge and body elevations)', () => {
    const s = sites.find((x) => x.id === 'im2')!;
    const hz = json<HorizonFile>('horizon/im2.json');
    const f = siteFrame(s);
    const local = featuresContaining(s, ff);
    expect(local.has('mons_mouton')).toBe(true); // IM-2 sits on Mons Mouton → named, "the feature the site stands on"
    let n = 0;
    for (let t = ephem.t0; t < ephem.t0 + 400 * 86400 && n < 5; t += 3600) {
      const r = readout(ephem, f, hz, feats, t, 'limb');
      const o = observe(ephem, f, t);
      expect(r.sun.el).toBe(o.sunEl);
      if (!r.sun.blocker) continue;
      n++;
      const c = causeLine(r, local);
      expect(c.tone).toBe('blocked');
      expect(c.text).toMatch(/^Sun blocked by /);
      expect(c.text).toContain(`Sun ${r.sun.el < 0 ? '−' : ''}${Math.abs(r.sun.el).toFixed(2)}°`);
      expect(c.text).toContain(`Ridge ${r.sun.blocker.horizonEl < 0 ? '−' : ''}${Math.abs(r.sun.blocker.horizonEl).toFixed(2)}°`);
      if (r.sun.blocker.featureId === 'mons_mouton') expect(c.text).toContain('the feature the site stands on');
      expect(powerWord(r).word).toBe('Blocked');
    }
    expect(n).toBeGreaterThan(0);
  });

  it('clear and night states', () => {
    const s = sites.find((x) => x.id === 'connecting_ridge')!;
    const hz = json<HorizonFile>('horizon/connecting_ridge.json');
    const f = siteFrame(s);
    const seen = new Set<string>();
    for (let t = ephem.t0; t < ephem.t0 + 60 * 86400; t += 6 * 3600) {
      const r = readout(ephem, f, hz, feats, t, 'limb');
      const c = causeLine(r, new Set());
      if (r.sun.visible && r.earth.visible && r.power.state === 'SUNLIT' && r.sun.frac >= 0.999) expect(c.text).toBe('Sun and Earth in clear view.');
      if (r.comm.state === 'DTE LINK') expect(commWord(r).word).toBe('Link');
      seen.add(powerWord(r).word);
    }
    expect(seen.size).toBeGreaterThan(0);
  });
});
