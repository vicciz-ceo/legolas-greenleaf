/**
 * Moria's set dressing, built to keep the draw-call count flat: every helper merges its pieces into a
 * handful of meshes (one per material) however many items it places.
 *
 *   debrisKit        piles of helmets, shields, hafted weapons, planks, torn cloth, bones and fallen masonry
 *   flameField       a cluster of flames (crossed quads, one animated shader, one draw call) with fog fade
 *   firePools        warm additive pools on the floor under the fires (no light budget needed)
 *   fireHalos        soft additive glow sprites around every flame (one Points draw call)
 *   overheadBeams    the stone beams that tie the pillar tops together and vanish into the dark
 *   stoneBrazier     a stone pedestal with an iron bowl (merged into the kit it is given)
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mat, plain } from '../../../world';
import { MeshKit } from '../../../world/util';
import { Rng } from '../../../core/rng';
import { clock } from './look';

// ── debris ──────────────────────────────────────────────────────────────────

export interface PileSpec {
  x: number;
  z: number;
  /** spread radius (m) */
  r: number;
  /** items */
  n: number;
  /** 0..1 how much of the pile is weapons / armour (rest is masonry and planks) */
  gear?: number;
  /** floor height under the pile */
  y?: number;
}

/**
 * Scatter piles of the dead dwarves' gear and the fallen stone. Decorative only (no colliders), all
 * below ~0.4 m so it never trips the player.
 */
