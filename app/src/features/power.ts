// AI-ASSISTED: drafted with Claude (Anthropic), reviewed by the human team.
// Geometry-only power factors for the Power card (pure). Not a power model: no panel efficiency, temperature,
// dust, tilt, lander attitude or eclipse dimming.
const D2R = Math.PI / 180;

export interface PowerGeometry {
  sunEl: number; // above the local horizontal plane, degrees
  clearance: number; // Sun elevation minus terrain horizon at the Sun's azimuth, degrees
  discFrac: number; // fraction of the Sun's disc above the terrain, 0..1
  tracking: number; // Sun-tracking panel: = disc fraction
  horizontal: number; // fixed horizontal panel: disc fraction × max(0, sin elevation)
}

export function powerGeometry(sunEl: number, horizonEl: number, discFrac: number): PowerGeometry {
  return {
    sunEl, clearance: sunEl - horizonEl, discFrac,
    tracking: discFrac,
    horizontal: discFrac * Math.max(0, Math.sin(sunEl * D2R)),
  };
}
