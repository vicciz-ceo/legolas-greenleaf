/**
 * Rigid gear & armour. Every piece is a plain BufferGeometry painted with kit attributes and
 * skinned 100% to one bone, then merged into the body mesh (one draw call). `small` pieces are
 * dropped at LOD2.
 */
import * as THREE from 'three';
import { paintGeometry } from '../kit/geometry';
import type { RigDef } from '../kit/rig';
import type { SurfaceName, SurfaceSpec } from '../kit/surfaces';
import type { V3 } from '../kit/sdf';
import type { Proportions } from './proportions';
import type { ArmorPiece, ArmorStyle, ResolvedKind } from './types';
import type { Rng } from '../../core/rng';

export interface GearPiece {
  geo: THREE.BufferGeometry;
  small: boolean;
}

export interface GearSink {
  add(geo: THREE.BufferGeometry, o: { bone: string; color: number; mat?: SurfaceName | SurfaceSpec; matrix?: THREE.Matrix4; small?: boolean; colorFn?: (p: THREE.Vector3, n: THREE.Vector3, c: THREE.Color) => void; ao?: number }): void;
}

export function makeGearSink(rig: RigDef, out: GearPiece[]): GearSink {
  return {
    add(geo, o) {
      const bi = rig.boneIndex(o.bone);
      if (bi < 0) throw new Error(`[humanoid] gear bone ${o.bone} missing`);
      out.push({ geo: paintGeometry(geo, { color: o.color, mat: o.mat ?? 'leather', bone: bi, matrix: o.matrix, colorFn: o.colorFn, ao: o.ao ?? 0.9 }), small: !!o.small });
      geo.dispose();
    },
  };
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();

/** matrix placing local +Y along `dir` at `pos`, local +Z toward `fwd` (approximately) */
export function placeAlong(pos: V3, dir: THREE.Vector3, fwd: THREE.Vector3 = new THREE.Vector3(0, 0, 1), scale = 1): THREE.Matrix4 {
  const y = dir.clone().normalize();
  const z = fwd.clone().addScaledVector(y, -fwd.dot(y));
  if (z.lengthSq() < 1e-6) z.set(1, 0, 0);
  z.normalize();
  const x = new THREE.Vector3().crossVectors(y, z);
  return new THREE.Matrix4().makeBasis(x, y, z).scale(new THREE.Vector3(scale, scale, scale)).setPosition(pos[0], pos[1], pos[2]);
}

function lathe(profile: [number, number][], seg: number, phi0 = 0, phiLen = Math.PI * 2): THREE.BufferGeometry {
  return new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), seg, phi0, phiLen);
}

// ─────────────────────────────────────────────────────────────────────────────
// Archery gear (quiver, arrows, knives)
// ─────────────────────────────────────────────────────────────────────────────

export interface QuiverOpts {
  /** model-space centre and axis (bottom → top) */
  center: V3;
  axis: THREE.Vector3;
  length: number;
  radius: number;
  color: number;
  trim: number;
  arrows: number;
  fletch: number;
  shaft?: number;
  bone: string;
  knives?: { handle: number; guard: number } | null;
  /** add only the knife sheaths (the knives are separate objects, e.g. hidden when drawn) */
  sheathsOnly?: boolean;
  seed: number;
}

/** model matrix of a knife sheath on the quiver (side ±1); knife grip origin = matrix × (0, 0.11, 0) */
export function quiverSheathMatrix(o: QuiverOpts, side: number): THREE.Matrix4 {
  const base = placeAlong(o.center, o.axis, new THREE.Vector3(0, 0, -1));
  const off = new THREE.Matrix4().makeTranslation(side * (o.radius + 0.016), o.length * 0.08, -0.004);
  const tilt = new THREE.Matrix4().makeRotationZ(side * -0.08);
  return base.multiply(off).multiply(tilt);
}

