/**
 * Moria's look: everything that turns the stock dwarven set into weathered, film-like stone.
 * All of it is code: shader patches, canvas-drawn textures and small additive meshes.
 *
 *   weatherStone    re-grades the shared 'dwarven_stone' materials of an object tree (clones, never mutates):
 *                   the carved diamond albedo is flattened and warmed and a world-space grime / erosion layer
 *                   breaks the tiling, so the walls read as old stone instead of a patterned carpet.
 *   volumeShaft     a light shaft with drifting dusty streaks (the stock cone is a smooth hollow tube).
 *   dustMotes       slow glittering specks, animated entirely in the vertex shader.
 *   lightPool       the soft patch where a shaft lands on the floor.
 *   runeTexture     Cirth-like carved runes, for Balin's tomb.
 *   glowDisc        a soft additive disc (the ceiling hole's faint glow).
 */
import * as THREE from 'three';
import { getTextureSet } from '../../../world';
import { patchShader } from '../../../world/shader';

// ── weathered stone ─────────────────────────────────────────────────────────

const NOISE_GLSL = /* glsl */ `
varying vec3 vMW;
varying vec3 vMN;
float mHash(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float mHash2(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float mNoise(vec3 x){
  vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(mHash(i + vec3(0,0,0)), mHash(i + vec3(1,0,0)), f.x), mix(mHash(i + vec3(0,1,0)), mHash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(mHash(i + vec3(0,0,1)), mHash(i + vec3(1,0,1)), f.x), mix(mHash(i + vec3(0,1,1)), mHash(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float mFbm(vec3 p){ float a = 0.5; float s = 0.0; for (int i = 0; i < 3; i++) { s += a * mNoise(p); p = p * 2.07 + 5.3; a *= 0.5; } return s; }
`;

const variants = new Map<string, THREE.Material>();

export interface WeatherOpts {
  /** 0..1: how much of the carved albedo contrast is flattened (default 0.78) */
  flatten?: number;
  /** tint of the flattened stone (linear rgb): cold slate by default, the fires supply the warmth */
  warm?: [number, number, number];
  /** grime strength 0..1 (default 0.8) */
  grime?: number;
  /** mean linear albedo of the stone (default 0.062) */
  base?: number;
}

