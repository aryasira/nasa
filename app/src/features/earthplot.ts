// AI-ASSISTED: drafted with Claude (Anthropic), reviewed by the human team.
// Earth's height above the local skyline through one month. Near the pole Earth never rises high;
// it drifts up and down a few degrees as the Moon wobbles (libration), and that drift decides the
// direct-to-Earth link. This plot shows the drift without needing the word.
import type { HorizonFile, Site } from '@contracts/types';
import { Ephem, fmtUtc } from '../engine/ephem';
import { observe, siteFrame } from '../engine/geometry';
import { horizonAt } from '../engine/visibility';

export interface EarthSeries { t: number[]; clear: number[]; min: number; max: number } // clear = Earth-centre elevation minus skyline, deg

export function earthClearance(ephem: Ephem, site: Site, hz: HorizonFile, tStart: number, days: number, stepS = 3600): EarthSeries {
  const f = siteFrame(site), t: number[] = [], clear: number[] = [];
  const end = Math.min(tStart + days * 86400, ephem.tLast);
  for (let x = Math.max(tStart, ephem.t0); x <= end; x += stepS) {
    const o = observe(ephem, f, x);
    t.push(x); clear.push(o.earthEl - horizonAt(hz.elev_deg, o.earthAz));
  }
  return { t, clear, min: Math.min(...clear), max: Math.max(...clear) };
}

export function earthPlotSvg(s: EarthSeries, marginDeg: number, stays: { label: string; tStart: number; tEnd: number }[]): string {
  const W = 900, H = 220, L = 46, R = 12, T = 14, B = 26;
  const lo = Math.min(-1, Math.floor(s.min)), hi = Math.max(marginDeg + 1, Math.ceil(s.max));
  const t0 = s.t[0], t1 = s.t[s.t.length - 1];
  const X = (t: number) => L + ((t - t0) / Math.max(1, t1 - t0)) * (W - L - R);
  const Y = (v: number) => T + ((hi - v) / (hi - lo)) * (H - T - B);
  let o = `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Earth's height above the local skyline over ${Math.round((t1 - t0) / 86400)} days, from ${s.min.toFixed(1)} to ${s.max.toFixed(1)} degrees. Earth is in view while the line is above ${marginDeg} degrees.">`;
  for (const w of stays) { // stays as shaded spans, labelled
    const a = Math.max(t0, w.tStart), b = Math.min(t1, w.tEnd);
    if (b > a) o += `<rect x="${X(a)}" y="${T}" width="${X(b) - X(a)}" height="${H - T - B}" fill="#ffffff" opacity="0.07"/><text x="${X(a) + 4}" y="${T + 11}" fill="#a9b4c2" font-size="10">${w.label}</text>`;
  }
  const step = hi - lo > 12 ? 5 : hi - lo > 6 ? 2 : 1;
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) {
    o += `<line x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}" stroke="#2e3947" stroke-width="1"/><text x="${L - 6}" y="${Y(v) + 3}" text-anchor="end" fill="#a9b4c2" font-size="10">${v}°</text>`;
  }
  let last = '';
  s.t.forEach((t) => { // one tick every 5 days
    const d = fmtUtc(t).slice(0, 10);
    if (d !== last && Math.round((t - t0) / 86400) % 5 === 0 && fmtUtc(t).slice(11, 13) === fmtUtc(t0).slice(11, 13)) {
      last = d; o += `<text x="${X(t)}" y="${H - 8}" text-anchor="middle" fill="#a9b4c2" font-size="10">${d.slice(5)}</text>`;
    }
  });
  o += `<line x1="${L}" x2="${W - R}" y1="${Y(0)}" y2="${Y(0)}" stroke="#6b7686" stroke-width="2"/><text x="${W - R - 4}" y="${Y(0) - 4}" text-anchor="end" fill="#a9b4c2" font-size="10">skyline</text>`;
  if (marginDeg > 0) o += `<line x1="${L}" x2="${W - R}" y1="${Y(marginDeg)}" y2="${Y(marginDeg)}" stroke="#56b4e9" stroke-width="1" stroke-dasharray="5 4"/><text x="${W - R - 4}" y="${Y(marginDeg) - 4}" text-anchor="end" fill="#a9b4c2" font-size="10">link margin ${marginDeg}°</text>`;
  o += `<path d="${s.t.map((t, i) => `${i ? 'L' : 'M'}${X(t).toFixed(1)} ${Y(s.clear[i]).toFixed(1)}`).join('')}" fill="none" stroke="#56b4e9" stroke-width="2"/>`;
  return o + '</svg>';
}
