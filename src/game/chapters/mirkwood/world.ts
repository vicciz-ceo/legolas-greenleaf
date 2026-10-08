/**
 * Mirkwood: the world (geometry + colliders only, no gameplay).
 *
 * Colossal hand-placed oaks (instanced from the shared tree geometry) ring the three play areas,
 * an instanced forest of oaks and dead trees closes the valley, the floor is the 'mirkwood' terrain
 * theme with ferns, glowing mushrooms, mossy logs and dark rocks. Silk lines and web sheets are
 * strung between the trunks, cocoons hang from them, thin shafts of green-gold light fall through
 * the canopy, and a dark hollow choked with web closes the far end.
 *
 * `probe(hero, angle, h)` finds the bark surface of a hero oak (BVH ray test against its real
 * geometry): spiders crawl down those points, webs and anchors attach to them.
 */
import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { LevelAPI } from '../../../core/types';
import {
  addColliders, boulderField, cocoon, fallenLog, ferns, forest, lightShaft, mushrooms, rock, skeleton, tree, webCluster,
  type Built,
} from '../../../world';
import { Rng } from '../../../core/rng';
import {
  BRANCH, C2, CANOPY, CLEARINGS, CUT_COCOONS, DECOR_COCOONS, HEROES, HOLLOW, LINES, V, centerX, heightAt, inClearing, type HeroDef,
} from './layout';

export interface HeroTree extends HeroDef {
  y: number;
  /** base trunk radius (world m) */
  r0: number;
  height: number;
  bvh: MeshBVH;
  matrix: THREE.Matrix4;
  inverse: THREE.Matrix4;
}

export interface SurfaceHit {
  point: THREE.Vector3;
  normal: THREE.Vector3;
}

export interface CutCocoon {
  index: number;
  /** the hanging group (origin at its hang point) */
  object: THREE.Group;
  hang: THREE.Vector3;
  /** ground point below it, where Legolas stands to cut */
  spot: THREE.Vector3;
  cut: boolean;
}

export interface MirkWorld {
  heroes: HeroTree[];
  ground: (x: number, z: number) => number;
  probe(hero: number, angle: number, h: number): SurfaceHit;
  /** world point on a silk line */
  linePoint(line: number, t: number, out?: THREE.Vector3): THREE.Vector3;
  cocoons: CutCocoon[];
  /** the canopy web over the arena (falls when the anchors are cut) */
  canopy: { sheet: THREE.Mesh; center: THREE.Vector3; anchors: THREE.Vector3[]; lines: THREE.Mesh };
  /** the low bough Legolas drops from */
  bough: THREE.Object3D;
}

const _ray = new THREE.Ray();
const _o = new THREE.Vector3();
const _d = new THREE.Vector3();

