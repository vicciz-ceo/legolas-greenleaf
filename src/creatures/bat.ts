/**
 * Gundabad war bat (Ravenhill). Built with the creature kit, starting from the kit's bat example
 * (src/creatures/kit/examples/bat.ts) and pushed to the cast's realism bar:
 *
 *  - ~7 m wingspan at scale 1 (the example rig at 1.5x), a lean furred body with a scarred, bare,
 *    wrinkled neck and a long RAT-LIKE head: elongated skull, tapering snout with a split nose pad and
 *    nostrils, a hinged lower jaw, rows of needle teeth and two long fangs, small beady eyes, big
 *    ribbed ears and whiskers.
 *  - wings: rigid tapered arm and finger bones (kit limbSegments) with knuckle bulbs and a hooked
 *    thumb claw at the wrist; the membrane is a SEPARATE skinned sheet with a scalloped trailing edge,
 *    vein and scar painting and a thin-membrane TRANSLUCENCY patch (sun and sky light bleed through
 *    the wing in warm red when it is seen against the light).
 *  - clawed feet: five hooked talons per foot, gripping in the 'carry' pose (Legolas hangs from them).
 *  - animations (deterministic in t): fly, carry (heavy laden flap, legs down, talons clenched), glide,
 *    swoop (wings half folded, talons thrown forward), screech, hit, death (crumpled, tumbling), perch.
 *
 * Usage:
 *   const bat = createGundabadBat(seed);       // scale 1 ≈ 7 m span
 *   scene.add(bat.object);
 *   bat.pose('fly', t);                         // every frame
 *   bat.gripPoint(out);                         // world point between the talons (hang a rider there)
 */
import * as THREE from 'three';
import {
  RigDef, buildCreature, wingFlap, sheetGeometry, surface, growStrands, hairGeometry,
  createCreatureMaterial, makeSkinnedMesh, cached, type Creature, type V3, type WingSample, type GrowRoot,
} from './kit';
import { limbSegment, segmentMatrix } from './kit/geometry';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32 } from '../core/rng';

/** wingspan of the giant bat at scale 1 (m) */
export const BAT_SPAN = 6.9;
/** the example rig is 4.6 m across at its scale 1: our scale 1 = rig scale 1.5 */
const RIG_SCALE = 1.5;

interface WingRest {
  shoulder: V3;
  elbow: V3;
  wrist: V3;
  /** f2 (leading) … f5 (inner) */
  tips: V3[];
  hip: V3;
}

function batRig(s: number) {
  const r = new RigDef();
  r.bone('root', null, [0, 0, 0]);
  r.bone('body', 'root', [0, 1.2 * s, 0.05 * s]);
  r.bone('hips', 'body', [0, 1.14 * s, -0.32 * s]);
  r.bone('tail', 'hips', [0, 1.13 * s, -0.5 * s]);
  r.bone('neck', 'body', [0, 1.27 * s, 0.3 * s]);
  r.bone('head', 'neck', [0, 1.33 * s, 0.44 * s]);
  r.bone('jaw', 'head', [0, 1.3 * s, 0.5 * s]);
  r.pair('ear_l', 'head', [0.075 * s, 1.43 * s, 0.42 * s]);
  const w: WingRest = {
    shoulder: [0.14 * s, 1.27 * s, 0.14 * s],
    elbow: [0.74 * s, 1.34 * s, 0.02 * s],
    wrist: [1.52 * s, 1.38 * s, 0.16 * s],
    tips: [
      [2.3 * s, 1.36 * s, 0.02 * s],
      [2.16 * s, 1.3 * s, -0.58 * s],
      [1.78 * s, 1.25 * s, -0.92 * s],
      [1.22 * s, 1.2 * s, -0.95 * s],
    ],
    hip: [0.12 * s, 1.14 * s, -0.42 * s],
  };
  r.pair('hum_l', 'body', w.shoulder);
  r.pair('arm_l', 'hum_l', w.elbow);
  r.pair('hand_l', 'arm_l', w.wrist);
  for (let k = 0; k < 4; k++) r.pair(`f${k + 2}_l`, 'hand_l', [w.wrist[0] + 0.001 * k, w.wrist[1], w.wrist[2]]);
  r.pair('leg_l', 'hips', [0.11 * s, 1.1 * s, -0.42 * s]);
  r.pair('shin_l', 'leg_l', [0.15 * s, 0.98 * s, -0.47 * s]);
  r.pair('foot_l', 'shin_l', [0.16 * s, 0.84 * s, -0.5 * s]);
  return { rig: r, wing: w };
}

