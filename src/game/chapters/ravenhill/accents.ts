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

/**
 * Warm points: torchlit tower windows seen from outside (additive sprites, no lights, faded out near the
 * camera so they never wash a close view) and real flames on posts at the bridge head. The top floor's
 * openings get no sprite: the duel is fought inside them.
 */
export function warmGlints(level: LevelAPI): void {
  const { fx, engine } = level.ctx;
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
  // the tower's lower window openings (the builder's list: angle, base height), seen from outside through the gaps
  const tmp = new THREE.Vector3();
  for (const [a, wy] of [[0.55, 8.0], [2.4, 8.0], [4.2, 8.0]] as [number, number][]) {
    towerLocal(Math.cos(a) * TOWER.r * 0.9, CRAG.y + wy + 1.2, Math.sin(a) * TOWER.r * 0.9, tmp);
    add(tmp.x, tmp.y, tmp.z, 3.0, 3.8, 0.5);
  }
  // the door
  towerLocal(0, CRAG.y + 1.6, TOWER.r * 0.8, tmp);
  add(tmp.x, tmp.y, tmp.z, 3.4, 3.6, 0.55);
  // torches on dressed posts along the bridge's west stub (the part that survives the collapse): real
  // flames, and a warm light on the snow from the two nearest the head
  const postGeo = new THREE.BoxGeometry(0.42, 0.55, 0.42);
  const capGeo = new THREE.BoxGeometry(0.5, 0.1, 0.5);
  const postMat = new THREE.MeshStandardMaterial({ color: 0x80868f, roughness: 0.92 });
  const capMat = new THREE.MeshStandardMaterial({ color: 0xdfe8f2, roughness: 0.95 });
  let n = 0;
  for (const x of [BRIDGE.x0 + 2.5, BRIDGE.x0 + 9.5, BRIDGE.x0 + 16.5]) {
    for (const side of [-1, 1]) {
      const z = BRIDGE.z + side * 2.48;
      const base = BRIDGE.y + 1.2;
      const post = new THREE.Mesh(postGeo, postMat);
      post.position.set(x, base + 0.27, z);
      const cap = new THREE.Mesh(capGeo, capMat);
      cap.position.set(x, base + 0.6, z);
      post.castShadow = cap.castShadow = false;
      level.root.add(post, cap);
      fx.fire(tmp.set(x, base + 0.95, z), 0.5, { smoke: 0.25, light: n++ < 2 });
    }
  }
  const cam = engine.camera.position;
  let t = 0;
  level.onUpdate((dt) => {
    t += dt;
    for (const g of glints) {
      const d = g.s.position.distanceTo(cam);
      const near = d < 12 ? 0 : d > 34 ? 1 : (d - 12) / 22;
      (g.s.material as THREE.SpriteMaterial).opacity = g.base * near * (0.78 + 0.22 * Math.sin(t * 7.3 + g.ph) * Math.sin(t * 3.1 + g.ph * 1.7));
    }
  });
}

/**
 * Torches on the inside of the watchtower's tall west wall, lit for the first Bolg duel: a warm key on the
 * stone and the faces (the floor was lit by the sky alone, and read as a dim grey box). Each is an iron
 * bracket with a real flame; no collider, clear of the stair hole and the windows.
 */
export function towerTorches(level: LevelAPI): void {
  const { fx } = level.ctx;
  const iron = new THREE.MeshStandardMaterial({ color: 0x2c2a28, roughness: 0.7, metalness: 0.5 });
  const arm = new THREE.BoxGeometry(0.1, 0.1, 0.5);
  const cup = new THREE.CylinderGeometry(0.17, 0.1, 0.24, 8);
  const p = new THREE.Vector3();
  const y = CRAG.y + TOWER.floorTop + 2.1;
  for (const a of [Math.PI - 0.62, Math.PI + 0.1, Math.PI + 0.72]) {
    const r = TOWER.r - 0.9;
    const x = CRAG.x + Math.cos(a) * r;
    const z = CRAG.z + Math.sin(a) * r;
    const bracket = new THREE.Group();
    const barm = new THREE.Mesh(arm, iron);
    barm.position.z = 0.25;
    const bcup = new THREE.Mesh(cup, iron);
    bcup.position.set(0, 0.1, 0.5);
    bracket.add(barm, bcup);
    bracket.position.set(x, y, z);
    // the arm points into the tower (from the wall toward its centre)
    bracket.rotation.y = Math.atan2(CRAG.x - x, CRAG.z - z);
    bracket.traverse((o) => (o.castShadow = false));
    level.root.add(bracket);
    const f = p.set(x + Math.cos(a + Math.PI) * 0.5, y + 0.38, z + Math.sin(a + Math.PI) * 0.5);
    fx.fire(f, 0.45, { smoke: 0.2, light: true });
  }
}
