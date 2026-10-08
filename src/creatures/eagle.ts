/**
 * The Great Eagle (Gwaihir's kin, the Battle of the Morannon). Built with the creature kit:
 *
 *  - ~14.4 m wingspan at scale 1, a 3 m body. Torso, neck, head, legs and tail root are an SDF sculpt
 *    (smooth unions, feather-scale noise, a hooked beak, golden brow-shaded eyes, feathered
 *    "trousers" and scaly yellow tarsi); every flight feather is its own skinned sheet:
 *    10 primaries fanned along the hand, 11 secondaries along the forearm, tertials on the upper arm,
 *    three rows of coverts over the wing root, and a 12-feather tail fan. Each feather has a rachis
 *    (lighter shaft), barring and a pale tip; primaries bend at a dedicated tip bone.
 *  - rig: root, body, hips, tail, neck/neck2/head/jaw, per wing hum -> arm -> hand -> prim, per leg
 *    thigh -> shin -> foot.
 *  - animations (deterministic in t): fly (slow flap), glide, soar (glide banking, see `bank`), dive,
 *    flare (landing, talons forward), grab (swoop with open talons), screech, perch, hit, death.
 *  - `Eagle` (below) is the Combatant: a neutral, untouchable ghost with hit zones. The chapter's
 *    flight controller moves its `object` and calls `pose()`.
 *
 * Usage:
 *   const e = createEagle(seed, scale);   scene.add(e.object);   e.pose('glide', t);
 */
import * as THREE from 'three';
import {
  RigDef, buildCreature, wingFlap, sheetGeometry, surface, type Creature, type V3, type WingSample, type SurfaceSpec,
} from './kit';
import { limbSegment, segmentMatrix } from './kit/geometry';
import { BaseCombatant, ZONE_MULT } from '../actors/combatant';
import { mulberry32 } from '../core/rng';

/** wingspan of the Great Eagle at scale 1 (m) */
export const EAGLE_SPAN = 14.6;

export const EAGLE_ANIMATIONS = ['fly', 'glide', 'soar', 'dive', 'flare', 'grab', 'screech', 'perch', 'hit', 'death'] as const;
export type EagleAnim = (typeof EAGLE_ANIMATIONS)[number];

/** colour schemes: 0 golden-brown (the host), 1 grey-white (the Windlord), 2 dark */
const PALETTES = [
  { body: 0x45331f, body2: 0x2c1f13, head: 0xb99a63, breast: 0x6d5236, flight: 0x2b1f15, tip: 0x8a6e48, cov: 0x56412a, bar: 0x1c130c },
  { body: 0xa9a49a, body2: 0x7b766c, head: 0xe3dccb, breast: 0xcfc8b8, flight: 0x6c675d, tip: 0xe6e0d2, cov: 0xb9b3a6, bar: 0x4a463e },
  { body: 0x2c2218, body2: 0x1a130c, head: 0x7d6444, breast: 0x4a3828, flight: 0x1c140d, tip: 0x5c4630, cov: 0x382a1c, bar: 0x100a06 },
] as const;

interface Joints {
  S: V3;
  E: V3;
  W: V3;
  H: V3;
  P: V3;
}

function joints(s: number): Joints {
  const m = (v: V3): V3 => [v[0] * s, v[1] * s, v[2] * s];
  return { S: m([0.55, 1.72, 0.4]), E: m([1.85, 1.74, -0.3]), W: m([3.45, 1.8, 0.15]), H: m([4.55, 1.78, -0.02]), P: m([5.5, 1.78, -0.12]) };
}

export function eagleRig(s: number) {
  const J = joints(s);
  const r = new RigDef();
  r.bone('root', null, [0, 0, 0]);
  r.bone('body', 'root', [0, 1.5 * s, 0]);
  r.bone('hips', 'body', [0, 1.45 * s, -0.85 * s]);
  r.bone('tail', 'hips', [0, 1.42 * s, -1.5 * s]);
  r.bone('neck', 'body', [0, 1.62 * s, 0.85 * s]);
  r.bone('neck2', 'neck', [0, 1.78 * s, 1.2 * s]);
  r.bone('head', 'neck2', [0, 1.86 * s, 1.45 * s]);
  r.bone('jaw', 'head', [0, 1.8 * s, 1.64 * s]);
  r.pair('hum_l', 'body', J.S);
  r.pair('arm_l', 'hum_l', J.E);
  r.pair('hand_l', 'arm_l', J.W);
  r.pair('prim_l', 'hand_l', J.P);
  r.pair('thigh_l', 'hips', [0.32 * s, 1.25 * s, -0.55 * s]);
  r.pair('shin_l', 'thigh_l', [0.36 * s, 0.8 * s, -0.42 * s]);
  r.pair('foot_l', 'shin_l', [0.4 * s, 0.4 * s, -0.18 * s]);
  return { rig: r, J };
}

