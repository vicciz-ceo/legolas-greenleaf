/**
 * The Mûmak (oliphaunt) of Harad — Chapter 8, Pelennor Fields. Built with the creature kit.
 *
 *  - ~14 m at the shoulder, ~24 m long with the trunk, wrinkled grey-brown hide, two pairs of tusks
 *    (great upper tusks sweeping forward and up, a lower pair below), a long trunk on a spring
 *    chain, small fanning ears, a tufted tail.
 *  - War dress: red ochre and white war paint (forehead, eyes, trunk, shoulders), a red and gold
 *    caparison over the back, four girth straps (separate bones, so a cut strap can drop away)
 *    and a wooden war HOWDAH tower (`buildHowdah`) lashed on with ropes, with red and gold banners.
 *  - `createMumak({ lod })`: 'hero' (≈60–70 k tris, head + trunk at a finer resolution) or 'far'
 *    (≈10 k tris) for the distant herds. `premeshMumak(lod)` meshes it in the kit worker pool so
 *    the loading screen pays for it.
 *  - `MumakAnimator`: heavy lateral-sequence walk (kit quadGait, 2-bone IK per leg with ground
 *    offsets), body sway, head nod, ear fanning, tail swish, trunk springs; actions sweep (trunk),
 *    gore (tusks), stomp (rear and slam), trumpet, thrash (shaking the head), and a two-stage
 *    collapse (kneel forward with the trunk on the ground, then roll onto its side).
 *    `stepped[i]` flags the footfalls of a frame (sound, shake, dust, trample).
 *
 * Model space: metres, feet at y = 0, facing +Z, the creature's left at +X.
 */
import * as THREE from 'three';
import { RigDef } from './kit/rig';
import { Sculpt, sdfProbe, type SdfProbe, type V3 } from './kit/sdf';
import { buildCreature, type Creature, type CreatureExtraCtx } from './kit/creature';
import { solveTwoBone, quadGait, SpringChain, type QuadGaitSample } from './kit/anim';
import { surface } from './kit/surfaces';
import { sheetGeometry } from './kit/sheet';
import { paintGeometry } from './kit/geometry';
import { meshSculptAsync, cached } from './kit/cache';
import type { MeshOpts } from './kit/mesher';
import { growStrands, hairGeometry, type GrowRoot } from './kit/hair';
import { mulberry32 } from '../core/rng';
import { clamp, lerp, smoothstep } from '../core/math';
import { banner, mat } from '../world';
import { MeshKit } from '../world/util';
import { limbGeo, xf } from '../world/geom';

// ─────────────────────────────────────────────────────────────────────────────
// Dimensions
// ─────────────────────────────────────────────────────────────────────────────

/** hip height used by the gait (m) */
export const MUMAK_LEG = 11;
/** height at the withers (m) */
export const MUMAK_SHOULDER = 14.3;
/** where the howdah sits on the back (model space) and the bone that carries it */
export const HOWDAH_SEAT: V3 = [0, 14.2, -0.9];
/** girth straps: [bone, z of the strap plane, side] — front pair on the chest, rear pair on the spine */
export const GIRTHS: { bone: string; parent: string; z: number; side: 1 | -1 }[] = [
  { bone: 'girth_fl', parent: 'chest', z: 1.7, side: 1 },
  { bone: 'girth_fr', parent: 'chest', z: 1.7, side: -1 },
  { bone: 'girth_rl', parent: 'spine', z: -3.7, side: 1 },
  { bone: 'girth_rr', parent: 'spine', z: -3.7, side: -1 },
];
/** z of the rope ladder on the left flank (model space) */
export const LADDER_Z = -1.0;

const HIDE = 0x4f4740;
const HIDE2 = 0x36302b;
const IVORY = 0xd8cbb0;
const RED = 0x8a2414;
const PAINT_WHITE = 0xd6cdbb;

export function mumakRig(): RigDef {
  const r = new RigDef();
  r.bone('root', null, [0, 0, 0]);
  r.bone('pelvis', 'root', [0, 12.6, -7.2]);
  r.bone('spine', 'pelvis', [0, 13.4, -2.4]);
  r.bone('chest', 'spine', [0, 13.2, 2.8]);
  r.bone('neck', 'chest', [0, 12.2, 6.4]);
  r.bone('head', 'neck', [0, 11.8, 8.8]);
  r.bone('jaw', 'head', [0, 9.7, 10.0]);
  r.pair('ear_l', 'head', [2.35, 12.4, 8.5]);
  r.bone('trunk1', 'head', [0, 9.5, 11.6]);
  r.bone('trunk2', 'trunk1', [0, 7.7, 12.4]);
  r.bone('trunk3', 'trunk2', [0, 5.8, 12.85]);
  r.bone('trunk4', 'trunk3', [0, 4.0, 13.0]);
  r.bone('trunk5', 'trunk4', [0, 2.5, 13.05]);
  r.bone('trunk6', 'trunk5', [0, 1.4, 13.35]);
  r.bone('tail1', 'pelvis', [0, 12.1, -10.4]);
  r.bone('tail2', 'tail1', [0, 10.3, -11.0]);
  r.bone('tail3', 'tail2', [0, 8.4, -11.2]);
  r.pair('scap_l', 'chest', [2.5, 11.8, 4.2]);
  r.pair('humer_l', 'scap_l', [3.0, 10.0, 4.6]);
  r.pair('radius_l', 'humer_l', [3.1, 6.2, 3.9]);
  r.pair('fpaw_l', 'radius_l', [3.1, 1.3, 4.35]);
  r.pair('femur_l', 'pelvis', [2.8, 10.6, -7.6]);
  r.pair('tibia_l', 'femur_l', [2.95, 5.6, -6.6]);
  r.pair('hpaw_l', 'tibia_l', [3.0, 1.3, -7.3]);
  // girth strap bones at the top of each strap (a cut strap swings down and drops away)
  for (const g of GIRTHS) r.bone(g.bone, g.parent, [g.side * 2.5, 13.9, g.z]);
  return r;
}

const TRUNK_TIP: V3 = [0, 0.75, 13.95];
const TRUNK_R = [1.3, 1.02, 0.82, 0.65, 0.51, 0.4, 0.3];

// ─────────────────────────────────────────────────────────────────────────────
// Sculpt
// ─────────────────────────────────────────────────────────────────────────────

