// AI-ASSISTED: drafted with Claude (Anthropic), reviewed by the human team.
// Site-by-landing-date map: hours with both Sun and Earth in view for one stay, for every terrain site and
// a year of landing dates. Answers "compare sites and dates" in one picture. Coarser than the brief
// (30-minute samples) so it stays fast; the brief's own table remains the 10-minute reference.
import type { HorizonFile, Site } from '@contracts/types';
import { Ephem, fmtUtc } from '../engine/ephem';
import { siteFrame } from '../engine/geometry';
import { scanWindow } from '../engine/metrics';
import type { Mode } from '../engine/visibility';

export const HEAT_STEP_S = 1800;
const DAY = 86400;

export interface HeatGrid {
  stayDays: number; stepDays: number; dates: number[]; // landing times, unix seconds
  rows: { site: Site; both_h: number[]; best: number }[]; // best = index of the first maximum
  max_h: number;
}

export function siteDateGrid(ephem: Ephem, sites: Site[], horizons: Map<string, HorizonFile>, tStart: number,
  spanDays: number, stepDays: number, stayDays: number, mode: Mode): HeatGrid {
  const dates: number[] = [];
  for (let t = tStart; t <= tStart + spanDays * DAY && t + stayDays * DAY <= ephem.tLast; t += stepDays * DAY) dates.push(t);
  const rows = sites.map((site) => {
    const hz = horizons.get(site.id)!, f = siteFrame(site);
    const both_h = dates.map((t) => {
      const s = scanWindow(ephem, f, hz.elev_deg, t, t + stayDays * DAY, mode, HEAT_STEP_S);
      let n = 0;
      for (let k = 0; k < s.n; k++) n += s.sunVis[k] & s.earthVis[k];
      return (n * HEAT_STEP_S) / 3600;
    });
    return { site, both_h, best: both_h.indexOf(Math.max(...both_h)) };
  });
  return { stayDays, stepDays, dates, rows, max_h: stayDays * 24 };
}

// One hue, dark to light: on the dark page a lighter cell means more hours.
const LO = [18, 38, 58], HI = [159, 211, 255];
export function heatColor(frac: number): string {
  const x = Math.max(0, Math.min(1, frac));
  return `rgb(${LO.map((c, i) => Math.round(c + (HI[i] - c) * x)).join(',')})`;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

export function heatmapSvg(g: HeatGrid, selectedId: string): string {
  const L = 250, T = 20, cw = Math.max(3, Math.floor(700 / Math.max(1, g.dates.length))), ch = 24, gap = 2;
  const W = L + g.dates.length * cw + 10, H = T + g.rows.length * (ch + gap) + 28;
  let out = `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Hours with both Sun and Earth in view for a ${g.stayDays}-day stay, by site and landing date. The same numbers are in the table below.">`;
  let lastMonth = '', lastX = -100;
  g.dates.forEach((t, j) => { // month ticks; January shows the year; a tick too close to the last one is skipped
    const m = fmtUtc(t).slice(0, 7), x = L + j * cw;
    if (m === lastMonth) return;
    lastMonth = m;
    if (x - lastX < 34) return;
    lastX = x;
    out += `<text x="${x}" y="12" fill="#a9b4c2" font-size="10">${j === 0 ? m : m.slice(5) === '01' ? m.slice(0, 4) : m.slice(5)}</text>`;
  });
  g.rows.forEach((r, i) => {
    const y = T + i * (ch + gap), sel = r.site.id === selectedId;
    out += `<text x="${L - 8}" y="${y + ch / 2 + 4}" text-anchor="end" fill="${sel ? '#e8edf3' : '#a9b4c2'}" font-size="12" font-weight="${sel ? 700 : 400}">${esc(r.site.name.length > 36 ? r.site.name.slice(0, 35) + '…' : r.site.name)}</text>`;
    r.both_h.forEach((h, j) => {
      out += `<rect x="${L + j * cw}" y="${y}" width="${cw}" height="${ch}" fill="${heatColor(h / g.max_h)}"><title>${esc(r.site.name)}, landing ${fmtUtc(g.dates[j]).slice(0, 10)}: ${h.toFixed(1)} h of ${g.max_h} h with Sun and Earth</title></rect>`;
    });
    out += `<circle cx="${L + r.best * cw + cw / 2}" cy="${y + ch / 2}" r="3" fill="#10141a" stroke="#e8edf3" stroke-width="1.5"><title>Best date for ${esc(r.site.name)}: ${fmtUtc(g.dates[r.best]).slice(0, 10)}, ${r.both_h[r.best].toFixed(1)} h</title></circle>`;
  });
  const ly = H - 14; // legend: ramp with its two ends labelled
  for (let k = 0; k < 40; k++) out += `<rect x="${L + k * 4}" y="${ly}" width="4" height="8" fill="${heatColor(k / 39)}"/>`;
  out += `<text x="${L - 6}" y="${ly + 8}" text-anchor="end" fill="#a9b4c2" font-size="10">0 h</text><text x="${L + 166}" y="${ly + 8}" fill="#a9b4c2" font-size="10">${g.max_h} h (whole stay)</text>`;
  out += `<circle cx="${L + 300}" cy="${ly + 4}" r="3" fill="#10141a" stroke="#e8edf3" stroke-width="1.5"/><text x="${L + 308}" y="${ly + 8}" fill="#a9b4c2" font-size="10">best date for the site</text>`;
  return out + '</svg>';
}

export function heatmapTable(g: HeatGrid): string {
  const every = Math.max(1, Math.round(14 / g.stepDays)); // one column per two weeks keeps the table readable
  const cols = g.dates.map((_, j) => j).filter((j) => j % every === 0);
  return `<table><thead><tr><th scope="col" style="text-align:left">Site</th><th scope="col">Best date</th><th scope="col">Best (h)</th>${cols.map((j) => `<th scope="col">${fmtUtc(g.dates[j]).slice(2, 10)}</th>`).join('')}</tr></thead><tbody>${
    g.rows.map((r) => `<tr><th scope="row" style="text-align:left">${esc(r.site.name)}</th><td>${fmtUtc(g.dates[r.best]).slice(0, 10)}</td><td>${r.both_h[r.best].toFixed(1)}</td>${cols.map((j) => `<td>${r.both_h[j].toFixed(0)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
}
