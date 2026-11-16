// AI-assisted; see README.
// Plain-English cause line for the simulator (pure, no DOM, no three.js). It only words the engine's
// readout (astro.readout → observe/horizonAt/discFraction); it never computes a new number.
import type { FeaturesFile, Site } from '@contracts/types';
import { compass } from '../engine/causes';
import type { BodyReadout, Readout } from './astro';

const D2R = Math.PI / 180;
const R_MOON_KM = 1737.4;

export type Tone = 'clear' | 'blocked' | 'down' | 'partial';
export interface CausePart { tone: Tone; html: string; text: string }
export interface Cause { tone: Tone; parts: CausePart[]; text: string }

/** Escape for HTML. */
export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

/** Signed angle with two decimals and a real minus sign. */
export const deg2 = (v: number) => `${v < 0 ? '−' : ''}${Math.abs(v).toFixed(2)}°`;
export const az3 = (v: number) => `${String(Math.round(v) % 360).padStart(3, '0')}°`;
export function distText(km: number | null): string | null {
  if (km == null || !Number.isFinite(km)) return null;
  if (km < 0.5) return '< 0.5 km';
  return `${km < 10 ? km.toFixed(1) : km.toFixed(0)} km`;
}

/** Great-circle distance between two lat/lon points on the reference sphere (km). */
export function surfaceKm(lat1: number, lon1: number, lat2: number, lon2: number) {
  const p1 = lat1 * D2R, p2 = lat2 * D2R, dl = (lon2 - lon1) * D2R;
  const c = Math.sin(p1) * Math.sin(p2) + Math.cos(p1) * Math.cos(p2) * Math.cos(dl);
  return Math.acos(Math.max(-1, Math.min(1, c))) * R_MOON_KM;
}

/** Ids of named features whose catalogue radius contains the site (the site sits on them). */
export function featuresContaining(site: Pick<Site, 'lat' | 'lon_e'>, f: FeaturesFile | null): Set<string> {
  const out = new Set<string>();
  for (const x of f?.features ?? []) {
    if (x.radius_km != null && surfaceKm(site.lat, site.lon_e, x.lat, x.lon_e) <= x.radius_km) out.add(x.id);
  }
  return out;
}

const n = (s: string) => `<span class="num">${s}</span>`;

/** Name used in the sentence; a feature that contains the site itself is named and marked as such. */
export function blockerName(b: NonNullable<BodyReadout['blocker']>, local: Set<string>): string {
  if (!b.featureId) return b.distKm != null && b.distKm < 0.5 ? 'nearby terrain' : 'unnamed terrain';
  return local.has(b.featureId) ? `${b.name} (the feature the site stands on)` : b.name;
}

function blockedPart(name: 'Sun' | 'Earth', b: BodyReadout, local: Set<string>): CausePart {
  const k = b.blocker!;
  const who = blockerName(k, local);
  const d = distText(k.distKm);
  const where = `${d ? `${d} away ` : ''}toward ${az3(k.az)} (${compass(k.az)})`;
  const whereH = `${d ? `${n(esc(d.replace(' km', '')))} km away ` : ''}toward ${n(az3(k.az))} (${compass(k.az)})`;
  const text = `${name} blocked by ${who} — ${where}. Ridge ${deg2(k.horizonEl)}, ${name} ${deg2(k.bodyEl)}.`;
  const html = `<b>${name} blocked</b> by ${esc(who)} — ${whereH}. Ridge ${n(deg2(k.horizonEl))}, ${name} ${n(deg2(k.bodyEl))}.`;
  return { tone: 'blocked', text, html };
}

function downPart(name: 'Sun' | 'Earth', b: BodyReadout): CausePart {
  const why = name === 'Sun' ? 'lunar night' : 'libration';
  const text = `${name} below the horizon (${why}), ${deg2(b.el)}.`;
  return { tone: 'down', text, html: `${name} below the horizon (${why}), ${n(deg2(b.el))}.` };
}

/**
 * One or two short sentences: the hero line under the 3D view.
 * Examples: "Sun and Earth in clear view." · "Sun blocked by Mons Mouton — 26 km away toward 078° (ENE). Ridge 2.41°, Sun 0.60°."
 */
export function causeLine(r: Readout, local: Set<string>): Cause {
  const parts: CausePart[] = [];
  const sun = r.sun, earth = r.earth;
  const sunClear = sun.visible && r.power.state !== 'ECLIPSE';
  if (sunClear && earth.visible) {
    const partial = sun.frac < 0.999 ? ` ${Math.round(sun.frac * 100)}% of the Sun's disc is above the skyline.` : '';
    parts.push({ tone: partial ? 'partial' : 'clear', text: `Sun and Earth in clear view.${partial}`,
      html: `Sun and Earth in clear view.${partial ? ` ${n(String(Math.round(sun.frac * 100)) + '%')} of the Sun's disc is above the skyline.` : ''}` });
  } else {
    if (sun.blocker) parts.push(blockedPart('Sun', sun, local));
    else if (r.power.state === 'ECLIPSE') parts.push({ tone: 'partial', text: `Sun in view, but Earth covers ${r.power.pct === 0 ? 'all' : 'part'} of it (eclipse).`,
      html: `Sun in view, but Earth covers ${r.power.pct === 0 ? 'all' : 'part'} of it (eclipse).` });
    else if (sun.visible) {
      const p = sun.frac < 0.999 ? `, ${Math.round(sun.frac * 100)}% of its disc above the skyline` : '';
      parts.push({ tone: p ? 'partial' : 'clear', text: `Sun in clear view${p}.`, html: `Sun in clear view${p ? `, ${n(Math.round(sun.frac * 100) + '%')} of its disc above the skyline` : ''}.` });
    } else parts.push(downPart('Sun', sun));
    if (earth.blocker) parts.push(blockedPart('Earth', earth, local));
    else if (earth.visible) parts.push({ tone: 'clear', text: 'Earth in clear view.', html: 'Earth in clear view.' });
    else parts.push(downPart('Earth', earth));
  }
  const rank: Record<Tone, number> = { blocked: 3, partial: 2, down: 1, clear: 0 };
  const tone = parts.reduce<Tone>((t, p) => (rank[p.tone] > rank[t] ? p.tone : t), 'clear');
  return { tone, parts, text: parts.map((p) => p.text).join(' ') };
}

/** Short state words for the status cards. */
export function powerWord(r: Readout): { word: string; tone: Tone } {
  switch (r.power.state) {
    case 'SUNLIT': return { word: r.sun.frac < 0.999 ? 'Partial Sun' : 'Sunlit', tone: r.sun.frac < 0.999 ? 'partial' : 'clear' };
    case 'ECLIPSE': return { word: 'Eclipse', tone: 'partial' };
    case 'SHADOW (terrain)': return { word: 'Blocked', tone: 'blocked' };
    default: return { word: 'Night', tone: 'down' };
  }
}
export function commWord(r: Readout): { word: string; tone: Tone } {
  switch (r.comm.state) {
    case 'DTE LINK': return { word: 'Link', tone: 'clear' };
    case 'NO LINK (terrain)': return { word: 'Blocked', tone: 'blocked' };
    default: return { word: 'Earth set', tone: 'down' };
  }
}
