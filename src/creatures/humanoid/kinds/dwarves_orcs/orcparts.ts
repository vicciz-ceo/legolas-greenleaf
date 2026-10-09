/**
 * Parts shared by the orc-like kinds (orc, goblin, gundabad): bared uneven teeth, eye rings, body
 * scars and war paint, crude rusty plates, spiked pauldrons, bone necklaces.
 */
import * as THREE from 'three';
import type { Rng } from '../../../../core/rng';
import type { V3 } from '../../../kit/sdf';
import type { SurfaceName, SurfaceSpec } from '../../../kit/surfaces';
import type { KindContext } from '../../types';
import { mat4, put, shell, spike, studs, torsoShell } from './armor';
import { IRON } from './headgear';
import { devSkip, shade } from './common';

/** uneven fangs showing over the lips (upper teeth hang down, lower ones jut up) */
export function orcTeeth(ctx: KindContext, rng: Rng, o: { n?: number; big?: number; color?: number } = {}) {
  const { P, sculpt: s } = ctx;
  const u = P.headH;
  const my = -0.4;
  const n = o.n ?? 6;
  const big = o.big ?? 1;
  const col = o.color ?? 0xc9b88a;
  for (let i = 0; i < n; i++) {
    const sd = i % 2 ? -1 : 1;
    const x = sd * (0.02 + rng.float() * 0.075);
    const lower = rng.float() > 0.4;
    const len = (0.025 + rng.float() * 0.05) * big;
    const lean = (rng.float() - 0.5) * 0.04;
    if (lower) {
      s.cone(P.h(x, my - 0.022, 0.37 + rng.float() * 0.02), P.h(x + lean, my - 0.022 + len, 0.38 + rng.float() * 0.03), 0.0085 * u * (0.7 + big * 0.3), 0.0035 * u, { bone: 'jaw', color: col, mat: 'teeth', k: 0.003 * u });
    } else {
      s.cone(P.h(x, my + 0.018, 0.375), P.h(x + lean, my + 0.018 - len, 0.385 + rng.float() * 0.03), 0.0085 * u * (0.7 + big * 0.3), 0.0035 * u, { bone: 'head', color: col, mat: 'teeth', k: 0.003 * u });
    }
  }
}

/** dark, sunken rings round the eyes */
export function eyeRings(ctx: KindContext, color: number, strength = 0.55) {
  const { P, sculpt: s } = ctx;
  const u = P.headH;
  s.mirrored(() => s.ellipsoid(P.h(0.135, -0.07, 0.31), [0.1 * u, 0.065 * u, 0.06 * u], { op: 'paint', color, mat: 'skin_orc', bone: 'head', k: 0.04 * u, strength }));
}

/** a point on the front (or back) of the ribcage ellipsoid at (x, y) for painting */
export function ribsPoint(ctx: KindContext, x: number, y: number, back = false): V3 {
  const { P } = ctx;
  const b = P.build;
  const g = b.bulk;
  const s = P.s;
  const cy = P.j.chest[1] + 0.075 * s;
  const rx = 0.142 * s * b.shoulders * g;
  const ry = 0.165 * s;
  const rz = 0.103 * s * b.chest * g;
  const k = 1 - (x / rx) ** 2 - ((y - cy) / ry) ** 2;
  const z = 0.004 * s + Math.sqrt(Math.max(0.01, k)) * rz * (back ? -1 : 1);
  return [x, y, z];
}

/** scars (and paint stripes) across the torso */
export function bodyMarks(ctx: KindContext, rng: Rng, o: { scars?: number; color?: number; paint?: number; paintColor?: number; width?: number; back?: boolean }) {
  const { P, sculpt: s } = ctx;
  const sc = P.s;
  const cy = P.j.chest[1] + 0.075 * sc;
  for (let i = 0; i < (o.scars ?? 0); i++) {
    const x = rng.range(-0.1, 0.1) * sc;
    const y = cy + rng.range(-0.1, 0.1) * sc;
    const dx = rng.range(-0.08, 0.08) * sc;
    const dy = rng.range(-0.1, -0.03) * sc;
    const a = ribsPoint(ctx, x, y, o.back);
    const b = ribsPoint(ctx, x + dx, y + dy, o.back);
    s.cone(a, b, 0.006 * sc, 0.004 * sc, { op: 'paint', color: o.color ?? 0x3a2220, mat: 'skin_orc', bone: 'chest', k: 0.004 * sc, strength: 0.85 });
  }
  for (let i = 0; i < (o.paint ?? 0); i++) {
    const x = rng.range(-0.1, 0.1) * sc;
    const y = cy + rng.range(-0.12, 0.1) * sc;
    const a = ribsPoint(ctx, x - 0.05 * sc, y, o.back);
    const b = ribsPoint(ctx, x + 0.05 * sc, y + rng.range(-0.05, 0.05) * sc, o.back);
    s.cone(a, b, (o.width ?? 0.009) * sc, (o.width ?? 0.009) * sc * 0.7, { op: 'paint', color: o.paintColor ?? 0xd8d4c8, mat: 'skin_orc', bone: 'chest', k: 0.004 * sc, strength: 0.9 });
  }
}

