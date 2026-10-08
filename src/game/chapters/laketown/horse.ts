/**
 * A horse, built with the creature kit (adapted from the kit's warg example): barrel chest and
 * croup, a long arched neck, a long head with ears, slender legs ending in hooves, a mane of strand
 * cards and a long tail on spring bones. Animations: idle, walk, trot, gallop, rear.
 *
 * Bolg escapes on one at the end of Lake-town; `createHorse(level, pos)` is the gameplay wrapper
 * (mount a rider, gallop to a point). Lab subjects live in horse.lab.ts.
 */
import * as THREE from 'three';
import type { Humanoid, LevelAPI } from '../../../core/types';
import { RigDef } from '../../../creatures/kit/rig';
import type { Sculpt, V3 } from '../../../creatures/kit/sdf';
import { buildCreature, type Creature } from '../../../creatures/kit/creature';
import { SpringChain, quadGait, solveTwoBone, type QuadGaitSample } from '../../../creatures/kit/anim';
import { growStrands, hairGeometry, type GrowRoot } from '../../../creatures/kit/hair';
import { paintGeometry } from '../../../creatures/kit/geometry';
import { surface } from '../../../creatures/kit/surfaces';
import { mulberry32 } from '../../../core/rng';
import { yawOf } from '../../../core/math';
import { D } from './layout';

export function horseRig(s = 1): RigDef {
  const r = new RigDef();
  r.bone('root', null, [0, 0, 0]);
  r.bone('pelvis', 'root', [0, 1.1 * s, -0.55 * s]);
  r.bone('spine', 'pelvis', [0, 1.2 * s, -0.12 * s]);
  r.bone('chest', 'spine', [0, 1.2 * s, 0.32 * s]);
  r.bone('neck', 'chest', [0, 1.36 * s, 0.6 * s]);
  r.bone('head', 'neck', [0, 1.84 * s, 0.98 * s]);
  r.bone('jaw', 'head', [0, 1.7 * s, 1.1 * s]);
  r.pair('ear_l', 'head', [0.07 * s, 1.98 * s, 0.97 * s]);
  r.bone('tail1', 'pelvis', [0, 1.28 * s, -0.86 * s]);
  r.bone('tail2', 'tail1', [0, 1.02 * s, -1.0 * s]);
  r.bone('tail3', 'tail2', [0, 0.72 * s, -1.06 * s]);
  // forelegs: shoulder, elbow-hidden humerus, knee (radius), hoof
  r.pair('scap_l', 'chest', [0.16 * s, 1.28 * s, 0.46 * s]);
  r.pair('humer_l', 'scap_l', [0.19 * s, 1.1 * s, 0.42 * s]);
  r.pair('radius_l', 'humer_l', [0.18 * s, 0.56 * s, 0.44 * s]);
  r.pair('fpaw_l', 'radius_l', [0.17 * s, 0.07 * s, 0.45 * s]);
  // hind legs: hip, stifle, hock, hoof
  r.pair('femur_l', 'pelvis', [0.17 * s, 1.1 * s, -0.62 * s]);
  r.pair('tibia_l', 'femur_l', [0.19 * s, 0.78 * s, -0.46 * s]);
  r.pair('meta_l', 'tibia_l', [0.19 * s, 0.5 * s, -0.8 * s]);
  r.pair('hpaw_l', 'meta_l', [0.18 * s, 0.07 * s, -0.74 * s]);
  return r;
}

const COAT = 0x1f1a18;
const COAT2 = 0x2c2420;