function sculptMumak(sc: Sculpt, r: RigDef): void {
  const hide = surface('hide', { rough: 0.86, pat: { wrinkles: 1.2, leather: 0.6, pores: 0.6 } });
  const nail = surface('nail', { rough: 0.6 });
  const P = (n: string, dx = 0, dy = 0, dz = 0): V3 => r.at(n, dx, dy, dz);
  const lumps = { amp: 0.1, freq: 0.42, type: 'fbm' as const, octaves: 3, seed: 3 };
  // the hide's network of deep creases on the barrel and haunches
  const hideFolds = { amp: 0.075, freq: 0.75, type: 'ridged' as const, octaves: 3, seed: 5 };
  const folds = { amp: 0.06, freq: 1.35, type: 'ridged' as const, octaves: 2, seed: 7 };
  const trunkFolds = { amp: 0.035, freq: 2.6, type: 'ridged' as const, octaves: 2, seed: 11 };

  sc.with({ mat: hide, color: HIDE, color2: HIDE2, colorNoise: 0.55, colorFreq: 0.32, noise: lumps }, () => {
    // ── torso: rump, barrel, chest, withers and back, a sagging belly ──
    sc.ellipsoid([0, 10.5, -6.0], [3.6, 3.6, 4.3], { bone: 'pelvis', k: 1.4, noise: hideFolds });
    sc.ellipsoid([0, 10.0, -1.6], [4.0, 4.0, 4.8], { bone: 'spine', k: 1.6, noise: hideFolds });
    sc.ellipsoid([0, 10.4, 3.0], [3.7, 4.0, 3.9], { bone: 'chest', k: 1.6, noise: hideFolds });
    sc.ellipsoid([0, 12.3, 2.4], [2.5, 2.1, 3.4], { bone: 'chest', k: 1.2 });
    sc.ellipsoid([0, 12.5, -3.4], [2.7, 1.9, 4.6], { bone: 'spine', k: 1.2 });
    sc.ellipsoid([0, 8.3, -1.2], [3.2, 2.3, 4.6], { bone: 'spine', k: 1.4 });
    // shoulder and haunch masses
    sc.mirrored(() => {
      sc.ellipsoid(P('humer_l', -0.4, -0.4, -0.1), [1.6, 3.0, 2.2], { bone: 'humer_l', k: 1.0 });
      sc.ellipsoid(P('femur_l', -0.35, -0.6, 0.3), [1.75, 3.3, 2.6], { bone: 'femur_l', k: 1.1, noise: hideFolds });
    });
    // ── neck ──
    sc.cone([0, 11.2, 4.6], [0, 11.3, 8.2], 3.0, 2.5, { bone: 'neck', bone2: 'head', blend: [0.55, 1], k: 1.2 });
    // ── head: cranium with the twin domes, sloping face, cheeks, tusk sheaths, lower lip ──
    sc.ellipsoid([0, 12.0, 9.3], [2.6, 2.8, 2.5], { bone: 'head', k: 0.9 });
    sc.mirrored(() => sc.sphere([1.0, 13.55, 9.9], 1.35, { bone: 'head', k: 0.8 }));
    sc.cone([0, 11.3, 10.7], [0, 9.5, 11.75], 2.05, 1.32, { bone: 'head', bone2: 'trunk1', blend: [0.75, 1], k: 0.8 });
    sc.mirrored(() => sc.ellipsoid([1.65, 10.25, 10.15], [1.1, 1.5, 1.4], { bone: 'head', k: 0.7 }));
    sc.mirrored(() => sc.ellipsoid([1.2, 9.3, 11.15], [0.7, 0.7, 1.0], { bone: 'head', k: 0.45 }));
    sc.ellipsoid([0, 8.9, 10.7], [0.95, 0.6, 1.0], { bone: 'jaw', k: 0.45 });
    // sunken temples and deep-set eye sockets
    sc.mirrored(() => sc.sphere([2.4, 12.1, 10.2], 0.6, { op: 'subtract', k: 0.65, bone: 'head' }));
    sc.mirrored(() => sc.sphere([2.18, 11.0, 10.5], 0.32, { op: 'subtract', k: 0.16, bone: 'head', noise: null }));
    // heavy skin folds at the base of the ears and the neck
    sc.mirrored(() => {
      for (const dz of [0, 0.7]) sc.torus([0, 11.6, 7.7 - dz], 2.75 - dz * 0.1, 0.11, { op: 'subtract', k: 0.18, bone: 'neck', rot: [Math.PI / 2, 0, 0] });
    });
    // ── trunk: six segments tapering to a fingered tip, ringed with folds ──
    const tk: V3[] = [P('trunk1'), P('trunk2'), P('trunk3'), P('trunk4'), P('trunk5'), P('trunk6'), TRUNK_TIP];
    for (let i = 0; i < 6; i++) {
      sc.cone(tk[i], tk[i + 1], TRUNK_R[i], TRUNK_R[i + 1], {
        bone: `trunk${i + 1}`,
        bone2: i < 5 ? `trunk${i + 2}` : undefined,
        blend: [0.55, 1],
        k: 0.25,
        noise: trunkFolds,
      });
    }
    sc.sphere([0, 0.62, 14.05], 0.3, { bone: 'trunk6', k: 0.12, noise: null });
    sc.mirrored(() => sc.sphere([0.12, 0.42, 14.1], 0.1, { op: 'subtract', k: 0.04, bone: 'trunk6', noise: null }));
    // ── tail ──
    sc.cone(P('tail1'), P('tail2'), 0.55, 0.4, { bone: 'tail1', bone2: 'tail2', blend: [0.6, 1], k: 0.5 });
    sc.cone(P('tail2'), P('tail3'), 0.4, 0.26, { bone: 'tail2', bone2: 'tail3', blend: [0.6, 1], k: 0.2 });
    sc.cone(P('tail3'), [0, 6.7, -11.3], 0.26, 0.13, { bone: 'tail3', k: 0.15 });
    // ── legs: columns with wrinkled skin, round feet with pale toenails ──
    sc.mirrored(() => {
      sc.with({ noise: folds }, () => {
        sc.cone(P('humer_l'), P('radius_l'), 1.5, 1.15, { bone: 'humer_l', bone2: 'radius_l', blend: [0.82, 1], k: 0.7 });
        sc.cone(P('radius_l'), P('fpaw_l'), 1.12, 0.94, { bone: 'radius_l', bone2: 'fpaw_l', blend: [0.86, 1], k: 0.5 });
        sc.cone(P('femur_l'), P('tibia_l'), 1.6, 1.18, { bone: 'femur_l', bone2: 'tibia_l', blend: [0.82, 1], k: 0.7 });
        sc.cone(P('tibia_l'), P('hpaw_l'), 1.1, 0.92, { bone: 'tibia_l', bone2: 'hpaw_l', blend: [0.86, 1], k: 0.5 });
      });
      // the deep horizontal creases of elephant legs
      for (const [top, bot, bone, r0, r1] of [['radius_l', 'fpaw_l', 'radius_l', 1.12, 0.94], ['tibia_l', 'hpaw_l', 'tibia_l', 1.1, 0.92]] as [string, string, string, number, number][]) {
        const a = P(top);
        const b = P(bot);
        for (let k = 0; k < 7; k++) {
          const t = 0.14 + k * 0.115 + Math.sin(k * 7.3) * 0.03;
          sc.torus([lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)], lerp(r0, r1, t) + 0.03, 0.065 + 0.02 * Math.sin(k * 5.1), { op: 'subtract', k: 0.14, bone, rot: [Math.sin(k * 3.1) * 0.16, 0, Math.cos(k * 2.3) * 0.14] });
        }
      }
      for (const [paw, len] of [['fpaw_l', 1.0], ['hpaw_l', 1.12]] as [string, number][]) {
        const f = P(paw);
        sc.group('union', 0.35, () => {
          sc.cone([f[0], f[1] + 0.3, f[2]], [f[0], 0.1, f[2] + 0.12], 0.98, 1.2, { bone: paw, k: 0.3 });
          sc.plane([0, -1, 0], -0.02, { op: 'intersect', k: 0.1 });
        });
        for (const a of [-0.75, -0.25, 0.25, 0.75]) {
          sc.ellipsoid([f[0] + Math.sin(a) * 1.12, 0.3, f[2] + 0.12 + Math.cos(a) * 1.12 * len], [0.25, 0.2, 0.16], {
            bone: paw,
            mat: nail,
            color: 0xb3a68e,
            k: 0.08,
            noise: null,
            rot: [0, a, 0],
          });
        }
      }
    });
  });

  // eyes (small, dark, wet)
  sc.mirrored(() =>
    sc.sphere([2.04, 11.0, 10.55], 0.22, { bone: 'head', mat: surface('eye', { rough: 0.06 }), color: 0x1c120b, k: 0.04 }),
  );

  // ── paint: mud on the lower legs, a sun-bleached dusty back, pink depigmentation on trunk ──
  sc.mirrored(() => {
    sc.cone([3.1, -0.6, 4.4], [3.1, 2.2, 4.2], 1.5, 1.35, { op: 'paint', color: 0x4a3e30, k: 1.8, strength: 0.6, bone: 'fpaw_l', colorNoise: 0.6, color2: 0x3a3028, colorFreq: 1.4 });
    sc.cone([3.0, -0.6, -7.2], [3.0, 2.2, -7.0], 1.5, 1.35, { op: 'paint', color: 0x4a3e30, k: 1.8, strength: 0.6, bone: 'hpaw_l', colorNoise: 0.6, color2: 0x3a3028, colorFreq: 1.4 });
  });
  sc.ellipsoid([0, 14.3, -1.2], [3.2, 1.3, 8.4], { op: 'paint', color: 0x766c60, k: 1.3, strength: 0.5 });
  sc.cone(P('trunk1', 0, 0, 0.2), P('trunk3'), 1.1, 0.8, { op: 'paint', color: 0x93776a, k: 0.35, strength: 0.4, colorNoise: 0.8, colorFreq: 2.2, color2: HIDE });
  // ── war paint: red bands across the brow, a white blaze, red eye rings, trunk rings, shoulder sigils ──
  for (const [y, w] of [[13.6, 2.4], [13.0, 2.5], [12.4, 2.55]] as [number, number][]) {
    sc.ellipsoid([0, y, 10.9], [w, 0.14, 1.7], { op: 'paint', color: RED, k: 0.14, bone: 'head', strength: 0.9, colorNoise: 0.3, color2: 0x5e180c, colorFreq: 3 });
  }
  sc.cone([0, 14.3, 10.2], [0, 9.8, 12.2], 0.2, 0.13, { op: 'paint', color: PAINT_WHITE, k: 0.1, bone: 'head', strength: 0.8 });
  sc.mirrored(() => sc.sphere([2.2, 11.0, 10.48], 0.5, { op: 'paint', color: 0x6a180e, k: 0.12, bone: 'head', strength: 0.85 }));
  for (const [i, t] of [[2, 0.35], [3, 0.4]] as [number, number][]) {
    const a = P(`trunk${i}`);
    const b = P(`trunk${i + 1}`);
    const c: V3 = [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
    sc.torus(c, TRUNK_R[i - 1] * 0.92, 0.2, { op: 'paint', color: RED, k: 0.08, bone: `trunk${i}`, rot: [0.25, 0, 0] });
    sc.torus([c[0], c[1] - 0.5, c[2] + 0.05], TRUNK_R[i - 1] * 0.88, 0.06, { op: 'paint', color: PAINT_WHITE, k: 0.05, bone: `trunk${i}`, rot: [0.25, 0, 0] });
  }
  sc.mirrored(() => {
    for (const dz of [-0.55, 0, 0.55]) sc.ellipsoid([4.0, 9.3 - Math.abs(dz) * 0.4, 4.7 + dz], [0.8, 1.4 - Math.abs(dz) * 0.5, 0.15], { op: 'paint', color: RED, k: 0.12, bone: 'humer_l', strength: 0.85 });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Body probe (places straps, cloth and the ladder exactly on the sculpted hide)
// ─────────────────────────────────────────────────────────────────────────────

const SKIN_K = 0.9;

function bodyProbe(rig: RigDef): SdfProbe {
  return cached('mumak:probe', () => {
    const sc = new Sculpt(rig, { skinK: SKIN_K });
    sculptMumak(sc, rig);
    return sdfProbe(sc.compile(), [-8, -1, -13], [8, 17, 16]);
  });
}

/** surface point of the body along a ray from `c` in direction `d` (outermost crossing), pushed out by `off` */
function surfaceAlong(pr: SdfProbe, c: V3, d: V3, off: number, maxR = 9): [number, number, number] {
  let lo = 0;
  let hi = maxR;
  // the ray starts inside; march out until outside, then bisect
  if (pr.dist(c[0] + d[0] * hi, c[1] + d[1] * hi, c[2] + d[2] * hi) < 0) hi = maxR * 1.5;
  for (let i = 0; i < 32; i++) {
    const m = (lo + hi) / 2;
    if (pr.dist(c[0] + d[0] * m, c[1] + d[1] * m, c[2] + d[2] * m) < 0) lo = m;
    else hi = m;
  }
  const r = (lo + hi) / 2 + off;
  return [c[0] + d[0] * r, c[1] + d[1] * r, c[2] + d[2] * r];
}

// ─────────────────────────────────────────────────────────────────────────────
// Rigid extras: tusks, ears, caparison, girth straps, tail tuft
// ─────────────────────────────────────────────────────────────────────────────

/** tube along a smooth curve with a radius profile (closed tip), with uvs */
export function taperedTube(points: V3[], radius: (u: number) => number, radial = 12, seg = 28): THREE.BufferGeometry {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(p[0], p[1], p[2])), false, 'centripetal');
  const frames = curve.computeFrenetFrames(seg, false);
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const p = new THREE.Vector3();
  const len = curve.getLength();
  for (let i = 0; i <= seg; i++) {
    const u = i / seg;
    curve.getPointAt(u, p);
    const r = Math.max(0.004, radius(u));
    const N = frames.normals[i];
    const B = frames.binormals[i];
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * Math.PI * 2;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      pos.push(p.x + r * (ca * N.x + sa * B.x), p.y + r * (ca * N.y + sa * B.y), p.z + r * (ca * N.z + sa * B.z));
      uv.push(j / radial, u * len);
    }
  }
  for (let i = 0; i < seg; i++)
    for (let j = 0; j < radial; j++) {
      const a = i * (radial + 1) + j;
      const b = a + radial + 1;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** tusk centre lines (left side; mirrored for the right) */
const TUSKS: { pts: V3[]; r0: number; r1: number; bands: number[] }[] = [
  // great upper tusks: down and out of the sheath, forward, then sweeping up
  { pts: [[1.2, 9.4, 11.25], [1.7, 7.95, 13.0], [2.3, 6.9, 15.3], [2.7, 7.3, 17.7], [2.6, 8.85, 19.4], [2.25, 10.25, 20.1]], r0: 0.62, r1: 0.1, bands: [0.18, 0.24] },
  // lower pair: shorter, curling forward under the great ones
  { pts: [[0.85, 8.7, 11.1], [1.2, 7.15, 12.05], [1.55, 5.7, 13.6], [1.7, 5.25, 15.3], [1.6, 5.85, 16.6]], r0: 0.42, r1: 0.07, bands: [0.3] },
];

function tuskExtras(ctx: CreatureExtraCtx): void {
  const head = ctx.rig.boneIndex('head');
  const ivory = surface('bone', { rough: 0.42, pat: { scratches: 0.8, wrinkles: 0.2 } });
  const gold = surface('gold', { rough: 0.3 });
  const iron = surface('metal_rusty');
  for (const side of [1, -1]) {
    for (const t of TUSKS) {
      const pts = t.pts.map((p) => [p[0] * side, p[1], p[2]] as V3);
      const prof = (u: number) => lerp(t.r0, t.r1, Math.pow(u, 0.8)) * (u > 0.97 ? (1 - u) / 0.03 : 1) + 0.004;
      const geo = taperedTube(pts, prof, 14, 30);
      // weathered base, clean ivory toward the tip
      const base = new THREE.Vector3(...pts[0]);
      const c0 = new THREE.Color(0x6e604a);
      const c1 = new THREE.Color(IVORY);
      ctx.add(
        paintGeometry(geo, {
          bone: head,
          color: IVORY,
          mat: ivory,
          colorFn: (p, _n, out) => {
            const d = clamp(p.distanceTo(base) / 3.2, 0, 1);
            out.copy(c0).lerp(c1, smoothstep(0.1, 1, d));
          },
          ao: (p) => clamp(0.55 + p.distanceTo(base) * 0.2, 0, 1),
        }),
      );
      geo.dispose();
      // gold and iron bands
      const curve = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p)), false, 'centripetal');
      for (const u of t.bands) {
        const c = curve.getPointAt(u);
        const tan = curve.getTangentAt(u);
        const ring = new THREE.TorusGeometry(prof(u) * 1.02, 0.07, 6, 18);
        const m = new THREE.Matrix4().compose(c, new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), tan), new THREE.Vector3(1, 1, 1.6));
        ctx.gear(ring, { bone: 'head', color: 0xb8902e, mat: gold, matrix: m });
      }
      // iron spike cap on the great tusks
      if (t.r0 > 0.5) {
        const u = 0.86;
        const c = curve.getPointAt(u);
        const tan = curve.getTangentAt(u);
        const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), tan);
        ctx.gear(new THREE.TorusGeometry(prof(u) * 1.05, 0.06, 6, 16), { bone: 'head', color: 0x3a3430, mat: iron, matrix: new THREE.Matrix4().compose(c, q, new THREE.Vector3(1, 1, 2.2)) });
      }
    }
  }
}

