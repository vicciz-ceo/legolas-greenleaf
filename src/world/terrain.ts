/**
 * Terrain builder: heightfield mesh + splat material (slope / height / patch blending of three
 * procedural texture sets, world-space UVs, two-scale anti-tiling, biplanar cliffs).
 *
 *   buildTerrain(opts) -> { mesh, heightAt }
 *
 * heightAt is bilinear-exact on the mesh triangles (same diagonal split as the index buffer) inside
 * the grid and falls back to opts.height outside it.
 */
import * as THREE from 'three';
import type { TerrainOpts } from '../core/types';
import { getTextureSet, TILE_METERS, type TextureSetName } from './textures';
import { patchShader } from './shader';
import { registerWet } from './mats';

/** optional extras (all optional, plain TerrainOpts keeps working) */
export interface TerrainExtras {
  /**
   * look preset on top of `style`: 'mirkwood' (dark, mossy, little leaf litter), 'autumn' (golden litter),
   * 'wet' (darker, glossier ground), 'dry' (sun-baked)
   */
  theme?: 'mirkwood' | 'autumn' | 'wet' | 'dry';
  /** multiply the whole terrain albedo (sRGB hex) */
  tint?: number;
  /** override the three layer texture sets [flat, patches/low, steep] */
  layers?: [TextureSetName, TextureSetName, TextureSetName];
  /** 0..1 how much the B layer (leaf litter / mud / exposed ground) covers flat ground */
  patchiness?: number;
  /** skirt depth below the border (m) so the edge never shows a void. default 60 */
  skirt?: number;
  /** darken concave areas (cavity AO baked into vertices) 0..1. default 0.6 */
  cavity?: number;
}

interface StyleDef {
  layers: [TextureSetName, TextureSetName, TextureSetName];
  tint: [number, number, number];
  /** steepness (1 - normal.y) range where the steep layer fades in */
  slope: [number, number];
  /** patch noise threshold range for layer B */
  patch: [number, number];
  /** normalised height below which layer B takes over (0 = off): hnLo, hnHi */
  low: [number, number];
  /** metres per tile multiplier for [A,B,C] */
  tile: [number, number, number];
  rough: number;
  /** normal-map strength for [A,B,C] */
  nrm: [number, number, number];
  /** noise amplitude on the slope threshold of the steep layer (default 0.12): higher = rock breaks through in patches */
  breakup?: number;
  /** colour the cavity (concave) darkening takes on (default neutral); snow: a cool blue-grey */
  cavTint?: [number, number, number];
  /** 0..1 sun glints on sparse grains (snow) */
  sparkle?: number;
}

const C = (hex: number): [number, number, number] => {
  const c = new THREE.Color(hex);
  return [c.r, c.g, c.b];
};

const STYLES: Record<TerrainOpts['style'], StyleDef> = {
  forest: { layers: ['forest_floor', 'leaves', 'cliff'], tint: [1, 1, 1], slope: [0.22, 0.42], patch: [0.56, 0.74], low: [0, 0], tile: [1, 1, 1], rough: 1, nrm: [1.0, 0.9, 1.1] },
  riverbank: { layers: ['grass', 'mud', 'rock'], tint: [1, 1, 1], slope: [0.24, 0.45], patch: [0.78, 0.9], low: [0.04, 0.2], tile: [1, 1, 1], rough: 1, nrm: [0.9, 1.0, 1.1] },
  snow: { layers: ['snow', 'dirt', 'cliff'], tint: [1, 1, 1], slope: [0.3, 0.5], patch: [0.64, 0.8], low: [0, 0], tile: [1.4, 1, 1], rough: 1, nrm: [0.8, 0.9, 1.1], breakup: 0.3, cavTint: [0.8, 0.88, 1.0], sparkle: 1 },
  rock: { layers: ['rock', 'dirt', 'cliff'], tint: [1, 1, 1], slope: [0.3, 0.55], patch: [0.6, 0.78], low: [0, 0], tile: [1, 1, 1], rough: 1, nrm: [1.0, 0.9, 1.1] },
  plains: { layers: ['grass', 'dirt', 'rock'], tint: [1, 1, 1], slope: [0.26, 0.48], patch: [0.68, 0.84], low: [0, 0], tile: [1, 1, 1], rough: 1, nrm: [0.9, 1.0, 1.1] },
  ash: { layers: ['ash', 'rock', 'cliff'], tint: C(0xb8b0a8), slope: [0.28, 0.5], patch: [0.55, 0.75], low: [0, 0], tile: [1, 1, 1], rough: 1, nrm: [1.0, 1.0, 1.1] },
  cave: { layers: ['dirt', 'rock', 'cliff'], tint: C(0xb4aaa0), slope: [0.25, 0.45], patch: [0.5, 0.7], low: [0, 0], tile: [1, 1, 1], rough: 1, nrm: [1.0, 1.0, 1.1] },
  mud: { layers: ['mud', 'dirt', 'rock'], tint: [1, 1, 1], slope: [0.28, 0.5], patch: [0.6, 0.78], low: [0.02, 0.18], tile: [1, 1, 1], rough: 0.85, nrm: [1.1, 0.9, 1.1] },
};