/** a re-graded clone of a dwarven stone material (cached by source material + options) */
function weatheredClone(src: THREE.Material, o: WeatherOpts): THREE.Material {
  const flatten = o.flatten ?? 0.78;
  const warm = o.warm ?? [0.94, 1.0, 1.1];
  const grime = o.grime ?? 0.8;
  const base = o.base ?? 0.062;
  const key = `${src.uuid}|${flatten}|${warm.join(',')}|${grime}|${base}`;
  let m = variants.get(key);
  if (m) return m;
  m = src.clone();
  m.userData = { ...src.userData, shared: true, weathered: true };
  // clone() drops the shader hooks (the macro anti-tiling patch): carry them over, then chain ours
  m.onBeforeCompile = src.onBeforeCompile;
  m.customProgramCacheKey = src.customProgramCacheKey;
  patchShader(m, `moriaStone2|${flatten}|${grime}|${base}`, (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vMW;\nvarying vec3 vMN;')
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        vec4 mwp = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          mwp = instanceMatrix * mwp;
        #endif
        vMW = (modelMatrix * mwp).xyz;
        vMN = normalize(mat3(modelMatrix) * objectNormal);`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${NOISE_GLSL}`)
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        float mCarve = 1.0;
        float mWet = 0.0;
        float mMortar = 0.0;
        float mBlockH = 0.5;
        {
          vec3 wn = normalize(vMN);
          float isFloor = smoothstep(0.55, 0.88, wn.y);
          float isCeil = smoothstep(0.55, 0.88, -wn.y);
          float isFlat = max(isFloor, isCeil);
          // masonry coordinates: big slabs on floors and ceilings, courses of blocks on walls and pillars
          vec2 bp = isFlat > 0.5 ? vMW.xz : vec2(abs(wn.x) > abs(wn.z) ? vMW.z : vMW.x, vMW.y);
          vec2 cell = isFlat > 0.5 ? vec2(2.7, 1.75) : vec2(1.3, 0.66);
          float row = floor(bp.y / cell.y);
          float cx = (bp.x + mHash2(vec2(row, 1.7)) * cell.x) / cell.x;
          vec2 id = vec2(floor(cx), row);
          float h1 = mHash2(id + 7.1);
          mBlockH = h1;
          vec2 fr = vec2(fract(cx) * cell.x, fract(bp.y / cell.y) * cell.y);
          float e = min(min(fr.x, cell.x - fr.x), min(fr.y, cell.y - fr.y));
          mMortar = 1.0 - smoothstep(0.014, 0.05, e);
          float bevel = (1.0 - smoothstep(0.05, 0.2, e)) * (1.0 - mMortar);
          // the carved diamonds survive on some blocks only (panels), not as wallpaper over everything
          mCarve = isFlat > 0.5 ? 0.2 : (h1 > 0.56 ? 1.0 : 0.32);
          // a hairline crack through a few slabs
          float crack = isFlat > 0.5 ? (1.0 - smoothstep(0.004, 0.02, abs(mNoise(vec3(bp * 0.8, h1 * 9.0)) - 0.5))) * step(0.55, h1) : 0.0;

          float flatL = ${base.toFixed(4)};
          vec3 stoneC = vec3(flatL) * vec3(${warm[0].toFixed(3)}, ${warm[1].toFixed(3)}, ${warm[2].toFixed(3)}) * diffuse;
          // carved trim and floor inlay (the builders tint them lighter) read as worn bronze-gold edging
          float trimK = smoothstep(1.15, 1.45, diffuse.r);
          stoneC *= mix(vec3(1.0), vec3(1.55, 1.12, 0.62), trimK * 0.8);
          diffuseColor.rgb = mix(diffuseColor.rgb * 0.5, stoneC, ${Math.min(1, flatten + 0.15).toFixed(3)});
          float tone = mix(0.7, 1.32, h1);
          diffuseColor.rgb *= tone * (1.0 - mMortar * 0.62) * (1.0 + bevel * 0.2) * (1.0 - crack * 0.5);
          // grime and erosion: large blotches, finer stains, and damp darkening near the floor
          float n1 = mNoise(vMW * 0.17) * 0.65 + mNoise(vMW * 0.37 + 5.3) * 0.35;
          float n2 = mNoise(vMW * 1.1 + 3.7);
          float n3 = mNoise(vec3(vMW.x * 0.6, vMW.y * 0.12, vMW.z * 0.6) + 9.1);
          float blotch = smoothstep(0.22, 0.78, n1);
          float streak = smoothstep(0.35, 0.8, n3);
          float g = ${grime.toFixed(3)};
          diffuseColor.rgb *= mix(1.0, mix(0.5, 1.4, blotch), g) * mix(1.0, mix(0.72, 1.18, n2), g);
          diffuseColor.rgb *= 1.0 - g * 0.32 * streak * (1.0 - smoothstep(0.0, 9.0, vMW.y));
          diffuseColor.rgb *= mix(0.7, 1.0, smoothstep(0.0, 1.6, vMW.y));
          // wet patches on the floor: darker, glossy, they pick the fires up as long streaks
          float puddle = smoothstep(0.34, 0.6, mNoise(vec3(vMW.x * 0.21, 1.3, vMW.z * 0.21)) * 0.7 + mNoise(vec3(vMW.x * 0.7, 2.9, vMW.z * 0.7)) * 0.3);
          mWet = isFloor * mix(0.35, 1.0, puddle);
          diffuseColor.rgb *= 1.0 - 0.42 * mWet;
        }`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        roughnessFactor = clamp(roughnessFactor + mMortar * 0.3, 0.04, 1.0);
        roughnessFactor = mix(roughnessFactor, 0.1 + 0.18 * mBlockH, mWet);`,
      )
      .replace('#include <normal_fragment_maps>', THREE.ShaderChunk.normal_fragment_maps.replace('mapN.xy *= normalScale;', 'mapN.xy *= normalScale * mCarve;'));
  });
  variants.set(key, m);
  return m;
}

/** swap every dwarven_stone material under `roots` for its weathered clone */
export function weatherStone(roots: THREE.Object3D[], o: WeatherOpts = {}): void {
  const srcSource = getTextureSet('dwarven_stone').map.source;
  const isStone = (m: THREE.Material): boolean => {
    const map = (m as THREE.MeshStandardMaterial).map;
    return !!map && map.source === srcSource && !m.userData.weathered;
  };
  for (const root of roots) {
    root.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh || !mesh.material) return;
      if (Array.isArray(mesh.material)) mesh.material = mesh.material.map((m) => (isStone(m) ? weatheredClone(m, o) : m));
      else if (isStone(mesh.material)) mesh.material = weatheredClone(mesh.material, o);
    });
  }
}

// ── light shafts, motes, pools ──────────────────────────────────────────────

/** drifting shaft clock: one uniform object shared by every shaft and mote cloud */
export const clock = { value: 0 };
export function tickLook(dt: number): void {
  clock.value += dt;
}