function sculptHorse(sc: Sculpt, r: RigDef, s: number): void {
  const fur = surface('fur', { rough: 0.78 });
  const base = { mat: fur, color: COAT, color2: COAT2, colorNoise: 0.35, colorFreq: 3 / s };
  const P = (n: string, dx = 0, dy = 0, dz = 0): V3 => r.at(n, dx * s, dy * s, dz * s);
  sc.with(base, () => {
    // barrel, withers, croup
    sc.ellipsoid(P('chest', 0, -0.1, 0.04), [0.27 * s, 0.34 * s, 0.4 * s], { bone: 'chest', k: 0.1 * s });
    sc.ellipsoid(P('spine', 0, -0.1, 0), [0.26 * s, 0.31 * s, 0.38 * s], { bone: 'spine', k: 0.1 * s });
    sc.ellipsoid(P('pelvis', 0, -0.02, -0.06), [0.28 * s, 0.31 * s, 0.34 * s], { bone: 'pelvis', k: 0.1 * s });
    // neck: from the shoulders up and forward in an arch
    sc.cone(P('chest', 0, -0.02, 0.2), P('head', 0, -0.12, -0.12), 0.23 * s, 0.12 * s, { bone: 'neck', bone2: 'head', blend: [0.55, 1], k: 0.09 * s });
    sc.ellipsoid(P('neck', 0, 0.08, 0.1), [0.1 * s, 0.2 * s, 0.22 * s], { bone: 'neck', k: 0.1 * s });
    // head: long and bony
    sc.ellipsoid(P('head', 0, -0.02, 0.0), [0.1 * s, 0.13 * s, 0.17 * s], { bone: 'head', k: 0.05 * s });
    sc.cone(P('head', 0, -0.06, 0.12), P('head', 0, -0.35, 0.5), 0.1 * s, 0.062 * s, { bone: 'head', k: 0.06 * s }); // face
    sc.sphere(P('head', 0, -0.37, 0.52), 0.065 * s, { bone: 'head', k: 0.04 * s });
    sc.cone(P('jaw', 0, -0.02, -0.02), P('jaw', 0, -0.17, 0.3), 0.07 * s, 0.05 * s, { bone: 'jaw', k: 0.05 * s });
    sc.mirrored(() => sc.ellipsoid(P('head', 0.075, 0.0, 0.1), [0.032 * s, 0.026 * s, 0.034 * s], { bone: 'head', mat: surface('eye', { rough: 0.05 }), color: 0x1a1008, k: 0.008 * s }));
    sc.mirrored(() => sc.ellipsoid(P('head', 0.05, -0.4, 0.58), [0.016 * s, 0.012 * s, 0.026 * s], { op: 'subtract', bone: 'head', k: 0.008 * s })); // nostrils
    sc.mirrored(() => sc.cone(P('ear_l', 0, -0.02, 0), P('ear_l', 0.02, 0.15, -0.04), 0.036 * s, 0.006 * s, { bone: 'ear_l', k: 0.03 * s }));
    // tail dock
    sc.tube([P('tail1'), P('tail2', 0, 0.02, 0.0), P('tail3', 0, 0.1, 0.02)], [0.07 * s, 0.05 * s, 0.025 * s], { bone: 'tail1', k: 0.05 * s });
    // legs
    sc.mirrored(() => {
      sc.ellipsoid(P('scap_l', 0.0, -0.1, 0.0), [0.1 * s, 0.22 * s, 0.17 * s], { bone: 'scap_l', k: 0.1 * s });
      sc.cone(P('humer_l', -0.0, 0.05, 0), P('radius_l'), 0.095 * s, 0.052 * s, { bone: 'humer_l', k: 0.06 * s });
      sc.sphere(P('radius_l'), 0.052 * s, { bone: 'radius_l', k: 0.03 * s }); // knee
      sc.cone(P('radius_l'), P('fpaw_l', 0, 0.06, 0), 0.044 * s, 0.032 * s, { bone: 'radius_l', k: 0.03 * s });
      sc.ellipsoid(P('fpaw_l', 0, 0.075, 0), [0.04 * s, 0.04 * s, 0.05 * s], { bone: 'fpaw_l', k: 0.02 * s }); // fetlock
      sc.cone(P('fpaw_l', 0, 0.05, 0), P('fpaw_l', 0, -0.03, 0.01), 0.034 * s, 0.05 * s, { bone: 'fpaw_l', mat: surface('horn', { rough: 0.4 }), color: 0x16120e, k: 0.012 * s }); // hoof
      sc.ellipsoid(P('femur_l', 0.0, -0.1, 0.0), [0.14 * s, 0.26 * s, 0.2 * s], { bone: 'femur_l', k: 0.12 * s });
      sc.cone(P('tibia_l'), P('meta_l'), 0.075 * s, 0.05 * s, { bone: 'tibia_l', k: 0.05 * s });
      sc.sphere(P('meta_l'), 0.05 * s, { bone: 'meta_l', k: 0.03 * s }); // hock
      sc.cone(P('meta_l'), P('hpaw_l', 0, 0.06, 0), 0.042 * s, 0.03 * s, { bone: 'meta_l', k: 0.03 * s });
      sc.ellipsoid(P('hpaw_l', 0, 0.075, 0), [0.04 * s, 0.04 * s, 0.05 * s], { bone: 'hpaw_l', k: 0.02 * s });
      sc.cone(P('hpaw_l', 0, 0.05, 0), P('hpaw_l', 0, -0.03, 0.01), 0.034 * s, 0.05 * s, { bone: 'hpaw_l', mat: surface('horn', { rough: 0.4 }), color: 0x16120e, k: 0.012 * s });
    });
  });
  // a white blaze down the face (a dark horse with one marking reads as a real horse)
  sc.cone(P('head', 0, 0.02, 0.1), P('head', 0, -0.3, 0.46), 0.022 * s, 0.026 * s, { op: 'paint', color: 0xcfc8bc, k: 0.02 * s, bone: 'head' });
}

