/**
 * LAB ONLY: the reference-sheet stance (`anim=sheet`) and head-centred portrait framing.
 * Imported by the `*.lab.ts` files only; nothing in the game depends on it.
 *
 * `anim=sheet` poses a humanoid the way every `docs/refs/<id>/<id>_turnaround.jpg` shows it:
 *   - feet about hip-to-shoulder width apart, flat on the ground (y = 0), knees nearly straight;
 *   - arms hanging ~18 degrees out of the body with a slight elbow bend (hunched kinds hang them a
 *     little forward, like the sheets' brutes and trolls);
 *   - one-handed blades, axes, maces and clubs hang blade-down beside the thigh, tilted forward and
 *     out (and tilted further until the lowest point clears the ground);
 *   - bows and torches are held vertically at the grip (the bow's string toward the back); shields hang
 *     upright on the arm with their FACE TO THE FRONT, as every sheet shows them (the game's rest hold
 *     has the face outward; the lab turns the shield object about its own up axis and nudges it out, and
 *     puts it back for every other animation, `restoreSheet`);
 *   - spears and pikes are held upright; two-handed heads (war hammer, club) hang low and forward;
 *   - a kind that sets the `crouch` / `lean` anim styles is posed crouched / leaning, as in game (the goblin
 *     sheet is a deep squat): `bodyPose` uses the animator's own `crouchWish` / `stanceDrop` / `stylePose`.
 *
 * How it works: a second `HumanoidAnimator` (never the game's own instance) drives the SAME bones
 * with a hand-built pose; the pose vector and the arm targets are written in the animator's own
 * vocabulary (`poses.ts` F.*), so IK, fingers, skirt follow and hair/cloak springs behave exactly
 * as in game. The weapon's long axis is the hand's thumb axis (weapons.ts: blade along +Y, hand
 * socket Y = thumb), so each hold is "thumb along <axis>, knuckles toward <forward>". The pose is
 * time independent (springs are pre-rolled), and `h.animate()` is never fed a pose, so gameplay
 * animation is untouched.
 *
 * It reads `HumanoidAnimator`'s private `solve()` through a cast: a lab-only convenience that avoids
 * editing the animator. If `solve`'s signature changes, `sheetSolve` is the one place to adapt.
 */
import * as THREE from 'three';
import type { WeaponKind } from '../../core/types';
import type { HumanoidExt } from '../humanoid';
import { HumanoidAnimator } from './animator';
import { F, crouchLimit, crouchWish, neutralPose, newPose, stanceDrop, stylePose, type Pose } from './poses';

type Side = 'l' | 'r';
type V3t = [number, number, number];

/** a hold in MODEL space: x = outward from the body (mirrored per side), y up, z forward */
interface Hold {
  /** weapon long axis (hand thumb axis) */
  axis: V3t;
  /** direction the knuckles point (weapon z) */
  knuckle: V3t;
  /** wrist angle from vertical (deg) */
  out?: number;
  /** wrist forward offset (units of arm reach) */
  fwd?: number;
  /** direction the weapon tilts when it would touch the ground (out, up, fwd); default forward + out */
  tiltTo?: V3t;
  /** clearance (fraction of height) the lowest point of the weapon keeps above the ground */
  clear?: number;
}

const BOWS: WeaponKind[] = ['elven_bow', 'orc_bow', 'uruk_bow'];
const UPRIGHT: WeaponKind[] = ['spear', 'pike'];

function holdFor(kind: WeaponKind, big: boolean): Hold | null {
  if (kind === 'none') return null;
  if (BOWS.includes(kind) || kind === 'crossbow') return { axis: [0.1, 1, 0.04], knuckle: [0, 0, 1], out: 20, fwd: 0.2, clear: 0.02 };
  if (kind === 'shield') return { axis: [-0.12, 1, 0.0], knuckle: [0, 0, 1], out: 30, fwd: 0.1, clear: 0.02 };
  if (kind === 'torch') return { axis: [0.14, 1, 0.3], knuckle: [-0.2, 0, 1], out: 21, fwd: 0.12 };
  if (UPRIGHT.includes(kind)) return { axis: [0.06, 1, 0.1], knuckle: [-0.2, 0, 1], out: 21, fwd: 0.1, tiltTo: [0.6, 0, 0.8], clear: 0.02 };
  // everything else hangs blade-down beside the thigh; trolls swing the heavy head well forward
  if (big) return { axis: [0.12, -1, 0.7], knuckle: [-0.3, 0, 1], out: 22, fwd: 0.12, clear: 0.02, tiltTo: [0.1, 0, 1] };
  return { axis: [0.22, -1, 0.42], knuckle: [-0.3, 0, 1], out: 22, fwd: 0.1, clear: 0.03, tiltTo: [0.2, 0, 1] };
}

