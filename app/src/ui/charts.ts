// AI-ASSISTED: drafted with Claude (Anthropic), reviewed by the human team.
// SVG charts: visibility timeline and 360-degree horizon panorama. Colour + pattern + label (colour-blind safe).
import type { HorizonFile } from '@contracts/types';
import { STEP_S, type Scan } from '../engine/metrics';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const SUN = '#e69f00', EARTH = '#56b4e9', BOTH = '#009e73';
const day = (t: number) => new Date(t * 1000).toISOString().slice(5, 10);

const DEFS = `<defs>
  <pattern id="p-earth" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill="${EARTH}"/><rect width="2" height="6" fill="#0b3d5c"/></pattern>
  <pattern id="p-both" width="6" height="6" patternUnits="userSpaceOnUse"><rect width="6" height="6" fill="${BOTH}"/><path d="M0 0L6 6M6 0L0 6" stroke="#003d2d" stroke-width="1.2"/></pattern>
</defs>`;

function runs(v: (k: number) => boolean, n: number): [number, number][] {
  const out: [number, number][] = [];
  let s = -1;
  for (let k = 0; k <= n; k++) {
    const on = k < n && v(k);
    if (on && s < 0) s = k;
    if (!on && s >= 0) { out.push([s, k]); s = -1; }
  }
  return out;
}

export interface TimelineWindow { label: string; tStart: number; tEnd: number; emphasis?: boolean }

export function timelineSvg(scan: Scan, windows: TimelineWindow[], title: string): string {
  const W = 1000, L = 78, R = 12, top = 18, rowH = 20, gap = 6;
  const span = scan.tEnd - scan.tStart;
  const x = (t: number) => L + ((t - scan.tStart) / span) * (W - L - R);
  const xk = (k: number) => x(scan.tStart + k * STEP_S);
  const rows: [string, string, (k: number) => boolean][] = [
    ['Sun', SUN, (k) => !!scan.sunVis[k]],
    ['Earth', 'url(#p-earth)', (k) => !!scan.earthVis[k]],
    ['Sun + Earth', 'url(#p-both)', (k) => !!(scan.sunVis[k] & scan.earthVis[k])],
  ];
  let y = top;
  let body = '';
  for (const [name, fill, fn] of rows) {
    body += `<text x="${L - 6}" y="${y + 14}" text-anchor="end">${name}</text><rect x="${L}" y="${y}" width="${W - L - R}" height="${rowH}" fill="#0b0f14" stroke="#3a4656"/>`;
    for (const [a, b] of runs(fn, scan.n)) body += `<rect x="${xk(a).toFixed(1)}" y="${y}" width="${Math.max(0.6, xk(b) - xk(a)).toFixed(1)}" height="${rowH}" fill="${fill}"/>`;
    y += rowH + gap;
  }
  for (const [a, b] of runs((k) => !!(scan.eclipse[k] & scan.sunVis[k]), scan.n)) {
    body += `<rect x="${xk(a).toFixed(1)}" y="${top - 5}" width="${Math.max(3, xk(b) - xk(a)).toFixed(1)}" height="4" fill="#cc79a7"><title>Earth covers part of the Sun (eclipse)</title></rect>`;
  }
  y += 4;
  for (const w of windows) {
    const x0 = x(Math.max(w.tStart, scan.tStart)), x1 = x(Math.min(w.tEnd, scan.tEnd));
    body += `<text x="${L - 6}" y="${y + 9}" text-anchor="end" class="muted">${esc(w.label)}</text>`
      + `<rect x="${x0.toFixed(1)}" y="${y}" width="${(x1 - x0).toFixed(1)}" height="10" fill="${w.emphasis ? '#f0e442' : '#8894a3'}" rx="2"/>`;
    y += 16;
  }
  const stepDays = Math.max(1, Math.ceil(span / 86400 / 12));
  const first = Math.ceil(scan.tStart / 86400) * 86400;
  for (let t = first; t <= scan.tEnd; t += stepDays * 86400) {
    body += `<line x1="${x(t).toFixed(1)}" x2="${x(t).toFixed(1)}" y1="${top}" y2="${y}" stroke="#ffffff22"/><text x="${x(t).toFixed(1)}" y="${y + 12}" text-anchor="middle" class="muted">${day(t)}</text>`;
  }
  const H = y + 18;
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(title)}"><title>${esc(title)}</title>${DEFS}${body}</svg>`;
}

