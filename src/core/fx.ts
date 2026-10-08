/**
 * FX: pooled, GPU-driven particles, weather, fire with a light budget, trails, decals, debris and
 * lightning. Everything is procedural (canvas atlas, shader maths); nothing is loaded.
 *
 * Design
 *  - ParticleLayer: one instanced-quad mesh with a ring-buffer pool. A particle is written ONCE
 *    (position, velocity, life, colours...) and the vertex shader evaluates its whole trajectory
 *    analytically (drag + gravity + turbulence), so the CPU only pays at spawn time. Premultiplied
 *    blending lets one draw call hold both smoke (alpha) and fire/sparks (additive).
 *  - Weather: camera-centred, world-stationary lattices of instanced quads that are wrapped in the
 *    vertex shader (zero CPU). Rain/storm are velocity-stretched streaks with ground splashes.
 *  - Emitters (fire/smoke/torch) spawn into the layer; fire lights come from a pool limited by the
 *    quality budget, nearest fires first, with smooth hand-over.
 *  - Debris is a small CPU-simulated InstancedMesh that bounces; blood leaves ground decals.
 *  - Soft particles: not available (the scene depth cannot be read while the scene is rendering into
 *    the same target), so particles fade near the camera instead.
 */
import * as THREE from 'three';
import type { BloodKind, Engine, Fx, FxHandle, WeatherKind } from './types';
import { fbm2, noise2 } from './rng';
import { getEngineInternals } from './engine';
import type { EnvironmentPresetEx } from './environment';

