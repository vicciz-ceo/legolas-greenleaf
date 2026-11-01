/**
 * Held-item carry tests (node, no browser). Run with: node src/physics/run-tests.mjs
 *
 * A held item's long axis is the hand's thumb axis and the neutral hand points the thumb straight ahead, so at
 * rest every blade lay across the body and every shield lay flat like a flag. The rest pose (idle, walk, jump)
 * now carries what the hands hold (poses.ts `Carry`): blades, axes, maces, clubs and hammers hang point-down
 * beside the thigh, tilted forward and out; spears, pikes and torches stand; a shield stands vertical on the
 * forearm with its face turned toward the front-left, as the reference sheets hold it. Attacks blend from that rest and keep their own keys.
 *
 * Held to here, for every body the game can produce (every registered kind, any height, both hands, every LOD):
 *   placed      the item's axis, face and lowest point are what the carry promises, and the point of a hanging
 *               blade stays off the ground however long it is,
 *   untouched   a hand that holds nothing (or a bow, a crossbow) keeps the neutral hand bit for bit, an attack at its
 *               first and last instant is the carried rest pose, and its own keys are not changed by the carry,
 *   continuous  the hand's orientation varies smoothly with time, speed and the attack's progress (no flips, no jumps), and through the
 *               layers blended over the rest pose: special poses in and out, death, a jump and its landing (the hand, the pelvis, the
 *               point of a hanging blade), the walk-to-run band, the first pose with a prop the kind rescales,
 *   finite      no NaN anywhere, in any state,
 *   consistent  the trunk estimate the carry places the hands with equals the solver's, left and right mirror each
 *               other, a run takes a hanging blade back to the fist, every LOD shows the same carry.
 */
import * as THREE from 'three';
import { ALL_KINDS, resolveKind } from './registry';
import { computeProportions, buildRig, type Proportions } from './proportions';
import { HumanoidAnimator } from './animator';
import { F, carryOf, idlePose, locomotionPose, newHeldCarry, newPose, trunkFrames, type Carry } from './poses';
import { createWeapon } from '../weapons';
import { createHumanoid, type HumanoidExt } from '../humanoid';
import { seedForBucket } from './kinds/uruks_bosses';
import type { AnimInput, AttackAnim, HumanoidKind, SpecialPose, WeaponKind } from '../../core/types';
import type { ResolvedKind } from './types';

