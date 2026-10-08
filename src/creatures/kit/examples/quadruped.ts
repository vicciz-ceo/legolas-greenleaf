/**
 * Kit example — quadruped (a warg: huge wolf, ~1.3 m at the shoulder). Copy this to build wargs,
 * horses, the mûmak (scale ×3, swap the head for a trunk chain) etc.
 *
 *  - rig: spine chain, neck/head/jaw/ears, tail chain (springs), front legs (scapula, humerus,
 *    radius, paw) and digitigrade hind legs (femur, tibia, metatarsus, paw)
 *  - sculpt: deep chest, tucked belly, muscled shoulders/haunches, long snout with nose and lips
 *  - fur: strand cards along the neck ruff, back and a bushy tail
 *  - animation: quadGait walk/trot/gallop picked from speed, 2-bone IK per leg, tail springs,
 *    head stabilisation, idle breathing, howl
 */
import * as THREE from 'three';
import { RigDef } from '../rig';
import type { Sculpt, V3 } from '../sdf';
import { buildCreature, type Creature } from '../creature';
import { solveTwoBone, quadGait, SpringChain, type QuadGaitSample } from '../anim';
import { growStrands, hairGeometry, type GrowRoot } from '../hair';
import { surface } from '../surfaces';
import { mulberry32 } from '../../../core/rng';

export function wargRig(s = 1) {
  const r = new RigDef();
  r.bone('root', null, [0, 0, 0]);
  r.bone('pelvis', 'root', [0, 0.98 * s, -0.48 * s]);
  r.bone('spine', 'pelvis', [0, 1.02 * s, -0.12 * s]);
  r.bone('chest', 'spine', [0, 1.06 * s, 0.22 * s]);
  r.bone('neck', 'chest', [0, 1.14 * s, 0.48 * s]);
  r.bone('head', 'neck', [0, 1.3 * s, 0.68 * s]);
  r.bone('jaw', 'head', [0, 1.25 * s, 0.76 * s]);
  r.pair('ear_l', 'head', [0.075 * s, 1.43 * s, 0.68 * s]);
  r.bone('tail1', 'pelvis', [0, 1.0 * s, -0.7 * s]);
  r.bone('tail2', 'tail1', [0, 0.88 * s, -0.92 * s]);
  r.bone('tail3', 'tail2', [0, 0.72 * s, -1.08 * s]);
  // front leg
  r.pair('scap_l', 'chest', [0.12 * s, 1.08 * s, 0.32 * s]);
  r.pair('humer_l', 'scap_l', [0.15 * s, 0.86 * s, 0.36 * s]);
  r.pair('radius_l', 'humer_l', [0.15 * s, 0.56 * s, 0.26 * s]);
  r.pair('fpaw_l', 'radius_l', [0.15 * s, 0.1 * s, 0.3 * s]);
  // hind leg (digitigrade)
  r.pair('femur_l', 'pelvis', [0.13 * s, 0.92 * s, -0.5 * s]);
  r.pair('tibia_l', 'femur_l', [0.145 * s, 0.6 * s, -0.33 * s]);
  r.pair('meta_l', 'tibia_l', [0.145 * s, 0.32 * s, -0.62 * s]);
  r.pair('hpaw_l', 'meta_l', [0.145 * s, 0.08 * s, -0.56 * s]);
  return r;
}