const lerp3 = (a: V3, b: V3, t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const norm3 = (v: V3): V3 => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};
const cross3 = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const mixHex = (a: number, b: number, t: number): number => new THREE.Color(a).lerp(new THREE.Color(b), t).getHex();
const mulHex = (a: number, k: number): number => new THREE.Color(a).multiplyScalar(k).getHex();

interface FeatherO {
  root: V3;
  dir: V3;
  up: V3;
  len: number;
  wid: number;
  droop: number;
  /** bone indices: base, tip */
  bones: [number, number];
  /** weight of the tip bone at u = 0 and u = 1 */
  tipBlend: [number, number];
  col: number;
  colTip: number;
  seed: number;
  surf: SurfaceSpec;
}

/** one feather as a skinned sheet: pointed oval, shaft, barring, pale tip, a little droop */
function featherSheet(o: FeatherO) {
  const N = 9;
  const M = 5;
  const lat = norm3(cross3(o.dir, o.up));
  const dir = norm3(o.dir);
  const grid: V3[][] = [];
  const prof = (u: number) => (u < 0.12 ? 0.5 + (0.5 * u) / 0.12 : u < 0.8 ? 1 - 0.1 * (u - 0.12) : 0.93 * Math.sqrt(Math.max(0, 1 - Math.pow((u - 0.8) / 0.2, 2.2))));
  for (let j = 0; j < M; j++) {
    const v = j / (M - 1);
    const row: V3[] = [];
    for (let k = 0; k < N; k++) {
      const u = k / (N - 1);
      const hw = o.wid * 0.5 * prof(u);
      const c: V3 = [o.root[0] + dir[0] * o.len * u + o.up[0] * o.droop * o.len * u * u, o.root[1] + dir[1] * o.len * u + o.up[1] * o.droop * o.len * u * u, o.root[2] + dir[2] * o.len * u + o.up[2] * o.droop * o.len * u * u];
      const across = (v - 0.5) * 2;
      // a shallow vane curve: the edges sit a touch below the shaft
      const sag = Math.abs(across) * 0.012 * o.len * Math.min(1, u * 3);
      row.push([c[0] + lat[0] * across * hw - o.up[0] * sag, c[1] + lat[1] * across * hw - o.up[1] * sag, c[2] + lat[2] * across * hw - o.up[2] * sag]);
    }
    grid.push(row);
  }
  const rnd = mulberry32(o.seed);
  const shade = 0.88 + rnd() * 0.24;
  const barPhase = rnd() * 6;
  return sheetGeometry({
    grid: grid.map((row) => row.slice()).map((row) => row),
    color: o.col,
    // rows run across the vane (v), columns along the feather (u): sheetGeometry passes (col/(cols-1), row/(rows-1))
    colorAt: (u, v) => {
      const across = Math.abs(v - 0.5) * 2;
      const shaft = across < 0.12 ? 1.35 : 1;
      const bar = 0.9 + 0.1 * Math.sin(u * 34 + barPhase + across * 3);
      const edge = 1 - 0.12 * across * across;
      const base = new THREE.Color(o.col).lerp(new THREE.Color(o.colTip), Math.pow(THREE.MathUtils.smoothstep(u, 0.66, 1), 1.2));
      return base.multiplyScalar(shade * shaft * bar * edge).getHex();
    },
    mat: o.surf,
    ao: (u) => 0.55 + 0.45 * THREE.MathUtils.smoothstep(u, 0, 0.4),
    weights: (_r, c, _p, out) => {
      const u = c / (N - 1);
      const wt = o.tipBlend[0] + (o.tipBlend[1] - o.tipBlend[0]) * Math.pow(u, 1.4);
      out.push([o.bones[0], 1 - wt]);
      if (wt > 0.001) out.push([o.bones[1], wt]);
    },
  });
}

/** an eagle's colour set for a seed */
function paletteFor(seed: number) {
  return PALETTES[seed % 3 === 1 ? 1 : seed % 3 === 2 ? 2 : 0];
}

export interface EagleBird {
  creature: Creature;
  object: THREE.Group;
  readonly animations: string[];
  /** wingspan in metres */
  readonly span: number;
  /** -1..1 roll into a turn: lowers the inside wing in 'soar' and 'glide' */
  bank: number;
  pose(anim: string, t: number): void;
  /** world point between the talons */
  talonPoint(out: THREE.Vector3): THREE.Vector3;
  setCastShadow(v: boolean): void;
  dispose(): void;
}