export function debrisKit(piles: PileSpec[], seed: number): THREE.Group {
  const rng = new Rng(seed);
  const kit = new MeshKit();
  const iron = mat('metal_dark', { key: 'moriaDebrisIron', rgb: [0.85, 0.72, 0.6] });
  const bronze = mat('metal_dark', { key: 'moriaDebrisBronze', rgb: [1.5, 1.1, 0.7] });
  const wood = mat('old_wood', { key: 'moriaDebrisWood', rgb: [0.62, 0.56, 0.5] });
  const rock = mat('rock', { key: 'moriaDebrisRock', rgb: [0.42, 0.42, 0.47] });
  const cloth = mat('cloth_wool', { key: 'moriaDebrisCloth', rgb: [0.34, 0.1, 0.08] });
  const bone = mat('bone', { key: 'moriaDebrisBone', rgb: [0.8, 0.76, 0.68] });
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const p = new THREE.Vector3();
  const one = new THREE.Vector3(1, 1, 1);
  const put = (mt: THREE.Material, g: THREE.BufferGeometry, x: number, y: number, z: number, rx: number, ry: number, rz: number, tile = 0.6) => {
    e.set(rx, ry, rz, 'YXZ');
    q.setFromEuler(e);
    m.compose(p.set(x, y, z), q, one);
    kit.add(mt, g, m.clone(), { tile });
  };
  for (const pile of piles) {
    const y0 = pile.y ?? 0;
    const gear = pile.gear ?? 0.55;
    for (let i = 0; i < pile.n; i++) {
      // denser toward the middle
      const a = rng.float() * Math.PI * 2;
      const d = pile.r * Math.pow(rng.float(), 1.6);
      const x = pile.x + Math.cos(a) * d;
      const z = pile.z + Math.sin(a) * d * 0.8;
      const lift = Math.max(0, 1 - d / pile.r) * 0.12 * rng.float();
      const roll = rng.float();
      if (roll < gear * 0.2) {
        // a helmet, open side down
        const g = new THREE.SphereGeometry(0.15 + rng.float() * 0.04, 8, 5, 0, Math.PI * 2, 0, Math.PI * 0.58);
        put(rng.float() < 0.3 ? bronze : iron, g, x, y0 + lift + 0.03, z, (rng.float() - 0.5) * 1.2, rng.float() * 6, (rng.float() - 0.5) * 1.2, 0.4);
      } else if (roll < gear * 0.36) {
        // a round shield, lying tilted, with its boss
        const r = 0.3 + rng.float() * 0.1;
        const tx = (rng.float() - 0.5) * 0.7;
        const tz = (rng.float() - 0.5) * 0.7;
        put(wood, new THREE.CylinderGeometry(r, r, 0.045, 14), x, y0 + lift + 0.06, z, tx, rng.float() * 6, tz, 0.8);
        put(rng.float() < 0.4 ? bronze : iron, new THREE.SphereGeometry(0.075, 8, 4, 0, Math.PI * 2, 0, Math.PI * 0.5), x, y0 + lift + 0.095, z, tx, 0, tz, 0.3);
      } else if (roll < gear * 0.62) {
        // a hafted weapon: axe, hammer or spear
        const len = 0.9 + rng.float() * 0.9;
        const yaw = rng.float() * 6;
        const tilt = (rng.float() - 0.3) * 0.28;
        put(wood, new THREE.CylinderGeometry(0.02, 0.022, len, 5), x, y0 + lift + 0.05, z, 0, yaw, Math.PI / 2 + tilt, 0.6);
        const hx = x + Math.cos(yaw) * len * 0.5;
        const hz = z - Math.sin(yaw) * len * 0.5;
        const kind = rng.float();
        if (kind < 0.4) put(iron, new THREE.BoxGeometry(0.2, 0.2, 0.035), hx, y0 + lift + 0.08, hz, 0, yaw, tilt, 0.4);
        else if (kind < 0.7) put(iron, new THREE.BoxGeometry(0.2, 0.1, 0.1), hx, y0 + lift + 0.07, hz, 0, yaw, tilt, 0.4);
        else put(iron, new THREE.ConeGeometry(0.04, 0.26, 4), hx, y0 + lift + 0.06, hz, 0, yaw, -Math.PI / 2 + tilt, 0.3);
      } else if (roll < gear * 0.8) {
        // torn cloth and a banner scrap
        put(cloth, new THREE.BoxGeometry(0.5 + rng.float() * 0.6, 0.012, 0.35 + rng.float() * 0.4), x, y0 + lift + 0.02, z, 0, rng.float() * 6, (rng.float() - 0.5) * 0.15, 0.6);
      } else if (roll < gear) {
        // bones: a long bone, now and then a skull
        if (rng.float() < 0.28) {
          put(bone, new THREE.SphereGeometry(0.085, 8, 6), x, y0 + lift + 0.08, z, 0, 0, 0, 0.3);
          put(bone, new THREE.BoxGeometry(0.1, 0.06, 0.07), x + 0.03, y0 + lift + 0.04, z, 0, rng.float() * 6, 0, 0.3);
        } else {
          put(bone, new THREE.CylinderGeometry(0.014, 0.018, 0.3 + rng.float() * 0.2, 5), x, y0 + lift + 0.03, z, 0, rng.float() * 6, Math.PI / 2, 0.3);
        }
      } else if (roll < gear + (1 - gear) * 0.35) {
        // a broken plank or beam end, leaning on the heap
        const len = 0.7 + rng.float() * 1.3;
        put(wood, new THREE.BoxGeometry(len, 0.045, 0.14 + rng.float() * 0.08), x, y0 + lift + 0.1 + rng.float() * 0.08, z, 0, rng.float() * 6, (rng.float() - 0.5) * 0.7, 0.8);
      } else {
        // fallen masonry
        const s = 0.14 + rng.float() * rng.float() * 0.6;
        put(rock, new THREE.BoxGeometry(s * (0.8 + rng.float() * 0.6), s * (0.5 + rng.float() * 0.5), s * (0.7 + rng.float() * 0.6)), x, y0 + lift + s * 0.22, z, (rng.float() - 0.5) * 0.6, rng.float() * 6, (rng.float() - 0.5) * 0.6, 1.2);
      }
    }
  }
  const g = kit.build({ name: 'moria_debris', castShadow: false });
  g.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh) mesh.receiveShadow = true;
  });
  return g;
}

// ── stone braziers (merged) ─────────────────────────────────────────────────

