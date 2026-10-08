/**
 * createHumanoid(spec): Humanoid — one parametric humanoid for every HumanoidKind.
 *
 * Shared per (kind, seed bucket ≤4, armour, helmet): rig, sculpted body+clothing+gear geometry
 * (3 LODs), hair cards, eyes (see humanoid/build.ts). Per instance: bones, SkinnedMeshes that
 * share those geometries, cloned materials (for flash), sockets and weapons.
 *
 * Draw calls per humanoid: body (skin + clothing + gear, 1), hair (1), eyes (1), + weapons.
 *
 * Notes for gameplay:
 *  - bows always go to the LEFT hand (setWeapon('hand_r', 'elven_bow') is redirected); the right
 *    hand draws the string. Drive aim/draw/aimPitch through animate().
 *  - for twin knives call setWeapon('hand_r','elven_knives') and setWeapon('hand_l','elven_knives');
 *    the bow is then shown stowed on the back and the sheathed knives disappear from the quiver.
 *  - attack.t is the 0..1 progress of the attack; dead is 0..1 progress of the fall.
 */
import * as THREE from 'three';
import type { AnimInput, Humanoid, HumanoidBone, HumanoidKind, HumanoidSpec, SocketName, WeaponKind } from '../core/types';
import { makeSkinnedMesh } from './kit/rig';
import { cloneCreatureMaterial } from './kit/material';
import { getHumanoidAssets, prebuildHumanoids, type HumanoidAssets } from './humanoid/build';
import { HumanoidAnimator } from './humanoid/animator';
import { createWeapon, disposeWeapon } from './weapons';
import { gaitFrequency as kitGaitFrequency, fastBones } from './kit/anim';
import { resolveKind, ALL_KINDS } from './humanoid/registry';

export type { KindDef, KindContext } from './humanoid/types';
export { registerKind, resolveKind, ALL_KINDS } from './humanoid/registry';

const BOWS: WeaponKind[] = ['elven_bow', 'orc_bow', 'uruk_bow'];

export interface HumanoidExt extends Humanoid {
  /** reset animation state (springs, landing…) and seek the internal clock / gait phase (cycles) */
  resetAnimation(time?: number, phase?: number): void;
  /** gait cycle frequency (cycles/s) this humanoid uses at a speed */
  gaitFrequency(speed: number): number;
  /** triangle count of the current LOD (body + hair + eyes) */
  readonly triangles: number;
  readonly lod: 0 | 1 | 2;
  /** build time of the shared assets (ms; 0 when cached) */
  readonly buildMs: number;
  readonly assets: HumanoidAssets;
}

const _m1 = new THREE.Matrix4();
const _m2 = new THREE.Matrix4();
const _v = new THREE.Vector3();
const _one = new THREE.Vector3(1, 1, 1);

