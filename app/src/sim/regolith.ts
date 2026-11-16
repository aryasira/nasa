// AI-assisted; see README.
// Material patches for an airless body.
//  * Regolith: Lommel-Seeliger reflectance (no limb darkening, so the ground stays bright toward the horizon)
//    with a phase falloff and an opposition surge; no specular; multi-scale procedural detail normals and albedo.
//  * Sun visibility: the Sun light (directional light 0, the only shadow caster) is multiplied by
//    - the engine's Sun disc fraction at the lander (exact, from observe()/discFraction), and
//    - away from the lander, a soft heightfield march toward the Sun through the drawn terrain
//      (illustrative far-terrain shadowing; penumbra = the Sun's true angular radius).
//  * No ambient light anywhere: shadows are black except for faint earthshine (directional light 1).
import * as THREE from 'three';
import { regolithDetail } from './textures';

export interface SunUniforms {
  uSunW: { value: THREE.Vector3 }; // unit vector to the Sun, scene frame
  uSunR: { value: number }; // Sun angular radius (rad)
  uSunK: { value: number }; // engine disc fraction at the lander, 0..1
  uHF: { value: THREE.Texture | null }; // polar heightfield of the drawn terrain
  uHFR0: { value: number };
  uHFLogK: { value: number };
  uHFu0: { value: number };
  uHFOn: { value: number }; // 0 disables the march (low quality)
  uEnvK: { value: number }; // reflection strength for metals (0 at night)
}

export function makeSunUniforms(): SunUniforms {
  return {
    uSunW: { value: new THREE.Vector3(0, 1, 0) }, uSunR: { value: 0.00466 }, uSunK: { value: 1 },
    uHF: { value: null }, uHFR0: { value: 4 }, uHFLogK: { value: 1 }, uHFu0: { value: 0 }, uHFOn: { value: 1 }, uEnvK: { value: 1 },
  };
}

// onBeforeCompile sees unresolved #include lines, so the light loop chunk is inlined with the Sun factor added.
const lightsBegin = (factor: string) => {
  const src = THREE.ShaderChunk.lights_fragment_begin;
  const key = 'getDirectionalLightInfo( directionalLight, directLight );';
  if (!src.includes(key)) throw new Error('three.js light chunk changed: cannot apply the Sun visibility factor');
  return src.replace(key, `${key}
		#if UNROLLED_LOOP_INDEX == 0
			directLight.color *= ${factor};
		#endif`);
};

/** Multiply the Sun light by the engine's disc fraction (lander, rocks near it, anything without the march). */
export function patchSunVis(m: THREE.Material, u: SunUniforms) {
  const prev = m.onBeforeCompile;
  m.onBeforeCompile = (s, r) => {
    prev.call(m, s, r);
    s.uniforms.uSunK = u.uSunK;
    s.uniforms.uEnvK = u.uEnvK;
    s.fragmentShader = 'uniform float uSunK;\nuniform float uEnvK;\n' + s.fragmentShader
      .replace('#include <lights_fragment_begin>', lightsBegin('uSunK'))
      .replace('#include <lights_fragment_maps>', '#include <lights_fragment_maps>\n\tiblIrradiance *= 0.0;\n\tradiance *= uEnvK;');
  };
  m.customProgramCacheKey = () => 'sunvis';
}

const MARCH = /* glsl */ `
uniform sampler2D uHF; uniform float uHFR0; uniform float uHFLogK; uniform float uHFu0; uniform float uHFOn;
uniform vec3 uSunW; uniform float uSunR; uniform float uSunK;
varying vec3 vRgW; varying float vRgSun;
float rgHF(vec2 xz) {
  float r = length(xz);
  float az = atan(xz.x, -xz.y);
  return textureLod(uHF, vec2(az * 0.15915494 + uHFu0, log(1.0 + r / uHFR0) / uHFLogK), 0.0).r;
}
float rgSunVis(vec3 p) {
  float hl = length(uSunW.xz);
  float e = asin(clamp(uSunW.y, -1.0, 1.0));
  float vis = 1.0;
  if (uHFOn > 0.5 && hl > 1e-4 && length(p.xz) > 1400.0) {
    vec2 d = uSunW.xz / hl;
    float best = -1.0e3; float t = 1.2;
    for (int k = 0; k < 40; k++) {
      float h = rgHF(p.xz + d * t);
      best = max(best, (h - p.y - 0.04 - 0.0025 * t) / t);
      t *= 1.3;
    }
    // penumbra = the Sun's radius, widened with distance to keep vertex-rate shadows from aliasing
    float pen = uSunR + 0.03 * smoothstep(1500.0, 8000.0, length(p.xz));
    vis = clamp((e - atan(best) + pen) / (2.0 * pen), 0.0, 1.0);
  }
  // Near field (< ~2 km): the engine's disc fraction at the lander + the shadow map; the vertex-rate march
  // only shades the distant ridges, where it cannot streak the ground.
  return mix(uSunK, vis, smoothstep(1500.0, 2500.0, length(p.xz)));
}`;

const NOISE = /* glsl */ `
float rgH(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float rgN(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(rgH(i), rgH(i + vec2(1, 0)), f.x), mix(rgH(i + vec2(0, 1)), rgH(i + vec2(1, 1)), f.x), f.y); }
float rgFbm(vec2 p) { float s = 0.0, a = 0.5; for (int k = 0; k < 5; k++) { s += a * rgN(p); p = p * 2.03 + 17.1; a *= 0.5; } return s; }`;

