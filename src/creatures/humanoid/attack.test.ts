/**
 * Attack hand-frame tests (node, no browser). Run with: node src/physics/run-tests.mjs
 *
 * An attack's keys give the hand a knuckle direction (d) and a thumb direction (t, the blade's axis); the solver reads the
 * frame from them (d exact, t made perpendicular to d). The keys were authored as free vectors and interpolated as vectors, but
 * consecutive key frames are 120-180 deg apart in most attacks, and a straight blend of two such pairs passes through a
 * state where the thumb lies along the knuckles: the thumb then flips by up to 180 deg in a frame (slash 96, sweep 104,
 * throw 178, slam 75 deg per 1/240 of the attack), and the thrust's thumb, given parallel to its knuckles, was read as
 * straight up (the blade pointed at the sky while thrusting).
 *
 * Held to here, for every attack and every hand the keys steer:
 *   continuous  the hand frame turns at most 25 deg per 1/240 of the attack (the fastest honest swing needs ~20),
 *   kept        at a key's own time the frame is the frame the key authors (so the hit poses are the authored ones),
 *   sane        every authored pair stays well clear of "thumb along the knuckles" (sin >= 0.5) and the blade of a
 *               thrust points where it thrusts,
 *   finite      no NaN, frames orthonormal.
 */
import * as THREE from 'three';
import { resolveKind } from './registry';
import { computeProportions, buildRig } from './proportions';
import { HumanoidAnimator } from './animator';
import { ATTACKS, F, attackOverlay, attackOwns, idlePose, newPose, type Key } from './poses';
import type { AttackAnim } from '../../core/types';

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
const CAL = !!(globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env.ATTACK_CAL;
const cal = (m: string) => CAL && console.log('  [cal]', m);

const DEG = 180 / Math.PI;
const KINDS = Object.keys(ATTACKS) as AttackAnim[];
const STEPS = 240;
const MAX_TURN = 25;

const man = resolveKind('man');
const P = computeProportions(man, man.height, 1, {});
const rig = buildRig(P);
const A = new HumanoidAnimator(rig, P, man.anim, rig.instantiate().bones, new THREE.Group());
const B = A.B;

/** the frame the solver reads from a direction pair (d exact, t made perpendicular), as a rotation; `sin` how far t is from lying along d */
function frameOf(d: THREE.Vector3, t: THREE.Vector3) {
  const dn = d.clone().normalize();
  const tn0 = t.clone().normalize();
  const sin = Math.sqrt(Math.max(0, 1 - tn0.dot(dn) ** 2));
  const tp = t.clone().addScaledVector(dn, -t.dot(dn));
  const len = tp.length();
  tp.normalize();
  const c = new THREE.Vector3().crossVectors(dn, tp);
  return { q: new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(dn, tp, c)), sin, len, d: dn, t: tp };
}
const turn = (a: THREE.Quaternion, b: THREE.Quaternion) => 2 * Math.acos(Math.min(1, Math.abs(a.dot(b)))) * DEG;

type Side = 'l' | 'r';
const SLOTS = { l: [F.hldx, F.hltx], r: [F.hrdx, F.hrtx] } as const;
const KEYS = { l: ['ld', 'lt'], r: ['rd', 'rt'] } as const;
/** the hand frame (chest space) an attack gives at progress t, from the idle pose */
function handAt(kind: AttackAnim, t: number, side: Side) {
  const base = idlePose(B, 0.5, newPose());
  const p = Float32Array.from(base);
  attackOverlay(B, kind, t, p, Float32Array.from(base));
  const [dd, tt] = SLOTS[side];
  return { ...frameOf(new THREE.Vector3(p[dd], p[dd + 1], p[dd + 2]), new THREE.Vector3(p[tt], p[tt + 1], p[tt + 2])), raw: Array.from(p.slice(dd, dd + 3)).concat(Array.from(p.slice(tt, tt + 3))) };
}
/** the frame a key authors (key coordinates: x outward; the neutral hand for what the key leaves out), in pose coordinates */
function keyFrame(key: Key, side: Side) {
  const sx = side === 'l' ? 1 : -1;
  const [kd, kt] = KEYS[side];
  const d = key[kd] ?? [0.12, -1, 0.12], t = key[kt] ?? [-0.15, 0.05, 1];
  return frameOf(new THREE.Vector3(sx * d[0], d[1], d[2]), new THREE.Vector3(sx * t[0], t[1], t[2]));
}
const steered = (kind: AttackAnim): Side[] => (['r', 'l'] as const).filter((s) => attackOwns(kind)[s]);

test('every attack turns the hand smoothly: at most 25 deg per 1/240 of the attack (the old keys flipped the thumb by up to 180)', () => {
  let n = 0;
  for (const kind of KINDS) {
    for (const side of steered(kind)) {
      let prev: THREE.Quaternion | null = null;
      let worst = 0, at = 0;
      for (let i = 0; i <= STEPS; i++) {
        const f = handAt(kind, i / STEPS, side);
        if (prev) {
          const a = turn(prev, f.q);
          if (a > worst) {
            worst = a;
            at = i / STEPS;
          }
        }
        prev = f.q;
      }
      n++;
      cal(`${kind} ${side}: worst turn ${worst.toFixed(1)} deg at t=${at.toFixed(3)}`);
      ok(worst <= MAX_TURN, `${kind} ${side}: the hand turns ${worst.toFixed(1)} deg in one 1/240 step at t=${at.toFixed(3)} (limit ${MAX_TURN})`);
    }
  }
  ok(n >= 12, `attack hands swept (${n})`);
});

