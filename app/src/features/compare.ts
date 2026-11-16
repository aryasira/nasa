// AI-assisted; see README.
// Side-by-side site comparison (pure, no DOM). Every number is the engine's windowMetrics for the same landing
// date and stay; the only extra is the highest Sun elevation on the same 10-minute grid.
import type { HorizonFile, Site, WindowMetrics } from '@contracts/types';
import type { Ephem } from '../engine/ephem';
import { siteFrame } from '../engine/geometry';
import { windowMetrics } from '../engine/metrics';
import type { Mode } from '../engine/visibility';
import { isSphere } from './custom';

export interface CompareRow {
  site: Site;
  metrics: WindowMetrics;
  maxSunEl: number; // degrees above the local horizontal plane (not above terrain)
  horizon: 'LOLA terrain' | 'Smooth sphere';
}

export function compareRow(ephem: Ephem, site: Site, hz: HorizonFile, tStart: number, stayDays: number, mode: Mode): CompareRow {
  const { metrics, scan } = windowMetrics(ephem, siteFrame(site), hz, tStart, tStart + stayDays * 86400, mode);
  let maxSunEl = -90;
  for (let k = 0; k <= scan.n; k++) if (scan.sunEl[k] > maxSunEl) maxSunEl = scan.sunEl[k];
  return { site, metrics, maxSunEl, horizon: isSphere(hz) ? 'Smooth sphere' : 'LOLA terrain' };
}

export type ColKey = 'name' | 'sunlit' | 'earth' | 'both' | 'gap' | 'maxel' | 'sunset' | 'earthset' | 'horizon';
export interface Col { key: ColKey; label: string; better?: 'hi' | 'lo'; value: (r: CompareRow) => number | string | null }

const tnum = (s: string | null) => (s ? Date.parse(s) : null);
export const COLS: Col[] = [
  { key: 'name', label: 'Site', value: (r) => r.site.name },
  { key: 'sunlit', label: 'Sunlit (h)', better: 'hi', value: (r) => r.metrics.sunlit_h },
  { key: 'earth', label: 'Earth in view', better: 'hi', value: (r) => r.metrics.earth_visible_pct },
  { key: 'both', label: 'Sun + Earth (h)', better: 'hi', value: (r) => r.metrics.both_visible_h },
  { key: 'gap', label: 'Longest dark gap (h)', better: 'lo', value: (r) => r.metrics.longest_dark_gap_h },
  { key: 'maxel', label: 'Max Sun elevation', better: 'hi', value: (r) => r.maxSunEl },
  { key: 'sunset', label: 'Next sunset (UTC)', value: (r) => tnum(r.metrics.next_sunset_utc) },
  { key: 'earthset', label: 'Next Earthset (UTC)', value: (r) => tnum(r.metrics.next_earthset_utc) },
  { key: 'horizon', label: 'Horizon', value: (r) => r.horizon },
];

/** Index of the best row for a column (ties → none marked), or -1. */
export function bestIndex(rows: CompareRow[], col: Col): number {
  if (!col.better || rows.length < 2) return -1;
  const v = rows.map((r) => col.value(r) as number);
  const best = col.better === 'hi' ? Math.max(...v) : Math.min(...v);
  const hits = v.map((x, i) => (Math.abs(x - best) < 1e-9 ? i : -1)).filter((i) => i >= 0);
  return hits.length === 1 ? hits[0] : -1;
}

/** Sort rows by a column; nulls (no event in the stay) last. */
export function sortRows(rows: CompareRow[], key: ColKey, dir: 1 | -1): CompareRow[] {
  const col = COLS.find((c) => c.key === key)!;
  return [...rows].sort((a, b) => {
    const x = col.value(a), y = col.value(b);
    if (x == null && y == null) return 0;
    if (x == null) return 1;
    if (y == null) return -1;
    return (typeof x === 'string' ? x.localeCompare(String(y)) : (x as number) - (y as number)) * dir;
  });
}