let failed = 0;
let passed = 0;
const ok = (c: boolean, m: string) => {
  if (c) passed++;
  else {
    failed++;
    console.log('  FAIL:', m);
  }
};
const test = (n: string, f: () => void) => {
  const b = failed;
  try {
    f();
  } catch (e) {
    failed++;
    console.log('  THROW', (e as Error).stack);
  }
  console.log(failed === b ? 'ok   ' + n : 'FAIL ' + n);
};
const CAL = !!(globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env.CARRY_CAL;
const cal = (m: string) => CAL && console.log('  [cal]', m);

const DEG = 180 / Math.PI;
/**
 * how far a shield's face looks out of straight ahead, toward the outside (deg): the sheets hold it turned toward the front-left, not
 * straight out (poses.ts HOLDS.shield.face: the sheet-compare IoU of the shield bearers peaks at 15..30 deg, 40 is the turn that clears
 * the walking thigh). The tests pin the hold to it, within FACE_TOL for the body's own sway.
 */
const SHIELD_FACE = 40;
const FACE_TOL = 12;
const SIDES = ['l', 'r'] as const;
type Side = (typeof SIDES)[number];
const ATTACKS: AttackAnim[] = ['slash', 'backslash', 'thrust', 'overhead', 'knife1', 'knife2', 'knife3', 'punch', 'slam', 'sweep', 'throw', 'bite', 'stomp'];
const SPECIALS: Exclude<SpecialPose, null>[] = ['surf', 'climb', 'hang', 'ride', 'sit', 'crouch', 'cheer', 'roar', 'block', 'stagger', 'barrel', 'kneel', 'run_wall', 'swing'];

/** weapon kinds of each carry (the table of poses.ts, frozen here) */
const KINDS_OF: Record<Carry, WeaponKind[]> = {
  hang: ['sword', 'elven_sword', 'scimitar', 'cleaver', 'axe', 'dwarf_axe', 'mace', 'club', 'warhammer', 'elven_knives'],
  upright: ['spear', 'pike', 'torch'],
  shield: ['shield'],
  none: ['elven_bow', 'orc_bow', 'uruk_bow', 'crossbow', 'none'],
};
/**
 * the scale along its long axis that the kinds' extras give a held item (scaleHeldWeapon in goblin.ts, gimli.ts, bolg.ts, uruk.ts,
 * fitHeldWeapon in troll.ts): the model-only tests use it, and the real-humanoid test below checks it against the real props
 */
const KIND_SCALE: Record<string, Partial<Record<WeaponKind, number>>> = {
  goblin: { scimitar: 0.5 },
  gimli: { dwarf_axe: 0.65 },
  bolg: { mace: 0.9 },
  berserker: { sword: 1.12 },
  troll: { club: 0.66, warhammer: 0.75 },
};

// ── bodies ───────────────────────────────────────────────────────────────────
const handScaleOf = (P: Proportions) => (P.s >= 1.2 ? P.s : 1);

/** how far a weapon reaches beyond its grip along its long axis, both ways (m, weapon units) */
const reachCache = new Map<string, { up: number; down: number }>();
function reachOf(kind: WeaponKind, style?: string) {
  const key = `${kind}|${style ?? ''}`;
  let r = reachCache.get(key);
  if (!r) {
    const box = new THREE.Box3().setFromObject(createWeapon(kind, 1, style as never));
    r = { up: Math.max(0, box.max.y), down: Math.max(0, -box.min.y) };
    reachCache.set(key, r);
  }
  return r;
}

function make(def: ResolvedKind, height = def.height, lod: 0 | 1 | 2 = 0) {
  const P = computeProportions(def, height, 1, {});
  const rig = buildRig(P);
  const A = new HumanoidAnimator(rig, P, def.anim, rig.instantiate().bones, new THREE.Group());
  if (lod) A.setLod(lod);
  return { P, A };
}

/** put a weapon in a hand the way humanoid.ts does: its carry and its reach in model units */
function give(P: Proportions, A: HumanoidAnimator, sd: Side, kind: WeaponKind, scale = 1, style?: string) {
  const r = reachOf(kind, style);
  const hc = A.held[sd];
  hc.carry = carryOf(kind);
  hc.up = r.up * handScaleOf(P) * scale;
  hc.down = r.down * handScaleOf(P) * scale;
  if (sd === 'l') A.gripL = kind !== 'none';
  else A.gripR = kind !== 'none';
}
const empty = (A: HumanoidAnimator) => {
  for (const sd of SIDES) {
    A.held[sd].carry = 'none';
    A.held[sd].up = A.held[sd].down = 0;
  }
  A.gripL = A.gripR = false;
};

interface Frame {
  /** the item's origin and its long axis (the weapon's +Y), the way the fingers point, the weapon's +X (a shield's face): model space */
  grip: THREE.Vector3;
  axis: THREE.Vector3;
  fingers: THREE.Vector3;
  face: THREE.Vector3;
}
/** where the hand puts what it holds: the hand bone's orientation × the rest frame (the socket math of humanoid.ts) */
function frame(P: Proportions, A: HumanoidAnimator, sd: Side): Frame {
  const ps = A.ps;
  const hi = ps.i(`hand_${sd}`);
  const q = ps.modelQ[hi];
  const f = P.hand[sd];
  const a = P.palm * 0.78, c = 0.022 * P.s;
  const grip = new THREE.Vector3(f.L.x * a + f.N.x * c, f.L.y * a + f.N.y * c, f.L.z * a + f.N.z * c).applyQuaternion(q).add(ps.modelP[hi]);
  return {
    grip,
    axis: f.T.clone().applyQuaternion(q),
    fingers: f.L.clone().applyQuaternion(q),
    face: new THREE.Vector3().crossVectors(f.T, f.L).applyQuaternion(q),
  };
}

/** one animator frame at clock time t (and gait phase) */
function step(A: HumanoidAnimator, input: AnimInput, t = 0.5, phase = 0) {
  A.reset(t - 1 / 60, phase);
  A.update(1 / 60, input);
}
const idle = (A: HumanoidAnimator, t = 0.5) => step(A, { speed: 0, grounded: true }, t);

/** the angle (deg) between two orientations */
const turn = (a: THREE.Quaternion, b: THREE.Quaternion) => 2 * Math.acos(Math.min(1, Math.abs(a.dot(b)))) * DEG;
const handQ = (A: HumanoidAnimator, sd: Side) => A.ps.modelQ[A.ps.i(`hand_${sd}`)].clone();

/** every bone finite with a unit rotation */
function sound(A: HumanoidAnimator, what: string) {
  const ps = A.ps;
  let good = true;
  for (let i = 0; i < ps.n; i++) {
    const q = ps.modelQ[i], p = ps.modelP[i];
    if (!Number.isFinite(q.x + q.y + q.z + q.w + p.x + p.y + p.z) || Math.abs(q.lengthSq() - 1) > 1e-4) good = false;
  }
  ok(good, `${what}: every bone must stay finite with a unit rotation`);
}

/** the yaw of a direction out of straight ahead toward the outside (deg, seen from above): 0 = ahead, 90 = straight out, `outward` = +1 left, -1 right */
const outYaw = (v: THREE.Vector3, outward: number) => Math.atan2(v.x * outward, v.z) * DEG;

/** the numbers a carry promises, measured on the solved hand */
function probe(P: Proportions, A: HumanoidAnimator, sd: Side, kind: WeaponKind, scale = 1, style?: string) {
  const fr = frame(P, A, sd);
  const r = reachOf(kind, style);
  const k = handScaleOf(P) * scale;
  const outward = sd === 'l' ? 1 : -1;
  return {
    /** the lowest point of the item along its long axis: the end that points at the ground */
    lowest: fr.grip.y + Math.min(fr.axis.y * r.up * k, -fr.axis.y * r.down * k),
    /** angle of the axis from straight down / up (deg) */
    tilt: Math.acos(Math.min(1, Math.abs(fr.axis.y))) * DEG,
    up: fr.axis.y,
    fwd: fr.axis.z,
    out: fr.axis.x * outward,
    face: fr.face.x * outward,
    /** where the face looks, out of straight ahead toward the outside (deg), seen from above in model space */
    faceYaw: outYaw(fr.face, outward),
  };
}

// ── the carry table ──────────────────────────────────────────────────────────
test('every weapon kind has its carry (blades hang, hafts and torches stand, shields stand on the arm)', () => {
  for (const c of Object.keys(KINDS_OF) as Carry[]) for (const k of KINDS_OF[c]) ok(carryOf(k) === c, `${k} must carry as ${c}, got ${carryOf(k)}`);
  ok(carryOf('something_new') === 'none', 'an unknown kind keeps the neutral hand');
});

// ── nothing carried: the neutral hand, bit for bit ───────────────────────────
test('hands that hold nothing, a bow or a crossbow keep the neutral hand (bit-identical poses)', () => {
  const same = (a: Float32Array, b: Float32Array) => {
    const x = new Uint32Array(a.buffer, a.byteOffset, a.length), y = new Uint32Array(b.buffer, b.byteOffset, b.length);
    for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false;
    return x.length === y.length;
  };
  for (const kind of ALL_KINDS) {
    const { A } = make(resolveKind(kind));
    for (const k of ['none', 'elven_bow', 'orc_bow', 'uruk_bow', 'crossbow'] as WeaponKind[]) {
      const held = newHeldCarry();
      held.l.carry = held.r.carry = carryOf(k);
      for (const t of [0, 0.5, 7.3]) ok(same(idlePose(A.B, t, newPose(), held), idlePose(A.B, t, newPose())), `${kind} idle with ${k}: the pose must not change`);
      for (const [sp, ph] of [[1.5, 0.2], [4, 0.6], [6.5, 0.9]] as const) ok(same(locomotionPose(A.B, ph, sp, 0, 1, 0.5, newPose(), held), locomotionPose(A.B, ph, sp, 0, 1, 0.5, newPose())), `${kind} walk at ${sp} m/s with ${k}: the pose must not change`);
    }
  }
});

// ── placed ───────────────────────────────────────────────────────────────────
test('every kind carries its default loadout as promised (idle over time, in both hands, at every LOD)', () => {
  let n = 0;
  for (const kind of ALL_KINDS) {
    const def = resolveKind(kind);
    for (const lod of [0, 1, 2] as const) {
      const { P, A } = make(def, def.height, lod);
      const items = SIDES.map((sd) => ({ sd, w: ((sd === 'l' ? def.weapons.left : def.weapons.right) ?? 'none') as WeaponKind, sc: 1 }));
      for (const it of items) {
        it.sc = KIND_SCALE[kind]?.[it.w] ?? 1;
        give(P, A, it.sd, it.w, it.sc, def.weapons.style);
      }
      for (const t of [0, 0.5, 1.7, 4.1, 9.3, 17.9]) {
        idle(A, t);
        for (const { sd, w, sc } of items) {
          const c = carryOf(w);
          if (c === 'none') continue;
          const pr = probe(P, A, sd, w, sc, def.weapons.style);
          const what = `${kind} LOD${lod} ${sd} ${w} t=${t}`;
          n++;
          if (c === 'hang') {
            ok(pr.tilt >= 15 && pr.tilt <= 75 && pr.up < 0, `${what}: a hanging item points down within 15..75 deg of vertical, got ${pr.tilt.toFixed(1)}`);
            ok(pr.fwd > 0.1 && pr.out > 0, `${what}: it leans forward (${pr.fwd.toFixed(2)}) and out (${pr.out.toFixed(2)})`);
            ok(pr.lowest >= 0.015 * def.height, `${what}: the point stays off the ground, ${(pr.lowest * 100).toFixed(1)} cm`);
          } else if (c === 'upright') {
            ok(pr.tilt <= 25 && pr.up > 0, `${what}: an upright haft stands within 25 deg of vertical, got ${pr.tilt.toFixed(1)}`);
            ok(pr.lowest >= 0, `${what}: the butt stays off the ground, ${(pr.lowest * 100).toFixed(1)} cm`);
          } else {
            ok(pr.tilt <= 15 && pr.up > 0, `${what}: a shield stands within 15 deg of vertical, got ${pr.tilt.toFixed(1)}`);
            ok(Math.abs(pr.faceYaw - SHIELD_FACE) <= FACE_TOL, `${what}: the shield's face looks ${SHIELD_FACE} deg out of straight ahead (+-${FACE_TOL}), got ${pr.faceYaw.toFixed(1)}`);
          }
          cal(`${what} tilt ${pr.tilt.toFixed(1)} fwd ${pr.fwd.toFixed(2)} out ${pr.out.toFixed(2)} lowest ${(pr.lowest * 100).toFixed(1)} cm`);
        }
      }
    }
  }
  ok(n > 100, `loadouts probed (${n})`);
});

test('a hanging item clears the ground however long (the carry tilts it further forward) and however tall the body', () => {
  const man = resolveKind('man');
  for (const h of [1.2, 1.5, 1.78, 2.1, 3.0, 4.5]) {
    const { A, P } = make(man, h);
    for (const len of [0.3, 0.7, 0.95, 1.3, 2.0]) {
      const reach = (len * h) / 1.78; // metres: from a short knife to an item longer than the body is high at the small sizes
      for (const sd of SIDES) {
        A.held[sd].carry = 'hang';
        A.held[sd].up = reach;
        A.held[sd].down = 0.15;
      }
      A.gripL = A.gripR = true;
      idle(A, 0.5);
      for (const sd of SIDES) {
        const fr = frame(P, A, sd);
        const lowest = fr.grip.y + fr.axis.y * reach;
        const tilt = Math.acos(Math.min(1, Math.abs(fr.axis.y))) * DEG;
        // the point can clear the ground when the item is no longer than the grip height over the clearance at the steepest tilt
        const can = (fr.grip.y - 0.025 * h) / reach >= Math.cos(75 / DEG) + 0.02;
        if (can) ok(lowest >= 0.02 * h, `man ${h} m, item ${reach.toFixed(2)} m, ${sd}: the point must clear the ground, ${(lowest * 100).toFixed(1)} cm (tilt ${tilt.toFixed(0)})`);
        ok(tilt <= 75.5, `man ${h} m, item ${reach.toFixed(2)} m: the tilt stops at 75 deg, got ${tilt.toFixed(1)}`);
      }
    }
  }
});

test('shields and spears stand up, the shield faces forward and out, in the left hand or the right', () => {
  const { P, A } = make(resolveKind('man'));
  for (const sd of SIDES) {
    empty(A);
    give(P, A, sd, 'shield');
    idle(A, 0.5);
    let pr = probe(P, A, sd, 'shield');
    ok(pr.tilt <= 15 && pr.up > 0.95 && Math.abs(pr.faceYaw - SHIELD_FACE) <= FACE_TOL, `${sd} shield: upright (${pr.tilt.toFixed(1)} deg) and face ${pr.faceYaw.toFixed(1)} deg out of straight ahead`);
    empty(A);
    give(P, A, sd, 'spear');
    idle(A, 0.5);
    pr = probe(P, A, sd, 'spear');
    ok(pr.tilt <= 25 && pr.up > 0.9, `${sd} spear: stands (${pr.tilt.toFixed(1)} deg)`);
    ok(pr.out >= 0 && pr.fwd >= 0, `${sd} spear: its head leans out and forward, not in and back (${pr.out.toFixed(2)}, ${pr.fwd.toFixed(2)})`);
  }
});

test('left and right holds mirror each other', () => {
  const { P, A } = make(resolveKind('man'));
  const mirror = (v: THREE.Vector3) => new THREE.Vector3(-v.x, v.y, v.z);
  for (const k of ['sword', 'spear', 'shield', 'club', 'torch'] as WeaponKind[]) {
    empty(A);
    give(P, A, 'l', k);
    give(P, A, 'r', k);
    for (const t of [0, 3.1, 8.8]) {
      idle(A, t); // the idle's weight shift rolls the chest a degree or two: not exactly mirrored
      const l = frame(P, A, 'l'), r = frame(P, A, 'r');
      ok(mirror(l.axis).distanceTo(r.axis) < 0.1, `${k} t=${t}: the axes mirror (${l.axis.toArray().map((x) => x.toFixed(2))} / ${r.axis.toArray().map((x) => x.toFixed(2))})`);
      ok(mirror(l.face).distanceTo(r.face) < 0.1 || k !== 'shield', `${k} t=${t}: a shield's faces mirror`);
    }
  }
});

// ── the shield's face, in the pelvis frame ───────────────────────────────────
/** the item's face normal in the pelvis frame (x toward the character's left, y up, z ahead): the hips' own turn undone */
const _hq = new THREE.Quaternion();
function faceInPelvis(A: HumanoidAnimator, f: Frame) {
  _hq.copy(A.ps.modelQ[A.ps.i('hips')]).invert();
  return f.face.clone().applyQuaternion(_hq);
}

test('a shield faces forward and out, as the sheets hold it: the face in the pelvis frame, idle and walking, every height and LOD', () => {
  const bodies: [string, ResolvedKind, number][] = [];
  for (const h of [1.2, 1.5, 1.78, 2.4, 3.3]) bodies.push([`man ${h} m`, resolveKind('man'), h]);
  // the kinds' own builds: tall, crouched, hunched, heavy
  for (const k of ['rohirrim', 'gondor', 'uruk', 'easterling', 'dwarf', 'goblin', 'troll', 'gimli'] as const) bodies.push([k, resolveKind(k), resolveKind(k).height]);
  const walk: [string, number][] = [0, 0.25, 0.5, 0.75].map((ph) => [`walk phase ${ph}`, ph]);
  let n = 0, worst = 0;
  for (const [name, def, h] of bodies) {
    for (const lod of [0, 1, 2] as const) {
      const { P, A } = make(def, h, lod);
      // a crouched body (the goblin) keeps its shield out at the side: its knees stand forward where the turned shield would hang
      const want = SHIELD_FACE + (90 - SHIELD_FACE) * Math.min(1, Math.max(0, def.anim.crouch ?? 0));
      for (const sd of SIDES) {
        empty(A);
        give(P, A, sd, 'shield');
        const outward = sd === 'l' ? 1 : -1;
        const check = (what: string) => {
          const fp = faceInPelvis(A, frame(P, A, sd));
          const yaw = outYaw(fp, outward);
          n++;
          worst = Math.max(worst, Math.abs(yaw - want));
          ok(Math.abs(yaw - want) <= FACE_TOL, `${name} LOD${lod} ${sd} ${what}: the face looks ${yaw.toFixed(1)} deg out of straight ahead in the pelvis frame, want ${want.toFixed(0)} +- ${FACE_TOL}`);
          ok(Math.abs(fp.y) < 0.3, `${name} LOD${lod} ${sd} ${what}: and it stays level (y ${fp.y.toFixed(2)})`);
        };
        for (const t of [0, 0.7, 3.1, 8.8, 17.9]) {
          idle(A, t);
          check(`idle t=${t}`);
        }
        for (const [what, ph] of walk) {
          step(A, { speed: 1.5, grounded: true, moveDir: { x: 0, z: 1 } }, 2.2, ph);
          check(what);
        }
      }
    }
  }
  cal(`shield face: ${n} poses, worst ${worst.toFixed(1)} deg from ${SHIELD_FACE}`);
  ok(n >= 500, `shield poses probed (${n})`);
});

// ── the estimate the carry places the hands with equals the solver's ─────────
test('trunkFrames equals the solver (chest rotation and shoulders) standing, hunched, crouched, twisted', () => {
  let x = 12345;
  const rnd = () => ((x = (Math.imul(x, 1664525) + 1013904223) >>> 0) / 4294967296);
  const def = resolveKind('man');
  for (const [name, d] of [['man', def], ['hunched', { ...def, anim: { ...def.anim, hunch: 0.9, crouch: 1, lean: 0.5, aggression: 0.8 } }], ['troll', resolveKind('troll')], ['dwarf', resolveKind('dwarf')]] as [string, ResolvedKind][]) {
    const { A } = make(d);
    const solve = (A as unknown as { solve: (p: Float32Array, aim: number, draw: number, pitch: number, look: null, dt: number) => void }).solve.bind(A);
    const p = newPose();
    for (let i = 0; i < 30; i++) {
      idlePose(A.B, rnd() * 20, p);
      // a torso bent and twisted every which way (the attacks do that), the clavicles at rest
      for (const k of [F.pp, F.pyaw, F.pr, F.sp, F.sy, F.sr, F.cp, F.cy, F.cr]) p[k] = (rnd() - 0.5) * 1.4;
      p[F.px] = (rnd() - 0.5) * 0.1;
      p[F.pz] = (rnd() - 0.5) * 0.1;
      p[F.py] = -rnd() * 0.2;
      p[F.cll] = p[F.clr] = 0;
      solve(p, 0, 0, 0, null, 1 / 60);
      const tf = trunkFrames(A.B, p);
      const ps = A.ps;
      const R = new THREE.Matrix4().makeRotationFromQuaternion(ps.modelQ[ps.i('chest')]).elements; // column-major
      let err = 0;
      for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) err = Math.max(err, Math.abs(tf.rot[r * 3 + c] - R[c * 4 + r]));
      ok(err < 2e-6, `${name} #${i}: the chest rotation must equal the solver's (max element error ${err.toExponential(1)})`);
      const sl = ps.modelP[ps.i('upperarm_l')], sr = ps.modelP[ps.i('upperarm_r')];
      const e2 = Math.max(Math.abs(tf.l[0] - sl.x), Math.abs(tf.l[1] - sl.y), Math.abs(tf.l[2] - sl.z), Math.abs(tf.r[0] - sr.x), Math.abs(tf.r[1] - sr.y), Math.abs(tf.r[2] - sr.z));
      ok(e2 < 2e-5, `${name} #${i}: the shoulders must be where the solver puts them (max error ${(e2 * 1000).toFixed(3)} mm)`);
    }
  }
});

