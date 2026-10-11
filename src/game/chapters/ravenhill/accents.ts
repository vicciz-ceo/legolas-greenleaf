/**
 * Ravenhill's accents: the stone stair cut into the crag's face (a route the eye can follow up to the
 * tower) and the few warm points of the references: torchlight in the watchtower's windows, torches on
 * the bridge head. Scenery only, no colliders.
 */
import * as THREE from 'three';
import type { LevelAPI } from '../../../core/types';
import { mat, type HeightFn } from '../../../world';
import { Rng } from '../../../core/rng';
import { BRIDGE, CRAG, GAP_X0, TOWER, towerLocal } from './layout';

/**
 * The crag stair: dressed slabs laid up the south-east face from the snow plain to the bridge-head
 * terrace, with a rim of snow on each. One instanced draw for the stone, one for the snow.
 */
export function cragStairs(level: LevelAPI, ground: HeightFn): void {
  const n = 46;
  const geo = new THREE.BoxGeometry(1, 1, 1);
  const stone = new THREE.InstancedMesh(geo, mat('stone_blocks', { key: 'rh_stairs', rgb: [0.8, 0.82, 0.88] }), n + 2);
  const snow = new THREE.InstancedMesh(geo, mat('snow', { key: 'rh_stair_snow' }), n + 2);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const p = new THREE.Vector3();
  const s = new THREE.Vector3();
  const rng = new Rng(77);
  let k = 0;
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    // a gentle S up the face: from the south (-z) round to the east, where the bridge starts
    const ang = -1.45 + 1.3 * t + Math.sin(t * 7) * 0.05;
    const r = 43 - 19 * t;
    const x = CRAG.x + Math.cos(ang) * r;
    const z = CRAG.z + Math.sin(ang) * r;
    const y = ground(x, z);
    const w = 2.3 + rng.float() * 0.5;
    const d = 1.5 + rng.float() * 0.3;
    e.set(0, -(ang + Math.PI / 2) + (rng.float() - 0.5) * 0.08, 0);
    q.setFromEuler(e);
    m.compose(p.set(x, y + 0.02, z), q, s.set(w, 0.46, d));
    stone.setMatrixAt(k, m);
    m.compose(p.set(x, y + 0.27, z), q, s.set(w * 0.86, 0.12, d * 0.8));
    snow.setMatrixAt(k, m);
    k++;
  }
  stone.count = snow.count = k;
  for (const o of [stone, snow]) {
    o.instanceMatrix.needsUpdate = true;
    o.castShadow = false;
    o.receiveShadow = true;
    o.frustumCulled = false;
    level.root.add(o);
  }
}

let glowTex: THREE.CanvasTexture | null = null;
function glowTexture(): THREE.CanvasTexture {
  if (glowTex) return glowTex;
  const S = 64;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const ctx = cv.getContext('2d')!;
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, 'rgba(255,236,190,1)');
  g.addColorStop(0.25, 'rgba(255,170,85,0.75)');
  g.addColorStop(1, 'rgba(255,120,40,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  glowTex = new THREE.CanvasTexture(cv);
  glowTex.colorSpace = THREE.SRGBColorSpace;
  return glowTex;
}

/** warm points: torchlit tower windows and torches on the bridge head (additive sprites, no lights) */
export function warmGlints(level: LevelAPI): void {
  const tex = glowTexture();
  const glints: { s: THREE.Sprite; ph: number; base: number }[] = [];
  const add = (x: number, y: number, z: number, w: number, h: number, o: number): void => {
    const sm = new THREE.SpriteMaterial({ map: tex, color: 0xffb060, transparent: true, opacity: o, depthWrite: false, blending: THREE.AdditiveBlending });
    const s = new THREE.Sprite(sm);
    s.position.set(x, y, z);
    s.scale.set(w, h, 1);
    s.renderOrder = 3;
    level.root.add(s);
    glints.push({ s, ph: Math.random() * 6.28, base: o });
  };
  // the tower's window openings (the builder's list: angle, base height), seen from outside through the gaps
  const tmp = new THREE.Vector3();
  for (const [a, wy] of [[0.55, 8.0], [2.4, 8.0], [4.2, 8.0], [1.2, 15.5], [3.4, 15.5], [5.3, 15.5]] as [number, number][]) {
    towerLocal(Math.cos(a) * TOWER.r * 0.9, CRAG.y + wy + 1.2, Math.sin(a) * TOWER.r * 0.9, tmp);
    add(tmp.x, tmp.y, tmp.z, 3.0, 3.8, 0.55);
  }
  // the door
  towerLocal(0, CRAG.y + 1.6, TOWER.r * 0.8, tmp);
  add(tmp.x, tmp.y, tmp.z, 3.4, 3.6, 0.6);
  // torches along the bridge's west stub (it is the part that survives the collapse)
  for (let x = BRIDGE.x0 + 2; x < GAP_X0 - 2; x += 8.5) {
    for (const side of [-1, 1]) add(x, BRIDGE.y + 1.85, BRIDGE.z + side * 2.5, 1.5, 1.7, 0.7);
  }
  let t = 0;
  level.onUpdate((dt) => {
    t += dt;
    for (const g of glints) (g.s.material as THREE.SpriteMaterial).opacity = g.base * (0.78 + 0.22 * Math.sin(t * 7.3 + g.ph) * Math.sin(t * 3.1 + g.ph * 1.7));
  });
}
