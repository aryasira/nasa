// AI-assisted; see README.
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

export function timelineSvg(scan: Scan, windows: TimelineWindow[], title: string, desc = '', W = 1000): string {
  const narrow = W < 560;
  const L = narrow ? 44 : 84, R = 10, top = 18, rowH = narrow ? 16 : 20, gap = 5;
  const span = scan.tEnd - scan.tStart;
  const x = (t: number) => L + ((t - scan.tStart) / span) * (W - L - R);
  const xk = (k: number) => x(scan.tStart + k * STEP_S);
  const rows: [string, string, (k: number) => boolean][] = [
    ['Sun', SUN, (k) => !!scan.sunVis[k]],
    ['Earth', 'url(#p-earth)', (k) => !!scan.earthVis[k]],
    [narrow ? 'Both' : 'Sun + Earth', 'url(#p-both)', (k) => !!(scan.sunVis[k] & scan.earthVis[k])],
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
  y += 6;
  // Stays as brackets with their name and start date written on them.
  for (const w of windows) {
    const x0 = x(Math.max(w.tStart, scan.tStart)), x1 = x(Math.min(w.tEnd, scan.tEnd));
    const c = w.emphasis ? '#f0e442' : '#b9c2cd';
    const label = `${w.label} ${day(w.tStart)}`;
    const len = label.length * 6.2;
    const inside = x1 - x0 > len + 10, right = x1 + 5 + len <= W;
    body += `<path d="M${x0.toFixed(1)} ${y + 2}v10H${x1.toFixed(1)}v-10" fill="none" stroke="${c}" stroke-width="${w.emphasis ? 2 : 1.4}"/>`
      + `<text x="${(inside ? x0 + 5 : right ? x1 + 5 : x0 - 5).toFixed(1)}" y="${y + 9}" text-anchor="${inside || right ? 'start' : 'end'}" style="fill:${c}">${esc(label)}</text>`;
    y += 18;
  }
  const stepDays = Math.max(1, Math.ceil(span / 86400 / (narrow ? 5 : 12)));
  const first = Math.ceil(scan.tStart / 86400) * 86400;
  for (let t = first; t <= scan.tEnd; t += stepDays * 86400) {
    body += `<line x1="${x(t).toFixed(1)}" x2="${x(t).toFixed(1)}" y1="${top}" y2="${y}" stroke="#ffffff22"/><text x="${x(t).toFixed(1)}" y="${y + 12}" text-anchor="middle" class="muted">${day(t)}</text>`;
  }
  const H = y + 18;
  return `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(title)}"><title>${esc(title)}</title><desc>${esc(desc)}</desc>${DEFS}${body}</svg>`;
}

export interface Track { label: string; scan: Scan; dashed: boolean }
export interface Marker { az: number; label: string; sub?: string }

export function panoramaSvg(hz: HorizonFile, tracks: Track[], markers: Marker[], title: string, desc = '', band = false, W = 1000): string {
  const narrow = W < 560;
  const H = narrow ? 230 : 340, L = 34, R = 8, T = 26, B = 26;
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
    body += `<line x1="${x(i * 45)}" x2="${x(i * 45)}" y1="${H - B}" y2="${H - B + (i % 2 ? 3 : 6)}" stroke="#8894a3"/>`;
    if (narrow && i % 2) return;
    body += `<text x="${x(i * 45)}" y="${H - 8}" text-anchor="${i === 0 ? 'start' : i === 8 ? 'end' : 'middle'}" class="muted">${c}${narrow ? '' : ` ${i * 45 % 360}°`}</text>`;
  });
  for (let a = 15; a < 360; a += 15) if (a % 45) body += `<line x1="${x(a)}" x2="${x(a)}" y1="${H - B}" y2="${H - B + 2}" stroke="#5d6875"/>`;
  // North arrow and the vertical stretch of the plot (degrees of elevation are drawn taller than degrees of azimuth).
  const stretch = ((H - T - B) / (hi - lo)) / ((W - L - R) / 360);
  body += `<g transform="translate(${L + 8} ${T - 8})"><path d="M0 4V-10M-4 -5l4-5 4 5" fill="none" stroke="#e8edf3" stroke-width="1.6"/><text x="8" y="2">N</text></g>`
    + `<text x="${W - R}" y="${T - 8}" text-anchor="end" class="muted">elevation ×${stretch.toFixed(0)} stretched</text>`;
  let pts = `${x(0)},${y(lo)}`;
  for (let i = 0; i <= 720; i++) pts += ` ${x(i * 0.5).toFixed(1)},${y(Math.max(lo, h[i % 720])).toFixed(1)}`;
  pts += ` ${x(360)},${y(lo)}`;
  body += `<defs><linearGradient id="pg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8b96a6"/><stop offset="1" stop-color="#3b4350"/></linearGradient></defs><polygon points="${pts}" fill="url(#pg)" stroke="#e8edf3" stroke-width="1.4" clip-path="url(#pc)"/>`;
  if (band) { // terrain raised / lowered by one sigma
    let up = '', down = '';
    for (let i = 0; i <= 720; i++) {
      up += ` ${x(i * 0.5).toFixed(1)},${y(Math.max(lo, hz.elev_hi_deg[i % 720])).toFixed(1)}`;
      down = ` ${x(i * 0.5).toFixed(1)},${y(Math.max(lo, hz.elev_lo_deg[i % 720])).toFixed(1)}` + down;
    }
    body += `<polygon points="${up}${down}" fill="#f0e442" fill-opacity="0.35" stroke="#f0e442" stroke-opacity="0.6" stroke-width="0.5" clip-path="url(#pc)"/>`;
  }
  const line = (az: Float32Array, el: Float32Array, n: number, colour: string, dashed: boolean, width: number) => {
    let d = '', prev = NaN;
    for (let k = 0; k <= n; k += 3) {
      const cmd = Number.isNaN(prev) || Math.abs(az[k] - prev) > 180 ? 'M' : 'L';
      d += `${cmd}${x(az[k]).toFixed(1)} ${y(el[k]).toFixed(1)}`;
      prev = az[k];
    }
    return `<path d="${d}" fill="none" stroke="${colour}" stroke-width="${width}" ${dashed ? 'stroke-dasharray="7 5"' : ''} clip-path="url(#pc)"/>`;
  };
  // Direct label where a path is highest inside the plot (first track only, to keep the plot quiet).
  const tag = (az: Float32Array, el: Float32Array, n: number, word: string, colour: string) => {
    let best = -1, bestEl = -Infinity;
    for (let k = 0; k <= n; k += 3) if (el[k] < hi - 0.3 && el[k] > lo && el[k] > bestEl) { bestEl = el[k]; best = k; }
    if (best < 0) return '';
    const tx = x(az[best]), end = tx > W - 60;
    return `<text x="${(tx + (end ? -6 : 6)).toFixed(1)}" y="${(y(bestEl) - 6).toFixed(1)}" text-anchor="${end ? 'end' : 'start'}" style="fill:${colour};font-weight:600">${word}</text>`;
  };
  for (const t of tracks) {
    body += line(t.scan.sunAz, t.scan.sunEl, t.scan.n, SUN, t.dashed, 2.4);
    body += line(t.scan.earthAz, t.scan.earthEl, t.scan.n, EARTH, t.dashed, 2.4);
  }
  if (tracks[0]) body += tag(tracks[0].scan.sunAz, tracks[0].scan.sunEl, tracks[0].scan.n, 'Sun', SUN) + tag(tracks[0].scan.earthAz, tracks[0].scan.earthEl, tracks[0].scan.n, 'Earth', EARTH);
  // Key for line styles, on the top margin.
  if (tracks.length > 1 && !narrow) {
    const kx = L + 44, ky = T - 9;
    body += `<line x1="${kx}" x2="${kx + 22}" y1="${ky}" y2="${ky}" stroke="#e8edf3" stroke-width="2"/><text x="${kx + 27}" y="${ky + 4}" class="muted">planned</text>`
      + `<line x1="${kx + 84}" x2="${kx + 106}" y1="${ky}" y2="${ky}" stroke="#e8edf3" stroke-width="2" stroke-dasharray="6 4"/><text x="${kx + 111}" y="${ky + 4}" class="muted">slipped</text>`;
  }
  // Blocking terrain, labelled on the plot with a leader line from the skyline.
  markers.forEach((m, i) => {
    const mx = x(m.az), my = y(Math.max(lo, h[Math.round(m.az * 2) % 720]));
    const ly = T + 14 + i * 28, end = mx > W - 190;
    body += `<path d="M${mx.toFixed(1)} ${my.toFixed(1)}V${ly + 4}" stroke="#f0e442" stroke-width="1" fill="none"/><circle cx="${mx.toFixed(1)}" cy="${my.toFixed(1)}" r="3" fill="#f0e442"/>`
      + `<text x="${(mx + (end ? -6 : 6)).toFixed(1)}" y="${ly}" text-anchor="${end ? 'end' : 'start'}" style="fill:#f0e442;font-weight:600">${esc(m.label)}</text>`
      + (m.sub ? `<text x="${(mx + (end ? -6 : 6)).toFixed(1)}" y="${ly + 12}" text-anchor="${end ? 'end' : 'start'}" class="muted">${esc(m.sub)}</text>` : '');
  });
  return `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(title)}"><title>${esc(title)}</title><desc>${esc(desc)}</desc>${body}</svg>`;
}

