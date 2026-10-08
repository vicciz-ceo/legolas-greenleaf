/**
 * Fallen and falling leaves for the golden woods: a ground litter of leaf clumps (one instanced mesh)
 * and a few dozen leaves drifting down through the light around the player (one instanced mesh,
 * CPU-animated). Both use the world's procedural foliage atlas (beech / oak / dead leaves).
 */
import * as THREE from 'three';
import type { LevelAPI } from '../../../core/types';
import { Rng } from '../../../core/rng';
import { getLeafAtlas, LEAF_CELLS, cellRect } from '../../../world/leafAtlas';
import { worldQuality } from '../../../world';

/** a flat clump of leaf quads using several atlas cells */
function clumpGeometry(): THREE.BufferGeometry {
  const rng = new Rng(8821);
  const cells = [LEAF_CELLS.beech, LEAF_CELLS.oak, LEAF_CELLS.dead, LEAF_CELLS.beech, LEAF_CELLS.birch, LEAF_CELLS.oak];
  const pos: number[] = [];
  const uv: number[] = [];
  const nor: number[] = [];
  const idx: number[] = [];
  const quads = 7;
  for (let i = 0; i < quads; i++) {
    const [u0, v0, u1, v1] = cellRect(cells[i % cells.length]);
    const s = 0.2 + rng.float() * 0.14;
    const cx = (rng.float() - 0.5) * 0.7;
    const cz = (rng.float() - 0.5) * 0.7;
    const yaw = rng.float() * Math.PI * 2;
    const tilt = (rng.float() - 0.5) * 0.35;
    const c = Math.cos(yaw);
    const sn = Math.sin(yaw);
    const base = pos.length / 3;
    const corners: [number, number][] = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    for (const [qx, qz] of corners) {
      const lx = qx * s;
      const lz = qz * s;
      pos.push(cx + lx * c - lz * sn, 0.02 + i * 0.004 + (lx * tilt), cz + lx * sn + lz * c);
      nor.push(0, 1, 0);
      uv.push(qx < 0 ? u0 : u1, qz < 0 ? v0 : v1);
    }
    idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

function leafMaterial(emissive: number): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    map: getLeafAtlas(),
    alphaTest: 0.46,
    side: THREE.DoubleSide,
    roughness: 0.85,
    metalness: 0,
    emissive: new THREE.Color(0x3a2a10),
    emissiveIntensity: emissive,
    envMapIntensity: 0.8,
  });
}

/** golden leaf litter over `count` clumps inside a box; `skip` rejects spots; instance colours give the autumn mix */
export function fallenLeaves(
  level: LevelAPI,
  area: { x: number; z: number; hx: number; hz: number },
  count: number,
  heightAt: (x: number, z: number) => number,
  skip: (x: number, z: number) => boolean,
  seed = 1,
): void {
  const q = worldQuality();
  const n = Math.round(count * (q === 'low' ? 0.5 : q === 'medium' ? 0.8 : 1));
  const rng = new Rng(seed * 977 + 3);
  const mesh = new THREE.InstancedMesh(clumpGeometry(), leafMaterial(0.25), n);
  const m = new THREE.Matrix4();
  const qn = new THREE.Quaternion();
  const e = new THREE.Euler();
  const sc = new THREE.Vector3();
  const pv = new THREE.Vector3();
  const col = new THREE.Color();
  // golds, ochres, russets, a little green
  const palette = [0xd8a23a, 0xc8842a, 0xb86a22, 0x9c5a24, 0xe0b850, 0x8a6a2a, 0x7d7a30, 0xc0902c];
  let k = 0;
  let guard = 0;
  while (k < n && guard++ < n * 12) {
    const x = area.x + (rng.float() * 2 - 1) * area.hx;
    const z = area.z + (rng.float() * 2 - 1) * area.hz;
    if (skip(x, z)) continue;
    e.set((rng.float() - 0.5) * 0.12, rng.float() * Math.PI * 2, (rng.float() - 0.5) * 0.12);
    qn.setFromEuler(e);
    const s = 0.8 + rng.float() * 0.9;
    sc.set(s, 1, s);
    pv.set(x, heightAt(x, z), z);
    m.compose(pv, qn, sc);
    mesh.setMatrixAt(k, m);
    col.setHex(palette[Math.floor(rng.float() * palette.length)]);
    col.multiplyScalar(0.8 + rng.float() * 0.5);
    mesh.setColorAt(k, col);
    k++;
  }
  mesh.count = k;
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.computeBoundingSphere();
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  mesh.userData.noAO = true;
  mesh.name = 'fallen_leaves';
  level.root.add(mesh);
}

