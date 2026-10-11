/**
 * Ravenhill's set dressing: the ice of the falls (blue creases, bright flutes, a glow in the shade),
 * the spray at its foot, ruined dwarven stonework along the gorge rims (a viaduct over the gorge, watch
 * turrets, wall stubs), the valley's smoke columns and the bridges and towers of the far valley.
 *
 * Everything here is scenery: no collider is registered, nothing sits on a gameplay path.
 */
import * as THREE from 'three';
import type { LevelAPI } from '../../../core/types';
import { brokenBridge, ruins, type Built, type HeightFn } from '../../../world';
import { ruinedTurret } from './turret';
import { Rng, fbm2 } from '../../../core/rng';
import { smoothstep } from '../../../core/math';
import { FALLS_Z, V, riverX } from './layout';
import { farHeight } from './vista';

const noShadow = (o: THREE.Object3D) => o.traverse((c) => (c.castShadow = false));

// ─────────────────────────────────────────────────────────────────────────────
// The frozen waterfall
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Re-colour the builder's ice with baked vertex colours: bright snow-white flutes, deep blue-grey
 * creases, a frosted foot and translucent-blue icicles; and let the shaded north-facing curtain glow
 * faintly (it is lit by the sky only, so it was reading as a flat grey slab with dark spikes).
 */
export function dressFalls(falls: Built): void {
  const seen = new Set<THREE.Material>();
  falls.object.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const m = mesh.material as THREE.MeshPhysicalMaterial;
    // the builder's ice material (the only clear-coated one in the falls); the cliffs are stone
    if (!m.isMeshPhysicalMaterial || m.clearcoat < 0.5) return;
    const geo = mesh.geometry as THREE.BufferGeometry;
    const pos = geo.getAttribute('position') as THREE.BufferAttribute;
    const nrm = geo.getAttribute('normal') as THREE.BufferAttribute;
    const col = new Float32Array(pos.count * 3);
    const crease = new THREE.Color(0x5f8aae);
    const deep = new THREE.Color(0x35597d);
    const flute = new THREE.Color(0xe4f3ff);
    const frost = new THREE.Color(0xf4f9ff);
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);
      const ny = nrm.getY(i);
      // vertical flutes: bright ridges, blue creases (the same period as the builder's curtain)
      const f = 0.5 + 0.5 * Math.sin(x * 2.6 + fbm2(x * 0.3, y * 0.12, 2, 77) * 3);
      const f2 = 0.5 + 0.5 * Math.sin(x * 5.2 + y * 0.2 + 1.3);
      const k = Math.min(1, Math.max(0, f * 0.7 + f2 * 0.3 + (fbm2(x * 0.7, y * 0.4, 2, 78) - 0.1) * 0.35));
      c.copy(crease).lerp(flute, smoothstep(0.15, 0.85, k));
      // cold shadow pockets deep in the folds
      c.lerp(deep, (1 - smoothstep(0.0, 0.35, k)) * 0.45);
      // frosted, whiter near the foot (spray freezes) and on upward faces
      c.lerp(frost, smoothstep(5, 0, y) * 0.55 + Math.max(0, ny) * 0.35);
      // the icicles (thin, hanging) read lighter and bluer than the curtain
      if (z > 0.6 && Math.abs(nrm.getY(i)) < 0.8 && y > 10) c.lerp(flute, 0.35);
      col[i * 3] = c.r;
      col[i * 3 + 1] = c.g;
      col[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    if (!seen.has(m)) {
      seen.add(m);
      m.vertexColors = true;
      m.emissive = new THREE.Color(0x1d3a55);
      m.emissiveIntensity = 0.55;
      m.roughness = Math.min(m.roughness, 0.42);
      m.clearcoat = 0.45;
      m.needsUpdate = true;
    }
  });
}

/**
 * Frozen cascades down the gorge walls: ribbons of blue-white ice laid on the cliff surface (they follow
 * the terrain's height, so no gap shows), bright in the middle and fading into snow at the edges.
 */