/** Text alternative to the timeline: every interval when the Sun, Earth or both are in view. */
export function timelineTable(scan: Scan): string {
  const stamp = (k: number) => new Date((scan.tStart + k * STEP_S) * 1000).toISOString().slice(0, 16).replace('T', ' ');
  const rows: string[] = [];
  const add = (name: string, fn: (k: number) => boolean) => {
    for (const [a, b] of runs(fn, scan.n)) {
      rows.push(`<tr><td>${name}</td><td class="num">${stamp(a)}${a === 0 ? ' or earlier' : ''}</td><td class="num">${stamp(b)}${b === scan.n ? ' or later' : ''}</td><td class="num">${(((b - a) * STEP_S) / 3600).toFixed(1)}</td></tr>`);
    }
  };
  add('Sun', (k) => !!scan.sunVis[k]);
  add('Earth', (k) => !!scan.earthVis[k]);
  add('Sun + Earth', (k) => !!(scan.sunVis[k] & scan.earthVis[k]));
  return `<table><caption class="note">Intervals in view (UTC) over the span shown in the chart</caption><thead><tr><th scope="col">In view</th><th scope="col">From</th><th scope="col">To</th><th scope="col">Hours</th></tr></thead><tbody>${rows.join('') || '<tr><td colspan="4">Nothing in view in this span.</td></tr>'}</tbody></table>`;
}