export interface FxExtras {
  /**
   * Optional terrain height query. When set, decals, rain splashes and debris land on the real
   * ground; otherwise the height of engine.shadowFocus is used as the ground plane.
   */
  groundAt: ((x: number, z: number) => number) | null;
  readonly stats: { liveEmitters: number; lights: number; weather: WeatherKind };
  /** free every GPU resource and remove the FX group from the scene */
  dispose(): void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Procedural sprite atlas (4 x 4 cells of 192 px, density in the red channel; ~0.2 s to build)
// ─────────────────────────────────────────────────────────────────────────────

const CELL = {
  dot: 0, puff0: 1, puff1: 2, puff2: 3, flame0: 4, flame1: 5, flame2: 6, spark: 7,
  drop: 8, ring: 9, streak: 10, snow: 11, flake: 12, mist: 13, splat0: 14, splat1: 15,
} as const;

function smooth(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

function buildAtlas(): THREE.CanvasTexture {
  const S = 192;
  const N = 4;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = S * N;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(S * N, S * N);
  const data = img.data;

  const paint = (cell: number, fn: (u: number, v: number) => number) => {
    const cx = (cell % N) * S;
    const cy = Math.floor(cell / N) * S;
    for (let y = 0; y < S; y++) {
      const v = 1 - (y / (S - 1)) * 2; // +1 at the top of the cell
      for (let x = 0; x < S; x++) {
        const u = (x / (S - 1)) * 2 - 1;
        let d = fn(u, v);
        const edge = Math.max(Math.abs(u), Math.abs(v));
        d *= smooth(1, 0.9, edge);
        const o = ((cy + y) * S * N + cx + x) * 4;
        const b = Math.round(Math.min(1, Math.max(0, d)) * 255);
        data[o] = data[o + 1] = data[o + 2] = b;
        data[o + 3] = 255;
      }
    }
  };

  const n1 = noise2(11);
  const nf = (x: number, y: number, seed: number) => fbm2(x, y, 3, seed) * 0.5 + 0.5;

  paint(CELL.dot, (u, v) => {
    const r2 = u * u + v * v;
    return Math.exp(-r2 * 5) * smooth(1, 0.8, Math.sqrt(r2));
  });

  for (let k = 0; k < 3; k++) {
    const seed = 21 + k * 7;
    paint(CELL.puff0 + k, (u, v) => {
      const r = Math.sqrt(u * u + v * v);
      const warp = (nf(u * 1.9 + k * 3.1, v * 1.9, seed) - 0.5) * 0.9;
      const base = smooth(1.0, 0.18, r + warp);
      const detail = 0.72 + 0.28 * nf(u * 5.5, v * 5.5 + k, seed + 3);
      return Math.pow(base, 1.25) * detail;
    });
  }

  for (let k = 0; k < 3; k++) {
    const seed = 41 + k * 5;
    paint(CELL.flame0 + k, (u, v) => {
      const t = (v + 1) / 2; // 0 bottom .. 1 top
      const wob = (nf(v * 2.2 + k * 5, 0.7, seed) - 0.5) * 0.5 * t + n1(v * 3 + k, 2) * 0.06;
      const width = Math.pow(1 - t, 0.75) * 0.55 * (0.25 + Math.min(1, t * 5)) + 0.02;
      const x = Math.abs(u - wob);
      let d = smooth(width + 0.18, width - 0.12, x);
      const erode = nf(u * 3.2 + k * 2, v * 3.2 - 1.5, seed + 9);
      d *= Math.min(1, Math.max(0, 1.35 - t * 1.05 + (erode - 0.5) * 0.85));
      const core = Math.exp(-(u - wob) * (u - wob) * 9) * Math.pow(1 - t, 1.4);
      return Math.min(1, d * 0.8 + core * 0.55 * d);
    });
  }

  paint(CELL.spark, (u, v) => {
    const core = Math.exp(-u * u * 90) * (1 - Math.pow(Math.abs(v), 2.5));
    const glow = Math.exp(-u * u * 12) * Math.exp(-v * v * 5) * 0.35;
    return core + glow;
  });

  paint(CELL.drop, (u, v) => {
    const e = (u * u) / 0.42 + (v * v) / 1.0;
    const irregular = 1 + 0.08 * n1(u * 4, v * 4);
    return smooth(1.0 * irregular, 0.7, e);
  });

  paint(CELL.ring, (u, v) => {
    const r = Math.sqrt(u * u + v * v);
    const a = Math.atan2(v, u);
    const wob = 1 + 0.05 * n1(a * 3, 1.5);
    const d = Math.abs(r - 0.78 * wob);
    return smooth(0.13, 0.0, d) * (0.7 + 0.3 * n1(a * 6, 4));
  });

  paint(CELL.streak, (u, v) => {
    const a = Math.exp(-u * u * 55) * smooth(1, 0.35, Math.abs(v));
    return a * (0.35 + 0.65 * (1 - Math.abs(v)));
  });

  paint(CELL.snow, (u, v) => {
    const r = Math.sqrt(u * u + v * v);
    const dot = smooth(1, 0.45, r);
    const arms = Math.max(Math.exp(-u * u * 90), Math.exp(-v * v * 90)) * smooth(1, 0.3, r) * 0.35;
    return Math.max(dot * dot, arms);
  });

  paint(CELL.flake, (u, v) => {
    const r = Math.sqrt(u * u + v * v);
    const a = Math.atan2(v, u);
    const lim = 0.52 + 0.16 * n1(Math.cos(a) * 1.3 + 3, Math.sin(a) * 1.3) + 0.06 * n1(Math.cos(a) * 3.1, Math.sin(a) * 3.1 + 7);
    return smooth(lim + 0.12, lim - 0.08, r) * (0.75 + 0.25 * n1(u * 6, v * 6));
  });

  paint(CELL.mist, (u, v) => {
    const r = Math.sqrt(u * u + v * v);
    const w = nf(u * 1.4 + 9, v * 1.4, 77);
    return Math.pow(smooth(1, 0, r), 1.6) * (0.35 + 0.9 * w);
  });

  for (let k = 0; k < 2; k++) {
    // blood splat decals: irregular core, radial spikes, satellite droplets
    let a = 1234 + k * 977;
    const rnd = () => ((a = (a * 1664525 + 1013904223) >>> 0) / 4294967296);
    const sats: [number, number, number][] = [];
    for (let i = 0; i < 16; i++) {
      const ang = rnd() * Math.PI * 2;
      const rad = 0.42 + rnd() * 0.5;
      sats.push([Math.cos(ang) * rad, Math.sin(ang) * rad, 0.018 + rnd() * rnd() * 0.075]);
    }
    const spikes: [number, number, number][] = [];
    for (let i = 0; i < 9; i++) spikes.push([rnd() * Math.PI * 2, 0.3 + rnd() * 0.55, 0.02 + rnd() * 0.035]);
    paint(CELL.splat0 + k, (u, v) => {
      const r = Math.sqrt(u * u + v * v);
      const ang = Math.atan2(v, u);
      const coreR = 0.24 + 0.09 * n1(Math.cos(ang) * 1.7 + k * 5, Math.sin(ang) * 1.7);
      let d = smooth(coreR + 0.04, coreR - 0.05, r);
      for (let i = 0; i < spikes.length; i++) {
        const sa = spikes[i][0];
        // distance of the pixel from the spike's ray, only along the ray
        const along = u * Math.cos(sa) + v * Math.sin(sa);
        const perp = Math.abs(-u * Math.sin(sa) + v * Math.cos(sa));
        if (along > 0 && along < spikes[i][1] + coreR * 0.5) {
          const wdt = spikes[i][2] * (1 - along / (spikes[i][1] + coreR * 0.5)) + 0.004;
          d = Math.max(d, smooth(wdt, wdt * 0.3, perp));
        }
      }
      for (let i = 0; i < sats.length; i++) {
        const dx = u - sats[i][0], dy = v - sats[i][1];
        const dd = Math.sqrt(dx * dx + dy * dy);
        d = Math.max(d, smooth(sats[i][2], sats[i][2] * 0.5, dd));
      }
      return d * (0.85 + 0.15 * n1(u * 9, v * 9));
    });
  }

  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.NoColorSpace;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.anisotropy = 4;
  return tex;
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared GLSL
// ─────────────────────────────────────────────────────────────────────────────

const FOG_FRAG = /* glsl */ `
  uniform vec3 uFogColor;
  uniform float uFogDensity;
  float fogAmount(float dist) { return 1.0 - exp(-uFogDensity * uFogDensity * dist * dist); }
`;

const LAYER_VS = /* glsl */ `
  attribute vec4 aA; // pos.xyz, birth
  attribute vec4 aB; // vel.xyz, life
  attribute vec4 aC; // size0, size1, rot0, rotVel
  attribute vec4 aD; // colour0 rgb, alpha0
  attribute vec4 aE; // colour1 rgb, alpha1
  attribute vec4 aF; // drag, gravity, cell, flags
  attribute vec4 aG; // stretch, seed, turbulence, fadeIn
  uniform float uTime;
  varying vec2 vUv;
  varying vec4 vColor;
  varying vec3 vWorld;
  varying float vAdd;
  varying float vLit;
  void main() {
    float age = uTime - aA.w;
    float life = aB.w;
    if (age < 0.0 || age > life) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
    float u = age / life;
    float k = max(aF.x, 0.02);
    float e = (1.0 - exp(-k * age)) / k;
    vec3 pos = aA.xyz + aB.xyz * e;
    pos.y -= aF.y * 9.81 * (age - e) / k;
    float seed = aG.y;
    pos += aG.z * min(age, 1.5) * vec3(sin(age * 1.7 + seed * 6.28), 0.35 * sin(age * 2.3 + seed * 11.0), cos(age * 1.3 + seed * 9.0));
    vec3 vel = aB.xyz * exp(-k * age);
    vel.y -= aF.y * 9.81 * e;
    float size = mix(aC.x, aC.y, sqrt(u));
    float rot = aC.z + aC.w * age;
    float orient = mod(aF.w, 4.0);
    vAdd = step(0.5, mod(floor(aF.w / 4.0), 2.0));
    vLit = step(0.5, mod(floor(aF.w / 8.0), 2.0));
    vec2 q = position.xy;
    vec3 wp;
    if (orient > 0.5 && orient < 1.5) {
      float sp = length(vel);
      vec3 dir = sp > 1e-3 ? vel / sp : vec3(0.0, 1.0, 0.0);
      vec3 toCam = normalize(cameraPosition - pos);
      vec3 side = normalize(cross(dir, toCam) + vec3(1e-5));
      float len = size * (1.0 + aG.x * sp);
      wp = pos + side * q.x * size + dir * q.y * len;
    } else if (orient > 1.5) {
      float c = cos(rot), s = sin(rot);
      vec2 r = vec2(c * q.x - s * q.y, s * q.x + c * q.y) * size;
      wp = pos + vec3(r.x, 0.0, r.y);
    } else {
      float c = cos(rot), s = sin(rot);
      vec2 r = vec2(c * q.x - s * q.y, s * q.x + c * q.y) * size;
      vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
      vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
      wp = pos + right * r.x + up * r.y;
    }
    float cell = aF.z;
    vec2 cxy = vec2(mod(cell, 4.0), floor(cell / 4.0));
    vec2 uv = q + 0.5;
    vUv = vec2((cxy.x + uv.x) * 0.25, (3.0 - cxy.y + uv.y) * 0.25);
    vColor = mix(aD, aE, u);
    vColor.a *= min(1.0, age / max(aG.w, 1e-3));
    vWorld = wp;
    gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
  }`;

const LAYER_FS = /* glsl */ `
  precision highp float;
  uniform sampler2D uAtlas;
  uniform vec3 uAmbient;
  uniform vec4 uLights[4];
  ${FOG_FRAG}
  varying vec2 vUv;
  varying vec4 vColor;
  varying vec3 vWorld;
  varying float vAdd;
  varying float vLit;
  void main() {
    float d = texture2D(uAtlas, vUv).r;
    float a = vColor.a * d;
    if (a < 0.002) discard;
    vec3 col = vColor.rgb;
    if (vLit > 0.5) {
      vec3 l = uAmbient;
      for (int i = 0; i < 4; i++) {
        vec3 dv = uLights[i].xyz - vWorld;
        l += vec3(1.0, 0.52, 0.2) * (uLights[i].w / (1.0 + dot(dv, dv)));
      }
      col *= l;
    }
    float dist = length(vWorld - cameraPosition);
    float f = fogAmount(dist);
    col = mix(col, uFogColor, f * (1.0 - vAdd));
    a *= (1.0 - f * vAdd) * smoothstep(0.1, 1.3, dist);
    gl_FragColor = vec4(col * a, a * (1.0 - vAdd));
  }`;

const PREMULT = {
  transparent: true,
  depthWrite: false,
  blending: THREE.CustomBlending,
  blendEquation: THREE.AddEquation,
  blendSrc: THREE.OneFactor,
  blendDst: THREE.OneMinusSrcAlphaFactor,
  blendSrcAlpha: THREE.OneFactor,
  blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
  // ground-aligned quads (rings, decals, splashes) are mirrored on the way to the XZ plane
  side: THREE.DoubleSide,
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// ParticleLayer
// ─────────────────────────────────────────────────────────────────────────────

class P {
  px = 0; py = 0; pz = 0; vx = 0; vy = 0; vz = 0;
  life = 1; s0 = 1; s1 = 1; rot = 0; rotVel = 0;
  r0 = 1; g0 = 1; b0 = 1; a0 = 1; r1 = 1; g1 = 1; b1 = 1; a1 = 0;
  drag = 0.02; grav = 0; cell = 0; orient = 0; additive = false; lit = false;
  stretch = 0; turb = 0; fadeIn = 0.04;
  reset(): this {
    this.vx = this.vy = this.vz = 0;
    this.life = 1; this.s0 = this.s1 = 1; this.rot = this.rotVel = 0;
    this.r0 = this.g0 = this.b0 = this.a0 = 1; this.r1 = this.g1 = this.b1 = 1; this.a1 = 0;
    this.drag = 0.02; this.grav = 0; this.cell = 0; this.orient = 0; this.additive = false; this.lit = false;
    this.stretch = 0; this.turb = 0; this.fadeIn = 0.04;
    return this;
  }
}

const _col = new THREE.Color();

class ParticleLayer {
  readonly mesh: THREE.Mesh;
  readonly material: THREE.ShaderMaterial;
  private geo: THREE.InstancedBufferGeometry;
  private arrays: Float32Array[] = [];
  private attrs: THREE.InstancedBufferAttribute[] = [];
  private cursor = 0;
  private dirtyMin = Infinity;
  private dirtyMax = -1;
  readonly cap: number;
  readonly p = new P();
  /** birth time used for the next commit() */
  time = 0;

  constructor(cap: number, atlas: THREE.Texture, uniforms: Record<string, THREE.IUniform>) {
    this.cap = cap;
    const base = new THREE.PlaneGeometry(1, 1);
    this.geo = new THREE.InstancedBufferGeometry();
    this.geo.index = base.index;
    this.geo.setAttribute('position', base.getAttribute('position'));
    this.geo.setAttribute('uv', base.getAttribute('uv'));
    for (const n of ['aA', 'aB', 'aC', 'aD', 'aE', 'aF', 'aG']) {
      const arr = new Float32Array(cap * 4);
      const attr = new THREE.InstancedBufferAttribute(arr, 4);
      attr.setUsage(THREE.DynamicDrawUsage);
      this.geo.setAttribute(n, attr);
      this.arrays.push(arr);
      this.attrs.push(attr);
    }
    const a = this.arrays[0];
    for (let i = 0; i < cap; i++) a[i * 4 + 3] = -1e9; // all slots start dead
    this.geo.instanceCount = cap;
    this.material = new THREE.ShaderMaterial({
      uniforms: { ...uniforms, uAtlas: { value: atlas } },
      vertexShader: LAYER_VS,
      fragmentShader: LAYER_FS,
      depthTest: true,
      ...PREMULT,
    });
    this.mesh = new THREE.Mesh(this.geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 20;
    this.mesh.userData.noAO = true;
    this.mesh.name = 'fx-particles';
    base.dispose();
  }

  begin(): P {
    return this.p.reset();
  }

  /** write the descriptor into the next ring slot */
  commit(): void {
    const p = this.p;
    const i = this.cursor;
    this.cursor = (i + 1) % this.cap;
    const o = i * 4;
    const A = this.arrays;
    A[0][o] = p.px; A[0][o + 1] = p.py; A[0][o + 2] = p.pz; A[0][o + 3] = this.time;
    A[1][o] = p.vx; A[1][o + 1] = p.vy; A[1][o + 2] = p.vz; A[1][o + 3] = p.life;
    A[2][o] = p.s0; A[2][o + 1] = p.s1; A[2][o + 2] = p.rot; A[2][o + 3] = p.rotVel;
    A[3][o] = p.r0; A[3][o + 1] = p.g0; A[3][o + 2] = p.b0; A[3][o + 3] = p.a0;
    A[4][o] = p.r1; A[4][o + 1] = p.g1; A[4][o + 2] = p.b1; A[4][o + 3] = p.a1;
    A[5][o] = p.drag; A[5][o + 1] = p.grav; A[5][o + 2] = p.cell;
    A[5][o + 3] = p.orient + (p.additive ? 4 : 0) + (p.lit ? 8 : 0);
    A[6][o] = p.stretch; A[6][o + 1] = Math.random(); A[6][o + 2] = p.turb; A[6][o + 3] = p.fadeIn;
    if (i < this.dirtyMin) this.dirtyMin = i;
    if (i > this.dirtyMax) this.dirtyMax = i;
  }

  /** upload everything written since the last flush */
  flush(): void {
    if (this.dirtyMax < 0) return;
    const start = this.dirtyMin * 4;
    const count = (this.dirtyMax - this.dirtyMin + 1) * 4;
    // ranges accumulate until three actually uploads them (update() may run several times per render)
    for (let ai = 0; ai < this.attrs.length; ai++) {
      const a = this.attrs[ai];
      if (a.updateRanges.length > 48) {
        a.clearUpdateRanges();
        a.addUpdateRange(0, this.cap * 4);
      } else a.addUpdateRange(start, count);
      a.needsUpdate = true;
    }
    this.dirtyMin = Infinity;
    this.dirtyMax = -1;
  }

  clear(): void {
    const a = this.arrays[0];
    for (let i = 0; i < this.cap; i++) a[i * 4 + 3] = -1e9;
    this.dirtyMin = 0;
    this.dirtyMax = this.cap - 1;
    this.cursor = 0;
  }

  dispose(): void {
    this.geo.dispose();
    this.material.dispose();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Weather
// ─────────────────────────────────────────────────────────────────────────────

interface WeatherCfg {
  count: number;
  box: [number, number, number];
  vel: [number, number, number];
  /** quad size range in metres (width for streaks) */
  size: [number, number];
  /** streak length range (0 = billboard) */
  len: [number, number];
  sway: number;
  color: [number, number, number];
  alpha: number;
  additive: number;
  cell: number;
  lit: number;
  /** 0..1 brightness pulsing */
  pulse: number;
  /** 0..1 fraction of particles that glow as embers (ash) */
  glowFrac: number;
  gust: number;
  tumble: number;
}

const WEATHER: Record<Exclude<WeatherKind, 'none'>, WeatherCfg> = {
  rain: { count: 8000, box: [38, 24, 38], vel: [-1.4, -17, -0.8], size: [0.02, 0.032], len: [0.7, 1.3], sway: 0, color: [0.72, 0.8, 0.92], alpha: 0.6, additive: 0, cell: CELL.streak, lit: 1, pulse: 0, glowFrac: 0, gust: 0.1, tumble: 0 },
  storm: { count: 13000, box: [38, 24, 38], vel: [-9, -23, -5.5], size: [0.018, 0.03], len: [1.0, 1.9], sway: 0, color: [0.72, 0.8, 0.95], alpha: 0.55, additive: 0, cell: CELL.streak, lit: 1, pulse: 0, glowFrac: 0, gust: 0.35, tumble: 0 },
  snow: { count: 10000, box: [34, 20, 34], vel: [-0.55, -1.25, -0.35], size: [0.05, 0.12], len: [0, 0], sway: 0.7, color: [0.97, 0.985, 1.0], alpha: 0.9, additive: 0, cell: CELL.snow, lit: 1, pulse: 0, glowFrac: 0, gust: 0.25, tumble: 0 },
  ash: { count: 5200, box: [36, 20, 36], vel: [-0.9, -0.55, -0.5], size: [0.05, 0.14], len: [0, 0], sway: 0.55, color: [0.16, 0.14, 0.13], alpha: 0.85, additive: 0, cell: CELL.flake, lit: 1, pulse: 0.5, glowFrac: 0.12, gust: 0.3, tumble: 1 },
  embers: { count: 1500, box: [32, 18, 32], vel: [0.35, 0.85, 0.2], size: [0.02, 0.055], len: [0, 0], sway: 0.8, color: [4.2, 1.35, 0.32], alpha: 0.95, additive: 1, cell: CELL.dot, lit: 0, pulse: 0.8, glowFrac: 0, gust: 0.3, tumble: 0 },
  spores: { count: 2200, box: [34, 14, 34], vel: [0.05, 0.035, 0.04], size: [0.035, 0.1], len: [0, 0], sway: 1.0, color: [0.55, 1.1, 0.5], alpha: 0.7, additive: 1, cell: CELL.dot, lit: 0, pulse: 0.9, glowFrac: 0, gust: 0, tumble: 0 },
  dust: { count: 1500, box: [26, 12, 26], vel: [0.04, -0.02, 0.03], size: [0.013, 0.034], len: [0, 0], sway: 0.4, color: [1.0, 0.93, 0.78], alpha: 0.7, additive: 0.55, cell: CELL.dot, lit: 1, pulse: 0.6, glowFrac: 0, gust: 0, tumble: 0 },
};

const DIST_SCALE: Record<Exclude<WeatherKind, 'none'>, number> = { rain: 0.07, storm: 0.07, snow: 0.055, ash: 0.06, embers: 0.03, spores: 0.0, dust: 0.04 };
/** low ground mist: always-on ambient layer driven by the environment preset's `mist` value */
const MIST: WeatherCfg = {
  count: 900, box: [70, 3.2, 70], vel: [0.3, 0.0, 0.14], size: [3.5, 8.5], len: [0, 0], sway: 0.7,
  color: [1, 1, 1], alpha: 0.11, additive: 0, cell: CELL.mist, lit: 0, pulse: 0, glowFrac: 0, gust: 0, tumble: 0.04,
};

const WEATHER_KINDS = Object.keys(WEATHER) as (keyof typeof WEATHER)[];

const WEATHER_VS = /* glsl */ `
  attribute vec4 aSeed;
  uniform vec3 uCam;
  uniform float uTime;
  uniform vec3 uBox;
  uniform vec3 uVel;
  uniform vec2 uSize;
  uniform vec2 uLen;
  uniform float uSway;
  uniform float uGust;
  uniform float uPulse;
  uniform float uGlowFrac;
  uniform float uTumble;
  uniform float uCell;
  uniform float uDistScale;
  varying vec2 vUv;
  varying float vAlpha;
  varying float vGlow;
  varying vec3 vWorld;
  void main() {
    vec3 s = aSeed.xyz;
    float t = uTime;
    float gust = 1.0 + uGust * sin(t * 0.37 + s.x * 3.0) * (0.6 + 0.4 * sin(t * 1.3));
    vec3 vel = uVel * (0.85 + 0.3 * aSeed.w) * vec3(gust, 1.0, gust);
    vec3 p = s * uBox + vel * t;
    p.x += sin(t * (0.5 + aSeed.w) + s.y * 40.0) * uSway;
    p.z += cos(t * (0.4 + aSeed.w * 0.8) + s.x * 40.0) * uSway;
    p.y += sin(t * (0.7 + s.z) + s.x * 20.0) * uSway * 0.3;
    vec3 rel = mod(p - uCam + uBox * 0.5, uBox) - uBox * 0.5;
    vec3 wp = uCam + rel;
    vec3 ar = abs(rel) / (uBox * 0.5);
    float edge = 1.0 - smoothstep(0.82, 1.0, max(max(ar.x, ar.y), ar.z));
    float size = mix(uSize.x, uSize.y, fract(aSeed.w * 7.31 + s.z * 3.7));
    // keep far particles readable: grow them a little with distance
    size *= 1.0 + uDistScale * length(rel);
    vec2 q = position.xy;
    vec3 world;
    if (uLen.y > 0.0) {
      vec3 dir = normalize(vel);
      vec3 toCam = normalize(cameraPosition - wp);
      vec3 side = normalize(cross(dir, toCam) + vec3(1e-5));
      float len = mix(uLen.x, uLen.y, fract(aSeed.w * 13.7 + s.y * 5.1));
      world = wp + side * q.x * size + dir * q.y * len;
    } else {
      float rot = (aSeed.z * 6.283) + uTumble * t * (1.0 + aSeed.w * 2.0);
      float c = cos(rot), sn = sin(rot);
      vec2 r = vec2(c * q.x - sn * q.y, sn * q.x + c * q.y) * size;
      vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
      vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
      world = wp + right * r.x + up * r.y;
    }
    float pulse = 1.0 - uPulse * (0.5 + 0.5 * sin(t * (2.0 + aSeed.w * 6.0) + s.x * 50.0));
    vAlpha = edge * pulse;
    vGlow = step(aSeed.w, uGlowFrac);
    vWorld = world;
    vec2 cxy = vec2(mod(uCell, 4.0), floor(uCell / 4.0));
    vec2 uv = q + 0.5;
    vUv = vec2((cxy.x + uv.x) * 0.25, (3.0 - cxy.y + uv.y) * 0.25);
    gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
  }`;

const WEATHER_FS = /* glsl */ `
  precision highp float;
  uniform sampler2D uAtlas;
  uniform vec3 uColor;
  uniform float uAlpha;
  uniform float uAdditive;
  uniform float uLit;
  uniform vec3 uTint;
  uniform float uFlash;
  uniform float uContrast;
  uniform float uGroundFade;
  uniform float uGround;
  ${FOG_FRAG}
  varying vec2 vUv;
  varying float vAlpha;
  varying float vGlow;
  varying vec3 vWorld;
  void main() {
    float d = texture2D(uAtlas, vUv).r;
    float a = d * uAlpha * vAlpha;
    if (a < 0.003) discard;
    vec3 col = uColor;
    float add = uAdditive;
    if (vGlow > 0.5) { col = vec3(4.0, 1.3, 0.3); add = 1.0; }
    else {
      col *= mix(vec3(1.0), uTint * (1.0 + uFlash * 3.0), uLit);
      // against a bright haze, streaks/flakes read as darker than the background
      float bg = dot(uFogColor, vec3(0.3333));
      float bright = smoothstep(0.18, 0.5, bg) * uContrast;
      col = mix(col, uFogColor * 0.34, bright * 0.95);
      a *= 1.0 + bright * 0.9;
    }
    float dist = length(vWorld - cameraPosition);
    float f = fogAmount(dist);
    col = mix(col, uFogColor, f * (1.0 - add));
    a *= (1.0 - f * add) * smoothstep(0.35, 2.2, dist);
    // low mist: dissolve toward the ground plane instead of cutting hard against it
    a *= mix(1.0, smoothstep(uGround + 0.05, uGround + 1.1, vWorld.y), uGroundFade);
    gl_FragColor = vec4(col * a, a * (1.0 - add));
  }`;

const SPLASH_VS = /* glsl */ `
  attribute vec4 aSeed;
  uniform vec3 uCam;
  uniform float uTime;
  uniform float uGround;
  uniform float uRadius;
  uniform float uRate;
  varying vec2 vUv;
  varying float vAlpha;
  varying vec3 vWorld;
  void main() {
    vec2 xz = uCam.xz + (aSeed.xy - 0.5) * 2.0 * uRadius;
    float ph = fract(uTime * uRate * (0.7 + 0.6 * aSeed.w) + aSeed.z);
    float size = 0.04 + ph * 0.32;
    vec3 c = vec3(xz.x, uGround + 0.025, xz.y);
    vec3 world = c + vec3(position.x * size, 0.0, position.y * size);
    float distFade = 1.0 - smoothstep(0.6, 1.0, length((aSeed.xy - 0.5) * 2.0));
    vAlpha = (1.0 - ph) * (1.0 - ph) * distFade;
    vWorld = world;
    vec2 uv = position.xy + 0.5;
    vUv = vec2((1.0 + uv.x) * 0.25, (3.0 - 2.0 + uv.y) * 0.25);
    gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
  }`;

const SPLASH_FS = /* glsl */ `
  precision highp float;
  uniform sampler2D uAtlas;
  uniform vec3 uTint;
  uniform float uAlpha;
  ${FOG_FRAG}
  varying vec2 vUv;
  varying float vAlpha;
  varying vec3 vWorld;
  void main() {
    float d = texture2D(uAtlas, vUv).r;
    float a = d * vAlpha * uAlpha;
    if (a < 0.004) discard;
    float f = fogAmount(length(vWorld - cameraPosition));
    vec3 col = mix(uTint * vec3(0.9, 0.95, 1.05) * 1.3, uFogColor, f);
    gl_FragColor = vec4(col * a, a);
  }`;

class WeatherLayer {
  readonly mesh: THREE.Mesh;
  readonly material: THREE.ShaderMaterial;
  private geo: THREE.InstancedBufferGeometry;
  readonly cfg: WeatherCfg;
  cur = 0;
  target = 0;
  constructor(
    readonly kind: string,
    cfg: WeatherCfg,
    atlas: THREE.Texture,
    shared: Record<string, THREE.IUniform>,
    distScale: number,
    contrast: number,
    overrides: Record<string, THREE.IUniform> = {},
  ) {
    this.cfg = cfg;
    const base = new THREE.PlaneGeometry(1, 1);
    this.geo = new THREE.InstancedBufferGeometry();
    this.geo.index = base.index;
    this.geo.setAttribute('position', base.getAttribute('position'));
    this.geo.setAttribute('uv', base.getAttribute('uv'));
    const seeds = new Float32Array(cfg.count * 4);
    let a = (kind.length * 7919 + 13) >>> 0;
    const rnd = () => ((a = (a * 1664525 + 1013904223) >>> 0) / 4294967296);
    for (let i = 0; i < seeds.length; i++) seeds[i] = rnd();
    this.geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 4));
    this.geo.instanceCount = 0;
    const color = new THREE.Color();
    color.setRGB(cfg.color[0], cfg.color[1], cfg.color[2], THREE.LinearSRGBColorSpace);
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        ...shared,
        uAtlas: { value: atlas },
        uBox: { value: new THREE.Vector3(...cfg.box) },
        uVel: { value: new THREE.Vector3(...cfg.vel) },
        uSize: { value: new THREE.Vector2(cfg.size[0], cfg.size[1]) },
        uLen: { value: new THREE.Vector2(cfg.len[0], cfg.len[1]) },
        uSway: { value: cfg.sway },
        uGust: { value: cfg.gust },
        uPulse: { value: cfg.pulse },
        uGlowFrac: { value: cfg.glowFrac },
        uTumble: { value: cfg.tumble },
        uCell: { value: cfg.cell },
        uDistScale: { value: distScale },
        uColor: { value: color },
        uAlpha: { value: cfg.alpha },
        uAdditive: { value: cfg.additive },
        uLit: { value: cfg.lit },
        uContrast: { value: contrast },
        uGroundFade: { value: kind === 'mist' ? 1 : 0 },
        ...overrides,
      },
      vertexShader: WEATHER_VS,
      fragmentShader: WEATHER_FS,
      ...PREMULT,
    });
    this.mesh = new THREE.Mesh(this.geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 21;
    this.mesh.visible = false;
    this.mesh.userData.noAO = true;
    this.mesh.name = `fx-weather-${kind}`;
    base.dispose();
  }
  setCount(n: number): void {
    this.geo.instanceCount = n;
  }
  dispose(): void {
    this.geo.dispose();
    this.material.dispose();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Ground decals (blood)
// ─────────────────────────────────────────────────────────────────────────────

const DECAL_VS = /* glsl */ `
  attribute vec4 aPos;   // x, y, z, birth
  attribute vec4 aShape; // size, rotation, life, cell
  attribute vec4 aCol;   // rgb, alpha
  uniform float uTime;
  varying vec2 vUv;
  varying vec4 vCol;
  varying vec3 vWorld;
  void main() {
    float age = uTime - aPos.w;
    if (age < 0.0 || age > aShape.z) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
    float u = age / aShape.z;
    float grow = 0.55 + 0.45 * smoothstep(0.0, 0.18, age);
    float c = cos(aShape.y), s = sin(aShape.y);
    vec2 q = position.xy * aShape.x * grow;
    vec3 world = aPos.xyz + vec3(c * q.x - s * q.y, 0.0, s * q.x + c * q.y);
    float cell = aShape.w;
    vec2 cxy = vec2(mod(cell, 4.0), floor(cell / 4.0));
    vec2 uv = position.xy + 0.5;
    vUv = vec2((cxy.x + uv.x) * 0.25, (3.0 - cxy.y + uv.y) * 0.25);
    float fade = 1.0 - smoothstep(0.55, 1.0, u);
    vCol = vec4(aCol.rgb, aCol.a * fade * smoothstep(0.0, 0.05, age));
    vWorld = world;
    gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
  }`;

const DECAL_FS = /* glsl */ `
  precision highp float;
  uniform sampler2D uAtlas;
  uniform vec3 uAmbient;
  ${FOG_FRAG}
  varying vec2 vUv;
  varying vec4 vCol;
  varying vec3 vWorld;
  void main() {
    float d = texture2D(uAtlas, vUv).r;
    float a = d * vCol.a;
    if (a < 0.01) discard;
    float f = fogAmount(length(vWorld - cameraPosition));
    vec3 col = vCol.rgb * (0.35 + 0.9 * uAmbient) * (0.8 + 0.4 * d);
    col = mix(col, uFogColor, f);
    gl_FragColor = vec4(col * a, a);
  }`;

class DecalLayer {
  readonly mesh: THREE.Mesh;
  private geo: THREE.InstancedBufferGeometry;
  readonly material: THREE.ShaderMaterial;
  private aPos: Float32Array;
  private aShape: Float32Array;
  private aCol: Float32Array;
  private attrs: THREE.InstancedBufferAttribute[] = [];
  private cursor = 0;
  private dirty = false;
  /** active ring size (<= cap); follows the quality preset */
  limit: number;
  constructor(readonly cap: number, atlas: THREE.Texture, shared: Record<string, THREE.IUniform>) {
    this.limit = cap;
    const base = new THREE.PlaneGeometry(1, 1);
    this.geo = new THREE.InstancedBufferGeometry();
    this.geo.index = base.index;
    this.geo.setAttribute('position', base.getAttribute('position'));
    this.geo.setAttribute('uv', base.getAttribute('uv'));
    this.aPos = new Float32Array(cap * 4);
    this.aShape = new Float32Array(cap * 4);
    this.aCol = new Float32Array(cap * 4);
    for (let i = 0; i < cap; i++) this.aPos[i * 4 + 3] = -1e9;
    const defs: [string, Float32Array][] = [['aPos', this.aPos], ['aShape', this.aShape], ['aCol', this.aCol]];
    for (const [n, arr] of defs) {
      const at = new THREE.InstancedBufferAttribute(arr, 4);
      at.setUsage(THREE.DynamicDrawUsage);
      this.geo.setAttribute(n, at);
      this.attrs.push(at);
    }
    this.geo.instanceCount = cap;
    this.material = new THREE.ShaderMaterial({
      uniforms: { ...shared, uAtlas: { value: atlas } },
      vertexShader: DECAL_VS,
      fragmentShader: DECAL_FS,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
      ...PREMULT,
    });
    this.mesh = new THREE.Mesh(this.geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
    this.mesh.userData.noAO = true;
    this.mesh.name = 'fx-decals';
    base.dispose();
  }
  add(x: number, y: number, z: number, birth: number, size: number, rot: number, life: number, cell: number, r: number, g: number, b: number, a: number): void {
    if (this.cursor >= this.limit) this.cursor = 0;
    const i = this.cursor;
    this.cursor = i + 1;
    const o = i * 4;
    this.aPos[o] = x; this.aPos[o + 1] = y + (i % 7) * 0.0012; this.aPos[o + 2] = z; this.aPos[o + 3] = birth;
    this.aShape[o] = size; this.aShape[o + 1] = rot; this.aShape[o + 2] = life; this.aShape[o + 3] = cell;
    this.aCol[o] = r; this.aCol[o + 1] = g; this.aCol[o + 2] = b; this.aCol[o + 3] = a;
    this.dirty = true;
  }
  flush(): void {
    if (!this.dirty) return;
    for (let ai = 0; ai < this.attrs.length; ai++) this.attrs[ai].needsUpdate = true;
    this.dirty = false;
  }
  clear(): void {
    for (let i = 0; i < this.cap; i++) this.aPos[i * 4 + 3] = -1e9;
    this.cursor = 0;
    this.dirty = true;
  }
  dispose(): void {
    this.geo.dispose();
    this.material.dispose();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Trails (camera-facing ribbons, one draw call for all)
// ─────────────────────────────────────────────────────────────────────────────

const TRAIL_POINTS = 28;
const TRAIL_SLOTS = 16;
/** half-width of a trail ribbon at the arrow (m): the visible streak is about 4 cm across */
const TRAIL_HALF_WIDTH = 0.02;
/** ...but never thinner than about a pixel and a half on screen (half-width per metre of distance) */
const TRAIL_MIN_PX = 0.0018;
/** a point lives this long (game seconds; slow-mo stretches it in real time) */
const TRAIL_LIFE = 0.32;
/** the streak never gets longer than this behind the arrow (m), whatever the speed */
const TRAIL_MAX_LEN = 5.5;

class TrailSlot {
  active = false;
  stopping = false;
  obj: THREE.Object3D | null = null;
  readonly pos = new Float32Array(TRAIL_POINTS * 3);
  readonly t = new Float32Array(TRAIL_POINTS);
  head = 0;
  count = 0;
  color = new THREE.Color(1, 1, 1);
  width = TRAIL_HALF_WIDTH;
  handle: TrailHandle | null = null;
  hasGeometry = false;
}

class TrailHandle implements FxHandle {
  readonly position = new THREE.Vector3();
  constructor(private slot: TrailSlot) {}
  setIntensity(v: number): void {
    this.slot.width = TRAIL_HALF_WIDTH * Math.max(0, v);
  }
  stop(): void {
    this.slot.stopping = true;
    this.slot.obj = null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Emitters (fire, smoke, torch, one-shot flashes)
// ─────────────────────────────────────────────────────────────────────────────

type EmitterKind = 'fire' | 'smoke' | 'torch' | 'flash';

class Emitter implements FxHandle {
  readonly position = new THREE.Vector3();
  kind: EmitterKind = 'fire';
  scale = 1;
  intensity = 1;
  /** fades 1 -> 0 after stop() */
  alive = 1;
  stopped = false;
  obj: THREE.Object3D | null = null;
  readonly offset = new THREE.Vector3();
  accFlame = 0;
  accSmoke = 0;
  accEmber = 0;
  accCore = 0;
  light: THREE.PointLight | null = null;
  releasing = false;
  pick = -1;
  lightBase = 20;
  lightDist = 12;
  lightColor = 0xff8a3a;
  flickerSeed = Math.random() * 100;
  /** one-shot flash: remaining seconds (0 = persistent) */
  ttl = 0;
  ttl0 = 0;
  distSq = 0;
  used = false;
  setIntensity(v: number): void {
    this.intensity = Math.max(0, v);
  }
  stop(): void {
    this.stopped = true;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Debris (CPU simulated, instanced)
// ─────────────────────────────────────────────────────────────────────────────

class DebrisPool {
  readonly mesh: THREE.InstancedMesh;
  private geo: THREE.BufferGeometry;
  private mat: THREE.MeshStandardMaterial;
  readonly cap: number;
  private px: Float32Array; private py: Float32Array; private pz: Float32Array;
  private vx: Float32Array; private vy: Float32Array; private vz: Float32Array;
  private wx: Float32Array; private wy: Float32Array; private wz: Float32Array;
  private qx: Float32Array; private qy: Float32Array; private qz: Float32Array; private qw: Float32Array;
  private sx: Float32Array; private sy: Float32Array; private sz: Float32Array;
  private age: Float32Array; private life: Float32Array; private floorY: Float32Array;
  private state: Uint8Array; // 0 dead/parked, 1 flying, 2 resting
  private cursor = 0;
  private hi = 0;
  limit: number;
  private _q = new THREE.Quaternion();
  private _dq = new THREE.Quaternion();
  private _e = new THREE.Euler();
  private _axis = new THREE.Vector3();
  private _pos = new THREE.Vector3();
  private _scl = new THREE.Vector3();
  private _m = new THREE.Matrix4();
  private _c = new THREE.Color();

  constructor(cap: number) {
    this.cap = cap;
    this.limit = cap;
    const g = new THREE.IcosahedronGeometry(0.5, 1);
    const pos = g.getAttribute('position');
    const n = noise2(5);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      const k = 1 + 0.28 * n(x * 3.1 + z, y * 3.3 - z);
      pos.setXYZ(i, x * k, y * k, z * k);
    }
    g.computeVertexNormals();
    this.geo = g;
    this.mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92, metalness: 0.0 });
    this.mesh = new THREE.InstancedMesh(this.geo, this.mat, cap);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    this.mesh.name = 'fx-debris';
    this.mesh.count = 0;
    const f = () => new Float32Array(cap);
    this.px = f(); this.py = f(); this.pz = f();
    this.vx = f(); this.vy = f(); this.vz = f();
    this.wx = f(); this.wy = f(); this.wz = f();
    this.qx = f(); this.qy = f(); this.qz = f(); this.qw = f();
    this.sx = f(); this.sy = f(); this.sz = f();
    this.age = f(); this.life = f(); this.floorY = f();
    this.state = new Uint8Array(cap);
    this.mesh.setColorAt(0, this._c.set(0x777777));
  }

  spawn(x: number, y: number, z: number, vx: number, vy: number, vz: number, size: number, color: number, floorY: number): void {
    if (this.cursor >= this.limit) this.cursor = 0;
    const i = this.cursor;
    this.cursor = i + 1;
    this.px[i] = x; this.py[i] = y; this.pz[i] = z;
    this.vx[i] = vx; this.vy[i] = vy; this.vz[i] = vz;
    this.wx[i] = (Math.random() - 0.5) * 14; this.wy[i] = (Math.random() - 0.5) * 14; this.wz[i] = (Math.random() - 0.5) * 14;
    this._e.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
    this._q.setFromEuler(this._e);
    this.qx[i] = this._q.x; this.qy[i] = this._q.y; this.qz[i] = this._q.z; this.qw[i] = this._q.w;
    this.sx[i] = size * (0.6 + Math.random() * 0.8);
    this.sy[i] = size * (0.5 + Math.random() * 0.7);
    this.sz[i] = size * (0.6 + Math.random() * 0.8);
    this.age[i] = 0;
    this.life[i] = 3.5 + Math.random() * 3;
    this.floorY[i] = floorY;
    this.state[i] = 1;
    this._c.set(color).multiplyScalar(0.75 + Math.random() * 0.5);
    this.mesh.setColorAt(i, this._c);
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    if (i + 1 > this.hi) this.hi = i + 1;
    this.mesh.count = this.hi;
  }

  update(dt: number): void {
    const n = this.hi;
    if (n === 0) return;
    const m = this.mesh;
    const g = 22;
    let touched = false;
    for (let i = 0; i < n; i++) {
      const st = this.state[i];
      if (st === 0) continue;
      this.age[i] += dt;
      touched = true;
      if (this.age[i] > this.life[i]) {
        this.state[i] = 0;
        this._scl.set(0, 0, 0);
        this._pos.set(0, -1000, 0);
        this._q.identity();
        this._m.compose(this._pos, this._q, this._scl);
        m.setMatrixAt(i, this._m);
        continue;
      }
      if (st === 1) {
        this.vy[i] -= g * dt;
        this.px[i] += this.vx[i] * dt;
        this.py[i] += this.vy[i] * dt;
        this.pz[i] += this.vz[i] * dt;
        const r = Math.max(this.sx[i], this.sy[i], this.sz[i]) * 0.4;
        if (this.py[i] - r < this.floorY[i]) {
          this.py[i] = this.floorY[i] + r;
          if (Math.abs(this.vy[i]) > 1.4) {
            this.vy[i] = -this.vy[i] * 0.38;
            this.vx[i] *= 0.72; this.vz[i] *= 0.72;
            this.wx[i] *= 0.6; this.wy[i] *= 0.6; this.wz[i] *= 0.6;
          } else {
            this.vy[i] = 0;
            this.vx[i] *= 0.82; this.vz[i] *= 0.82;
            this.wx[i] *= 0.8; this.wy[i] *= 0.8; this.wz[i] *= 0.8;
            if (Math.hypot(this.vx[i], this.vz[i]) < 0.15) this.state[i] = 2;
          }
        }
        const wl = Math.hypot(this.wx[i], this.wy[i], this.wz[i]);
        this._q.set(this.qx[i], this.qy[i], this.qz[i], this.qw[i]);
        if (wl > 1e-4) {
          this._axis.set(this.wx[i] / wl, this.wy[i] / wl, this.wz[i] / wl);
          this._dq.setFromAxisAngle(this._axis, wl * dt);
          this._q.premultiply(this._dq);
        }
        this.qx[i] = this._q.x; this.qy[i] = this._q.y; this.qz[i] = this._q.z; this.qw[i] = this._q.w;
      } else {
        this._q.set(this.qx[i], this.qy[i], this.qz[i], this.qw[i]);
        // resting chunks only need a matrix refresh while they shrink away at the end of their life
        if (this.life[i] - this.age[i] > 0.6) continue;
      }
      const remaining = this.life[i] - this.age[i];
      const shrink = remaining < 0.6 ? Math.max(0, remaining / 0.6) : 1;
      this._pos.set(this.px[i], this.py[i], this.pz[i]);
      this._scl.set(this.sx[i] * shrink, this.sy[i] * shrink, this.sz[i] * shrink);
      this._m.compose(this._pos, this._q, this._scl);
      m.setMatrixAt(i, this._m);
    }
    if (touched) m.instanceMatrix.needsUpdate = true;
  }

  clear(): void {
    this.state.fill(0);
    this.mesh.count = 0;
    this.hi = 0;
    this.cursor = 0;
  }

  dispose(): void {
    this.mesh.dispose();
    this.geo.dispose();
    this.mat.dispose();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// createFx
// ─────────────────────────────────────────────────────────────────────────────

const BLOOD: Record<BloodKind, { c: [number, number, number]; glow: number }> = {
  red: { c: [0.34, 0.012, 0.012], glow: 1 },
  dark: { c: [0.12, 0.006, 0.008], glow: 1 },
  black: { c: [0.018, 0.02, 0.026], glow: 1 },
  ichor: { c: [0.30, 0.34, 0.035], glow: 2.6 },
};

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _camPos = new THREE.Vector3();

export function createFx(engine: Engine): Fx & FxExtras {
  const internals = getEngineInternals(engine);
  const scene = engine.scene;
  const root = new THREE.Group();
  root.name = 'fx-root';
  scene.add(root);

  const atlas = buildAtlas();
  let time = 0;

  // uniforms shared by every FX material (the same IUniform objects are referenced everywhere)
  const fogColor = new THREE.Color(0x888888);
  const lightVecs = [new THREE.Vector4(0, -9999, 0, 0), new THREE.Vector4(0, -9999, 0, 0), new THREE.Vector4(0, -9999, 0, 0), new THREE.Vector4(0, -9999, 0, 0)];
  const U: Record<string, THREE.IUniform> = {
    uTime: { value: 0 },
    uFogColor: { value: fogColor },
    uFogDensity: { value: 0.01 },
    uAmbient: { value: new THREE.Color(0.3, 0.3, 0.3) },
    uLights: { value: lightVecs },
    uCam: { value: new THREE.Vector3() },
    uTint: { value: new THREE.Color(0.5, 0.5, 0.5) },
    uFlash: { value: 0 },
    uGround: { value: 0 },
  };

  const layer = new ParticleLayer(9000, atlas, U);
  root.add(layer.mesh);

  const decals = new DecalLayer(160, atlas, U);
  root.add(decals.mesh);

  const debris = new DebrisPool(320);
  root.add(debris.mesh);

  // weather
  const weather: Partial<Record<Exclude<WeatherKind, 'none'>, WeatherLayer>> = {};
  const mistCam = new THREE.Vector3();
  const mist = new WeatherLayer('mist', MIST, atlas, U, 0.01, 0, { uCam: { value: mistCam } });
  root.add(mist.mesh);
  const SPLASH_COUNT = 1100;
  const splashGeo = new THREE.InstancedBufferGeometry();
  {
    const arr = new Float32Array(SPLASH_COUNT * 4);
    let a = 4242;
    for (let i = 0; i < arr.length; i++) arr[i] = ((a = (a * 1664525 + 1013904223) >>> 0) / 4294967296);
    const base = new THREE.PlaneGeometry(1, 1);
    splashGeo.index = base.index;
    splashGeo.setAttribute('position', base.getAttribute('position'));
    splashGeo.setAttribute('uv', base.getAttribute('uv'));
    splashGeo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(arr, 4));
    splashGeo.instanceCount = 0;
    base.dispose();
  }
  const splashMat = new THREE.ShaderMaterial({
    uniforms: { ...U, uAtlas: { value: atlas }, uRadius: { value: 16 }, uRate: { value: 1.5 }, uAlpha: { value: 0.55 } },
    vertexShader: SPLASH_VS,
    fragmentShader: SPLASH_FS,
    ...PREMULT,
  });
  const splashMesh = new THREE.Mesh(splashGeo, splashMat);
  splashMesh.frustumCulled = false;
  splashMesh.renderOrder = 6;
  splashMesh.visible = false;
  splashMesh.userData.noAO = true;
  root.add(splashMesh);

  // trails
  const trailSlots: TrailSlot[] = [];
  for (let i = 0; i < TRAIL_SLOTS; i++) trailSlots.push(new TrailSlot());
  /** scratch: distance from the head of each sample of the slot being built */
  const trailDist = new Float32Array(TRAIL_POINTS);
  const trailVerts = TRAIL_SLOTS * TRAIL_POINTS * 2;
  const trailPos = new Float32Array(trailVerts * 3);
  const trailCol = new Float32Array(trailVerts * 4);
  // -1 / +1 across the ribbon: the fragment shader turns it into a soft core profile
  const trailSide = new Float32Array(trailVerts);
  for (let v = 0; v < trailVerts; v++) trailSide[v] = v % 2 === 0 ? -1 : 1;
  const trailIdx: number[] = [];
  for (let s = 0; s < TRAIL_SLOTS; s++) {
    for (let p = 0; p < TRAIL_POINTS - 1; p++) {
      const a = (s * TRAIL_POINTS + p) * 2;
      trailIdx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const trailGeo = new THREE.BufferGeometry();
  const trailPosAttr = new THREE.BufferAttribute(trailPos, 3);
  const trailColAttr = new THREE.BufferAttribute(trailCol, 4);
  trailPosAttr.setUsage(THREE.DynamicDrawUsage);
  trailColAttr.setUsage(THREE.DynamicDrawUsage);
  trailGeo.setAttribute('position', trailPosAttr);
  trailGeo.setAttribute('aColor', trailColAttr);
  trailGeo.setAttribute('aSide', new THREE.BufferAttribute(trailSide, 1));
  trailGeo.setIndex(trailIdx);
  const trailMat = new THREE.ShaderMaterial({
    vertexShader: /* glsl */ `
      attribute vec4 aColor;
      attribute float aSide;
      varying vec4 vCol;
      varying vec3 vW;
      varying float vSide;
      void main() { vCol = aColor; vW = position; vSide = aSide; gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      precision highp float;
      uniform vec3 uFogColor; uniform float uFogDensity;
      varying vec4 vCol; varying vec3 vW; varying float vSide;
      void main() {
        float d = length(vW - cameraPosition);
        float f = 1.0 - exp(-uFogDensity * uFogDensity * d * d);
        // soft round profile across the ribbon: a bright core that falls off to nothing at the edges
        float prof = 1.0 - vSide * vSide;
        prof *= prof * (2.0 - prof);
        // never let the streak smear across the lens when it starts right by the camera
        float nearFade = smoothstep(0.7, 2.4, d);
        float a = vCol.a * (1.0 - f) * prof * nearFade;
        gl_FragColor = vec4(vCol.rgb * a, 0.0);
      }`,
    uniforms: { uFogColor: U.uFogColor, uFogDensity: U.uFogDensity },
    ...PREMULT,
  });
  const trailMesh = new THREE.Mesh(trailGeo, trailMat);
  trailMesh.frustumCulled = false;
  trailMesh.renderOrder = 22;
  trailMesh.userData.noAO = true;
  trailMesh.visible = false;
  root.add(trailMesh);

  // emitters + lights
  const emitters: Emitter[] = [];
  const lightPool: THREE.PointLight[] = [];
  const lightOwner: (Emitter | null)[] = [];
  let frameId = 0;

  // lightning
  const bolt = new THREE.Group();
  bolt.visible = false;
  bolt.userData.noAO = true;
  root.add(bolt);
  const boltMat = new THREE.LineBasicMaterial({ color: new THREE.Color(7, 8.5, 12), transparent: true, depthWrite: false, fog: false });
  const boltGeos: THREE.BufferGeometry[] = [];
  let lightningT = -1;
  let lightningSeq: number[] = [];
  const lightningStep = 0.045;
  const lightningDir = new THREE.Vector3(0, 0.3, 1);
  let flash = 0;

  let groundFn: ((x: number, z: number) => number) | null = null;
  const stats = { liveEmitters: 0, lights: 0, weather: 'none' as WeatherKind };

  const mul = () => internals?.config.particleMul ?? 1;
  const groundAt = (x: number, z: number): number => (groundFn ? groundFn(x, z) : engine.shadowFocus.y);

  const rnd = Math.random;
  const rr = (a: number, b: number) => a + (b - a) * Math.random();
  const setC0 = (p: P, hex: number, a: number, m = 1) => {
    _col.setHex(hex);
    p.r0 = _col.r * m; p.g0 = _col.g * m; p.b0 = _col.b * m; p.a0 = a;
  };
  const setC1 = (p: P, hex: number, a: number, m = 1) => {
    _col.setHex(hex);
    p.r1 = _col.r * m; p.g1 = _col.g * m; p.b1 = _col.b * m; p.a1 = a;
  };

  // ── one-shot effects ────────────────────────────────────────────────────

  function bloodFx(pos: THREE.Vector3, dir: THREE.Vector3, kind: BloodKind, amount = 1): void {
    const k = BLOOD[kind];
    const m = mul();
    const n = Math.min(48, Math.max(3, Math.round(20 * amount * m)));
    const ground = groundAt(pos.x, pos.z);
    const h = Math.max(0.05, pos.y - ground);
    layer.time = time;
    const dl = Math.hypot(dir.x, dir.y, dir.z) || 1;
    const dx = dir.x / dl, dy = dir.y / dl, dz = dir.z / dl;
    let decalBudget = Math.max(2, Math.round(4 * amount * Math.min(1.2, m)));
    // the main pool where the victim stands
    {
      const tf = Math.sqrt((2 * h) / 9.81);
      const gx = pos.x + dx * 0.35, gz = pos.z + dz * 0.35;
      decals.add(gx, groundAt(gx, gz) + 0.014, gz, time + tf, rr(0.6, 1.0) * (0.55 + 0.45 * amount), rnd() * 6.28, rr(26, 40), rnd() < 0.5 ? CELL.splat0 : CELL.splat1, k.c[0], k.c[1], k.c[2], 0.95);
    }
    for (let i = 0; i < n; i++) {
      const p = layer.begin();
      p.px = pos.x; p.py = pos.y; p.pz = pos.z;
      const sp = rr(2.2, 8.5) * (0.6 + 0.4 * amount);
      p.vx = dx * sp + (rnd() - 0.5) * 3.2;
      p.vy = dy * sp + rr(0.4, 3.2);
      p.vz = dz * sp + (rnd() - 0.5) * 3.2;
      p.grav = 1; p.drag = 0.15;
      const g = 9.81;
      const tl = (p.vy + Math.sqrt(p.vy * p.vy + 2 * g * h)) / g; // time to reach the ground (drag ignored)
      p.life = Math.min(rr(0.5, 1.1), tl);
      p.s0 = rr(0.05, 0.1); p.s1 = p.s0 * 0.7;
      p.cell = CELL.drop; p.orient = 1; p.stretch = 0.05; p.lit = true;
      p.r0 = k.c[0] * 1.2 * k.glow; p.g0 = k.c[1] * 1.2 * k.glow; p.b0 = k.c[2] * 1.2 * k.glow; p.a0 = 0.95;
      p.r1 = k.c[0] * k.glow; p.g1 = k.c[1] * k.glow; p.b1 = k.c[2] * k.glow; p.a1 = 0.9;
      if (k.glow > 1) p.lit = false;
      p.fadeIn = 0.01;
      layer.commit();
      if (decalBudget > 0 && tl < 1.4 && rnd() < 0.45) {
        decalBudget--;
        const lx = pos.x + p.vx * tl * 0.93, lz = pos.z + p.vz * tl * 0.93;
        const gy = groundAt(lx, lz) + 0.014;
        const size = rr(0.3, 0.8) * (0.7 + 0.3 * amount);
        decals.add(lx, gy, lz, time + tl, size, rnd() * 6.28, rr(22, 38), rnd() < 0.5 ? CELL.splat0 : CELL.splat1, k.c[0], k.c[1], k.c[2], 0.92);
      }
    }
    // mist puff at the wound
    const nm = Math.max(1, Math.round(3 * m));
    for (let i = 0; i < nm; i++) {
      const p = layer.begin();
      p.px = pos.x; p.py = pos.y; p.pz = pos.z;
      p.vx = dx * 1.2 + (rnd() - 0.5) * 0.8; p.vy = dy * 1.2 + rnd() * 0.6; p.vz = dz * 1.2 + (rnd() - 0.5) * 0.8;
      p.life = rr(0.25, 0.45); p.s0 = 0.08; p.s1 = rr(0.3, 0.5);
      p.cell = CELL.puff0 + (i % 3); p.drag = 3; p.lit = true;
      p.r0 = k.c[0]; p.g0 = k.c[1]; p.b0 = k.c[2]; p.a0 = 0.5;
      p.r1 = k.c[0]; p.g1 = k.c[1]; p.b1 = k.c[2]; p.a1 = 0;
      p.rot = rnd() * 6; p.fadeIn = 0.01;
      layer.commit();
    }
  }

  function sparksFx(pos: THREE.Vector3, normal: THREE.Vector3, amount = 1): void {
    const m = mul();
    const n = Math.min(40, Math.max(3, Math.round(14 * amount * m)));
    layer.time = time;
    const nl = Math.hypot(normal.x, normal.y, normal.z) || 1;
    const nx = normal.x / nl, ny = normal.y / nl, nz = normal.z / nl;
    for (let i = 0; i < n; i++) {
      const p = layer.begin();
      p.px = pos.x; p.py = pos.y; p.pz = pos.z;
      const sp = rr(3, 11);
      p.vx = nx * sp * 0.8 + (rnd() - 0.5) * 8;
      p.vy = ny * sp * 0.8 + (rnd() - 0.2) * 6;
      p.vz = nz * sp * 0.8 + (rnd() - 0.5) * 8;
      p.grav = 1.1; p.drag = 0.4;
      p.life = rr(0.25, 0.7);
      p.s0 = rr(0.04, 0.08); p.s1 = 0.02;
      p.cell = CELL.spark; p.orient = 1; p.additive = true; p.stretch = 0.05;
      p.r0 = 9; p.g0 = 5.2; p.b0 = 1.8; p.a0 = 1;
      p.r1 = 2.6; p.g1 = 0.5; p.b1 = 0.08; p.a1 = 0.4;
      p.fadeIn = 0.005;
      layer.commit();
    }
    const p = layer.begin();
    p.px = pos.x + nx * 0.05; p.py = pos.y + ny * 0.05; p.pz = pos.z + nz * 0.05;
    p.life = 0.07; p.s0 = 0.28; p.s1 = 0.12; p.cell = CELL.dot; p.additive = true;
    p.r0 = 9; p.g0 = 6; p.b0 = 2.5; p.a0 = 1; p.r1 = 3; p.g1 = 1.5; p.b1 = 0.5; p.a1 = 0;
    p.fadeIn = 0.003;
    layer.commit();
  }

  function dustFx(pos: THREE.Vector3, amount = 1, color = 0x8a7a60): void {
    const m = mul();
    const n = Math.min(24, Math.max(2, Math.round(7 * amount * m)));
    layer.time = time;
    for (let i = 0; i < n; i++) {
      const p = layer.begin();
      const a = rnd() * 6.283;
      const sp = rr(0.4, 1.7);
      p.px = pos.x + Math.cos(a) * 0.15; p.py = pos.y; p.pz = pos.z + Math.sin(a) * 0.15;
      p.vx = Math.cos(a) * sp; p.vy = rr(0.2, 1.0); p.vz = Math.sin(a) * sp;
      p.drag = 1.6; p.life = rr(1.0, 2.0);
      p.s0 = rr(0.25, 0.4); p.s1 = rr(0.9, 1.5) * (0.7 + 0.3 * amount);
      p.cell = CELL.puff0 + (i % 3); p.lit = true; p.turb = 0.15;
      p.rot = rnd() * 6.28; p.rotVel = (rnd() - 0.5) * 0.6;
      setC0(p, color, 0.38); setC1(p, color, 0);
      p.fadeIn = 0.06;
      layer.commit();
    }
  }

  function splashFx(pos: THREE.Vector3, amount = 1): void {
    const m = mul();
    const n = Math.min(40, Math.max(4, Math.round(16 * amount * m)));
    layer.time = time;
    for (let i = 0; i < n; i++) {
      const p = layer.begin();
      const a = rnd() * 6.283;
      const sp = rr(0.6, 2.4);
      p.px = pos.x; p.py = pos.y; p.pz = pos.z;
      p.vx = Math.cos(a) * sp; p.vy = rr(2.5, 5.5) * (0.7 + 0.3 * amount); p.vz = Math.sin(a) * sp;
      p.grav = 1; p.drag = 0.2; p.life = rr(0.5, 0.95);
      p.s0 = rr(0.04, 0.085); p.s1 = p.s0 * 0.6; p.cell = CELL.drop; p.orient = 1; p.stretch = 0.04; p.lit = true;
      p.r0 = 0.9; p.g0 = 0.96; p.b0 = 1.0; p.a0 = 0.85; p.r1 = 0.8; p.g1 = 0.9; p.b1 = 1.0; p.a1 = 0.5;
      p.fadeIn = 0.01;
      layer.commit();
    }
    for (let r = 0; r < 2; r++) {
      const p = layer.begin();
      p.px = pos.x; p.py = pos.y + 0.03; p.pz = pos.z;
      p.life = 0.55 + r * 0.2; p.s0 = 0.15; p.s1 = (1.1 + r * 0.6) * (0.7 + 0.3 * amount);
      p.cell = CELL.ring; p.orient = 2; p.lit = true; p.rot = rnd() * 6;
      p.r0 = 0.95; p.g0 = 1; p.b0 = 1; p.a0 = 0.65; p.r1 = 0.9; p.g1 = 0.97; p.b1 = 1; p.a1 = 0;
      p.fadeIn = 0.01;
      layer.commit();
    }
    const nm = Math.max(2, Math.round(5 * m));
    for (let i = 0; i < nm; i++) {
      const p = layer.begin();
      p.px = pos.x + (rnd() - 0.5) * 0.4; p.py = pos.y + 0.1; p.pz = pos.z + (rnd() - 0.5) * 0.4;
      p.vy = rr(0.3, 0.9); p.vx = (rnd() - 0.5) * 0.6; p.vz = (rnd() - 0.5) * 0.6;
      p.drag = 1.2; p.life = rr(0.8, 1.4); p.s0 = 0.3; p.s1 = rr(0.9, 1.4);
      p.cell = CELL.mist; p.lit = true; p.rot = rnd() * 6;
      p.r0 = 0.9; p.g0 = 0.95; p.b0 = 1; p.a0 = 0.35; p.r1 = 0.9; p.g1 = 0.95; p.b1 = 1; p.a1 = 0;
      p.fadeIn = 0.05;
      layer.commit();
    }
  }

  function debrisFx(pos: THREE.Vector3, amount = 1, color = 0x7d776e): void {
    const m = mul();
    const n = Math.min(40, Math.max(3, Math.round(9 * amount * m)));
    const floor = groundAt(pos.x, pos.z);
    for (let i = 0; i < n; i++) {
      const a = rnd() * 6.283;
      const sp = rr(1.5, 6.5);
      debris.spawn(pos.x, pos.y, pos.z, Math.cos(a) * sp, rr(3, 9), Math.sin(a) * sp, rr(0.07, 0.22), color, floor);
    }
    dustFx(pos, amount * 0.7, color);
  }

  function explosionFx(pos: THREE.Vector3, scale = 1): void {
    const m = mul();
    layer.time = time;
    const S = scale;
    {
      const p = layer.begin();
      p.px = pos.x; p.py = pos.y + 0.4 * S; p.pz = pos.z;
      p.life = 0.16; p.s0 = 2.0 * S; p.s1 = 5.5 * S; p.cell = CELL.dot; p.additive = true;
      p.r0 = 14; p.g0 = 10; p.b0 = 5; p.a0 = 1; p.r1 = 5; p.g1 = 2.5; p.b1 = 0.8; p.a1 = 0;
      p.fadeIn = 0.004;
      layer.commit();
    }
    const nf = Math.max(6, Math.round(16 * m));
    for (let i = 0; i < nf; i++) {
      const p = layer.begin();
      const a = rnd() * 6.283, el = rr(-0.1, 1.1);
      const sp = rr(1.5, 6) * S;
      p.px = pos.x + (rnd() - 0.5) * 0.5 * S; p.py = pos.y + 0.3 * S; p.pz = pos.z + (rnd() - 0.5) * 0.5 * S;
      p.vx = Math.cos(a) * Math.cos(el) * sp; p.vy = Math.sin(el) * sp + 1.5 * S; p.vz = Math.sin(a) * Math.cos(el) * sp;
      p.drag = 2.2; p.life = rr(0.55, 1.0);
      p.s0 = rr(1.2, 1.9) * S; p.s1 = rr(2.8, 4.2) * S; p.cell = CELL.puff0 + (i % 3); p.additive = true;
      p.rot = rnd() * 6; p.rotVel = (rnd() - 0.5) * 1.2;
      p.r0 = 4.0; p.g0 = 1.5; p.b0 = 0.25; p.a0 = 0.95; p.r1 = 0.9; p.g1 = 0.12; p.b1 = 0.015; p.a1 = 0;
      p.fadeIn = 0.01; p.turb = 0.3;
      layer.commit();
    }
    const nt = Math.max(4, Math.round(10 * m));
    for (let i = 0; i < nt; i++) {
      const p = layer.begin();
      const a = rnd() * 6.283;
      const sp = rr(1, 4) * S;
      p.px = pos.x; p.py = pos.y + 0.2 * S; p.pz = pos.z;
      p.vx = Math.cos(a) * sp; p.vy = rr(2, 6) * S; p.vz = Math.sin(a) * sp;
      p.drag = 1.8; p.life = rr(0.5, 1.0); p.s0 = rr(1.0, 1.6) * S; p.s1 = rr(0.5, 1.0) * S;
      p.cell = CELL.flame0 + (i % 3); p.additive = true; p.rot = (rnd() - 0.5) * 0.7;
      p.r0 = 3.4; p.g0 = 1.2; p.b0 = 0.18; p.a0 = 0.9; p.r1 = 1.0; p.g1 = 0.1; p.b1 = 0.01; p.a1 = 0;
      p.fadeIn = 0.01; p.turb = 0.25;
      layer.commit();
    }
    const ns = Math.max(5, Math.round(14 * m));
    for (let i = 0; i < ns; i++) {
      const p = layer.begin();
      const a = rnd() * 6.283, sp = rr(0.5, 3) * S;
      p.px = pos.x + (rnd() - 0.5) * S; p.py = pos.y + 0.5 * S; p.pz = pos.z + (rnd() - 0.5) * S;
      p.vx = Math.cos(a) * sp; p.vy = rr(1.2, 4.2) * S; p.vz = Math.sin(a) * sp;
      p.drag = 1.3; p.life = rr(2.6, 4.8);
      p.s0 = rr(0.9, 1.5) * S; p.s1 = rr(3.0, 5.2) * S; p.cell = CELL.puff0 + (i % 3); p.lit = true;
      p.rot = rnd() * 6; p.rotVel = (rnd() - 0.5) * 0.4; p.turb = 0.5;
      p.r0 = 0.12; p.g0 = 0.11; p.b0 = 0.1; p.a0 = 0.8; p.r1 = 0.3; p.g1 = 0.29; p.b1 = 0.27; p.a1 = 0;
      p.fadeIn = 0.08;
      layer.commit();
    }
    {
      const p = layer.begin();
      p.px = pos.x; p.py = pos.y + 0.06; p.pz = pos.z;
      p.life = 0.45; p.s0 = 0.6 * S; p.s1 = 9 * S; p.cell = CELL.ring; p.orient = 2; p.additive = true;
      p.r0 = 1.4; p.g0 = 1.1; p.b0 = 0.8; p.a0 = 0.8; p.r1 = 0.6; p.g1 = 0.45; p.b1 = 0.3; p.a1 = 0;
      p.fadeIn = 0.005;
      layer.commit();
    }
    const nd = Math.max(6, Math.round(18 * m));
    for (let i = 0; i < nd; i++) {
      const p = layer.begin();
      const a = (i / nd) * 6.283 + rnd() * 0.3;
      const sp = rr(4, 8) * S;
      p.px = pos.x; p.py = pos.y + 0.2; p.pz = pos.z;
      p.vx = Math.cos(a) * sp; p.vy = rr(0.2, 0.9); p.vz = Math.sin(a) * sp;
      p.drag = 2.4; p.life = rr(1.4, 2.4); p.s0 = rr(0.6, 1.0) * S; p.s1 = rr(2.0, 3.2) * S;
      p.cell = CELL.puff0 + (i % 3); p.lit = true; p.rot = rnd() * 6; p.turb = 0.2;
      setC0(p, 0x9a8a72, 0.5); setC1(p, 0x8f8270, 0);
      p.fadeIn = 0.05;
      layer.commit();
    }
    const nsp = Math.max(8, Math.round(36 * m));
    for (let i = 0; i < nsp; i++) {
      const p = layer.begin();
      const a = rnd() * 6.283, el = rr(0.1, 1.3), sp = rr(6, 18) * S;
      p.px = pos.x; p.py = pos.y + 0.3 * S; p.pz = pos.z;
      p.vx = Math.cos(a) * Math.cos(el) * sp; p.vy = Math.sin(el) * sp; p.vz = Math.sin(a) * Math.cos(el) * sp;
      p.grav = 1; p.drag = 0.5; p.life = rr(0.6, 1.5);
      p.s0 = rr(0.03, 0.06); p.s1 = 0.012; p.cell = CELL.spark; p.orient = 1; p.additive = true; p.stretch = 0.03;
      p.r0 = 6; p.g0 = 3.2; p.b0 = 1; p.a0 = 1; p.r1 = 2.4; p.g1 = 0.4; p.b1 = 0.05; p.a1 = 0.3;
      p.fadeIn = 0.005;
      layer.commit();
    }
    const floor = groundAt(pos.x, pos.z);
    const nc = Math.max(6, Math.round(22 * m * Math.min(S, 2)));
    for (let i = 0; i < nc; i++) {
      const a = rnd() * 6.283, sp = rr(3, 12) * S;
      debris.spawn(pos.x, pos.y + 0.3, pos.z, Math.cos(a) * sp, rr(5, 15) * S, Math.sin(a) * sp, rr(0.1, 0.34) * Math.sqrt(S), i % 3 === 0 ? 0x4a4540 : 0x8a8378, floor);
    }
    const e = acquireEmitter('flash');
    e.position.copy(pos);
    e.position.y += 1.2 * S;
    e.ttl = e.ttl0 = 0.5;
    e.lightBase = 520 * S; e.lightDist = 34 * Math.max(1, S); e.lightColor = 0xffa860;
    e.scale = S;
  }

  // ── emitters ────────────────────────────────────────────────────────────
  function acquireEmitter(kind: EmitterKind): Emitter {
    let e: Emitter | null = null;
    for (const x of emitters) if (!x.used) { e = x; break; }
    if (!e) { e = new Emitter(); emitters.push(e); }
    e.used = true;
    e.kind = kind; e.scale = 1; e.intensity = 1; e.alive = 1; e.stopped = false; e.obj = null;
    e.offset.set(0, 0, 0); e.accFlame = e.accSmoke = e.accEmber = e.accCore = 0;
    e.ttl = e.ttl0 = 0; e.light = null; e.releasing = false; e.pick = -1;
    e.lightBase = 20; e.lightDist = 12; e.lightColor = 0xff8a3a;
    e.flickerSeed = Math.random() * 100;
    return e;
  }

  function fireFx(pos: THREE.Vector3, scale = 1): FxHandle {
    const e = acquireEmitter('fire');
    e.position.copy(pos); e.scale = scale;
    e.lightBase = 15 * scale * scale; e.lightDist = 14 * Math.max(0.6, scale);
    return e;
  }
  function smokeFx(pos: THREE.Vector3, scale = 1): FxHandle {
    const e = acquireEmitter('smoke');
    e.position.copy(pos); e.scale = scale;
    return e;
  }
  function torchFx(obj: THREE.Object3D, offset?: THREE.Vector3): FxHandle {
    const e = acquireEmitter('torch');
    e.obj = obj;
    if (offset) e.offset.copy(offset);
    e.scale = 0.45;
    e.lightBase = 12; e.lightDist = 9;
    obj.updateWorldMatrix(true, false);
    _v1.copy(e.offset);
    obj.localToWorld(_v1);
    e.position.copy(_v1);
    return e;
  }
  function trailFx(obj: THREE.Object3D, color = 0xffe6a8): FxHandle {
    let slot: TrailSlot | null = null;
    for (const s of trailSlots) if (!s.active) { slot = s; break; }
    if (!slot) slot = trailSlots.find((s) => s.stopping) ?? trailSlots[0];
    slot.active = true; slot.stopping = false; slot.obj = obj; slot.count = 0; slot.head = 0;
    slot.color.setHex(color); slot.width = TRAIL_HALF_WIDTH; slot.hasGeometry = false;
    const h = new TrailHandle(slot);
    slot.handle = h;
    obj.getWorldPosition(h.position);
    return h;
  }

  function stepEmitter(e: Emitter, dt: number): void {
    if (e.obj) {
      e.obj.updateWorldMatrix(true, false);
      _v1.copy(e.offset);
      e.obj.localToWorld(_v1);
      e.position.copy(_v1);
    }
    if (e.ttl0 > 0) {
      e.ttl -= dt;
      if (e.ttl <= 0) { e.used = false; return; }
    }
    if (e.stopped) {
      e.alive -= dt * 1.4;
      if (e.alive <= 0) {
        e.alive = 0;
        e.used = false;
        return;
      }
    }
    const power = e.intensity * Math.max(0, e.alive);
    const m = mul();
    layer.time = time;
    const S = e.scale;
    if (e.kind === 'fire' || e.kind === 'torch') {
      const torch = e.kind === 'torch';
      e.accFlame += dt * 42 * power * m * Math.max(0.6, S);
      while (e.accFlame >= 1) {
        e.accFlame -= 1;
        const p = layer.begin();
        const a = rnd() * 6.283, r = Math.sqrt(rnd()) * 0.16 * S;
        p.px = e.position.x + Math.cos(a) * r; p.py = e.position.y + 0.04 * S; p.pz = e.position.z + Math.sin(a) * r;
        p.vx = (rnd() - 0.5) * 0.3 * S; p.vy = rr(0.75, 1.45) * S; p.vz = (rnd() - 0.5) * 0.3 * S;
        p.drag = 0.7; p.life = rr(0.4, 0.75);
        p.s0 = rr(0.42, 0.68) * S; p.s1 = rr(0.14, 0.26) * S;
        p.cell = CELL.flame0 + ((rnd() * 3) | 0); p.additive = true;
        p.rot = (rnd() - 0.5) * 0.5; p.rotVel = (rnd() - 0.5) * 0.8;
        p.r0 = 1.35; p.g0 = 0.42; p.b0 = 0.035; p.a0 = 1.0; p.r1 = 0.55; p.g1 = 0.05; p.b1 = 0.003; p.a1 = 0.1;
        p.fadeIn = 0.04; p.turb = 0.22 * S;
        layer.commit();
      }
      e.accCore += dt * 14 * power * m;
      while (e.accCore >= 1) {
        e.accCore -= 1;
        const p = layer.begin();
        p.px = e.position.x + (rnd() - 0.5) * 0.1 * S; p.py = e.position.y + 0.12 * S; p.pz = e.position.z + (rnd() - 0.5) * 0.1 * S;
        p.vy = rr(0.4, 0.9) * S; p.life = rr(0.3, 0.5); p.s0 = rr(0.35, 0.5) * S; p.s1 = 0.12 * S;
        p.cell = CELL.dot; p.additive = true;
        p.r0 = 1.5; p.g0 = 0.6; p.b0 = 0.08; p.a0 = 0.45; p.r1 = 0.7; p.g1 = 0.12; p.b1 = 0.01; p.a1 = 0;
        p.fadeIn = 0.03;
        layer.commit();
      }
      e.accSmoke += dt * (torch ? 3 : 5) * power * m;
      while (e.accSmoke >= 1) {
        e.accSmoke -= 1;
        const p = layer.begin();
        p.px = e.position.x + (rnd() - 0.5) * 0.2 * S; p.py = e.position.y + 1.5 * S; p.pz = e.position.z + (rnd() - 0.5) * 0.2 * S;
        p.vx = (rnd() - 0.5) * 0.3; p.vy = rr(0.8, 1.5) * S; p.vz = (rnd() - 0.5) * 0.3;
        p.drag = 0.5; p.life = rr(2.4, 4.2);
        p.s0 = rr(0.25, 0.4) * S; p.s1 = rr(1.1, 1.9) * S; p.cell = CELL.puff0 + ((rnd() * 3) | 0); p.lit = true;
        p.rot = rnd() * 6; p.rotVel = (rnd() - 0.5) * 0.5; p.turb = 0.35 * S;
        p.r0 = 0.3; p.g0 = 0.285; p.b0 = 0.27; p.a0 = 0.3; p.r1 = 0.4; p.g1 = 0.38; p.b1 = 0.36; p.a1 = 0;
        p.fadeIn = 1.1;
        layer.commit();
      }
      e.accEmber += dt * (torch ? 2 : 5) * power * m;
      while (e.accEmber >= 1) {
        e.accEmber -= 1;
        const p = layer.begin();
        p.px = e.position.x + (rnd() - 0.5) * 0.25 * S; p.py = e.position.y + 0.3 * S; p.pz = e.position.z + (rnd() - 0.5) * 0.25 * S;
        p.vx = (rnd() - 0.5) * 1.2; p.vy = rr(1.4, 3.2) * S; p.vz = (rnd() - 0.5) * 1.2;
        p.drag = 0.3; p.grav = -0.05; p.life = rr(1.2, 2.8); p.turb = 0.5;
        p.s0 = rr(0.025, 0.05); p.s1 = 0.01; p.cell = CELL.dot; p.additive = true;
        p.r0 = 6; p.g0 = 2.2; p.b0 = 0.5; p.a0 = 1; p.r1 = 1.5; p.g1 = 0.2; p.b1 = 0.02; p.a1 = 0;
        p.fadeIn = 0.02;
        layer.commit();
      }
    } else if (e.kind === 'smoke') {
      e.accSmoke += dt * 6 * power * m * Math.max(0.6, Math.min(S, 3));
      while (e.accSmoke >= 1) {
        e.accSmoke -= 1;
        const p = layer.begin();
        const a = rnd() * 6.283, r = Math.sqrt(rnd()) * 0.5 * S;
        p.px = e.position.x + Math.cos(a) * r; p.py = e.position.y; p.pz = e.position.z + Math.sin(a) * r;
        p.vx = (rnd() - 0.5) * 0.6 + 0.25; p.vy = rr(1.6, 2.9) * Math.sqrt(S); p.vz = (rnd() - 0.5) * 0.6 + 0.1;
        p.drag = 0.18; p.life = rr(7, 11);
        p.s0 = rr(0.9, 1.4) * S; p.s1 = rr(4.5, 7.5) * S; p.cell = CELL.puff0 + ((rnd() * 3) | 0); p.lit = true;
        p.rot = rnd() * 6; p.rotVel = (rnd() - 0.5) * 0.25; p.turb = 0.9 * Math.sqrt(S);
        p.r0 = 0.2; p.g0 = 0.19; p.b0 = 0.18; p.a0 = 0.62; p.r1 = 0.45; p.g1 = 0.43; p.b1 = 0.41; p.a1 = 0;
        p.fadeIn = 0.8;
        layer.commit();
      }
    }
  }

  /** nearest light-producing emitters get the pooled point lights; hand-over fades smoothly */
  function assignLights(): void {
    const budget = internals?.config.fireLights ?? 4;
    frameId++;
    let producers = 0;
    for (let _i1 = 0; _i1 < emitters.length; _i1++) {
      const e = emitters[_i1];
      if (!e.used || e.kind === 'smoke') continue;
      e.distSq = e.position.distanceToSquared(_camPos);
      if (e.kind === 'flash') e.distSq *= 0.1; // flashes win ties
      producers++;
    }
    // grow the pool lazily (changing the light count later recompiles every material)
    // keep at least two lights alive so the first explosion/torch of a level never triggers a shader recompile
    while (lightPool.length < Math.min(budget, Math.max(producers, 2))) {
      const l = new THREE.PointLight(0xff8a3a, 0, 10, 2);
      l.castShadow = false;
      l.name = 'fx-light';
      root.add(l);
      lightPool.push(l);
      lightOwner.push(null);
    }
    const usable = Math.min(budget, lightPool.length);
    // pick the nearest `usable` producers
    for (let k = 0; k < usable; k++) {
      let best: Emitter | null = null;
      let bd = Infinity;
      for (let _i2 = 0; _i2 < emitters.length; _i2++) {
        const e = emitters[_i2];
        if (!e.used || e.kind === 'smoke' || e.pick === frameId) continue;
        if (e.distSq < bd) { bd = e.distSq; best = e; }
      }
      if (!best) break;
      best.pick = frameId;
    }
    // owners that are gone, or no longer picked, start releasing
    for (let i = 0; i < lightPool.length; i++) {
      const o = lightOwner[i];
      if (!o) continue;
      if (!o.used || o.light !== lightPool[i]) { lightOwner[i] = null; continue; }
      o.releasing = o.pick !== frameId || i >= usable;
    }
    // picked emitters without a light take a free slot (or a releasing one that has mostly faded)
    for (let _i3 = 0; _i3 < emitters.length; _i3++) {
      const e = emitters[_i3];
      if (!e.used || e.pick !== frameId || e.light) continue;
      let slot = -1;
      let lowest = Infinity;
      for (let i = 0; i < usable; i++) {
        const o = lightOwner[i];
        if (!o) { const v = lightPool[i].intensity; if (v < lowest) { lowest = v; slot = i; } }
      }
      if (slot < 0) {
        for (let i = 0; i < usable; i++) {
          const o = lightOwner[i]!;
          if (o.releasing && lightPool[i].intensity < 1.0) { slot = i; break; }
        }
        if (slot >= 0) { lightOwner[slot]!.light = null; lightOwner[slot]!.releasing = false; }
      }
      if (slot < 0) continue;
      e.light = lightPool[slot];
      e.releasing = false;
      lightOwner[slot] = e;
    }
    // drive intensities
    let active = 0;
    for (let i = 0; i < lightPool.length; i++) {
      const l = lightPool[i];
      const o = lightOwner[i];
      if (!o) {
        l.intensity = l.intensity > 0.02 ? l.intensity * 0.82 : 0;
        if (l.intensity > 0.05) active++;
        continue;
      }
      const t = time * 9 + o.flickerSeed;
      const fl = 0.78 + 0.14 * Math.sin(t) + 0.08 * Math.sin(t * 2.7 + 1.3) + 0.06 * Math.sin(t * 5.1);
      let target: number;
      if (o.kind === 'flash') {
        const k = Math.max(0, o.ttl / Math.max(1e-3, o.ttl0));
        target = o.lightBase * k * k;
      } else {
        target = o.lightBase * fl * o.intensity * Math.max(0, o.alive);
      }
      if (o.releasing) target = 0;
      const rate = o.kind === 'flash' ? 1 : 0.2;
      l.intensity += (target - l.intensity) * rate;
      l.color.setHex(o.lightColor);
      l.distance = o.lightDist;
      l.position.copy(o.position);
      l.position.y += 0.7 * Math.max(0.4, o.scale);
      if (o.releasing && l.intensity < 0.05) {
        l.intensity = 0;
        o.light = null;
        o.releasing = false;
        lightOwner[i] = null;
      } else if (l.intensity > 0.05) active++;
    }
    stats.lights = active;
    // nearest fires also tint nearby smoke
    for (let i = 0; i < 4; i++) lightVecs[i].set(0, -9999, 0, 0);
    let li = 0;
    for (let i = 0; i < lightPool.length && li < 4; i++) {
      const o = lightOwner[i];
      if (o && lightPool[i].intensity > 0.2) {
        lightVecs[li].set(o.position.x, o.position.y + 0.8 * o.scale, o.position.z, Math.min(1.2, lightPool[i].intensity * 0.03));
        li++;
      }
    }
  }

  // ── weather control ─────────────────────────────────────────────────────
  function getWeatherLayer(kind: Exclude<WeatherKind, 'none'>): WeatherLayer {
    let w = weather[kind];
    if (!w) {
      w = new WeatherLayer(kind, WEATHER[kind], atlas, U, DIST_SCALE[kind], kind === 'rain' || kind === 'storm' ? 1 : kind === 'snow' ? 0.22 : 0);
      weather[kind] = w;
      root.add(w.mesh);
    }
    return w;
  }

  function setWeatherFx(kind: WeatherKind, intensity = 1): void {
    const k = Math.max(0, Math.min(1.5, intensity));
    stats.weather = kind;
    for (let _i6 = 0; _i6 < WEATHER_KINDS.length; _i6++) {
      const name = WEATHER_KINDS[_i6];
      const w = weather[name];
      if (name === kind) getWeatherLayer(name).target = k;
      else if (w) w.target = 0;
    }
  }

  // ── lightning ───────────────────────────────────────────────────────────
  function buildBolt(): void {
    for (const g of boltGeos) g.dispose();
    boltGeos.length = 0;
    while (bolt.children.length) bolt.remove(bolt.children[0]);
    const az = Math.random() * Math.PI * 2;
    const dist = rr(160, 260);
    const top = new THREE.Vector3(Math.sin(az) * dist * 0.8, rr(120, 170), Math.cos(az) * dist * 0.8);
    const bottom = new THREE.Vector3(Math.sin(az + rr(-0.15, 0.15)) * dist, rr(0, 15), Math.cos(az + rr(-0.15, 0.15)) * dist);
    lightningDir.set(Math.sin(az), 0.35, Math.cos(az));
    const mk = (a: THREE.Vector3, b: THREE.Vector3, seg: number, jag: number): THREE.Vector3[] => {
      const pts: THREE.Vector3[] = [a.clone()];
      for (let i = 1; i < seg; i++) {
        const p = a.clone().lerp(b, i / seg);
        p.x += (Math.random() - 0.5) * jag; p.z += (Math.random() - 0.5) * jag; p.y += (Math.random() - 0.5) * jag * 0.3;
        pts.push(p);
      }
      pts.push(b.clone());
      return pts;
    };
    const main = mk(top, bottom, 26, 22);
    const addLine = (pts: THREE.Vector3[]) => {
      const g = new THREE.BufferGeometry().setFromPoints(pts);
      boltGeos.push(g);
      for (let k = 0; k < 3; k++) {
        const l = new THREE.Line(g, boltMat);
        l.position.set((k - 1) * 0.35, 0, (k - 1) * 0.2);
        l.frustumCulled = false;
        bolt.add(l);
      }
    };
    addLine(main);
    for (let b = 0; b < 3; b++) {
      const s = main[4 + ((Math.random() * 14) | 0)];
      const e = s.clone().add(new THREE.Vector3((Math.random() - 0.5) * 80, -rr(25, 70), (Math.random() - 0.5) * 80));
      addLine(mk(s, e, 8, 9));
    }
  }

  function lightningFx(): void {
    buildBolt();
    lightningSeq = [1, 0.25, 0.9, 0.2, 0.55, 0.3, 0.18, 0.1, 0.05];
    lightningT = 0;
    bolt.visible = true;
    boltMat.opacity = 1;
  }

  // ── trails ──────────────────────────────────────────────────────────────
  /**
   * Camera-facing ribbons, rebuilt each update: TRAIL_POINTS samples of the followed object, a soft
   * core a couple of centimetres wide that tapers to nothing toward the tail, capped at
   * TRAIL_MAX_LEN metres, and fading out over TRAIL_LIFE (also after stop(), at the impact point).
   */
  function updateTrails(): void {
    const LIFE = TRAIL_LIFE;
    let any = false;
    let anyVisible = false;
    for (let s = 0; s < TRAIL_SLOTS; s++) {
      const sl = trailSlots[s];
      const base = s * TRAIL_POINTS * 2;
      if (!sl.active) {
        if (sl.hasGeometry) {
          for (let v = 0; v < TRAIL_POINTS * 2; v++) trailCol[(base + v) * 4 + 3] = 0;
          sl.hasGeometry = false;
          any = true;
        }
        continue;
      }
      anyVisible = true;
      any = true;
      if (sl.obj) {
        sl.obj.getWorldPosition(_v1);
        sl.handle?.position.copy(_v1);
        const h = (sl.head + 1) % TRAIL_POINTS;
        sl.head = h;
        sl.pos[h * 3] = _v1.x; sl.pos[h * 3 + 1] = _v1.y; sl.pos[h * 3 + 2] = _v1.z;
        sl.t[h] = time;
        if (sl.count < TRAIL_POINTS) sl.count++;
      }
      // keep the samples that are young enough AND within TRAIL_MAX_LEN of the head
      let valid = 0;
      let len = 0;
      for (let i = 0; i < sl.count; i++) {
        const idx = (sl.head - i + TRAIL_POINTS) % TRAIL_POINTS;
        if (time - sl.t[idx] > LIFE) break;
        if (i > 0) {
          const pIdx = (sl.head - i + 1 + TRAIL_POINTS) % TRAIL_POINTS;
          const dx = sl.pos[idx * 3] - sl.pos[pIdx * 3], dy = sl.pos[idx * 3 + 1] - sl.pos[pIdx * 3 + 1], dz = sl.pos[idx * 3 + 2] - sl.pos[pIdx * 3 + 2];
          len += Math.sqrt(dx * dx + dy * dy + dz * dz);
          if (len > TRAIL_MAX_LEN) break;
        }
        trailDist[i] = len;
        valid++;
      }
      sl.count = valid;
      if (valid === 0 && sl.stopping) {
        sl.active = false;
        sl.handle = null;
        for (let v = 0; v < TRAIL_POINTS * 2; v++) trailCol[(base + v) * 4 + 3] = 0;
        sl.hasGeometry = false;
        continue;
      }
      sl.hasGeometry = true;
      const r = sl.color.r, g = sl.color.g, b = sl.color.b;
      for (let i = 0; i < TRAIL_POINTS; i++) {
        const vi = (base + i * 2) * 3;
        const ci = (base + i * 2) * 4;
        if (i < valid) {
          const idx = (sl.head - i + TRAIL_POINTS) % TRAIL_POINTS;
          const px = sl.pos[idx * 3], py = sl.pos[idx * 3 + 1], pz = sl.pos[idx * 3 + 2];
          const ni = Math.min(valid - 1, i + 1);
          const pi = Math.max(0, i - 1);
          const nIdx = (sl.head - ni + TRAIL_POINTS) % TRAIL_POINTS;
          const pIdx = (sl.head - pi + TRAIL_POINTS) % TRAIL_POINTS;
          _v1.set(sl.pos[pIdx * 3] - sl.pos[nIdx * 3], sl.pos[pIdx * 3 + 1] - sl.pos[nIdx * 3 + 1], sl.pos[pIdx * 3 + 2] - sl.pos[nIdx * 3 + 2]);
          if (_v1.lengthSq() < 1e-10) _v1.set(0, 1, 0);
          _v1.normalize();
          _v2.set(_camPos.x - px, _camPos.y - py, _camPos.z - pz);
          _v2.crossVectors(_v1, _v2);
          if (_v2.lengthSq() < 1e-10) _v2.set(1, 0, 0);
          _v2.normalize();
          const age = Math.min(1, (time - sl.t[idx]) / LIFE);
          // taper toward the tail (by length) and thin out with age
          const tail = 1 - trailDist[i] / TRAIL_MAX_LEN;
          const camD = Math.sqrt((_camPos.x - px) ** 2 + (_camPos.y - py) ** 2 + (_camPos.z - pz) ** 2);
          const w = Math.max(sl.width * (0.35 + 0.65 * tail) * (1 - 0.5 * age), camD * TRAIL_MIN_PX * (sl.width / TRAIL_HALF_WIDTH));
          trailPos[vi] = px - _v2.x * w; trailPos[vi + 1] = py - _v2.y * w; trailPos[vi + 2] = pz - _v2.z * w;
          trailPos[vi + 3] = px + _v2.x * w; trailPos[vi + 4] = py + _v2.y * w; trailPos[vi + 5] = pz + _v2.z * w;
          const a = Math.pow(1 - age, 1.6) * tail * tail;
          const hdr = 3.0;
          for (let k = 0; k < 2; k++) {
            trailCol[ci + k * 4] = r * hdr; trailCol[ci + k * 4 + 1] = g * hdr; trailCol[ci + k * 4 + 2] = b * hdr; trailCol[ci + k * 4 + 3] = a;
          }
        } else {
          const lastIdx = valid > 0 ? (sl.head - (valid - 1) + TRAIL_POINTS) % TRAIL_POINTS : sl.head;
          const px = sl.pos[lastIdx * 3], py = sl.pos[lastIdx * 3 + 1], pz = sl.pos[lastIdx * 3 + 2];
          trailPos[vi] = trailPos[vi + 3] = px; trailPos[vi + 1] = trailPos[vi + 4] = py; trailPos[vi + 2] = trailPos[vi + 5] = pz;
          trailCol[ci + 3] = 0; trailCol[ci + 7] = 0;
        }
      }
    }
    trailMesh.visible = anyVisible;
    if (any) {
      trailPosAttr.needsUpdate = true;
      trailColAttr.needsUpdate = true;
    }
  }

  // ── update ──────────────────────────────────────────────────────────────
  function update(dtIn: number, camera: THREE.Camera): void {
    const dt = Math.min(Math.max(dtIn, 0), 0.1);
    time += dt;
    U.uTime.value = time;
    layer.time = time;
    const m = mul();
    if (internals) {
      decals.limit = Math.min(decals.cap, internals.config.decals);
      debris.limit = Math.min(debris.cap, internals.config.debris);
    }

    const fog = scene.fog as THREE.FogExp2 | null;
    if (fog) {
      fogColor.copy(fog.color);
      U.uFogDensity.value = fog.density;
    }
    camera.getWorldPosition(_camPos);
    (U.uCam.value as THREE.Vector3).copy(_camPos);
    if (internals) {
      const a = internals.ambientTint;
      (U.uAmbient.value as THREE.Color).copy(a);
      const lum = Math.min(0.95, Math.max(0.1, ((a.r + a.g + a.b) / 3) * 1.5));
      (U.uTint.value as THREE.Color).setRGB(lum * (0.92 + 0.08 * (a.r / Math.max(a.g, 1e-3))), lum, lum * (0.94 + 0.1 * (a.b / Math.max(a.g, 1e-3))));
    }
    U.uGround.value = groundFn ? groundFn(engine.shadowFocus.x, engine.shadowFocus.z) : engine.shadowFocus.y;

    let live = 0;
    for (let _i4 = 0; _i4 < emitters.length; _i4++) {
      const e = emitters[_i4];
      if (!e.used) continue;
      stepEmitter(e, dt);
      if (e.used) live++;
    }
    stats.liveEmitters = live;
    assignLights();

    for (let _i7 = 0; _i7 < WEATHER_KINDS.length; _i7++) {
      const name = WEATHER_KINDS[_i7];
      const w = weather[name];
      if (!w) continue;
      w.cur += (w.target - w.cur) * Math.min(1, dt * 1.2);
      if (Math.abs(w.target - w.cur) < 0.004) w.cur = w.target;
      const n = Math.floor(w.cfg.count * Math.min(1.4, m) * Math.min(1, w.cur));
      w.setCount(Math.min(w.cfg.count, n));
      w.mesh.visible = n > 0;
    }
    {
      const want = Math.max(0, Math.min(1.5, (engine.env as EnvironmentPresetEx).mist ?? 0));
      mist.target = want;
      mist.cur += (want - mist.cur) * Math.min(1, dt * 0.8);
      const n = Math.floor(MIST.count * Math.min(1.2, m) * Math.min(1.2, mist.cur / 1));
      mist.setCount(Math.min(MIST.count, n));
      mist.mesh.visible = n > 0;
      mistCam.set(_camPos.x, (U.uGround.value as number) + 1.4, _camPos.z);
      (mist.material.uniforms.uColor.value as THREE.Color).copy(fogColor).multiplyScalar(1.12);
      mist.material.uniforms.uAlpha.value = MIST.alpha * Math.min(1.3, 0.7 + 0.5 * Math.min(1, mist.cur));
    }
    const rainy = (weather.rain?.cur ?? 0) + (weather.storm?.cur ?? 0);
    splashGeo.instanceCount = Math.floor(SPLASH_COUNT * Math.min(1, rainy) * Math.min(1, m));
    splashMesh.visible = splashGeo.instanceCount > 0;
    splashMat.uniforms.uRate.value = (weather.storm?.cur ?? 0) > 0.2 ? 2.4 : 1.5;

    if (lightningT >= 0) {
      lightningT += dt;
      const idx = Math.floor(lightningT / lightningStep);
      if (idx >= lightningSeq.length) {
        lightningT = -1;
        flash = 0;
        bolt.visible = false;
      } else {
        flash = lightningSeq[idx] * (0.85 + 0.15 * Math.sin(lightningT * 90));
        boltMat.opacity = Math.min(1, flash * 1.5);
        bolt.position.set(_camPos.x, 0, _camPos.z);
      }
      internals?.setFlash(flash, lightningDir.x, lightningDir.y, lightningDir.z);
      U.uFlash.value = flash;
    } else if (flash !== 0 || (U.uFlash.value as number) !== 0) {
      flash = 0;
      U.uFlash.value = 0;
      internals?.setFlash(0);
    }

    debris.update(dt);
    updateTrails();
    layer.flush();
    decals.flush();
  }

  function clear(): void {
    // level teardown: the next level installs its own terrain height function
    groundFn = null;
    layer.clear();
    decals.clear();
    debris.clear();
    for (let _i5 = 0; _i5 < emitters.length; _i5++) {
      const e = emitters[_i5];
      e.used = false;
      e.light = null;
      e.releasing = false;
    }
    for (let i = 0; i < lightOwner.length; i++) lightOwner[i] = null;
    for (const l of lightPool) l.intensity = 0;
    for (const s of trailSlots) {
      s.active = false; s.stopping = false; s.obj = null; s.count = 0; s.handle = null; s.hasGeometry = false;
    }
    for (let v = 0; v < trailVerts; v++) trailCol[v * 4 + 3] = 0;
    trailColAttr.needsUpdate = true;
    trailMesh.visible = false;
    lightningT = -1;
    bolt.visible = false;
    flash = 0;
    internals?.setFlash(0);
  }

  function dispose(): void {
    clear();
    scene.remove(root);
    layer.dispose();
    decals.dispose();
    debris.dispose();
    for (const name of WEATHER_KINDS) weather[name]?.dispose();
    mist.dispose();
    splashGeo.dispose();
    splashMat.dispose();
    trailGeo.dispose();
    trailMat.dispose();
    for (const g of boltGeos) g.dispose();
    boltMat.dispose();
    for (const l of lightPool) {
      root.remove(l);
      l.dispose();
    }
    lightPool.length = 0;
    atlas.dispose();
  }

  return {
    dispose,
    blood: bloodFx,
    sparks: sparksFx,
    dust: dustFx,
    splash: splashFx,
    debris: debrisFx,
    explosion: explosionFx,
    fire: fireFx,
    smoke: smokeFx,
    torch: torchFx,
    trail: trailFx,
    setWeather: setWeatherFx,
    lightning: lightningFx,
    update,
    clear,
    get groundAt() {
      return groundFn;
    },
    set groundAt(fn: ((x: number, z: number) => number) | null) {
      groundFn = fn;
    },
    stats,
  };
}