/**
 * A volumetric-looking shaft: a soft-edged cone (origin at the top centre, pointing down) with slow
 * dusty streaks. `intensity` is additive strength (0.5 reads clearly in the dark, 1 is bright).
 */
export function volumeShaft(height: number, topR: number, bottomR: number, color: number, intensity: number): THREE.Mesh {
  const g = new THREE.CylinderGeometry(topR, bottomR, height, 28, 1, true);
  g.translate(0, -height / 2, 0);
  const m = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    uniforms: { uColor: { value: new THREE.Color(color) }, uI: { value: intensity }, uT: clock },
    vertexShader: /* glsl */ `varying vec2 vUv; varying vec3 vN; varying vec3 vV; varying vec3 vP; varying float vD;
      void main(){ vUv = uv; vP = position; vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); vD = -mv.z; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: /* glsl */ `varying vec2 vUv; varying vec3 vN; varying vec3 vV; varying vec3 vP; varying float vD; uniform vec3 uColor; uniform float uI; uniform float uT;
      float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float n(vec2 p){ vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(h(i), h(i + vec2(1.0, 0.0)), f.x), mix(h(i + vec2(0.0, 1.0)), h(i + vec2(1.0, 1.0)), f.x), f.y); }
      void main(){
        float ndv = abs(dot(normalize(vN), normalize(vV)));
        float edge = pow(ndv, 0.9);
        float ang = atan(vP.z, vP.x);
        float streak = 0.55 * n(vec2(ang * 2.4, vP.y * 0.22 - uT * 0.05)) + 0.45 * n(vec2(ang * 5.0 + 3.0, vP.y * 0.5 + uT * 0.04));
        float top = vUv.y;                       // 1 at the top, 0 at the bottom
        float fade = smoothstep(0.0, 0.1, 1.0 - top) * (0.35 + 0.65 * top);
        // no blown-out wall of light when the camera is inside or right next to the cone
        float near = smoothstep(1.2, 6.0, vD);
        float a = edge * (0.25 + 0.95 * streak) * fade * uI * mix(0.12, 1.0, near);
        gl_FragColor = vec4(uColor * a, a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(g, m);
  mesh.userData.noAO = true;
  mesh.castShadow = false;
  mesh.renderOrder = 2;
  mesh.frustumCulled = false;
  mesh.name = 'moria_shaft';
  return mesh;
}

/** slow dust specks inside a vertical cylinder; one draw call, no CPU per frame */
export function dustMotes(center: THREE.Vector3, radius: number, height: number, count: number, color = 0xdfe8ff, size = 0.05): THREE.Points {
  const pos = new Float32Array(count * 3);
  const ph = new Float32Array(count * 3);
  let s = 12345 + Math.floor(center.x * 31 + center.z * 17);
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < count; i++) {
    const a = rnd() * Math.PI * 2;
    const r = Math.sqrt(rnd()) * radius;
    pos[i * 3] = center.x + Math.cos(a) * r;
    pos[i * 3 + 1] = center.y + rnd() * height;
    pos[i * 3 + 2] = center.z + Math.sin(a) * r;
    ph[i * 3] = rnd() * 6.28;
    ph[i * 3 + 1] = rnd() * 6.28;
    ph[i * 3 + 2] = 0.4 + rnd() * 0.8;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aPh', new THREE.BufferAttribute(ph, 3));
  const m = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uColor: { value: new THREE.Color(color) }, uT: clock, uSize: { value: size } },
    vertexShader: /* glsl */ `attribute vec3 aPh; uniform float uT; uniform float uSize; varying float vA;
      void main(){
        vec3 p = position;
        p.x += sin(uT * 0.21 * aPh.z + aPh.x) * 0.45;
        p.z += cos(uT * 0.17 * aPh.z + aPh.y) * 0.45;
        p.y += sin(uT * 0.13 * aPh.z + aPh.x * 2.0) * 0.35 - uT * 0.02 * aPh.z;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = clamp(uSize * 420.0 / max(0.5, -mv.z), 1.5, 7.0);
        vA = 0.35 + 0.65 * (0.5 + 0.5 * sin(uT * (0.8 + aPh.z) + aPh.y * 3.0));
      }`,
    fragmentShader: /* glsl */ `uniform vec3 uColor; varying float vA;
      void main(){
        vec2 c = gl_PointCoord - 0.5; float d = length(c);
        float a = smoothstep(0.5, 0.05, d) * vA * 0.7;
        gl_FragColor = vec4(uColor * a, a);
      }`,
  });
  const pts = new THREE.Points(g, m);
  pts.frustumCulled = false;
  pts.userData.noAO = true;
  pts.renderOrder = 3;
  pts.name = 'moria_motes';
  return pts;
}