// ── attacks: blend from the carry, keep their keys ───────────────────────────
test('an attack starts and ends on the carried rest pose and keeps its own keys in between', () => {
  const { P, A } = make(resolveKind('man'));
  for (const atk of ATTACKS) {
    empty(A);
    give(P, A, 'r', 'sword');
    give(P, A, 'l', 'shield');
    idle(A, 0.5);
    const rest = { l: handQ(A, 'l'), r: handQ(A, 'r') };
    for (const at of [0, 1]) {
      step(A, { speed: 0, grounded: true, attack: { kind: atk, t: at } }, 0.5);
      // (the spin finisher ends a full turn of 6.28 rad: 0.18 deg short of the rest)
      const tol = atk === 'knife3' ? 0.25 : 0.01;
      for (const sd of SIDES) ok(turn(handQ(A, sd), rest[sd]) < tol, `${atk} t=${at} ${sd}: the hand is on the carried rest pose, ${turn(handQ(A, sd), rest[sd]).toFixed(3)} deg off`);
    }
  }
  // mid-attack the right hand's keys are absolute: the hand does what it did without the carry
  for (const [atk, ats] of [['slash', [0.4, 0.5, 0.6]], ['overhead', [0.45, 0.58]], ['knife1', [0.3, 0.5]], ['punch', [0.4, 0.55]], ['slam', [0.5, 0.62]], ['throw', [0.5, 0.6]]] as [AttackAnim, number[]][]) {
    for (const at of ats) {
      empty(A);
      give(P, A, 'r', 'sword');
      step(A, { speed: 0, grounded: true, attack: { kind: atk, t: at } }, 0.5);
      const withCarry = handQ(A, 'r');
      empty(A);
      step(A, { speed: 0, grounded: true, attack: { kind: atk, t: at } }, 0.5);
      ok(turn(withCarry, handQ(A, 'r')) < 0.05, `${atk} t=${at}: the right hand keeps its keys, ${turn(withCarry, handQ(A, 'r')).toFixed(3)} deg off the old pose`);
    }
  }
});