function earExtras(ctx: CreatureExtraCtx): void {
  const head = ctx.rig.boneIndex('head');
  const earMat = surface('hide', { rough: 0.8, skin: 0.5, pat: { wrinkles: 1.3, pores: 0.5, leather: 0.3 } });
  for (const [side, bone] of [[1, 'ear_l'], [-1, 'ear_r']] as [number, string][]) {
    const bi = ctx.rig.boneIndex(bone);
    const rows = 9;
    const cols = 9;
    const grid: V3[][] = [];
    for (let rI = 0; rI < rows; rI++) {
      const v = rI / (rows - 1); // root → rim
      const row: V3[] = [];
      for (let cI = 0; cI < cols; cI++) {
        const u = cI / (cols - 1); // top → bottom along the root
        const root: V3 = [2.35 + 0.2 * Math.sin(Math.PI * u), 13.5 - 3.2 * u, 8.6 - 0.3 * u];
        // D-shaped ear: reaches back and down, widest at the middle, a drooping lower lobe
        const reach = 3.2 * Math.sin(Math.PI * (0.12 + 0.8 * u)) + 0.3;
        const rim: V3 = [root[0] + 0.7 + 0.3 * Math.sin(Math.PI * u), root[1] - 1.3 * u - 0.3, root[2] - reach];
        const bulge = Math.sin(Math.PI * v) * 0.25;
        row.push([(root[0] + (rim[0] - root[0]) * v + bulge) * side, root[1] + (rim[1] - root[1]) * v, root[2] + (rim[2] - root[2]) * v]);
      }
      grid.push(row);
    }
    ctx.add(
      sheetGeometry({
        grid,
        color: HIDE,
        colorAt: (_u, v) => (v > 0.82 ? 0x8a6e60 : v > 0.7 ? 0x76675b : HIDE),
        mat: earMat,
        weights: (rI, _c, _p, out) => {
          const v = rI / (rows - 1);
          const w = smoothstep(0.0, 0.3, v);
          out.push([bi, w], [head, 1 - w]);
        },
        ao: (_u, v) => 0.6 + 0.4 * v,
      }),
    );
  }
}

