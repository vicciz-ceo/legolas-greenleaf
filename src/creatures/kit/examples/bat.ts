/**
 * Kit example — giant bat (Ravenhill; ~4.6 m wingspan at scale 1). Copy this for any winged
 * creature (fell beasts, eagles: swap the membrane for feather cards).
 *
 *  - rig: body/hips, neck/head/jaw/ears, per wing humerus → forearm → hand → 4 finger bones, legs
 *  - sculpt: furry body, big ears, snout with fangs (SDF); wing bones are rigid tapered segments
 *  - membrane: skinned sheets (sheetGeometry) weighted leading edge → arm/fingers, trailing edge →
 *    body and finger tips, so the wing folds with the fingers
 *  - animation: wingFlap (fast downstroke, folded upstroke), glide, screech; legs dangle
 */
import * as THREE from 'three';
import { RigDef } from '../rig';
import type { V3 } from '../sdf';
import { buildCreature, type Creature } from '../creature';
import { wingFlap, type WingSample } from '../anim';
import { sheetGeometry } from '../sheet';
import { limbSegment, segmentMatrix } from '../geometry';
import { surface } from '../surfaces';
import { growStrands, hairGeometry, type GrowRoot } from '../hair';
import { mulberry32 } from '../../../core/rng';

interface WingRest {
  shoulder: V3;
  elbow: V3;
  wrist: V3;
  tips: V3[]; // f2 (leading) … f5 (inner)
  hip: V3;
}

export function batRig(s = 1) {
  const r = new RigDef();
  r.bone('root', null, [0, 0, 0]);
  r.bone('body', 'root', [0, 1.2 * s, 0.05 * s]);
  r.bone('hips', 'body', [0, 1.14 * s, -0.32 * s]);
  r.bone('neck', 'body', [0, 1.27 * s, 0.3 * s]);
  r.bone('head', 'neck', [0, 1.33 * s, 0.42 * s]);
  r.bone('jaw', 'head', [0, 1.29 * s, 0.5 * s]);
  r.pair('ear_l', 'head', [0.07 * s, 1.45 * s, 0.42 * s]);
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
  r.pair('foot_l', 'leg_l', [0.16 * s, 0.86 * s, -0.5 * s]);
  return { rig: r, wing: w };
}

function lerp3(a: V3, b: V3, t: number): V3 {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}
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

function membrane(r: RigDef, w: WingRest, side: 'l' | 'r') {
  const sx = side === 'l' ? 1 : -1;
  const m = (p: V3): V3 => [p[0] * sx, p[1], p[2]];
  const cols = 22, rows = 7;
  const lead = resample([w.shoulder, w.elbow, w.wrist, w.tips[0]].map(m), cols);
  const trail = resample([w.hip, lerp3(w.hip, w.tips[3], 0.55), w.tips[3], w.tips[2], w.tips[1], w.tips[0]].map(m), cols);
  const grid: V3[][] = [];
  for (let rr = 0; rr < rows; rr++) {
    const v = rr / (rows - 1);
    const row: V3[] = [];
    for (let c = 0; c < cols; c++) {
      const p = lerp3(lead[c], trail[c], v);
      // membrane droops slightly between bones
      row.push([p[0], p[1] - Math.sin(Math.PI * v) * 0.05 * Math.min(1, (c / (cols - 1)) * 3), p[2]]);
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
        const t = (u - seq[i][1]) / (seq[i + 1][1] - seq[i][1]);
        return [[seq[i][0], 1 - t], [seq[i + 1][0], t]];
      }
    }
    return [[B('f2'), 1]];
  };
  return sheetGeometry({
    grid,
    color: 0x2a1e1a,
    colorAt: (u, v) => (v > 0.92 || u > 0.97 ? 0x1a1210 : 0x3a2a24),
    mat: surface('membrane', { rough: 0.6 }),
    ao: (u, v) => 0.75 + 0.25 * Math.min(1, u * 3) * (1 - v * 0.3),
    weights: (rr, c, _p, out) => {
      const u = c / (cols - 1), v = rr / (rows - 1);
      for (const [b, wt] of leadBones(u)) out.push([b, wt * (1 - v)]);
      for (const [b, wt] of trailBones(u)) out.push([b, wt * v]);
      // merge duplicates
      const acc = new Map<number, number>();
      for (const [b, wt] of out) acc.set(b, (acc.get(b) ?? 0) + wt);
      out.length = 0;
      for (const [b, wt] of acc) out.push([b, wt]);
    },
  });
}

