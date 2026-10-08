/**
 * Water: flowing rivers (ribbon along a path, three scrolling normal layers aligned with the flow,
 * Fresnel reflection of scene.environment through a low-roughness PBR surface, depth tint, bank / rock
 * foam) and still lakes. Animation runs from performance.now() inside onBeforeRender; `update(dt)`
 * is exported too for callers that want a game-time clock.
 */
import * as THREE from 'three';
import { getTextureSet } from './textures';
import { patchShader } from './shader';
import { Path } from './path';
import { smoothstep } from '../core/math';
import type { HeightFn, PathPoint } from './util';

const waterUniforms = { uTime: { value: 0 } };
let waterOverride: number | null = null;
let waterClockAdd = 0;

/** freeze water time (deterministic lab snapshots); null resumes */
export function setWaterTime(t: number | null): void {
  waterOverride = t;
  if (t !== null) waterUniforms.uTime.value = t;
}
/** advance the water clock by game time instead of wall time (call once per frame, optional) */
export function updateWater(dt: number): void {
  waterClockAdd += dt;
}
function tickWater(): void {
  waterUniforms.uTime.value = waterOverride ?? performance.now() / 1000 + waterClockAdd * 0;
}

export interface WaterStyle {
  /** flow speed m/s (default 2.2 river, 0.05 lake) */
  speed?: number;
  /** deep water colour (sRGB hex) */
  color?: number;
  /** colour in shallows */
  shallow?: number;
  /** nominal depth in the middle (m) when no terrain is given (default 1.6) */
  depth?: number;
  /** foam amount 0..1 (default 0.35) */
  foam?: number;
  /** white-water: faster, rougher, more foam */
  rapids?: boolean;
  /** ripple strength multiplier (default 1) */
  ripple?: number;
  /** terrain height function: depth = water level - terrain, shallows fade out, shorelines foam */
  terrain?: HeightFn;
  /** foam rings around rocks: x, z, radius */
  rocks?: { x: number; z: number; r: number }[];
  /** overall opacity (default 1) */
  opacity?: number;
  /** vertex wave amplitude (m) */
  wave?: number;
}

export interface WaterBody {
  object: THREE.Mesh;
  /** optional: advance the clock by game time (usually unnecessary) */
  update(dt: number): void;
  /** the centre line (rivers) */
  path?: Path;
  /** flow velocity at (x, z) written to out (m/s, XZ plane); returns false off the river */
  flowAt(x: number, z: number, out: THREE.Vector3): boolean;
  /** water surface y at (x, z) */
  levelAt(x: number, z: number): number;
}

const GLSL_COMMON = /* glsl */ `
uniform sampler2D uWN;
uniform float uTime; uniform float uSpeed;
uniform vec3 uDeep; uniform vec3 uShallow;
uniform vec4 uParams;   // ripple, foam, turbulence, opacity
uniform vec2 uDepthK;   // depth range for deep tint, rapids flag
uniform vec3 uRocks[16]; uniform int uRockCount;
varying vec3 vWPos; varying vec2 vFlow; varying vec2 vWUv; varying float vDepth;
float wH(vec2 p){ p = fract(p * vec2(0.1031, 0.1030)); p += dot(p, p.yx + 33.33); return fract((p.x + p.y) * p.x); }
float wN(vec2 p){ vec2 i = floor(p); vec2 f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(wH(i), wH(i+vec2(1,0)), f.x), mix(wH(i+vec2(0,1)), wH(i+vec2(1,1)), f.x), f.y); }
float wF(vec2 p){ return wN(p)*0.5 + wN(p*2.03+3.1)*0.3 + wN(p*4.1+7.7)*0.2; }
`;

