/**
 * Humanoid stance tests (node, no browser). Run with: node src/physics/run-tests.mjs
 *
 * The idle stance is two-bone IK on both legs, built from the body scale and the kind's style (hunch,
 * aggression, stance). For every body the game can produce (any height, which the kinds vary per
 * instance; any build; every registered kind) it must be
 *   planted     both ankles stand on their rest height (within 1 cm) and neither leg is stretched
 *               (a stretched leg translates the shin and opens a gap at the knee),
 *   sane        knee flexion stays within MAX_STANCE_FLEX (the trolls and goblins used to idle at
 *               49-57 deg: knees folded like a kneeling figure; a man stands at ~27 deg); the same
 *               cap bounds the crouch the walk starts from (the leg carrying the weight). The
 *               `crouch` style raises the limit to CROUCH_MAX_FLEX (deep squats),
 *   continuous  flexion varies smoothly with height, build, style and time (no jumps).
 * The `crouch`, `lean` and `stance` styles are held to the same, and to what they promise: a full crouch
 * is a ~78 % high squat with a level gaze, a lean pitches the torso ~15 deg, stance 1.4 stands as wide as
 * the reference sheets, and a body that sets none of them is bit-identical to the frozen stance (goldens).
 *
 * A reported "idle lifts a foot and bends a knee at heights 1.74-1.76, fine at 1.77" turned out NOT to be this solve
 * (it is height independent: the sweep below pins that) but a hole in the sculpted voxel mesh (kit/mesher.ts).
 */
import * as THREE from 'three';
import { ALL_KINDS, DEFAULT_ANIM, DEFAULT_BUILD, resolveKind } from './registry';
import { computeProportions, buildRig, type Proportions } from './proportions';
import { HumanoidAnimator } from './animator';
import { CROUCH_MAX_FLEX, F, MAX_STANCE_FLEX, idlePose, locomotionPose, newPose, stanceDrop, stanceFlexLimit, type BodyMetrics } from './poses';
import type { AnimStyle, BodyBuild, ResolvedKind } from './types';

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

const DEG = 180 / Math.PI;
/** limit on knee flexion (deg): the stance cap; the tolerance covers float32 poses only (the cap already includes the idle's sway) */
const FLEX_LIMIT = MAX_STANCE_FLEX * DEG + 0.05;
const PLANTED = 0.01; // m
const TIMES = [0, 0.5, 1.7, 4.1, 9.3, 17.9, 33.3, 61.1];

interface Stance {
  /** knee flexion per leg (deg, 0 = straight) */
  flex: [number, number];
  /** ankle height above its rest height per leg (m) */
  lift: [number, number];
  /** how far the solver stretched the bones of a leg (m): a stretched leg opens a gap at the knee */
  stretch: number;
}

function body(def: ResolvedKind, height: number, lod: 0 | 1 = 0) {
  const P = computeProportions(def, height, 1, {});
  const rig = buildRig(P);
  const inst = rig.instantiate();
  const A = new HumanoidAnimator(rig, P, def.anim, inst.bones, new THREE.Group());
  if (lod) A.setLod(lod);
  return { P, A };
}

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
/** idle at clock time t, through the real animator (full IK at LOD 0, the swing-only solve at LOD 1) */
function idle(P: Proportions, A: HumanoidAnimator, t: number): Stance {
  A.reset(t - 1 / 60, 0);
  A.update(1 / 60, { speed: 0, grounded: true });
  return measure(P, A);
}
/** the lab's walk (1.5 m/s, or any speed) at a gait phase in cycles */
function walk(P: Proportions, A: HumanoidAnimator, phase: number, speed = 1.5): Stance {
  A.reset(0.5, phase);
  A.update(0, { speed, grounded: true, moveDir: { x: 0, z: 1 } });
  return measure(P, A);
}
interface Posture {
  /** top of the head (m), the head kept in its own pitch */
  crown: number;
  /** forward pitch of the chest and of the head (deg, + = leaning forward): the head's is the gaze */
  torso: number;
  gaze: number;
  /** the head joint's forward position (m) */
  headFwd: number;
  /** |x| of the left ankle: how far apart the feet stand (m) */
  footX: number;
}
function posture(P: Proportions, A: HumanoidAnimator): Posture {
  const ps = A.ps;
  const lean = (bone: string) => {
    const u = _a.set(0, 1, 0).applyQuaternion(ps.modelQ[ps.i(bone)]);
    return Math.atan2(u.z, u.y) * DEG;
  };
  const head = ps.modelP[ps.i('head')];
  const gaze = lean('head');
  return { crown: head.y + 0.93 * P.headH * Math.cos(gaze / DEG), torso: lean('chest'), gaze, headFwd: head.z, footX: Math.abs(ps.modelP[ps.i('foot_l')].x) };
}
function measure(P: Proportions, A: HumanoidAnimator): Stance {
  const ps = A.ps;
  const out: Stance = { flex: [0, 0], lift: [0, 0], stretch: 0 };
  (['l', 'r'] as const).forEach((sd, i) => {
    const th = ps.modelP[ps.i(`thigh_${sd}`)];
    const kn = ps.modelP[ps.i(`shin_${sd}`)];
    const an = ps.modelP[ps.i(`foot_${sd}`)];
    _a.subVectors(kn, th).normalize();
    _b.subVectors(an, kn).normalize();
    out.flex[i] = Math.acos(Math.min(1, Math.max(-1, _a.dot(_b)))) * DEG;
    out.lift[i] = an.y - P.j[`foot_${sd}`][1];
    out.stretch = Math.max(out.stretch, ps.offset[ps.i(`shin_${sd}`)].length() + ps.offset[ps.i(`foot_${sd}`)].length());
  });
  return out;
}

