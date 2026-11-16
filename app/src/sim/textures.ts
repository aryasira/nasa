// AI-assisted; see README.
// Procedural textures for the simulator, generated once per page and cached (no network assets).
// Each getter returns the same texture on every call; disposeTextures() frees them all.
import * as THREE from 'three';
import { hash2, rng, vnoise } from './ground';

const cache = new Map<string, THREE.Texture>();
function once<T extends THREE.Texture>(key: string, make: () => T): T {
  let t = cache.get(key) as T | undefined;
  if (!t) { t = make(); cache.set(key, t); }
  return t;
}
export function disposeTextures() { for (const t of cache.values()) t.dispose(); cache.clear(); }

/** Tileable value-noise fbm on an N-periodic lattice. */
function tileFbm(x: number, y: number, period: number, oct: number, seed: number) {
  let s = 0, a = 0.5, f = 1;
  for (let o = 0; o < oct; o++) {
    const p = period * f;
    // periodic lattice: wrap integer coordinates by p
    const ix = Math.floor(x * f), iy = Math.floor(y * f);
    const fx = x * f - ix, fy = y * f - iy;
    const w = (i: number) => ((i % p) + p) % p;
    const h = (i: number, j: number) => 2 * hash2(w(i), w(j), seed + o) - 1;
    const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
    const v = h(ix, iy) * (1 - ux) * (1 - uy) + h(ix + 1, iy) * ux * (1 - uy) + h(ix, iy + 1) * (1 - ux) * uy + h(ix + 1, iy + 1) * ux * uy;
    s += a * v; a *= 0.5; f *= 2;
  }
  return s;
}

/** Height field (tileable) → RGBA8: normal in RGB, albedo detail in A. */
function heightToNormal(h: Float32Array, alb: Float32Array, N: number, strength: number): THREE.DataTexture {
  const data = new Uint8Array(N * N * 4);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const xl = (x + N - 1) % N, xr = (x + 1) % N, yu = (y + N - 1) % N, yd = (y + 1) % N;
    const dx = (h[y * N + xr] - h[y * N + xl]) * strength, dy = (h[yd * N + x] - h[yu * N + x]) * strength;
    const l = Math.hypot(dx, dy, 1);
    const o = (y * N + x) * 4;
    data[o] = Math.round((-dx / l * 0.5 + 0.5) * 255);
    data[o + 1] = Math.round((-dy / l * 0.5 + 0.5) * 255);
    data[o + 2] = Math.round((1 / l * 0.5 + 0.5) * 255);
    data[o + 3] = Math.max(0, Math.min(255, Math.round(alb[y * N + x] * 255)));
  }
  const t = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.anisotropy = 8;
  t.needsUpdate = true;
  return t;
}

/**
 * Regolith detail: tileable crater field (power-law sizes, raised rims) + fbm grain.
 * RGB = tangent-space normal, A = albedo detail (fresh crater rims and ejecta are brighter).
 */
export function regolithDetail(): THREE.DataTexture {
  return once('regolith', () => {
    const N = 512, h = new Float32Array(N * N), alb = new Float32Array(N * N);
    const rand = rng('regolith-detail');
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const u = x / N, v = y / N;
      h[y * N + x] = 2.2 * tileFbm(u * 8, v * 8, 8, 6, 3);
      alb[y * N + x] = 0.55 + 0.25 * tileFbm(u * 4, v * 4, 4, 5, 9);
    }
    // craters: N(>r) ~ r^-2
    for (let k = 0; k < 300; k++) {
      const r = 2.5 * Math.pow(1 - rand() * 0.985, -1 / 1.7);
      if (r > 70) continue;
      const cx = rand() * N, cy = rand() * N, depth = r * (0.08 + 0.14 * Math.pow(rand(), 2)), rim = r * 0.04, fresh = rand();
      const ext = Math.ceil(r * 2);
      for (let dy = -ext; dy <= ext; dy++) for (let dx = -ext; dx <= ext; dx++) {
        const d = Math.hypot(dx, dy) / r;
        if (d >= 2) continue;
        const x = (((Math.floor(cx) + dx) % N) + N) % N, y = (((Math.floor(cy) + dy) % N) + N) % N;
        const i = y * N + x;
        if (d < 1) { h[i] += rim + depth * (d * d - 1); alb[i] += fresh > 0.8 ? 0.12 * (1 - d) : -0.03; }
        else { const t = 2 - d; h[i] += rim * Math.pow(1 / d, 3) * t * t * (3 - 2 * t); alb[i] += fresh > 0.8 ? 0.14 * t * t : 0; }
      }
    }
    return heightToNormal(h, alb, N, 0.6);
  });
}

