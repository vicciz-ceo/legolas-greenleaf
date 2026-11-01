/**
 * Held-item carry tests (node, no browser). Run with: node src/physics/run-tests.mjs
 *
 * A held item's long axis is the hand's thumb axis and the neutral hand points the thumb straight ahead, so at
 * rest every blade lay across the body and every shield lay flat like a flag. The rest pose (idle, walk, jump)
 * now carries what the hands hold (poses.ts `Carry`): blades, axes, maces, clubs and hammers hang point-down
 * beside the thigh, tilted forward and out; spears, pikes and torches stand; a shield stands vertical on the
 * forearm with its face out. Attacks blend from that rest and keep their own keys.
 *
 * Held to here, for every body the game can produce (every registered kind, any height, both hands, every LOD):
 *   placed      the item's axis, face and lowest point are what the carry promises, and the point of a hanging
 *               blade stays off the ground however long it is,
 *   untouched   a hand that holds nothing (or a bow, a crossbow) keeps the neutral hand bit for bit, an attack at its
 *               first and last instant is the carried rest pose, and its own keys are not changed by the carry,
 *   continuous  the hand's orientation varies smoothly with time, speed and the attack's progress (no flips, no jumps),
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
import type { AnimInput, AttackAnim, SpecialPose, WeaponKind } from '../../core/types';
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
/** the scale the kinds' extras give a held item (scaleHeldWeapon in gimli.ts, bolg.ts, uruk.ts) */
const KIND_SCALE: Record<string, Partial<Record<WeaponKind, number>>> = { gimli: { dwarf_axe: 0.65 }, bolg: { mace: 0.9 }, berserker: { sword: 1.12 } };

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
            ok(pr.face > 0.9, `${what}: the shield's face looks outward, got ${pr.face.toFixed(2)}`);
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

test('shields and spears stand up, the shield faces out, in the left hand or the right', () => {
  const { P, A } = make(resolveKind('man'));
  for (const sd of SIDES) {
    empty(A);
    give(P, A, sd, 'shield');
    idle(A, 0.5);
    let pr = probe(P, A, sd, 'shield');
    ok(pr.tilt <= 15 && pr.up > 0.95 && pr.face > 0.9, `${sd} shield: upright (${pr.tilt.toFixed(1)} deg) and face out (${pr.face.toFixed(2)})`);
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

test('a hanging prop points well below the horizontal at idle (kinds that re-orient a horizontal prop leave it alone)', () => {
  // troll_weapon.ts's fitHeldWeapon turns the prop only while the socket's +Y is near horizontal (weight
  // 1 - smoothstep(|y|, 0.35, 0.75)): at idle every hanging item must be steeper than that
  for (const kind of ALL_KINDS) {
    const def = resolveKind(kind);
    const w = (def.weapons.right ?? 'none') as WeaponKind;
    if (carryOf(w) !== 'hang') continue;
    const { P, A } = make(def);
    give(P, A, 'r', w, KIND_SCALE[kind]?.[w] ?? 1, def.weapons.style);
    for (const t of [0, 1.7, 9.3]) {
      idle(A, t);
      const ay = Math.abs(frame(P, A, 'r').axis.y);
      ok(ay >= 0.75, `${kind} ${w} t=${t}: |axis.y| ${ay.toFixed(2)} must be >= 0.75`);
    }
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
(globalThis as unknown as { process: { exitCode?: number } }).process.exitCode = failed ? 1 : 0;