// ── continuous ───────────────────────────────────────────────────────────────
/** largest hand-orientation step (deg) between consecutive samples of a sweep */
function sweep(A: HumanoidAnimator, sd: Side, n: number, f: (i: number) => void) {
  let max = 0, at = '';
  let prev: THREE.Quaternion | null = null;
  for (let i = 0; i < n; i++) {
    f(i);
    const q = handQ(A, sd);
    if (prev) {
      const d = turn(prev, q);
      if (d > max) {
        max = d;
        at = `#${i}`;
      }
    }
    prev = q;
  }
  return { max, at };
}

test('the hand turns smoothly: idle over time, the walk over speed, a start, a run and a stop', () => {
  const holds: [WeaponKind, Side][] = [['sword', 'r'], ['shield', 'l'], ['spear', 'r'], ['club', 'r']];
  for (const kind of ['man', 'troll', 'goblin', 'gimli'] as const) {
    const { P, A } = make(resolveKind(kind));
    for (const [w, sd] of holds) {
      const sweeps = (carried: boolean) => {
        empty(A);
        if (carried) give(P, A, sd, w);
        A.reset(0, 0);
        const idleSweep = sweep(A, sd, 1800, (i) => A.update(i === 0 ? 0 : 1 / 60, { speed: 0, grounded: true })); // 30 s at 60 fps
        // the speed sweep at a fixed clock and gait phase: 0.02 m/s per sample up to a sprint
        const speeds = sweep(A, sd, 450, (i) => step(A, { speed: i * 0.02, grounded: true, moveDir: { x: 0, z: 1 } }, 3.3, 0.37));
        // a real start, run and stop over time (the gait phase advances by itself)
        A.reset(0, 0);
        const gait = sweep(A, sd, 1500, (i) => {
          const speed = i < 300 ? i * 0.03 : i < 900 ? 9 : Math.max(0, 9 - (i - 900) * 0.03);
          A.update(1 / 60, { speed, grounded: true, moveDir: { x: 0, z: 1 } });
        });
        return { idleSweep, speeds, gait };
      };
      const c = sweeps(true), n = sweeps(false);
      cal(`${kind} ${w}: idle ${c.idleSweep.max.toFixed(3)} / ${n.idleSweep.max.toFixed(3)}, speeds ${c.speeds.max.toFixed(2)} (${c.speeds.at}) / ${n.speeds.max.toFixed(2)} (${n.speeds.at}), gait ${c.gait.max.toFixed(2)} (${c.gait.at}) / ${n.gait.max.toFixed(2)} (${n.gait.at})`);
      ok(c.idleSweep.max < 0.5, `${kind} ${w}: the idle hand turns at most ${c.idleSweep.max.toFixed(3)} deg per frame`);
      // the run's own fists turn the hand too (and the neutral hand has its jumps): the carry may add the turn of its own, a
      // hanging blade swinging up to the run's fist is ~120 deg over 1.3 m/s, but no flip
      ok(c.speeds.max <= Math.max(n.speeds.max * 1.5, 7), `${kind} ${w}: across the speeds the hand turns at most ${c.speeds.max.toFixed(2)} deg per 0.02 m/s (the neutral hand ${n.speeds.max.toFixed(2)})`);
      ok(c.gait.max <= Math.max(n.gait.max * 1.5, 10), `${kind} ${w}: through start, run and stop the hand turns at most ${c.gait.max.toFixed(2)} deg per frame (the neutral hand ${n.gait.max.toFixed(2)})`);
    }
  }
});