const THEMES: Record<string, { layers?: [TextureSetName, TextureSetName, TextureSetName]; tint?: [number, number, number]; patchiness?: number }> = {
  mirkwood: { layers: ['forest_floor', 'mud', 'cliff'], tint: [0.55, 0.62, 0.5], patchiness: 0.4 },
  autumn: { tint: [1.08, 0.96, 0.78], patchiness: 0.7 },
  wet: { tint: [0.7, 0.7, 0.68], patchiness: 0.5 },
  dry: { tint: [1.25, 1.1, 0.85], patchiness: 0.5 },
};

const GLSL_SPLAT = /* glsl */ `
uniform sampler2D tA0; uniform sampler2D tN0;
uniform sampler2D tA1; uniform sampler2D tN1;
uniform sampler2D tA2; uniform sampler2D tN2;
uniform vec3 uTile;      // metres per tile for A,B,C
uniform vec4 uSlope;     // slope lo, hi, patch lo, patch hi
uniform vec4 uLow;       // low lo, low hi, hmin, 1/range
uniform vec3 uTintA; uniform vec3 uTintB; uniform vec3 uTintC;
uniform vec3 uNrm; uniform float uRough; uniform float uPatchBias; uniform float uWet;
uniform float uBreak; uniform vec3 uCavTint; uniform float uSparkle;
varying vec3 vWPos; varying vec3 vWNrm; varying float vCav;
float tH(vec2 p){ p = fract(p * vec2(0.1031, 0.1030)); p += dot(p, p.yx + 33.33); return fract((p.x + p.y) * p.x); }
float tN(vec2 p){ vec2 i = floor(p); vec2 f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(tH(i), tH(i+vec2(1,0)), f.x), mix(tH(i+vec2(0,1)), tH(i+vec2(1,1)), f.x), f.y); }
float tF(vec2 p){ return tN(p)*0.55 + tN(p*2.13+5.2)*0.3 + tN(p*4.4+1.7)*0.15; }
// gradient noise (round features, no lattice squares when thresholded), 0..1 around 0.5
vec2 tG2(vec2 p){ p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3))); return fract(sin(p) * 43758.5453) * 2.0 - 1.0; }
float tGN(vec2 p){ vec2 i = floor(p); vec2 f = fract(p); vec2 w = f * f * (3.0 - 2.0 * f);
  float n = mix(mix(dot(tG2(i), f), dot(tG2(i + vec2(1.0, 0.0)), f - vec2(1.0, 0.0)), w.x),
                mix(dot(tG2(i + vec2(0.0, 1.0)), f - vec2(0.0, 1.0)), dot(tG2(i + vec2(1.0, 1.0)), f - vec2(1.0, 1.0)), w.x), w.y);
  return clamp(0.5 + n * 0.8, 0.0, 1.0); }
float tGF(vec2 p){ return tGN(p)*0.55 + tGN(p*2.13+5.2)*0.3 + tGN(p*4.4+1.7)*0.15; }
float tH3(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
// two-scale anti-tiling: blend the texture with a rotated, rescaled copy of itself by low-frequency noise
vec4 aT(sampler2D t, vec2 uv, float k){
  vec4 a = texture2D(t, uv);
  vec4 b = texture2D(t, mat2(0.8, -0.6, 0.6, 0.8) * uv * 0.317 + vec2(0.37, 0.71));
  return mix(a, b, smoothstep(0.35, 0.65, k));
}
`;