interface Rig {
  sa: HumanoidAnimator;
  body: THREE.Object3D;
  /** tilt (rad) found for each hand, keyed by `${weapon kinds}` so the search runs once */
  tilt: Map<string, { l: number; r: number }>;
}
const rigs = new WeakMap<HumanoidExt, Rig>();

function rigOf(h: HumanoidExt): Rig {
  let r = rigs.get(h);
  if (r) return r;
  const body = h.root.getObjectByName('rig') ?? h.root;
  const skin = h.root.getObjectByName('body') as THREE.SkinnedMesh | undefined;
  if (!skin?.skeleton) throw new Error('[sheetPose] humanoid has no skinned body');
  const A = h.assets;
  const sa = new HumanoidAnimator(A.rig, A.P, A.def.anim, skin.skeleton.bones, body);
  r = { sa, body, tilt: new Map() };
  rigs.set(h, r);
  return r;
}

const _q = new THREE.Quaternion();
const UP = new THREE.Vector3(0, 1, 0);
const _qi = new THREE.Quaternion();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _box = new THREE.Box3();

/** the sheet stance of the body (no arms): feet, pelvis, spine, head (exported for the tests) */
export function bodyPose(sa: HumanoidAnimator, p: Pose) {
  const B = sa.B;
  const st = B.style;
  const s = B.s;
  neutralPose(B, p);
  p[F.py] = -0.012 * s - 0.04 * s * st.hunch;
  p[F.sp] = 0.06 * st.hunch;
  p[F.cp] = 0.18 * st.hunch;
  p[F.np] = 0.06 * st.hunch;
  p[F.hp] = -0.12 * st.hunch;
  // feet about hip to shoulder width apart, toes a little out
  const want = B.shoulderX * 1.15;
  const off = Math.max(0, want - B.hipX);
  p[F.flx] = off;
  p[F.frx] = -off;
  p[F.flyaw] = 0.1;
  p[F.fryaw] = -0.1;
  p[F.kl] = p[F.kr] = 0.1;
  // the `crouch` and `lean` styles, posed as in game (a crouching kind compares crouched against its sheet): the pelvis
  // sinks inside the crouch's knee limit for these feet, the torso pitches over them, neck and head keep the gaze
  // level, knees and toes turn out. `stance` needs nothing here (the feet already stand at the sheets' width). A
  // kind that sets neither style is untouched.
  if (st.crouch > 0) p[F.py] = stanceDrop(B, crouchWish(B, p[F.py], st.crouch), [[B.ankleDX + p[F.flx], B.ankleDZ], [B.ankleDX - p[F.frx], B.ankleDZ]], crouchLimit(st));
  stylePose(st, p);
}

/** a 0..1 style value (missing = 0) */
const u01 = (x: number | undefined) => (x !== undefined && x > 0 ? Math.min(x, 1) : 0);
/** the share of `hunch` the arms' forward hang gets from the crouch and lean styles (the game puts 0.12 / 0.1 of reach forward) */
export const armHunch = (st: { hunch: number; crouch?: number; lean?: number }) => st.hunch + (0.12 * u01(st.crouch) + 0.1 * u01(st.lean)) / 0.18;