export function createHumanoid(spec: HumanoidSpec): HumanoidExt {
  const t0 = performance.now();
  const A = getHumanoidAssets(spec);
  const buildMs = performance.now() - t0;
  const def = A.def;
  const P = A.P;
  const inst = A.rig.instantiate();
  // bones are driven by quaternions only: skip three's quaternion → Euler sync on every write
  fastBones(inst.bones);
  const scale = spec.scale ?? 1;

  const root = new THREE.Group();
  root.name = `humanoid:${spec.kind}`;
  const body = new THREE.Group();
  body.name = 'rig';
  body.scale.setScalar(scale);
  root.add(body);
  body.add(inst.root);

  const dbg = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('kitdebug') ?? '' : '';
  const bodyMat = dbg.includes('normals') ? (new THREE.MeshNormalMaterial({ side: THREE.DoubleSide }) as unknown as THREE.MeshPhysicalMaterial) : cloneCreatureMaterial(A.bodyMat);
  const hairMat = dbg.includes('hairbasic')
    ? (new THREE.MeshBasicMaterial({ vertexColors: true, map: A.hairMat.map, alphaTest: 0.45, side: THREE.DoubleSide }) as unknown as THREE.MeshPhysicalMaterial)
    : dbg.includes('hairstd')
      ? (new THREE.MeshStandardMaterial({ vertexColors: true, map: A.hairMat.map, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.6 }) as unknown as THREE.MeshPhysicalMaterial)
      : A.hairMat.clone();
  if (dbg.includes('hairnoaniso')) hairMat.anisotropy = 0;
  if (dbg.includes('hairnosheen')) hairMat.sheen = 0;
  const radius = P.H * 0.75;
  const center: [number, number, number] = [0, P.H * 0.5, 0];
  const bodyMesh = makeSkinnedMesh(A.lods[0].body, bodyMat, inst, radius, center);
  bodyMesh.name = 'body';
  body.add(bodyMesh);
  let hairMesh: THREE.SkinnedMesh | null = null;
  if (A.lods[0].hair) {
    hairMesh = makeSkinnedMesh(A.lods[0].hair, hairMat, inst, radius, center);
    hairMesh.name = 'hair';
    body.add(hairMesh);
  }
  const eyeMesh = makeSkinnedMesh(A.eyes, A.eyeMat, inst, radius, center);
  eyeMesh.name = 'eyes';
  eyeMesh.castShadow = false;
  body.add(eyeMesh);
  if (dbg.includes('noeyes')) eyeMesh.visible = false;
  if (dbg.includes('nohair') && hairMesh) hairMesh.visible = false;

  // ── sockets ──
  const B = inst.byName;
  const sockets = {} as Record<SocketName, THREE.Object3D>;
  const handScale = P.s >= 1.2 ? P.s : 1;
  for (const sd of ['l', 'r'] as const) {
    const f = P.hand[sd];
    const o = new THREE.Object3D();
    o.name = `socket_hand_${sd}`;
    const a = P.palm * 0.78;
    const c = 0.022 * P.s;
    o.position.set(f.L.x * a + f.N.x * c, f.L.y * a + f.N.y * c, f.L.z * a + f.N.z * c);
    const X = new THREE.Vector3().crossVectors(f.T, f.L);
    o.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(X, f.T, f.L));
    o.scale.setScalar(handScale);
    B[`hand_${sd}`].add(o);
    sockets[`hand_${sd}`] = o;
  }
  const mkSocket = (name: SocketName, bone: string, pos: [number, number, number], euler: [number, number, number]) => {
    const o = new THREE.Object3D();
    o.name = `socket_${name}`;
    const bj = P.j[bone];
    o.position.set(pos[0] - bj[0], pos[1] - bj[1], pos[2] - bj[2]);
    o.rotation.set(euler[0], euler[1], euler[2]);
    o.scale.setScalar(handScale);
    B[bone].add(o);
    sockets[name] = o;
  };
  const s = P.s;
  const g = Math.sqrt(P.build.bulk);
  mkSocket('back', 'chest', [0.02 * s, P.j.chest[1] + 0.12 * s, -0.17 * s * P.build.chest * g], [0, 0, 0.5]);
  mkSocket('hip_l', 'hips', [P.hipX + 0.1 * s * g, P.j.thigh_l[1] + 0.06 * s, 0.02 * s], [Math.PI - 0.25, 0, 0.15]);
  mkSocket('hip_r', 'hips', [-P.hipX - 0.1 * s * g, P.j.thigh_l[1] + 0.06 * s, 0.02 * s], [Math.PI - 0.25, 0, -0.15]);
  mkSocket('head', 'head', [0, P.H - 0.005 * s, 0], [0, 0, 0]);
  mkSocket('chest', 'chest', [0, P.j.chest[1] + 0.12 * s, 0.12 * s * P.build.chest * g], [0, 0, 0]);

  // ── extras objects ──
  const extras: { obj: THREE.Object3D; small: boolean; stowFor?: { hand: 'hand_r' | 'hand_l'; weapon: WeaponKind } }[] = [];
  for (const e of A.objects) {
    const obj = e.make();
    const parent = e.socket ? sockets[e.socket as SocketName] : e.bone ? B[e.bone] : B.chest;
    if (e.bone && !e.socket) {
      // objects made in model space → bone local
      const bj = P.j[e.bone];
      obj.position.x -= bj[0];
      obj.position.y -= bj[1];
      obj.position.z -= bj[2];
    }
    (parent ?? B.chest).add(obj);
    extras.push({ obj, small: !!e.small, stowFor: obj.userData.stowFor });
  }

  // ── weapons ──
  const held: Record<'hand_r' | 'hand_l', { kind: WeaponKind; obj: THREE.Object3D | null }> = {
    hand_r: { kind: 'none', obj: null },
    hand_l: { kind: 'none', obj: null },
  };
  const stowed: { kind: WeaponKind; obj: THREE.Object3D }[] = [];
  const defaults = { right: spec.weapon ?? def.weapons.right ?? 'none', left: spec.offhand ?? def.weapons.left ?? 'none' };
  const anim = new HumanoidAnimator(A.rig, P, def.anim, inst.bones, body);
  let wseed = (spec.seed ?? 0) + 1;

  const refreshStow = () => {
    for (const st of stowed) {
      st.obj.parent?.remove(st.obj);
      disposeWeapon(st.obj);
    }
    stowed.length = 0;
    const want = new Set<WeaponKind>([...(def.weapons.back ?? [])]);
    for (const k of [defaults.left, defaults.right]) if (BOWS.includes(k)) want.add(k);
    for (const k of want) {
      if (k === 'none' || held.hand_l.kind === k || held.hand_r.kind === k) continue;
      const obj = createWeapon(k, wseed, def.weapons.style);
      if (BOWS.includes(k)) {
        obj.position.set(0, 0.0, 0);
        obj.rotation.set(0, Math.PI / 2, 0);
      }
      sockets.back.add(obj);
      stowed.push({ kind: k, obj });
    }
    for (const e of extras) if (e.stowFor) e.obj.visible = held[e.stowFor.hand].kind !== e.stowFor.weapon && lod < 2;
    anim.hasBow = BOWS.includes(held.hand_l.kind);
    anim.gripL = held.hand_l.kind !== 'none';
    anim.gripR = held.hand_r.kind !== 'none';
  };

  const setWeapon = (hand: 'hand_r' | 'hand_l', w: WeaponKind) => {
    if (hand === 'hand_r' && BOWS.includes(w)) {
      // bows live in the left hand
      setWeapon('hand_l', w);
      if (held.hand_r.kind !== 'none' && BOWS.includes(held.hand_r.kind)) setWeapon('hand_r', 'none');
      return;
    }
    const cur = held[hand];
    if (cur.kind === w && cur.obj) return;
    if (cur.obj) {
      cur.obj.parent?.remove(cur.obj);
      disposeWeapon(cur.obj);
    }
    cur.kind = w;
    cur.obj = null;
    if (w !== 'none') {
      const obj = createWeapon(w, wseed++, def.weapons.style);
      obj.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) m.castShadow = castShadow;
      });
      sockets[hand].add(obj);
      cur.obj = obj;
    }
    refreshStow();
  };

  let castShadow = true;
  let lod: 0 | 1 | 2 = 0;
  setWeapon('hand_r', defaults.right);
  setWeapon('hand_l', defaults.left);

  // bow string follows the draw hand
  const bowModel = new THREE.Matrix4();
  anim.bowHook = (pull, nockModel, arrowVisible) => {
    const bow = held.hand_l.obj?.userData.bow as { setDraw(v: number): void; setNock(p: THREE.Vector3 | null): void; showArrow(v: boolean): void } | undefined;
    if (!bow) return;
    bow.setDraw(pull);
    if (nockModel) {
      const ps = anim.ps;
      const hi = ps.i('hand_l');
      // model transform of the bow = hand bone (model) × socket local
      _m1.compose(ps.modelP[hi], ps.modelQ[hi], _one);
      const so = sockets.hand_l;
      _m2.compose(so.position, so.quaternion, so.scale);
      bowModel.multiplyMatrices(_m1, _m2).invert();
      _v.copy(nockModel).applyMatrix4(bowModel);
      bow.setNock(_v);
    } else bow.setNock(null);
    bow.showArrow(arrowVisible);
  };

  let lodVersion = A.lodVersion;
  const applyLod = () => {
    lodVersion = A.lodVersion;
    const level = lod;
    bodyMesh.geometry = A.lods[level].body;
    if (hairMesh) {
      const hg = A.lods[level].hair;
      hairMesh.visible = !!hg;
      if (hg) hairMesh.geometry = hg;
    }
    eyeMesh.visible = level < 2;
    for (const e of extras) e.obj.visible = (!e.small || level < 2) && (!e.stowFor || held[e.stowFor.hand].kind !== e.stowFor.weapon);
  };

  let flashT = 0;
  const flashColor = new THREE.Color();
  const emissiveBase = bodyMat.emissive ? bodyMat.emissive.clone() : new THREE.Color();

  const bones = {} as Record<HumanoidBone, THREE.Bone>;
  for (const n of ['root', 'hips', 'spine', 'chest', 'neck', 'head', 'shoulder_l', 'upperarm_l', 'forearm_l', 'hand_l', 'shoulder_r', 'upperarm_r', 'forearm_r', 'hand_r', 'thigh_l', 'shin_l', 'foot_l', 'thigh_r', 'shin_r', 'foot_r'] as HumanoidBone[]) bones[n] = B[n];

  const h: HumanoidExt = {
    root,
    kind: spec.kind,
    height: P.H * scale,
    bones,
    assets: A,
    buildMs,
    get triangles() {
      return A.lods[lod].tris;
    },
    get lod() {
      return lod;
    },
    socket(name: SocketName) {
      return sockets[name];
    },
    setWeapon,
    weaponObject(hand) {
      return held[hand].obj;
    },
    animate(dt: number, input: AnimInput) {
      if (lodVersion !== A.lodVersion) applyLod();
      anim.update(dt, input);
      if (flashT > 0) {
        flashT = Math.max(0, flashT - dt);
        const k = flashT / 0.15;
        bodyMat.emissive.copy(emissiveBase).lerp(flashColor, k);
        hairMat.emissive.copy(flashColor).multiplyScalar(k * 0.6);
      }
    },
    flash(color = 0xff3a2a) {
      flashColor.setHex(color);
      flashT = 0.15;
      bodyMat.emissive.copy(flashColor);
    },
    setCastShadow(v: boolean) {
      castShadow = v;
      root.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) m.castShadow = v && m.name !== 'eyes';
      });
    },
    setLod(level: 0 | 1 | 2) {
      if (level === lod) return;
      lod = level;
      anim.setLod(level);
      applyLod();
    },

    resetAnimation(time = 0, phase = 0) {
      anim.reset(time, phase);
    },
    gaitFrequency(speed: number) {
      return kitGaitFrequency(speed, anim.B.legLen) * anim.B.style.cadence;
    },
    dispose() {
      root.parent?.remove(root);
      for (const hnd of ['hand_r', 'hand_l'] as const) if (held[hnd].obj) disposeWeapon(held[hnd].obj!);
      for (const st of stowed) disposeWeapon(st.obj);
      bodyMat.dispose();
      hairMat.dispose();
      inst.skeleton.dispose();
      for (const e of extras) {
        e.obj.traverse((o) => {
          const m = o as THREE.Mesh;
          if (m.isMesh && !m.geometry.userData.shared) m.geometry.dispose();
        });
      }
    },
  };
  return h;
}

/**
 * Warm-up for loading screens: builds the shared assets (LOD0-2) for the given kinds × seeds.
 * Sculpting runs on the main thread one kind per macrotask; the meshing of every kind runs in
 * parallel in the kit's worker pool (`kit/workers.ts`), so N kinds cost about N / cores mesh
 * times. Kinds already built are skipped; `createHumanoid` afterwards is a cache hit.
 * Falls back to main-thread meshing when workers are unavailable.
 */
export async function preloadHumanoids(
  kinds: HumanoidKind[],
  opts: { seeds?: number[]; armor?: number; helmet?: boolean; onProgress?: (frac: number) => void } = {},
): Promise<void> {
  const seeds = opts.seeds ?? [0];
  const specs: HumanoidSpec[] = [];
  for (const kind of kinds) for (const seed of seeds) specs.push({ kind, seed, armor: opts.armor, helmet: opts.helmet });
  await prebuildHumanoids(specs, opts.onProgress);
}

/** every kind (for tools) */
export function humanoidKinds(): HumanoidKind[] {
  return ALL_KINDS.slice();
}

void resolveKind;
