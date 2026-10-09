/**
 * The Fell Beast (the winged steeds of the Nazgul). Built with the creature kit, seen mostly as a
 * black silhouette wheeling against the burning sky, but modelled to hold up when one dives low:
 *
 *  - ~22 m wingspan at scale 1, a 6 m body on a 4 m serpentine neck (six neck bones, an S-curve) and a
 *    5 m whip tail. Dark scaled hide with ridged wrinkles, a bare vulture-like head with a heavy
 *    brow, a hooked beak with a hinged lower jaw and rows of teeth, a bony crest, and hanging talons.
 *  - wings: rigid bone segments (arm, four long fingers with hooked claws) under a SEPARATE skinned
 *    membrane sheet with a scalloped trailing edge, veins and tears, and the thin-membrane
 *    translucency of the Gundabad bat (the red sky glows through it when the wing is backlit).
 *  - the Nazgul: a hooded rider on the base of the neck, black cloak streaming behind on its own
 *    bones (it flutters with the flight), a crown of spikes under the hood.
 *  - animations (deterministic in t): fly, glide, swoop (dive: wings half folded, neck out, talons
 *    forward), screech, hit, death (tumbling), perch.
 *
 * `FellBeast` (below) is the Combatant: an enemy with hit zones (head, neck, rider, body, wings).
 * Its flight is scripted from outside; it only animates and reacts to damage.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  RigDef, buildCreature, wingFlap, sheetGeometry, surface, createCreatureMaterial, makeSkinnedMesh, cached, type Creature, type V3, type WingSample,
} from './kit';
import { limbSegment, segmentMatrix } from './kit/geometry';
import { BaseCombatant, ZONE_MULT } from '../actors/combatant';
import type { DamageInfo, LevelAPI } from '../core/types';

/** wingspan at scale 1 (m) */
export const FELL_SPAN = 22;

export const FELL_ANIMATIONS = ['fly', 'glide', 'swoop', 'screech', 'hit', 'death', 'perch'] as const;

interface WingRest {
  shoulder: V3;
  elbow: V3;
  wrist: V3;
  tips: V3[];
  hip: V3;
}

export function fellRig(s: number) {
  const r = new RigDef();
  const P = (x: number, y: number, z: number): V3 => [x * s, y * s, z * s];
  r.bone('root', null, [0, 0, 0]);
  r.bone('body', 'root', P(0, 3.4, 0));
  r.bone('hips', 'body', P(0, 3.2, -1.9));
  r.bone('tail1', 'hips', P(0, 3.1, -3.1));
  r.bone('tail2', 'tail1', P(0, 3.0, -4.6));
  r.bone('tail3', 'tail2', P(0, 2.95, -6.2));
  r.bone('tail4', 'tail3', P(0, 3.0, -7.8));
  // the neck rises in an S and the head hangs forward
  r.bone('neck1', 'body', P(0, 3.8, 1.8));
  r.bone('neck2', 'neck1', P(0, 4.5, 2.9));
  r.bone('neck3', 'neck2', P(0, 5.2, 3.9));
  r.bone('neck4', 'neck3', P(0, 5.7, 5.0));
  r.bone('neck5', 'neck4', P(0, 5.85, 6.1));
  r.bone('head', 'neck5', P(0, 5.8, 7.0));
  r.bone('jaw', 'head', P(0, 5.62, 7.55));
  // the rider sits where the neck leaves the back
  r.bone('rider', 'body', P(0, 4.45, 1.45));
  r.bone('cloak1', 'rider', P(0, 4.5, 0.85));
  r.bone('cloak2', 'cloak1', P(0, 4.3, 0.1));
  r.bone('cloak3', 'cloak2', P(0, 4.1, -0.7));
  const w: WingRest = {
    shoulder: [1.0 * s, 4.1 * s, 0.9 * s],
    elbow: [4.6 * s, 4.7 * s, -0.4 * s],
    wrist: [8.7 * s, 4.8 * s, 1.1 * s],
    tips: [
      [11.4 * s, 4.4 * s, 0.7 * s],
      [10.6 * s, 3.9 * s, -2.7 * s],
      [8.8 * s, 3.5 * s, -4.5 * s],
      [6.4 * s, 3.3 * s, -4.9 * s],
    ],
    hip: [1.0 * s, 3.4 * s, -2.1 * s],
  };
  r.pair('hum_l', 'body', w.shoulder);
  r.pair('arm_l', 'hum_l', w.elbow);
  r.pair('hand_l', 'arm_l', w.wrist);
  for (let k = 0; k < 4; k++) r.pair(`f${k + 2}_l`, 'hand_l', [w.wrist[0] + 0.001 * k, w.wrist[1], w.wrist[2]]);
  r.pair('leg_l', 'hips', P(0.85, 3.0, -1.5));
  r.pair('shin_l', 'leg_l', P(1.0, 1.95, -1.3));
  r.pair('foot_l', 'shin_l', P(1.1, 0.7, -1.05));
  return { rig: r, wing: w };
}