export function buildWorld(level: LevelAPI): MirkWorld {
  const { physics } = level.ctx;
  const terrain = level.terrain({ size: 250, segments: 132, height: heightAt, style: 'forest', theme: 'mirkwood', material: 'leaves', center: [0, 38], patchiness: 0.45 });
  const ground = terrain.heightAt;
  const root = level.root;

  // ── hero oaks: instanced per variant from the shared tree geometry ───────
  const heroes: HeroTree[] = [];
  // instanced per (play-area cluster, variant): a cluster far behind the player is hidden, and
  // frustum culling can drop a cluster that is off screen (one InstancedMesh has one bounding sphere)
  const clusterOf = (i: number) => (i <= 4 ? 0 : i <= 8 ? 1 : 2);
  const clusterGroups = [new THREE.Group(), new THREE.Group(), new THREE.Group()];
  const clusterCenters = [V(0, 0, 0), V(0, 0, 0), V(0, 0, 0)];
  const clusterN = [0, 0, 0];
  const byVariant = new Map<string, number[]>();
  HEROES.forEach((h, i) => {
    const key = `${clusterOf(i)}:${h.seed % 4}`;
    const l = byVariant.get(key) ?? [];
    l.push(i);
    byVariant.set(key, l);
    clusterCenters[clusterOf(i)].add(V(h.x, 0, h.z));
    clusterN[clusterOf(i)]++;
  });
  clusterCenters.forEach((c, k) => c.multiplyScalar(1 / clusterN[k]));
  clusterGroups.forEach((g, k) => {
    g.name = `hero_oaks:${k}`;
    root.add(g);
  });
  level.onUpdate(() => {
    const p = level.ctx.player.position;
    for (let k = 0; k < 3; k++) clusterGroups[k].visible = Math.hypot(p.x - clusterCenters[k].x, p.z - clusterCenters[k].z) < 70;
  });
  const bvhs = new Map<number, MeshBVH>();
  const tmpQ = new THREE.Quaternion();
  for (const [key, list] of byVariant) {
    const variant = Number(key.split(':')[1]);
    const cluster = Number(key.split(':')[0]);
    const proto = tree('mirkwood_oak', variant);
    const meshes = proto.object.children as THREE.Mesh[];
    const bark = meshes[0];
    let bvh = bvhs.get(variant);
    if (!bvh) {
      bvh = new MeshBVH(bark.geometry, { indirect: true });
      bvhs.set(variant, bvh);
    }
    for (const m of meshes) {
      // the trees' own web cards read as flat polygons in this light: our strand webs replace them
      if (m.renderOrder === 2) continue;
      const im = new THREE.InstancedMesh(m.geometry, m.material, list.length);
      im.castShadow = m.castShadow;
      im.receiveShadow = m.receiveShadow;
      im.userData.noAO = m.userData.noAO;
      im.renderOrder = m.renderOrder;
      im.onBeforeRender = m.onBeforeRender;
      im.name = `hero_oak:${m.name || 'part'}`;
      list.forEach((hi, k) => {
        const h = HEROES[hi];
        const y = ground(h.x, h.z) - 0.25 * h.scale;
        const mat = new THREE.Matrix4().compose(V(h.x, y, h.z), tmpQ.setFromAxisAngle(V(0, 1, 0), h.rot), V(h.scale, h.scale, h.scale));
        im.setMatrixAt(k, mat);
        if (m === bark) {
          heroes[hi] = { ...h, y, r0: proto.trunkRadius * h.scale, height: proto.height * h.scale, bvh: bvh!, matrix: mat, inverse: mat.clone().invert() };
        }
      });
      im.instanceMatrix.needsUpdate = true;
      im.computeBoundingSphere();
      clusterGroups[cluster].add(im);
    }
    for (const hi of list) {
      const h = heroes[hi];
      addColliders(physics, [{ kind: 'cyl', x: h.x, z: h.z, r: h.r0 * 0.85, y0: h.y - 1, y1: h.y + 22, opts: { walkable: false, material: 'wood', tag: 'tree' } }]);
    }
  }

  /** bark surface of hero `hi` at world height ground+h, on the side facing world angle `angle` (atan2(z, x)) */
  function probe(hi: number, angle: number, h: number): SurfaceHit {
    const t = heroes[hi];
    const wy = ground(t.x, t.z) + h;
    _o.set(t.x + Math.cos(angle) * 40, wy, t.z + Math.sin(angle) * 40).applyMatrix4(t.inverse);
    _d.set(-Math.cos(angle), 0, -Math.sin(angle)).transformDirection(t.inverse);
    _ray.set(_o, _d);
    const hit = t.bvh.raycastFirst(_ray, THREE.DoubleSide);
    if (hit && hit.face) {
      const point = hit.point.clone().applyMatrix4(t.matrix);
      const normal = hit.face.normal.clone().transformDirection(t.matrix);
      if (normal.x * Math.cos(angle) + normal.z * Math.sin(angle) < 0) normal.negate();
      // keep normals mostly horizontal (bark ridges) so a climbing spider does not flip
      normal.y *= 0.5;
      normal.normalize();
      return { point, normal };
    }
    const r = t.r0 * (1 - 0.3 * Math.min(1, h / 25));
    return { point: V(t.x + Math.cos(angle) * r, wy, t.z + Math.sin(angle) * r), normal: V(Math.cos(angle), 0, Math.sin(angle)) };
  }

  const angleTo = (hi: number, x: number, z: number) => Math.atan2(z - heroes[hi].z, x - heroes[hi].x);

  // ── silk lines between trunks ───────────────────────────────────────────
  const lineEnds: [THREE.Vector3, THREE.Vector3][] = LINES.map(([a, b, ha, hb]) => {
    const A = probe(a, angleTo(a, heroes[b].x, heroes[b].z), ha).point;
    const B = probe(b, angleTo(b, heroes[a].x, heroes[a].z), hb).point;
    return [A, B];
  });
  const linePoint = (line: number, t: number, out = new THREE.Vector3()) => {
    const [A, B] = lineEnds[line];
    out.lerpVectors(A, B, t);
    out.y -= Math.sin(Math.PI * t) * 0.9; // the strand sags
    return out;
  };
  const silk = new StrandBuf();
  LINES.forEach((_, li) => {
    silk.thread(V(0, 0, 0), V(0, 0, 0), 0.04, 0, 10, (f, o) => linePoint(li, f, o));
    // finer strands braided alongside
    silk.thread(V(0, 0, 0), V(0, 0, 0), 0.016, 0, 10, (f, o) => linePoint(li, f, o).add(_d.set(0, 0.12 * Math.sin(f * 9), 0.06)));
    silk.thread(V(0, 0, 0), V(0, 0, 0), 0.012, 0, 10, (f, o) => linePoint(li, f, o).add(_d.set(0.05, -0.1 * Math.sin(f * 7 + 1), -0.04)));
  });

  // ── webs: strands, not sheets. Thin silk prisms merged into one mesh ───────
  const strands = new StrandBuf();
  const webGeos: THREE.BufferGeometry[] = [];
  let webMat: THREE.Material | null = null;
  const addWeb = (m: THREE.Mesh) => {
    webMat ??= m.material as THREE.Material;
    m.updateMatrixWorld(true);
    const g = m.geometry.clone().applyMatrix4(m.matrixWorld);
    m.geometry.dispose();
    webGeos.push(g);
  };
  const rng = new Rng(4242);
  /** a tangle of silk between two trunks: crossing threads, sagging threads, a few thick cables */
  const tangle = (a: number, b: number, h0: number, h1: number, n: number) => {
    const aa = angleTo(a, heroes[b].x, heroes[b].z);
    const ab = angleTo(b, heroes[a].x, heroes[a].z);
    for (let i = 0; i < n; i++) {
      const ya = h0 + rng.float() * (h1 - h0);
      const yb = h0 + rng.float() * (h1 - h0);
      const pa = probe(a, aa + (rng.float() - 0.5) * 0.9, ya).point;
      const pb = probe(b, ab + (rng.float() - 0.5) * 0.9, yb).point;
      strands.thread(pa, pb, i % 7 === 0 ? 0.03 : 0.009 + rng.float() * 0.01, 0.4 + rng.float() * 1.6, 6);
    }
  };
  /** a funnel web at the foot of a trunk: threads from the bark down to the litter */
  const funnel = (hi: number, a: number) => {
    const top: THREE.Vector3[] = [];
    for (let k = 0; k < 5; k++) top.push(probe(hi, a + (k - 2) * 0.16, 1.4 + rng.float() * 2.2).point);
    const out = V(Math.cos(a), 0, Math.sin(a));
    for (let k = 0; k < 14; k++) {
      const t = top[k % top.length];
      const d = 1.2 + rng.float() * 2.4;
      const side = (rng.float() - 0.5) * 2.6;
      const gx = t.x + out.x * d - out.z * side;
      const gz = t.z + out.z * d + out.x * side;
      strands.thread(t, V(gx, ground(gx, gz) + 0.04, gz), 0.004 + rng.float() * 0.004, 0.15, 4);
    }
    for (let k = 0; k < 6; k++) strands.thread(top[k % 5], top[(k + 2) % 5].clone().add(V(0, -0.5, 0)), 0.004, 0.25, 4);
  };
  tangle(0, 4, 1.5, 9.5, 26);
  tangle(1, 3, 2.5, 10, 26);
  tangle(0, 2, 6, 14, 14);
  tangle(5, 7, 2, 9, 24);
  tangle(6, 8, 3, 11, 24);
  tangle(9, 11, 1.2, 9, 28);
  tangle(10, 12, 2.0, 9, 28);
  for (let i = 0; i < HEROES.length; i++) funnel(i, rng.float() * Math.PI * 2);

  // ── the canopy: a great orb web over the arena, framed by four trunks ─────
  const cIdx = CANOPY.heroes;
  const cc = V(0, 0, 0);
  for (const hi of cIdx) cc.add(V(heroes[hi].x, 0, heroes[hi].z));
  cc.multiplyScalar(1 / cIdx.length);
  const corners = cIdx.map((hi) => probe(hi, angleTo(hi, cc.x, cc.z), CANOPY.height).point);
  const canopyCenter = V(cc.x, 0, cc.z);
  canopyCenter.y = corners.reduce((s, p) => s + p.y, 0) / corners.length - 2.6;
  const anchors = CANOPY.anchors.map((hi) => corners[cIdx.indexOf(hi)].clone());
  const orb = new StrandBuf();
  const NR = 30;
  const rim: THREE.Vector3[] = [];
  for (let i = 0; i < NR; i++) {
    const e = (i / NR) * corners.length;
    const k = Math.floor(e);
    const c0 = corners[k];
    const c1 = corners[(k + 1) % corners.length];
    const p = c0.clone().lerp(c1, e - k);
    p.y -= Math.sin(Math.PI * (e - k)) * 0.8; // frame threads sag between the trunks
    rim.push(p);
  }
  for (let k = 0; k < corners.length; k++) orb.thread(corners[k], corners[(k + 1) % corners.length], 0.06, 0.8, 10);
  const along = (i: number, f: number, out: THREE.Vector3) => {
    const r = rim[i % NR];
    out.lerpVectors(canopyCenter, r, f);
    out.y = canopyCenter.y + (r.y - canopyCenter.y) * Math.pow(f, 0.65);
    return out;
  };
  for (let i = 0; i < NR; i++) orb.thread(canopyCenter, rim[i], 0.022, 0, 8, (f, o) => along(i, f, o));
  const RINGS = 22;
  for (let j = 1; j <= RINGS; j++) {
    for (let i = 0; i < NR; i++) {
      const f0 = (j + i / NR) / (RINGS + 1.5);
      const f1 = (j + (i + 1) / NR) / (RINGS + 1.5);
      orb.thread(along(i, f0, V(0, 0, 0)), along(i + 1, f1, V(0, 0, 0)), 0.011, 0.03, 1);
    }
  }
  // the hub and a few broken, dangling threads
  for (let i = 0; i < 18; i++) {
    const a = along(Math.floor(rng.float() * NR), 0.2 + rng.float() * 0.75, V(0, 0, 0));
    orb.thread(a, a.clone().add(V((rng.float() - 0.5) * 0.6, -1 - rng.float() * 3.5, (rng.float() - 0.5) * 0.6)), 0.008, 0, 3);
  }
  const silkMat = new THREE.MeshStandardMaterial({ color: 0xd8d4c6, roughness: 0.45, emissive: 0x2a2a24, emissiveIntensity: 0.6, side: THREE.DoubleSide });
  const canopySheet = new THREE.Mesh(orb.geometry(), silkMat);
  canopySheet.name = 'canopy_web';
  canopySheet.castShadow = true;
  canopySheet.userData.noAO = true;
  root.add(canopySheet);
  // guy-lines from the hub to each trunk (they fall with it)
  const guy = new StrandBuf();
  for (const p of corners) guy.thread(canopyCenter.clone().add(V(0, 0.3, 0)), p.clone().add(V(0, 0.4, 0)), 0.045, 0.3, 8);
  const canopyLines = new THREE.Mesh(guy.geometry(), silkMat);
  canopyLines.name = 'canopy_lines';
  root.add(canopyLines);

  // ── the low bough Legolas drops from ────────────────────────────────────
  const boughStart = probe(4, angleTo(4, BRANCH.from.x, BRANCH.from.z), 8.2).point;
  const boughEnd = V(BRANCH.from.x, ground(BRANCH.from.x, BRANCH.from.z) + BRANCH.from.y - 0.55, BRANCH.from.z).add(V(0.6, 0.2, 2.2));
  const boughLen = boughStart.distanceTo(boughEnd) + 1.5;
  const bough = fallenLog(boughLen, 0.42, 7, { mossy: true });
  {
    const o = bough.object;
    const mid = boughStart.clone().lerp(boughEnd, 0.5);
    o.position.copy(mid);
    o.position.y -= 0.42 * 0.9; // the log's origin sits under its axis
    const dir = boughEnd.clone().sub(boughStart).normalize();
    o.quaternion.setFromUnitVectors(V(1, 0, 0), dir);
    root.add(o);
  }

  // ── cocoons ─────────────────────────────────────────────────────────────
  const decor: THREE.Object3D[] = [];
  DECOR_COCOONS.forEach(([line, t, drop], i) => {
    const c = cocoon({ seed: 10 + i, drop, length: 1.45 + (i % 3) * 0.1 });
    const p = linePoint(line, t);
    c.position.copy(p);
    c.rotation.y = i * 1.3;
    c.rotation.z = Math.sin(i * 2.1) * 0.05;
    decor.push(c);
  });
  // cocoons in the hollow
  for (let i = 0; i < 6; i++) {
    const c = cocoon({ seed: 40 + i, drop: 1.2 + (i % 3) * 1.4 });
    const x = HOLLOW.x - 9 + i * 3.6;
    const z = HOLLOW.z + 2 + (i % 2) * 2.5;
    c.position.set(x, ground(x, z) + 7.5 + (i % 2), z);
    c.rotation.y = i * 0.9;
    decor.push(c);
  }
  const cocoons: CutCocoon[] = CUT_COCOONS.map(([line, t], index) => {
    const hang = linePoint(line, t);
    const L = 1.5;
    const g0 = ground(hang.x, hang.z);
    const drop = Math.max(0.6, hang.y - g0 - L - 0.35);
    const c = cocoon({ seed: 70 + index, drop, length: L });
    // its loose web cards read as flat panes up close: the silk strand and wrapped body are enough
    for (const ch of [...c.children]) if (ch.renderOrder === 2) {
      ch.removeFromParent();
      (ch as THREE.Mesh).geometry.dispose();
    }
    c.position.copy(hang);
    c.rotation.y = index * 1.7 + 0.4;
    root.add(c);
    // stand beside it, on the side facing the larder's centre
    const dx = C2.x - hang.x;
    const dz = C2.z - hang.z;
    const dl = Math.hypot(dx, dz) || 1;
    const sx = hang.x + (dx / dl) * 1.0;
    const sz = hang.z + (dz / dl) * 1.0;
    const spot = V(sx, ground(sx, sz), sz);
    return { index, object: c, hang, spot, cut: false };
  });

  // ── forest floor dressing ───────────────────────────────────────────────
  const nearHero = (x: number, z: number, pad: number) => heroes.some((h) => Math.hypot(x - h.x, z - h.z) < h.r0 + pad);
  const corridor = (x: number, z: number) => Math.abs(x - centerX(z)) < 25 && z > -34 && z < 104;
  const woods = forest(
    { center: V(0, 0, 38), halfSize: [118, 120] },
    125,
    [{ kind: 'mirkwood_oak', weight: 4 }, { kind: 'dead', weight: 0.7 }],
    ground,
    { seed: 11, exclude: (x, z) => (corridor(x, z) && !(Math.abs(x - centerX(z)) > 21 && rng.float() < 0.5)) || nearHero(x, z, 8), scale: [0.95, 1.25], variants: 2, chunk: 80, lodNear: 26, lodFar: 110, spacing: 1.5, leafTint: [0.82, 0.95, 0.8] },
  );
  woods.object.traverse((o) => {
    if ((o as THREE.Mesh).isMesh && o.renderOrder === 2) o.visible = false;
  });
  root.add(woods.object);
  addColliders(physics, woods.colliders);

  const area = { center: V(0, 0, 40), halfSize: [44, 72] as [number, number] };
  root.add(ferns(area, 880, ground, { seed: 3, exclude: (x, z) => inClearing(x, z, -4) || nearHero(x, z, 0.5), tint: [0.42, 0.62, 0.4], clump: 0.7, scale: [0.7, 1.6] }));
  root.add(ferns({ center: V(0, 0, 38), halfSize: [16, 60] }, 200, ground, { seed: 5, exclude: (x, z) => inClearing(x, z, -7) || nearHero(x, z, 0.3), tint: [0.4, 0.58, 0.38], clump: 0.85, scale: [0.5, 1.1] }));
  root.add(mushrooms(area, 160, ground, { seed: 7, glow: true, capTint: [0.75, 1.0, 1.05], exclude: (x, z) => nearHero(x, z, -0.5) }));


  const rocks = boulderField({ center: V(0, 0, 40), halfSize: [34, 66] }, 34, [0.35, 1.5], ground, { seed: 9, kind: 'dark', moss: 0.85, exclude: (x, z) => inClearing(x, z, -3) || nearHero(x, z, 0.5), clump: 0.5 });
  root.add(rocks.object);
  addColliders(physics, rocks.colliders);

  const place = (b: Built, x: number, z: number, yaw = 0, dy = 0): Built => {
    b.object.position.set(x, ground(x, z) + dy, z);
    b.object.rotation.y = yaw;
    root.add(b.object);
    addColliders(physics, b.colliders, b.object);
    return b;
  };
  // fallen giants at the edges
  place(fallenLog(14, 0.9, 2), -20, 22, 0.4, -0.25);
  place(fallenLog(11, 0.75, 3), 24, 4, -1.1, -0.2);
  place(fallenLog(9, 0.6, 4), 22, 58, 0.9, -0.15);
  place(fallenLog(12, 0.8, 5), -24, 46, -0.3, -0.25);
  place(fallenLog(8, 0.55, 6), 13, -18, 0.2, -0.1);
  place(fallenLog(10, 0.7, 8), -21, 82, 1.3, -0.2);

  // ── the hollow: dark rock, webs, bones ──────────────────────────────────
  const hz = HOLLOW.z;
  const rockSpots: [number, number, number, number][] = [
    [-8, hz + 6, 4.5, 1], [0, hz + 9, 5.5, 2], [8, hz + 6, 4.8, 3], [-14, hz + 2, 3.2, 4], [14, hz + 3, 3.4, 5], [-4, hz + 12, 6, 6], [6, hz + 12, 5.5, 7],
  ];
  for (const [x, z, s, seed] of rockSpots) place(rock(s, seed, { kind: 'cliff', moss: 0.6 }), x, z, seed * 0.9, -s * 0.25);
  // the hollow choked with web: a dense 3D tangle of threads, sheets of it torn and hanging
  {
    const hr = new Rng(909);
    const box = (cx: number, cy: number, cz: number, hx: number, hy: number, hzz: number, n: number) => {
      const P = () => {
        const x = cx + (hr.float() * 2 - 1) * hx;
        const z = cz + (hr.float() * 2 - 1) * hzz;
        return V(x, ground(x, z) + cy + (hr.float() * 2 - 1) * hy, z);
      };
      for (let i = 0; i < n; i++) {
        const a = P();
        const b = P();
        strands.thread(a, b, 0.005 + hr.float() * 0.008, 0.2 + hr.float() * 0.8, 4);
        // curtains: threads hanging from the tangle
        if (i % 4 === 0) strands.thread(a, a.clone().add(V((hr.float() - 0.5) * 0.4, -1 - hr.float() * 3, (hr.float() - 0.5) * 0.4)), 0.004, 0, 2);
      }
    };
    box(HOLLOW.x, 4.5, hz + 2, 10, 4, 4, 520);
    box(HOLLOW.x - 9, 7, hz - 3, 4, 3.5, 3, 140);
    box(HOLLOW.x + 9, 7, hz - 2, 4, 3.5, 3, 140);
    box(HOLLOW.x, 2.5, hz - 1.5, 11, 2.5, 1.2, 160);
  }
  addWeb(webCluster([HOLLOW.x, ground(HOLLOW.x, hz) + 5, hz + 5.5], [8, 4, 1.5], 10, 3));
  for (let i = 0; i < 4; i++) {
    const x = -7 + i * 4.6;
    const z = hz - 4 + (i % 2) * 2;
    place(skeleton((['lying', 'sprawled', 'slumped', 'sitting'] as const)[i], 30 + i, 0.8), x, z, i * 1.4);
  }
  place(skeleton('sprawled', 50, 0.78), 14, 70, 2.1);
  place(skeleton('lying', 51, 0.82), -12, 41, 0.6);
  // the hollow is a wall: invisible boundary behind its mouth (webs and rock)
  physics.addBox(V(0, ground(0, hz) + 4, hz + 1), [16, 6, 1], 0, { blocksArrows: false, blocksCamera: false, walkable: false, tag: 'bound' });

  // ── valley bounds (invisible): the banks and trunks already close it, these make it certain ──
  for (let z = -40; z < 112; z += 8) {
    for (const s of [-1, 1]) {
      const x = centerX(z + 4) + s * 31;
      physics.addBox(V(x, ground(x, z + 4) + 3, z + 4), [1, 6, 4.4], 0, { blocksArrows: false, blocksCamera: false, walkable: false, tag: 'bound' });
    }
  }
  physics.addBox(V(0, ground(0, -33) + 3, -33), [32, 6, 1], 0, { blocksArrows: false, blocksCamera: false, walkable: false, tag: 'bound' });

  // ── light: green-gold shafts through the canopy ─────────────────────────
  const sun = V(-0.35, 0.82, 0.3).normalize();
  const shaftSpots: [number, number, number, number][] = [
    [2.5, 3, 2.6, 0.24], [-6, -6, 1.8, 0.16], [3, 20, 2.0, 0.18], [7, 35, 2.8, 0.24], [-2, 44, 1.6, 0.15], [-4, 72, 2.8, 0.22], [7, 79, 2.0, 0.16], [12, 12, 1.5, 0.12],
  ];
  for (const [x, z, r, k] of shaftSpots) {
    const len = 34;
    const s = lightShaft(len, r * 0.3, r, 0xd2e8a4, k);
    s.position.set(x, ground(x, z) + 0.2, z).addScaledVector(sun, len);
    s.quaternion.setFromUnitVectors(V(0, 1, 0), sun);
    root.add(s);
  }

  // ── merge the static silk and webs ──────────────────────────────────────
  if (webGeos.length && webMat) {
    const merged = mergeGeometries(webGeos.map((g) => (g.index ? g.toNonIndexed() : g)).map((g) => {
      for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k);
      return g;
    }));
    webGeos.forEach((g) => g.dispose());
    if (merged) {
      const webs = new THREE.Mesh(merged, webMat);
      webs.userData.noAO = true;
      webs.renderOrder = 2;
      webs.name = 'webs';
      root.add(webs);
    }
  }
  silk.append(strands);
  const silkMesh = new THREE.Mesh(silk.geometry(), silkMat);
  silkMesh.name = 'silk_lines';
  silkMesh.castShadow = false;
  silkMesh.userData.noAO = true;
  root.add(silkMesh);
  root.add(mergeStatic(decor, 'cocoons'));

  void CLEARINGS;
  return {
    heroes,
    ground,
    probe,
    linePoint,
    cocoons,
    canopy: { sheet: canopySheet, center: canopyCenter, anchors, lines: canopyLines },
    bough: bough.object,
  };
}