function batFur(r: RigDef, s: number) {
  const rnd = mulberry32(5);
  const roots: GrowRoot[] = [];
  for (let i = 0; i < 110; i++) {
    const u = rnd() * Math.PI * 2, v = Math.acos(1 - 2 * rnd());
    const n = new THREE.Vector3(Math.sin(v) * Math.cos(u), Math.cos(v), Math.sin(v) * Math.sin(u));
    const onHead = i < 25;
    const c = onHead ? r.at('head', 0, 0.02 * s, -0.04 * s) : r.at('body', 0, -0.02 * s, -0.12 * s);
    const R = onHead ? [0.12, 0.11, 0.12] : [0.2, 0.17, 0.36];
    const p: V3 = [c[0] + n.x * R[0] * s, c[1] + n.y * R[1] * s, c[2] + n.z * R[2] * s];
    roots.push({ p, dir: [n.x * 0.5, n.y * 0.4, n.z * 0.4 - 0.6], length: 0.07 * s, width: 0.04 * s, bone: r.boneIndex(onHead ? 'head' : 'body'), color: rnd() < 0.5 ? 0x3a2c24 : 0x4a3a2e });
  }
  const strands = growStrands(roots, { segments: 3, gravity: 1, jitter: 0.15, seed: 3, taper: 0.4 });
  return hairGeometry(strands, [], { color: 0x3a2c24, weights: (_p, _a, out) => out.push([0, 1]) });
}

export interface BatDemo {
  creature: Creature;
  object: THREE.Object3D;
  animations: string[];
  pose(anim: string, t: number): void;
}