export function iceFlows(level: LevelAPI, ground: HeightFn): void {
  const pos: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const flows: [number, number, number][] = [[-16, -1, 4.2], [4, 1, 3.4], [22, -1, 5], [30, 1, 4.2], [48, -1, 3.8], [-30, 1, 3.6], [-24, -1, 4.2]];
  const ice = new THREE.Color(0x6fa9d4);
  const bright = new THREE.Color(0xc4e2f7);
  const snow = new THREE.Color(0xdde6f0);
  const c = new THREE.Color();
  const ns = 18;
  const nw = 6;
  for (const [z0, side, w] of flows) {
    const base = pos.length / 3;
    for (let j = 0; j <= ns; j++) {
      const t = j / ns;
      for (let i = 0; i <= nw; i++) {
        const u = i / nw - 0.5;
        const ww = w * (0.6 + 0.8 * t);
        const z = z0 + u * ww + Math.sin(t * 5 + z0) * 0.9 * t;
        const x = riverX(z) + side * (39.5 - 21 * t);
        const gy = ground(x, z);
        const gx = (ground(x + 1, z) - ground(x - 1, z)) / 2;
        const gz = (ground(x, z + 1) - ground(x, z - 1)) / 2;
        const inv = 1 / Math.hypot(gx, 1, gz);
        const off = 0.28;
        pos.push(x - gx * inv * off, gy + inv * off, z - gz * inv * off);
        const edge = 1 - Math.pow(Math.abs(u) * 2, 2.2);
        const fl = 0.5 + 0.5 * Math.sin(u * 17 + z0 * 3 + t * 2);
        c.copy(ice).lerp(bright, fl * 0.7).lerp(snow, 1 - Math.min(1, edge * 1.6));
        c.lerp(snow, Math.max(0, 0.5 - t * 3));
        col.push(c.r, c.g, c.b);
      }
    }
    for (let j = 0; j < ns; j++)
      for (let i = 0; i < nw; i++) {
        const a = base + j * (nw + 1) + i;
        idx.push(a, a + 1, a + nw + 1, a + 1, a + nw + 2, a + nw + 1);
      }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.32, metalness: 0, emissive: 0x1d3a55, emissiveIntensity: 0.4, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
  m.name = 'rh_ice_flows';
  m.receiveShadow = true;
  m.castShadow = false;
  level.root.add(m);
}

let softTex: THREE.CanvasTexture | null = null;
/** a soft round puff (canvas, once) */
function softPuff(): THREE.CanvasTexture {
  if (softTex) return softTex;
  const S = 128;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const ctx = cv.getContext('2d')!;
  const img = ctx.createImageData(S, S);
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const u = (x + 0.5) / S - 0.5;
      const v = (y + 0.5) / S - 0.5;
      const d = Math.hypot(u, v) * 2;
      const n = fbm2(x * 0.045, y * 0.045, 3, 171) * 0.5 + 0.5;
      const a = Math.pow(Math.max(0, 1 - d), 1.6) * (0.55 + 0.6 * n);
      const k = (y * S + x) * 4;
      img.data[k] = img.data[k + 1] = img.data[k + 2] = 255;
      img.data[k + 3] = Math.round(Math.min(1, a) * 255);
    }
  ctx.putImageData(img, 0, 0);
  softTex = new THREE.CanvasTexture(cv);
  softTex.colorSpace = THREE.SRGBColorSpace;
  return softTex;
}