test('attacks turn a carried hand no more sharply than they turn the neutral hand', () => {
  const { P, A } = make(resolveKind('man'));
  for (const atk of ATTACKS) {
    for (const [w, sd] of [['sword', 'r'], ['shield', 'l'], ['spear', 'r'], ['club', 'r']] as [WeaponKind, Side][]) {
      const run = (carried: boolean) => {
        empty(A);
        if (carried) give(P, A, sd, w);
        return sweep(A, sd, 241, (i) => step(A, { speed: 0, grounded: true, attack: { kind: atk, t: i / 240 } }, 0.5));
      };
      const withC = run(true), without = run(false);
      cal(`${atk} ${w}: carried ${withC.max.toFixed(2)} (${withC.at}), neutral ${without.max.toFixed(2)} (${without.at})`);
      // per 1/240 of an attack: the old keys have their own fast moments (a few flip the thumb outright: slash, throw, sweep turn 100+
      // deg in one step); the carry's turn to the keys and back is no sharper than the neutral hand's biggest step, or 10 deg
      ok(withC.max <= Math.max(without.max * 1.25, 10), `${atk} with ${w} in ${sd}: the hand turns at most ${withC.max.toFixed(2)} deg per 1/240 (the neutral hand ${without.max.toFixed(2)})`);
    }
  }
});

// ── the layers blended over the carried rest pose: specials, death, jumps and landings ──────────────────────────────
/** the largest turn (deg) of each hand between consecutive frames of n updates, `f(i)` feeding frame i */
function handTurns(A: HumanoidAnimator, n: number, f: (i: number) => void) {
  const max = { l: 0, r: 0 };
  const at = { l: -1, r: -1 };
  const prev: Record<Side, THREE.Quaternion | null> = { l: null, r: null };
  for (let i = 0; i < n; i++) {
    f(i);
    for (const sd of SIDES) {
      const q = handQ(A, sd);
      const d = prev[sd] ? turn(prev[sd]!, q) : 0;
      if (d > max[sd]) {
        max[sd] = d;
        at[sd] = i;
      }
      prev[sd] = q;
    }
  }
  return { max, at };
}
/** a sword in the right hand, a shield in the left (the sheets' bearers, Lurtz's boss move), or nothing */
function armed(P: Proportions, A: HumanoidAnimator, carried: boolean) {
  empty(A);
  if (carried) {
    give(P, A, 'r', 'sword');
    give(P, A, 'l', 'shield');
  }
}

test('a special pose blends in and out without whipping a carried hand (every special, 1/60 frames)', () => {
  for (const kind of ['man', 'goblin', 'troll'] as const) {
    const { P, A } = make(resolveKind(kind));
    for (const sp of SPECIALS) {
      const run = (carried: boolean) => {
        armed(P, A, carried);
        A.reset(0, 0);
        // 1 s of idle, the special on for 1.2 s, then off again for 1.2 s
        return handTurns(A, 260, (i) => A.update(i === 0 ? 0 : 1 / 60, { speed: 0, grounded: true, special: i >= 60 && i < 140 ? sp : undefined, specialT: i / 60 }));
      };
      const c = run(true), n = run(false);
      for (const sd of SIDES) {
        cal(`${kind} ${sp} ${sd}: carried ${c.max[sd].toFixed(1)} (#${c.at[sd]}), neutral ${n.max[sd].toFixed(1)}`);
        // the special's own frames turn the neutral hand too; the carry adds the turn from the hold to the special and back: bounded
        // by the blend's weight (<= 0.12 of a half revolution per frame), not the 60-90 deg of a lerp through near-zero vectors
        ok(c.max[sd] <= Math.max(n.max[sd] * 1.8, 20), `${kind} ${sp} ${sd}: a carried hand turns at most ${c.max[sd].toFixed(1)} deg per frame (#${c.at[sd]}; the neutral hand ${n.max[sd].toFixed(1)})`);
      }
    }
  }
});

test('death blends in without whipping a carried hand (every variant)', () => {
  const { P, A } = make(resolveKind('man'));
  for (const v of [0, 1, 2, 3]) {
    const run = (carried: boolean) => {
      armed(P, A, carried);
      A.reset(0, 0);
      // the lab's fall: dead 0 -> 1 over 1.3 s
      return handTurns(A, 140, (i) => A.update(i === 0 ? 0 : 1 / 60, { speed: 0, grounded: true, dead: Math.min(1, Math.max(0, (i - 20) / 78)), deathVariant: v }));
    };
    const c = run(true), n = run(false);
    for (const sd of SIDES) {
      cal(`death ${v} ${sd}: carried ${c.max[sd].toFixed(1)} (#${c.at[sd]}), neutral ${n.max[sd].toFixed(1)}`);
      ok(c.max[sd] <= Math.max(n.max[sd] * 1.8, 20), `death variant ${v} ${sd}: a carried hand turns at most ${c.max[sd].toFixed(1)} deg per frame (the neutral hand ${n.max[sd].toFixed(1)})`);
    }
  }
});

test('a jump and its landing keep a carried hand turning smoothly, standing and running', () => {
  for (const kind of ['man', 'goblin', 'gimli'] as const) {
    const { P, A } = make(resolveKind(kind));
    for (const speed of [0, 1.5, 3.5, 6, 9]) {
      const run = (carried: boolean) => {
        armed(P, A, carried);
        A.reset(0, 0);
        const mv = speed > 0 ? { x: 0, z: 1 } : undefined;
        // 1 s on the ground, 25 frames in the air (up, then down), 1 s on the ground
        return handTurns(A, 145, (i) => {
          const air = i >= 60 && i < 85;
          A.update(i === 0 ? 0 : 1 / 60, air ? { speed, grounded: false, vy: 5 - (i - 60) * 0.5, moveDir: mv } : { speed, grounded: true, moveDir: mv });
        });
      };
      const c = run(true), n = run(false);
      for (const sd of SIDES) {
        cal(`${kind} jump at ${speed} ${sd}: carried ${c.max[sd].toFixed(1)} (#${c.at[sd]}), neutral ${n.max[sd].toFixed(1)}`);
        ok(c.max[sd] <= Math.max(n.max[sd] * 1.8, 20), `${kind} jump at ${speed} m/s ${sd}: a carried hand turns at most ${c.max[sd].toFixed(1)} deg per frame (#${c.at[sd]}; the neutral hand ${n.max[sd].toFixed(1)})`);
      }
    }
  }
});