export function createBat(seed = 0, scale = 1): BatDemo {
  const { rig, wing } = batRig(scale);
  const s = scale;
  const P = (n: string, dx = 0, dy = 0, dz = 0): V3 => rig.at(n, dx * s, dy * s, dz * s);
  const c = buildCreature({
    key: `kit_bat_${scale}`,
    seed,
    rig,
    sculpt: (sc) => {
      const fur = surface('fur', { rough: 0.9 });
      sc.with({ mat: fur, color: 0x3a2c24, color2: 0x241a16, colorNoise: 0.4, colorFreq: 8 / s }, () => {
        sc.ellipsoid(P('body', 0, -0.02, -0.12), [0.2 * s, 0.17 * s, 0.36 * s], { bone: 'body', bone2: 'hips', blend: [0.5, 0.9], blendAxis: [P('body'), P('hips')], k: 0.06 * s });
        sc.cone(P('body', 0, 0.02, 0.16), P('head', 0, -0.02, -0.04), 0.13 * s, 0.1 * s, { bone: 'neck', k: 0.06 * s });
        sc.ellipsoid(P('head', 0, 0.02, -0.02), [0.12 * s, 0.11 * s, 0.12 * s], { bone: 'head', k: 0.04 * s });
        sc.cone(P('head', 0, -0.01, 0.06), P('head', 0, -0.045, 0.18), 0.065 * s, 0.04 * s, { bone: 'head', k: 0.04 * s });
        sc.sphere(P('head', 0, -0.03, 0.19), 0.035 * s, { bone: 'head', mat: surface('skin', { rough: 0.35 }), color: 0x2a1614, k: 0.02 * s });
        sc.cone(P('jaw', 0, -0.0, -0.05), P('jaw', 0, -0.01, 0.1), 0.05 * s, 0.03 * s, { bone: 'jaw', k: 0.03 * s });
        // ears
        sc.mirrored(() => {
          sc.ellipsoid(P('ear_l', 0.02, 0.06, -0.01), [0.025 * s, 0.11 * s, 0.07 * s], { bone: 'ear_l', mat: surface('membrane'), color: 0x3a2622, k: 0.03 * s, rot: [-0.2, 0.3, -0.25] });
          sc.ellipsoid(P('ear_l', 0.035, 0.06, 0.01), [0.012 * s, 0.08 * s, 0.05 * s], { bone: 'ear_l', op: 'subtract', k: 0.01 * s, rot: [-0.2, 0.3, -0.25] });
          sc.sphere(P('head', 0.055, 0.03, 0.08), 0.018 * s, { bone: 'head', mat: surface('eye', { rough: 0.05 }), color: 0x0a0806, k: 0.006 * s });
        });
        // fangs
        sc.mirrored(() => sc.cone(P('head', 0.025, -0.06, 0.16), P('head', 0.022, -0.11, 0.17), 0.009 * s, 0.002 * s, { bone: 'head', mat: 'teeth', color: 0xd8d0b8, k: 0.004 * s }));
        // legs
        sc.mirrored(() => {
          sc.cone(P('leg_l'), P('foot_l'), 0.04 * s, 0.025 * s, { bone: 'leg_l', k: 0.04 * s });
          sc.ellipsoid(P('foot_l', 0, -0.03, 0.02), [0.03 * s, 0.04 * s, 0.05 * s], { bone: 'foot_l', mat: surface('skin', { rough: 0.5 }), color: 0x2a1c18, k: 0.02 * s });
        });
      });
    },
    mesh: { res: 0.026 * s, regions: [{ min: P('head', -0.2, -0.16, -0.14), max: P('head', 0.2, 0.25, 0.24), res: 0.011 * s }], ao: { dist: 0.08 * s } },
    skinK: 0.05 * s,
    material: { detailScale: 1 * s, wrap: 0.5, scatterColor: 0xa04030 },
    extra: (ctx) => {
      for (const side of ['l', 'r'] as const) {
        const sx = side === 'l' ? 1 : -1;
        const m = (p: V3): V3 => [p[0] * sx, p[1], p[2]];
        const bony = surface('skin', { rough: 0.55, skin: 0.6 });
        const seg = (a: V3, b: V3, bone: string, r0: number, r1: number) =>
          ctx.gear(limbSegment(r0 * s, r1 * s, 1, 0.3, 6, 5), { bone: `${bone}_${side}`, color: 0x2e201c, mat: bony, matrix: segmentMatrix(m(a), m(b)) });
        seg(wing.shoulder, wing.elbow, 'hum', 0.045, 0.032);
        seg(wing.elbow, wing.wrist, 'arm', 0.032, 0.022);
        wing.tips.forEach((tip, k) => seg(wing.wrist, tip, `f${k + 2}`, 0.016, 0.006));
        ctx.add(membrane(rig, wing, side));
      }
    },
    hair: (r) => batFur(r, s),
    hairMaterial: { roughness: 0.85, anisotropy: 0.3, sheen: 0.25, sheenColor: 0x3a2c24, alphaTest: 0.4 },
  });
  const ps = c.pose;
  const I = (n: string) => ps.i(n);
  const ws: WingSample = wingFlap(0);
  const Y = new THREE.Vector3(0, 1, 0);
  const Z = new THREE.Vector3(0, 0, 1);
  const q = new THREE.Quaternion();
  const q2 = new THREE.Quaternion();
  const pose = (anim: string, t: number) => {
    ps.reset();
    let amp = 1;
    let phase = t * 1.4;
    if (anim === 'glide') {
      amp = 0.15;
      phase = 0.12 + Math.sin(t * 0.8) * 0.03;
    }
    if (anim === 'perch') {
      amp = 0;
    }
    wingFlap(phase, amp, ws);
    const fold = anim === 'perch' ? 1 : 0;
    ps.offset[I('body')].set(0, ws.bob * s, 0);
    ps.euler(I('body'), -0.1 + Math.sin(phase * Math.PI * 2) * 0.04 * amp, 0, Math.sin(t * 0.5) * 0.05);
    ps.euler(I('neck'), 0.1, 0, 0);
    ps.euler(I('head'), anim === 'screech' ? -0.3 : 0.05, Math.sin(t * 0.7) * 0.15, 0);
    ps.euler(I('jaw'), anim === 'screech' ? 0.55 + Math.sin(t * 30) * 0.05 : 0.05, 0, 0);
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
      ps.euler(I(`ear_${side}`), Math.sin(t * 2 + sx) * 0.05, 0, 0);
      // legs trail behind, feet curled
      ps.euler(I(`leg_${side}`), 0.8 - ws.bob * 2, 0, sx * 0.1);
      ps.euler(I(`foot_${side}`), 0.6, 0, 0);
    }
    c.update(1 / 60);
  };
  return { creature: c, object: c.root, animations: ['fly', 'glide', 'screech', 'perch'], pose };
}