function capeExtras(ctx: CreatureExtraCtx): void {
  const pr = bodyProbe(ctx.rig);
  const pelvis = ctx.rig.boneIndex('pelvis');
  const spine = ctx.rig.boneIndex('spine');
  const chest = ctx.rig.boneIndex('chest');
  const cloth = surface('wool', { rough: 0.88, sheen: 0.9 });
  const zs = [-5.4, 3.4];
  for (const side of [1, -1]) {
    const rows = 8;
    const cols = 14;
    const grid: V3[][] = [];
    for (let rI = 0; rI < rows; rI++) {
      const v = rI / (rows - 1);
      const row: V3[] = [];
      for (let cI = 0; cI < cols; cI++) {
        const u = cI / (cols - 1);
        const z = lerp(zs[0], zs[1], u);
        const th = lerp(0.42, 1.18, v) + 0.04 * Math.sin(u * 9); // angle from the vertical
        const d: V3 = [Math.sin(th) * side, Math.cos(th), 0];
        const p = surfaceAlong(pr, [0, 10.4, z], d, 0.16 + v * v * 0.25);
        // the hem hangs a little lower in scallops
        const hem = v > 0.9 ? -Math.abs(Math.sin(u * Math.PI * 6)) * 0.35 * (v - 0.9) * 10 : 0;
        row.push([p[0], p[1] + hem, p[2]]);
      }
      grid.push(row);
    }
    ctx.add(
      sheetGeometry({
        grid,
        color: 0x7a1a10,
        colorAt: (u, v) => {
          const edge = v > 0.84 || u < 0.05 || u > 0.95;
          if (edge) return v > 0.93 ? 0x5a1008 : 0xb08a34;
          // a row of gold lozenges
          const du = Math.abs(((u * 7) % 1) - 0.5);
          if (Math.abs(v - 0.58) + du * 0.32 < 0.09) return 0xc49a3a;
          return v < 0.12 ? 0x611208 : 0x7a1a10;
        },
        mat: cloth,
        weights: (_r, cI, p, out) => {
          void cI;
          const z = p[2];
          const wc = smoothstep(-0.5, 3.0, z);
          const wp = smoothstep(-2.6, -6.0, z);
          out.push([chest, wc], [pelvis, wp], [spine, Math.max(0, 1 - wc - wp)]);
        },
        ao: (_u, v) => 0.75 + 0.25 * v,
      }),
    );
  }
}

/** a girth strap: a leather band from the howdah base around the flank to under the belly, with a buckle */
function girthGeometry(ctx: CreatureExtraCtx, gi: number): void {
  const g = GIRTHS[gi];
  const pr = bodyProbe(ctx.rig);
  const bone = ctx.rig.boneIndex(g.bone);
  const leather = surface('leather_worn', { rough: 0.72 });
  const pts: THREE.Vector3[] = [];
  const nrm: THREE.Vector3[] = [];
  const n = 26;
  for (let i = 0; i <= n; i++) {
    const th = lerp(0.62, Math.PI * 0.995, i / n);
    const d: V3 = [Math.sin(th) * g.side, Math.cos(th), 0];
    const p = surfaceAlong(pr, [0, 10.3, g.z], d, 0.09);
    pts.push(new THREE.Vector3(...p));
    nrm.push(new THREE.Vector3(...pr.normal(surfaceAlong(pr, [0, 10.3, g.z], d, 0))));
  }
  // ribbon box: width along z, thickness along the normal
  const w = 0.42;
  const tk = 0.07;
  const pos: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= n; i++) {
    const p = pts[i];
    const nn = nrm[i];
    for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      pos.push(p.x + nn.x * tk * b, p.y + nn.y * tk * b, p.z + w * a + nn.z * tk * b);
    }
  }
  for (let i = 0; i < n; i++)
    for (let k = 0; k < 4; k++) {
      const a = i * 4 + k;
      const b = i * 4 + ((k + 1) % 4);
      idx.push(a, a + 4, b, b, a + 4, b + 4);
    }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  ctx.add(paintGeometry(geo, { bone, color: 0x6a4a2c, mat: leather, ao: 0.9 }));
  geo.dispose();
  // the buckle: an iron ring and a wooden toggle at mid-flank
  const bp = girthBuckle(ctx.rig, gi);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(g.side, 0, 0));
  ctx.gear(new THREE.TorusGeometry(0.55, 0.13, 8, 22), { bone: g.bone, color: 0x9a7438, mat: surface('gold', { rough: 0.55 }), matrix: new THREE.Matrix4().compose(new THREE.Vector3(...bp), q, new THREE.Vector3(1, 1, 1)) });
  ctx.gear(new THREE.BoxGeometry(0.3, 1.3, 0.42), { bone: g.bone, color: 0x7a2416, mat: 'wood', matrix: new THREE.Matrix4().compose(new THREE.Vector3(bp[0] + g.side * 0.16, bp[1], bp[2]), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, g.side * 0.2)), new THREE.Vector3(1, 1, 1)) });
}

/** model-space position of a girth's buckle (its weak point) */
export function girthBuckle(rig: RigDef, gi: number): [number, number, number] {
  const g = GIRTHS[gi];
  return cached(`mumak:buckle:${gi}`, () => surfaceAlong(bodyProbe(rig), [0, 10.3, g.z], [Math.sin(1.42) * g.side, Math.cos(1.42), 0], 0.22));
}

/** points of the rope ladder on the left flank (model space): from the howdah edge down to the widest point */
export function ladderProfile(rig: RigDef): { upper: [number, number, number][]; pivot: [number, number, number] } {
  return cached('mumak:ladder', () => {
    const pr = bodyProbe(rig);
    const upper: [number, number, number][] = [];
    let widest: [number, number, number] = [0, 0, 0];
    for (let i = 0; i <= 10; i++) {
      const th = lerp(0.62, 1.62, i / 10);
      const p = surfaceAlong(pr, [0, 10.3, LADDER_Z], [Math.sin(th), Math.cos(th), 0], 0.32);
      upper.push(p);
      if (p[0] > widest[0]) widest = p;
    }
    // keep the points down to the widest one; the rest hangs free from there
    const k = upper.findIndex((p) => p === widest);
    return { upper: upper.slice(0, k + 1), pivot: widest };
  });
}

function tailTuft(rig: RigDef): THREE.BufferGeometry {
  const rnd = mulberry32(31);
  const roots: GrowRoot[] = [];
  const tip = new THREE.Vector3(0, 6.85, -11.3);
  const t3 = rig.boneIndex('tail3');
  for (let i = 0; i < 46; i++) {
    const a = rnd() * Math.PI * 2;
    const y = tip.y + rnd() * 0.9;
    roots.push({
      p: [Math.cos(a) * 0.14, y, tip.z + Math.sin(a) * 0.14],
      dir: [Math.cos(a) * 0.25, -1, Math.sin(a) * 0.25 - 0.1],
      length: 0.9 + rnd() * 0.7,
      width: 0.035,
      bone: t3,
      color: rnd() < 0.5 ? 0x17120e : 0x2a221a,
    });
  }
  const strands = growStrands(roots, { segments: 4, gravity: 1, jitter: 0.15, seed: 5, taper: 0.5 });
  return hairGeometry(strands, [], { color: 0x1c1712, tipColor: 0x3a3026, weights: (_p, _a, out) => out.push([t3, 1]) });
}

// ─────────────────────────────────────────────────────────────────────────────
// Meshing / LOD
// ─────────────────────────────────────────────────────────────────────────────

export type MumakLod = 'hero' | 'far';

export function mumakMeshOpts(lod: MumakLod): MeshOpts {
  return lod === 'hero'
    ? { res: 0.24, regions: [{ min: [-2.8, 0.1, 7.9], max: [2.8, 14.8, 14.7], res: 0.14, aoScale: 0.55 }], ao: { dist: 1.4, strength: 0.9 }, smooth: 2 }
    : { res: 0.46, ao: { dist: 1.6, strength: 0.9 }, smooth: 1 };
}

/** mesh the sculpt in the kit worker pool (call during loading; createMumak is then a cache hit) */
export async function premeshMumak(lod: MumakLod): Promise<void> {
  const rig = mumakRig();
  const sc = new Sculpt(rig, { skinK: SKIN_K });
  sculptMumak(sc, rig);
  await meshSculptAsync(sc, mumakMeshOpts(lod));
}

export interface MumakModel {
  creature: Creature;
  object: THREE.Group;
  lod: MumakLod;
  bones: Record<string, THREE.Bone>;
  animator: MumakAnimator;
  /** howdah (null when built without one) */
  howdah: Howdah | null;
  /** howdah anchor on the spine bone (the howdah group is its child until it slides off) */
  howdahAnchor: THREE.Object3D;
  /** rope ladder on the left flank (hero only) */
  ladder: RopeLadder | null;
  /** weak-point helpers parented to bones: girth buckles (4) and the skull */
  buckleAnchors: THREE.Object3D[];
  skullAnchor: THREE.Object3D;
  /** driver seat on the neck */
  driverSeat: THREE.Object3D;
  /** cut a girth strap: it swings down and drops away (animated by the animator) */
  cutGirth(i: number): void;
  dispose(): void;
}