let radialTex: THREE.CanvasTexture | null = null;
function radialTexture(): THREE.CanvasTexture {
  if (radialTex) return radialTex;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.4, 'rgba(255,255,255,0.45)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 128, 128);
  radialTex = new THREE.CanvasTexture(c);
  radialTex.colorSpace = THREE.SRGBColorSpace;
  radialTex.userData.shared = true;
  return radialTex;
}

/** a soft additive disc lying on a horizontal surface (`facing` 'up') or hanging in the air facing down */
export function glowDisc(radius: number, color: number, opacity: number, facing: 'up' | 'down' = 'up'): THREE.Mesh {
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(radius * 2, radius * 2),
    new THREE.MeshBasicMaterial({ map: radialTexture(), color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
  );
  m.rotation.x = facing === 'up' ? -Math.PI / 2 : Math.PI / 2;
  m.userData.noAO = true;
  m.castShadow = false;
  m.renderOrder = 2;
  m.material.userData.shared = true;
  return m;
}

// ── carved runes ────────────────────────────────────────────────────────────

/**
 * Cirth-like runes carved into stone: transparent canvas, dark engraved strokes with a faint light
 * edge below each stroke. `cols` x `rows` glyph cells, deterministic from `seed`.
 */
export function runeTexture(w: number, h: number, cols: number, rows: number, seed: number): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  g.clearRect(0, 0, w, h);
  let s = seed >>> 0;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const cw = w / cols;
  const ch = h / rows;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  const stroke = (pts: [number, number][], dx: number, dy: number, style: string, lw: number) => {
    g.strokeStyle = style;
    g.lineWidth = lw;
    g.beginPath();
    pts.forEach(([x, y], i) => (i ? g.lineTo(x + dx, y + dy) : g.moveTo(x + dx, y + dy)));
    g.stroke();
  };
  for (let r = 0; r < rows; r++) {
    for (let k = 0; k < cols; k++) {
      if (rnd() < 0.12) continue; // a gap between words
      const x0 = k * cw + cw * 0.25;
      const x1 = k * cw + cw * 0.75;
      const xm = (x0 + x1) / 2;
      const y0 = r * ch + ch * 0.18;
      const y1 = r * ch + ch * 0.82;
      const pts: [number, number][][] = [[[xm, y0], [xm, y1]]];
      const nb = 1 + Math.floor(rnd() * 3);
      for (let b = 0; b < nb; b++) {
        const yy = y0 + (y1 - y0) * (0.1 + rnd() * 0.8);
        const side = rnd() < 0.5 ? x0 : x1;
        const len = (y1 - y0) * (0.12 + rnd() * 0.22);
        const kind = rnd();
        if (kind < 0.4) pts.push([[xm, yy], [side, yy - len]]);
        else if (kind < 0.7) pts.push([[xm, yy], [side, yy + len]]);
        else pts.push([[xm, yy - len * 0.6], [side, yy], [xm, yy + len * 0.6]]);
      }
      const lw = Math.max(2, ch * 0.055);
      for (const p of pts) stroke(p, 0, lw * 0.9, 'rgba(255,248,230,0.22)', lw);
      for (const p of pts) stroke(p, 0, 0, 'rgba(18,16,14,0.78)', lw);
    }
    // a ruled line between rows
    g.fillStyle = 'rgba(18,16,14,0.45)';
    g.fillRect(cw * 0.1, r * ch + ch * 0.97, w - cw * 0.2, Math.max(1.5, ch * 0.02));
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

// ── material tint ───────────────────────────────────────────────────────────

const tinted = new Map<string, THREE.Material>();

/** swap every material of texture set `name` under `roots` for a clone whose colour is multiplied by `rgb` */
export function tintTextureSet(roots: THREE.Object3D[], name: Parameters<typeof getTextureSet>[0], rgb: [number, number, number]): void {
  const source = getTextureSet(name).map.source;
  const swap = (m: THREE.Material): THREE.Material => {
    const std = m as THREE.MeshStandardMaterial;
    if (!std.map || std.map.source !== source || m.userData.tinted) return m;
    const key = `${m.uuid}|${rgb.join(',')}`;
    let c = tinted.get(key);
    if (!c) {
      c = m.clone();
      c.onBeforeCompile = m.onBeforeCompile;
      c.customProgramCacheKey = m.customProgramCacheKey;
      (c as THREE.MeshStandardMaterial).color.multiply(new THREE.Color(rgb[0], rgb[1], rgb[2]));
      c.userData = { ...m.userData, shared: true, tinted: true };
      tinted.set(key, c);
    }
    return c;
  };
  for (const root of roots) {
    root.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh || !mesh.material) return;
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map(swap) : swap(mesh.material);
    });
  }
}