const FRAG_MAP = /* glsl */ `
vec2 uv = vWUv;
float tt = uTime;
vec3 wn1 = texture2D(uWN, uv / 6.0 + vec2(0.0, -tt * uSpeed / 6.0)).xyz * 2.0 - 1.0;
vec3 wn2 = texture2D(uWN, uv / 2.7 + vec2(0.31, -tt * uSpeed * 1.15 / 2.7)).xyz * 2.0 - 1.0;
vec3 wn3 = texture2D(uWN, uv / 1.1 + vec2(0.57 + sin(tt * 0.4) * 0.04, -tt * uSpeed * 1.5 / 1.1)).xyz * 2.0 - 1.0;
vec2 dn = (wn1.xy * 0.6 + wn2.xy * 0.42 + wn3.xy * 0.26) * uParams.x;
float depthRaw = vDepth;
float dep = clamp(depthRaw, 0.0, 6.0);
float dFac = smoothstep(0.0, uDepthK.x, dep);
vec3 wbase = mix(uShallow, uDeep, dFac);
wbase *= 0.86 + 0.28 * (wn1.x * 0.5 + 0.5);
// foam: shallows and banks, rocks, rapids turbulence
vec2 fuv = uv * vec2(2.4, 0.9);
float foamTex = smoothstep(0.5, 0.78, wF(fuv + vec2(0.0, -tt * uSpeed * 0.5)) + 0.2 * wn3.x) * (0.55 + 0.45 * smoothstep(0.35, 0.7, wN(uv * vec2(8.0, 3.2) + vec2(0.0, -tt * uSpeed * 0.9))));
float bank = 1.0 - smoothstep(0.02, 0.4 + uParams.z * 0.3, dep);
float foam = bank * foamTex * uParams.y * 1.8;
foam += uParams.z * smoothstep(0.6, 0.82, wF(uv * vec2(1.3, 0.42) + vec2(0.0, -tt * uSpeed * 0.35)) + 0.2 * wn2.x) * (0.45 + 0.55 * smoothstep(0.3, 0.7, wN(uv * vec2(5.5, 2.2) + vec2(0.0, -tt * uSpeed * 0.8)))) * 0.85;
for (int i = 0; i < 16; i++) {
  if (i >= uRockCount) break;
  vec3 rk = uRocks[i];
  float d = length(vWPos.xz - rk.xy) / rk.z;
  float ring = 1.0 - smoothstep(1.0, 1.45 + 0.4 * wN(vWPos.xz * 1.9), d);
  // a short wake downstream (+flow direction)
  vec2 rel = vWPos.xz - rk.xy;
  float down = dot(rel, vFlow) / rk.z;
  float side = abs(dot(rel, vec2(vFlow.y, -vFlow.x))) / rk.z;
  float wake = smoothstep(0.0, 1.0, down) * (1.0 - smoothstep(0.0, 3.5, down)) * (1.0 - smoothstep(0.4, 1.4, side));
  foam += (ring + wake * 0.7) * (0.35 + 0.65 * foamTex) * (0.6 + uParams.y);
}
foam = clamp(foam, 0.0, 1.0);
diffuseColor.rgb = mix(wbase, vec3(0.86, 0.9, 0.92), foam);
float wAlpha = mix(0.42, 0.95, dFac);
diffuseColor.a = mix(wAlpha, 1.0, foam) * uParams.w * smoothstep(-0.03, 0.12, depthRaw);
float waterFoam = foam;
`;

const FRAG_ROUGH = /* glsl */ `
float roughnessFactor = mix(uDepthK.y > 0.5 ? 0.09 : 0.035, 0.72, waterFoam);
`;

const FRAG_NORMAL = /* glsl */ `
{
  vec2 side = vec2(vFlow.y, -vFlow.x);
  vec3 Nw = normalize(vec3(side.x * dn.x + vFlow.x * dn.y, 1.0, side.y * dn.x + vFlow.y * dn.y));
  normal = normalize((viewMatrix * vec4(Nw, 0.0)).xyz);
}
`;