/** the spray and frost-smoke billowing off the falls' foot and along the cliff face */
export function fallsSpray(level: LevelAPI, rng: Rng): void {
  const tex = softPuff();
  const fx0 = riverX(FALLS_Z);
  const puffs: { s: THREE.Sprite; base: THREE.Vector3; ph: number; sz: number; o: number }[] = [];
  for (let i = 0; i < 16; i++) {
    const m = new THREE.SpriteMaterial({ map: tex, color: 0xdbe7f3, transparent: true, opacity: 0.3, depthWrite: false });
    const s = new THREE.Sprite(m);
    const fall = i < 11;
    const x = fx0 + (rng.float() - 0.5) * (fall ? 22 : 30);
    const y = fall ? 1.5 + rng.float() * 9 : 6 + rng.float() * 16;
    const z = FALLS_Z - (fall ? 1 + rng.float() * 9 : 0.5 + rng.float() * 3);
    const sz = (fall ? 12 : 9) + rng.float() * 10;
    s.position.set(x, y, z);
    s.scale.set(sz, sz * 0.7, 1);
    s.renderOrder = 2;
    level.root.add(s);
    puffs.push({ s, base: s.position.clone(), ph: rng.float() * 6.28, sz, o: 0.2 + rng.float() * 0.16 });
  }
  let t = 0;
  level.onUpdate((dt) => {
    t += dt;
    for (const p of puffs) {
      const w = 0.5 + 0.5 * Math.sin(t * 0.35 + p.ph);
      p.s.position.set(p.base.x + Math.sin(t * 0.21 + p.ph) * 1.6, p.base.y + w * 2.2, p.base.z);
      (p.s.material as THREE.SpriteMaterial).opacity = p.o * (0.65 + 0.5 * w);
    }
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Ruined stonework
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A ruined dwarven viaduct across the gorge: only the two ends are left, cantilevered from the rims (the
 * span over the river has fallen), so its piers stand on the cliffs and never in the river lane.
 */
export function gorgeViaduct(level: LevelAPI, z: number, deckY: number, span: number, ground: HeightFn): void {
  const b = brokenBridge(span, 5.5, { seed: 9, snow: true, depth: 26, gap: [0.16, 0.84] });
  b.object.position.set(riverX(z), deckY, z);
  b.object.rotation.y = 0.04;
  level.root.add(b.object);
  noShadow(b.object);
  void ground;
}

/** the flattest x on a strip across the rim (|dx| from..to of the river line), for a building's footing */
function flatSpot(ground: HeightFn, z: number, side: number, from: number, to: number): number {
  let best = from;
  let bs = Infinity;
  for (let d = from; d <= to; d += 2) {
    const x = riverX(z) + side * d;
    const s = Math.abs(ground(x + 4.5, z) - ground(x - 4.5, z)) + Math.abs(ground(x, z + 4.5) - ground(x, z - 4.5)) + Math.abs(ground(x, z) - ground(riverX(z) + side * 30, z)) * 0.05;
    if (s < bs) {
      bs = s;
      best = d;
    }
  }
  return riverX(z) + side * best;
}

/** low turrets and wall stubs on the cliff tops (the east and west rims of the gorge) */
export function rimStonework(level: LevelAPI, ground: HeightFn, rng: Rng): void {
  // small dwarven watch towers on the rims
  for (const [z, side, h, r] of [[16, -1, 17, 3.6], [44, 1, 21, 4.0], [60, -1, 15, 3.2], [-6, 1, 14, 3.4]] as [number, number, number, number][]) {
    const x = flatSpot(ground, z, side, 34, 62);
    const t = ruinedTurret({ radius: r, height: h, seed: 20 + Math.round(z), tall: side > 0 ? Math.PI : 0 });
    t.position.set(x, ground(x, z) - 0.8, z);
    level.root.add(t);
    noShadow(t);
  }
  // wall stubs, columns and arches along the rims
  for (const side of [-1, 1]) {
    const r = ruins({ center: V(riverX(30) + side * 40, 0, 26), halfSize: [8, 52] }, 16, ground, {
      seed: side > 0 ? 71 : 72,
      material: 'dark',
      grandeur: 0.85,
      exclude: (x, z) => {
        const sl = Math.abs(ground(x + 2, z) - ground(x - 2, z)) / 4 + Math.abs(ground(x, z + 2) - ground(x, z - 2)) / 4;
        return sl > 0.32 || Math.abs(x - riverX(z)) < 30;
      },
    });
    level.root.add(r.object);
    noShadow(r.object);
  }
  void rng;
}

/**
 * The watchtower's wings: ruined turrets clustered round the main tower on its blind (west) side, and a
 * pair of gate towers at the bridge head, so the crag reads as a dwarven fortress and not one lone drum.
 * Scenery only: the turrets stand clear of the plateau's gameplay spots (the door and the bridge head).
 */
export function towerWings(level: LevelAPI, ground: HeightFn, crag: { x: number; z: number; y: number }, bridgeZ: number, bridgeX0: number): void {
  const put = (x: number, z: number, r: number, h: number, seed: number, tall: number) => {
    const t = ruinedTurret({ radius: r, height: h, seed, tall });
    t.position.set(x, Math.max(ground(x, z), crag.y - 1.5) - 0.4, z);
    level.root.add(t);
    noShadow(t);
  };
  // wings round the tower (the door faces east, toward the bridge)
  for (const [dx, dz, r, h] of [[-9.5, 6.5, 3.4, 21], [-9.2, -7.5, 3.0, 16], [-1.5, 10.8, 3.2, 13], [0.5, -11.4, 3.6, 18], [-14.5, -0.5, 2.8, 12]] as [number, number, number, number][]) {
    put(crag.x + dx, crag.z + dz, r, h, 40 + Math.round(dx * 3 + dz), Math.atan2(dz, dx));
  }
  // gate towers flanking the bridge head
  for (const side of [-1, 1]) put(bridgeX0 - 1.5, bridgeZ + side * 6.2, 2.7, 12.5 + side * 2, 90 + side, side > 0 ? 0 : Math.PI);
}

/** far scenery: broken bridges over the valley river and dwarven watch towers on the far hills */
export function farRuins(level: LevelAPI, ground: HeightFn): void {
  const bridges: [number, number, number, number][] = [
    // x, z, length, yaw
    [10, -214, 64, 0.1],
    [60, -330, 78, -0.25],
    [-190, -250, 56, 0.5],
  ];
  for (const [x, z, len, yaw] of bridges) {
    const b = brokenBridge(len, 7, { seed: Math.round(len), snow: true, depth: 18, gap: len > 60 ? [0.42, 0.58] : undefined });
    b.object.position.set(x, farHeight(x, z) + 8.5, z);
    b.object.rotation.y = yaw;
    b.object.scale.setScalar(1.25);
    level.root.add(b.object);
    noShadow(b.object);
  }
  const towers: [number, number, number, number][] = [
    [-120, -200, 18, 5],
    [150, -240, 22, 5.5],
    [210, 40, 24, 6],
    [-240, 90, 20, 5.5],
    [-170, 210, 26, 6],
  ];
  for (const [x, z, h, r] of towers) {
    const t = ruinedTurret({ radius: r, height: h, seed: Math.round(x + z), thickness: 1.5, tall: x * 0.02 });
    t.position.set(x, (z < -150 || Math.hypot(x, z - 60) > 230 ? farHeight(x, z) : ground(x, z)) - 0.6, z);
    level.root.add(t);
    noShadow(t);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// The battle in the valley
// ─────────────────────────────────────────────────────────────────────────────

/** towering columns of black smoke over the battle, lit orange at their feet (sprites, no lights) */
export function battleSmoke(level: LevelAPI, rng: Rng): void {
  const tex = softPuff();
  const roots: [number, number, number][] = [[-70, -150, 1.0], [-20, -178, 1.3], [30, -160, 1.1], [95, -190, 1.2], [150, -150, 0.9], [-130, -190, 1.0]];
  const smoke: { s: THREE.Sprite; base: THREE.Vector3; ph: number; k: number }[] = [];
  const N = 11;
  for (const [x, z, sc] of roots) {
    for (let i = 0; i < N; i++) {
      const h = i / (N - 1);
      // a leaning column that thickens and thins out with height; black at the foot, ash-grey at the top
      const m = new THREE.SpriteMaterial({ map: tex, color: new THREE.Color().setHSL(0.6, 0.07, 0.07 + h * 0.3), transparent: true, opacity: 0.55 - h * 0.3, depthWrite: false, fog: true });
      const s = new THREE.Sprite(m);
      const sz = (12 + Math.sin(h * 3.0) * 16 + h * 22 + rng.float() * 6) * sc;
      s.position.set(x + Math.pow(h, 1.6) * 40 * sc + (rng.float() - 0.5) * 5, 6 + h * 125 * sc, z + (rng.float() - 0.5) * 5);
      s.scale.set(sz, sz * 1.15, 1);
      s.renderOrder = 1;
      level.root.add(s);
      smoke.push({ s, base: s.position.clone(), ph: rng.float() * 6.28, k: 0.5 + h });
    }
    // the fire at the foot: a warm glow (additive), no real light
    const gm = new THREE.SpriteMaterial({ map: tex, color: 0xff9a45, transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
    const gs = new THREE.Sprite(gm);
    gs.position.set(x, 4, z);
    gs.scale.set(15 * sc, 8 * sc, 1);
    gs.renderOrder = 3;
    level.root.add(gs);
    smoke.push({ s: gs, base: gs.position.clone(), ph: rng.float() * 6.28, k: 0 });
  }
  let t = 0;
  level.onUpdate((dt) => {
    t += dt;
    for (const p of smoke) {
      if (p.k === 0) {
        (p.s.material as THREE.SpriteMaterial).opacity = 0.65 + 0.2 * Math.sin(t * 5.3 + p.ph) * Math.sin(t * 2.1 + p.ph * 2);
      } else {
        p.s.position.x = p.base.x + Math.sin(t * 0.15 * p.k + p.ph) * 2.5;
      }
    }
  });
}