/** Crinkled multi-layer insulation: faceted Voronoi normals with creases. */
export function foilNormal(): THREE.DataTexture {
  return once('foil', () => {
    const N = 256, G = 10; // GxG jittered cells, tileable
    const rand = rng('foil');
    const pts: { x: number; y: number; nx: number; ny: number }[] = [];
    for (let j = 0; j < G; j++) for (let i = 0; i < G; i++)
      pts.push({ x: (i + rand()) / G * N, y: (j + rand()) / G * N, nx: (rand() - 0.5) * 0.9, ny: (rand() - 0.5) * 0.9 });
    const data = new Uint8Array(N * N * 4);
    const cs = N / G;
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      let b1 = 1e9, b2 = 1e9, best = pts[0];
      const ci = Math.floor(x / cs), cj = Math.floor(y / cs);
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        const ii = (ci + di + G) % G, jj = (cj + dj + G) % G;
        const p = pts[jj * G + ii];
        const px = p.x + (ci + di < 0 ? -N : ci + di >= G ? N : 0), py = p.y + (cj + dj < 0 ? -N : cj + dj >= G ? N : 0);
        const d = Math.hypot(x - px, y - py);
        if (d < b1) { b2 = b1; b1 = d; best = p; } else if (d < b2) b2 = d;
      }
      const crease = Math.exp(-(b2 - b1) * 0.9);
      const wob = 0.15 * vnoise(x / 9, y / 9, 4);
      let nx = best.nx + wob + crease * 0.4, ny = best.ny - wob * 0.6;
      const l = Math.hypot(nx, ny, 1); nx /= l; ny /= l;
      const o = (y * N + x) * 4;
      data[o] = Math.round((nx * 0.5 + 0.5) * 255); data[o + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      data[o + 2] = Math.round((1 / l * 0.5 + 0.5) * 255); data[o + 3] = 255;
    }
    const t = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.anisotropy = 4;
    t.needsUpdate = true;
    return t;
  });
}

function canvasTex(key: string, w: number, h: number, draw: (g: CanvasRenderingContext2D) => void, srgb = true) {
  return once(key, () => {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    draw(c.getContext('2d')!);
    const t = new THREE.CanvasTexture(c);
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
  });
}

/** Solar array: dark cells, thin silver busbars, gaps between cells. */
export function solarCells(): THREE.Texture {
  return canvasTex('cells', 512, 512, (g) => {
    g.fillStyle = '#b9bec4'; g.fillRect(0, 0, 512, 512);
    const n = 8, gap = 4, s = 512 / n;
    const rand = rng('cells');
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const x = i * s + gap / 2, y = j * s + gap / 2, w = s - gap;
      const tint = 10 + Math.floor(rand() * 8);
      g.fillStyle = `rgb(${tint}, ${tint + 12}, ${tint + 34})`;
      g.fillRect(x, y, w, w);
      g.fillStyle = 'rgba(200,205,215,0.55)';
      for (let k = 1; k < 4; k++) g.fillRect(x + (k * w) / 4 - 0.5, y, 1, w);
      g.fillStyle = 'rgba(200,205,215,0.18)';
      for (let k = 1; k < 24; k++) g.fillRect(x, y + (k * w) / 24, w, 0.5);
    }
  });
}

/** Lens glare for the Sun: soft halo + faint six-point starburst (additive). */
export function glareTexture(): THREE.Texture {
  return canvasTex('glare', 512, 512, (g) => {
    const c = 256;
    const halo = g.createRadialGradient(c, c, 0, c, c, c);
    halo.addColorStop(0, 'rgba(255,250,240,1)');
    halo.addColorStop(0.03, 'rgba(255,240,215,0.9)');
    halo.addColorStop(0.12, 'rgba(255,214,160,0.22)');
    halo.addColorStop(0.4, 'rgba(255,190,120,0.05)');
    halo.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = halo; g.fillRect(0, 0, 512, 512);
    g.globalCompositeOperation = 'lighter';
    for (let k = 0; k < 6; k++) {
      g.save(); g.translate(c, c); g.rotate((k * Math.PI) / 3 + 0.26);
      const sp = g.createLinearGradient(0, 0, c, 0);
      sp.addColorStop(0, 'rgba(255,245,230,0.5)'); sp.addColorStop(1, 'rgba(255,245,230,0)');
      g.fillStyle = sp;
      g.beginPath(); g.moveTo(0, -2.2); g.lineTo(c, 0); g.lineTo(0, 2.2); g.closePath(); g.fill();
      g.restore();
    }
  });
}

/** Soft radial contact shadow under the lander (alpha only). */
export function contactShadow(): THREE.Texture {
  return canvasTex('contact', 256, 256, (g) => {
    const grd = g.createRadialGradient(128, 128, 0, 128, 128, 128);
    grd.addColorStop(0, 'rgba(0,0,0,0.75)'); grd.addColorStop(0.45, 'rgba(0,0,0,0.45)'); grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd; g.fillRect(0, 0, 256, 256);
  }, false);
}

/** Small round soft sprite for stars. */
export function dotTexture(): THREE.Texture {
  return canvasTex('dot', 64, 64, (g) => {
    const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.25, 'rgba(255,255,255,0.6)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
  }, false);
}
