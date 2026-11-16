// AI-assisted; see README.
// Download the options table as CSV or JSON, so the numbers can be reused outside the page.
import type { SlipOptionEx } from '../engine/slip';

export interface ExportScenario {
  site_id: string; site_name: string; baseline_utc: string; stay_days: number; slip_days: number;
  visible_rule: string; earth_link_margin_deg: number; page_url: string;
}
export interface ExportRow {
  option: string; kind: string; site_id: string; landing_utc: string; end_utc: string;
  sunlit_h: number; earth_in_view_pct: number; sun_and_earth_h: number; longest_dark_gap_h: number;
  eclipse_h: number; change_vs_baseline_h: number; causes: string[];
}

const r1 = (x: number) => Math.round(x * 10) / 10;

export function exportRows(opts: SlipOptionEx[]): ExportRow[] {
  const base = opts.find((o) => o.kind === 'baseline') ?? opts[0];
  return opts.map((o) => ({
    option: o.label, kind: o.kind, site_id: o.site_id, landing_utc: o.metrics.start_utc, end_utc: o.metrics.end_utc,
    sunlit_h: r1(o.metrics.sunlit_h), earth_in_view_pct: r1(o.metrics.earth_visible_pct),
    sun_and_earth_h: r1(o.metrics.both_visible_h), longest_dark_gap_h: r1(o.metrics.longest_dark_gap_h),
    eclipse_h: r1(o.metrics.eclipse_h), change_vs_baseline_h: r1(o.metrics.both_visible_h - base.metrics.both_visible_h),
    causes: o.causes.map((c) => c.text),
  }));
}

const cell = (v: unknown) => {
  const s = Array.isArray(v) ? v.join(' | ') : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function toCsv(sc: ExportScenario, rows: ExportRow[]): string {
  const head = Object.keys(rows[0] ?? {}) as (keyof ExportRow)[];
  const meta = Object.entries(sc).map(([k, v]) => `# ${k}: ${v}`);
  return [...meta, '# ai_generated: true (Slip Impact Brief, built with AI assistance, reviewed by the human team)',
    head.join(','), ...rows.map((r) => head.map((k) => cell(r[k])).join(','))].join('\n') + '\n';
}

export function toJson(sc: ExportScenario, rows: ExportRow[]): string {
  return JSON.stringify({ meta: { ai_generated: true, generated_by: 'Slip Impact Brief (browser export)' }, scenario: sc, options: rows }, null, 2) + '\n';
}

export function download(name: string, text: string, type: string): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