/** attach a helper to a bone at a MODEL-space point */
export function boneAnchor(bones: Record<string, THREE.Bone>, rig: RigDef, bone: string, p: V3, name = 'anchor'): THREE.Object3D {
  const o = new THREE.Object3D();
  o.name = name;
  const h = rig.pos(bone);
  o.position.set(p[0] - h[0], p[1] - h[1], p[2] - h[2]);
  bones[bone].add(o);
  return o;
}

export function createMumak(o: { seed?: number; lod?: MumakLod; howdah?: boolean } = {}): MumakModel {
  const lod = o.lod ?? 'hero';
  const rig = mumakRig();
  const hero = lod === 'hero';
  const c = buildCreature({
    key: `mumak_${lod}`,
    seed: o.seed ?? 0,
    rig,
    skinK: SKIN_K,
    sculpt: (sc) => sculptMumak(sc, rig),
    mesh: mumakMeshOpts(lod),
    material: { detailScale: 3.4, detailStrength: 1.6, wrap: 0.22, scatterColor: 0x7a4632, roughness: 1.0 },
    extra: (ctx) => {
      tuskExtras(ctx);
      earExtras(ctx);
      capeExtras(ctx);
      for (let i = 0; i < GIRTHS.length; i++) girthGeometry(ctx, i);
    },
    hair: hero ? (r) => tailTuft(r) : undefined,
    hairMaterial: { roughness: 0.8, anisotropy: 0.4, alphaTest: 0.4 },
  });
  c.root.name = `mumak:${lod}`;
  const bones = c.rig.byName;
  const animator = new MumakAnimator(c, hero);
  const howdahAnchor = boneAnchor(bones, rig, 'spine', HOWDAH_SEAT, 'howdah_anchor');
  let howdah: Howdah | null = null;
  if (o.howdah !== false) {
    howdah = buildHowdah({ lite: !hero, seed: o.seed });
    howdahAnchor.add(howdah.object);
  }
  const ladder = hero && o.howdah !== false ? buildRopeLadder(bones, rig) : null;
  const buckleAnchors = GIRTHS.map((g, i) => boneAnchor(bones, rig, g.bone, girthBuckle(rig, i), `buckle_${i}`));
  const skullAnchor = boneAnchor(bones, rig, 'head', [0, 12.4, 9.7], 'skull');
  const driverSeat = boneAnchor(bones, rig, 'neck', [0, 14.0, 6.2], 'driver_seat');
  if (!hero) c.body.castShadow = true;
  const model: MumakModel = {
    creature: c,
    object: c.root,
    lod,
    bones,
    animator,
    howdah,
    howdahAnchor,
    ladder,
    buckleAnchors,
    skullAnchor,
    driverSeat,
    cutGirth: (i) => animator.cutGirth(i),
    dispose() {
      c.dispose();
      c.root.traverse((ob) => {
        const m = ob as THREE.Mesh;
        if (m.isMesh && m !== c.body && m !== c.hair && !m.geometry.userData.shared) m.geometry.dispose();
      });
    },
  };
  return model;
}

// ─────────────────────────────────────────────────────────────────────────────
// Animation
// ─────────────────────────────────────────────────────────────────────────────

export type MumakAction = 'none' | 'sweep' | 'gore' | 'stomp' | 'trumpet' | 'thrash';
/** seconds per action (actionT runs 0..1 over this) */
export const MUMAK_ACTION_TIME: Record<MumakAction, number> = { none: 1, sweep: 2.6, gore: 2.3, stomp: 3.4, trumpet: 2.6, thrash: 1.6 };
/** strike moments (fraction of the action) */
export const MUMAK_STRIKE: Record<MumakAction, number> = { none: 2, sweep: 0.46, gore: 0.47, stomp: 0.53, trumpet: 0.3, thrash: 2 };

const smooth01 = (x: number) => {
  const t = clamp(x, 0, 1);
  return t * t * (3 - 2 * t);
};
const _T = new THREE.Vector3();
const _pole = new THREE.Vector3();
const _qi = new THREE.Quaternion();
const AX = new THREE.Vector3(1, 0, 0);
const BACK = new THREE.Vector3(0, 0, -1);
const FWD = new THREE.Vector3(0, 0, 1);

interface LegDef {
  up: number;
  mid: number;
  end: number;
  g: number;
  front: boolean;
  side: number;
}

export class MumakAnimator {
  /** forward speed (m/s) */
  speed = 0;
  /** yaw rate (rad/s), bends the body */
  turn = 0;
  action: MumakAction = 'none';
  /** 0..1 progress of the action */
  actionT = 0;
  /** +1 sweep to the left first, -1 to the right */
  actionDir = 1;
  /** 0..0.5 kneel forward (trunk on the ground), 0.5..1 roll onto its side */
  collapse = 0;
  lookYaw = 0;
  lookPitch = 0;
  /** gait cycles */
  phase = 0;
  t = 0;
  /** ground offsets of the feet (model y), set by the owner from the terrain */
  readonly footDy = [0, 0, 0, 0];
  /** feet that touched down this step [FL, FR, HL, HR] */
  readonly stepped = [false, false, false, false];
  readonly planted = [1, 1, 1, 1];
  readonly gait: QuadGaitSample;
  /** foot bones [FL, FR, HL, HR] */
  readonly feet: THREE.Bone[];
  private readonly legs: LegDef[];
  private readonly I: (n: string) => number;
  private readonly girthCut = [-1, -1, -1, -1];
  private readonly trunk: number[];

  constructor(private readonly c: Creature, springs: boolean) {
    const ps = c.pose;
    this.I = (n: string) => ps.i(n);
    const I = this.I;
    this.gait = quadGait(0, 0, MUMAK_LEG, undefined, 'walk');
    this.legs = [
      { up: I('humer_l'), mid: I('radius_l'), end: I('fpaw_l'), g: 0, front: true, side: 1 },
      { up: I('humer_r'), mid: I('radius_r'), end: I('fpaw_r'), g: 1, front: true, side: -1 },
      { up: I('femur_l'), mid: I('tibia_l'), end: I('hpaw_l'), g: 2, front: false, side: 1 },
      { up: I('femur_r'), mid: I('tibia_r'), end: I('hpaw_r'), g: 3, front: false, side: -1 },
    ];
    this.feet = ['fpaw_l', 'fpaw_r', 'hpaw_l', 'hpaw_r'].map((n) => c.rig.byName[n]);
    this.trunk = [1, 2, 3, 4, 5, 6].map((k) => I(`trunk${k}`));
    if (springs) {
      c.springs.push(new SpringChain(ps, this.trunk, [TRUNK_TIP[0] - 0, TRUNK_TIP[1] - 1.4, TRUNK_TIP[2] - 13.35], { stiffness: 0.16, drag: 0.16, gravity: 2.5 }));
      c.springs.push(new SpringChain(ps, [I('tail1'), I('tail2'), I('tail3')], [0, -1.7, -0.1], { stiffness: 0.1, drag: 0.15, gravity: 4 }));
    }
  }

  cutGirth(i: number): void {
    if (this.girthCut[i] < 0) this.girthCut[i] = 0;
  }
  resetSprings(): void {
    for (const s of this.c.springs) s.reset();
  }

  /** advance the clock and gait, solve the pose and write it to the bones */
  update(dt: number): void {
    this.t += dt;
    const g = quadGait(this.phase, this.speed, MUMAK_LEG, this.gait, 'walk');
    for (let i = 0; i < 4; i++) {
      const was = this.planted[i];
      const now = g.legs[i].planted;
      this.stepped[i] = this.speed > 0.2 && this.collapse <= 0 && was < 0.5 && now >= 0.5;
      this.planted[i] = now;
    }
    this.solve(dt);
    this.c.update(dt);
    // girth straps that were cut: swing down, then shrink away
    for (let i = 0; i < 4; i++) {
      const k = this.girthCut[i];
      if (k < 0) continue;
      this.girthCut[i] = k + dt;
      const b = this.c.rig.byName[GIRTHS[i].bone];
      const s = k < 2.2 ? 1 : Math.max(0.001, 1 - (k - 2.2) / 0.8);
      b.scale.setScalar(s);
    }
    this.phase += g.freq * dt;
  }