const FRAG_ALBEDO = /* glsl */ `
vec3 nW = normalize(vWNrm);
vec2 wp = vWPos.xz;
float kLow = tF(wp * 0.031 + 3.7);
float kMid = tF(wp * 0.11 + 9.1);
float kHi = tN(wp * 0.9);
float slope = 1.0 - nW.y;
// the macro noise is planar in xz: on steep faces every value would be smeared into vertical
// streaks, so walls take it from a wall projection (u = z or x, v = height) instead
{
  float stp = smoothstep(0.2, 0.45, slope);
  if (stp > 0.0) {
    float bx = abs(nW.x) / (abs(nW.x) + abs(nW.z) + 1e-4);
    // gradient noise, rotated off the lattice: chapters threshold these values, and value noise
    // thresholded on a wall reads as square pixels
    mat2 rot = mat2(0.8, -0.6, 0.6, 0.8);
    vec2 qx = rot * vec2(vWPos.z, vWPos.y);
    vec2 qz = rot * vec2(vWPos.x, vWPos.y);
    float vLow = mix(tGF(qz * 0.031 + 3.7), tGF(qx * 0.031 + 6.1), bx);
    float vMid = mix(tGF(qz * 0.11 + 9.1), tGF(qx * 0.11 + 2.3), bx);
    float vHi = mix(tGF(qz * 0.9), tGF(qx * 0.9 + 4.4), bx);
    kLow = mix(kLow, vLow, stp);
    kMid = mix(kMid, vMid, stp);
    kHi = mix(kHi, vHi, stp);
  }
}
float wC = smoothstep(uSlope.x, uSlope.y, slope + (kMid - 0.5) * uBreak);
float hn = (vWPos.y - uLow.z) * uLow.w;
float lowW = uLow.y > 0.0 ? 1.0 - smoothstep(uLow.x, uLow.y, hn + (kMid - 0.5) * 0.1) : 0.0;
float patchW = smoothstep(uSlope.z - uPatchBias, uSlope.w - uPatchBias, kLow * 0.7 + kMid * 0.3);
float wB = clamp(max(patchW, lowW), 0.0, 1.0) * (1.0 - wC);
float wA = max(0.0, 1.0 - wB - wC);
vec3 colA = vec3(0.0); vec3 colB = vec3(0.0); vec3 colC = vec3(0.0);
vec4 nA = vec4(0.5, 0.5, 1.0, 1.0); vec4 nB = nA; vec4 nC = nA;
if (wA > 0.01) {
  vec2 uvA = wp / uTile.x;
  vec4 s = aT(tA0, uvA, kLow);
  colA = s.rgb * uTintA * (0.85 + 0.3 * kMid);
  nA = aT(tN0, uvA, kLow);
}
if (wB > 0.01) {
  vec2 uvB = wp / uTile.y;
  vec4 s = aT(tA1, uvB, kMid);
  colB = s.rgb * uTintB * (0.85 + 0.3 * kLow);
  nB = aT(tN1, uvB, kMid);
}
vec3 nXZ = vec3(0.0);
if (wC > 0.01) {
  // biplanar projection so cliffs are not stretched
  float ax = pow(abs(nW.x), 4.0);
  float az = pow(abs(nW.z), 4.0);
  float sw = ax + az + 1e-4; ax /= sw; az /= sw;
  vec2 uvx = vec2(vWPos.z, vWPos.y) / uTile.z;
  vec2 uvz = vec2(vWPos.x, vWPos.y) / uTile.z;
  vec4 sx = texture2D(tA2, uvx); vec4 sz = texture2D(tA2, uvz + 0.31);
  vec4 nx = texture2D(tN2, uvx); vec4 nz = texture2D(tN2, uvz + 0.31);
  // anti-tiling on big walls: blend in a 2.3x larger, offset copy by low-frequency noise (not rotated,
  // so strata stay level)
  float atl = smoothstep(0.38, 0.62, kLow);
  if (atl > 0.01) {
    vec2 ux2 = uvx * 0.43 + vec2(0.37, 0.11);
    vec2 uz2 = uvz * 0.43 + vec2(0.71, 0.53);
    sx = mix(sx, texture2D(tA2, ux2), atl); sz = mix(sz, texture2D(tA2, uz2), atl);
    nx = mix(nx, texture2D(tN2, ux2), atl); nz = mix(nz, texture2D(tN2, uz2), atl);
  }
  colC = (sx.rgb * ax + sz.rgb * az) * uTintC * (0.8 + 0.4 * kMid);
  nC = nx * ax + nz * az;
  nXZ = vec3(ax, az, 0.0);
}
vec3 splat = colA * wA + colB * wB + colC * wC;
splat *= vCav * (0.94 + 0.12 * kHi) * (1.0 - 0.32 * uWet);
// concave ground takes the cavity tint (snow: blue-grey occlusion instead of plain grey)
splat *= mix(vec3(1.0), uCavTint, clamp((1.0 - vCav) * 2.5, 0.0, 1.0));
diffuseColor.rgb *= splat;
float splatRough = (nA.a * wA + nB.a * wB + nC.a * wC);
`;