/** crude plate over one shoulder: layered, dented, with rivets and optional spikes */
export function crudePauldron(ctx: KindContext, side: 'l' | 'r', o: { color: number; mat?: SurfaceName | SurfaceSpec; layers?: number; size?: number; spikes?: number; rng: Rng; trim?: number }) {
  const { P } = ctx;
  const s = P.s;
  const g = Math.sqrt(P.build.bulk);
  const sx = side === 'l' ? 1 : -1;
  const sh = P.j[`upperarm_${side}`];
  const layers = o.layers ?? 2;
  for (let k = 0; k < layers; k++) {
    const R = (0.1 - k * 0.008) * s * g * (o.size ?? 1) * (0.92 + o.rng.float() * 0.16);
    const geo = shell(R, R * 0.72, R * 1.0, { th0: 0.0, th1: Math.PI * (0.42 - k * 0.04), w: 9, h: 5 });
    // dent / jag the rim
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      if (y < R * 0.72 * Math.cos(Math.PI * (0.42 - k * 0.04)) + 0.004) {
        pos.setY(i, y - (o.rng.float() - 0.3) * 0.012 * s);
        pos.setX(i, pos.getX(i) * (1 + (o.rng.float() - 0.5) * 0.08));
      }
    }
    geo.computeVertexNormals();
    const m = new THREE.Matrix4()
      .makeTranslation(sh[0] + sx * 0.012 * s, sh[1] + (0.012 - k * 0.034) * s, sh[2])
      .multiply(new THREE.Matrix4().makeRotationZ(-sx * (0.55 + k * 0.12 + (o.rng.float() - 0.5) * 0.12)))
      .multiply(new THREE.Matrix4().makeRotationY((o.rng.float() - 0.5) * 0.3));
    put(ctx, geo, { bone: `upperarm_${side}`, color: o.color, mat: o.mat ?? IRON, matrix: m });
    const pts: V3[] = [];
    for (let i = 0; i < 4; i++) {
      const a = -0.8 + i * 0.55;
      pts.push([sh[0] + sx * 0.012 * s + sx * Math.sin(0.9) * R * 0.78 * Math.cos(a) * 0.5 + sx * 0.02 * s, sh[1] + (0.04 - k * 0.034) * s, sh[2] + Math.sin(a) * R * 0.7]);
    }
    const rv = studs(pts, 0.0055 * s);
    if (rv) put(ctx, rv, { bone: `upperarm_${side}`, color: o.trim ?? 0x6a5a46, mat: 'metal_dark', small: true });
  }
  for (let i = 0; i < (o.spikes ?? 0); i++) {
    const t = (o.spikes ?? 1) === 1 ? 0 : i / ((o.spikes ?? 1) - 1) - 0.5;
    put(ctx, spike([sh[0] + sx * (0.03 + Math.abs(t) * 0.02) * s, sh[1] + 0.07 * s, sh[2] + t * 0.1 * s], [sx * (0.3 + Math.abs(t)), 1, t * 0.6], (0.06 + o.rng.float() * 0.05) * s, 0.0125 * s, 5), { bone: `upperarm_${side}`, color: o.trim ?? 0x4a4038, mat: 'metal_rusty', small: true });
  }
}