/** merge a set of static objects into one mesh per material (draw-call saver for decor) */
function mergeStatic(objs: THREE.Object3D[], name: string): THREE.Group {
  const groups = new Map<string, { mat: THREE.Material; geos: THREE.BufferGeometry[]; noAO: boolean; order: number; shadow: boolean; obr: THREE.Mesh['onBeforeRender'] }>();
  const out = new THREE.Group();
  out.name = name;
  const extra: THREE.Material[] = [];
  for (const o of objs) {
    o.updateMatrixWorld(true);
    o.traverse((c) => {
      const m = c as THREE.Mesh;
      if (!m.isMesh || m.renderOrder === 2) return;
      const mat = m.material as THREE.MeshStandardMaterial;
      const key = `${mat.type}:${mat.map?.uuid ?? ''}:${mat.color?.getHexString?.() ?? ''}:${mat.transparent}`;
      let g = groups.get(key);
      if (!g) groups.set(key, (g = { mat, geos: [], noAO: !!m.userData.noAO, order: m.renderOrder, shadow: m.castShadow, obr: m.onBeforeRender }));
      else if (g.mat !== mat) extra.push(mat);
      let geo = m.geometry.clone().applyMatrix4(m.matrixWorld);
      if (geo.index) geo = geo.toNonIndexed();
      for (const k of Object.keys(geo.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') geo.deleteAttribute(k);
      if (!geo.attributes.uv) geo.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(geo.attributes.position.count * 2), 2));
      g.geos.push(geo);
      m.geometry.dispose();
    });
  }
  for (const g of groups.values()) {
    const merged = mergeGeometries(g.geos);
    g.geos.forEach((x) => x.dispose());
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, g.mat);
    mesh.castShadow = g.shadow;
    mesh.receiveShadow = true;
    mesh.userData.noAO = g.noAO;
    mesh.renderOrder = g.order;
    mesh.onBeforeRender = g.obr;
    out.add(mesh);
  }
  for (const m of new Set(extra)) if (!m.userData?.shared) m.dispose();
  return out;
}