const FRAG_ROUGH = /* glsl */ `
float roughnessFactor = clamp(splatRough * uRough * (1.0 - 0.55 * uWet), 0.04, 1.0);
// sun glints: sparse ~1.5 cm grains with a smooth, randomly tilted facet (faded out where a pixel
// covers many grains, so distant snow does not shimmer)
vec3 glintN = vec3(0.0);
if (uSparkle > 0.0 && wA > 0.5) {
  vec3 gc = floor(vWPos * 64.0);
  float gh = tH3(gc);
  float fp = length(fwidth(vWPos));
  float gOn = step(0.988, gh) * (1.0 - smoothstep(0.008, 0.025, fp)) * uSparkle;
  if (gOn > 0.0) {
    roughnessFactor = mix(roughnessFactor, 0.07, gOn);
    glintN = (vec3(tH3(gc + 3.1), tH3(gc + 7.7), tH3(gc + 1.9)) - 0.5) * 0.9 * gOn;
  }
}
`;

const FRAG_NORMAL = /* glsl */ `
{
  vec2 dA = (nA.xy * 2.0 - 1.0) * uNrm.x;
  vec2 dB = (nB.xy * 2.0 - 1.0) * uNrm.y;
  vec3 pn = nW;
  // flat layers: planar projection, u = +x, v = +z
  pn.xz += (dA * wA + dB * wB) * (1.0 - wC);
  // cliffs: biplanar, u = z (x-facing) or x (z-facing), v = y
  if (wC > 0.01) {
    vec2 dC = (nC.xy * 2.0 - 1.0) * uNrm.z;
    pn.y += dC.y * wC;
    pn.z += dC.x * wC * nXZ.x * sign(nW.x);
    pn.x += dC.x * wC * nXZ.y * sign(nW.z);
  }
  pn = normalize(pn + glintN);
  normal = normalize((viewMatrix * vec4(pn, 0.0)).xyz);
}
`;

interface TerrainGrid {
  segs: number;
  cell: number;
  half: number;
  h: Float32Array;
}