function makeWaterMaterial(st: WaterStyle, flowMode: boolean): THREE.MeshStandardMaterial {
  const rapids = !!st.rapids;
  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.05,
    metalness: 0.0,
    transparent: true,
    depthWrite: false,
    envMapIntensity: 1.0,
  });
  mat.name = flowMode ? 'river' : 'lake';
  const deep = new THREE.Color(st.color ?? 0x1c3a3c);
  const shallow = new THREE.Color(st.shallow ?? 0x4d5a42);
  const set = getTextureSet('water_normal');
  const speed = st.speed ?? (flowMode ? (rapids ? 4.5 : 2.2) : 0.06);
  const rocks = (st.rocks ?? []).slice(0, 16);
  patchShader(mat, 'water_v1', (shader) => {
    shader.uniforms.uWN = { value: set.normalMap };
    shader.uniforms.uTime = waterUniforms.uTime;
    shader.uniforms.uSpeed = { value: speed };
    shader.uniforms.uDeep = { value: new THREE.Vector3(deep.r, deep.g, deep.b) };
    shader.uniforms.uShallow = { value: new THREE.Vector3(shallow.r, shallow.g, shallow.b) };
    shader.uniforms.uParams = {
      value: new THREE.Vector4((st.ripple ?? 1) * (rapids ? 1.5 : flowMode ? 0.8 : 0.55), st.foam ?? (rapids ? 0.8 : 0.35), rapids ? 0.5 : 0, st.opacity ?? 1),
    };
    shader.uniforms.uDepthK = { value: new THREE.Vector2(Math.max(0.3, (st.depth ?? 1.6) * 0.8), rapids ? 1 : 0) };
    const rk: THREE.Vector3[] = [];
    for (let i = 0; i < 16; i++) rk.push(rocks[i] ? new THREE.Vector3(rocks[i].x, rocks[i].z, Math.max(0.2, rocks[i].r)) : new THREE.Vector3());
    shader.uniforms.uRocks = { value: rk };
    shader.uniforms.uRockCount = { value: rocks.length };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\nattribute vec2 aFlow; attribute float aDepth; attribute vec2 aWUv;\nvarying vec3 vWPos; varying vec2 vFlow; varying vec2 vWUv; varying float vDepth;\nuniform float uTime;`)
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vWPos = (modelMatrix * vec4(position, 1.0)).xyz;
        vFlow = aFlow; vWUv = aWUv; vDepth = aDepth;
        ${st.wave ? `transformed.y += (sin(vWPos.x * 0.7 + uTime * 1.3) * 0.5 + sin(vWPos.z * 0.9 - uTime * 1.7 + vWPos.x * 0.3) * 0.5) * ${st.wave.toFixed(3)};` : ''}`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + GLSL_COMMON)
      .replace('#include <map_fragment>', '#include <map_fragment>\n' + FRAG_MAP)
      .replace('#include <roughnessmap_fragment>', FRAG_ROUGH)
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n' + FRAG_NORMAL);
  });
  return mat;
}