function mane(r: RigDef, s: number): THREE.BufferGeometry {
  const rnd = mulberry32(23);
  const roots: GrowRoot[] = [];
  const add = (bone: string, p: V3, dir: V3, len: number, width: number) =>
    roots.push({ p, dir, length: len * s * (0.8 + rnd() * 0.5), width: width * s, bone: r.boneIndex(bone), color: rnd() < 0.3 ? 0x0e0c0b : 0x1a1614 });
  // mane along the crest of the neck
  for (let i = 0; i < 90; i++) {
    const t = rnd();
    const c = r.lerp('chest', 'head', 0.12 + t * 0.78);
    const x = (rnd() - 0.5) * 0.04 * s;
    add(t < 0.55 ? 'neck' : 'head', [c[0] + x, c[1] + 0.24 * s * (1 - t * 0.55), c[2] - 0.08 * s], [(rnd() - 0.5) * 0.4 + 0.6, 0.2, -0.5], 0.3, 0.06);
  }
  // forelock
  for (let i = 0; i < 12; i++) add('head', [0, 1.98 * s, 1.02 * s], [(rnd() - 0.5) * 0.3, -0.1, 0.5], 0.22, 0.05);
  // tail: long, hanging
  for (let i = 0; i < 70; i++) {
    const t = rnd();
    const c = t < 0.5 ? r.lerp('tail1', 'tail2', t * 2) : r.lerp('tail2', 'tail3', (t - 0.5) * 2);
    const a = rnd() * Math.PI * 2;
    add(t < 0.5 ? 'tail1' : t < 0.8 ? 'tail2' : 'tail3', [c[0] + Math.cos(a) * 0.04 * s, c[1] + Math.sin(a) * 0.04 * s, c[2]], [Math.cos(a) * 0.3, -0.7, -0.4], 0.62, 0.06);
  }
  const strands = growStrands(roots, { segments: 5, gravity: 5 / s, jitter: 0.12, seed: 4, taper: 0.4 });
  return hairGeometry(strands, [], { color: 0x161210, tipColor: 0x201a16, weights: (_p, _a, out) => out.push([0, 1]) });
}

export interface HorseDemo {
  creature: Creature;
  object: THREE.Object3D;
  animations: string[];
  pose(anim: string, t: number): void;
  /** pose with an explicit gait phase (cycles) and speed: gameplay (feet never slide) */
  drive(speed: number, phase: number, rear?: number): void;
  /** saddle position in model space (rider's seat) */
  seat: THREE.Vector3;
}