test('the pelvis does not pop on landing, a crouched body included', () => {
  for (const kind of ['man', 'goblin', 'gimli', 'troll'] as const) {
    const def = resolveKind(kind);
    const { P, A } = make(def);
    for (const speed of [0, 3]) {
      armed(P, A, false);
      A.reset(0, 0);
      const mv = speed > 0 ? { x: 0, z: 1 } : undefined;
      const hips = A.ps.i('hips');
      let prev = -1, worst = 0, at = -1;
      for (let i = 0; i < 160; i++) {
        const air = i >= 60 && i < 90;
        A.update(i === 0 ? 0 : 1 / 60, air ? { speed, grounded: false, vy: 4 - (i - 60) * 0.5, moveDir: mv } : { speed, grounded: true, moveDir: mv });
        const y = A.ps.modelP[hips].y;
        if (prev >= 0 && Math.abs(y - prev) > worst) {
          worst = Math.abs(y - prev);
          at = i;
        }
        prev = y;
      }
      const lim = 0.12 * A.B.legLen;
      cal(`${kind} landing at ${speed}: the pelvis moves at most ${(worst * 100).toFixed(1)} cm per frame (#${at}), limit ${(lim * 100).toFixed(1)}`);
      ok(worst <= lim, `${kind} jump at ${speed} m/s: the pelvis moves ${(worst * 100).toFixed(1)} cm in one frame (#${at}), at most ${(lim * 100).toFixed(1)}`);
    }
  }
});

test('a hanging blade keeps its point off the ground through a landing', () => {
  const cases: [string, WeaponKind][] = [['man', 'sword'], ['goblin', 'cleaver'], ['gimli', 'dwarf_axe'], ['dwarf', 'axe'], ['aragorn', 'sword']];
  for (const [kind, w] of cases) {
    const def = resolveKind(kind as HumanoidKind);
    const { P, A } = make(def);
    const sc = KIND_SCALE[kind]?.[w] ?? 1;
    empty(A);
    give(P, A, 'r', w, sc, def.weapons.style);
    A.reset(0, 0);
    let rest = Infinity, low = Infinity, lowAt = -1;
    for (let i = 0; i < 200; i++) {
      const air = i >= 60 && i < 100;
      A.update(i === 0 ? 0 : 1 / 60, air ? { speed: 0, grounded: false, vy: 4 - (i - 60) * 0.5 } : { speed: 0, grounded: true });
      if (air) continue;
      const lowest = probe(P, A, 'r', w, sc, def.weapons.style).lowest;
      if (i < 60) rest = Math.min(rest, lowest);
      else if (lowest < low) {
        low = lowest;
        lowAt = i;
      }
    }
    cal(`${kind} ${w}: the point at rest ${(rest * 100).toFixed(1)} cm, lowest after landing ${(low * 100).toFixed(1)} cm (#${lowAt})`);
    ok(low >= 0, `${kind} ${w}: the point goes ${(low * 100).toFixed(1)} cm under the ground after landing (at rest ${(rest * 100).toFixed(1)} cm)`);
  }
});

// ── finite ───────────────────────────────────────────────────────────────────
test('no NaN in any state, with any item in either hand, for every kind, at every LOD', () => {
  const styles = [{}, { hunch: 1, crouch: 1, lean: 1, aggression: 1, stance: 1.8 }];
  const states: AnimInput[] = [
    { speed: 0, grounded: true },
    { speed: 0.3, grounded: true },
    { speed: 1.5, grounded: true, moveDir: { x: 0, z: 1 } },
    { speed: 4, grounded: true, moveDir: { x: 1, z: 0 } },
    { speed: 7, grounded: true, moveDir: { x: 0, z: -1 } },
    { speed: 13, grounded: true },
    { speed: 2, grounded: false, vy: 4 },
    { speed: 2, grounded: false, vy: -6 },
    { speed: 0, grounded: true, hit: 0.7 },
    { speed: 0, grounded: true, dead: 0.5, deathVariant: 1 },
    { speed: 0, grounded: true, aim: 1, draw: 0.6 },
    ...ATTACKS.flatMap((a) => [0, 0.1, 0.5, 0.9, 1].map((t) => ({ speed: 1, grounded: true, attack: { kind: a, t } }) as AnimInput)),
    ...SPECIALS.map((s) => ({ speed: 0, grounded: true, special: s }) as AnimInput),
  ];
  let n = 0;
  for (const kind of ALL_KINDS) {
    for (const st of styles) {
      const def0 = resolveKind(kind);
      const { P, A } = make({ ...def0, anim: { ...def0.anim, ...st } });
      for (const [l, r] of [['shield', 'sword'], ['torch', 'pike'], ['elven_knives', 'elven_knives'], ['elven_bow', 'club']] as [WeaponKind, WeaponKind][]) {
        empty(A);
        give(P, A, 'l', l, 1.4);
        give(P, A, 'r', r, 1.4);
        A.hasBow = l === 'elven_bow';
        for (const lod of [0, 1, 2] as const) {
          A.setLod(lod);
          for (const s of states) {
            A.reset(1.3, 0.4);
            for (let k = 0; k < 3; k++) A.update(1 / 30, s);
            n++;
            sound(A, `${kind} ${JSON.stringify(st)} ${l}/${r} LOD${lod} ${JSON.stringify(s)}`);
          }
        }
        A.setLod(0);
      }
    }
  }
  ok(n > 1000, `states probed (${n})`);
});

// ── the run, the LODs, the kinds that re-orient their prop ───────────────────
test('a run swaps a hanging blade for the fist held ahead; a shield stays up at any speed', () => {
  const { P, A } = make(resolveKind('man'));
  const poses = (carried: boolean, sp: number) => {
    const held = newHeldCarry();
    if (carried) {
      held.r.carry = 'hang';
      held.l.carry = 'shield';
    }
    return locomotionPose(A.B, 0.3, sp, 0, 1, 0.5, newPose(), held);
  };
  // at a sprint the sword hand is the old run pose, bit for bit (the shield hand is not: it stays up)
  const a = poses(true, 9), b = poses(false, 9);
  for (const i of [F.hrdx, F.hrdy, F.hrdz, F.hrtx, F.hrty, F.hrtz, F.hrx, F.hry, F.hrz]) ok(a[i] === b[i], `a sprint: the sword hand is the old run pose (slot ${i})`);
  empty(A);
  give(P, A, 'l', 'shield');
  for (const sp of [0, 1.5, 3, 5, 9, 13]) {
    step(A, { speed: sp, grounded: true, moveDir: { x: 0, z: 1 } }, 0.5, 0.2);
    ok(frame(P, A, 'l').axis.y > 0.85, `speed ${sp}: the shield still stands, axis.y ${frame(P, A, 'l').axis.y.toFixed(2)}`);
  }
});