/** river ribbon along a path. `width` in metres (or a function of distance along the path). */
export function river(path: PathPoint[], width: number | ((s: number) => number), st: WaterStyle & { y?: number | HeightFn; step?: number } = {}): WaterBody {
  const p = new Path(path, { y: st.y });
  const L = p.length;
  const step = st.step ?? 1.0;
  const n = Math.max(2, Math.round(L / step));
  const wAt = typeof width === 'function' ? width : () => width;
  const maxW = Math.max(...Array.from({ length: 9 }, (_, i) => wAt((i / 8) * L)));
  const across = Math.max(6, Math.min(48, Math.round(maxW / 0.9)));
  const pos: number[] = [];
  const flow: number[] = [];
  const dep: number[] = [];
  const uvs: number[] = [];
  const idx: number[] = [];
  const nor: number[] = [];
  const nominal = st.depth ?? 1.6;
  const tmp = new THREE.Vector3();
  const tan = new THREE.Vector3();
  for (let i = 0; i <= n; i++) {
    const s = (i / n) * L;
    p.at(s, tmp);
    p.tangent(s, tan);
    const tx = tan.x;
    const tz = tan.z;
    const tl = Math.hypot(tx, tz) || 1;
    const fx = tx / tl;
    const fz = tz / tl;
    const w = wAt(s);
    // right-hand side vector (-dz, dx)
    const rx = -fz;
    const rz = fx;
    for (let k = 0; k <= across; k++) {
      const u = k / across;
      const o = (u - 0.5) * w;
      const x = tmp.x + rx * o;
      const z = tmp.z + rz * o;
      pos.push(x, tmp.y, z);
      nor.push(0, 1, 0);
      flow.push(fx, fz);
      const edge = 1 - Math.abs(2 * u - 1);
      const profile = Math.pow(Math.min(1, edge * 1.6), 0.7);
      dep.push(st.terrain ? tmp.y - st.terrain(x, z) : nominal * profile - 0.02 * (1 - profile));
      uvs.push(o + w * 0.5, s);
    }
  }
  const row = across + 1;
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < across; k++) {
      const a = i * row + k;
      // winding so the face points up (+y): along +s with right-hand offset
      idx.push(a, a + 1, a + row, a + 1, a + row + 1, a + row);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('aFlow', new THREE.Float32BufferAttribute(flow, 2));
  geo.setAttribute('aDepth', new THREE.Float32BufferAttribute(dep, 1));
  geo.setAttribute('aWUv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(idx);
  geo.computeBoundingSphere();
  geo.computeBoundingBox();
  // make sure faces point up regardless of the path direction
  const mat = makeWaterMaterial(st, true);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'river';
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  mesh.renderOrder = 1;
  mesh.userData.noAO = true;
  mesh.onBeforeRender = tickWater;
  const speed = st.speed ?? (st.rapids ? 4.5 : 2.2);
  const wLookup = wAt;
  return {
    object: mesh,
    path: p,
    update: updateWater,
    flowAt(x, z, out) {
      const nr = p.nearest(x, z);
      if (nr.dist > wLookup(nr.s) * 0.5) return false;
      p.tangent(nr.s, tan);
      tan.y = 0;
      tan.normalize();
      // fastest in the middle
      const k = 1 - smoothstep(0.0, 1.0, nr.dist / (wLookup(nr.s) * 0.5)) * 0.5;
      out.set(tan.x * speed * k, 0, tan.z * speed * k);
      return true;
    },
    levelAt(x, z) {
      return p.nearest(x, z).y;
    },
  };
}

export interface LakeOpts extends WaterStyle {
  center: THREE.Vector3 | [number, number];
  /** half extents (rect) */
  halfSize?: [number, number];
  /** radius (disc); overrides halfSize */
  radius?: number;
  /** water surface y */
  y?: number;
  /** grid cell (m, default size dependent) */
  cell?: number;
}

/** still (or gently moving) water surface: rectangle or disc */
export function lake(o: LakeOpts): WaterBody {
  const cx = Array.isArray(o.center) ? o.center[0] : o.center.x;
  const cz = Array.isArray(o.center) ? o.center[1] : o.center.z;
  const y = o.y ?? (Array.isArray(o.center) ? 0 : o.center.y);
  const pos: number[] = [];
  const nor: number[] = [];
  const flow: number[] = [];
  const dep: number[] = [];
  const uvs: number[] = [];
  const idx: number[] = [];
  const nominal = o.depth ?? 3;
  const push = (x: number, z: number) => {
    pos.push(x - cx, y, z - cz);
    nor.push(0, 1, 0);
    flow.push(1, 0);
    dep.push(o.terrain ? y - o.terrain(x, z) : nominal);
    uvs.push(x, z);
  };
  if (o.radius !== undefined) {
    const R = o.radius;
    const rings = Math.max(8, Math.min(96, Math.round(R / (o.cell ?? 3))));
    const sectors = Math.max(24, Math.min(160, Math.round((Math.PI * 2 * R) / (o.cell ?? 3))));
    push(cx, cz);
    for (let r = 1; r <= rings; r++) {
      const rr = (r / rings) * R;
      for (let s = 0; s < sectors; s++) {
        const a = (s / sectors) * Math.PI * 2;
        push(cx + Math.cos(a) * rr, cz + Math.sin(a) * rr);
      }
    }
    for (let s = 0; s < sectors; s++) idx.push(0, 1 + ((s + 1) % sectors), 1 + s);
    for (let r = 1; r < rings; r++) {
      const a0 = 1 + (r - 1) * sectors;
      const b0 = 1 + r * sectors;
      for (let s = 0; s < sectors; s++) {
        const s1 = (s + 1) % sectors;
        idx.push(a0 + s, a0 + s1, b0 + s, a0 + s1, b0 + s1, b0 + s);
      }
    }
    // winding check: the first fan triangle (centre, s+1, s) points up for +angle in x->z; flip if needed below
    for (let i = 0; i < idx.length; i += 3) {
      // ensure up-facing by evaluating the cross product in XZ
      const a = idx[i], b = idx[i + 1], c = idx[i + 2];
      const ux = pos[b * 3] - pos[a * 3];
      const uz = pos[b * 3 + 2] - pos[a * 3 + 2];
      const vx = pos[c * 3] - pos[a * 3];
      const vz = pos[c * 3 + 2] - pos[a * 3 + 2];
      if (uz * vx - ux * vz < 0) { idx[i + 1] = c; idx[i + 2] = b; }
    }
  } else {
    const [hx, hz] = o.halfSize ?? [50, 50];
    const cell = o.cell ?? Math.max(2, Math.max(hx, hz) / 60);
    const nx = Math.max(2, Math.min(200, Math.round((hx * 2) / cell)));
    const nz = Math.max(2, Math.min(200, Math.round((hz * 2) / cell)));
    for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) push(cx - hx + (i / nx) * hx * 2, cz - hz + (j / nz) * hz * 2);
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        const a = j * (nx + 1) + i;
        idx.push(a, a + nx + 1, a + 1, a + 1, a + nx + 1, a + nx + 2);
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('aFlow', new THREE.Float32BufferAttribute(flow, 2));
  geo.setAttribute('aDepth', new THREE.Float32BufferAttribute(dep, 1));
  geo.setAttribute('aWUv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(idx);
  geo.computeBoundingSphere();
  geo.computeBoundingBox();
  const mat = makeWaterMaterial({ color: 0x1a2f36, shallow: 0x3c5048, depth: 3, ...o, speed: o.speed ?? 0.05, wave: o.wave ?? 0.04 }, false);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(cx, 0, cz);
  mesh.name = 'lake';
  mesh.receiveShadow = true;
  mesh.renderOrder = 1;
  mesh.userData.noAO = true;
  mesh.onBeforeRender = tickWater;
  return {
    object: mesh,
    update: updateWater,
    flowAt: () => false,
    levelAt: () => y,
  };
}

/**
 * Wrap a terrain height function so a river channel is carved along `path`: the bed sits `depth`
 * metres below the water level (the path's y or `level`), the banks ease out over `bank` metres.
 * Use it for TerrainOpts.height and pass the same path/width to river().
 */
export function carveRiver(
  height: HeightFn,
  path: PathPoint[] | Path,
  width: number | ((s: number) => number),
  o: { depth?: number; bank?: number; level?: number | ((x: number, z: number) => number) } = {},
): HeightFn {
  const p = path instanceof Path ? path : new Path(path, { y: typeof o.level === 'number' ? o.level : 0 });
  const wAt = typeof width === 'function' ? width : () => width;
  const depth = o.depth ?? 1.8;
  const bank = o.bank ?? 6;
  return (x, z) => {
    const n = p.nearest(x, z);
    const h = height(x, z);
    const w = wAt(n.s) * 0.5;
    if (n.dist > w + bank) return h;
    const level = typeof o.level === 'function' ? o.level(x, z) : n.y;
    const bed = level - depth;
    const t = smoothstep(w * 0.7, w + bank, n.dist);
    // never raise the ground: only carve down toward the bed
    return Math.min(h, bed + (h - bed) * t);
  };
}