export function buildTerrain(opts: TerrainOpts & TerrainExtras): { mesh: THREE.Mesh; heightAt(x: number, z: number): number } {
  const [cx, cz] = opts.center ?? [0, 0];
  const segs = Math.max(2, Math.min(512, Math.floor(opts.segments)));
  const size = opts.size;
  const half = size / 2;
  const cell = size / segs;
  const n = segs + 1;
  const style = { ...(STYLES[opts.style] ?? STYLES.forest) };
  const theme = THEMES[opts.theme ?? ''] ?? null;
  if (theme?.layers && !opts.layers) style.layers = theme.layers;
  const themeTint = theme?.tint ?? null;

  // ── sample the height function on the grid ──
  const h = new Float32Array(n * n);
  let hmin = Infinity;
  let hmax = -Infinity;
  for (let j = 0; j < n; j++) {
    const z = cz - half + j * cell;
    for (let i = 0; i < n; i++) {
      const x = cx - half + i * cell;
      const v = opts.height(x, z);
      h[j * n + i] = Number.isFinite(v) ? v : 0;
      if (h[j * n + i] < hmin) hmin = h[j * n + i];
      if (h[j * n + i] > hmax) hmax = h[j * n + i];
    }
  }
  const grid: TerrainGrid = { segs, cell, half, h };

  // ── geometry (local space: mesh.position = centre) ──
  const skirt = opts.skirt ?? 60;
  const skirtVerts = 4 * n;
  const vcount = n * n + skirtVerts;
  const pos = new Float32Array(vcount * 3);
  const nor = new Float32Array(vcount * 3);
  const cav = new Float32Array(vcount);
  const cavStrength = opts.cavity ?? 0.6;
  const hAtGrid = (i: number, j: number) => h[Math.max(0, Math.min(segs, j)) * n + Math.max(0, Math.min(segs, i))];
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const k = j * n + i;
      pos[k * 3] = -half + i * cell;
      pos[k * 3 + 1] = h[k];
      pos[k * 3 + 2] = -half + j * cell;
      const dx = (hAtGrid(i + 1, j) - hAtGrid(i - 1, j)) / (2 * cell);
      const dz = (hAtGrid(i, j + 1) - hAtGrid(i, j - 1)) / (2 * cell);
      const inv = 1 / Math.sqrt(dx * dx + dz * dz + 1);
      nor[k * 3] = -dx * inv;
      nor[k * 3 + 1] = inv;
      nor[k * 3 + 2] = -dz * inv;
      // cavity: height relative to the neighbourhood mean (radius 3 cells)
      let sum = 0;
      let cnt = 0;
      for (let b = -3; b <= 3; b += 3) {
        for (let a = -3; a <= 3; a += 3) {
          if (a === 0 && b === 0) continue;
          sum += hAtGrid(i + a, j + b);
          cnt++;
        }
      }
      const conc = (sum / cnt - h[k]) / (cell * 3);
      cav[k] = Math.max(0.55, Math.min(1.12, 1 + (conc > 0 ? -conc * 0.9 * cavStrength : -conc * 0.35 * cavStrength)));
    }
  }
  // skirts (south, north, west, east edges)
  const edge = (e: number, t: number): [number, number] => {
    switch (e) {
      case 0: return [t, 0];
      case 1: return [t, segs];
      case 2: return [0, t];
      default: return [segs, t];
    }
  };
  for (let e = 0; e < 4; e++) {
    for (let t = 0; t < n; t++) {
      const [i, j] = edge(e, t);
      const k = n * n + e * n + t;
      const src = j * n + i;
      pos[k * 3] = pos[src * 3];
      pos[k * 3 + 1] = pos[src * 3 + 1] - skirt;
      pos[k * 3 + 2] = pos[src * 3 + 2];
      const ox = e === 2 ? -1 : e === 3 ? 1 : 0;
      const oz = e === 0 ? -1 : e === 1 ? 1 : 0;
      nor[k * 3] = ox;
      nor[k * 3 + 1] = 0;
      nor[k * 3 + 2] = oz;
      cav[k] = 0.4;
    }
  }
  const quads = segs * segs;
  const skirtQuads = 4 * segs;
  const idx = new Uint32Array((quads + skirtQuads) * 6);
  let o = 0;
  for (let j = 0; j < segs; j++) {
    for (let i = 0; i < segs; i++) {
      const a = j * n + i; // 00
      const b = j * n + i + 1; // 10 (+x)
      const c = (j + 1) * n + i; // 01 (+z)
      const d = (j + 1) * n + i + 1; // 11
      // diagonal runs b-c. Triangles: (a, c, b) and (b, c, d); both face +Y
      idx[o++] = a; idx[o++] = c; idx[o++] = b;
      idx[o++] = b; idx[o++] = c; idx[o++] = d;
    }
  }
  for (let e = 0; e < 4; e++) {
    for (let t = 0; t < segs; t++) {
      const [i0, j0] = edge(e, t);
      const [i1, j1] = edge(e, t + 1);
      const top0 = j0 * n + i0;
      const top1 = j1 * n + i1;
      const bot0 = n * n + e * n + t;
      const bot1 = n * n + e * n + t + 1;
      // winding chosen per edge so faces point outward
      if (e === 1 || e === 2) {
        idx[o++] = top0; idx[o++] = bot0; idx[o++] = top1;
        idx[o++] = top1; idx[o++] = bot0; idx[o++] = bot1;
      } else {
        idx[o++] = top0; idx[o++] = top1; idx[o++] = bot0;
        idx[o++] = top1; idx[o++] = bot1; idx[o++] = bot0;
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geo.setAttribute('aCav', new THREE.BufferAttribute(cav, 1));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.boundingBox = new THREE.Box3(new THREE.Vector3(-half, hmin - skirt, -half), new THREE.Vector3(half, hmax, half));
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, (hmin + hmax) / 2, 0), Math.hypot(half * 1.0, half * 1.0, (hmax - hmin + skirt) / 2) * 1.01);

  // ── material ──
  const layers = opts.layers ?? style.layers;
  const sets = layers.map((nme) => getTextureSet(nme));
  const mat = new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0, envMapIntensity: opts.style === 'snow' ? 1.0 : 0.85 });
  mat.name = `terrain:${opts.style}`;
  const tint = opts.tint !== undefined ? new THREE.Color(opts.tint) : themeTint ? new THREE.Color(themeTint[0], themeTint[1], themeTint[2]) : new THREE.Color(1, 1, 1);
  const patchBias = ((opts.patchiness ?? theme?.patchiness ?? 0.5) - 0.5) * 0.5;
  const wetU = { value: 0 };
  registerWet({ apply: (v) => { wetU.value = v; } });
  patchShader(mat, `terrain_${opts.style}_${layers.join('')}`, (shader) => {
    const u = shader.uniforms;
    u.tA0 = { value: sets[0].map };
    u.tN0 = { value: sets[0].normalMap };
    u.tA1 = { value: sets[1].map };
    u.tN1 = { value: sets[1].normalMap };
    u.tA2 = { value: sets[2].map };
    u.tN2 = { value: sets[2].normalMap };
    u.uTile = { value: new THREE.Vector3(TILE_METERS[layers[0]] * style.tile[0], TILE_METERS[layers[1]] * style.tile[1], TILE_METERS[layers[2]] * style.tile[2]) };
    u.uSlope = { value: new THREE.Vector4(style.slope[0], style.slope[1], style.patch[0], style.patch[1]) };
    u.uLow = { value: new THREE.Vector4(style.low[0], style.low[1], hmin, 1 / Math.max(1, hmax - hmin)) };
    u.uTintA = { value: new THREE.Vector3(style.tint[0] * tint.r, style.tint[1] * tint.g, style.tint[2] * tint.b) };
    u.uTintB = { value: new THREE.Vector3(style.tint[0] * tint.r, style.tint[1] * tint.g, style.tint[2] * tint.b) };
    u.uTintC = { value: new THREE.Vector3(style.tint[0] * tint.r, style.tint[1] * tint.g, style.tint[2] * tint.b) };
    u.uNrm = { value: new THREE.Vector3(...style.nrm) };
    u.uRough = { value: style.rough };
    u.uPatchBias = { value: patchBias };
    u.uWet = wetU;
    u.uBreak = { value: style.breakup ?? 0.12 };
    u.uCavTint = { value: new THREE.Vector3(...(style.cavTint ?? [1, 1, 1])) };
    u.uSparkle = { value: style.sparkle ?? 0 };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aCav;\nvarying vec3 vWPos; varying vec3 vWNrm; varying float vCav;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWPos = (modelMatrix * vec4(position, 1.0)).xyz;\nvWNrm = normalize(mat3(modelMatrix) * normal);\nvCav = aCav;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + GLSL_SPLAT)
      .replace('#include <map_fragment>', '#include <map_fragment>\n' + FRAG_ALBEDO)
      .replace('#include <roughnessmap_fragment>', FRAG_ROUGH)
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n' + FRAG_NORMAL);
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(cx, 0, cz);
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  mesh.name = `terrain:${opts.style}`;
  mesh.userData.terrain = true;
  mesh.updateMatrixWorld(true);

  const heightFn = opts.height;
  const heightAt = (x: number, z: number): number => {
    const fx = (x - cx + half) / cell;
    const fz = (z - cz + half) / cell;
    if (fx < 0 || fz < 0 || fx > segs || fz > segs) return heightFn(x, z);
    let i = Math.floor(fx);
    let j = Math.floor(fz);
    if (i >= segs) i = segs - 1;
    if (j >= segs) j = segs - 1;
    const u = fx - i;
    const v = fz - j;
    const h00 = grid.h[j * n + i];
    const h10 = grid.h[j * n + i + 1];
    const h01 = grid.h[(j + 1) * n + i];
    if (u + v <= 1) return h00 + u * (h10 - h00) + v * (h01 - h00);
    const h11 = grid.h[(j + 1) * n + i + 1];
    return h11 + (1 - u) * (h01 - h11) + (1 - v) * (h10 - h11);
  };
  return { mesh, heightAt };
}