/** a scrap breastplate: a jagged, dented sheet over the front of the ribcage held by straps */
export function scrapBreastplate(ctx: KindContext, o: { color: number; rng: Rng; y0?: number; y1?: number; half?: number; jag?: number; mat?: SurfaceName | SurfaceSpec; seed?: number; colorFn?: (p: THREE.Vector3, n: THREE.Vector3, c: THREE.Color) => void; sides?: boolean; thick?: number }) {
  const { P } = ctx;
  const s = P.s;
  const b = P.build;
  const g = b.bulk;
  const cy = P.j.chest[1];
  const gap = (o.thick ?? 0.014) * s;
  const geo = torsoShell({
    rx: 0.146 * s * b.shoulders * g + gap,
    rz: 0.104 * s * b.chest * g + gap,
    cz: 0.004 * s,
    y0: o.y0 ?? cy - 0.04 * s,
    y1: o.y1 ?? cy + 0.18 * s,
    a0: -(o.half ?? 0.95),
    a1: o.half ?? 0.95,
    nA: 9,
    nY: 3,
    jag: (o.jag ?? 0.03) * s,
    dent: 0.006 * s,
    seed: o.seed ?? 3,
    taperTop: -0.12,
    taperBottom: 0.05,
  });
  put(ctx, geo, { bone: 'chest', color: o.color, mat: o.mat ?? IRON, colorFn: o.colorFn, ao: 0.9 });
  const rv: V3[] = [];
  const half = o.half ?? 0.95;
  for (const f of [-0.85, 0.85]) {
    const a = f * half;
    rv.push([Math.sin(a) * (0.146 * s * b.shoulders * g + gap), cy + 0.13 * s, 0.004 * s + Math.cos(a) * (0.104 * s * b.chest * g + gap)]);
    rv.push([Math.sin(a) * (0.146 * s * b.shoulders * g + gap), cy + 0.0 * s, 0.004 * s + Math.cos(a) * (0.104 * s * b.chest * g + gap)]);
  }
  const rg = studs(rv, 0.0065 * s);
  if (rg) put(ctx, rg, { bone: 'chest', color: 0x6a5a46, mat: 'metal_dark', small: true });
}

/** a necklace of small bones/teeth round the neck */
export function boneNecklace(ctx: KindContext, o: { rng: Rng; n?: number; color?: number; cord?: number }) {
  const { P } = ctx;
  const s = P.s;
  const ny = P.j.neck[1];
  const n = o.n ?? 9;
  const r = (0.075 * P.build.neckThick * Math.sqrt(P.build.bulk) + 0.032) * s;
  const cord = new THREE.TorusGeometry(r, 0.003 * s, 4, 18).rotateX(Math.PI / 2).scale(1, 1, 1.25).translate(0, ny - 0.015 * s, 0.015 * s);
  put(ctx, cord, { bone: 'chest', color: o.cord ?? 0x2a2018, mat: 'leather_worn', small: true });
  for (let i = 0; i < n; i++) {
    const a = -1.1 + (i / (n - 1)) * 2.2;
    const x = Math.sin(a) * r;
    const z = Math.cos(a) * r * 1.25 + 0.015 * s;
    const len = (0.025 + o.rng.float() * 0.02) * s;
    put(ctx, spike([x, ny - 0.015 * s, z], [Math.sin(a) * 0.3, -1, Math.cos(a) * 0.4 + 0.2], len, 0.006 * s, 4), { bone: 'chest', color: o.color ?? 0xcfc4a2, mat: 'bone', small: true });
  }
}

void mat4;

/**
 * Patchy skin: soft paint blobs in `tones` over the head, neck, upper arms and (optionally) the
 * chest/back, so no two bucket looks share one flat skin colour.
 */
export function skinMottle(ctx: KindContext, rng: Rng, tones: number[], o: { n?: number; strength?: number; torso?: boolean; mat?: SurfaceName; dim?: number } = {}) {
  const { P, sculpt: s } = ctx;
  const sc = P.s;
  const u = P.headH;
  const n = o.n ?? 10;
  const str = o.strength ?? 0.4;
  const mat = o.mat ?? 'skin_orc';
  const pick = () => shade(tones[Math.floor(rng.float() * tones.length)], o.dim ?? 1);
  // head and neck
  for (let i = 0; i < Math.ceil(n * 0.5); i++) {
    const c = P.h(rng.range(-0.25, 0.25), rng.range(-0.45, 0.25), rng.range(0.0, 0.4));
    s.ellipsoid(c, [rng.range(0.06, 0.13) * u, rng.range(0.05, 0.1) * u, rng.range(0.06, 0.1) * u], { op: 'paint', color: pick(), mat, bone: 'head', k: 0.05 * u, strength: str });
  }
  // upper arms and forearms
  for (const sd of ['l', 'r'] as const) {
    const a = P.j[`upperarm_${sd}`];
    const b = P.j[`hand_${sd}`];
    for (let i = 0; i < Math.ceil(n * 0.35); i++) {
      const t = rng.range(0.05, 0.95);
      const c: V3 = [a[0] + (b[0] - a[0]) * t + rng.range(-0.02, 0.02) * sc, a[1] + (b[1] - a[1]) * t, a[2] + rng.range(-0.03, 0.03) * sc];
      s.ellipsoid(c, [rng.range(0.03, 0.06) * sc, rng.range(0.03, 0.06) * sc, rng.range(0.03, 0.06) * sc], { op: 'paint', color: pick(), mat, bone: t < 0.5 ? `upperarm_${sd}` : `forearm_${sd}`, k: 0.03 * sc, strength: str });
    }
  }
  if (o.torso) {
    const cy = P.j.chest[1] + 0.05 * sc;
    for (let i = 0; i < n; i++) {
      const back = rng.float() > 0.5;
      const p = ribsPoint(ctx, rng.range(-0.1, 0.1) * sc, cy + rng.range(-0.12, 0.12) * sc, back);
      s.ellipsoid(p, [rng.range(0.04, 0.08) * sc, rng.range(0.03, 0.07) * sc, 0.04 * sc], { op: 'paint', color: pick(), mat, bone: 'chest', k: 0.035 * sc, strength: str });
    }
  }
}