/** one Great Eagle. `scale` 1 ≈ 14.6 m wingspan. Geometry is shared per (seed, scale). */
export function createEagle(seed = 0, scale = 1): EagleBird {
  const s = scale;
  const { rig, J } = eagleRig(s);
  const P = (n: string, dx = 0, dy = 0, dz = 0): V3 => rig.at(n, dx * s, dy * s, dz * s);
  const pal = paletteFor(seed);
  const bi = (n: string) => rig.boneIndex(n);
  const featherSurf = surface('fur', { rough: 0.62, sheen: 0.55, skin: 0, pat: { fur: 0.55 } });
  const downSurf = surface('fur', { rough: 0.86, sheen: 0.6, skin: 0.1, pat: { fur: 0.9 } });
  const c = buildCreature({
    key: `great_eagle_${scale}_${seed % 3}`,
    seed: seed % 3,
    rig,
    sculpt: (sc) => {
      // ── body, neck and head under their plumage ──
      sc.with({ mat: downSurf, color: pal.body, color2: pal.body2, colorNoise: 0.55, colorFreq: 7 / s, noise: { amp: 0.014 * s, freq: 24 / s, type: 'cells' } }, () => {
        sc.ellipsoid(P('body', 0, 0, 0.0), [0.54 * s, 0.5 * s, 0.98 * s], { bone: 'body', bone2: 'hips', blend: [0.45, 1], blendAxis: [P('body'), P('hips')], k: 0.14 * s });
        sc.ellipsoid(P('body', 0, 0.06, 0.5), [0.52 * s, 0.5 * s, 0.5 * s], { bone: 'body', k: 0.12 * s });
        sc.ellipsoid(P('body', 0, -0.22, 0.34), [0.36 * s, 0.34 * s, 0.56 * s], { bone: 'body', k: 0.12 * s, color: pal.breast });
        sc.ellipsoid(P('hips', 0, -0.02, -0.15), [0.36 * s, 0.32 * s, 0.5 * s], { bone: 'hips', k: 0.1 * s });
        // shoulders where the wings join
        sc.mirrored(() => sc.ellipsoid(P('hum_l', -0.1, 0, -0.05), [0.28 * s, 0.26 * s, 0.34 * s], { bone: 'hum_l', k: 0.1 * s }));
        // the neck: thick, ruffled at its base
        sc.cone(P('neck', 0, -0.05, -0.08), P('neck2', 0, 0, 0), 0.34 * s, 0.26 * s, { bone: 'neck', bone2: 'neck2', blend: [0.4, 1], k: 0.1 * s });
        sc.cone(P('neck2', 0, 0, 0), P('head', 0, -0.02, -0.08), 0.26 * s, 0.2 * s, { bone: 'neck2', bone2: 'head', blend: [0.5, 1], k: 0.08 * s });
        sc.ellipsoid(P('neck', 0, -0.03, 0.02), [0.4 * s, 0.34 * s, 0.34 * s], { bone: 'neck', k: 0.1 * s, color: mixHex(pal.body, pal.head, 0.5) });
        // thighs: feathered "trousers"
        sc.mirrored(() => {
          sc.ellipsoid(P('thigh_l', 0.0, -0.2, 0.02), [0.22 * s, 0.4 * s, 0.26 * s], { bone: 'thigh_l', bone2: 'shin_l', blend: [0.2, 0.9], blendAxis: [P('thigh_l'), P('shin_l')], k: 0.1 * s, color: pal.breast });
        });
      });
      // ── head: golden nape, hooked beak, brow and eyes ──
      sc.with({ mat: downSurf, color: pal.head, color2: mixHex(pal.head, pal.body, 0.4), colorNoise: 0.4, colorFreq: 10 / s, noise: { amp: 0.006 * s, freq: 40 / s, type: 'cells' } }, () => {
        sc.ellipsoid(P('head', 0, 0.02, -0.02), [0.2 * s, 0.19 * s, 0.28 * s], { bone: 'head', k: 0.06 * s });
        // heavy brow ridges over the eyes: the stern, forward-glaring look
        sc.mirrored(() => sc.ellipsoid(P('head', 0.11, 0.1, 0.1), [0.085 * s, 0.045 * s, 0.14 * s], { bone: 'head', k: 0.04 * s, rot: [0, 0, 0.35] }));
        // cheek feathering
        sc.mirrored(() => sc.ellipsoid(P('head', 0.12, -0.04, 0.0), [0.08 * s, 0.1 * s, 0.14 * s], { bone: 'head', k: 0.05 * s }));
        // eye sockets
        sc.mirrored(() => sc.sphere(P('head', 0.13, 0.06, 0.15), 0.06 * s, { bone: 'head', op: 'subtract', k: 0.02 * s }));
      });
      // the beak: a stout cone with a long hooked tip, cere at its base, a smaller lower mandible
      const beak = surface('horn', { rough: 0.38, pat: { wrinkles: 0.4, scratches: 0.15 } });
      sc.tube([P('head', 0, -0.01, 0.2), P('head', 0, -0.03, 0.36), P('head', 0, -0.07, 0.46), P('head', 0, -0.15, 0.5)], [0.1 * s, 0.085 * s, 0.058 * s, 0.014 * s], { bone: 'head', mat: beak, color: 0xcaa24a, k: 0.04 * s });
      sc.tube([P('head', 0, -0.03, 0.18), P('head', 0, -0.07, 0.34), P('head', 0, -0.1, 0.43)], [0.07 * s, 0.05 * s, 0.015 * s], { bone: 'jaw', mat: beak, color: 0xb89240, k: 0.03 * s });
      // dark tip and cutting edge on the hook
      sc.sphere(P('head', 0, -0.13, 0.5), 0.045 * s, { bone: 'head', op: 'paint', color: 0x2c2218, mat: beak, k: 0.03 * s });
      // cere (yellow skin) and nostrils
      sc.ellipsoid(P('head', 0, 0.0, 0.2), [0.095 * s, 0.07 * s, 0.07 * s], { bone: 'head', op: 'paint', color: 0xe0b83a, mat: surface('skin', { rough: 0.45 }), k: 0.03 * s });
      sc.mirrored(() => sc.sphere(P('head', 0.035, 0.012, 0.27), 0.012 * s, { bone: 'head', op: 'subtract', k: 0.006 * s }));
      // mouth line
      sc.ellipsoid(P('head', 0, -0.06, 0.34), [0.065 * s, 0.006 * s, 0.14 * s], { bone: 'head', op: 'subtract', k: 0.006 * s });
      // eyes: gold iris, black pupil, a glossy rim
      sc.mirrored(() => {
        sc.sphere(P('head', 0.12, 0.06, 0.15), 0.05 * s, { bone: 'head', mat: surface('eye', { rough: 0.06 }), color: 0xe4a41c, k: 0.006 * s });
        sc.sphere(P('head', 0.158, 0.064, 0.165), 0.022 * s, { bone: 'head', mat: surface('eye', { rough: 0.04 }), color: 0x050403, k: 0.004 * s });
      });
      // legs: bare scaly tarsi, big feet
      const scaly = surface('scales', { rough: 0.5, pat: { scales: 1.6 } });
      sc.with({ mat: scaly, color: 0xc4a238 }, () => {
        sc.mirrored(() => {
          sc.cone(P('shin_l', 0, 0.02, 0), P('foot_l', 0, 0.02, 0), 0.09 * s, 0.065 * s, { bone: 'shin_l', bone2: 'foot_l', blend: [0.5, 1], k: 0.04 * s });
          sc.ellipsoid(P('foot_l', 0, -0.03, 0.04), [0.1 * s, 0.07 * s, 0.14 * s], { bone: 'foot_l', k: 0.04 * s });
        });
      });
    },
    mesh: {
      res: 0.056 * s,
      regions: [{ min: P('head', -0.3, -0.3, -0.3), max: P('head', 0.3, 0.3, 0.62), res: 0.014 * s, aoScale: 0.45 }],
      ao: { dist: 0.12 * s },
    },
    skinK: 0.09 * s,
    material: { detailScale: 1.3 * s, wrap: 0.35, scatterColor: 0x80503a },
    extra: (ctx) => {
      const rnd = mulberry32(900 + seed);
      const idx = (n: string) => bi(n);
      let fid = 1;
      const feather = (o: Omit<FeatherO, 'seed' | 'surf'>) => ctx.add(featherSheet({ ...o, seed: seed * 977 + fid++, surf: featherSurf }));
      const dirXZ = (angleBack: number, outward = 1): V3 => [outward * Math.cos(angleBack), 0, -Math.sin(angleBack)];
      for (const side of ['l', 'r'] as const) {
        const sx = side === 'l' ? 1 : -1;
        const m = (p: V3): V3 => [p[0] * sx, p[1], p[2]];
        const md = (d: V3): V3 => [d[0] * sx, d[1], d[2]];
        const UP: V3 = [0, 1, 0];
        const bHum = idx(`hum_${side}`);
        const bArm = idx(`arm_${side}`);
        const bHand = idx(`hand_${side}`);
        const bPrim = idx(`prim_${side}`);
        // bare arm bones under the coverts: muscular, feathered
        const arm = (a: V3, b: V3, bone: string, r0: number, r1: number) =>
          ctx.gear(limbSegment(r0 * s, r1 * s, 1, 0.15, 8, 5), { bone: `${bone}_${side}`, color: pal.cov, mat: downSurf, matrix: segmentMatrix(m(a), m(b)) });
        arm(J.S, J.E, 'hum', 0.24, 0.19);
        arm(J.E, J.W, 'arm', 0.19, 0.13);
        arm(J.W, J.H, 'hand', 0.13, 0.08);
        // ── primaries: 10 along the hand, fanned, longest toward the tip ──
        for (let i = 0; i < 10; i++) {
          const u = i / 9;
          const root = lerp3(J.W, J.H, u);
          const back = THREE.MathUtils.lerp(0.74, 0.1, Math.pow(u, 0.8));
          const len = (2.05 + 1.4 * Math.sin(Math.min(1, u * 1.15) * Math.PI * 0.5) - (i === 9 ? 0.5 : 0)) * s;
          feather({
            root: m([root[0], root[1] - 0.03 * s, root[2]]),
            dir: md(dirXZ(back)),
            up: UP,
            len,
            wid: (0.3 - 0.06 * u) * s,
            droop: 0.03,
            bones: [bHand, bPrim],
            tipBlend: [0.0, 0.8],
            col: mulHex(pal.flight, 0.9 + rnd() * 0.25),
            colTip: i < 8 ? pal.tip : pal.flight,
          });
        }
        // ── secondaries: 11 along the forearm, trailing ──
        for (let i = 0; i < 11; i++) {
          const u = i / 10;
          const root = lerp3(J.E, J.W, u);
          const back = 1.28 - 0.5 * u - 0.04 * Math.sin(u * 6);
          const len = (2.1 - 0.35 * u + 0.1 * Math.sin(u * 5)) * s;
          feather({
            root: m([root[0], root[1] - 0.04 * s, root[2] - 0.05 * s]),
            dir: md(dirXZ(back)),
            up: UP,
            len,
            wid: 0.36 * s,
            droop: 0.05,
            bones: [bArm, bHand],
            tipBlend: [0, 0.12 * u],
            col: mulHex(pal.flight, 0.95 + rnd() * 0.2),
            colTip: pal.tip,
          });
        }
        // ── tertials on the upper arm ──
        for (let i = 0; i < 4; i++) {
          const u = (i + 0.5) / 4;
          const root = lerp3(J.S, J.E, u);
          feather({
            root: m([root[0], root[1] - 0.03 * s, root[2] - 0.05 * s]),
            dir: md(dirXZ(1.35 + rnd() * 0.15)),
            up: UP,
            len: (1.55 - 0.2 * u) * s,
            wid: 0.34 * s,
            droop: 0.06,
            bones: [bHum, bArm],
            tipBlend: [0, 0.05],
            col: mulHex(pal.flight, 1.05),
            colTip: pal.tip,
          });
        }
        // ── coverts: three overlapping rows over the wing, lighter than the flight feathers ──
        const rows: { n: number; len: number; wid: number; lift: number; from: number; to: number }[] = [
          { n: 15, len: 1.1, wid: 0.28, lift: 0.045, from: 0.04, to: 0.98 },
          { n: 14, len: 0.78, wid: 0.26, lift: 0.075, from: 0.05, to: 0.97 },
          { n: 11, len: 0.52, wid: 0.24, lift: 0.1, from: 0.06, to: 0.94 },
        ];
        rows.forEach((rw, ri) => {
          for (let i = 0; i < rw.n; i++) {
            const u = rw.from + ((rw.to - rw.from) * i) / (rw.n - 1);
            // along S -> E -> W -> H (arc-length-ish: 0..0.34 upper arm, 0.34..0.7 forearm, 0.7..1 hand)
            let root: V3;
            let bones: [number, number];
            let tip: [number, number];
            let back: number;
            if (u < 0.34) {
              root = lerp3(J.S, J.E, u / 0.34);
              bones = [bHum, bArm];
              tip = [0, 0.05];
              back = 1.3;
            } else if (u < 0.7) {
              root = lerp3(J.E, J.W, (u - 0.34) / 0.36);
              bones = [bArm, bHand];
              tip = [0, 0.1];
              back = 1.2 - 0.5 * ((u - 0.34) / 0.36);
            } else {
              root = lerp3(J.W, J.H, (u - 0.7) / 0.3);
              bones = [bHand, bPrim];
              tip = [0, 0.45];
              back = 0.62 - 0.5 * ((u - 0.7) / 0.3);
            }
            // rows sit forward of the quills they cover
            const fwd = 0.1 + ri * 0.2;
            const dirv = dirXZ(Math.max(0.08, back));
            feather({
              root: m([root[0] + dirv[0] * 0.0, root[1] + rw.lift * s, root[2] + fwd * s * 0.5]),
              dir: md(dirv),
              up: UP,
              len: rw.len * s * (u > 0.7 ? 1.2 : 1),
              wid: rw.wid * s,
              droop: 0.08,
              bones,
              tipBlend: tip,
              col: mixHex(pal.cov, pal.body, 0.35 + rnd() * 0.3),
              colTip: mixHex(pal.cov, pal.tip, 0.55),
            });
          }
        });
        // ── leg detail: talons ──
        const foot = rig.at(`foot_${side}`);
        const toe = surface('scales', { rough: 0.5, pat: { scales: 1.4 } });
        const talon = surface('horn', { rough: 0.3, pat: { wrinkles: 0.3 } });
        for (let k = 0; k < 4; k++) {
          const a = k === 3 ? Math.PI : (k - 1) * 0.42;
          const base: V3 = [foot[0] + Math.sin(a) * 0.02 * s, foot[1] - 0.06 * s, foot[2] + 0.1 * s * (k === 3 ? -0.2 : 1)];
          const mid: V3 = [base[0] + Math.sin(a) * 0.06 * s * (k === 3 ? 0 : 1), base[1] - 0.04 * s, base[2] + (k === 3 ? -0.14 : 0.22) * s];
          const tipP: V3 = [mid[0] + Math.sin(a) * 0.02 * s, mid[1] - 0.12 * s, mid[2] + (k === 3 ? -0.03 : 0.05) * s];
          ctx.gear(limbSegment(0.035 * s, 0.024 * s, 1, 0.2, 6, 3), { bone: `foot_${side}`, color: 0xc4a238, mat: toe, matrix: segmentMatrix(base, mid) });
          ctx.gear(new THREE.ConeGeometry(0.022 * s * (k === 3 ? 1.3 : 1), 1, 6), { bone: `foot_${side}`, color: 0x1c1610, mat: talon, matrix: segmentMatrix(mid, tipP).multiply(new THREE.Matrix4().makeTranslation(0, 0.5, 0)) });
        }
      }
      // ── tail: a 12-feather fan ──
      const bTail = idx('tail');
      const tailRoot = rig.at('tail');
      for (let i = 0; i < 12; i++) {
        const a = ((i - 5.5) / 5.5) * 0.46;
        feather({
          root: [tailRoot[0] + Math.sin(a) * 0.14 * s, tailRoot[1] - 0.02 * s + (i % 2) * 0.012 * s, tailRoot[2] + 0.1 * s],
          dir: [Math.sin(a), 0, -Math.cos(a)],
          up: [0, 1, 0],
          len: (2.0 - Math.abs(i - 5.5) * 0.05) * s,
          wid: 0.32 * s,
          droop: 0.04,
          bones: [bTail, bTail],
          tipBlend: [0, 0],
          col: mulHex(pal.flight, 0.9 + rnd() * 0.25),
          colTip: pal.tip,
        });
      }
    },
    bounds: 8.6 * s,
  });

  const ps = c.pose;
  const I = (n: string) => ps.i(n);
  const ws: WingSample = wingFlap(0);
  const Y = new THREE.Vector3(0, 1, 0);
  const Z = new THREE.Vector3(0, 0, 1);
  const q = new THREE.Quaternion();
  const q2 = new THREE.Quaternion();
  const footL = c.rig.byName.foot_l;
  const footR = c.rig.byName.foot_r;
  const _a = new THREE.Vector3();
  const _b = new THREE.Vector3();

  const bird: EagleBird = {
    creature: c,
    object: c.root,
    animations: [...EAGLE_ANIMATIONS],
    span: EAGLE_SPAN * scale,
    bank: 0,
    pose(anim: string, t: number) {
      ps.reset();
      // wing parameters: elevation (+ up), sweep back, elbow fold, wrist fold, primary flex
      let amp = 1;
      let phase = t * 0.62;
      let elev = 0;
      let sweep = 0;
      let elbow = 0;
      let wrist = 0;
      let flex = 0;
      let bodyPitch = -0.06;
      let bodyRoll = 0;
      let neckUp = 0.05;
      let headPitch = 0.1;
      let jaw = 0.03;
      let legPitch = 1.0;
      let legCurl = 0.7;
      let tailPitch = 0.1;
      let fold = 0;
      let flap = true;
      const bank = bird.bank;
      switch (anim) {
        case 'glide':
        case 'soar':
          flap = false;
          elev = 0.16 + (anim === 'soar' ? 0.04 : 0);
          sweep = 0.2;
          elbow = 0.1;
          wrist = 0.04;
          flex = 0.2 + 0.05 * Math.sin(t * 0.7);
          bodyRoll = Math.sin(t * 0.35) * 0.04;
          tailPitch = 0.05;
          break;
        case 'dive':
          flap = false;
          elev = -0.1;
          sweep = 0.95;
          elbow = 1.0;
          wrist = 0.9;
          flex = 0.1;
          bodyPitch = 0.75;
          neckUp = -0.1;
          headPitch = -0.55;
          legPitch = 0.4;
          legCurl = 0.3;
          tailPitch = -0.15;
          jaw = 0.12;
          break;
        case 'flare':
          // landing: wings thrown up and forward, body upright, talons reaching for the ground
          phase = 0.02 + Math.sin(t * 2.4) * 0.03;
          amp = 0.7;
          flap = true;
          bodyPitch = -0.7;
          neckUp = 0.18;
          headPitch = 0.45;
          legPitch = -0.55;
          legCurl = -0.25;
          tailPitch = 0.35;
          jaw = 0.1;
          break;
        case 'grab':
          // the swoop: wings back and half closed, talons open and forward
          flap = false;
          elev = -0.05;
          sweep = 0.55;
          elbow = 0.6;
          wrist = 0.5;
          flex = 0.1;
          bodyPitch = 0.35;
          neckUp = 0.0;
          headPitch = -0.45;
          legPitch = -0.95;
          legCurl = -0.35;
          tailPitch = 0.2;
          jaw = 0.18;
          break;
        case 'screech':
          phase = t * 0.55;
          neckUp = 0.35;
          headPitch = 0.45;
          jaw = 0.55 + Math.sin(t * 28) * 0.05;
          break;
        case 'perch':
          flap = false;
          fold = 1;
          bodyPitch = -0.78;
          neckUp = 0.45;
          headPitch = 0.3;
          legPitch = -0.1;
          legCurl = -0.1;
          tailPitch = 0.55;
          break;
        case 'hit':
          phase = 0.3 + Math.sin(t * 9) * 0.05;
          amp = 0.7;
          bodyRoll = Math.sin(t * 8) * 0.3;
          headPitch = -0.3;
          jaw = 0.4;
          break;
        case 'death': {
          const k = Math.min(1, t / 0.9);
          amp = 0.35 * (1 - k);
          phase = t * 1.6;
          fold = 0.35 + 0.55 * k;
          bodyRoll = t * 2.6;
          bodyPitch = 0.5 * k;
          headPitch = 0.4 * k;
          jaw = 0.4;
          legPitch = 0.3;
          flap = true;
          break;
        }
        default:
          break; // 'fly'
      }
      if (flap) {
        wingFlap(phase, amp, ws);
        elev = ws.shoulder * 0.95;
        sweep = ws.sweep * 1.2;
        elbow = ws.elbowFold * 0.9;
        wrist = ws.wristFold * 0.75;
        flex = 0.1 + Math.max(0, ws.shoulder) * 0.25 - Math.min(0, ws.shoulder) * 0.55;
        // heavy: the body rides up on the downstroke
        ps.offset[I('body')].set(0, -ws.bob * 8 * s, 0);
        bodyPitch += Math.sin(phase * Math.PI * 2) * 0.05 * amp;
        tailPitch += Math.sin(phase * Math.PI * 2 + 0.8) * 0.12 * amp;
      }
      ps.euler(I('body'), bodyPitch, 0, bodyRoll);
      ps.euler(I('neck'), neckUp, 0, 0);
      ps.euler(I('neck2'), neckUp * 0.4, 0, 0);
      ps.euler(I('head'), headPitch - neckUp * 1.2, Math.sin(t * 0.8) * 0.12, 0);
      ps.euler(I('jaw'), jaw, 0, 0);
      ps.euler(I('tail'), tailPitch, Math.sin(t * 0.6) * 0.05, 0);
      for (const side of ['l', 'r'] as const) {
        const sx = side === 'l' ? 1 : -1;
        // banking: the inside wing drops and sweeps, the outside one rises
        const bankElev = -sx * bank * 0.3;
        const e = (elev + bankElev) * (1 - fold) - fold * 1.15;
        q.setFromAxisAngle(Z, sx * e);
        q2.setFromAxisAngle(Y, sx * (sweep + fold * 0.55 + (bank * sx > 0 ? 0.08 : 0)));
        ps.local[I(`hum_${side}`)].copy(q2).multiply(q);
        ps.local[I(`arm_${side}`)].setFromAxisAngle(Y, sx * (elbow + fold * 2.3));
        ps.local[I(`hand_${side}`)].setFromAxisAngle(Y, -sx * (wrist + fold * 2.6));
        ps.local[I(`prim_${side}`)].setFromAxisAngle(Z, sx * flex * 0.55);
        ps.euler(I(`thigh_${side}`), legPitch, 0, sx * 0.08);
        ps.euler(I(`shin_${side}`), -legCurl * 0.8, 0, 0);
        ps.euler(I(`foot_${side}`), legCurl * 0.9, 0, 0);
      }
      c.update(1 / 60);
    },
    talonPoint(out) {
      footL.getWorldPosition(_a);
      footR.getWorldPosition(_b);
      return out.copy(_a).add(_b).multiplyScalar(0.5);
    },
    setCastShadow(v) {
      c.body.castShadow = v;
    },
    dispose() {
      c.dispose();
    },
  };
  bird.pose('fly', 0);
  return bird;
}