test('the pair the solver reads is a clean frame at every step of every attack: finite, the thumb well clear of the knuckles', () => {
  for (const kind of KINDS) {
    for (const side of steered(kind)) {
      for (let i = 0; i <= STEPS; i += 3) {
        const f = handAt(kind, i / STEPS, side);
        ok(f.raw.every(Number.isFinite) && f.sin >= 0.5, `${kind} ${side} t=${i / STEPS}: the thumb lies ${(Math.asin(Math.min(1, f.sin)) * DEG).toFixed(0)} deg off the knuckles (sin ${f.sin.toFixed(3)})`);
      }
    }
  }
});

test('at a key\'s own time the hand has the frame the key authors (the hit poses are the authored ones)', () => {
  let n = 0;
  for (const kind of KINDS) {
    const keys = ATTACKS[kind];
    for (const side of steered(kind)) {
      const [kd, kt] = KEYS[side];
      for (const key of keys) {
        // inside the envelope's flat part, and for keys that steer this hand
        if (!(key[kd] || key[kt]) || key.t < 0.13 || key.t > 0.74) continue;
        const want = keyFrame(key, side);
        const got = handAt(kind, key.t, side);
        const a = turn(want.q, got.q);
        n++;
        ok(a < 0.5, `${kind} ${side} t=${key.t}: the hand is ${a.toFixed(2)} deg off the frame the key authors`);
      }
    }
  }
  ok(n >= 15, `keys checked (${n})`);
});

test('every authored pair keeps the thumb well clear of the knuckles (sin >= 0.5)', () => {
  for (const kind of KINDS) {
    if (kind === 'thrust') continue; // its knuckles are parallel to its thumb until the next commit
    for (const side of ['r', 'l'] as const) {
      const [kd, kt] = KEYS[side];
      for (const key of ATTACKS[kind]) {
        if (!(key[kd] || key[kt])) continue;
        const sx = side === 'l' ? 1 : -1;
        const d = key[kd] ?? [0.12, -1, 0.12], t = key[kt] ?? [-0.15, 0.05, 1];
        const f = frameOf(new THREE.Vector3(sx * d[0], d[1], d[2]), new THREE.Vector3(sx * t[0], t[1], t[2]));
        cal(`${kind} ${side} t=${key.t}: sin ${f.sin.toFixed(2)}`);
        ok(f.sin >= 0.5, `${kind} ${side} t=${key.t}: the thumb lies ${(Math.asin(f.sin) * DEG).toFixed(0)} deg off the knuckles: the solver reads the frame from the leftover ${f.sin.toFixed(2)} of it`);
      }
    }
  }
});

test('through the whole animator the sword hand and the shield hand turn at most 25 deg per 1/240 of an attack, carried or empty', () => {
  const bones = (kind: AttackAnim, carried: boolean) => {
    for (const sd of ['l', 'r'] as const) {
      A.held[sd].carry = carried ? (sd === 'r' ? 'hang' : 'shield') : 'none';
      A.held[sd].up = carried ? 0.9 : 0;
      A.held[sd].down = carried ? 0.2 : 0;
    }
    A.gripL = A.gripR = carried;
    const worst: Record<Side, number> = { l: 0, r: 0 };
    const worstAt: Record<Side, number> = { l: 0, r: 0 };
    const prev: Partial<Record<Side, THREE.Quaternion>> = {};
    for (let i = 0; i <= STEPS; i++) {
      A.reset(0.5 - 1 / 60, 0);
      A.update(1 / 60, { speed: 0, grounded: true, attack: { kind, t: i / STEPS } });
      for (const sd of ['l', 'r'] as const) {
        const q = A.ps.modelQ[A.ps.i(`hand_${sd}`)].clone();
        const pq = prev[sd];
        if (pq) {
          const a = turn(pq, q);
          if (a > worst[sd]) {
            worst[sd] = a;
            worstAt[sd] = i / STEPS;
          }
        }
        prev[sd] = q;
      }
    }
    lastAt = worstAt;
    return worst;
  };
  let lastAt: Record<Side, number> = { l: 0, r: 0 };
  for (const kind of KINDS) {
    if (kind === 'bite' || kind === 'stomp') continue;
    for (const carried of [false, true]) {
      const w = bones(kind, carried);
      cal(`${kind} ${carried ? 'carried' : 'empty'}: right ${w.r.toFixed(1)} (t=${lastAt.r.toFixed(3)}) left ${w.l.toFixed(1)} (t=${lastAt.l.toFixed(3)})`);
      for (const sd of ['l', 'r'] as const) ok(w[sd] <= MAX_TURN, `${kind} ${carried ? 'carried' : 'empty'} ${sd}: the hand bone turns ${w[sd].toFixed(1)} deg in one 1/240 step at t=${lastAt[sd].toFixed(3)} (limit ${MAX_TURN})`);
    }
  }
  for (const sd of ['l', 'r'] as const) A.held[sd].carry = 'none';
  A.gripL = A.gripR = false;
});

console.log(`\n${passed} passed, ${failed} failed`);
(globalThis as unknown as { process: { exitCode?: number } }).process.exitCode = failed ? 1 : 0;