const lerp3 = (a: V3, b: V3, t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** resample a polyline to n points by arc length */
function resample(poly: V3[], n: number): V3[] {
  const d = [0];
  for (let i = 1; i < poly.length; i++) d.push(d[i - 1] + Math.hypot(poly[i][0] - poly[i - 1][0], poly[i][1] - poly[i - 1][1], poly[i][2] - poly[i - 1][2]));
  const out: V3[] = [];
  let k = 0;
  for (let i = 0; i < n; i++) {
    const t = (d[d.length - 1] * i) / (n - 1);
    while (k < d.length - 2 && d[k + 1] < t) k++;
    out.push(lerp3(poly[k], poly[k + 1], (t - d[k]) / Math.max(1e-6, d[k + 1] - d[k])));
  }
  return out;
}

/**
 * One wing membrane as a skinned sheet. The trailing edge is scalloped (pulled in between finger
 * tips like a real bat's), the leading edge is weighted to the arm and the leading finger, the
 * trailing edge to the body and the inner fingers, so the membrane folds with the hand.
 */
function membrane(r: RigDef, w: WingRest, side: 'l' | 'r', seed: number) {
  const sx = side === 'l' ? 1 : -1;
  const m = (p: V3): V3 => [p[0] * sx, p[1], p[2]];
  const cols = 30;
  const rows = 12;
  const rnd = mulberry32(seed * 7 + (side === 'l' ? 1 : 2));
  // scallops: midpoints between consecutive tips pulled toward the wrist
  const scal = (a: V3, b: V3, k: number): V3 => lerp3(lerp3(a, b, 0.5), w.wrist, k);
  const t = w.tips;
  const trailPoly: V3[] = [w.hip, scal(w.hip, t[3], 0.1), t[3], scal(t[3], t[2], 0.16), t[2], scal(t[2], t[1], 0.16), t[1], scal(t[1], t[0], 0.12), t[0]];
  const lead = resample([w.shoulder, w.elbow, w.wrist, t[0]].map(m), cols);
  const trail = resample(trailPoly.map(m), cols);
  const grid: V3[][] = [];
  for (let rr = 0; rr < rows; rr++) {
    const v = rr / (rows - 1);
    const row: V3[] = [];
    for (let c = 0; c < cols; c++) {
      const p = lerp3(lead[c], trail[c], v);
      const u = c / (cols - 1);
      // the membrane sags between the bones and billows a little toward the tip
      const sag = Math.sin(Math.PI * v) * (0.05 + 0.04 * u) * RIG_SCALE * Math.min(1, u * 3);
      row.push([p[0], p[1] - sag, p[2]]);
    }
    grid.push(row);
  }
  const B = (n: string) => r.boneIndex(`${n}_${side}`);
  const body = r.boneIndex('body');
  const hips = r.boneIndex('hips');
  const leadBones = (u: number): [number, number][] =>
    u < 0.22 ? [[B('hum'), 1]] : u < 0.27 ? [[B('hum'), (0.27 - u) / 0.05], [B('arm'), (u - 0.22) / 0.05]] : u < 0.5 ? [[B('arm'), 1]] : u < 0.56 ? [[B('arm'), (0.56 - u) / 0.06], [B('f2'), (u - 0.5) / 0.06]] : [[B('f2'), 1]];
  const trailBones = (u: number): [number, number][] => {
    const seq: [number, number][] = [[hips, 0], [body, 0.12], [B('f5'), 0.3], [B('f4'), 0.52], [B('f3'), 0.74], [B('f2'), 1]];
    for (let i = 0; i + 1 < seq.length; i++) {
      if (u <= seq[i + 1][1]) {
        const k = (u - seq[i][1]) / (seq[i + 1][1] - seq[i][1]);
        return [[seq[i][0], 1 - k], [seq[i + 1][0], k]];
      }
    }
    return [[B('f2'), 1]];
  };
  // the finger lines in (u, v): veins run along them, and the membrane is darker and thicker there
  const fingerU = [0.3, 0.52, 0.74];
  const scars: [number, number, number][] = [];
  for (let i = 0; i < 4; i++) scars.push([0.25 + rnd() * 0.7, 0.25 + rnd() * 0.65, 0.015 + rnd() * 0.02]);
  const colorAt = (u: number, v: number): number => {
    if (v > 0.93 || u > 0.975) return 0x1c1412; // dark rim
    let vein = 0;
    for (const fu of fingerU) {
      // a finger runs from the wrist (u≈0.5, v 0) out to its tip on the trailing edge (u=fu, v=1)
      const lineU = 0.52 + (fu - 0.52) * v;
      vein = Math.max(vein, Math.exp(-Math.pow((u - lineU) / 0.012, 2)) * Math.min(1, v * 4));
    }
    // fine branching veins
    vein = Math.max(vein, 0.45 * Math.exp(-Math.pow(Math.sin(u * 47 + v * 9) / 0.08, 2)) * (0.3 + v * 0.7));
    let scar = 0;
    for (const [su, sv, sr] of scars) scar = Math.max(scar, 1 - Math.min(1, Math.hypot(u - su, (v - sv) * 0.4) / sr));
    if (scar > 0.3) return 0x5a4038;
    const base = new THREE.Color(0x3c2c27).lerp(new THREE.Color(0x231916), vein * 0.8);
    return base.getHex();
  };
  return sheetGeometry({
    grid,
    color: 0x3a2a24,
    colorAt,
    mat: surface('membrane', { rough: 0.62, skin: 0.85 }),
    ao: (u, v) => 0.72 + 0.28 * Math.min(1, u * 3) * (1 - v * 0.3),
    weights: (rr, c, _p, out) => {
      const u = c / (cols - 1);
      const v = rr / (rows - 1);
      for (const [b, wt] of leadBones(u)) out.push([b, wt * (1 - v)]);
      for (const [b, wt] of trailBones(u)) out.push([b, wt * v]);
      const acc = new Map<number, number>();
      for (const [b, wt] of out) acc.set(b, (acc.get(b) ?? 0) + wt);
      out.length = 0;
      for (const [b, wt] of acc) out.push([b, wt]);
    },
  });
}

/**
 * Thin-membrane translucency on top of the kit creature material: light arriving from BEHIND the
 * sheet (sun and sky) shows through in a warm, blood-red tint. Cheap: a few ALU in the light loop
 * end, no extra pass. Shared by every bat (flagged shared: the level never disposes it).
 */
function membraneMaterial(): THREE.MeshPhysicalMaterial {
  return cached('gundabad_bat_membrane_mat', () => {
    const mat = createCreatureMaterial({ side: THREE.DoubleSide, detailScale: 1.4, wrap: 0.7, scatterColor: 0xb0402a });
    const base = mat.onBeforeCompile;
    const trans = { transColor: { value: new THREE.Color(0xc4583a) }, transAmount: { value: 1.25 } };
    mat.onBeforeCompile = (shader, r) => {
      base.call(mat, shader, r);
      Object.assign(shader.uniforms, trans);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform vec3 transColor;\nuniform float transAmount;')
        .replace(
          '#include <lights_fragment_end>',
          `#include <lights_fragment_end>
	{
		vec3 tBack = - geometryNormal;
		vec3 tAlb = material.diffuseColor * transColor * transAmount;
		#if NUM_DIR_LIGHTS > 0
			float tK = max( 0.0, dot( tBack, directionalLights[ 0 ].direction ) );
			float tV = 0.45 + 0.55 * pow( max( 0.0, dot( geometryViewDir, - directionalLights[ 0 ].direction ) ), 3.0 );
			reflectedLight.directDiffuse += tAlb * directionalLights[ 0 ].color * tK * tV;
		#endif
		#if NUM_HEMI_LIGHTS > 0
			reflectedLight.indirectDiffuse += BRDF_Lambert( tAlb ) * getHemisphereLightIrradiance( hemisphereLights[ 0 ], tBack ) * 0.8;
		#endif
	}`,
        );
    };
    mat.customProgramCacheKey = () => 'kit-creature-v3-membrane';
    mat.userData.shared = true;
    return mat;
  });
}

function batFur(r: RigDef, s: number, seed: number) {
  const rnd = mulberry32(5 + seed);
  const roots: GrowRoot[] = [];
  const body = r.boneIndex('body');
  const neck = r.boneIndex('neck');
  for (let i = 0; i < 170; i++) {
    const u = rnd() * Math.PI * 2;
    const v = Math.acos(1 - 2 * rnd());
    const n = new THREE.Vector3(Math.sin(v) * Math.cos(u), Math.cos(v), Math.sin(v) * Math.sin(u));
    // shaggy mane on the shoulders and back; the belly and the head stay leathery
    const onMane = i < 50;
    if (!onMane && n.y < -0.55) continue;
    const c = onMane ? r.at('body', 0, 0.06 * s, 0.14 * s) : r.at('body', 0, -0.02 * s, -0.14 * s);
    const R = onMane ? [0.19, 0.15, 0.17] : [0.19, 0.16, 0.34];
    if (onMane && n.y < -0.1) n.y = -n.y;
    const p: V3 = [c[0] + n.x * R[0] * s, c[1] + n.y * R[1] * s, c[2] + n.z * R[2] * s];
    roots.push({
      p,
      dir: [n.x * 0.45, n.y * 0.35, n.z * 0.3 - 0.75],
      length: (onMane ? 0.12 : 0.075) * s,
      width: 0.045 * s,
      bone: onMane && n.z > 0.3 ? neck : body,
      color: rnd() < 0.5 ? 0x3d322b : 0x55463a,
    });
  }
  const strands = growStrands(roots, { segments: 3, gravity: 1, jitter: 0.18, seed: 3 + seed, taper: 0.35 });
  return hairGeometry(strands, [], { color: 0x3d322b, weights: (_p, _a, out) => out.push([body, 1]) });
}

export interface GundabadBat {
  creature: Creature;
  object: THREE.Group;
  /** the wing membranes (a separate translucent skinned mesh) */
  membranes: THREE.SkinnedMesh;
  readonly animations: string[];
  /** wingspan in metres */
  readonly span: number;
  pose(anim: string, t: number): void;
  /** world-space point between the talons (where a rider's hands go) */
  gripPoint(out: THREE.Vector3): THREE.Vector3;
  setCastShadow(v: boolean): void;
  dispose(): void;
}

export const BAT_ANIMATIONS = ['fly', 'carry', 'glide', 'swoop', 'screech', 'hit', 'death', 'perch'] as const;

/** one giant Gundabad bat. `scale` 1 ≈ 6.9 m wingspan. Geometry is shared per (seed, scale). */
export function createGundabadBat(seed = 0, scale = 1): GundabadBat {
  const s = RIG_SCALE * scale;
  const { rig, wing } = batRig(s);
  const P = (n: string, dx = 0, dy = 0, dz = 0): V3 => rig.at(n, dx * s, dy * s, dz * s);
  const key = `gundabad_bat_${scale}`;
  const c = buildCreature({
    key,
    seed,
    rig,
    sculpt: (sc) => {
      const fur = surface('fur', { rough: 0.9 });
      const hide = surface('skin_weathered', { rough: 0.62, skin: 0.5, pat: { wrinkles: 1.2, pores: 0.8 } });
      const pink = surface('skin', { rough: 0.45, skin: 0.8 });
      sc.with({ mat: fur, color: 0x3f342d, color2: 0x2a211c, colorNoise: 0.45, colorFreq: 7 / s }, () => {
        // body: deep chest (flight muscles), tapering to narrow hips
        sc.ellipsoid(P('body', 0, 0.0, 0.02), [0.21 * s, 0.18 * s, 0.26 * s], { bone: 'body', k: 0.06 * s });
        sc.ellipsoid(P('body', 0, -0.03, -0.22), [0.15 * s, 0.14 * s, 0.24 * s], { bone: 'body', bone2: 'hips', blend: [0.3, 0.9], blendAxis: [P('body'), P('hips')], k: 0.08 * s });
        sc.cone(P('hips', 0, -0.01, 0), P('tail', 0, 0, -0.02), 0.08 * s, 0.03 * s, { bone: 'hips', k: 0.05 * s });
        // keel / pectoral mass under the chest
        sc.ellipsoid(P('body', 0, -0.1, 0.08), [0.13 * s, 0.09 * s, 0.17 * s], { bone: 'body', k: 0.06 * s });
        // shoulders where the wings attach
        sc.mirrored(() => sc.ellipsoid(P('hum_l', -0.03, 0, 0), [0.1 * s, 0.09 * s, 0.11 * s], { bone: 'body', k: 0.06 * s }));
      });
      // bare, wrinkled, scarred neck and head (rat-like): grey-brown leathery hide
      sc.with({ mat: hide, color: 0x5b4c44, color2: 0x3e322c, colorNoise: 0.5, colorFreq: 14 / s, noise: { amp: 0.004 * s, freq: 30 / s, type: 'ridged' } }, () => {
        sc.cone(P('body', 0, 0.03, 0.18), P('head', 0, -0.02, -0.06), 0.12 * s, 0.085 * s, { bone: 'neck', bone2: 'head', blend: [0.6, 1], k: 0.06 * s });
        // long low skull
        sc.ellipsoid(P('head', 0, 0.025, -0.01), [0.1 * s, 0.09 * s, 0.14 * s], { bone: 'head', k: 0.04 * s });
        // brow ridges over small deep-set eyes
        sc.mirrored(() => sc.ellipsoid(P('head', 0.05, 0.06, 0.07), [0.035 * s, 0.022 * s, 0.05 * s], { bone: 'head', k: 0.03 * s }));
        // tapering muzzle
        sc.cone(P('head', 0, 0.0, 0.06), P('head', 0, -0.035, 0.27), 0.075 * s, 0.032 * s, { bone: 'head', k: 0.045 * s });
        // upper lip / whisker pads
        sc.mirrored(() => sc.ellipsoid(P('head', 0.035, -0.04, 0.2), [0.03 * s, 0.025 * s, 0.06 * s], { bone: 'head', k: 0.025 * s }));
        // lower jaw
        sc.cone(P('jaw', 0, 0.0, -0.08), P('jaw', 0, -0.025, 0.15), 0.055 * s, 0.022 * s, { bone: 'jaw', k: 0.03 * s });
        // cheek muscles
        sc.mirrored(() => sc.ellipsoid(P('head', 0.07, -0.03, 0.02), [0.04 * s, 0.045 * s, 0.06 * s], { bone: 'head', k: 0.035 * s }));
      });
      // nose pad: pink-grey, split, with nostrils
      sc.ellipsoid(P('head', 0, -0.03, 0.285), [0.03 * s, 0.022 * s, 0.018 * s], { bone: 'head', mat: pink, color: 0x5a3a36, k: 0.015 * s });
      sc.mirrored(() => sc.sphere(P('head', 0.012, -0.028, 0.302), 0.007 * s, { bone: 'head', op: 'subtract', k: 0.004 * s }));
      // mouth line: carve between muzzle and jaw
      sc.ellipsoid(P('head', 0, -0.07, 0.17), [0.04 * s, 0.006 * s, 0.1 * s], { bone: 'head', op: 'subtract', k: 0.006 * s });
      // gums
      sc.ellipsoid(P('head', 0, -0.062, 0.16), [0.035 * s, 0.01 * s, 0.09 * s], { bone: 'head', op: 'paint', color: 0x5a2422, mat: pink, k: 0.01 * s });
      // eyes: small, glossy, faint milky sheen (cave dwellers)
      sc.mirrored(() => {
        sc.sphere(P('head', 0.055, 0.035, 0.1), 0.017 * s, { bone: 'head', mat: surface('eye', { rough: 0.04 }), color: 0x1a1412, k: 0.005 * s });
      });
      // ears: big, ribbed, tilted back
      sc.mirrored(() => {
        const rot: [number, number, number] = [-0.35, 0.35, -0.3];
        sc.ellipsoid(P('ear_l', 0.02, 0.085, -0.01), [0.026 * s, 0.15 * s, 0.085 * s], { bone: 'ear_l', mat: surface('membrane', { rough: 0.55 }), color: 0x4a3530, k: 0.03 * s, rot });
        sc.ellipsoid(P('ear_l', 0.035, 0.085, 0.01), [0.012 * s, 0.11 * s, 0.06 * s], { bone: 'ear_l', op: 'subtract', k: 0.01 * s, rot });
        sc.ellipsoid(P('ear_l', 0.032, 0.08, 0.005), [0.012 * s, 0.1 * s, 0.05 * s], { bone: 'ear_l', op: 'paint', color: 0x6a3a34, mat: pink, k: 0.02 * s, rot });
      });
      // legs: thin, sinewy, bare hide; big clawed feet
      sc.with({ mat: hide, color: 0x4a3c35 }, () => {
        sc.mirrored(() => {
          sc.cone(P('leg_l'), P('shin_l'), 0.055 * s, 0.035 * s, { bone: 'leg_l', k: 0.04 * s });
          sc.cone(P('shin_l'), P('foot_l'), 0.034 * s, 0.024 * s, { bone: 'shin_l', k: 0.025 * s });
          sc.ellipsoid(P('foot_l', 0, -0.025, 0.02), [0.035 * s, 0.03 * s, 0.05 * s], { bone: 'foot_l', k: 0.02 * s });
        });
      });
    },
    mesh: {
      res: 0.026 * s,
      regions: [{ min: P('head', -0.2, -0.16, -0.16), max: P('head', 0.2, 0.3, 0.34), res: 0.0095 * s, aoScale: 0.45 }],
      ao: { dist: 0.08 * s },
    },
    skinK: 0.05 * s,
    material: { detailScale: 1.1 * s, wrap: 0.5, scatterColor: 0xa04030 },
    extra: (ctx) => {
      const bony = surface('skin_weathered', { rough: 0.55, skin: 0.55 });
      const claw = surface('horn', { rough: 0.35 });
      const teeth = surface('teeth', { rough: 0.3 });
      for (const side of ['l', 'r'] as const) {
        const sx = side === 'l' ? 1 : -1;
        const m = (p: V3): V3 => [p[0] * sx, p[1], p[2]];
        const seg = (a: V3, b: V3, bone: string, r0: number, r1: number, bulb = 0.3) =>
          ctx.gear(limbSegment(r0 * s, r1 * s, 1, bulb, 7, 6), { bone: `${bone}_${side}`, color: 0x3a2c26, mat: bony, matrix: segmentMatrix(m(a), m(b)) });
        seg(wing.shoulder, wing.elbow, 'hum', 0.05, 0.034, 0.25);
        seg(wing.elbow, wing.wrist, 'arm', 0.034, 0.022, 0.35);
        wing.tips.forEach((tip, k) => seg(wing.wrist, tip, `f${k + 2}`, 0.016, 0.005, 0.5));
        // knuckle at the wrist + hooked thumb claw pointing forward
        ctx.gear(new THREE.SphereGeometry(0.03 * s, 8, 6), { bone: `hand_${side}`, color: 0x3a2c26, mat: bony, matrix: new THREE.Matrix4().makeTranslation(...m(wing.wrist)) });
        const thumbA = m(wing.wrist);
        const thumbB = m([wing.wrist[0] - 0.02 * s, wing.wrist[1] + 0.01 * s, wing.wrist[2] + 0.13 * s]);
        ctx.gear(limbSegment(0.014 * s, 0.009 * s, 1, 0.3, 6, 3), { bone: `hand_${side}`, color: 0x3a2c26, mat: bony, matrix: segmentMatrix(thumbA, thumbB) });
        const thumbC = m([wing.wrist[0] - 0.025 * s, wing.wrist[1] - 0.035 * s, wing.wrist[2] + 0.19 * s]);
        ctx.gear(new THREE.ConeGeometry(0.011 * s, 1, 6), { bone: `hand_${side}`, color: 0x18120e, mat: claw, matrix: segmentMatrix(thumbB, thumbC).multiply(new THREE.Matrix4().makeTranslation(0, 0.5, 0)) });
        // talons: five hooked claws per foot (two segments each, curling down and forward)
        const foot = rig.at(`foot_${side}`);
        for (let k = 0; k < 5; k++) {
          const a = (k - 2) * 0.32;
          const base: V3 = [foot[0] + Math.sin(a) * 0.03 * s, foot[1] - 0.035 * s, foot[2] + 0.04 * s + Math.cos(a) * 0.02 * s];
          const mid: V3 = [base[0] + Math.sin(a) * 0.035 * s, base[1] - 0.01 * s, base[2] + Math.cos(a) * 0.05 * s];
          const tip: V3 = [mid[0] + Math.sin(a) * 0.012 * s, mid[1] - 0.05 * s, mid[2] + 0.02 * s];
          ctx.gear(limbSegment(0.011 * s, 0.008 * s, 1, 0.2, 6, 3), { bone: `foot_${side}`, color: 0x3e302a, mat: bony, matrix: segmentMatrix(base, mid) });
          ctx.gear(new THREE.ConeGeometry(0.009 * s, 1, 6), { bone: `foot_${side}`, color: 0x15100c, mat: claw, matrix: segmentMatrix(mid, tip).multiply(new THREE.Matrix4().makeTranslation(0, 0.5, 0)) });
        }
        // needle teeth along the upper muzzle and the lower jaw, two long fangs
        for (let k = 0; k < 6; k++) {
          const z = 0.24 - k * 0.028;
          const x = 0.018 + k * 0.004;
          const up = rig.at('head', sx * x * s, -0.062 * s, z * s);
          ctx.gear(new THREE.ConeGeometry(0.0045 * s, 1, 5), { bone: 'head', color: 0xcfc4a8, mat: teeth, matrix: segmentMatrix(up, [up[0], up[1] - (k === 1 ? 0.06 : 0.022) * s, up[2] + 0.003 * s]).multiply(new THREE.Matrix4().makeTranslation(0, 0.5, 0)) });
          const lo = rig.at('jaw', sx * (x - 0.004) * s, -0.006 * s, (z - 0.09) * s);
          ctx.gear(new THREE.ConeGeometry(0.004 * s, 1, 5), { bone: 'jaw', color: 0xc8bea2, mat: teeth, matrix: segmentMatrix(lo, [lo[0], lo[1] + (k === 0 ? 0.045 : 0.018) * s, lo[2] + 0.002 * s]).multiply(new THREE.Matrix4().makeTranslation(0, 0.5, 0)) });
        }
        // whiskers
        for (let k = 0; k < 4; k++) {
          const a = rig.at('head', sx * 0.05 * s, (-0.03 + k * 0.008) * s, 0.21 * s);
          const b: V3 = [a[0] + sx * (0.13 + k * 0.02) * s, a[1] + (0.02 - k * 0.025) * s, a[2] - 0.04 * s];
          ctx.gear(new THREE.ConeGeometry(0.0022 * s, 1, 3), { bone: 'head', color: 0x2a221e, mat: 'hair', matrix: segmentMatrix(a, b).multiply(new THREE.Matrix4().makeTranslation(0, 0.5, 0)) });
        }
        // ear ribs
        for (let k = 0; k < 3; k++) {
          const e = rig.at(`ear_${side}`);
          const a: V3 = [e[0] + sx * 0.015 * s, e[1] + 0.03 * s, e[2] - 0.02 * s + k * 0.03 * s];
          const b: V3 = [a[0] + sx * 0.05 * s, a[1] + 0.13 * s, a[2] - 0.06 * s];
          ctx.gear(limbSegment(0.004 * s, 0.002 * s, 1, 0, 4, 2), { bone: `ear_${side}`, color: 0x3a2a26, mat: bony, matrix: segmentMatrix(a, b) });
        }
      }
    },
    hair: (r) => batFur(r, s, seed),
    hairMaterial: { roughness: 0.85, anisotropy: 0.3, sheen: 0.25, sheenColor: 0x3d322b, alphaTest: 0.4 },
    bounds: 4.2 * s,
  });

  // the membranes: a second skinned mesh on the same skeleton, translucent material
  const memGeo = cached(`gundabad_bat_membrane_geo_${scale}_${seed}`, () => {
    const a = membrane(rig, wing, 'l', seed);
    const b = membrane(rig, wing, 'r', seed);
    const g = mergeGeometries([a, b]);
    a.dispose();
    b.dispose();
    g.userData.shared = true;
    return g;
  });
  const membranes = makeSkinnedMesh(memGeo, membraneMaterial(), c.rig, 4.2 * s, [0, 1.2 * s, 0]);
  membranes.name = 'membranes';
  c.root.add(membranes);
  c.body.castShadow = true;

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

  const pose = (anim: string, t: number) => {
    ps.reset();
    let amp = 1;
    // a 7 m bat beats slowly: ~0.9 Hz cruising, faster and deeper when laden
    let phase = t * 0.9;
    let fold = 0;
    let legPitch = 0.85;
    let legSpread = 0.1;
    let footCurl = 0.6;
    let headPitch = 0.05;
    let jaw = 0.06;
    let bodyRoll = Math.sin(t * 0.5) * 0.05;
    let bodyPitch = -0.1;
    switch (anim) {
      case 'carry':
        phase = t * 1.05;
        amp = 1.12;
        legPitch = -0.15; // legs hang straight down under the load
        legSpread = 0.05;
        footCurl = 1.25; // talons clenched around the rider's hands
        bodyPitch = -0.22;
        headPitch = 0.12;
        break;
      case 'glide':
        amp = 0.14;
        phase = 0.12 + Math.sin(t * 0.8) * 0.03;
        bodyRoll = Math.sin(t * 0.4) * 0.12;
        break;
      case 'swoop':
        amp = 0.12;
        phase = 0.1;
        fold = 0.45; // wings half folded for the dive
        legPitch = -0.9; // talons thrown forward
        legSpread = 0.25;
        footCurl = 0.1;
        headPitch = -0.15;
        jaw = 0.45 + Math.sin(t * 24) * 0.06;
        bodyPitch = 0.25;
        break;
      case 'screech':
        headPitch = -0.35;
        jaw = 0.62 + Math.sin(t * 30) * 0.05;
        phase = t * 0.95;
        break;
      case 'hit':
        phase = 0.35 + Math.sin(t * 9) * 0.05;
        amp = 0.8;
        headPitch = -0.3;
        jaw = 0.5;
        bodyRoll = Math.sin(t * 7) * 0.25;
        break;
      case 'death': {
        const k = Math.min(1, t / 0.8);
        amp = 0.3 * (1 - k);
        phase = t * 2.4;
        fold = 0.3 + 0.5 * k + Math.sin(t * 5) * 0.08;
        jaw = 0.5;
        headPitch = 0.5 * k;
        legPitch = -0.4;
        footCurl = 1.4;
        bodyRoll = t * 3.2; // tumbling
        bodyPitch = 0.6 * k;
        break;
      }
      case 'perch':
        amp = 0;
        fold = 1;
        break;
      default:
        break;
    }
    wingFlap(phase, amp, ws);
    ps.offset[I('body')].set(0, ws.bob * s, 0);
    ps.euler(I('body'), bodyPitch + Math.sin(phase * Math.PI * 2) * 0.04 * amp, 0, bodyRoll);
    ps.euler(I('neck'), 0.1 + Math.sin(phase * Math.PI * 2 + 1) * 0.03 * amp, 0, 0);
    ps.euler(I('head'), headPitch, Math.sin(t * 0.7) * 0.15, 0);
    ps.euler(I('jaw'), jaw, 0, 0);
    ps.euler(I('tail'), 0.15 + Math.sin(phase * Math.PI * 2) * 0.1 * amp, 0, 0);
    for (const side of ['l', 'r'] as const) {
      const sx = side === 'l' ? 1 : -1;
      // shoulder elevation about the forward axis, sweep about Y
      const elev = ws.shoulder * (1 - fold) - fold * 1.2;
      q.setFromAxisAngle(Z, sx * elev);
      q2.setFromAxisAngle(Y, sx * (ws.sweep - fold * 0.6));
      ps.local[I(`hum_${side}`)].copy(q2).multiply(q);
      ps.local[I(`arm_${side}`)].setFromAxisAngle(Y, sx * (ws.elbowFold * 0.9 + fold * 2.2));
      ps.local[I(`hand_${side}`)].setFromAxisAngle(Y, -sx * (ws.wristFold * 0.6 + fold * 2.6));
      for (let k = 2; k <= 5; k++) ps.local[I(`f${k}_${side}`)].setFromAxisAngle(Y, -sx * (ws.wristFold + fold) * (k - 2) * 0.12);
      ps.euler(I(`ear_${side}`), Math.sin(t * 2 + sx) * 0.05 - (anim === 'swoop' ? 0.4 : 0), 0, 0);
      ps.euler(I(`leg_${side}`), legPitch - ws.bob * 2, 0, sx * legSpread);
      ps.euler(I(`shin_${side}`), anim === 'carry' ? 0.05 : 0.25, 0, 0);
      ps.euler(I(`foot_${side}`), footCurl, 0, 0);
    }
    c.update(1 / 60);
  };

  const bat: GundabadBat = {
    creature: c,
    object: c.root,
    membranes,
    animations: [...BAT_ANIMATIONS],
    span: BAT_SPAN * scale,
    pose,
    gripPoint(out) {
      footL.getWorldPosition(_a);
      footR.getWorldPosition(_b);
      return out.copy(_a).add(_b).multiplyScalar(0.5);
    },
    setCastShadow(v) {
      c.body.castShadow = v;
      membranes.castShadow = v;
      if (c.hair) c.hair.castShadow = false;
    },
    dispose() {
      c.dispose();
      membranes.removeFromParent();
    },
  };
  if (c.hair) c.hair.castShadow = false;
  pose('fly', 0);
  return bat;
}