function sculptWarg(sc: Sculpt, r: RigDef, s: number) {
  const fur = surface('fur', { rough: 0.9 });
  const base = { mat: fur, color: 0x4a4238, color2: 0x2e2822, colorNoise: 0.5, colorFreq: 5 / s };
  const P = (n: string, dx = 0, dy = 0, dz = 0): V3 => r.at(n, dx * s, dy * s, dz * s);
  sc.with(base, () => {
    // torso: deep chest, tucked belly, haunches
    sc.ellipsoid(P('chest', 0, -0.06, 0.02), [0.22 * s, 0.27 * s, 0.3 * s], { bone: 'chest', k: 0.08 * s });
    sc.ellipsoid(P('spine', 0, -0.02, 0), [0.19 * s, 0.2 * s, 0.32 * s], { bone: 'spine', k: 0.1 * s });
    sc.ellipsoid(P('pelvis', 0, -0.04, -0.04), [0.2 * s, 0.21 * s, 0.24 * s], { bone: 'pelvis', k: 0.1 * s });
    sc.ellipsoid(P('spine', 0, -0.16, 0.05), [0.14 * s, 0.1 * s, 0.25 * s], { bone: 'spine', op: 'subtract', k: 0.12 * s });
    // neck ruff and head
    sc.cone(P('chest', 0, 0.02, 0.18), P('head', 0, -0.06, -0.06), 0.2 * s, 0.13 * s, { bone: 'neck', bone2: 'head', blend: [0.6, 1], k: 0.08 * s });
    sc.ellipsoid(P('head', 0, 0.02, 0), [0.13 * s, 0.12 * s, 0.15 * s], { bone: 'head', k: 0.05 * s });
    sc.cone(P('head', 0, -0.01, 0.06), P('head', 0, -0.06, 0.32), 0.09 * s, 0.05 * s, { bone: 'head', k: 0.06 * s }); // snout
    sc.sphere(P('head', 0, -0.035, 0.335), 0.04 * s, { bone: 'head', mat: surface('skin', { rough: 0.3 }), color: 0x141210, k: 0.02 * s }); // nose
    sc.cone(P('jaw', 0, -0.01, -0.04), P('jaw', 0, -0.03, 0.2), 0.07 * s, 0.035 * s, { bone: 'jaw', k: 0.05 * s });
    sc.mirrored(() => sc.ellipsoid(P('head', 0.06, 0.03, 0.12), [0.03 * s, 0.022 * s, 0.03 * s], { bone: 'head', mat: surface('eye', { rough: 0.05 }), color: 0x8a6a20, k: 0.008 * s })); // eyes
    sc.mirrored(() => sc.cone(P('ear_l', 0, -0.02, 0), P('ear_l', 0.02, 0.12, -0.03), 0.05 * s, 0.008 * s, { bone: 'ear_l', k: 0.03 * s }));
    // tail
    sc.tube([P('tail1'), P('tail2'), P('tail3'), P('tail3', 0, -0.12, -0.1)], [0.07 * s, 0.065 * s, 0.05 * s, 0.025 * s], { bone: 'tail1', k: 0.05 * s });
    // legs
    sc.mirrored(() => {
      sc.ellipsoid(P('scap_l', 0.0, -0.08, 0.0), [0.08 * s, 0.17 * s, 0.12 * s], { bone: 'scap_l', k: 0.08 * s });
      sc.cone(P('humer_l'), P('radius_l'), 0.085 * s, 0.055 * s, { bone: 'humer_l', k: 0.06 * s });
      sc.cone(P('radius_l'), P('fpaw_l'), 0.05 * s, 0.035 * s, { bone: 'radius_l', k: 0.04 * s });
      sc.box(P('fpaw_l', 0, -0.05, 0.05), [0.05 * s, 0.035 * s, 0.075 * s], 0.03 * s, { bone: 'fpaw_l', k: 0.03 * s });
      sc.ellipsoid(P('femur_l', 0.0, -0.12, 0.02), [0.1 * s, 0.2 * s, 0.14 * s], { bone: 'femur_l', k: 0.1 * s });
      sc.cone(P('tibia_l'), P('meta_l'), 0.065 * s, 0.04 * s, { bone: 'tibia_l', k: 0.05 * s });
      sc.cone(P('meta_l'), P('hpaw_l'), 0.04 * s, 0.033 * s, { bone: 'meta_l', k: 0.03 * s });
      sc.box(P('hpaw_l', 0, -0.035, 0.05), [0.048 * s, 0.033 * s, 0.075 * s], 0.03 * s, { bone: 'hpaw_l', k: 0.03 * s });
    });
  });
  // mouth line and teeth hint
  sc.ellipsoid(P('jaw', 0, 0.02, 0.12), [0.06 * s, 0.006 * s, 0.12 * s], { op: 'subtract', k: 0.006 * s, bone: 'jaw' });
  sc.cone(P('head', 0, -0.07, 0.1), P('head', 0, -0.075, 0.3), 0.03 * s, 0.02 * s, { op: 'paint', color: 0x1a1412, k: 0.02 * s, bone: 'head' });
}