  private solve(dt: number): void {
    void dt;
    const ps = this.c.pose;
    const I = this.I;
    const g = this.gait;
    ps.reset();
    const T = this.t;
    const mv = Math.min(1, this.speed / 1.5);
    const p2 = Math.PI * 2 * this.phase;
    const a = this.action;
    const u = this.actionT;
    const d = this.actionDir;

    // ── action envelopes ──
    let rear = 0; // stomp: rear up on the hind legs
    let lunge = 0; // gore: lunge forward
    let headP = 0; // + nods down
    let headY = 0;
    let headR = 0;
    let jaw = 0.02;
    let ears = 0; // 1 = spread wide (threat)
    const curl = [0, -0.03, -0.05, -0.08, -0.12, -0.2];
    const side = [0, 0, 0, 0, 0, 0];
    for (let i = 0; i < 6; i++) {
      curl[i] += Math.sin(T * 0.8 + i * 0.55) * 0.035 + Math.sin(p2 + i * 0.4) * 0.05 * mv;
      side[i] += Math.sin(T * 0.6 + i * 0.45) * 0.05 + Math.sin(p2 * 0.5 + i * 0.3) * 0.03 * mv;
    }
    if (a === 'sweep') {
      const w = smooth01(u / 0.36);
      const s = smooth01((u - 0.36) / 0.22);
      const rec = smooth01((u - 0.62) / 0.38);
      const on = w * (1 - rec);
      for (let i = 0; i < 6; i++) {
        curl[i] += (-0.38 + i * 0.03) * on * (1 - s * 0.6);
        side[i] += d * (0.32 - 0.72 * s) * on;
      }
      headY += d * (0.22 - 0.5 * s) * on;
      headP += -0.12 * w * (1 - s) * (1 - rec);
      ears = on;
    } else if (a === 'gore') {
      const w = smooth01(u / 0.4);
      const s = smooth01((u - 0.4) / 0.1);
      const rec = smooth01((u - 0.6) / 0.4);
      headP += (-0.24 * w + 0.6 * s) * (1 - rec);
      lunge = s * (1 - rec);
      for (let i = 0; i < 6; i++) curl[i] += (0.22 + i * 0.04) * s * (1 - rec) - 0.1 * w * (1 - s);
      jaw = 0.02 + 0.2 * w * (1 - rec);
      ears = w * (1 - rec);
    } else if (a === 'stomp') {
      rear = u < 0.45 ? smooth01(u / 0.45) : u < 0.56 ? 1 - smooth01((u - 0.45) / 0.11) : 0;
      const raise = u < 0.56 ? smooth01(u / 0.3) : 1 - smooth01((u - 0.56) / 0.3);
      for (let i = 0; i < 6; i++) curl[i] += (-0.55 + i * 0.06) * raise;
      headP += -0.2 * raise;
      jaw = 0.02 + 0.3 * raise;
      ears = raise;
    } else if (a === 'trumpet') {
      const w = smooth01(u / 0.25) * (1 - smooth01((u - 0.7) / 0.3));
      const tc = [-0.55, -0.62, -0.6, -0.5, -0.38, -0.25];
      for (let i = 0; i < 6; i++) {
        curl[i] += tc[i] * w + Math.sin(T * 9 + i) * 0.03 * w;
        side[i] += Math.sin(T * 2.2 + i * 0.6) * 0.06 * w;
      }
      headP += -0.22 * w;
      jaw = 0.02 + 0.32 * w;
      ears = w;
    } else if (a === 'thrash') {
      headY += Math.sin(T * 6.5) * 0.22;
      headR += Math.sin(T * 4.7) * 0.12;
      headP += -0.1 + Math.sin(T * 3.1) * 0.08;
      for (let i = 0; i < 6; i++) {
        curl[i] += -0.32 + Math.sin(T * 5 + i * 0.8) * 0.12;
        side[i] += Math.sin(T * 6 + i) * 0.28;
      }
      jaw = 0.25;
      ears = 1;
    }
    // ── collapse ──
    const kneel = smooth01(this.collapse / 0.5);
    const roll = smooth01((this.collapse - 0.5) / 0.5);
    if (kneel > 0) {
      const tc = [-0.05, -0.38, -0.42, -0.36, -0.22, -0.1];
      for (let i = 0; i < 6; i++) {
        curl[i] = lerp(curl[i], tc[i], kneel);
        side[i] *= 1 - kneel;
      }
      headP = lerp(headP, -0.05, kneel);
      headY *= 1 - kneel;
      jaw = lerp(jaw, 0.12, kneel);
    }
    const alive = 1 - kneel;

    // ── body ──
    const sway = Math.sin(p2) * 0.022 * mv * alive;
    ps.offset[I('pelvis')].set(0, g.bodyY * alive - kneel * 2.2 - roll * 5.2, lunge * 1.1 + kneel * 0.6);
    ps.euler(I('pelvis'), -rear * 0.3 + kneel * 0.12 - roll * 0.08 + Math.sin(p2 * 2) * 0.004 * mv, this.turn * 0.12 * alive, sway + roll * 1.32, 'YXZ');
    ps.euler(I('spine'), Math.sin(T * 0.7) * 0.004, this.turn * 0.05, -sway * 0.3);
    ps.euler(I('chest'), Math.sin(T * 0.7 + 1) * 0.006 + rear * 0.05, this.turn * 0.08, -sway * 0.4);
    const nod = Math.sin(p2 * 2 + 0.6) * 0.025 * mv;
    ps.euler(I('neck'), this.lookPitch * 0.4 + headP * 0.4 + nod * 0.5, this.lookYaw * 0.45 + headY * 0.4 + this.turn * 0.25 * alive, headR * 0.4);
    ps.euler(I('head'), this.lookPitch * 0.6 + headP * 0.6 + nod, this.lookYaw * 0.55 + headY * 0.6, headR * 0.6 - sway * 0.5);
    ps.euler(I('jaw'), jaw, 0, 0);
    const flap = Math.sin(T * 1.05) * 0.12 + Math.sin(T * 2.3) * 0.04;
    ps.euler(I('ear_l'), 0, -(0.08 + flap + ears * 0.75) * (1 - kneel * 0.6), 0);
    ps.euler(I('ear_r'), 0, 0.08 + flap * 0.9 + ears * 0.75 * (1 - kneel * 0.6), 0);
    for (let i = 0; i < 6; i++) ps.euler(this.trunk[i], curl[i], i === 0 ? side[0] * 0.5 : 0, side[i], 'YXZ');
    ps.euler(I('tail1'), 0.15 + roll * 0.3, Math.sin(T * 1.3) * 0.15, Math.sin(T * 1.1) * 0.18);
    ps.euler(I('tail2'), 0.05, 0, Math.sin(T * 1.1 - 0.6) * 0.15);
    // girths: a cut strap swings down/out from its top
    for (let i = 0; i < 4; i++) {
      const k = this.girthCut[i];
      if (k < 0) continue;
      const sw = Math.min(1, k / 0.9);
      const swing = (1 - Math.pow(1 - sw, 3)) * 0.9 + Math.sin(k * 3.5) * 0.12 * Math.exp(-k);
      ps.euler(I(GIRTHS[i].bone), 0, 0, -GIRTHS[i].side * swing);
    }
    ps.fk();

    // ── legs: 2-bone IK to the gait targets ──
    for (const L of this.legs) {
      const f = g.legs[L.g];
      const rest = ps.restModel[L.end];
      _T.set(rest.x, rest.y + f.lift * alive + this.footDy[L.g], rest.z + f.along * alive);
      if (L.front && rear > 0) {
        _T.y += rear * 3.6 + (L.side > 0 ? 0.4 : 0) * rear;
        _T.z += rear * 1.6;
      }
      if (kneel > 0) {
        if (L.front) {
          _T.y = lerp(_T.y, rest.y - 0.2, kneel);
          _T.z += kneel * 2.4;
          _T.x += L.side * kneel * 0.5;
        } else {
          _T.z -= kneel * 1.0;
          _T.x += L.side * kneel * 0.4;
        }
      }
      _pole.copy(ps.modelP[L.mid]).addScaledVector(L.front ? BACK : FWD, 4);
      solveTwoBone(ps, L.up, L.mid, L.end, _T, _pole, { restUp: L.front ? FWD : BACK, maxStretch: 1.03 });
      ps.local[L.end].setFromAxisAngle(AX, f.pitch * 0.35 * alive + (L.front ? kneel * 1.2 : 0));
      if (roll > 0) {
        // on its side: the legs go limp and stick out from the body
        for (const bi of [L.up, L.mid, L.end]) {
          _qi.setFromAxisAngle(AX, bi === L.mid ? (L.front ? -0.18 : 0.22) : 0.05);
          ps.local[bi].slerp(_qi, roll);
        }
      }
      ps.fkFrom(L.up);
    }
  }