/** thin triangular silk prisms, appended into flat arrays (one merged mesh for thousands of threads) */
class StrandBuf {
  pos: number[] = [];
  nor: number[] = [];
  private readonly a = new THREE.Vector3();
  private readonly b = new THREE.Vector3();
  private readonly t = new THREE.Vector3();
  private readonly u = new THREE.Vector3();
  private readonly w = new THREE.Vector3();

  /** a thread from p to q, radius r, sagging by `sag` m, in `segs` pieces (or along a custom path) */
  thread(p: THREE.Vector3, q: THREE.Vector3, r: number, sag: number, segs: number, path?: (f: number, out: THREE.Vector3) => THREE.Vector3): void {
    const at = (f: number, out: THREE.Vector3) => {
      if (path) return path(f, out);
      out.lerpVectors(p, q, f);
      out.y -= Math.sin(Math.PI * f) * sag;
      return out;
    };
    at(0, this.a);
    for (let k = 1; k <= segs; k++) {
      at(k / segs, this.b);
      this.prism(this.a, this.b, r);
      this.a.copy(this.b);
    }
  }

  private prism(a: THREE.Vector3, b: THREE.Vector3, r: number): void {
    this.t.subVectors(b, a);
    if (this.t.lengthSq() < 1e-8) return;
    this.t.normalize();
    this.u.set(0, 1, 0);
    if (Math.abs(this.t.y) > 0.9) this.u.set(1, 0, 0);
    this.u.cross(this.t).normalize();
    this.w.crossVectors(this.t, this.u);
    const c: [number, number, number][] = [];
    for (let i = 0; i < 3; i++) {
      const ang = (i / 3) * Math.PI * 2;
      c.push([Math.cos(ang) * this.u.x + Math.sin(ang) * this.w.x, Math.cos(ang) * this.u.y + Math.sin(ang) * this.w.y, Math.cos(ang) * this.u.z + Math.sin(ang) * this.w.z]);
    }
    for (let i = 0; i < 3; i++) {
      const n0 = c[i];
      const n1 = c[(i + 1) % 3];
      const v = (o: THREE.Vector3, n: [number, number, number]) => {
        this.pos.push(o.x + n[0] * r, o.y + n[1] * r, o.z + n[2] * r);
        this.nor.push(n[0], n[1], n[2]);
      };
      v(a, n0); v(b, n0); v(b, n1);
      v(a, n0); v(b, n1); v(a, n1);
    }
  }

  append(o: StrandBuf): void {
    for (const x of o.pos) this.pos.push(x);
    for (const x of o.nor) this.nor.push(x);
  }

  geometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.computeBoundingSphere();
    return g;
  }
}
