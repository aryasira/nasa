// AI-assisted; see README.
// Feature state that lives in the permalink next to main.ts's own keys: lat, lon, elev, name (custom site),
// cmp (compared sites), explain. Read once at import (main.ts rewrites the query string on every render).
import { checkCustom, type CustomInput } from './custom';

export interface FeatState {
  custom: CustomInput | null;
  cmp: string[];
  explain: boolean;
  tour: number; // current guided-tour step (0-based)
  clickSets: 'slip' | 'base';
}

function read(): FeatState {
  const q = new URLSearchParams(typeof location === 'undefined' ? '' : location.search);
  const c = q.has('lat') || q.has('lon') ? checkCustom({ lat: q.get('lat'), lon: q.get('lon'), elev: q.get('elev'), name: q.get('name') }) : null;
  return {
    custom: c?.ok ? c.value! : null,
    cmp: (q.get('cmp') ?? '').split(',').map((x) => x.trim()).filter((x) => /^[\w-]{1,40}$/.test(x)).slice(0, 4),
    explain: q.get('explain') === '1',
    tour: 0,
    clickSets: 'slip',
  };
}

export const FS: FeatState = read();

/** Trim a coordinate for the URL without losing precision that matters (1e-6° ≈ 3 cm). */
const c6 = (v: number) => String(Math.round(v * 1e6) / 1e6);

/** Re-add the feature keys after main.ts's writeState() (which keeps only its own keys). */
export function writeFeatureParams(): void {
  const q = new URLSearchParams(location.search);
  for (const k of ['lat', 'lon', 'elev', 'name', 'cmp', 'explain']) q.delete(k);
  if (FS.custom) {
    q.set('lat', c6(FS.custom.lat));
    q.set('lon', c6(FS.custom.lon));
    if (FS.custom.elev != null) q.set('elev', String(FS.custom.elev));
    if (FS.custom.name) q.set('name', FS.custom.name);
  }
  if (FS.cmp.length) q.set('cmp', FS.cmp.join(','));
  if (FS.explain) q.set('explain', '1');
  history.replaceState(history.state, '', `${location.pathname}?${q.toString().replace(/%2C/g, ',')}`);
}