  /** lab / deterministic pose: anim + time */
  pose(anim: string, t: number): void {
    const speed = anim === 'walk' ? 2.8 : anim === 'walk_slow' ? 1.4 : anim === 'charge' ? 4.2 : 0;
    const act = (['sweep', 'gore', 'stomp', 'trumpet', 'thrash'] as MumakAction[]).includes(anim as MumakAction) ? (anim as MumakAction) : 'none';
    this.resetSprings();
    this.speed = speed;
    this.turn = 0;
    this.action = act;
    this.actionDir = 1;
    this.collapse = anim === 'collapse' ? clamp(t / 7, 0, 1) : anim === 'kneel' ? clamp(t / 3.5, 0, 0.5) : 0;
    const freq = quadGait(0, speed, MUMAK_LEG, undefined, 'walk').freq;
    const steps = 60;
    for (let k = steps; k >= 0; k--) {
      const tt = Math.max(0, t - k / 60);
      this.t = tt;
      this.phase = tt * freq;
      const dur = MUMAK_ACTION_TIME[act];
      this.actionT = act === 'none' ? 0 : act === 'thrash' ? (tt % dur) / dur : clamp((tt % (dur + 0.6)) / dur, 0, 1);
      this.solve(1 / 60);
      this.c.update(k === steps ? 0 : 1 / 60);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Rope ladder (left flank)
// ─────────────────────────────────────────────────────────────────────────────

export interface RopeLadder {
  /** rigid upper part on the spine bone */
  upper: THREE.Object3D;
  /** pivot of the free-hanging part (child of the spine bone at the flank's widest point) */
  pivot: THREE.Object3D;
  /** length of the free part (m) */
  freeLen: number;
  /** upper polyline in pivot-parent (spine anchor) space, bottom → top */
  upperPts: THREE.Vector3[];
  /** total length (m) */
  length: number;
  /** world point on the ladder at s metres from the bottom */
  pointAt(s: number, out: THREE.Vector3): THREE.Vector3;
  /** swing the free part (radians about model x and z) */
  swing(ax: number, az: number): void;
}

function buildRopeLadder(bones: Record<string, THREE.Bone>, rig: RigDef): RopeLadder {
  const prof = ladderProfile(rig);
  const spineHead = rig.pos('spine');
  const toSpine = (p: V3) => new THREE.Vector3(p[0] - spineHead[0], p[1] - spineHead[1], p[2] - spineHead[2]);
  const rope = mat('cloth_wool', { key: 'rope', rgb: [0.6, 0.5, 0.35] });
  const wood = mat('old_wood', { key: 'howdah', rgb: [0.78, 0.68, 0.58] });
  const anchor = new THREE.Object3D();
  anchor.name = 'ladder_anchor';
  bones.spine.add(anchor);
  // upper: from the howdah edge down the flank (top → widest point)
  const up = new MeshKit();
  const pts = prof.upper.map(toSpine);
  for (let i = 0; i + 1 < pts.length; i++) {
    for (const dz of [-0.36, 0.36]) {
      up.add(rope, limbGeo([pts[i].x, pts[i].y, pts[i].z + dz], [pts[i + 1].x, pts[i + 1].y, pts[i + 1].z + dz], 0.045, 0.045, 5, 0.4));
    }
    const m = pts[i].clone().lerp(pts[i + 1], 0.5);
    up.add(wood, limbGeo([m.x, m.y, m.z - 0.38], [m.x, m.y, m.z + 0.38], 0.04, 0.04, 5, 0.4));
  }
  const upper = up.build({ name: 'ladder_upper' });
  anchor.add(upper);
  // free part: straight down from the widest point
  const pivot = new THREE.Object3D();
  pivot.name = 'ladder_pivot';
  pivot.position.copy(toSpine(prof.pivot));
  anchor.add(pivot);
  const freeLen = prof.pivot[1] - 0.45;
  const lo = new MeshKit();
  for (const dz of [-0.36, 0.36]) lo.add(rope, limbGeo([0, 0, dz], [0, -freeLen, dz], 0.045, 0.045, 5, 0.4));
  for (let y = -0.35; y > -freeLen; y -= 0.42) lo.add(wood, limbGeo([0, y, -0.38], [0, y, 0.38], 0.04, 0.04, 5, 0.4));
  // a knotted bottom end
  for (const dz of [-0.36, 0.36]) lo.add(rope, new THREE.SphereGeometry(0.09, 6, 5), xf(0, -freeLen, dz));
  const lower = lo.build({ name: 'ladder_lower' });
  pivot.add(lower);
  // upper polyline bottom → top, in anchor space
  const upperPts = pts.slice().reverse();
  let upLen = 0;
  for (let i = 1; i < upperPts.length; i++) upLen += upperPts[i].distanceTo(upperPts[i - 1]);
  const _a = new THREE.Vector3();
  return {
    upper,
    pivot,
    freeLen,
    upperPts,
    length: freeLen + upLen,
    pointAt(s: number, out: THREE.Vector3) {
      if (s <= freeLen) {
        out.set(0, -freeLen + Math.max(0, s), 0);
        pivot.updateWorldMatrix(true, false);
        return out.applyMatrix4(pivot.matrixWorld);
      }
      let rem = s - freeLen;
      for (let i = 1; i < upperPts.length; i++) {
        const l = upperPts[i].distanceTo(upperPts[i - 1]);
        if (rem <= l || i === upperPts.length - 1) {
          _a.copy(upperPts[i - 1]).lerp(upperPts[i], clamp(rem / Math.max(l, 1e-4), 0, 1));
          anchor.updateWorldMatrix(true, false);
          return out.copy(_a).applyMatrix4(anchor.matrixWorld);
        }
        rem -= l;
      }
      return out.copy(upperPts[upperPts.length - 1]).applyMatrix4(anchor.matrixWorld);
    },
    swing(ax: number, az: number) {
      pivot.rotation.set(ax, 0, az);
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// The howdah: a wooden war tower lashed to the back
// ─────────────────────────────────────────────────────────────────────────────

export interface Howdah {
  /** origin at the centre of the saddle base, +Z forward */
  object: THREE.Group;
  /** walking surface height (local) */
  deckY: number;
  /** walkable half extents inside the parapet (x, z) */
  half: [number, number];
  /** crew spots on the deck (local) */
  slots: THREE.Vector3[];
  /** the two front lashing ropes the player cuts, and where he stands to cut them (local) */
  ropes: THREE.Object3D[];
  ropeSpots: THREE.Vector3[];
  /** where the rope ladder comes over the parapet (local) */
  ladderTop: THREE.Vector3;
  /** where the neck run leaves the deck (local, front opening) */
  frontGate: THREE.Vector3;
}

export function buildHowdah(o: { lite?: boolean; seed?: number } = {}): Howdah {
  const lite = !!o.lite;
  const rnd = mulberry32(0x40d4 + (o.seed ?? 0));
  const kit = new MeshKit();
  const wood = mat('old_wood', { key: 'howdah', rgb: [0.78, 0.68, 0.58] });
  const dark = mat('old_wood', { key: 'howdahDark', rgb: [0.42, 0.34, 0.28] });
  const planks = mat('wood_planks', { key: 'howdahDeck', rgb: [0.8, 0.7, 0.6] });
  const red = mat('cloth_wool', { key: 'howdahRed', rgb: [0.78, 0.16, 0.1] });
  const gold = mat('gold', { key: 'howdahGold' });
  const rope = mat('cloth_wool', { key: 'rope', rgb: [0.6, 0.5, 0.35] });
  const iron = mat('metal_dark', { key: 'howdah' });
  const W = 2.9; // half width (x)
  const D = 3.6; // half depth (z)
  const deckY = 0.62;
  // saddle frame: two skids and cross beams resting on the back
  for (const s of [-1, 1]) kit.add(dark, limbGeo([s * 1.5, -0.05, -D - 0.3], [s * 1.5, -0.05, D + 0.3], 0.2, 0.2, 7, 0.8));
  for (let z = -D; z <= D + 0.01; z += 1.2) kit.add(dark, limbGeo([-W, 0.25, z], [W, 0.25, z], 0.13, 0.13, 6, 0.8));
  // deck
  kit.box(planks, [W * 2, 0.22, D * 2], [0, deckY - 0.11, 0], 0, { tile: 1.6 });
  // parapet: plank walls with openings (left side for the ladder, front for the neck)
  const wallH = 1.15;
  const wall = (x0: number, z0: number, x1: number, z1: number) => {
    const len = Math.hypot(x1 - x0, z1 - z0);
    kit.box(wood, [0.14, wallH, len], [(x0 + x1) / 2, deckY + wallH / 2, (z0 + z1) / 2], Math.atan2(x1 - x0, z1 - z0), { tile: 1.4 });
    kit.box(dark, [0.22, 0.12, len + 0.1], [(x0 + x1) / 2, deckY + wallH + 0.04, (z0 + z1) / 2], Math.atan2(x1 - x0, z1 - z0), { tile: 1.2 });
  };
  wall(-W, -D, W, -D); // back
  wall(-W, D, -0.75, D); // front, with a gate in the middle
  wall(0.75, D, W, D);
  wall(-W, -D, -W, D); // right
  const lz = LADDER_Z - HOWDAH_SEAT[2];
  wall(W, -D, W, lz - 0.9); // left, with a gap where the rope ladder comes over
  wall(W, lz + 0.9, W, D);
  // posts: corners + mid, carrying the upper turret
  const postH = 4.2;
  const posts: [number, number][] = [[-W, -D], [W, -D], [-W, D], [W, D], [-W, 0], [W, 0.9]];
  for (const [x, z] of posts) kit.add(wood, limbGeo([x, 0.1, z], [x * 0.86, deckY + postH, z * 0.86], 0.15, 0.12, 7, 0.8));
  // upper turret: a smaller platform with its own parapet and a canopy
  const uY = deckY + postH;
  const uW = W * 0.86;
  const uD = D * 0.86;
  kit.box(planks, [uW * 2 + 0.3, 0.2, uD * 2 + 0.3], [0, uY, 0], 0, { tile: 1.6 });
  for (const [x0, z0, x1, z1] of [[-uW, -uD, uW, -uD], [-uW, uD, uW, uD], [-uW, -uD, -uW, uD], [uW, -uD, uW, uD]]) {
    const len = Math.hypot(x1 - x0, z1 - z0);
    kit.box(wood, [0.12, 0.85, len], [(x0 + x1) / 2, uY + 0.5, (z0 + z1) / 2], Math.atan2(x1 - x0, z1 - z0), { tile: 1.4 });
  }
  // canopy posts and a red and gold pyramid roof
  for (const [x, z] of [[-uW, -uD], [uW, -uD], [-uW, uD], [uW, uD]]) kit.add(wood, limbGeo([x, uY, z], [x * 0.95, uY + 2.3, z * 0.95], 0.09, 0.08, 6, 0.8));
  const roof = new THREE.ConeGeometry(Math.hypot(uW, uD) * 1.12, 2.0, 4, 1, true);
  kit.add(red, roof, xf(0, uY + 3.3, 0, Math.PI / 4, 1, 1, uD / uW), { tile: 1.5 });
  kit.add(gold, new THREE.SphereGeometry(0.22, 10, 8), xf(0, uY + 4.35, 0));
  kit.add(gold, limbGeo([0, uY + 4.3, 0], [0, uY + 5.4, 0], 0.07, 0.01, 6, 0.6));
  // gold trim band under the roof
  for (const [x0, z0, x1, z1] of [[-uW, -uD, uW, -uD], [-uW, uD, uW, uD], [-uW, -uD, -uW, uD], [uW, -uD, uW, uD]]) {
    const len = Math.hypot(x1 - x0, z1 - z0);
    kit.box(gold, [0.06, 0.18, len + 0.2], [(x0 + x1) / 2 * 1.05, uY + 2.3, (z0 + z1) / 2 * 1.05], Math.atan2(x1 - x0, z1 - z0));
  }
  if (!lite) {
    // red drapes hanging from the upper parapet, with gold hems
    for (const s of [-1, 1]) {
      for (const z of [-2.2, 0, 2.2]) {
        kit.box(red, [0.04, 1.6, 1.2], [s * (uW + 0.12), uY - 0.55, z], 0, { tile: 1.2 });
        kit.box(gold, [0.05, 0.12, 1.2], [s * (uW + 0.13), uY - 1.32, z]);
      }
    }
    // round shields hung on the parapet
    const shield = new THREE.CylinderGeometry(0.46, 0.46, 0.07, 18);
    shield.rotateZ(Math.PI / 2);
    for (const s of [-1, 1]) {
      for (let z = -D + 0.7; z < D - 0.3; z += 1.25) {
        if (s > 0 && Math.abs(z - lz) < 1.3) continue;
        kit.add(rnd() < 0.5 ? red : dark, shield.clone(), xf(s * (W + 0.1), deckY + 0.62, z));
        kit.add(gold, new THREE.SphereGeometry(0.1, 8, 6), xf(s * (W + 0.15), deckY + 0.62, z));
      }
    }
    for (let x = -W + 0.7; x < W - 0.3; x += 1.25) {
      kit.add(dark, shield.clone(), xf(x, deckY + 0.62, -D - 0.1, Math.PI / 2));
    }
    shield.dispose();
    // stakes along the front parapet
    for (let x = -W; x <= W + 0.01; x += 0.55) {
      if (Math.abs(x) < 0.8) continue;
      kit.add(dark, limbGeo([x, deckY + wallH, D + 0.05], [x, deckY + wallH + 0.75, D + 0.35], 0.06, 0.005, 5, 0.6));
    }
    // arrow bundles and a coil of rope on the deck
    for (const [x, z] of [[-2.3, -2.9], [2.2, 2.9], [-2.3, 2.9]]) {
      for (let k = 0; k < 9; k++) kit.add(dark, limbGeo([x + (rnd() - 0.5) * 0.25, deckY, z + (rnd() - 0.5) * 0.25], [x + (rnd() - 0.5) * 0.5, deckY + 0.95, z + (rnd() - 0.5) * 0.5], 0.012, 0.012, 3, 0.5));
    }
    kit.add(rope, new THREE.TorusGeometry(0.35, 0.1, 6, 14), xf(1.6, deckY + 0.1, -2.6, 0, 1, 1, 1, Math.PI / 2, 0));
  }
  // lashings: ropes from the deck corners down the flanks (the front two are cut by the player)
  const ropesKit = new MeshKit();
  const lashes: [V3, V3][] = [
    [[-W - 0.05, 0.3, -D + 0.2], [-W - 0.9, -2.8, -D + 0.6]],
    [[W + 0.05, 0.3, -D + 0.2], [W + 0.9, -2.8, -D + 0.6]],
  ];
  for (const [a, b] of lashes) ropesKit.add(rope, limbGeo([a[0], a[1], a[2]], [b[0], b[1], b[2]], 0.07, 0.07, 6, 0.4));
  const ropes: THREE.Object3D[] = [];
  const ropeSpots: THREE.Vector3[] = [];
  for (const s of [1, -1]) {
    const k2 = new MeshKit();
    const top: V3 = [s * (W - 0.15), deckY + 0.3, D - 0.15];
    const bot: V3 = [s * (W + 0.75), -2.4, D + 0.9];
    k2.add(rope, limbGeo([top[0], top[1], top[2]], [bot[0], bot[1], bot[2]], 0.09, 0.09, 7, 0.4));
    k2.add(rope, new THREE.TorusGeometry(0.2, 0.07, 6, 12), xf(top[0], top[1] + 0.05, top[2], 0, 1, 1, 1, Math.PI / 2, 0));
    k2.add(iron, new THREE.BoxGeometry(0.3, 0.3, 0.3), xf(top[0], top[1] - 0.1, top[2]));
    const g = k2.build({ name: `howdah_rope_${s > 0 ? 'l' : 'r'}` });
    ropes.push(g);
    ropeSpots.push(new THREE.Vector3(s * (W - 0.75), deckY, D - 0.75));
  }
  const object = kit.build({ name: 'howdah' });
  object.add(ropesKit.build({ name: 'howdah_lashings' }));
  for (const r of ropes) object.add(r);
  // banners: red and gold on tall poles at the back corners of the turret
  if (!lite) {
    for (const s of [-1, 1]) {
      const b = banner(0x8e1a10, 'none', { height: 4.6, clothW: 1.0, clothH: 2.6 });
      b.object.position.set(s * (uW - 0.1), uY + 0.1, -uD + 0.1);
      b.object.rotation.y = s > 0 ? Math.PI : 0;
      object.add(b.object);
    }
    const pen = banner(0xb08a2a, 'none', { height: 3.6, clothW: 0.7, clothH: 1.9 });
    pen.object.position.set(0, uY + 0.1, uD - 0.2);
    pen.object.rotation.y = Math.PI / 2;
    object.add(pen.object);
  }
  object.traverse((m) => {
    const mesh = m as THREE.Mesh;
    if (mesh.isMesh) {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    }
  });
  const slots = [
    new THREE.Vector3(1.6, deckY, 2.5),
    new THREE.Vector3(-1.7, deckY, 2.3),
    new THREE.Vector3(-1.8, deckY, -2.4),
    new THREE.Vector3(1.4, deckY, -2.6),
  ];
  return {
    object,
    deckY,
    half: [W - 0.45, D - 0.45],
    slots,
    ropes,
    ropeSpots,
    ladderTop: new THREE.Vector3(W - 0.5, deckY, LADDER_Z - HOWDAH_SEAT[2]),
    frontGate: new THREE.Vector3(0, deckY, D + 0.2),
  };
}