// ─────────────────────────────────────────────────────────────────────────────
// the Combatant
// ─────────────────────────────────────────────────────────────────────────────

/** add hit zones to a Great Eagle (body, neck, head, wings, tail) */
export function addEagleZones(c: BaseCombatant, bird: EagleBird, s: number): void {
  const b = bird.creature.rig.byName;
  c.addZoneSphere(b.body, 0.62 * s, 'body', ZONE_MULT.body, new THREE.Vector3(0, 0, 0.1 * s));
  c.addZoneSphere(b.hips, 0.42 * s, 'body');
  c.addZoneCapsule(b.neck, b.head, 0.26 * s, 'body');
  c.addZoneSphere(b.head, 0.26 * s, 'head', ZONE_MULT.head, new THREE.Vector3(0, 0.02 * s, 0.1 * s));
  for (const side of ['l', 'r'] as const) {
    c.addZoneCapsule(b[`hum_${side}`], b[`arm_${side}`], 0.26 * s, 'limb');
    c.addZoneCapsule(b[`arm_${side}`], b[`hand_${side}`], 0.34 * s, 'limb');
    c.addZoneCapsule(b[`hand_${side}`], b[`prim_${side}`], 0.5 * s, 'limb');
  }
}

/**
 * A Great Eagle as a Combatant. Neutral (the AI never targets it), invulnerable and ghostly to
 * arrows, but a full BaseCombatant with zones so it can be queried, and so the registry updates and
 * disposes it. Its flight is scripted from outside: set `object.position` / `rotation`, set `bank`,
 * and call `setPose(anim)`; `update()` advances the animation clock and re-poses.
 */