// Lommel-Seeliger + phase + opposition surge. Normalised so that at normal incidence and view it equals Lambert.
const LS_DIFFUSE = /* glsl */ `{
	float rgMu0 = dotNL;
	float rgMu = saturate( dot( geometryNormal, geometryViewDir ) );
	float rgG = acos( clamp( dot( directLight.direction, geometryViewDir ), -1.0, 1.0 ) );
	float rgLS = 2.0 * rgMu0 / max( rgMu0 + rgMu, 1e-3 );
	float rgPhase = ( 0.32 + 0.68 * exp( -1.1 * rgG ) ) * ( 1.0 + 0.6 / ( 1.0 + tan( min( rgG, 3.0 ) * 0.5 ) / 0.05 ) );
	reflectedLight.directDiffuse += directLight.color * ( rgLS * rgPhase ) * BRDF_Lambert( material.diffuseColor );
}`;

// ?dbg=sun shows the Sun-visibility factor (red) on the ground, for checking the far-terrain shadowing.
const DEBUG = typeof location !== 'undefined' && location.search.includes('dbg=sun');

export interface RegolithOpts { detail?: boolean; rock?: boolean }

/** MeshStandardMaterial patched into a regolith material. Shares the Sun uniforms. */
export function regolithMaterial(u: SunUniforms, opts: RegolithOpts = {}): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({
    color: opts.rock ? new THREE.Color(0.17, 0.165, 0.158) : new THREE.Color(0.205, 0.198, 0.19),
    roughness: 1, metalness: 0, flatShading: !!opts.rock,
  });
  const detail = opts.detail ? regolithDetail() : null;
  m.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, u);
    s.uniforms.uDetail = { value: detail };
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\n' + MARCH)
      .replace('#include <project_vertex>', `#include <project_vertex>
	vec4 rgWp = vec4( transformed, 1.0 );
	#ifdef USE_INSTANCING
		rgWp = instanceMatrix * rgWp;
	#endif
	rgWp = modelMatrix * rgWp;
	vRgW = rgWp.xyz;
	vRgSun = rgSunVis( rgWp.xyz );`);
    const lights = THREE.ShaderChunk.lights_physical_pars_fragment
      .replace('reflectedLight.directSpecular += irradiance * BRDF_GGX( directLight.direction, geometryViewDir, geometryNormal, material );', '')
      .replace('reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );', LS_DIFFUSE);
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vRgW; varying float vRgSun; uniform sampler2D uDetail;
${NOISE}`)
      .replace('#include <lights_physical_pars_fragment>', lights)
      .replace('#include <dithering_fragment>', DEBUG ? '#include <dithering_fragment>\n\tgl_FragColor = vec4(vRgSun, vRgSun * 0.2, 0.0, 1.0);' : '#include <dithering_fragment>')
      .replace('#include <lights_fragment_begin>', lightsBegin('vRgSun'))
      .replace('#include <color_fragment>', `#include <color_fragment>
	{
		float rgDist = length( vRgW - cameraPosition );
		float big = rgFbm( vRgW.xz / 900.0 ) * 0.6 + rgFbm( vRgW.xz / 140.0 ) * 0.4;
		float alb = 0.78 + 0.45 * ( big - 0.5 );
		${detail ? `alb *= mix( 1.0, 0.86 + 0.28 * texture2D( uDetail, vRgW.xz / 7.3 ).a, smoothstep( 120.0, 20.0, rgDist ) );
		alb *= mix( 1.0, 0.8 + 0.4 * texture2D( uDetail, vRgW.xz / 47.0 + 0.31 ).a, smoothstep( 300.0, 80.0, rgDist ) );` : `alb *= 0.85 + 0.3 * rgN( vRgW.xz * 3.1 );`}
		diffuseColor.rgb *= alb;
	}`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
	${detail ? `{
		float rgDist = length( vRgW - cameraPosition );
		vec3 nW = normalize( normal * mat3( viewMatrix ) );
		vec3 t = normalize( vec3( 1.0, 0.0, 0.0 ) - nW * nW.x );
		vec3 b = cross( t, nW );
		mat2 rot = mat2( 0.788, -0.616, 0.616, 0.788 );
		vec3 d1 = texture2D( uDetail, vRgW.xz / 41.0 ).xyz * 2.0 - 1.0;
		vec3 d2 = texture2D( uDetail, rot * vRgW.xz / 6.1 ).xyz * 2.0 - 1.0;
		vec3 d3 = texture2D( uDetail, rot * rot * vRgW.xz / 0.93 ).xyz * 2.0 - 1.0;
		d2.xy = rot * d2.xy; d3.xy = ( rot * rot ) * d3.xy;
		vec2 slope = d1.xy / d1.z * smoothstep( 260.0, 60.0, rgDist ) * 0.7
			+ d2.xy / d2.z * smoothstep( 120.0, 25.0, rgDist ) * 0.55
			+ d3.xy / d3.z * smoothstep( 30.0, 4.0, rgDist ) * 0.5;
		vec3 nP = normalize( nW + t * slope.x + b * slope.y );
		normal = normalize( mat3( viewMatrix ) * nP );
	}` : ''}`);
  };
  m.customProgramCacheKey = () => `regolith-${opts.detail ? 1 : 0}-${opts.rock ? 1 : 0}`;
  return m;
}