/** arms: wrist target and hand frame from a hold (model space → chest space through the solved chest) */
function armPose(sa: HumanoidAnimator, p: Pose, side: Side, hold: Hold | null, tilt: number, hunch: number) {
  const ps = sa.ps;
  const B = sa.B;
  const sx = side === 'l' ? 1 : -1;
  const sh = ps.modelP[ps.i(`upperarm_${side}`)];
  _qi.copy(ps.modelQ[ps.i('chest')]).invert();
  const R = B.reach;
  const ang = ((hold?.out ?? 21) * Math.PI) / 180;
  const fwd = (hold?.fwd ?? 0.07) + 0.18 * hunch;
  // wrist: 0.97 reach, `ang` out of the body, slightly forward (slight elbow bend)
  _a.set(sx * Math.sin(ang), -Math.cos(ang), fwd).normalize().multiplyScalar(0.97).applyQuaternion(_qi);
  const hx = side === 'l' ? F.hlx : F.hrx;
  p[hx] = _a.x;
  p[hx + 1] = _a.y;
  p[hx + 2] = _a.z;
  // elbow points back and a little out
  _a.set(sx * 0.35, -0.05, -1).applyQuaternion(_qi);
  const ex = side === 'l' ? F.elx : F.erx;
  p[ex] = _a.x;
  p[ex + 1] = _a.y;
  p[ex + 2] = _a.z;
  // hand frame: knuckles along `dir`, thumb (= weapon axis) along `thumb`
  let dir: V3t = [0.12, -1, 0.12];
  let thumb: V3t = [-0.15, 0.05, 1];
  const g = side === 'l' ? F.gl : F.gr;
  if (hold) {
    // tilt the weapon axis toward `tiltTo` (away from the ground)
    const t = hold.tiltTo ?? [0.45, 0, 0.9];
    _b.set(hold.axis[0] * sx, hold.axis[1], hold.axis[2]).normalize();
    _c.set(t[0] * sx, t[1], t[2]);
    _c.addScaledVector(_b, -_c.dot(_b));
    if (_c.lengthSq() < 1e-6) _c.set(0, 0, 1).addScaledVector(_b, -_b.z);
    _c.normalize();
    _b.multiplyScalar(Math.cos(tilt)).addScaledVector(_c, Math.sin(tilt));
    thumb = [_b.x, _b.y, _b.z];
    _a.set(hold.knuckle[0] * sx, hold.knuckle[1], hold.knuckle[2]);
    // knuckles stay perpendicular to the weapon axis (frameRotation orthogonalises, this keeps intent clear)
    _a.addScaledVector(_b, -_a.dot(_b)).normalize();
    dir = [_a.x, _a.y, _a.z];
    p[g] = 0.95;
  } else {
    // relaxed empty hand: fingers curled a little, knuckles down and slightly forward, thumb forward
    dir = [sx * 0.12, -1, 0.14];
    thumb = [-sx * 0.15, 0.05, 1];
    p[g] = 0.35;
  }
  const dd = side === 'l' ? F.hldx : F.hrdx;
  const tt = side === 'l' ? F.hltx : F.hrtx;
  _a.set(dir[0], dir[1], dir[2]).applyQuaternion(_qi);
  p[dd] = _a.x;
  p[dd + 1] = _a.y;
  p[dd + 2] = _a.z;
  _a.set(thumb[0], thumb[1], thumb[2]).applyQuaternion(_qi);
  p[tt] = _a.x;
  p[tt + 1] = _a.y;
  p[tt + 2] = _a.z;
  void sh;
  void R;
}

type SolveFn = (p: Pose, aimW: number, draw: number, pitch: number, look: THREE.Vector3 | null, dt: number) => void;
function sheetSolve(sa: HumanoidAnimator, p: Pose, dt: number) {
  (sa as unknown as { solve: SolveFn }).solve(p, 0, 0, 0, null, dt);
}

/** lowest world y of a weapon object (its meshes' bounding boxes) */
function lowestY(obj: THREE.Object3D): number {
  _box.makeEmpty();
  obj.updateWorldMatrix(true, true);
  _box.setFromObject(obj, false);
  return _box.isEmpty() ? Infinity : _box.min.y;
}

/** the shield's rest transform is remembered here while the sheet pose has it turned face-forward */
interface ShieldRest {
  q: THREE.Quaternion;
  p: THREE.Vector3;
}
const SHIELD_REST = 'sheetShieldRest';

function faceShieldForward(obj: THREE.Object3D) {
  const ud = obj.userData as Record<string, ShieldRest | undefined>;
  if (!ud[SHIELD_REST]) ud[SHIELD_REST] = { q: obj.quaternion.clone(), p: obj.position.clone() };
  const r = ud[SHIELD_REST]!;
  // socket X (the shield face, outward at rest) turns toward +Z about the socket's Y (the shield's
  // up axis): the sheets show the face turned ~60 deg out of the front, clear of the thigh
  obj.quaternion.copy(r.q).multiply(_q.setFromAxisAngle(UP, -0.17 * Math.PI));
  obj.position.copy(r.p);
  obj.position.x += 0.08; // and a little out, so the rim does not sit in the leg
}

/** undo the sheet pose's shield turn (call before posing any other animation) */
export function restoreSheet(h: HumanoidExt): void {
  for (const hand of ['hand_l', 'hand_r'] as const) {
    const o = h.weaponObject(hand);
    const r = (o?.userData as Record<string, ShieldRest | undefined> | undefined)?.[SHIELD_REST];
    if (o && r) {
      o.quaternion.copy(r.q);
      o.position.copy(r.p);
      delete (o.userData as Record<string, unknown>)[SHIELD_REST];
    }
  }
}

/**
 * Pose `h` in the reference-sheet stance. Weapons must already be set (the lab's `poseHumanoid`
 * does that). Deterministic and time independent.
 */
