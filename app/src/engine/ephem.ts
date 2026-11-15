// AI-ASSISTED: drafted with Claude (Anthropic), reviewed by the human team.
// Ephemeris loader and sampler. Implements docs/engine-spec.md section 2.
import type { EphemHeader } from '@contracts/types';
import { EPHEM } from '@contracts/types';

export interface EphemSample {
  sun: [number, number, number]; // unit vector, Moon centre -> Sun, MOON_ME
  sunAu: number;
  earth: [number, number, number]; // km, Moon centre -> Earth (NOT topocentric)
}

export function parseUtc(s: string): number {
  const ms = Date.parse(s);
  if (Number.isNaN(ms)) throw new Error(`bad UTC time: ${s}`);
  return ms / 1000;
}

/** POSIX seconds -> 'YYYY-MM-DDTHH:MM:SSZ', rounded to the nearest whole second (half up). */
export function fmtUtc(t: number): string {
  return new Date(Math.floor(t + 0.5) * 1000).toISOString().replace('.000Z', 'Z');
}

export class Ephem {
  readonly t0: number;
  readonly tLast: number;
  readonly stepS: number;
  readonly n: number;
  private readonly rows: Float32Array;

  constructor(readonly header: EphemHeader, buf: ArrayBuffer) {
    if (header.dtype !== 'float32' || header.endianness !== 'little' || header.record_bytes !== 28) {
      throw new Error('unsupported ephemeris layout');
    }
    if (buf.byteLength !== header.n * 28) throw new Error('ephem.bin size does not match header.n');
    // Explicit little-endian read so the result does not depend on the host byte order.
    const dv = new DataView(buf);
    this.rows = new Float32Array(header.n * EPHEM.STRIDE);
    for (let i = 0; i < this.rows.length; i++) this.rows[i] = dv.getFloat32(i * 4, true);
    this.n = header.n;
    this.stepS = header.step_s;
    this.t0 = parseUtc(header.t0_utc);
    this.tLast = this.t0 + (this.n - 1) * this.stepS;
  }

  covers(t: number): boolean {
    return t >= this.t0 && t <= this.tLast;
  }

  /** Linear interpolation between hourly rows, then renormalise the Sun vector. No extrapolation. */
  sample(t: number): EphemSample {
    if (!this.covers(t)) throw new RangeError('time outside ephemeris coverage');
    const f = (t - this.t0) / this.stepS;
    const i = Math.min(Math.floor(f), this.n - 2);
    const w = f - i;
    const a = i * EPHEM.STRIDE;
    const b = a + EPHEM.STRIDE;
    const r = this.rows;
    const x = (c: number) => (1 - w) * r[a + c] + w * r[b + c];
    const sx = x(0), sy = x(1), sz = x(2);
    const m = Math.hypot(sx, sy, sz);
    return { sun: [sx / m, sy / m, sz / m], sunAu: x(3), earth: [x(4), x(5), x(6)] };
  }
}