const lerp3 = (a: V3, b: V3, t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

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

/** one wing membrane as a skinned sheet with a scalloped trailing edge, veins and tears */
function membrane(r: RigDef, w: WingRest, side: 'l' | 'r', s: number) {
  const sx = side === 'l' ? 1 : -1;
  const m = (p: V3): V3 => [p[0] * sx, p[1], p[2]];
  const cols = 30;
  const rows = 11;
  const scal = (a: V3, b: V3, k: number): V3 => lerp3(lerp3(a, b, 0.5), w.wrist, k);
  const t = w.tips;
  const trailPoly: V3[] = [w.hip, scal(w.hip, t[3], 0.12), t[3], scal(t[3], t[2], 0.2), t[2], scal(t[2], t[1], 0.2), t[1], scal(t[1], t[0], 0.14), t[0]];
  const lead = resample([w.shoulder, w.elbow, w.wrist, t[0]].map(m), cols);
  const trail = resample(trailPoly.map(m), cols);
  const grid: V3[][] = [];
  for (let rr = 0; rr < rows; rr++) {
    const v = rr / (rows - 1);
    const row: V3[] = [];
    for (let c = 0; c < cols; c++) {
      const p = lerp3(lead[c], trail[c], v);
      const u = c / (cols - 1);
      const sag = Math.sin(Math.PI * v) * (0.2 + 0.18 * u) * s * Math.min(1, u * 3);
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
    const seq: [number, number][] = [[hips, 0], [body, 0.1], [B('f5'), 0.3], [B('f4'), 0.52], [B('f3'), 0.74], [B('f2'), 1]];
    for (let i = 0; i + 1 < seq.length; i++) {
      if (u <= seq[i + 1][1]) {
        const k = (u - seq[i][1]) / (seq[i + 1][1] - seq[i][1]);
        return [[seq[i][0], 1 - k], [seq[i + 1][0], k]];
      }
    }
    return [[B('f2'), 1]];
  };
  const fingerU = [0.3, 0.52, 0.74];
  const colorAt = (u: number, v: number): number => {
    if (v > 0.94 || u > 0.975) return 0x120d0c;
    let vein = 0;
    for (const fu of fingerU) {
      const lineU = 0.52 + (fu - 0.52) * v;
      vein = Math.max(vein, Math.exp(-Math.pow((u - lineU) / 0.012, 2)) * Math.min(1, v * 4));
    }
    vein = Math.max(vein, 0.5 * Math.exp(-Math.pow(Math.sin(u * 52 + v * 11) / 0.08, 2)) * (0.3 + v * 0.7));
    // ragged tears near the trailing edge
    const tear = v > 0.75 && Math.sin(u * 90 + side.length * 3) > 0.93 ? 0.5 : 1;
    return new THREE.Color(0x231a18).lerp(new THREE.Color(0x0e0a09), vein * 0.85).multiplyScalar(tear).getHex();
  };
  return sheetGeometry({
    grid,
    color: 0x1e1614,
    colorAt,
    mat: surface('membrane', { rough: 0.6, skin: 0.9 }),
    ao: (u, v) => 0.7 + 0.3 * Math.min(1, u * 3) * (1 - v * 0.3),
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

/** the Nazgul's cloak: a long skinned ribbon streaming back from the shoulders */
function cloakSheet(r: RigDef, s: number) {
  const cols = 8;
  const rows = 7;
  const a = r.pos('rider');
  const grid: V3[][] = [];
  for (let rr = 0; rr < rows; rr++) {
    const v = rr / (rows - 1);
    const row: V3[] = [];
    for (let c = 0; c < cols; c++) {
      const u = c / (cols - 1);
      const x = (v - 0.5) * (0.9 + u * 1.7) * s;
      const y = a[1] + (0.55 - u * 1.25) * s - Math.abs(v - 0.5) * 0.35 * s * u;
      const z = a[2] - (0.1 + u * 2.7) * s;
      row.push([x, y, z]);
    }
    grid.push(row);
  }
  const c1 = r.boneIndex('cloak1');
  const c2 = r.boneIndex('cloak2');
  const c3 = r.boneIndex('cloak3');
  const rider = r.boneIndex('rider');
  return sheetGeometry({
    grid,
    color: 0x0a0809,
    colorAt: (u, v) => (u > 0.9 || v < 0.08 || v > 0.92 ? 0x050404 : 0x0c0a0b),
    mat: surface('wool', { rough: 0.95, sheen: 0.35 }),
    ao: (u) => 0.6 + 0.4 * u,
    weights: (_r, c, _p, out) => {
      const u = c / (cols - 1);
      if (u < 0.15) out.push([rider, 1]);
      else if (u < 0.45) out.push([c1, 1]);
      else if (u < 0.75) out.push([c2, 1]);
      else out.push([c3, 1]);
    },
  });
}

function membraneMaterial(): THREE.MeshPhysicalMaterial {
  return cached('fellbeast_membrane_mat', () => {
    const mat = createCreatureMaterial({ side: THREE.DoubleSide, detailScale: 3, wrap: 0.7, scatterColor: 0x9a2a1a });
    const base = mat.onBeforeCompile;
    const trans = { transColor: { value: new THREE.Color(0xc4482a) }, transAmount: { value: 1.35 } };
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
    mat.customProgramCacheKey = () => 'kit-creature-v3-fellmembrane';
    mat.userData.shared = true;
    return mat;
  });
}

export interface FellBeastModel {
  creature: Creature;
  object: THREE.Group;
  /** the wing membranes (a separate translucent skinned mesh) */
  membranes: THREE.SkinnedMesh;
  readonly animations: string[];
  readonly span: number;
  /** -1..1 roll into a turn (lowers the inside wing in 'glide') */
  bank: number;
  pose(anim: string, t: number): void;
  setCastShadow(v: boolean): void;
  dispose(): void;
}

/** one Fell Beast with its Nazgul. `scale` 1 ≈ 22 m wingspan. */
export function createFellBeast(seed = 0, scale = 1, rider = true): FellBeastModel {
  const s = scale;
  const { rig, wing } = fellRig(s);
  const P = (n: string, dx = 0, dy = 0, dz = 0): V3 => rig.at(n, dx * s, dy * s, dz * s);
  const key = `fell_beast_${scale}_${rider ? 'r' : 'n'}`;
  const hide = surface('scales', { rough: 0.6, pat: { scales: 0.8, wrinkles: 0.9 } });
  const skinBare = surface('skin_troll', { rough: 0.7, pat: { wrinkles: 1.4, pores: 0.8 } });
  const c = buildCreature({
    key,
    seed: 0, // the sculpt does not vary by seed: every beast shares one geometry (and one meshing)
    rig,
    sculpt: (sc) => {
      sc.with({ mat: hide, color: 0x1d1d1b, color2: 0x2e2c28, colorNoise: 0.5, colorFreq: 3 / s, noise: { amp: 0.03 * s, freq: 7 / s, type: 'ridged' } }, () => {
        // torso: deep chest, narrowing to the hips
        sc.ellipsoid(P('body', 0, 0, 0.1), [1.05 * s, 1.0 * s, 1.95 * s], { bone: 'body', bone2: 'hips', blend: [0.4, 1], blendAxis: [P('body'), P('hips')], k: 0.35 * s });
        sc.ellipsoid(P('body', 0, 0.05, 0.9), [1.0 * s, 0.95 * s, 1.1 * s], { bone: 'body', k: 0.3 * s });
        sc.ellipsoid(P('hips', 0, -0.1, -0.2), [0.8 * s, 0.75 * s, 1.1 * s], { bone: 'hips', k: 0.3 * s });
        // shoulders and flight muscle
        sc.mirrored(() => sc.ellipsoid(P('hum_l', -0.2, -0.2, -0.1), [0.65 * s, 0.6 * s, 0.8 * s], { bone: 'hum_l', k: 0.25 * s }));
        // the tail: four tapering segments ending in a spade
        sc.tube([P('hips', 0, 0, -0.4), P('tail1'), P('tail2'), P('tail3'), P('tail4')], [0.62 * s, 0.42 * s, 0.28 * s, 0.17 * s, 0.07 * s], { bone: 'tail1', bone2: 'tail3', blend: [0.3, 1], blendAxis: [P('tail1'), P('tail3')], k: 0.2 * s });
        // the neck: six overlapping cones, thick at the base
        sc.cone(P('neck1', 0, -0.1, -0.6), P('neck2'), 0.78 * s, 0.56 * s, { bone: 'neck1', bone2: 'neck2', blend: [0.4, 1], k: 0.22 * s });
        sc.cone(P('neck2'), P('neck3'), 0.56 * s, 0.44 * s, { bone: 'neck2', bone2: 'neck3', blend: [0.4, 1], k: 0.18 * s });
        sc.cone(P('neck3'), P('neck4'), 0.44 * s, 0.37 * s, { bone: 'neck3', bone2: 'neck4', blend: [0.4, 1], k: 0.16 * s });
        sc.cone(P('neck4'), P('neck5'), 0.37 * s, 0.32 * s, { bone: 'neck4', bone2: 'neck5', blend: [0.4, 1], k: 0.14 * s });
        sc.cone(P('neck5'), P('head', 0, -0.05, -0.25), 0.32 * s, 0.3 * s, { bone: 'neck5', bone2: 'head', blend: [0.5, 1], k: 0.12 * s });
        // dorsal ridge along the neck
        for (const n of ['neck2', 'neck3', 'neck4', 'neck5']) sc.cone(P(n, 0, 0.35, 0), P(n, 0, 0.8, -0.3), 0.14 * s, 0.01 * s, { bone: n, k: 0.05 * s, mat: surface('horn', { rough: 0.5 }), color: 0x3a342e });
        // thighs
        sc.mirrored(() => {
          sc.ellipsoid(P('leg_l', 0, -0.4, 0.05), [0.5 * s, 0.95 * s, 0.6 * s], { bone: 'leg_l', bone2: 'shin_l', blend: [0.2, 0.9], blendAxis: [P('leg_l'), P('shin_l')], k: 0.2 * s });
          sc.cone(P('shin_l'), P('foot_l'), 0.3 * s, 0.17 * s, { bone: 'shin_l', bone2: 'foot_l', blend: [0.5, 1], k: 0.1 * s });
          sc.ellipsoid(P('foot_l', 0, -0.12, 0.2), [0.25 * s, 0.17 * s, 0.4 * s], { bone: 'foot_l', k: 0.1 * s });
        });
      });
      // the head: bare, grey-black, vulture-boned, with a hooked beak
      sc.with({ mat: skinBare, color: 0x2c2b28, color2: 0x1a1a18, colorNoise: 0.5, colorFreq: 8 / s, noise: { amp: 0.014 * s, freq: 22 / s, type: 'ridged' } }, () => {
        sc.ellipsoid(P('head', 0, 0.06, 0.0), [0.34 * s, 0.34 * s, 0.5 * s], { bone: 'head', k: 0.1 * s });
        sc.mirrored(() => sc.ellipsoid(P('head', 0.2, 0.24, 0.2), [0.14 * s, 0.1 * s, 0.26 * s], { bone: 'head', k: 0.08 * s, rot: [0, 0, 0.5] }));
        // long snout, hooked at the tip
        sc.tube([P('head', 0, 0.02, 0.3), P('head', 0, -0.02, 0.62), P('head', 0, -0.08, 0.9), P('head', 0, -0.26, 1.04)], [0.26 * s, 0.2 * s, 0.14 * s, 0.03 * s], { bone: 'head', k: 0.08 * s });
        // lower jaw
        sc.tube([P('jaw', 0, 0.0, -0.3), P('jaw', 0, -0.04, 0.2), P('jaw', 0, -0.1, 0.55)], [0.19 * s, 0.13 * s, 0.04 * s], { bone: 'jaw', k: 0.05 * s });
        // mouth line and nostrils
        sc.ellipsoid(P('head', 0, -0.12, 0.65), [0.15 * s, 0.015 * s, 0.4 * s], { bone: 'head', op: 'subtract', k: 0.015 * s });
        sc.mirrored(() => sc.sphere(P('head', 0.07, 0.04, 0.82), 0.025 * s, { bone: 'head', op: 'subtract', k: 0.01 * s }));
        // sunken eye sockets
        sc.mirrored(() => sc.sphere(P('head', 0.28, 0.14, 0.22), 0.1 * s, { bone: 'head', op: 'subtract', k: 0.03 * s }));
      });
      // eyes: small, cold, a ghost of yellow
      sc.mirrored(() => sc.sphere(P('head', 0.26, 0.14, 0.22), 0.065 * s, { bone: 'head', mat: surface('eye', { rough: 0.05 }), color: 0xb89a30, k: 0.01 * s }));
      if (rider) {
        // the Nazgul: black robes over a hunched torso, a deep hood
        const cloth = surface('wool', { rough: 0.95, sheen: 0.3 });
        sc.with({ mat: cloth, color: 0x0b090a, color2: 0x151213, colorNoise: 0.4, colorFreq: 6 / s }, () => {
          sc.cone(P('rider', 0, -0.2, 0.15), P('rider', 0, 1.35, 0.2), 0.78 * s, 0.38 * s, { bone: 'rider', k: 0.2 * s });
          sc.ellipsoid(P('rider', 0, 1.5, 0.3), [0.4 * s, 0.34 * s, 0.4 * s], { bone: 'rider', k: 0.1 * s });
          sc.mirrored(() => sc.capsule(P('rider', 0.38, 1.2, 0.2), P('rider', 0.52, 0.75, 0.82), 0.14 * s, { bone: 'rider', k: 0.06 * s }));
        });
        // the hollow under the hood
        sc.sphere(P('rider', 0, 1.5, 0.58), 0.2 * s, { bone: 'rider', op: 'subtract', k: 0.05 * s });
      }
    },
    mesh: {
      res: 0.15 * s,
      regions: [{ min: P('head', -0.6, -0.6, -0.7), max: P('head', 0.6, 0.6, 1.3), res: 0.04 * s, aoScale: 0.5 }],
      ao: { dist: 0.3 * s },
    },
    skinK: 0.2 * s,
    material: { detailScale: 4 * s, wrap: 0.3, scatterColor: 0x40302a },
    extra: (ctx) => {
      const bony = surface('skin_troll', { rough: 0.6, pat: { wrinkles: 1.2 } });
      const claw = surface('horn', { rough: 0.32 });
      const teeth = surface('teeth', { rough: 0.3 });
      for (const side of ['l', 'r'] as const) {
        const sx = side === 'l' ? 1 : -1;
        const m = (p: V3): V3 => [p[0] * sx, p[1], p[2]];
        const seg = (a: V3, b: V3, bone: string, r0: number, r1: number, bulb = 0.3) =>
          ctx.gear(limbSegment(r0 * s, r1 * s, 1, bulb, 8, 6), { bone: `${bone}_${side}`, color: 0x2a2724, mat: bony, matrix: segmentMatrix(m(a), m(b)) });
        seg(wing.shoulder, wing.elbow, 'hum', 0.3, 0.2, 0.25);
        seg(wing.elbow, wing.wrist, 'arm', 0.2, 0.13, 0.35);
        wing.tips.forEach((tip, k) => seg(wing.wrist, tip, `f${k + 2}`, 0.1, 0.025, 0.5));
        // wing-thumb claw at the wrist, hooked forward
        const tA = m(wing.wrist);
        const tB = m([wing.wrist[0] - 0.1 * s, wing.wrist[1] + 0.05 * s, wing.wrist[2] + 0.8 * s]);
        ctx.gear(limbSegment(0.07 * s, 0.04 * s, 1, 0.3, 6, 3), { bone: `hand_${side}`, color: 0x2a2724, mat: bony, matrix: segmentMatrix(tA, tB) });
        ctx.gear(new THREE.ConeGeometry(0.05 * s, 1, 6), { bone: `hand_${side}`, color: 0x15110d, mat: claw, matrix: segmentMatrix(tB, m([wing.wrist[0] - 0.12 * s, wing.wrist[1] - 0.25 * s, wing.wrist[2] + 1.2 * s])).multiply(new THREE.Matrix4().makeTranslation(0, 0.5, 0)) });
        // talons: four hooked claws per foot
        const foot = rig.at(`foot_${side}`);
        for (let k = 0; k < 4; k++) {
          const a = (k - 1.5) * 0.4;
          const base: V3 = [foot[0] + Math.sin(a) * 0.12 * s, foot[1] - 0.15 * s, foot[2] + 0.25 * s];
          const mid: V3 = [base[0] + Math.sin(a) * 0.2 * s, base[1] - 0.08 * s, base[2] + Math.cos(a) * 0.45 * s * (k === 3 ? -0.4 : 1)];
          const tip: V3 = [mid[0] + Math.sin(a) * 0.06 * s, mid[1] - 0.4 * s, mid[2] + 0.1 * s];
          ctx.gear(limbSegment(0.07 * s, 0.045 * s, 1, 0.2, 6, 3), { bone: `foot_${side}`, color: 0x2c2926, mat: bony, matrix: segmentMatrix(base, mid) });
          ctx.gear(new THREE.ConeGeometry(0.045 * s, 1, 6), { bone: `foot_${side}`, color: 0x15110d, mat: claw, matrix: segmentMatrix(mid, tip).multiply(new THREE.Matrix4().makeTranslation(0, 0.5, 0)) });
        }
        // teeth along the snout and the lower jaw
        for (let k = 0; k < 7; k++) {
          const z = 0.34 + k * 0.09;
          const x = 0.1 - k * 0.006;
          const up = rig.at('head', sx * x * s, -0.1 * s, z * s);
          ctx.gear(new THREE.ConeGeometry(0.014 * s, 1, 5), { bone: 'head', color: 0xcfc4a8, mat: teeth, matrix: segmentMatrix(up, [up[0], up[1] - (k === 2 ? 0.2 : 0.1) * s, up[2] + 0.01 * s]).multiply(new THREE.Matrix4().makeTranslation(0, 0.5, 0)) });
          const lo = rig.at('jaw', sx * (x - 0.02) * s, 0.0, (z - 0.25) * s);
          ctx.gear(new THREE.ConeGeometry(0.012 * s, 1, 5), { bone: 'jaw', color: 0xc4b89a, mat: teeth, matrix: segmentMatrix(lo, [lo[0], lo[1] + 0.1 * s, lo[2] + 0.01 * s]).multiply(new THREE.Matrix4().makeTranslation(0, 0.5, 0)) });
        }
      }
      // a crest of bone spikes sweeping back from the brow
      for (let k = 0; k < 5; k++) {
        const a = rig.at('head', 0, (0.34 - k * 0.02) * s, (0.15 - k * 0.14) * s);
        const b: V3 = [a[0], a[1] + (0.34 - k * 0.04) * s, a[2] - (0.3 + k * 0.06) * s];
        ctx.gear(new THREE.ConeGeometry(0.075 * s, 1, 6), { bone: 'head', color: 0x3a342c, mat: surface('horn', { rough: 0.5 }), matrix: segmentMatrix(a, b).multiply(new THREE.Matrix4().makeTranslation(0, 0.5, 0)) });
      }
      for (const sd of [-1, 1]) {
        const a = rig.at('head', sd * 0.3 * s, 0.18 * s, -0.1 * s);
        ctx.gear(new THREE.ConeGeometry(0.07 * s, 1, 6), { bone: 'head', color: 0x3a342c, mat: surface('horn', { rough: 0.5 }), matrix: segmentMatrix(a, [a[0] + sd * 0.5 * s, a[1] + 0.2 * s, a[2] - 0.7 * s]).multiply(new THREE.Matrix4().makeTranslation(0, 0.5, 0)) });
      }
      // the tail spade
      const t4 = rig.at('tail4');
      ctx.gear(new THREE.ConeGeometry(0.3 * s, 1, 4), { bone: 'tail4', color: 0x2a2724, mat: bony, matrix: segmentMatrix([t4[0], t4[1], t4[2] + 0.5 * s], [t4[0], t4[1] - 0.05 * s, t4[2] - 1.4 * s]).multiply(new THREE.Matrix4().makeTranslation(0, 0.5, 0)) });
      if (rider) {
        // the Nazgul's crown of black spikes and the long blade on his hip
        const r0 = rig.at('rider', 0, 1.74 * s, 0.3 * s);
        for (let k = 0; k < 5; k++) {
          const a = (k - 2) * 0.5;
          const b: V3 = [r0[0] + Math.sin(a) * 0.22 * s, r0[1] + 0.34 * s, r0[2] + Math.cos(a) * 0.1 * s];
          ctx.gear(new THREE.ConeGeometry(0.035 * s, 1, 4), { bone: 'rider', color: 0x2a2a2e, mat: surface('metal_dark', { rough: 0.4 }), matrix: segmentMatrix([r0[0] + Math.sin(a) * 0.17 * s, r0[1], r0[2]], b).multiply(new THREE.Matrix4().makeTranslation(0, 0.5, 0)) });
        }
        ctx.add(cloakSheet(rig, s));
      }
    },
    bounds: 12 * s,
  });

  // the membranes: a second skinned mesh on the same skeleton, translucent material
  const memGeo = cached(`fell_beast_membrane_geo_${scale}`, () => {
    const a = membrane(rig, wing, 'l', s);
    const b = membrane(rig, wing, 'r', s);
    const g = mergeGeometries([a, b]);
    a.dispose();
    b.dispose();
    g.userData.shared = true;
    return g;
  });
  const membranes = makeSkinnedMesh(memGeo, membraneMaterial(), c.rig, 12 * s, [0, 4 * s, 0]);
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
  const necks = ['neck1', 'neck2', 'neck3', 'neck4', 'neck5'];
  const tails = ['tail1', 'tail2', 'tail3', 'tail4'];

  const model: FellBeastModel = {
    creature: c,
    object: c.root,
    membranes,
    animations: [...FELL_ANIMATIONS],
    span: FELL_SPAN * scale,
    bank: 0,
    pose(anim: string, t: number) {
      ps.reset();
      let amp = 1;
      let phase = t * 0.4;
      let fold = 0;
      let bodyPitch = -0.08;
      let bodyRoll = Math.sin(t * 0.4) * 0.04;
      let neckCurl = 0.0; // + raises the head
      let headPitch = 0.1;
      let jaw = 0.05;
      let legPitch = 0.7;
      let footCurl = 0.7;
      let tailSwing = 0.18;
      let flap = true;
      switch (anim) {
        case 'glide':
          amp = 0.16;
          phase = 0.1 + Math.sin(t * 0.5) * 0.03;
          flap = false;
          break;
        case 'swoop':
          // the dive: wings half folded, neck stretched out, talons thrown forward, jaws open
          amp = 0.12;
          phase = 0.08;
          fold = 0.45;
          bodyPitch = 0.42;
          neckCurl = -0.5;
          headPitch = -0.4;
          jaw = 0.5 + Math.sin(t * 22) * 0.05;
          legPitch = -0.8;
          footCurl = 0.1;
          tailSwing = 0.05;
          flap = false;
          break;
        case 'screech':
          neckCurl = 0.6;
          headPitch = 0.6;
          jaw = 0.75 + Math.sin(t * 30) * 0.05;
          phase = t * 0.38;
          break;
        case 'hit':
          phase = 0.35 + Math.sin(t * 9) * 0.05;
          amp = 0.7;
          neckCurl = 0.4;
          headPitch = -0.3;
          jaw = 0.6;
          bodyRoll = Math.sin(t * 7) * 0.25;
          break;
        case 'death': {
          const k = Math.min(1, t / 1.0);
          amp = 0.3 * (1 - k);
          phase = t * 1.4;
          fold = 0.3 + 0.55 * k + Math.sin(t * 4) * 0.06;
          jaw = 0.6;
          neckCurl = 0.4 * k;
          legPitch = -0.3;
          footCurl = 1.2;
          bodyRoll = t * 2.4;
          bodyPitch = 0.6 * k;
          tailSwing = 0.5;
          break;
        }
        case 'perch':
          amp = 0;
          fold = 1;
          bodyPitch = -0.5;
          legPitch = -0.15;
          footCurl = 0.3;
          neckCurl = 0.45;
          flap = false;
          break;
        default:
          break;
      }
      wingFlap(phase, amp, ws);
      if (flap) ps.offset[I('body')].set(0, -ws.bob * 14 * s, 0);
      ps.euler(I('body'), bodyPitch + Math.sin(phase * Math.PI * 2) * 0.035 * amp, 0, bodyRoll);
      // the neck: an S-curve that ripples slowly; the head counter-rotates to stay level
      necks.forEach((n, k) => {
        const wave = Math.sin(t * 0.9 - k * 0.7) * 0.05;
        ps.euler(I(n), (k === 0 ? 0.18 : -0.06) + neckCurl * (k === 0 ? 0.3 : 0.18) + wave, Math.sin(t * 0.6 - k * 0.5) * 0.05, 0);
      });
      ps.euler(I('head'), headPitch - neckCurl * 0.4, Math.sin(t * 0.5) * 0.12, 0);
      ps.euler(I('jaw'), jaw, 0, 0);
      tails.forEach((n, k) => ps.euler(I(n), Math.sin(phase * Math.PI * 2 - k * 0.7) * 0.07 * amp + 0.04, Math.sin(t * 0.8 - k * 0.9) * tailSwing * 0.5, 0));
      // the Nazgul's cloak streams back and flutters
      ps.euler(I('rider'), 0.06 + Math.sin(t * 0.8) * 0.02, 0, 0);
      ps.euler(I('cloak1'), 0.2 + Math.sin(t * 5.1) * 0.12, Math.sin(t * 3.7) * 0.1, 0);
      ps.euler(I('cloak2'), 0.12 + Math.sin(t * 6.3 + 1) * 0.16, Math.sin(t * 4.4 + 2) * 0.14, 0);
      ps.euler(I('cloak3'), 0.1 + Math.sin(t * 7.1 + 2) * 0.2, Math.sin(t * 5.2 + 4) * 0.2, 0);
      for (const side of ['l', 'r'] as const) {
        const sx = side === 'l' ? 1 : -1;
        const bankE = -sx * model.bank * 0.28;
        const elev = (ws.shoulder + bankE) * (1 - fold) - fold * 1.2;
        q.setFromAxisAngle(Z, sx * elev);
        q2.setFromAxisAngle(Y, sx * (ws.sweep - fold * 0.6));
        ps.local[I(`hum_${side}`)].copy(q2).multiply(q);
        ps.local[I(`arm_${side}`)].setFromAxisAngle(Y, sx * (ws.elbowFold * 0.9 + fold * 2.2));
        ps.local[I(`hand_${side}`)].setFromAxisAngle(Y, -sx * (ws.wristFold * 0.6 + fold * 2.6));
        for (let k = 2; k <= 5; k++) ps.local[I(`f${k}_${side}`)].setFromAxisAngle(Y, -sx * (ws.wristFold + fold) * (k - 2) * 0.12);
        ps.euler(I(`leg_${side}`), legPitch - ws.bob * 3, 0, sx * 0.08);
        ps.euler(I(`shin_${side}`), anim === 'swoop' ? -0.1 : 0.25, 0, 0);
        ps.euler(I(`foot_${side}`), footCurl, 0, 0);
      }
      c.update(1 / 60);
    },
    setCastShadow(v) {
      c.body.castShadow = v;
      membranes.castShadow = v;
    },
    dispose() {
      c.dispose();
      membranes.removeFromParent();
    },
  };
  model.pose('fly', 0);
  return model;
}

// ─────────────────────────────────────────────────────────────────────────────
// the Combatant
// ─────────────────────────────────────────────────────────────────────────────

/** hit zones for a fell beast: head, neck, rider, body, wings */
export function addFellZones(c: BaseCombatant, m: FellBeastModel, s: number, rider = true): void {
  const b = m.creature.rig.byName;
  c.addZoneSphere(b.head, 0.5 * s, 'head', ZONE_MULT.head, new THREE.Vector3(0, 0.05 * s, 0.25 * s));
  c.addZoneCapsule(b.neck1, b.neck3, 0.6 * s, 'body');
  c.addZoneCapsule(b.neck3, b.neck5, 0.42 * s, 'body');
  c.addZoneSphere(b.body, 1.2 * s, 'body', ZONE_MULT.body, new THREE.Vector3(0, 0, 0.2 * s));
  c.addZoneSphere(b.hips, 0.9 * s, 'body');
  if (rider) c.addZoneSphere(b.rider, 0.5 * s, 'weakpoint', 1.8, new THREE.Vector3(0, 1.0 * s, 0.25 * s));
  for (const side of ['l', 'r'] as const) {
    const sx = side === 'l' ? 1 : -1;
    c.addZoneCapsule(b[`hum_${side}`], b[`arm_${side}`], 0.34 * s, 'limb');
    c.addZoneCapsule(b[`arm_${side}`], b[`hand_${side}`], 0.28 * s, 'limb');
    c.addZoneCapsule(b[`f3_${side}`], b[`f3_${side}`], 1.3 * s, 'limb', ZONE_MULT.limb, new THREE.Vector3(0, 0, 0), new THREE.Vector3(sx * 1.6 * s, -0.4 * s, -2.8 * s));
    c.addZoneCapsule(b[`f2_${side}`], b[`f2_${side}`], 0.4 * s, 'limb', ZONE_MULT.limb, new THREE.Vector3(0, 0, 0), new THREE.Vector3(sx * 2.7 * s, -0.1 * s, -0.4 * s));
  }
}

export interface FellBeastOpts {
  seed?: number;
  scale?: number;
  hp?: number;
  rider?: boolean;
}

/**
 * A Fell Beast as a Combatant (enemy). It flies where its controller puts it (`object.position`,
 * `object.rotation`, `model.bank`) and plays the animation named by `anim`. Shot down, it
 * tumbles: `fallVy` carries it out of the sky; `onCrash` fires once when it hits the ground.
 */
export class FellBeast extends BaseCombatant {
  readonly model: FellBeastModel;
  readonly s: number;
  anim = 'fly';
  clock: number;
  rate = 1;
  /** damage flash / flinch (s) */
  private hitAnim = 0;
  private fallVy = 0;
  private landed = false;
  /** called once when the body hits the ground after being killed */
  onCrash: ((at: THREE.Vector3) => void) | null = null;
  /** called on every hit that lands */
  onHurt: ((d: DamageInfo, amount: number) => void) | null = null;
  /** the controller writes its real velocity here every frame: a kill keeps the momentum */
  readonly momentum = new THREE.Vector3();
  private level: LevelAPI | null;

  constructor(level: LevelAPI | null, o: FellBeastOpts = {}) {
    const s = o.scale ?? 0.6;
    super({ team: 'enemy', name: 'Fell Beast', maxHp: o.hp ?? 360, radius: 3.6 * s, height: 7 * s, bloodKind: 'black' });
    this.level = level;
    this.s = s;
    this.model = createFellBeast(o.seed ?? 0, s, o.rider ?? true);
    // the combatant's origin is the middle of the body, so pitch and roll turn about the centre of mass
    this.model.object.position.y = -3.4 * s;
    this.object.add(this.model.object);
    addFellZones(this, this.model, s, o.rider ?? true);
    this.aimBone = this.model.creature.rig.byName.body;
    this.clock = ((o.seed ?? 0) * 1.91) % 7;
    this.corpseTime = 40; // lies where it fell until `landed` shortens it
    this.flashColor = 0xff7a40;
    this.object.name = 'enemy:fell_beast';
    this.model.pose(this.anim, this.clock);
  }

  protected onDamaged(d: DamageInfo, amount: number): void {
    this.hitAnim = 0.4;
    this.level?.ctx.audio.play('bat_screech', { pos: this.position, volume: 1, pitch: 0.5 });
    this.onHurt?.(d, amount);
  }

  protected onDied(): void {
    this.level?.ctx.audio.play('bat_screech', { pos: this.position, volume: 1.2, pitch: 0.38 });
    this.velocity.copy(this.momentum).multiplyScalar(0.7);
    this.fallVy = Math.min(0, this.momentum.y * 0.7);
  }

  /** world point of the head (camera aims, arrow tests) */
  headPos(out: THREE.Vector3): THREE.Vector3 {
    return this.model.creature.rig.byName.head.getWorldPosition(out);
  }

  update(dt: number): void {
    if (dt <= 0) return;
    this.clock += dt * this.rate;
    if (!this.alive) {
      // tumble out of the sky until it hits the ground
      if (!this.landed) {
        const ctx = this.level?.ctx;
        this.fallVy -= 20 * dt;
        this.object.position.addScaledVector(this.velocity, dt);
        this.object.position.y += this.fallVy * dt;
        this.object.rotation.z += dt * 2.6;
        this.object.rotation.x = Math.min(1.2, this.object.rotation.x + dt * 0.9);
        const gy = ctx ? ctx.physics.heightAt(this.position.x, this.position.z) : 0;
        if (this.position.y <= gy + 1.2 * this.s || this.deathTime > 9) {
          this.landed = true;
          this.object.position.y = Math.max(this.position.y, gy + 1.0 * this.s);
          if (ctx) {
            ctx.fx.explosion(this.position, 1.6);
            ctx.fx.dust(this.position, 30, 0x4a3a30);
            ctx.player.camera.shake(0.4, 0.8);
            ctx.audio.play('explosion', { pos: this.position, volume: 1 });
          }
          this.corpseTime = this.deathTime + 3.5;
          this.onCrash?.(this.position);
        }
      }
      this.model.pose('death', this.deathTime);
      this.updateDeath(dt);
      this.afterAnimate();
      return;
    }
    this.hitAnim = Math.max(0, this.hitAnim - dt);
    this.model.pose(this.hitAnim > 0 ? 'hit' : this.anim, this.hitAnim > 0 ? this.clock : this.clock);
    this.afterAnimate();
  }

  dispose(): void {
    this.model.setCastShadow(false);
    super.dispose();
  }
}