export function createHorseCreature(seed = 0, scale = 1): HorseDemo {
  const rig = horseRig(scale);
  const c = buildCreature({
    key: `lt_horse_${scale}`,
    seed,
    rig,
    sculpt: (sc) => sculptHorse(sc, rig, scale),
    mesh: { res: 0.036 * scale, regions: [{ min: rig.at('head', -0.14 * scale, -0.5 * scale, -0.2 * scale), max: rig.at('head', 0.14 * scale, 0.2 * scale, 0.66 * scale), res: 0.016 * scale }], ao: { dist: 0.1 * scale } },
    skinK: 0.07 * scale,
    material: { detailScale: 1.3 * scale, wrap: 0.3 },
    hair: (r) => mane(r, scale),
    hairMaterial: { roughness: 0.7, anisotropy: 0.5, sheen: 0.4, sheenColor: 0x2a2420, alphaTest: 0.4 },
    extra: (ctx) => {
      // a simple saddle blanket and strap so the rider has something to sit on
      const blanket = new THREE.BoxGeometry(0.64 * scale, 0.05 * scale, 0.62 * scale);
      ctx.add(paintGeometry(blanket, { bone: rig.boneIndex('spine'), color: 0x4a2a1c, mat: 'wool', matrix: new THREE.Matrix4().makeTranslation(0, 1.5 * scale, -0.04 * scale) }));
    },
  });
  const ps = c.pose;
  const I = (n: string) => ps.i(n);
  c.springs.push(new SpringChain(ps, [I('tail1'), I('tail2'), I('tail3')], [0, -0.18 * scale, -0.1 * scale], { stiffness: 0.07, drag: 0.15, gravity: 3 }));
  const LEG = 1.05 * scale;
  const gait: QuadGaitSample = quadGait(0, 0, LEG);
  const legs = [
    { up: 'humer_l', mid: 'radius_l', end: 'fpaw_l', g: 0, front: true },
    { up: 'humer_r', mid: 'radius_r', end: 'fpaw_r', g: 1, front: true },
    { up: 'tibia_l', mid: 'meta_l', end: 'hpaw_l', g: 2, hip: 'femur_l', front: false },
    { up: 'tibia_r', mid: 'meta_r', end: 'hpaw_r', g: 3, hip: 'femur_r', front: false },
  ];
  const T = new THREE.Vector3();
  const pole = new THREE.Vector3();
  const BACK = new THREE.Vector3(0, 0, -1);
  const FWD = new THREE.Vector3(0, 0, 1);
  const AX = new THREE.Vector3(1, 0, 0);
  const solve = (speed: number, phase: number, t: number, rear: number, anim: string) => {
    ps.reset();
    quadGait(phase, speed, LEG, gait);
    const breath = Math.sin(t * 2.1) * 0.012;
    const run = Math.min(1, speed / 9);
    ps.offset[I('pelvis')].set(0, gait.bodyY - rear * 0.1 * scale, 0);
    ps.euler(I('pelvis'), gait.bodyPitch * 0.6 - rear * 0.75, 0, 0);
    ps.euler(I('spine'), breath - rear * 0.15, Math.sin(t * 0.5) * 0.02, 0);
    ps.euler(I('chest'), -gait.bodyPitch * 0.5 - rear * 0.25, 0, 0);
    // the head nods with the stride; head lifted when rearing, lowered when galloping
    ps.euler(I('neck'), 0.04 + Math.sin(t * 0.45) * 0.03 - run * 0.1 - rear * 0.35 + Math.sin(phase * Math.PI * 2) * 0.05 * run, Math.sin(t * 0.33) * 0.08 * (1 - run), 0);
    ps.euler(I('head'), 0.1 + run * 0.12 + rear * 0.2 + (anim === 'idle' ? Math.sin(t * 0.7) * 0.04 : 0), 0, 0);
    ps.euler(I('jaw'), anim === 'rear' ? 0.3 : run > 0.5 ? 0.12 : 0.02, 0, 0);
    ps.euler(I('ear_l'), run * 0.3 - rear * 0.2, 0, -0.1);
    ps.euler(I('ear_r'), run * 0.3 - rear * 0.2, 0, 0.1);
    ps.euler(I('tail1'), -0.25 + run * 0.7 + Math.sin(t * 1.3) * 0.12, Math.sin(t * 1.9) * 0.15, 0);
    ps.fk();
    for (const L of legs) {
      const f = gait.legs[L.g];
      const end = ps.restModel[I(L.end)];
      let along = f.along;
      let lift = f.lift;
      if (rear > 0 && L.front) {
        // forelegs pawing the air
        along = rear * (0.22 + Math.sin(t * 7 + L.g) * 0.06);
        lift = rear * (0.72 + Math.sin(t * 6 + L.g * 2) * 0.05);
      }
      T.set(end.x, end.y + lift, end.z + along);
      if (L.hip) {
        const swing = -f.along / (0.9 * scale);
        ps.local[I(L.hip)].setFromAxisAngle(AX, swing * 0.5);
        ps.fkFrom(I(L.hip));
        pole.copy(ps.modelP[I(L.mid)]).addScaledVector(BACK, 0.5 * scale);
        solveTwoBone(ps, I(L.up), I(L.mid), I(L.end), T, pole, { restUp: FWD, maxStretch: 1.06 });
      } else {
        // the knee bends forward
        pole.copy(ps.modelP[I(L.mid)]).addScaledVector(FWD, 0.5 * scale);
        solveTwoBone(ps, I(L.up), I(L.mid), I(L.end), T, pole, { restUp: BACK, maxStretch: 1.06 });
      }
      ps.local[I(L.end)].setFromAxisAngle(AX, f.pitch * 0.6 + (L.front && rear > 0 ? 0.5 * rear : 0));
      ps.fkFrom(I(L.end));
    }
  };
  const pose = (anim: string, t: number) => {
    const speed = anim === 'walk' ? 1.5 * scale : anim === 'trot' ? 4.2 * scale : anim === 'gallop' ? 12 * scale : 0;
    const rear = anim === 'rear' ? Math.min(1, t / 0.5) * (t < 1.8 ? 1 : Math.max(0, 1 - (t - 1.8) / 0.5)) : 0;
    for (const sp of c.springs) sp.reset();
    const probe = quadGait(0, speed, LEG);
    const steps = 40;
    for (let k = steps; k >= 0; k--) {
      const tt = Math.max(0, t - k / 60);
      solve(speed, tt * probe.freq, tt, rear, anim);
      c.update(k === steps ? 0 : 1 / 60);
    }
  };
  const drive = (speed: number, phase: number, rear = 0) => {
    solve(speed, phase, phase, rear, speed > 0.5 ? 'gallop' : 'idle');
  };
  return {
    creature: c,
    object: c.root,
    animations: ['idle', 'walk', 'trot', 'gallop', 'rear'],
    pose,
    drive,
    seat: new THREE.Vector3(0, 1.43 * scale, -0.06 * scale),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// gameplay wrapper
// ─────────────────────────────────────────────────────────────────────────────

export interface HorseRig {
  readonly object: THREE.Object3D;
  /** seat a humanoid on the horse (ride pose) */
  mount(rider: Humanoid): void;
  /** rear up, then gallop to `target` at `speed` m/s */
  gallop(target: THREE.Vector3, speed: number): void;
  readonly galloping: boolean;
}

export function createHorse(level: LevelAPI, pos: THREE.Vector3, facing = 0): HorseRig {
  const SCALE = 1.2;
  const demo = createHorseCreature(1, SCALE);
  const group = new THREE.Group();
  group.name = 'horse';
  group.add(demo.object);
  group.position.copy(pos);
  group.position.y = D;
  group.rotation.y = facing;
  level.root.add(group);
  demo.object.traverse((o) => ((o as THREE.Mesh).isMesh ? ((o as THREE.Mesh).castShadow = true) : undefined));
  let rider: Humanoid | null = null;
  let speed = 0;
  let phase = 0;
  let t = 0;
  let rearT = -1;
  let target: THREE.Vector3 | null = null;
  let top = 12;
  const riderAnim = { speed: 0, moveDir: { x: 0, z: 1 }, grounded: true, vy: 0, aim: 0, draw: 0, aimPitch: 0, attack: null, hit: 0, dead: 0, deathVariant: 0, special: 'ride', specialT: 0, lookAt: null } as Parameters<Humanoid['animate']>[1];
  const stop = level.onUpdate((dt) => {
    t += dt;
    let rear = 0;
    if (rearT >= 0) {
      rearT += dt;
      rear = Math.min(1, rearT / 0.45) * (rearT < 1.0 ? 1 : Math.max(0, 1 - (rearT - 1.0) / 0.4));
      if (rearT > 1.4) {
        rearT = -1;
        speed = 0.1;
      }
    } else if (target) {
      speed = Math.min(top, speed + 9 * dt);
      const dx = target.x - group.position.x;
      const dz = target.z - group.position.z;
      const d = Math.hypot(dx, dz);
      group.rotation.y = yawOf(dx, dz);
      group.position.x += (dx / Math.max(d, 1e-3)) * speed * dt;
      group.position.z += (dz / Math.max(d, 1e-3)) * speed * dt;
      group.position.y = Math.max(D, level.ctx.physics.heightAt(group.position.x, group.position.z));
      // gallop on, then fade (the dark takes him)
      if (d < 1) target = null;
    }
    const freq = quadGait(0, speed, 1.05 * SCALE).freq;
    phase += freq * dt;
    demo.drive(speed, phase, rear);
    demo.creature.update(dt);
    if (rider) {
      riderAnim.speed = 0;
      rider.animate(dt, riderAnim);
    }
  });
  void stop;
  return {
    object: group,
    mount(r: Humanoid) {
      rider = r;
      r.root.removeFromParent();
      group.add(r.root);
      r.root.position.copy(demo.seat);
      r.root.position.y -= 0.42;
      r.root.rotation.set(0, 0, 0);
    },
    gallop(to: THREE.Vector3, v: number) {
      target = to.clone();
      top = v;
      rearT = 0;
    },
    get galloping() {
      return speed > 2;
    },
  };
}