/** an arrow sticking out of a quiver (local: +Y up the shaft, nock at y=0) */
export function arrowGeometryParts(len: number, fletchColor: number, shaftColor: number, sink: GearSink, matrix: THREE.Matrix4, bone: string, small: boolean) {
  const shaft = new THREE.CylinderGeometry(0.0042, 0.0042, len, 5, 1, true).translate(0, len / 2, 0);
  sink.add(shaft, { bone, color: shaftColor, mat: 'wood', matrix, small });
  const nock = new THREE.CylinderGeometry(0.005, 0.0045, 0.014, 5).translate(0, 0.004, 0);
  sink.add(nock, { bone, color: 0x2a2420, mat: 'horn', matrix, small: true });
  // three vanes
  for (let i = 0; i < 3; i++) {
    const vane = new THREE.BufferGeometry();
    const a = (i / 3) * Math.PI * 2;
    const ca = Math.cos(a), sa = Math.sin(a);
    const pts = [
      [0.004, 0.02], [0.016, 0.035], [0.017, 0.11], [0.004, 0.125],
    ];
    const verts: number[] = [];
    for (const [r, y] of pts) verts.push(ca * r, y, sa * r);
    vane.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    vane.setIndex([0, 1, 2, 0, 2, 3, 0, 2, 1, 0, 3, 2]);
    vane.computeVertexNormals();
    sink.add(vane, { bone, color: fletchColor, mat: 'linen', matrix, small: true });
  }
}