/**
 * Re-tint the exposed skin of a bucket look (head, neck, arms, hands, chest) with a two-colour
 * mottled paint. Call it FIRST in the extras so garments, teeth and markings added afterwards
 * keep their own colours. `torso: false` leaves the body under garments alone.
 */
export function skinTint(ctx: KindContext, o: { color: number; color2: number; noise?: number; strength?: number; torso?: boolean; legs?: boolean; mat?: SurfaceName; freq?: number; dim?: number; /** upper-arm tint starts this far down the arm (clear of a sleeve) */ sleeve?: number; /** leg tint only over this stretch of hip → foot (clear of a kilt and wraps) */ legRange?: [number, number] }) {
  const { P, sculpt: s } = ctx;
  const sc = P.s;
  const u = P.headH;
  const mat = o.mat ?? 'skin_orc';
  const str = o.strength ?? 0.85;
  const base = { op: 'paint' as const, color: shade(o.color, o.dim ?? 1), color2: shade(o.color2, o.dim ?? 1), colorNoise: o.noise ?? 0.55, colorFreq: (o.freq ?? 16) / sc, mat, strength: str };
  s.ellipsoid(P.h(0, -0.1, 0.05), [0.52 * u, 0.62 * u, 0.55 * u], { ...base, bone: 'head', k: 0.04 * u });
  s.cone([0, P.j.neck[1] - 0.02 * sc, -0.02 * sc], [0, P.j.head[1] + 0.02 * sc, 0], 0.075 * sc * P.build.neckThick, 0.07 * sc * P.build.neckThick, { ...base, bone: 'neck', k: 0.03 * sc });
  for (const sd of ['l', 'r'] as const) {
    const a = P.j[`upperarm_${sd}`];
    const e = P.j[`forearm_${sd}`];
    const w = P.j[`hand_${sd}`];
    const f = o.sleeve ?? 0;
    const a0: [number, number, number] = [a[0] + (e[0] - a[0]) * f, a[1] + (e[1] - a[1]) * f, a[2] + (e[2] - a[2]) * f];
    s.cone(a0, e, 0.075 * sc, 0.065 * sc, { ...base, bone: `upperarm_${sd}`, k: (f > 0 ? 0.012 : 0.03) * sc });
    s.cone(e, [w[0] + (w[0] - e[0]) * 0.5, w[1] + (w[1] - e[1]) * 0.5, w[2]], 0.06 * sc, 0.05 * sc, { ...base, bone: `forearm_${sd}`, k: 0.03 * sc });
  }
  if (o.torso !== false && !devSkip('torsotint')) {
    const hipY = P.j.thigh_l[1];
    const shY = P.j.upperarm_l[1];
    s.ellipsoid([0, (hipY + shY) / 2 + 0.05 * sc, 0], [0.24 * sc * P.build.shoulders, (shY - hipY) / 2 + 0.02 * sc, 0.2 * sc * P.build.bulk], { ...base, bone: 'chest', k: 0.11 * sc, strength: str * 0.9 });
  }
  if (o.legs) {
    const [r0, r1] = o.legRange ?? [0, 1];
    for (const sd of ['l', 'r'] as const) {
      const t = P.j[`thigh_${sd}`], f = P.j[`foot_${sd}`];
      const at = (k: number): [number, number, number] => [t[0] + (f[0] - t[0]) * k, t[1] + (f[1] - t[1]) * k, t[2] + (f[2] - t[2]) * k];
      s.cone(at(r0), at(r1), 0.1 * sc * (1 - 0.3 * r0), 0.06 * sc + 0.04 * sc * (1 - r1), { ...base, bone: `shin_${sd}`, k: (o.legRange ? 0.012 : 0.03) * sc });
    }
  }
}