export class Eagle extends BaseCombatant {
  readonly bird: EagleBird;
  anim: EagleAnim = 'glide';
  clock: number;
  /** animation speed multiplier */
  rate = 1;

  constructor(seed = 0, scale = 1) {
    super({ team: 'neutral', name: 'Great Eagle', maxHp: 1e6, radius: 3 * scale, height: 4 * scale, bloodKind: 'red' });
    this.bird = createEagle(seed, scale);
    // the combatant's origin is the middle of the body, so pitch and roll turn about the centre of mass
    this.bird.object.position.y = -1.5 * scale;
    this.object.add(this.bird.object);
    addEagleZones(this, this.bird, scale);
    this.aimBone = this.bird.creature.rig.byName.body;
    this.targetable = false;
    this.countsForRivalry = false;
    this.clock = (seed * 1.37) % 5;
    this.corpseTime = -1;
    this.object.name = 'ally:great_eagle';
    this.bird.pose(this.anim, this.clock);
  }

  protected filterDamage(): number {
    return 0;
  }

  /** arrows pass through an eagle */
  raycast(): null {
    return null;
  }

  setPose(anim: EagleAnim): void {
    this.anim = anim;
  }

  update(dt: number): void {
    if (dt <= 0) return;
    this.clock += dt * this.rate;
    this.bird.pose(this.anim, this.clock);
    this.afterAnimate();
  }

  dispose(): void {
    this.bird.setCastShadow(false);
    super.dispose();
  }
}