test('every LOD shows the same carry (the cheap solves keep hanging blades and shields)', () => {
  for (const kind of ['man', 'gondor', 'troll', 'goblin'] as const) {
    const def = resolveKind(kind);
    const ref = make(def);
    give(ref.P, ref.A, 'r', 'sword');
    give(ref.P, ref.A, 'l', 'shield');
    idle(ref.A, 2.2);
    for (const lod of [1, 2] as const) {
      const { P, A } = make(def, def.height, lod);
      give(P, A, 'r', 'sword');
      give(P, A, 'l', 'shield');
      idle(A, 2.2);
      for (const sd of SIDES) {
        const a = frame(ref.P, ref.A, sd), b = frame(P, A, sd);
        ok(a.axis.angleTo(b.axis) * DEG < 1, `${kind} LOD${lod} ${sd}: the carried axis matches LOD0, ${(a.axis.angleTo(b.axis) * DEG).toFixed(2)} deg off`);
        ok(a.face.angleTo(b.face) * DEG < 1, `${kind} LOD${lod} ${sd}: and so does the face`);
      }
    }
  }
});

// ── the real thing: createHumanoid, with the kinds' own prop hooks ───────────────────────────
// scaleHeldWeapon (goblin, Gimli, Bolg, the berserker) and fitHeldWeapon (the trolls) rescale and re-orient the held prop
// at the first matrix update, and the animator measures the reach from the prop every frame: the carry has to come out
// right with the real, scaled prop. These build the real humanoids (~0.5 s a kind).

const IDLE: AnimInput = { speed: 0, grounded: true };
function real(kind: HumanoidKind, weapon?: WeaponKind, seed = 0, offhand?: WeaponKind): HumanoidExt {
  const h = createHumanoid({ kind, seed, weapon, offhand });
  // the hooks act at the first matrix update: animate, update, animate again
  for (let i = 0; i < 4; i++) h.animate(1 / 60, IDLE);
  h.root.updateMatrixWorld(true);
  for (let i = 0; i < 60; i++) h.animate(1 / 60, IDLE);
  h.root.updateMatrixWorld(true);
  return h;
}
const _pq = new THREE.Quaternion();
/** the prop's long axis and face in world space (the humanoid stands at the origin facing +Z), and its tip's height */
function propFrame(o: THREE.Object3D) {
  o.getWorldQuaternion(_pq);
  const tip = o.userData.tip as THREE.Object3D | undefined;
  return { axis: new THREE.Vector3(0, 1, 0).applyQuaternion(_pq), face: new THREE.Vector3(1, 0, 0).applyQuaternion(_pq), tipY: tip ? tip.getWorldPosition(new THREE.Vector3()).y : null };
}

test('every real humanoid carries its props as promised, with the kinds\' own scaling and fitting hooks', () => {
  const cases: [HumanoidKind, WeaponKind | undefined, number][] = [];
  for (const k of ALL_KINDS) {
    const w = resolveKind(k).weapons;
    if (carryOf(w.left ?? 'none') !== 'none' || carryOf(w.right ?? 'none') !== 'none') cases.push([k, undefined, 0]);
  }
  cases.push(['troll', 'warhammer', seedForBucket(2)]); // the war troll
  for (const w of ['cleaver', 'club', 'spear'] as WeaponKind[]) cases.push(['goblin', w, 0]); // the crowd's other weapons, on a crouched, short-armed body
  let n = 0;
  for (const [kind, weapon, seed] of cases) {
    const h = real(kind, weapon, seed);
    for (const hand of ['hand_l', 'hand_r'] as const) {
      const o = h.weaponObject(hand);
      if (!o) continue;
      const w = o.userData.kind as WeaponKind;
      const c = carryOf(w);
      if (c === 'none') continue;
      n++;
      const f = propFrame(o);
      const outward = hand === 'hand_l' ? 1 : -1;
      const tilt = Math.acos(Math.min(1, Math.abs(f.axis.y))) * DEG;
      const what = `${kind}${weapon ? `/${weapon}` : ''} ${hand} ${w}`;
      // the table of the kinds' prop scales that the model-only tests use
      const want = KIND_SCALE[kind]?.[w] ?? 1;
      ok(Math.abs(o.scale.y / want - 1) < 0.01, `${what}: the prop is scaled ${o.scale.y.toFixed(3)} on its long axis, KIND_SCALE says ${want}`);
      cal(`${what}: tilt ${tilt.toFixed(1)} tip ${f.tipY?.toFixed(3)} scale ${o.scale.y.toFixed(2)}`);
      if (c === 'hang') {
        ok(tilt >= 15 && tilt <= 75 && f.axis.y < 0, `${what}: a hanging prop points down within 15..75 deg of vertical, got ${tilt.toFixed(1)}`);
        ok(f.axis.z > 0.1 && f.axis.x * outward > 0, `${what}: it leans forward (${f.axis.z.toFixed(2)}) and out (${(f.axis.x * outward).toFixed(2)})`);
        if (f.tipY !== null) ok(f.tipY >= 0.015 * h.height, `${what}: the point stays off the ground, ${(f.tipY * 100).toFixed(1)} cm`);
      } else if (c === 'upright') {
        ok(tilt <= 25 && f.axis.y > 0, `${what}: an upright haft stands within 25 deg of vertical, got ${tilt.toFixed(1)}`);
      } else {
        const yaw = outYaw(f.face, outward);
        ok(tilt <= 15 && f.axis.y > 0 && Math.abs(yaw - SHIELD_FACE) <= FACE_TOL, `${what}: a shield stands (${tilt.toFixed(1)} deg) with its face ${yaw.toFixed(1)} deg out of straight ahead, want ${SHIELD_FACE} +- ${FACE_TOL}`);
      }
      // kinds that re-orient their prop in the socket (troll_weapon.ts fitHeldWeapon) fade out by how close the socket's +Y is to
      // the old forward carry (in the pelvis frame; their weight is smoothstep(dot, 0.82, 0.95)): at idle it must be zero, or
      // the prop is turned on top of the carry (and sinks into the ground, since the turn undoes the clearance tilt)
      if (kind === 'troll') ok(Math.abs(o.quaternion.w) > 1 - 1e-9, `${what}: the troll's fit must leave the prop as modelled at idle, it turned it by ${(2 * Math.acos(Math.min(1, Math.abs(o.quaternion.w))) * DEG).toFixed(2)} deg`);
    }
  }
  ok(n >= 20, `props probed (${n})`);
});

test('the first pose with a prop is solved for the prop as its kind scales it: no jump of the hand a frame later', () => {
  // scaleHeldWeapon and fitHeldWeapon rescale the prop when the socket's matrices update; the carry's ground clearance depends on its length
  const cases: [HumanoidKind, WeaponKind | undefined][] = [['goblin', undefined], ['goblin', 'scimitar'], ['gimli', undefined], ['troll', undefined], ['bolg', undefined], ['berserker', undefined]];
  for (const [kind, weapon] of cases) {
    for (const how of ['created', 'swapped'] as const) {
      const h = createHumanoid({ kind, seed: 0, weapon: how === 'created' ? weapon : 'none' });
      if (how === 'swapped') {
        for (let i = 0; i < 4; i++) h.animate(1 / 60, IDLE);
        h.root.updateMatrixWorld(true);
        h.setWeapon('hand_r', weapon ?? ((resolveKind(kind).weapons.right ?? 'none') as WeaponKind));
      }
      h.animate(1 / 60, IDLE); // the first pose with the prop: no render has updated the matrices yet
      const first = h.bones.hand_r.quaternion.clone();
      h.root.updateMatrixWorld(true);
      h.animate(1 / 60, IDLE);
      const second = h.bones.hand_r.quaternion.clone();
      const d = turn(first, second);
      cal(`${kind}${weapon ? `/${weapon}` : ''} ${how}: the hand turns ${d.toFixed(2)} deg between the first two frames`);
      ok(d < 3, `${kind}${weapon ? `/${weapon}` : ''} ${how}: the hand turns ${d.toFixed(1)} deg between its first two poses with the prop (the idle's own motion is < 1)`);
      h.dispose();
    }
  }
});

