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
 *               cap bounds the crouch the walk starts from (the leg carrying the weight),
 *   continuous  flexion varies smoothly with height, build, style and time (no jumps).
 *
 * A reported "idle lifts a foot and bends a knee at heights 1.74-1.76, fine at 1.77" turned out NOT to be this solve
 * (it is height independent: the sweep below pins that) but a hole in the sculpted voxel mesh (kit/mesher.ts).
 */
import * as THREE from 'three';
import { ALL_KINDS, resolveKind } from './registry';
import { computeProportions, buildRig, type Proportions } from './proportions';
import { HumanoidAnimator } from './animator';
import { MAX_STANCE_FLEX, stanceDrop, type BodyMetrics } from './poses';
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
/** the lab's walk (1.5 m/s) at a gait phase in cycles */
function walk(P: Proportions, A: HumanoidAnimator, phase: number): Stance {
  A.reset(0.5, phase);
  A.update(0, { speed: 1.5, grounded: true, moveDir: { x: 0, z: 1 } });
  return measure(P, A);
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

/** assert one stance is planted, unstretched and within the flexion limit */
function sane(s: Stance, what: string) {
  ok(Math.abs(s.lift[0]) <= PLANTED && Math.abs(s.lift[1]) <= PLANTED, `${what}: ankles must stay on the ground, got ${(s.lift[0] * 1000).toFixed(1)} / ${(s.lift[1] * 1000).toFixed(1)} mm`);
  ok(s.stretch <= 1e-6, `${what}: legs must not stretch (gap at the knee), got ${(s.stretch * 1000).toFixed(2)} mm`);
  ok(mx(s) <= FLEX_LIMIT, `${what}: knee flexion ${mx(s).toFixed(1)} deg must be <= ${FLEX_LIMIT.toFixed(1)}`);
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
        sane(s, `${kind} LOD${lod} ${label(kind, def.height, t)}`);
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
    for (const lod of [0, 1] as const) {
      const { P, A } = body(def, def.height, lod);
      let worst = 0;
      for (let k = 0; k < 40; k++) {
        const s = walk(P, A, k / 40);
        for (let i = 0; i < 2; i++) {
          if (s.lift[i] >= PLANTED) continue; // swinging
          worst = Math.max(worst, s.flex[i]);
          ok(s.flex[i] <= WALK_STANCE_LIMIT, `${kind} LOD${lod} walk phase ${(k / 40).toFixed(3)}: planted leg flexion ${s.flex[i].toFixed(1)} deg must be <= ${WALK_STANCE_LIMIT}`);
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
        sane(s, `${c.kind} ${label(c.kind, h, t)}`);
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
      { hunch: U(0, 1), aggression: U(0, 1), stance: U(0.7, 1.6), swagger: U(0, 1), grace: U(0, 1) },
    );
    const h = U(0.9, 5);
    const lod = i % 2 ? 1 : 0;
    const { P, A } = body(def, h, lod);
    for (const t of [0.5, 7.7, 23.1]) sane(idle(P, A, t), `random build #${i} LOD${lod} h=${h.toFixed(2)} ${JSON.stringify(def.build)} ${JSON.stringify(def.anim)} t=${t}`);
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
    // the rig the animator measured matches the solver's rest bones
    const ps = A.ps;
    ok(Math.abs(ps.restLocal[ps.i('shin_l')].length() - B.thighLen) < 1e-9 && Math.abs(ps.restLocal[ps.i('foot_l')].length() - B.shinLen) < 1e-9, `${kind}: BodyMetrics bone lengths must equal the solver's`);
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) (globalThis as unknown as { process: { exitCode: number } }).process.exitCode = 1;