export function poseSheet(h: HumanoidExt): void {
  const { sa, tilt } = rigOf(h);
  // let the game's animator process what it owns (LOD swaps, bow stow) before the bones are overwritten
  h.animate(0, { speed: 0, grounded: true });
  const held: Record<Side, WeaponKind> = {
    l: (h.weaponObject('hand_l')?.userData.kind as WeaponKind | undefined) ?? 'none',
    r: (h.weaponObject('hand_r')?.userData.kind as WeaponKind | undefined) ?? 'none',
  };
  const big = h.assets.P.s >= 1.5;
  const holds: Record<Side, Hold | null> = { l: holdFor(held.l, big), r: holdFor(held.r, big) };
  const hunch = armHunch(sa.B.style);
  for (const sd of ['l', 'r'] as const) if (held[sd] === 'shield') faceShieldForward(h.weaponObject(sd === 'l' ? 'hand_l' : 'hand_r')!);
  const key = `${held.l}|${held.r}`;
  const p = newPose();
  const groundY = h.root.getWorldPosition(_a).y;
  const clearOf = (hd: Hold | null) => groundY + (hd?.clear ?? 0.05) * h.assets.P.H;
  const build = (tl: number, tr: number) => {
    bodyPose(sa, p);
    sheetSolve(sa, p, 1 / 60); // chest and shoulders in place
    armPose(sa, p, 'l', holds.l, tl, hunch);
    armPose(sa, p, 'r', holds.r, tr, hunch);
    sheetSolve(sa, p, 1 / 60);
  };
  let t = tilt.get(key);
  if (!t) {
    // find, per hand, the smallest tilt that keeps the weapon off the ground
    t = { l: 0, r: 0 };
    for (let it = 0; it < 22; it++) {
      build(t.l, t.r);
      h.root.updateMatrixWorld(true);
      let moved = false;
      for (const sd of ['l', 'r'] as const) {
        const w = h.weaponObject(sd === 'l' ? 'hand_l' : 'hand_r');
        const hd = holds[sd];
        if (!w || !hd) continue;
        if (lowestY(w) < clearOf(hd) && t[sd] < 1.3) {
          t[sd] += 0.06;
          moved = true;
        }
      }
      if (!moved) break;
    }
    tilt.set(key, t);
  }
  // final pose, then pre-roll the springs (hair, skirt, cloak, quiver, beard) to rest
  sa.reset(0, 0);
  for (let i = 0; i < 72; i++) build(t.l, t.r);
  h.root.updateMatrixWorld(true);
}

// ── portrait framing ────────────────────────────────────────────────────────

/**
 * `&portrait=1&focus=head` helper. The lab frames `focus=head` from the bounding box of the whole
 * subject (centre y = top - 0.1 * height, radius 0.16 * height, scaled by `zoom`). This adds an
 * invisible two-point box whose centre lands on the HEAD BONE's current world position and whose
 * height makes `zoom=0.15` frame about 0.8 head heights around it, however the pose moves the
 * head (hunch, crouch, aiming) or how tall the subject, its weapons or a helmet are.
 * Call the returned function after every `pose()`; the lab reads the box after posing.
 */
export function addHeadFraming(holder: THREE.Object3D, h: HumanoidExt): () => void {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(6), 3));
  const pts = new THREE.Points(g, new THREE.PointsMaterial({ size: 0 }));
  pts.visible = false;
  pts.frustumCulled = false;
  pts.name = 'portrait-framing';
  holder.add(pts);
  const P = h.assets.P;
  // face centre in head-bone space: the rest face point minus the head joint (bone axes = model axes at rest)
  const f = P.h(0, -0.12, 0.2);
  const hj = P.j.head;
  const local = new THREE.Vector3(f[0] - hj[0], f[1] - hj[1], f[2] - hj[2]);
  const c = new THREE.Vector3();
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const setBox = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) => {
    pos.setXYZ(0, x0, y0, z0);
    pos.setXYZ(1, x1, y1, z1);
    pos.needsUpdate = true;
    g.computeBoundingBox();
    g.computeBoundingSphere();
  };
  return () => {
    h.root.updateMatrixWorld(true);
    c.copy(local);
    h.bones.head.localToWorld(c);
    // the subject alone (the helper collapsed onto the face point)
    setBox(c.x, c.y, c.z, c.x, c.y, c.z);
    holder.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(holder, true);
    const want = 0.8 * P.headH; // frame radius in metres at zoom 0.15
    // frame radius = 0.16 * size.y * zoom(0.15), size.y = 10 * (top - c.y)  =>  radius = 0.24 * (top - c.y)
    const top = Math.max(box.max.y, c.y + want / 0.24) + 0.02;
    const low = top - 10 * (top - c.y); // makes the box centre (top - 0.1 * size.y) land on c.y
    const W = Math.max(1.5, 1.1 * Math.max(box.max.x - c.x, c.x - box.min.x, box.max.z - c.z, c.z - box.min.z));
    setBox(c.x - W, Math.min(low, box.min.y - 1e-3), c.z - W, c.x + W, top, c.z + W);
  };
}
