// AI-ASSISTED: drafted with Claude (Anthropic), reviewed by the human team.
// Round 3 brief markup: verdict strip, ranked option bars, validation badges, small icons.
// Presentation only: every number comes from the engine results passed in.
import type { CauseLine, HorizonFile, Site } from '@contracts/types';
import { parseUtc } from '../engine/ephem';
import { causeName, compass } from '../engine/causes';
import { bodyChanges, slipWords, type SlipOptionEx } from '../engine/slip';
import { hasBand } from '../engine/metrics';
import { deltaRange, withBand } from './format';

const esc = (s: unknown) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const h1 = (v: number) => v.toFixed(1);
const signed = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : '±'}${Math.abs(v).toFixed(1)}`;
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const shortDate = (iso: string) => `${Number(iso.slice(8, 10))} ${MON[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;
const dayTime = (iso: string) => `${iso.slice(0, 10)} ${iso.slice(11, 16)}`;
const DAY = 86400;

/** 16 px icons. Orbit: a body on a ring. Terrain: a ridge with an arrow turned to the blocking azimuth. Site: a pin. */
export function icon(kind: 'orbital' | 'terrain' | 'dip' | 'location', azDeg?: number | null): string {
  if (kind === 'terrain') {
    const arrow = azDeg == null ? '' : `<g transform="rotate(${azDeg.toFixed(0)} 8 8)"><path d="M8 13V3M5 6l3-3 3 3" fill="none" stroke="currentColor" stroke-width="1.5"/></g>`;
    return `<svg class="ic ic-terrain" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">${arrow || '<path d="M1 13l4-7 3 4 2-3 5 6z" fill="currentColor"/>'}</svg>`;
  }
  if (kind === 'location') return '<svg class="ic" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M8 15s5-5.2 5-9A5 5 0 0 0 3 6c0 3.8 5 9 5 9z" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="8" cy="6" r="1.6" fill="currentColor"/></svg>';
  return '<svg class="ic" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><ellipse cx="8" cy="8" rx="6.5" ry="3.5" fill="none" stroke="currentColor" stroke-width="1.3" transform="rotate(-20 8 8)"/><circle cx="8" cy="8" r="2" fill="currentColor"/><circle cx="13.6" cy="5.4" r="1.5" fill="currentColor"/></svg>';
}

/** Two- or three-word name of a cause for labels: "lunar night", "Earth below horizon", "terrain W 264°". */
export function causeToken(c: CauseLine, alternate = false): { kind: 'orbital' | 'terrain' | 'location'; text: string } {
  if (c.kind === 'terrain') return { kind: 'terrain', text: c.az_deg == null ? 'terrain' : `terrain ${compass(c.az_deg)} ${c.az_deg.toFixed(0)}°` };
  if (alternate) return { kind: 'location', text: 'other location' };
  const lost = c.delta_h < 0;
  return { kind: 'orbital', text: c.body === 'sun' ? (lost ? 'lunar night' : 'lunar day') : (lost ? 'Earth sets (libration)' : 'Earth rises (libration)') };
}

export interface VerdictInput { opts: SlipOptionEx[]; site: Site; stay: number; slip: number; illustrative: boolean }

/** 01 Verdict strip: the answer as three or four large numbers. */
export function verdict(v: VerdictInput): string {
  const base = v.opts[0], slip = v.opts.find((o) => o.kind === 'slip'), rec = v.opts.find((o) => o.kind === 'recover');
  const cell = (label: string, big: string, small = '', cls = '') => `<div class="vd ${cls}"><div class="vd-k">${label}</div><div class="vd-n">${big}</div>${small ? `<div class="vd-s">${small}</div>` : ''}</div>`;
  const tag = v.illustrative ? '<span class="tagx">illustrative date</span>' : '';
  if (!slip) {
    return `<div class="verdict" role="group" aria-label="Result">${cell('Sun + Earth in view', `${h1(base.metrics.both_visible_h)}<small> h</small>`, `of a ${v.stay}-day stay`)}</div>
      <p class="vd-line">No slip set. Step the slip to see what changes. ${tag}</p>`;
  }
  const d = slip.metrics.both_visible_h - base.metrics.both_visible_h;
  const band = deltaRange(slip.metrics, base.metrics, 'both_visible_h');
  const changes = bodyChanges(base, slip);
  const top = changes[0]?.cause ?? slip.causes[0] ?? null;
  const tok = top ? causeToken(top) : null;
  const cells = [
    cell('Sun + Earth in view', `${h1(base.metrics.both_visible_h)}<span class="arrow" aria-hidden="true"> → </span><span class="sr-only"> to </span>${h1(slip.metrics.both_visible_h)}<small> h</small>`, `${v.stay}-day stay, ${slipWords(v.slip)}`),
    cell('Change', `${signed(d)}<small> h</small>`, band ? esc(withBand('', band, true).trim()) + ' with terrain error' : '', Math.abs(d) < 0.05 ? '' : d < 0 ? 'neg' : 'pos'),
    tok ? cell('Main cause', `${icon(tok.kind, top!.az_deg)}<span class="vd-word">${esc(tok.text)}</span>`, `${tok.kind === 'terrain' ? 'terrain' : 'orbit, not terrain'} · ${signed(top!.delta_h)} h`, 'cause') : '',
  ];
  let line = '';
  if (rec) {
    const days = Math.round((parseUtc(rec.start_utc) - parseUtc(base.start_utc)) / DAY);
    const exact = rec.label.startsWith('Next');
    cells.push(cell(exact ? 'Next equally good date' : 'Best date within 60 d', `+${days}<small> d</small>`, shortDate(rec.start_utc), 'next'));
    if (exact && v.slip > 0) line = `A ${slipWords(v.slip)} becomes a ${days}-day wait.`;
  }
  return `<div class="verdict" role="group" aria-label="Result">${cells.join('')}</div><p class="vd-line">${line} ${tag}</p>`;
}

/** The full sentences behind the verdict, for the Context disclosure. */
export function verdictContext(opts: SlipOptionEx[]): string {
  const base = opts[0], slip = opts.find((o) => o.kind === 'slip');
  if (!slip) return '';
  const why = bodyChanges(base, slip).map((x) => `${x.body === 'sun' ? 'Sun' : 'Earth'} in view ${h1(x.before_h)} h → ${h1(x.after_h)} h (${signed(x.delta_h)} h)`
    + (!x.cause ? '' : x.causeFits ? `; main cause: ${esc(causeName(x.cause))} (${signed(x.cause.delta_h)} h)` : `; main cause: ${esc(causeName(x.cause))}, partly offset by other changes`));
  const terr = slip.causes.filter((c) => c.kind === 'terrain').slice(0, 2).map((c) => esc(c.text));
  const said = why.join(' ') + slip.causes.map((c) => c.text).join(' ');
  return [
    why.length ? `<p><strong>Why:</strong> ${why.join('. ')}.</p>` : '',
    `<p><strong>Terrain:</strong> ${terr.length ? terr.join('. ') + '.' : 'no terrain change of half an hour or more.'}</p>`,
    /libration/.test(said) ? '<p><strong>Libration</strong>: the Moon rocks slightly as it orbits, so Earth drifts up and down in the lunar sky; near the poles that takes Earth below the horizon for days each month.</p>' : '',
    /net of site height/.test(said) ? '<p><strong>Net of site height</strong>: a site that stands above its surroundings sees a little below a flat horizon; those extra hours are already included in the figure.</p>' : '',
  ].join('');
}

/** 04 Options as ranked horizontal bars. Bar length = Sun + Earth hours; the tick is the baseline. */
export function optionBars(opts: SlipOptionEx[], horizons: Map<string, HorizonFile>, stay: number): string {
  const base = opts[0].metrics;
  const max = stay * 24;
  const pct = (h: number) => `${Math.max(0, Math.min(100, (100 * h) / max)).toFixed(2)}%`;
  const B = opts.every((o) => hasBand(horizons.get(o.site_id)!));
  const rows = opts.map((o, i) => {
    const m = o.metrics, isBase = o.kind === 'baseline';
    const d = m.both_visible_h - base.both_visible_h;
    const dc = isBase || Math.abs(d) < 0.05 ? '' : d < 0 ? 'neg' : 'pos';
    const icons = o.causes.slice(0, 3).map((c) => {
      const t = causeToken(c, o.kind === 'alternate');
      return `<span class="ci ${c.delta_h < 0 ? 'neg' : 'pos'}" title="${esc(c.text)}">${icon(t.kind, c.az_deg)}<span class="ci-t">${c.body === 'sun' ? 'Sun' : 'Earth'} ${signed(c.delta_h)}</span></span>`;
    }).join('');
    const name = o.kind === 'recover' ? (o.label.startsWith('Next') ? 'Next equally good date' : 'Best date within 60 d') : o.label;
    const why = isBase ? '' : `<div class="ob-why" id="ob-why-${i}" hidden>${o.note ? `<p class="fine">${esc(o.note)}</p>` : ''}
        ${o.causes.length ? `<ul class="cause">${o.causes.map((c) => `<li class="${c.delta_h < 0 ? 'lost' : 'gained'}">${esc(c.text)}</li>`).join('')}</ul>` : '<p class="fine">No change of half an hour or more in Sun or Earth visibility.</p>'}</div>`;
    return `<li class="ob r-${o.kind}">
      <div class="ob-name"><span class="ob-rank">${isBase ? '—' : i}</span><strong>${esc(name)}</strong><span class="ob-date num">${dayTime(o.start_utc)}</span></div>
      <div class="ob-bar" role="img" aria-label="Sun and Earth both in view ${h1(m.both_visible_h)} of ${max} hours"><i style="width:${pct(m.both_visible_h)}"></i><b style="left:${pct(base.both_visible_h)}" title="baseline"></b></div>
      <div class="ob-h num"><strong>${h1(m.both_visible_h)}</strong><small> h</small></div>
      <div class="ob-d num ${dc}">${isBase ? 'baseline' : esc(withBand(signed(d), B ? deltaRange(m, base, 'both_visible_h') : null, true))}</div>
      <div class="ob-ic">${icons}</div>
      ${isBase ? '<span></span>' : `<button type="button" class="ob-x" aria-expanded="false" aria-controls="ob-why-${i}" data-why="${i}"><span class="sr-only">Causes for ${esc(name)}</span><span aria-hidden="true">why</span></button>`}
      ${why}
      <dl class="sr-only"><dt>Sunlit hours</dt><dd>${h1(m.sunlit_h)}</dd><dt>Earth in view</dt><dd>${m.earth_visible_pct.toFixed(0)}%</dd><dt>Longest dark gap, hours</dt><dd>${h1(m.longest_dark_gap_h)}</dd></dl>
    </li>`;
  }).join('');
  return `<ol class="obars" aria-label="Options ranked by hours with both Sun and Earth in view">${rows}</ol>
    <div class="ob-axis" aria-hidden="true"><span>0</span><span>${max / 2}</span><span>${max} h</span></div>`;
}

export interface BadgeInput {
  res: { n: number; az: number; el: number; sites: number } | null;
  bench: { pct: number; published: string; name: string } | null;
  hz: HorizonFile;
}

/** 08 Validation badges. */
export function badges(b: BadgeInput): string {
  const sphere = b.hz.dem.product === 'sphere';
  const out = [
    b.res ? `<div class="bdg ok"><span class="bdg-k">Horizons checks</span><span class="bdg-v num">${b.res.n} ✓</span><span class="bdg-s num">max ${Math.max(b.res.az, b.res.el).toFixed(4)}°</span></div>`
      : '<div class="bdg warn"><span class="bdg-k">Horizons checks</span><span class="bdg-v">none loaded</span></div>',
    b.bench ? `<div class="bdg"><span class="bdg-k">${esc(b.bench.name)} sunlit</span><span class="bdg-v num">${b.bench.pct.toFixed(1)}%</span><span class="bdg-s num">${esc(b.bench.published)} published</span></div>` : '',
    sphere ? '<div class="bdg warn"><span class="bdg-k">Terrain</span><span class="bdg-v">no terrain model</span><span class="bdg-s">smooth-sphere horizon</span></div>'
      : `<div class="bdg"><span class="bdg-k">Terrain</span><span class="bdg-v">LOLA${b.hz.dem.res_m ? ` ${b.hz.dem.res_m} m` : ''}</span><span class="bdg-s">${b.hz.dem.max_range_km ? `to ${b.hz.dem.max_range_km} km` : ''}</span></div>`,
  ];
  return `<div class="badges">${out.join('')}</div>`;
}