function wargFur(r: RigDef, s: number): THREE.BufferGeometry {
  const rnd = mulberry32(17);
  const roots: GrowRoot[] = [];
  const add = (bone: string, p: V3, dir: V3, len: number, width: number) =>
    roots.push({ p, dir, length: len * s * (0.8 + rnd() * 0.4), width: width * s, bone: r.boneIndex(bone), color: rnd() < 0.3 ? 0x2a241e : 0x5a5044 });
  // neck ruff
  for (let i = 0; i < 70; i++) {
    const a = rnd() * Math.PI * 2;
    const t = rnd();
    const c = r.lerp('chest', 'head', 0.25 + t * 0.45);
    const rad = (0.2 - t * 0.07) * s;
    add(t < 0.5 ? 'neck' : 'head', [c[0] + Math.cos(a) * rad, c[1] + Math.sin(a) * rad * 0.9 + 0.02 * s, c[2]], [Math.cos(a) * 0.3, Math.sin(a) * 0.15 - 0.3, -0.9], 0.15, 0.05);
  }
  // back
  for (let i = 0; i < 60; i++) {
    const t = rnd();
    const c = r.lerp('pelvis', 'chest', t);
    const x = (rnd() - 0.5) * 0.24 * s;
    add(t < 0.5 ? 'spine' : 'chest', [c[0] + x, c[1] + 0.18 * s, c[2]], [x * 2, -0.1, -1], 0.12, 0.05);
  }
  // bushy tail
  for (let i = 0; i < 50; i++) {
    const t = rnd();
    const c = t < 0.5 ? r.lerp('tail1', 'tail2', t * 2) : r.lerp('tail2', 'tail3', (t - 0.5) * 2);
    const a = rnd() * Math.PI * 2;
    add(t < 0.5 ? 'tail1' : t < 0.8 ? 'tail2' : 'tail3', [c[0] + Math.cos(a) * 0.06 * s, c[1] + Math.sin(a) * 0.06 * s, c[2]], [Math.cos(a) * 0.4, Math.sin(a) * 0.4 - 0.3, -0.8], 0.2, 0.06);
  }
  // fur lies along the body: hug the nearest body ellipsoid
  const P = (n: string, dx = 0, dy = 0, dz = 0): V3 => r.at(n, dx * s, dy * s, dz * s);
  const colliders = [
    { c: P('chest', 0, -0.06, 0.02), r: [0.22 * s, 0.27 * s, 0.3 * s] as V3 },
    { c: P('spine', 0, -0.02, 0), r: [0.19 * s, 0.2 * s, 0.32 * s] as V3 },
    { c: P('pelvis', 0, -0.04, -0.04), r: [0.2 * s, 0.21 * s, 0.24 * s] as V3 },
  ];
  const strands = growStrands(roots, { segments: 4, gravity: 4 / s, jitter: 0.1, seed: 9, taper: 0.3, colliders, hug: 'nearest', hugUntil: -0.6 });
  return hairGeometry(strands, [], { color: 0x4a4238, tipColor: 0x6a6052, weights: (_p, _a, out) => out.push([0, 1]) });
}

export interface QuadrupedDemo {
  creature: Creature;
  object: THREE.Object3D;
  animations: string[];
  pose(anim: string, t: number): void;
}