export interface Track { label: string; scan: Scan; dashed: boolean }
export interface Marker { az: number; label: string }

export function panoramaSvg(hz: HorizonFile, tracks: Track[], markers: Marker[], title: string): string {
  const W = 1000, H = 300, L = 34, R = 8, T = 10, B = 26;
  const h = hz.elev_deg;
  let hMin = Infinity, hMax = -Infinity, tMax = -Infinity;
  for (const v of h) { hMin = Math.min(hMin, v); hMax = Math.max(hMax, v); }
  for (const t of tracks) for (let k = 0; k <= t.scan.n; k += 6) tMax = Math.max(tMax, t.scan.sunEl[k], t.scan.earthEl[k]);
  const lo = Math.max(-8, Math.floor(Math.min(hMin, 0) - 1.5));
  const hi = Math.min(Math.max(hMax + 3, Math.min(tMax + 2, 24), 6), 30);
  const x = (az: number) => L + (az / 360) * (W - L - R);
  const y = (el: number) => T + ((hi - el) / (hi - lo)) * (H - T - B);
  let body = `<clipPath id="pc"><rect x="${L}" y="${T}" width="${W - L - R}" height="${H - T - B}"/></clipPath><rect x="${L}" y="${T}" width="${W - L - R}" height="${H - T - B}" fill="#0b0f14" stroke="#3a4656"/>`;
  const stepEl = hi - lo > 16 ? 5 : 2;
  for (let e = Math.ceil(lo / stepEl) * stepEl; e <= hi; e += stepEl) {
    body += `<line x1="${L}" x2="${W - R}" y1="${y(e)}" y2="${y(e)}" stroke="${e === 0 ? '#ffffff66' : '#ffffff1c'}"/><text x="${L - 5}" y="${y(e) + 4}" text-anchor="end" class="muted">${e}°</text>`;
  }
  ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW', 'N'].forEach((c, i) => {
    body += `<text x="${x(i * 45)}" y="${H - 8}" text-anchor="middle" class="muted">${c} ${i * 45 % 360}°</text>`;
  });
  let pts = `${x(0)},${y(lo)}`;
  for (let i = 0; i <= 720; i++) pts += ` ${x(i * 0.5).toFixed(1)},${y(Math.max(lo, h[i % 720])).toFixed(1)}`;
  pts += ` ${x(360)},${y(lo)}`;
  body += `<polygon points="${pts}" fill="#6b7686" stroke="#cfd6df" stroke-width="1" clip-path="url(#pc)"/>`;
  const line = (az: Float32Array, el: Float32Array, n: number, colour: string, dashed: boolean, width: number) => {
    let d = '', prev = NaN;
    for (let k = 0; k <= n; k += 3) {
      const cmd = Number.isNaN(prev) || Math.abs(az[k] - prev) > 180 ? 'M' : 'L';
      d += `${cmd}${x(az[k]).toFixed(1)} ${y(el[k]).toFixed(1)}`;
      prev = az[k];
    }
    return `<path d="${d}" fill="none" stroke="${colour}" stroke-width="${width}" ${dashed ? 'stroke-dasharray="7 5"' : ''} clip-path="url(#pc)"/>`;
  };
  for (const t of tracks) {
    body += line(t.scan.sunAz, t.scan.sunEl, t.scan.n, SUN, t.dashed, 2.4);
    body += line(t.scan.earthAz, t.scan.earthEl, t.scan.n, EARTH, t.dashed, 2.4);
  }
  for (const m of markers) {
    body += `<line x1="${x(m.az)}" x2="${x(m.az)}" y1="${T}" y2="${H - B}" stroke="#f0e442" stroke-dasharray="2 3"/><text x="${x(m.az) + 4}" y="${T + 12}" fill="#f0e442">${esc(m.label)}</text>`;
  }
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(title)}"><title>${esc(title)}</title>${body}</svg>`;
}