export function quiverGear(sink: GearSink, o: QuiverOpts) {
  const L = o.length;
  const r = o.radius;
  const prof: [number, number][] = [
    [0.0, -L / 2], [r * 0.82, -L / 2], [r * 0.9, -L / 2 + 0.008], [r * 0.92, -L / 2 + 0.04],
    [r * 1.0, 0], [r * 1.05, L / 2 - 0.03], [r * 1.12, L / 2 - 0.012], [r * 1.12, L / 2], [r * 0.98, L / 2 + 0.002], [r * 0.95, L / 2 - 0.02],
  ];
  const base = placeAlong(o.center, o.axis, new THREE.Vector3(0, 0, -1));
  const bands = [-0.42, -0.3, 0.3, 0.42].map((t) => t * L);
  const trim = new THREE.Color().setHex(o.trim, THREE.SRGBColorSpace);
  sink.add(lathe(prof, 14), {
    bone: o.bone,
    color: o.color,
    mat: 'leather',
    matrix: base,
    colorFn: (p, _n, c) => {
      // tooled bands (computed in model space back to local via axis projection)
      const ax = o.axis.clone().normalize();
      const local = (p.x - o.center[0]) * ax.x + (p.y - o.center[1]) * ax.y + (p.z - o.center[2]) * ax.z;
      for (const b of bands) if (Math.abs(local - b) < 0.012) c.lerp(trim, 0.85);
      if (local > L / 2 - 0.02) c.lerp(trim, 0.6);
    },
  });
  // arrows
  const rnd = new THREE.Vector2();
  for (let i = 0; i < o.arrows; i++) {
    const a = (i / o.arrows) * Math.PI * 2 * 2.618;
    const rr = r * 0.62 * Math.sqrt((i + 0.5) / o.arrows);
    rnd.set(Math.cos(a) * rr, Math.sin(a) * rr);
    const out = 0.17 + ((i * 37) % 11) * 0.006;
    const m = placeAlong([0, 0, 0], new THREE.Vector3(rnd.x * 0.8, 1, rnd.y * 0.8), new THREE.Vector3(Math.cos(a * 1.7), 0, Math.sin(a * 1.7)));
    m.setPosition(rnd.x, L / 2 + out - 0.62, rnd.y);
    const mm = base.clone().multiply(m);
    arrowGeometryParts(0.62, o.fletch, o.shaft ?? 0xb8a07a, sink, mm, o.bone, true);
  }
  // knife sheaths with white handles on both sides
  if (o.knives || o.sheathsOnly) {
    for (const side of [1, -1]) {
      const off = new THREE.Matrix4().makeTranslation(side * (r + 0.016), L * 0.08, -0.004);
      const tilt = new THREE.Matrix4().makeRotationZ(side * -0.08);
      const mm = base.clone().multiply(off).multiply(tilt);
      // sheath: flattened tapered tube
      const sheath = lathe([[0.0, -0.17], [0.006, -0.17], [0.016, -0.12], [0.019, 0.02], [0.02, 0.1], [0.018, 0.105], [0.0, 0.105]], 8).scale(1, 1, 0.55);
      sink.add(sheath, { bone: o.bone, color: o.color, mat: 'leather', matrix: mm });
      if (!o.knives) continue;
      const guard = new THREE.BoxGeometry(0.05, 0.009, 0.016).translate(0, 0.112, 0);
      sink.add(guard, { bone: o.bone, color: o.knives.guard, mat: 'metal', matrix: mm, small: true });
      const handle = lathe([[0.0, 0.116], [0.011, 0.118], [0.012, 0.15], [0.0105, 0.19], [0.0125, 0.215], [0.006, 0.226], [0.0, 0.227]], 8).scale(1, 1, 0.8);
      sink.add(handle, { bone: o.bone, color: o.knives.handle, mat: 'bone', matrix: mm, small: true });
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Armour
// ─────────────────────────────────────────────────────────────────────────────

interface StyleLook {
  color: number;
  trim: number;
  mat: SurfaceName;
  spikes: boolean;
  crude: boolean;
}
const LOOK: Record<ArmorStyle, StyleLook> = {
  elven: { color: 0xb8a878, trim: 0xd8c690, mat: 'gold', spikes: false, crude: false },
  king: { color: 0xc0a868, trim: 0xe0d0a0, mat: 'gold', spikes: false, crude: false },
  orc: { color: 0x4a4038, trim: 0x2e2620, mat: 'metal_rusty', spikes: true, crude: true },
  goblin: { color: 0x4a4038, trim: 0x2e2620, mat: 'metal_rusty', spikes: true, crude: true },
  gundabad: { color: 0x3e3a36, trim: 0x22201e, mat: 'metal_rusty', spikes: true, crude: true },
  uruk: { color: 0x34322f, trim: 0x1c1b1a, mat: 'metal_dark', spikes: false, crude: false },
  rohan: { color: 0x8a8274, trim: 0xb08a48, mat: 'metal', spikes: false, crude: false },
  gondor: { color: 0x9a9890, trim: 0xc8c4b8, mat: 'metal', spikes: false, crude: false },
  dwarf: { color: 0x7a6a50, trim: 0xb08a40, mat: 'metal', spikes: false, crude: false },
  easterling: { color: 0x8a6a30, trim: 0xb89040, mat: 'gold', spikes: true, crude: false },
  haradrim: { color: 0x7a5a38, trim: 0xb08848, mat: 'gold', spikes: false, crude: false },
  ranger: { color: 0x4a3a2a, trim: 0x2a2018, mat: 'leather', spikes: false, crude: false },
};

export function armorGear(sink: GearSink, P: Proportions, def: ResolvedKind, pieces: ArmorPiece[], rng: Rng, helmet: boolean): { helmet: boolean; helmetRimY: number } {
  const s = P.s;
  const u = P.headH;
  const j = P.j;
  const g = Math.sqrt(P.build.bulk);
  let hasHelmet = false;
  let rim = 99;
  for (const pc of pieces) {
    const look = LOOK[pc.style];
    const color = pc.color ?? look.color;
    const mat = look.mat;
    const jag = (scale: number) => (look.crude ? 1 + (rng.float() - 0.5) * 0.12 * scale : 1);
    switch (pc.type) {
      case 'helmet': {
        if (!helmet) break;
        hasHelmet = true;
        const R = 0.37 * u * jag(1);
        const tall = pc.style === 'gondor' ? 1.35 : pc.style === 'rohan' || pc.style === 'easterling' ? 1.25 : pc.style === 'dwarf' ? 1.05 : 1.0;
        const prof: [number, number][] = [];
        const pointy = pc.style === 'easterling' || pc.style === 'rohan' || pc.style === 'gundabad';
        for (let i = 0; i <= 10; i++) {
          const a = (i / 10) * (Math.PI / 2);
          let rr = Math.cos(a) * R;
          let yy = Math.sin(a) * R * tall;
          if (pointy && i > 6) rr *= 1 - (i - 6) * 0.05;
          prof.push([Math.max(0.001, rr), yy]);
        }
        prof.reverse();
        prof.push([R * 1.02, -0.01 * u], [R * 1.05, -0.035 * u]);
        if (pc.style === 'dwarf' || pc.style === 'rohan') prof.push([R * 1.12, -0.04 * u]);
        const geo = lathe(prof.map(([r2, y2]) => [r2, y2]) as [number, number][], 16).scale(1, 1, 1.12);
        const m = new THREE.Matrix4().makeTranslation(...P.h(0, 0.06, -0.05));
        sink.add(geo, { bone: 'head', color, mat, matrix: m });
        rim = 0.02;
        // nasal guard / cheek guards / crest / spikes / face mask
        if (pc.style !== 'haradrim') {
          const nasal = new THREE.BoxGeometry(0.022 * u * 3, 0.24 * u, 0.012 * u * 3).translate(0, -0.06 * u, 0);
          sink.add(nasal, { bone: 'head', color: look.trim, mat, matrix: new THREE.Matrix4().makeTranslation(...P.h(0, -0.02, 0.43)).multiply(new THREE.Matrix4().makeRotationX(-0.12)), small: true });
        }
        if (pc.style === 'rohan' || pc.style === 'gondor' || pc.style === 'uruk' || pc.style === 'dwarf') {
          for (const sx of [1, -1]) {
            const cheek = new THREE.BoxGeometry(0.035 * u, 0.3 * u, 0.22 * u).translate(0, -0.12 * u, 0);
            sink.add(cheek, { bone: 'head', color, mat, matrix: new THREE.Matrix4().makeTranslation(...P.h(0.33 * sx, -0.08, 0.12)).multiply(new THREE.Matrix4().makeRotationZ(sx * 0.12)), small: true });
          }
        }
        if (pc.style === 'gondor') {
          const crest = new THREE.BoxGeometry(0.02 * u, 0.22 * u, 0.7 * u);
          sink.add(crest, { bone: 'head', color: look.trim, mat, matrix: new THREE.Matrix4().makeTranslation(...P.h(0, 0.5, -0.05)), small: true });
          for (const sx of [1, -1]) {
            const wing = new THREE.BoxGeometry(0.012 * u, 0.32 * u, 0.12 * u).translate(0, 0.16 * u, 0);
            sink.add(wing, { bone: 'head', color: 0xe8e4dc, mat: 'metal', matrix: new THREE.Matrix4().makeTranslation(...P.h(0.36 * sx, 0.08, 0.0)).multiply(new THREE.Matrix4().makeRotationZ(-sx * 0.35)), small: true });
          }
        }
        if (look.spikes || pc.style === 'easterling') {
          const spike = new THREE.ConeGeometry(0.035 * u * 1.5, 0.3 * u, 6).translate(0, 0.15 * u, 0);
          sink.add(spike, { bone: 'head', color: look.trim, mat, matrix: new THREE.Matrix4().makeTranslation(...P.h(0, 0.06 + R / u * tall - 0.02, -0.05)), small: true });
        }
        if (pc.style === 'uruk') {
          // white hand painted later by dressers; give a face plate
          const plate = new THREE.BoxGeometry(0.5 * u, 0.12 * u, 0.05 * u);
          sink.add(plate, { bone: 'head', color, mat, matrix: new THREE.Matrix4().makeTranslation(...P.h(0, 0.08, 0.42)), small: true });
        }
        break;
      }
      case 'circlet':
      case 'crown': {
        const R = 0.345 * u;
        const ring = new THREE.TorusGeometry(R, 0.012 * u * 2, 6, 28).rotateX(Math.PI / 2).scale(1, 1, 1.15);
        sink.add(ring, { bone: 'head', color: pc.color ?? look.trim, mat: 'gold', matrix: new THREE.Matrix4().makeTranslation(...P.h(0, 0.16, -0.03)) });
        if (pc.type === 'crown') {
          // Thranduil-like crown of branches/leaves
          for (let i = 0; i < 11; i++) {
            const a = (i / 11) * Math.PI * 2;
            const h = (0.18 + 0.12 * Math.abs(Math.cos(a * 1.5))) * u;
            const twig = new THREE.ConeGeometry(0.018 * u, h, 4).translate(0, h / 2, 0);
            const m = new THREE.Matrix4().makeTranslation(...P.h(Math.sin(a) * 0.345, 0.16, -0.03 + Math.cos(a) * 0.39)).multiply(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(Math.cos(a) * 0.35, 0, -Math.sin(a) * 0.35)));
            sink.add(twig, { bone: 'head', color: pc.color ?? 0x7a5a30, mat: 'wood', matrix: m, small: true });
          }
        }
        break;
      }
      case 'pauldrons': {
        for (const side of ['l', 'r'] as const) {
          const sx = side === 'l' ? 1 : -1;
          const sh = j[`upperarm_${side}`];
          const layers = pc.style === 'gondor' || pc.style === 'rohan' ? 3 : pc.style === 'uruk' ? 1 : 2;
          for (let k = 0; k < layers; k++) {
            const R = (0.095 + 0.012 * k) * s * g * jag(1) * (pc.style === 'uruk' ? 1.25 : 1);
            const geo = new THREE.SphereGeometry(R, 12, 6, 0, Math.PI * 2, 0, Math.PI * (0.38 - k * 0.04)).scale(1, 0.75, 1.05);
            const m = new THREE.Matrix4()
              .makeTranslation(sh[0] + sx * 0.012 * s, sh[1] + (0.01 - k * 0.035) * s, sh[2])
              .multiply(new THREE.Matrix4().makeRotationZ(-sx * (0.55 + k * 0.12)));
            sink.add(geo, { bone: `upperarm_${side}`, color: k === layers - 1 ? color : color, mat, matrix: m, colorFn: look.crude ? undefined : (p, _n, c) => (p.y < sh[1] - (k * 0.035 + 0.03) * s ? c.setHex(look.trim, THREE.SRGBColorSpace) : c) });
          }
          if (look.spikes) {
            for (let k = 0; k < 3; k++) {
              const sp = new THREE.ConeGeometry(0.012 * s, 0.07 * s * jag(2), 5).translate(0, 0.035 * s, 0);
              const m = new THREE.Matrix4().makeTranslation(sh[0] + sx * 0.03 * s, sh[1] + 0.07 * s, sh[2] + (k - 1) * 0.04 * s).multiply(new THREE.Matrix4().makeRotationZ(-sx * 0.6));
              sink.add(sp, { bone: `upperarm_${side}`, color: look.trim, mat, matrix: m, small: true });
            }
          }
        }
        break;
      }
      case 'breastplate':
      case 'plates': {
        // front shell from an ellipsoid segment over the ribcage
        const cy = j.chest[1] + 0.07 * s;
        const rx = 0.165 * s * P.build.shoulders * P.build.bulk + 0.02 * s;
        const ry = 0.2 * s;
        const rz = 0.115 * s * P.build.chest * P.build.bulk + 0.02 * s;
        if (pc.type === 'breastplate') {
          const geo = new THREE.SphereGeometry(1, 16, 10, -Math.PI * 0.42, Math.PI * 0.84, Math.PI * 0.18, Math.PI * 0.62).scale(rx, ry, rz);
          sink.add(geo, { bone: 'chest', color, mat, matrix: new THREE.Matrix4().makeTranslation(0, cy, 0.006 * s) });
          const back = new THREE.SphereGeometry(1, 12, 8, Math.PI * 0.62, Math.PI * 0.76, Math.PI * 0.2, Math.PI * 0.55).scale(rx, ry, rz);
          sink.add(back, { bone: 'chest', color, mat, matrix: new THREE.Matrix4().makeTranslation(0, cy, -0.006 * s), small: true });
        } else {
          // scrap plates: random small curved plates over the torso
          for (let i = 0; i < 6; i++) {
            const a = rng.range(-1.1, 1.1) + (i % 2 ? Math.PI : 0);
            const yy = cy + rng.range(-0.12, 0.1) * s;
            const pl = new THREE.BoxGeometry(rng.range(0.07, 0.11) * s, rng.range(0.06, 0.1) * s, 0.008 * s);
            const pos: V3 = [Math.sin(a) * rx * 0.98, yy, Math.cos(a) * rz * 0.98];
            const m = new THREE.Matrix4().makeTranslation(...pos).multiply(new THREE.Matrix4().makeRotationY(a)).multiply(new THREE.Matrix4().makeRotationZ(rng.range(-0.3, 0.3)));
            sink.add(pl, { bone: 'chest', color, mat, matrix: m, small: i > 2 });
          }
        }
        break;
      }
      case 'vambraces':
      case 'greaves': {
        for (const side of ['l', 'r'] as const) {
          const a = pc.type === 'vambraces' ? j[`forearm_${side}`] : j[`shin_${side}`];
          const b = pc.type === 'vambraces' ? j[`hand_${side}`] : j[`foot_${side}`];
          const dir = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
          const len = dir.length() * 0.62;
          const r0 = (pc.type === 'vambraces' ? 0.04 : 0.055) * s * P.build.bulk + 0.006 * s;
          const geo = new THREE.CylinderGeometry(r0 * 0.82, r0, len, 10, 1, true, -Math.PI * 0.75, Math.PI * 1.5);
          const mid: V3 = [a[0] + dir.x * 0.58, a[1] + dir.y * 0.58, a[2] + dir.z * 0.58];
          const fwd = pc.type === 'vambraces' ? new THREE.Vector3(side === 'l' ? -0.7 : 0.7, 0.7, 0) : new THREE.Vector3(0, 0, 1);
          const m = placeAlong(mid, dir.clone().multiplyScalar(-1), fwd);
          sink.add(geo, { bone: pc.type === 'vambraces' ? `forearm_${side}` : `shin_${side}`, color, mat, matrix: m });
        }
        break;
      }
      case 'gorget': {
        const geo = new THREE.CylinderGeometry(0.085 * s * P.build.neckThick * g, 0.13 * s * g, 0.07 * s, 14, 1, true);
        sink.add(geo, { bone: 'chest', color, mat, matrix: new THREE.Matrix4().makeTranslation(0, j.neck[1] - 0.01 * s, -0.012 * s).multiply(new THREE.Matrix4().makeScale(1.15, 1, 1)) });
        break;
      }
      case 'tassets': {
        for (const side of ['l', 'r'] as const) {
          const sx = side === 'l' ? 1 : -1;
          const t = j[`thigh_${side}`];
          const plate = new THREE.CylinderGeometry(0.1 * s * g, 0.11 * s * g, 0.14 * s, 10, 1, true, -Math.PI * 0.35, Math.PI * 0.7);
          const m = new THREE.Matrix4().makeTranslation(t[0] + sx * 0.005 * s, t[1] - 0.04 * s, t[2] + 0.01 * s);
          sink.add(plate, { bone: `thigh_${side}`, color, mat, matrix: m });
        }
        break;
      }
      case 'shoulder_spikes': {
        for (const side of ['l', 'r'] as const) {
          const sx = side === 'l' ? 1 : -1;
          const sh = j[`upperarm_${side}`];
          for (let k = 0; k < 4; k++) {
            const sp = new THREE.ConeGeometry(0.014 * s, rng.range(0.08, 0.14) * s, 5).translate(0, 0.05 * s, 0);
            const m = new THREE.Matrix4().makeTranslation(sh[0] - sx * 0.01 * s, sh[1] + 0.06 * s, sh[2] + (k - 1.5) * 0.035 * s).multiply(new THREE.Matrix4().makeRotationZ(-sx * (0.3 + k * 0.1)));
            sink.add(sp, { bone: 'chest', color: look.trim, mat, matrix: m, small: true });
          }
        }
        break;
      }
      case 'gauntlets': {
        for (const side of ['l', 'r'] as const) {
          const w = j[`hand_${side}`];
          const f = P.hand[side];
          const geo = new THREE.BoxGeometry(0.085 * s, 0.1 * s, 0.035 * s);
          const m = placeAlong(P.hp(side, 0.045 * s, 0, -0.008 * s), f.L, f.N.clone().multiplyScalar(-1));
          sink.add(geo, { bone: `hand_${side}`, color, mat, matrix: m, small: true });
          void w;
        }
        break;
      }
      case 'mask': {
        const geo = new THREE.SphereGeometry(0.4 * u, 12, 8, -Math.PI * 0.35, Math.PI * 0.7, Math.PI * 0.35, Math.PI * 0.4).scale(1, 1.1, 1);
        sink.add(geo, { bone: 'head', color, mat, matrix: new THREE.Matrix4().makeTranslation(...P.h(0, -0.1, 0.02)) });
        break;
      }
    }
  }
  return { helmet: hasHelmet, helmetRimY: rim };
}

/** small belt buckle / clasp */
export function buckleGear(sink: GearSink, P: Proportions, y: number, color: number) {
  const s = P.s;
  const z = 0.104 * s * P.build.bulk * (1 + P.build.belly * 0.4) + 0.02 * s;
  const geo = new THREE.BoxGeometry(0.045 * s, 0.038 * s, 0.008 * s);
  sink.add(geo, { bone: 'hips', color, mat: 'metal', matrix: new THREE.Matrix4().makeTranslation(0, y, z), small: true });
}

void _m;
void _q;
void _v;