/** a squat stone pedestal with an iron bowl and a bed of coals; `top` is where the flame stands */
export function stoneBrazier(kit: MeshKit, x: number, z: number, scale = 1, y = 0): THREE.Vector3 {
  const stone = mat('dwarven_stone', { key: 'moriaPedestal', rgb: [1.0, 1.0, 1.05] });
  const iron = mat('metal_dark', { key: 'moriaBowl', rgb: [0.8, 0.7, 0.62] });
  const coal = plain(0xff6a1a, { roughness: 0.9, emissive: 0xff5a14, emissiveIntensity: 2.0, key: 'moriaCoal' });
  const s = scale;
  kit.box(stone, [0.62 * s, 0.14 * s, 0.62 * s], [x, y + 0.07 * s, z], 0, { tile: 0.6 });
  kit.box(stone, [0.4 * s, 0.62 * s, 0.4 * s], [x, y + 0.45 * s, z], 0, { tile: 0.6 });
  kit.box(stone, [0.52 * s, 0.1 * s, 0.52 * s], [x, y + 0.81 * s, z], Math.PI / 4, { tile: 0.6 });
  kit.add(iron, new THREE.CylinderGeometry(0.34 * s, 0.17 * s, 0.26 * s, 14, 1, true), new THREE.Matrix4().makeTranslation(x, y + 1.0 * s, z), { tile: 0.5 });
  kit.add(iron, new THREE.TorusGeometry(0.34 * s, 0.018 * s, 5, 16), new THREE.Matrix4().makeRotationX(Math.PI / 2).setPosition(x, y + 1.13 * s, z), { tile: 0.5 });
  const bed = new THREE.CircleGeometry(0.3 * s, 12);
  bed.rotateX(-Math.PI / 2);
  kit.add(coal, bed, new THREE.Matrix4().makeTranslation(x, y + 1.08 * s, z), { tile: 0.5 });
  return new THREE.Vector3(x, y + 1.12 * s, z);
}

// ── flames, halos, pools ────────────────────────────────────────────────────

export interface FlameSpec {
  x: number;
  y: number;
  z: number;
  /** flame height (m) */
  h: number;
  /** flame width (m) */
  w: number;
}

const FLAME_VS = /* glsl */ `
  attribute float aPh;
  varying vec2 vUv;
  varying float vPh;
  #include <fog_pars_vertex>
  void main(){
    vUv = uv; vPh = aPh;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }`;
const FLAME_FS = /* glsl */ `
  varying vec2 vUv;
  varying float vPh;
  uniform float uT;
  uniform float uI;
  #include <fog_pars_fragment>
  float h2(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float n2(vec2 p){ vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(h2(i), h2(i + vec2(1.0, 0.0)), f.x), mix(h2(i + vec2(0.0, 1.0)), h2(i + vec2(1.0, 1.0)), f.x), f.y); }
  void main(){
    float y = vUv.y;
    float x = (vUv.x - 0.5) * 2.0;
    float t = uT * 1.9 + vPh * 6.28;
    float n = n2(vec2(x * 2.2 + vPh * 9.0, y * 2.6 - t * 1.3)) * 0.65 + n2(vec2(x * 5.0, y * 5.5 - t * 2.4)) * 0.35;
    float sway = (n - 0.5) * 0.9 * y + sin(t * 0.9 + y * 2.0) * 0.12 * y;
    float width = mix(0.82, 0.08, pow(y, 0.7));
    float body = 1.0 - smoothstep(width * 0.55, width, abs(x - sway));
    float f = body * (1.0 - smoothstep(0.55, 1.0, y + (n - 0.5) * 0.5)) * (0.55 + 0.75 * n);
    vec3 hot = vec3(1.0, 0.86, 0.5);
    vec3 mid = vec3(1.0, 0.42, 0.08);
    vec3 col = mix(mid, hot, smoothstep(0.35, 0.95, f) * (1.0 - y)) * f * uI;
    float a = f;
    gl_FragColor = vec4(col, a);
    #ifdef USE_FOG
      #ifdef FOG_EXP2
        float ff = 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
      #else
        float ff = smoothstep(fogNear, fogFar, vFogDepth);
      #endif
      gl_FragColor.rgb *= 1.0 - ff;
    #endif
  }`;