test('a walking humanoid keeps the point of its hanging prop off the ground (real props, real gait)', () => {
  const walkers: [HumanoidKind, WeaponKind | undefined][] = [['man', undefined], ['goblin', undefined], ['goblin', 'cleaver'], ['goblin', 'club'], ['troll', undefined], ['berserker', undefined], ['gimli', undefined], ['bolg', undefined]];
  for (const [kind, weapon] of walkers) {
    const h = real(kind, weapon);
    const o = h.weaponObject('hand_r')!;
    let lowest = Infinity;
    // walking speeds and the walk-to-run band (a goblin's run begins at ~2 m/s, a man's at 2.6): in the blend between the hanging blade and
    // the run's fist the blade has neither the solved tilt nor the fist's, and the swing of a crouched hand is ~40 cm: the carry lifts the wrist
    for (const speed of [0.8, 1.5, 2.25, 2.5, 2.75, 3.25]) {
      h.resetAnimation(0, 0);
      let low = Infinity;
      for (let i = 0; i < 150; i++) {
        h.animate(1 / 60, { speed, grounded: true, moveDir: { x: 0, z: 1 } });
        h.root.updateMatrixWorld(true);
        const tip = o.userData.tip as THREE.Object3D | undefined;
        if (tip) low = Math.min(low, tip.getWorldPosition(new THREE.Vector3()).y);
      }
      cal(`${kind}${weapon ? `/${weapon}` : ''} at ${speed} m/s: lowest point ${(low * 100).toFixed(1)} cm`);
      lowest = Math.min(lowest, low);
    }
    cal(`${kind}${weapon ? `/${weapon}` : ''} walking: lowest point ${(lowest * 100).toFixed(1)} cm`);
    ok(lowest >= 0, `${kind}${weapon ? `/${weapon}` : ''}: the point dips to ${(lowest * 100).toFixed(1)} cm while walking and running up`);
  }
});

/**
 * How far the body reaches into a left-hand shield (mm, 0 = clear): for every skinned vertex that lies under a triangle of the shield, looking
 * along its face normal, the depth beyond the BACK of the shield there. The hand and wrist around the grip bar (within 12 cm) are left out.
 */
function shieldCut(h: HumanoidExt): number {
  const o = h.weaponObject('hand_l');
  if (!o || o.userData.kind !== 'shield') return 0;
  h.root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(o.matrixWorld).invert();
  const held = new Set<THREE.Object3D>();
  for (const hand of ['hand_l', 'hand_r'] as const) h.weaponObject(hand)?.traverse((c) => held.add(c));
  // the shield's triangles in its own frame (x the face normal, y up, z along the fingers): [y0, z0, x0, y1, z1, x1, y2, z2, x2]
  const tris: number[][] = [];
  let y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  o.traverse((c) => {
    const m = c as THREE.Mesh;
    if (!m.isMesh || !m.geometry) return;
    const pos = m.geometry.getAttribute('position');
    const ix = m.geometry.index;
    const P: THREE.Vector3[] = [];
    for (let i = 0; i < pos.count; i++) {
      const p = new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld).applyMatrix4(inv);
      P.push(p);
      y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z);
    }
    const n = ix ? ix.count : pos.count;
    for (let i = 0; i < n; i += 3) {
      const a = P[ix ? ix.getX(i) : i], b = P[ix ? ix.getX(i + 1) : i + 1], d = P[ix ? ix.getX(i + 2) : i + 2];
      tris.push([a.y, a.z, a.x, b.y, b.z, b.x, d.y, d.z, d.x]);
    }
  });
  const v = new THREE.Vector3();
  let deepest = 0;
  h.root.traverseVisible((c) => {
    const m = c as THREE.Mesh;
    if (!m.isMesh || !m.geometry || held.has(c) || (m as unknown as THREE.InstancedMesh).isInstancedMesh) return;
    const pos = m.geometry.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
      m.getVertexPosition(i, v);
      v.applyMatrix4(m.matrixWorld).applyMatrix4(inv);
      if (v.x < 0.02 || v.y < y0 || v.y > y1 || v.z < z0 || v.z > z1 || Math.hypot(v.x, v.y, v.z) < 0.12) continue;
      // the back of the shield under this point: the lowest x of the triangles that cover (y, z)
      let back = Infinity;
      for (const q of tris) {
        const den = (q[4] - q[7]) * (q[0] - q[6]) + (q[6] - q[3]) * (q[1] - q[7]);
        if (Math.abs(den) < 1e-12) continue;
        const a = ((q[4] - q[7]) * (v.y - q[6]) + (q[6] - q[3]) * (v.z - q[7])) / den;
        const b = ((q[7] - q[1]) * (v.y - q[6]) + (q[0] - q[6]) * (v.z - q[7])) / den;
        if (a < 0 || b < 0 || a + b > 1) continue;
        back = Math.min(back, a * q[2] + b * q[5] + (1 - a - b) * q[8]);
      }
      if (back !== Infinity) deepest = Math.max(deepest, v.x - back);
    }
  });
  return deepest * 1000;
}

test('a shield stays clear of the body: real skin, real props, idle and a walk cycle', () => {
  // the sheets' bearers with their own shields, and the crowd kinds given one
  const cases: [HumanoidKind, WeaponKind | undefined][] = [['rohirrim', undefined], ['gondor', undefined], ['uruk', undefined], ['easterling', undefined], ['dwarf', 'shield'], ['orc', 'shield'], ['haradrim', 'shield'], ['goblin', 'shield']];
  for (const [kind, off] of cases) {
    const h = real(kind, undefined, 0, off);
    const what = `${kind}${off ? `+${off}` : ''}`;
    if (h.weaponObject('hand_l')?.userData.kind !== 'shield') {
      ok(false, `${what}: expected a shield in the left hand`);
      continue;
    }
    let worst = shieldCut(h);
    const idleCut = worst;
    for (const ph of [0, 0.25, 0.5, 0.75]) {
      h.resetAnimation(0.5, ph);
      for (let i = 0; i < 40; i++) h.animate(1 / 60, { speed: 1.5, grounded: true, moveDir: { x: 0, z: 1 } });
      worst = Math.max(worst, shieldCut(h));
    }
    cal(`${what}: the body reaches ${idleCut.toFixed(0)} mm into the shield at idle, ${worst.toFixed(0)} mm at worst while walking`);
    // cloth (a tunic skirt, a cloak) may brush the shield's back, as it did when the face looked straight out (28 mm); a thigh may not
    ok(worst <= 30, `${what}: the body reaches ${worst.toFixed(0)} mm into the shield (idle ${idleCut.toFixed(0)} mm)`);
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
(globalThis as unknown as { process: { exitCode?: number } }).process.exitCode = failed ? 1 : 0;