const mx = (s: Stance) => Math.max(s.flex[0], s.flex[1]);
const label = (kind: string, h: number, t: number) => `${kind} h=${h.toFixed(3)} t=${t}`;

/** assert one stance is planted, unstretched and within the flexion limit of its `crouch` style */
function sane(s: Stance, what: string, crouch = 0) {
  const limit = crouch > 0 ? stanceFlexLimit(crouch) * DEG + 0.05 : FLEX_LIMIT;
  ok(Math.abs(s.lift[0]) <= PLANTED && Math.abs(s.lift[1]) <= PLANTED, `${what}: ankles must stay on the ground, got ${(s.lift[0] * 1000).toFixed(1)} / ${(s.lift[1] * 1000).toFixed(1)} mm`);
  ok(s.stretch <= 1e-6, `${what}: legs must not stretch (gap at the knee), got ${(s.stretch * 1000).toFixed(2)} mm`);
  ok(mx(s) <= limit, `${what}: knee flexion ${mx(s).toFixed(1)} deg must be <= ${limit.toFixed(1)}`);
}

/** deterministic pseudo random numbers in [0, 1) */
function rng(seed: number) {
  let x = seed >>> 0;
  return () => {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
    return x / 4294967296;
  };
}

const withBuild = (def: ResolvedKind, build: Partial<ResolvedKind['build']>, anim: Partial<ResolvedKind['anim']> = {}): ResolvedKind => ({ ...def, build: { ...def.build, ...build }, anim: { ...def.anim, ...anim } });