/**
 * Leaves drifting down through the shafts of light around the player. `count` instances in a box that
 * follows the player; each falls with a sway and a tumble and wraps to the top when it lands.
 */
export function driftingLeaves(level: LevelAPI, count: number): void {
  const { player } = level.ctx;
  const q = worldQuality();
  const n = Math.round(count * (q === 'low' ? 0.4 : q === 'medium' ? 0.7 : 1));
  const rng = new Rng(404);
  // one quad per instance, UVs of a beech leaf
  const [u0, v0, u1, v1] = cellRect(LEAF_CELLS.beech);
  const g = new THREE.BufferGeometry();
  const s = 0.11;
  g.setAttribute('position', new THREE.Float32BufferAttribute([-s, 0, -s * 1.3, s, 0, -s * 1.3, s, 0, s * 1.3, -s, 0, s * 1.3], 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute([u0, v0, u1, v0, u1, v1, u0, v1], 2));
  g.setIndex([0, 2, 1, 0, 3, 2]);
  const mesh = new THREE.InstancedMesh(g, leafMaterial(0.9), n);
  mesh.frustumCulled = false;
  mesh.castShadow = false;
  mesh.userData.noAO = true;
  mesh.name = 'drifting_leaves';
  const palette = [0xf0c050, 0xe0a030, 0xc87a28, 0xd8b048];
  const col = new THREE.Color();
  const BOX = { x: 22, y: 12, z: 22 };
  const st = Array.from({ length: n }, () => ({
    x: (rng.float() * 2 - 1) * BOX.x,
    y: rng.float() * BOX.y,
    z: (rng.float() * 2 - 1) * BOX.z,
    vy: 0.35 + rng.float() * 0.45,
    ph: rng.float() * 6.28,
    sp: 0.6 + rng.float() * 1.2,
    rx: rng.float() * 6.28,
    rz: rng.float() * 6.28,
  }));
  for (let i = 0; i < n; i++) {
    col.setHex(palette[i % palette.length]);
    mesh.setColorAt(i, col);
  }
  level.root.add(mesh);
  const m = new THREE.Matrix4();
  const qn = new THREE.Quaternion();
  const e = new THREE.Euler();
  const pv = new THREE.Vector3();
  const one = new THREE.Vector3(1, 1, 1);
  let t = 0;
  level.onUpdate((dt) => {
    t += dt;
    const px = player.position.x;
    const py = player.position.y;
    const pz = player.position.z;
    for (let i = 0; i < n; i++) {
      const l = st[i];
      l.y -= l.vy * dt;
      if (l.y < -1) {
        l.y += BOX.y + 1;
        l.x = (rng.float() * 2 - 1) * BOX.x;
        l.z = (rng.float() * 2 - 1) * BOX.z;
      }
      const sway = Math.sin(t * l.sp + l.ph);
      // wrap around the player so the box follows without popping
      const wx = ((((l.x + sway * 0.9 - px) % (2 * BOX.x)) + 3 * BOX.x) % (2 * BOX.x)) - BOX.x;
      const wz = ((((l.z + Math.cos(t * l.sp * 0.8 + l.ph) * 0.7 - pz) % (2 * BOX.z)) + 3 * BOX.z) % (2 * BOX.z)) - BOX.z;
      pv.set(px + wx, py + l.y, pz + wz);
      e.set(l.rx + Math.sin(t * l.sp * 1.7 + l.ph) * 0.9, t * l.sp * 0.6 + l.ph, l.rz + Math.cos(t * l.sp * 1.3) * 0.9);
      qn.setFromEuler(e);
      m.compose(pv, qn, one);
      mesh.setMatrixAt(i, m);
    }
    mesh.instanceMatrix.needsUpdate = true;
  });
}