/** a cluster of flames: two crossed quads each, one shared animated shader, one draw call */
export function flameField(list: FlameSpec[], intensity = 1.6): THREE.Mesh {
  const geos: THREE.BufferGeometry[] = [];
  list.forEach((f, i) => {
    for (let k = 0; k < 2; k++) {
      const g = new THREE.PlaneGeometry(f.w, f.h);
      g.translate(0, f.h / 2, 0);
      g.rotateY(k * Math.PI / 2 + (i % 5) * 0.4);
      g.translate(f.x, f.y, f.z);
      const n = g.getAttribute('position').count;
      const ph = new Float32Array(n).fill(((i * 0.6180339) % 1) + k * 0.13);
      g.setAttribute('aPh', new THREE.BufferAttribute(ph, 1));
      geos.push(g);
    }
  });
  const merged = mergeGeometries(geos, false)!;
  const m = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    fog: true,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uT: clock, uI: { value: intensity } }]),
    vertexShader: FLAME_VS,
    fragmentShader: FLAME_FS,
  });
  m.uniforms.uT = clock;
  const mesh = new THREE.Mesh(merged, m);
  mesh.frustumCulled = false;
  mesh.userData.noAO = true;
  mesh.castShadow = false;
  mesh.renderOrder = 3;
  mesh.name = 'moria_flames';
  return mesh;
}

let haloTex: THREE.CanvasTexture | null = null;
function haloTexture(): THREE.CanvasTexture {
  if (haloTex) return haloTex;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.18, 'rgba(255,255,255,0.55)');
  gr.addColorStop(0.5, 'rgba(255,255,255,0.14)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 128, 128);
  haloTex = new THREE.CanvasTexture(c);
  haloTex.colorSpace = THREE.SRGBColorSpace;
  haloTex.userData.shared = true;
  return haloTex;
}

/** warm glow sprites hovering at each flame (world-size, additive, fog-faded). One draw call. */
export function fireHalos(points: THREE.Vector3[], size: number, color = 0xff8a3a, opacity = 0.5): THREE.Points {
  const pos = new Float32Array(points.length * 3);
  points.forEach((p, i) => pos.set([p.x, p.y, p.z], i * 3));
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const m = new THREE.PointsMaterial({
    map: haloTexture(),
    color,
    size,
    sizeAttenuation: true,
    transparent: true,
    opacity,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const pts = new THREE.Points(g, m);
  pts.frustumCulled = false;
  pts.userData.noAO = true;
  pts.renderOrder = 3;
  pts.name = 'moria_halos';
  return pts;
}

/** warm pools of light on the floor: one merged mesh of soft additive quads */
export function firePools(list: { x: number; z: number; r: number; y?: number }[], color = 0xff8a3a, opacity = 0.2): THREE.Mesh {
  const geos = list.map((p) => {
    const g = new THREE.PlaneGeometry(p.r * 2, p.r * 2);
    g.rotateX(-Math.PI / 2);
    g.translate(p.x, (p.y ?? 0) + 0.035, p.z);
    return g;
  });
  const merged = mergeGeometries(geos, false)!;
  const mesh = new THREE.Mesh(
    merged,
    new THREE.MeshBasicMaterial({ map: haloTexture(), color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
  );
  mesh.frustumCulled = false;
  mesh.userData.noAO = true;
  mesh.castShadow = false;
  mesh.renderOrder = 2;
  mesh.name = 'moria_pools';
  return mesh;
}

// ── overhead beams ──────────────────────────────────────────────────────────

/** stone beams tying the pillar capitals together, so the dark above the hall reads as vaulted masonry */
export function overheadBeams(kit: MeshKit, xs: number[], zs: number[], y: number, thick = 1.5): void {
  const m = mat('dwarven_stone', { key: 'moriaBeam', rgb: [0.8, 0.8, 0.86] });
  const x0 = Math.min(...xs) - 1;
  const x1 = Math.max(...xs) + 1;
  const z0 = Math.min(...zs) - 1;
  const z1 = Math.max(...zs) + 1;
  for (const x of xs) kit.box(m, [thick, thick, z1 - z0], [x, y, (z0 + z1) / 2], 0, { tile: 2 });
  for (const z of zs) kit.box(m, [x1 - x0, thick, thick], [(x0 + x1) / 2, y, z], 0, { tile: 2 });
  // a lighter secondary lattice between the main beams
  for (let i = 0; i < xs.length - 1; i++) {
    const cx = (xs[i] + xs[i + 1]) / 2;
    kit.box(m, [thick * 0.6, thick * 0.6, z1 - z0], [cx, y + thick * 0.2, (z0 + z1) / 2], 0, { tile: 2 });
  }
}