export function createWarg(seed = 0, scale = 1): QuadrupedDemo {
  const rig = wargRig(scale);
  const c = buildCreature({
    key: `kit_warg_${scale}`,
    seed,
    rig,
    sculpt: (sc) => sculptWarg(sc, rig, scale),
    mesh: { res: 0.032 * scale, regions: [{ min: rig.at('head', -0.17 * scale, -0.18 * scale, -0.15 * scale), max: rig.at('head', 0.17 * scale, 0.25 * scale, 0.4 * scale), res: 0.014 * scale }], ao: { dist: 0.1 * scale } },
    skinK: 0.06 * scale,
    material: { detailScale: 1.2 * scale, wrap: 0.3 },
    hair: (r) => wargFur(r, scale),
    hairMaterial: { roughness: 0.8, anisotropy: 0.3, sheen: 0.3, sheenColor: 0x4a4238, alphaTest: 0.4 },
  });
  const ps = c.pose;
  const I = (n: string) => ps.i(n);
  c.springs.push(new SpringChain(ps, [I('tail1'), I('tail2'), I('tail3')], [0, -0.12 * scale, -0.1 * scale], { stiffness: 0.08, drag: 0.15, gravity: 3 }));
  const gait: QuadGaitSample = quadGait(0, 0, 0.95 * scale);
  const legs = [
    { up: 'humer_l', mid: 'radius_l', end: 'fpaw_l', g: 0 },
    { up: 'humer_r', mid: 'radius_r', end: 'fpaw_r', g: 1 },
    { up: 'tibia_l', mid: 'meta_l', end: 'hpaw_l', g: 2, hip: 'femur_l' },
    { up: 'tibia_r', mid: 'meta_r', end: 'hpaw_r', g: 3, hip: 'femur_r' },
  ];
  const T = new THREE.Vector3();
  const pole = new THREE.Vector3();
  const BACK = new THREE.Vector3(0, 0, -1);
  const FWD = new THREE.Vector3(0, 0, 1);
  const pose = (anim: string, t: number) => {
    const speed = anim === 'walk' ? 1.6 * scale : anim === 'trot' ? 4 * scale : anim === 'gallop' ? 11 * scale : 0;
    // deterministic pre-roll for the tail springs
    for (const sp of c.springs) sp.reset();
    const steps = 40;
    for (let k = steps; k >= 0; k--) {
      const tt = Math.max(0, t - k / 60);
      solve(anim, tt, speed);
      c.update(k === steps ? 0 : 1 / 60);
    }
  };
  const solve = (anim: string, t: number, speed: number) => {
    ps.reset();
    quadGait(t * (speed > 0 ? 1 : 0) * (speed > 0 ? 1.0 : 0), speed, 0.95 * scale, gait);
    const breath = Math.sin(t * 2) * 0.01;
    const howl = anim === 'howl' ? Math.min(1, t / 0.6) : 0;
    ps.offset[I('pelvis')].set(0, gait.bodyY - howl * 0.08 * scale, 0);
    ps.euler(I('pelvis'), gait.bodyPitch * 0.5 + howl * 0.12, 0, 0);
    ps.euler(I('spine'), breath + howl * -0.1, Math.sin(t * 0.6) * 0.03, 0);
    ps.euler(I('chest'), -gait.bodyPitch * 0.4 + howl * -0.2, 0, 0);
    ps.euler(I('neck'), -0.05 + Math.sin(t * 0.5) * 0.04 - howl * 0.6, Math.sin(t * 0.37) * 0.15 * (1 - howl), 0);
    ps.euler(I('head'), howl * -0.4 + (speed > 6 ? 0.2 : 0), 0, 0);
    ps.euler(I('jaw'), anim === 'howl' ? 0.35 + Math.sin(t * 9) * 0.03 : speed > 6 ? 0.25 : 0.03, 0, 0);
    ps.euler(I('ear_l'), howl * 0.3, 0, -0.1);
    ps.euler(I('ear_r'), howl * 0.3, 0, 0.1);
    ps.euler(I('tail1'), -0.3 + howl * 0.3 + Math.sin(t * 1.4) * 0.15, Math.sin(t * 2) * 0.2, 0);
    ps.fk();
    for (const L of legs) {
      const f = gait.legs[L.g];
      const end = ps.restModel[I(L.end)];
      T.set(end.x, end.y + f.lift, end.z + f.along);
      if (L.hip) {
        // hind: femur swings with the leg, tibia/metatarsus solved to the paw (hock points back)
        const swing = -f.along / (0.9 * scale);
        ps.local[I(L.hip)].setFromAxisAngle(new THREE.Vector3(1, 0, 0), swing * 0.6);
        ps.fkFrom(I(L.hip));
        pole.copy(ps.modelP[I(L.mid)]).addScaledVector(BACK, 0.5 * scale);
        solveTwoBone(ps, I(L.up), I(L.mid), I(L.end), T, pole, { restUp: FWD, maxStretch: 1.05 });
      } else {
        pole.copy(ps.modelP[I(L.mid)]).addScaledVector(BACK, 0.5 * scale);
        solveTwoBone(ps, I(L.up), I(L.mid), I(L.end), T, pole, { restUp: FWD, maxStretch: 1.05 });
      }
      ps.local[I(L.end)].setFromAxisAngle(new THREE.Vector3(1, 0, 0), f.pitch * 0.6);
      ps.fkFrom(I(L.end));
    }
  };
  return { creature: c, object: c.root, animations: ['idle', 'walk', 'trot', 'gallop', 'howl'], pose };
}
