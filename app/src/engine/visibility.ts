// AI-ASSISTED: drafted with Claude (Anthropic), reviewed by the human team.
// Horizon lookup and disc-fraction visibility. Implements docs/engine-spec.md section 4.
export const N_AZ = 720;
export const AZ_STEP_DEG = 0.5;
export type Mode = 'limb' | 'centre';

/** Horizon elevation at an azimuth: linear interpolation of the 720-point profile, wrapping at 360. */
export function horizonAt(h: ArrayLike<number>, azDeg: number): number {
  const x = azDeg / AZ_STEP_DEG;
  const fl = Math.floor(x);
  const w = x - fl;
  const i0 = ((fl % N_AZ) + N_AZ) % N_AZ;
  const i1 = (i0 + 1) % N_AZ;
  return (1 - w) * h[i0] + w * h[i1];
}

/** Fraction of the disc above the horizon, linear in elevation, at the body-centre azimuth. */
export function discFraction(elDeg: number, rDeg: number, hDeg: number): number {
  return Math.max(0, Math.min(1, (elDeg + rDeg - hDeg) / (2 * rDeg)));
}

/**
 * Link margin: Earth counts as in view only when it clears the skyline by this many degrees.
 * 0 (the default) is pure line of sight. One setting for the whole app, so the brief, the
 * countdowns and the simulator always agree.
 */
let linkMarginDeg = 0;
export function setLinkMargin(deg: number): void { linkMarginDeg = Number.isFinite(deg) ? Math.max(0, deg) : 0; }
export function linkMargin(): number { return linkMarginDeg; }

export function isVisible(frac: number, mode: Mode): boolean {
  return mode === 'limb' ? frac > 0 : frac >= 0.5;
}

/** Index of the horizon sample nearest to an azimuth. */
export function azIndex(azDeg: number): number {
  return ((Math.round(azDeg / AZ_STEP_DEG) % N_AZ) + N_AZ) % N_AZ;
}