const CAL = !!(globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env.STANCE_CAL;
const cal = (m: string) => CAL && console.log('  [cal]', m);

// ── every registered kind at its default height ──────────────────────────────
test('every kind idles planted with sane knees (LOD 0 and 1)', () => {
  for (const kind of ALL_KINDS) {
    const def = resolveKind(kind);
    for (const lod of [0, 1] as const) {
      const { P, A } = body(def, def.height, lod);
      let worst = 0;
      for (const t of TIMES) {
        const s = idle(P, A, t);
        worst = Math.max(worst, mx(s));
        // a kind that sets `crouch` (the goblin) is held to its own crouch-adjusted limit, every other kind to 40 deg
        sane(s, `${kind} LOD${lod} ${label(kind, def.height, t)}`, def.anim.crouch ?? 0);
      }
      cal(`${kind} LOD${lod} worst flexion ${worst.toFixed(1)} deg`);
    }
  }
});

// ── the walk's base crouch ───────────────────────────────────────────────────
test('every kind walks with its planted leg inside a sane knee flexion (LOD 0 and 1)', () => {
  // the stride adds the swing leg's bend and the pelvis bob; the leg carrying the weight stays near the stance
  // (trolls walked at 57 deg, goblins at 52 deg before the crouch was capped)
  const WALK_STANCE_LIMIT = 45;
  for (const kind of ALL_KINDS) {
    const def = resolveKind(kind);
    // crouching kinds scuttle: their planted leg stays near their own crouch limit (as in the crouch sweep below)
    const crouch = def.anim.crouch ?? 0;
    const walkLimit = crouch > 0 ? stanceFlexLimit(crouch) * DEG + 12 : WALK_STANCE_LIMIT;
    for (const lod of [0, 1] as const) {
      const { P, A } = body(def, def.height, lod);
      let worst = 0;
      for (let k = 0; k < 40; k++) {
        const s = walk(P, A, k / 40);
        for (let i = 0; i < 2; i++) {
          if (s.lift[i] >= PLANTED) continue; // swinging
          worst = Math.max(worst, s.flex[i]);
          ok(s.flex[i] <= walkLimit, `${kind} LOD${lod} walk phase ${(k / 40).toFixed(3)}: planted leg flexion ${s.flex[i].toFixed(1)} deg must be <= ${walkLimit.toFixed(0)}`);
        }
      }
      cal(`${kind} LOD${lod} walk planted-leg worst flexion ${worst.toFixed(1)} deg`);
    }
  }
});

// ── heights: the stance does not depend on how tall an instance is ───────────
test('idle is planted and continuous over height (crowd variation, 1.70-1.80 m men)', () => {
  const cases: { kind: 'man' | 'elf' | 'troll' | 'goblin' | 'gimli' | 'bolg'; lo: number; hi: number; step: number }[] = [
    { kind: 'man', lo: 1.7, hi: 1.8, step: 0.005 }, // the reported window
    { kind: 'man', lo: 1.55, hi: 2.0, step: 0.01 },
    { kind: 'elf', lo: 1.7, hi: 2.0, step: 0.01 },
    { kind: 'troll', lo: 4.1, hi: 4.9, step: 0.05 },
    { kind: 'goblin', lo: 1.3, hi: 1.7, step: 0.01 },
    { kind: 'gimli', lo: 1.2, hi: 1.6, step: 0.01 },
    { kind: 'bolg', lo: 2.4, hi: 2.9, step: 0.02 },
  ];
  for (const c of cases) {
    const def = resolveKind(c.kind);
    for (const t of [0.5, 9.3]) {
      let prev: Stance | null = null;
      let maxStep = 0;
      let lo = Infinity, hi = -Infinity;
      for (let h = c.lo; h <= c.hi + 1e-9; h += c.step) {
        const { P, A } = body(def, h);
        const s = idle(P, A, t);
        sane(s, `${c.kind} ${label(c.kind, h, t)}`, def.anim.crouch ?? 0);
        if (prev) maxStep = Math.max(maxStep, Math.abs(mx(s) - mx(prev)));
        prev = s;
        lo = Math.min(lo, mx(s));
        hi = Math.max(hi, mx(s));
      }
      cal(`${c.kind} t=${t} height sweep: max step ${maxStep.toFixed(4)} deg, range ${(hi - lo).toFixed(4)} deg`);
      ok(maxStep <= 0.1, `${c.kind} t=${t}: knee flexion must vary continuously over height, max step ${maxStep.toFixed(3)} deg per ${c.step} m`);
    }
  }
});

// ── builds ───────────────────────────────────────────────────────────────────
test('idle stays planted, sane and continuous over leg length, hips, feet and head size', () => {
  const man = resolveKind('man');
  const sweeps: { key: 'legLength' | 'hips' | 'footSize' | 'headSize'; lo: number; hi: number; step: number }[] = [
    { key: 'legLength', lo: 0.6, hi: 1.4, step: 0.02 },
    { key: 'hips', lo: 0.7, hi: 1.7, step: 0.025 },
    { key: 'footSize', lo: 0.7, hi: 1.8, step: 0.025 },
    { key: 'headSize', lo: 0.7, hi: 1.7, step: 0.025 },
  ];
  for (const sw of sweeps) {
    for (const [h, style] of [[1.78, {}], [4.5, { hunch: 0.95, aggression: 0.8, stance: 1.3 }], [1.4, { hunch: 0.6, aggression: 0.7 }]] as [number, Partial<ResolvedKind['anim']>][]) {
      let prev: Stance | null = null;
      let maxStep = 0;
      for (let v = sw.lo; v <= sw.hi + 1e-9; v += sw.step) {
        const { P, A } = body(withBuild(man, { [sw.key]: v }, style), h);
        const s = idle(P, A, 0.5);
        sane(s, `${sw.key}=${v.toFixed(3)} h=${h} style=${JSON.stringify(style)}`);
        if (prev) maxStep = Math.max(maxStep, Math.abs(mx(s) - mx(prev)));
        prev = s;
      }
      cal(`${sw.key} h=${h} max step ${maxStep.toFixed(3)} deg per ${sw.step}`);
      ok(maxStep <= 1.5, `${sw.key} sweep h=${h}: knee flexion must vary continuously, max step ${maxStep.toFixed(3)} deg per ${sw.step}`);
    }
  }
});

test('idle stays planted, sane and continuous over the style (hunch, aggression, stance)', () => {
  const orc = resolveKind('orc');
  for (const [key, lo, hi, step] of [['hunch', 0, 1, 0.02], ['aggression', 0, 1, 0.02], ['stance', 0.7, 1.6, 0.02]] as const) {
    for (const legLength of [0.78, 1.0]) {
      let prev: Stance | null = null;
      let maxStep = 0;
      for (let v = lo; v <= hi + 1e-9; v += step) {
        const { P, A } = body(withBuild(orc, { legLength }, { [key]: v }), 2.0);
        const s = idle(P, A, 0.5);
        sane(s, `${key}=${v.toFixed(2)} legLength=${legLength}`);
        if (prev) maxStep = Math.max(maxStep, Math.abs(mx(s) - mx(prev)));
        prev = s;
      }
      cal(`${key} legLength=${legLength} max step ${maxStep.toFixed(3)} deg per ${step}`);
      ok(maxStep <= 1.0, `${key} sweep legLength=${legLength}: knee flexion must vary continuously, max step ${maxStep.toFixed(3)} deg per ${step}`);
    }
  }
});

test('idle is planted and sane for random extreme builds, styles and heights', () => {
  const r = rng(0x5a17);
  const U = (a: number, b: number) => a + (b - a) * r();
  const base = resolveKind('man');
  for (let i = 0; i < 400; i++) {
    const def = withBuild(
      base,
      { legLength: U(0.6, 1.4), hips: U(0.7, 1.7), footSize: U(0.7, 1.8), headSize: U(0.7, 1.7), armLength: U(0.8, 1.4), bulk: U(0.8, 1.5) },
      { hunch: U(0, 1), aggression: U(0, 1), stance: U(0.7, 2.2), swagger: U(0, 1), grace: U(0, 1), crouch: U(0, 1), lean: U(0, 1) },
    );
    const h = U(0.9, 5);
    const lod = i % 2 ? 1 : 0;
    const { P, A } = body(def, h, lod);
    for (const t of [0.5, 7.7, 23.1]) sane(idle(P, A, t), `random build #${i} LOD${lod} h=${h.toFixed(2)} ${JSON.stringify(def.build)} ${JSON.stringify(def.anim)} t=${t}`, def.anim.crouch);
  }
});

// ── time ─────────────────────────────────────────────────────────────────────
test('idle knees vary continuously over time', () => {
  for (const kind of ['man', 'troll', 'goblin', 'gimli'] as const) {
    const def = resolveKind(kind);
    const { P, A } = body(def, def.height);
    let prev: Stance | null = null;
    let maxStep = 0;
    for (let t = 0; t < 90; t += 1 / 30) {
      const s = idle(P, A, t);
      if (prev) maxStep = Math.max(maxStep, Math.abs(mx(s) - mx(prev)));
      prev = s;
    }
    cal(`${kind} time max step ${maxStep.toFixed(4)} deg per 1/30 s`);
    ok(maxStep <= 0.25, `${kind}: knee flexion must vary continuously over time, max step ${maxStep.toFixed(3)} deg per 1/30 s`);
  }
});

// ── crouch, lean, stance ─────────────────────────────────────────────────────
/**
 * Synthetic bodies: explicit builds and styles, independent of the kinds (their owners keep tuning them),
 * so the sweeps and the goldens below stay put. Styles never set crouch, lean or a stance above 1 here.
 */
interface SynthBody {
  name: string;
  h: number;
  build: Partial<BodyBuild>;
  anim: Partial<AnimStyle>;
}
const BASE_BUILD: BodyBuild = { shoulders: 1, hips: 1, bulk: 1, belly: 0, chest: 1, armLength: 1, legLength: 1, headSize: 1, neck: 1, neckThick: 1, hunch: 0, handSize: 1, footSize: 1, muscle: 0.4 };
const A0: AnimStyle = { hunch: 0, swagger: 0.2, aggression: 0.3, stance: 1, armSwing: 1, cadence: 1, grace: 0.3, crouch: 0, lean: 0 };
const BODIES: SynthBody[] = [
  { name: 'man', h: 1.78, build: { shoulders: 1, bulk: 1, muscle: 0.4 }, anim: { swagger: 0.2, aggression: 0.35 } },
  { name: 'elf', h: 1.86, build: { legLength: 1.05, shoulders: 0.95, hips: 0.95, neck: 1.1 }, anim: { grace: 1, swagger: 0.05, aggression: 0.2, stance: 0.95, armSwing: 0.85 } },
  { name: 'brute', h: 2.0, build: { bulk: 1.2, shoulders: 1.2, hips: 1.1, legLength: 0.9, hunch: 0.4, handSize: 1.2 }, anim: { hunch: 0.4, swagger: 0.55, aggression: 0.8, armSwing: 1.1 } },
  { name: 'goblin', h: 1.48, build: { legLength: 0.8, shoulders: 0.95, headSize: 1.15, armLength: 1.2, footSize: 1.2 }, anim: { hunch: 0.92, swagger: 0.3, aggression: 0.9, cadence: 1.2, armSwing: 1.3 } },
  { name: 'troll', h: 4.52, build: { shoulders: 1.6, hips: 1.45, bulk: 1.35, legLength: 1.03, headSize: 1.38, footSize: 1.2, handSize: 1.6 }, anim: { hunch: 0.95, swagger: 0.7, aggression: 0.8, cadence: 0.9, armSwing: 1.2 } },
  { name: 'dwarf', h: 1.4, build: { shoulders: 1.25, hips: 1.1, bulk: 1.3, legLength: 0.72, armLength: 1.05 }, anim: { swagger: 0.5, aggression: 0.5, cadence: 1.05 } },
  { name: 'gaunt', h: 1.95, build: { legLength: 1.2, shoulders: 0.85, hips: 0.9, bulk: 0.8, headSize: 0.9 }, anim: { swagger: 0.1, aggression: 0.1, grace: 0.8, cadence: 0.95 } },
];
/** a synthetic body's definition, optionally with extra styles */
const synth = (b: SynthBody, style: Partial<AnimStyle> = {}): ResolvedKind => ({ ...resolveKind('man'), build: { ...BASE_BUILD, ...b.build }, anim: { ...A0, ...b.anim, ...style } });

/** FNV-1a over the float32 bits of some poses */
function hashPoses(poses: Float32Array[]): string {
  let h = 0x811c9dc5;
  for (const p of poses) {
    const u = new Uint32Array(p.buffer, p.byteOffset, p.length);
    for (let i = 0; i < u.length; i++) {
      h ^= u[i];
      h = Math.imul(h, 0x01000193) >>> 0;
    }
  }
  return h.toString(16).padStart(8, '0');
}
/** idle at three times and the walk / jog / run at five gait phases of the synthetic bodies, recorded before the crouch, lean and stance styles existed */
const GOLDEN: Record<string, string> = { man: '03ec149b', elf: '7cd1a5f1', brute: '9df5ba12', goblin: 'dacfe5d5', troll: '6f2b184b', dwarf: '838982d6', gaunt: 'ee5f04c4' };

test('a body that sets no crouch, lean or stance above 1 keeps the frozen stance bit for bit', () => {
  for (const b of BODIES) {
    const { A } = body(synth(b), b.h);
    const poses: Float32Array[] = [];
    for (const t of [0, 0.5, 7.3]) poses.push(Float32Array.from(idlePose(A.B, t, newPose())));
    for (const [sp, ph] of [[1.5, 0], [1.5, 0.3], [1.5, 0.6], [6.5, 0.2], [3.5, 0.45]] as const) poses.push(Float32Array.from(locomotionPose(A.B, ph, sp, 0, 1, 0.5, newPose())));
    const hash = hashPoses(poses);
    cal(`golden ${b.name}: ${hash}`);
    ok(hash === GOLDEN[b.name], `${b.name}: idle / walk poses changed (${hash}, frozen ${GOLDEN[b.name]}); only update GOLDEN for an intended change of the base stance`);
  }
});

test('crouch: planted, inside the crouch limit, continuous, a ~78 % high squat with a level gaze', () => {
  for (const b of BODIES) {
    for (const [lean, stance] of [[0, 1], [1, 1], [0, 1.4], [1, 1.4]] as const) {
      const at = (crouch: number) => {
        const { P, A } = body(synth(b, { crouch, lean, stance }), b.h);
        return { s: idle(P, A, 0.5), q: posture(P, A) };
      };
      const stand = at(0);
      let prev = stand;
      let maxStep = 0;
      let last = stand;
      for (let c = 0.02; c <= 1 + 1e-9; c += 0.02) {
        const cur = at(c);
        sane(cur.s, `${b.name} crouch=${c.toFixed(2)} lean=${lean} stance=${stance}`, c);
        maxStep = Math.max(maxStep, Math.abs(mx(cur.s) - mx(prev.s)));
        ok(mx(cur.s) >= mx(prev.s) - 0.05, `${b.name} lean=${lean} stance=${stance}: a deeper crouch must not straighten the knee (crouch ${c.toFixed(2)})`);
        ok(cur.q.crown <= prev.q.crown + 1e-4, `${b.name} lean=${lean} stance=${stance}: a deeper crouch must not raise the head (crouch ${c.toFixed(2)})`);
        ok(cur.q.torso >= prev.q.torso - 0.05, `${b.name} lean=${lean} stance=${stance}: a deeper crouch pitches the torso forward (crouch ${c.toFixed(2)})`);
        ok(Math.abs(cur.q.gaze - stand.q.gaze) <= 1, `${b.name} crouch=${c.toFixed(2)}: the gaze must stay level, head pitch moved by ${(cur.q.gaze - stand.q.gaze).toFixed(2)} deg`);
        prev = cur;
        last = cur;
      }
      const ratio = last.q.crown / stand.q.crown;
      cal(`${b.name} lean=${lean} stance=${stance}: crouch 1 -> flexion ${mx(last.s).toFixed(1)} deg, crown ${(100 * ratio).toFixed(1)} %, torso +${(last.q.torso - stand.q.torso).toFixed(1)} deg, head fwd +${((last.q.headFwd - stand.q.headFwd) / b.h * 100).toFixed(1)} % H, max step ${maxStep.toFixed(2)} deg per 0.02`);
      // flexion grows like sqrt(drop) from a straight leg, so the first steps are the steepest (long-legged: ~4 deg per 0.02)
      ok(maxStep <= 5, `${b.name} lean=${lean} stance=${stance}: knee flexion must vary continuously over crouch, max step ${maxStep.toFixed(2)} deg per 0.02`);
      ok(mx(last.s) >= 85 && mx(last.s) <= CROUCH_MAX_FLEX * DEG + 0.05, `${b.name}: a full crouch bends the knees ~90-100 deg, got ${mx(last.s).toFixed(1)}`);
      ok(ratio >= 0.72 && ratio <= 0.88, `${b.name}: a full crouch lowers the head to ~78 % of the standing height (short legs a little less), got ${(100 * ratio).toFixed(1)} %`);
      ok(last.q.torso - stand.q.torso >= 40 && last.q.torso - stand.q.torso <= 52, `${b.name}: a full crouch pitches the torso ~46 deg forward, got ${(last.q.torso - stand.q.torso).toFixed(1)}`);
      ok(last.q.headFwd - stand.q.headFwd >= 0.1 * b.h, `${b.name}: the head must jut forward in a full crouch, got ${(last.q.headFwd - stand.q.headFwd).toFixed(3)} m`);
    }
  }
});

test('crouch: an average man and a goblin land on ~78 % at full crouch (the goblin sheet is 77 %)', () => {
  for (const name of ['man', 'goblin']) {
    const b = BODIES.find((x) => x.name === name)!;
    const at = (crouch: number) => {
      const { P, A } = body(synth(b, { crouch }), b.h);
      idle(P, A, 0.5);
      return posture(P, A).crown;
    };
    const ratio = at(1) / at(0);
    ok(ratio >= 0.76 && ratio <= 0.81, `${name}: full crouch head height ${(100 * ratio).toFixed(1)} % of standing must be ~78 %`);
  }
});

test('lean: the torso pitches ~15 deg forward with a level gaze, the head and arms forward, the knees untouched', () => {
  for (const b of BODIES) {
    for (const crouch of [0, 0.6]) {
      const at = (lean: number) => {
        const { P, A } = body(synth(b, { lean, crouch }), b.h);
        return { s: idle(P, A, 0.5), q: posture(P, A), A };
      };
      const stand = at(0);
      let prev = stand;
      let maxStep = 0;
      let last = stand;
      for (let l = 0.05; l <= 1 + 1e-9; l += 0.05) {
        const cur = at(l);
        sane(cur.s, `${b.name} lean=${l.toFixed(2)} crouch=${crouch}`, crouch);
        maxStep = Math.max(maxStep, Math.abs(cur.q.torso - prev.q.torso));
        ok(Math.abs(cur.q.gaze - stand.q.gaze) <= 1, `${b.name} lean=${l.toFixed(2)}: the gaze must stay level, head pitch moved by ${(cur.q.gaze - stand.q.gaze).toFixed(2)} deg`);
        ok(Math.abs(mx(cur.s) - mx(stand.s)) <= 0.05, `${b.name} lean=${l.toFixed(2)}: a lean does not bend the knees (${mx(stand.s).toFixed(2)} -> ${mx(cur.s).toFixed(2)})`);
        prev = cur;
        last = cur;
      }
      const dTorso = last.q.torso - stand.q.torso;
      cal(`${b.name} crouch=${crouch}: lean 1 -> torso +${dTorso.toFixed(1)} deg, head fwd +${(100 * (last.q.headFwd - stand.q.headFwd) / b.h).toFixed(1)} % H, max step ${maxStep.toFixed(2)} deg per 0.05`);
      ok(dTorso >= 13.5 && dTorso <= 16.5, `${b.name} crouch=${crouch}: a full lean pitches the chest ~15 deg, got ${dTorso.toFixed(1)}`);
      ok(maxStep <= 1.2, `${b.name} crouch=${crouch}: the torso must pitch continuously over lean, max step ${maxStep.toFixed(2)} deg per 0.05`);
      ok(last.q.headFwd - stand.q.headFwd >= 0.03 * b.h, `${b.name}: the head must jut forward with a lean, got ${(last.q.headFwd - stand.q.headFwd).toFixed(3)} m`);
      // the arms hang forward: the hand targets (chest space, units of reach) move forward by the lean
      const pl = Float32Array.from(idlePose(stand.A.B, 0.5, newPose()));
      const ll = body(synth(b, { lean: 1, crouch }), b.h).A.B;
      const pf = Float32Array.from(idlePose(ll, 0.5, newPose()));
      ok(pf[F.hlz] > pl[F.hlz] + 0.05 && pf[F.hrz] > pl[F.hrz] + 0.05, `${b.name}: a full lean must bring both hands forward in chest space (${pl[F.hlz].toFixed(2)} -> ${pf[F.hlz].toFixed(2)})`);
    }
  }
});

test('stance: the feet go apart in proportion (1.4 = the reference sheets), planted, the same knee bend', () => {
  for (const b of BODIES) {
    for (const crouch of [0, 1]) {
      const at = (stance: number) => {
        const { P, A } = body(synth(b, { stance, crouch }), b.h);
        return { s: idle(P, A, 0.5), q: posture(P, A), P };
      };
      const narrow = at(1);
      const sheet = at(1.4);
      const mid = at(1.2);
      const want = sheet.P.shoulderX * 1.15;
      cal(`${b.name} crouch=${crouch}: feet ${narrow.q.footX.toFixed(3)} -> ${sheet.q.footX.toFixed(3)} m at 1.4 (sheet ${want.toFixed(3)}), flex ${mx(narrow.s).toFixed(1)} -> ${mx(sheet.s).toFixed(1)}`);
      ok(Math.abs(sheet.q.footX - want) <= 0.004, `${b.name}: stance 1.4 stands as wide as the sheets: feet at ${sheet.q.footX.toFixed(3)} m, shoulders + 15 % = ${want.toFixed(3)} m`);
      ok(Math.abs(mid.q.footX - (narrow.q.footX + 0.5 * (sheet.q.footX - narrow.q.footX))) <= 0.002, `${b.name}: stance 1.2 is halfway between 1 and 1.4 (${mid.q.footX.toFixed(3)} m)`);
      let prev = narrow;
      for (let st = 1.05; st <= 2.4 + 1e-9; st += 0.05) {
        const cur = at(st);
        sane(cur.s, `${b.name} stance=${st.toFixed(2)} crouch=${crouch}`, crouch);
        ok(cur.q.footX >= prev.q.footX - 1e-6, `${b.name}: a wider stance never brings the feet closer (stance ${st.toFixed(2)})`);
        // the pelvis sinks so each leg keeps its extension; where the limit is what holds the knee, it holds the
        // worst moment of the sway, which a wide stance moves a degree or two (the sway shifts D more the wider the feet)
        ok(Math.abs(mx(cur.s) - mx(narrow.s)) <= 3, `${b.name} stance=${st.toFixed(2)}: the knees keep their bend (${mx(narrow.s).toFixed(1)} -> ${mx(cur.s).toFixed(1)} deg): the pelvis sinks instead`);
        prev = cur;
      }
      // beyond 1.8 only the old tiny hint (0.0012 s per unit of stance) still moves the feet
      ok(Math.abs(at(2.4).q.footX - at(1.8).q.footX) <= 0.002, `${b.name}: the widening stops at stance 1.8`);
      ok(at(0.8).q.footX <= narrow.q.footX + 1e-6, `${b.name}: a stance below 1 never widens`);
    }
  }
});

test('crouched, wide and leaning walks stay planted and never stretch more than the default walk (LOD 0 and 1)', () => {
  const STYLES: Partial<AnimStyle>[] = [{ crouch: 1 }, { crouch: 0.5, stance: 1.4 }, { lean: 1, stance: 1.4 }, { crouch: 1, lean: 1, stance: 1.4 }];
  for (const b of BODIES) {
    for (const lod of [0, 1] as const) {
      for (const speed of [1.5, 3.5, 6.5]) {
        const base = body(synth(b), b.h, lod);
        const ref: Stance[] = [];
        for (let k = 0; k < 40; k++) ref.push(walk(base.P, base.A, k / 40, speed));
        for (const style of STYLES) {
          const { P, A } = body(synth(b, style), b.h, lod);
          const limit = stanceFlexLimit(style.crouch ?? 0) * DEG;
          // a wide stance keeps the hip→ankle distance exactly for a level pelvis; the gait's roll and yaw shift the
          // hips sideways, which changes it by a fraction of a millimetre per cm of foot offset: 0.5 % of the leg
          // (the solver's own stretch budget is 4 %)
          const slack = 0.005 * A.B.legLen;
          let worst = 0;
          for (let k = 0; k < 40; k++) {
            const s = walk(P, A, k / 40, speed);
            const what = `${b.name} LOD${lod} speed ${speed} ${JSON.stringify(style)} phase ${(k / 40).toFixed(3)}`;
            ok(s.stretch <= ref[k].stretch + slack, `${what}: stretched ${(s.stretch * 1000).toFixed(1)} mm, the default walk ${(ref[k].stretch * 1000).toFixed(1)} mm`);
            if (Math.min(...ref[k].lift) < PLANTED) ok(Math.min(...s.lift) < PLANTED, `${what}: a foot must stay planted (lowest ankle ${(Math.min(...s.lift) * 1000).toFixed(1)} mm up)`);
            for (let i = 0; i < 2; i++) {
              if (s.lift[i] >= PLANTED) continue; // swinging
              worst = Math.max(worst, s.flex[i]);
              // the jog's stride bends the planted leg beyond the stance; the walk stays near it
              if (speed <= 1.5) ok(s.flex[i] <= limit + 12, `${what}: planted leg flexion ${s.flex[i].toFixed(1)} deg must stay near the crouch limit ${limit.toFixed(0)}`);
            }
          }
          cal(`${b.name} LOD${lod} speed ${speed} ${JSON.stringify(style)}: planted-leg worst flexion ${worst.toFixed(1)} deg (limit ${limit.toFixed(0)})`);
        }
      }
    }
  }
});

// ── the helper itself ────────────────────────────────────────────────────────
test('stanceDrop keeps a mild style crouch and caps a deep one at the flexion limit', () => {
  for (const kind of ALL_KINDS) {
    const def = resolveKind(kind);
    const { A } = body(def, def.height);
    const B: BodyMetrics = A.B;
    const under: [number, number] = [B.ankleDX, B.ankleDZ];
    ok(stanceDrop(B, -0.001, [under, under]) === -0.001, `${kind}: a 1 mm crouch must pass through unchanged`);
    ok(stanceDrop(B, 0, [under, under]) === 0, `${kind}: no crouch must stay no crouch`);
    const d = stanceDrop(B, -0.9 * B.legLen, [under, under]);
    // the knee then flexes exactly to the limit (law of cosines on the two bones)
    const D = Math.hypot(B.hipY - B.ankleH + d, under[0], under[1]);
    const flex = (Math.PI - Math.acos((B.thighLen ** 2 + B.shinLen ** 2 - D * D) / (2 * B.thighLen * B.shinLen))) * DEG;
    ok(Math.abs(flex - MAX_STANCE_FLEX * DEG) < 1e-6, `${kind}: a huge crouch must be capped at ${(MAX_STANCE_FLEX * DEG).toFixed(1)} deg, got ${flex.toFixed(4)}`);
    // monotone: asking for a deeper crouch never raises the pelvis
    ok(stanceDrop(B, -0.05 * B.legLen, [under, under]) >= stanceDrop(B, -0.1 * B.legLen, [under, under]), `${kind}: stanceDrop must be monotone in the wish`);
    // the limit rises with the crouch style: a deeper squat is allowed and capped exactly at its own limit
    let lastDrop = d;
    for (const c of [0.25, 0.5, 1]) {
      const lim = stanceFlexLimit(c);
      const dc = stanceDrop(B, -0.9 * B.legLen, [under, under], { flex: lim });
      const Dc = Math.hypot(B.hipY - B.ankleH + dc, under[0], under[1]);
      const fc = (Math.PI - Math.acos((B.thighLen ** 2 + B.shinLen ** 2 - Dc * Dc) / (2 * B.thighLen * B.shinLen))) * DEG;
      ok(Math.abs(fc - lim * DEG) < 1e-6, `${kind}: crouch ${c} must cap at ${(lim * DEG).toFixed(1)} deg, got ${fc.toFixed(4)}`);
      ok(dc < lastDrop, `${kind}: a higher crouch must allow a deeper squat (${dc.toFixed(3)} vs ${lastDrop.toFixed(3)})`);
      lastDrop = dc;
    }
    // the rig the animator measured matches the solver's rest bones
    const ps = A.ps;
    ok(Math.abs(ps.restLocal[ps.i('shin_l')].length() - B.thighLen) < 1e-9 && Math.abs(ps.restLocal[ps.i('foot_l')].length() - B.shinLen) < 1e-9, `${kind}: BodyMetrics bone lengths must equal the solver's`);
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) (globalThis as unknown as { process: { exitCode: number } }).process.exitCode = 1;
