/**
 * Cave troll details (docs/refs/cave_troll): warts over the whole hide, the coarse bristles on the
 * trapezius and scalp, and the riveted iron shackle on the RIGHT ankle with its short chain.
 * Every piece is skinned to the bone whose surface it sits on, and casts that could land on a neighbouring
 * body part (an arm beside the torso) are rejected so nothing floats when the arms move.
 */
import * as THREE from 'three';
import { Rng } from '../../../../core/rng';
import type { KindContext } from '../../types';
import { V, placeAlong, spike, chainLinks, rivet, type GearFn, type Projector } from './common';
import { TROLL_PAL, HIDE, IRON_RUSTY } from './troll_pal';

const WART_GEO = new THREE.SphereGeometry(1, 5, 2, 0, Math.PI * 2, 0, Math.PI / 2);

/** a unit vector pair perpendicular to `axis` */
function perp(axis: THREE.Vector3): [THREE.Vector3, THREE.Vector3] {
  const a = Math.abs(axis.y) < 0.9 ? V(0, 1, 0) : V(1, 0, 0);
  const u = new THREE.Vector3().crossVectors(axis, a).normalize();
  const w = new THREE.Vector3().crossVectors(axis, u).normalize();
  return [u, w];
}

interface WartZone {
  /** axis end points (model space) */
  a: THREE.Vector3;
  b: THREE.Vector3;
  bone: string;
  count: number;
  /** cast distance outside the axis */
  reach: number;
  /** angular windows (radians around the axis; 0 = the first perpendicular) or all round */
  win?: [number, number][];
  /** reject hits that belong to a neighbouring part (a torso hit from an arm zone, the other leg…) */
  reject?: (p: THREE.Vector3, axisPoint: THREE.Vector3) => boolean;
}

/** warts scattered over a limb/torso segment: cast inward from outside so every wart sits on the real surface */
function zoneWarts(proj: Projector, gear: GearFn, z: WartZone, rng: Rng, sc: number) {
  const axis = z.b.clone().sub(z.a);
  const len = axis.length();
  axis.normalize();
  const [u, w] = perp(axis);
  const p = V(), n = V();
  for (let i = 0; i < z.count; i++) {
    const t = rng.float();
    const win = z.win ? z.win[Math.floor(rng.float() * z.win.length)] : ([0, Math.PI * 2] as [number, number]);
    const th = rng.range(win[0], win[1]);
    const dir = u.clone().multiplyScalar(Math.cos(th)).addScaledVector(w, Math.sin(th));
    const c = z.a.clone().addScaledVector(axis, t * len);
    const o = c.clone().addScaledVector(dir, z.reach);
    if (!proj.cast(o, dir.clone().negate(), z.reach * 1.1, p, n)) continue;
    if (z.reject?.(p, c)) continue;
    // mostly small pores, a good number of mid-size warts, a few big ones
    const k = rng.float();
    const r = (k < 0.5 ? rng.range(0.006, 0.012) : k < 0.88 ? rng.range(0.012, 0.022) : rng.range(0.022, 0.034)) * sc;
    const g = WART_GEO.clone().scale(r, r * 0.75, r);
    const m = placeAlong(p.clone().addScaledVector(n, -r * 0.18), n.clone(), V(0, 0, 1));
    gear(g, { bone: z.bone, color: rng.float() < 0.08 ? TROLL_PAL.ear : TROLL_PAL.wart, mat: HIDE, matrix: m, small: true, ao: 0.8 });
  }
}

export function caveWarts(ctx: KindContext, gear: GearFn, proj: Projector, bucket: number, density = 1) {
  const { P } = ctx;
  const sc = P.s;
  const j = P.j;
  const rng = new Rng(7000 + bucket);
  const J = (k: string) => V(...j[k]);
  const front = Math.PI, back = 0, half = 1.15;
  const sides: [number, number][] = [[back - half, back + half], [front - half, front + half]];
  const zones: WartZone[] = [
    // torso: front and back only (the sides would land on the arms); shoulders and upper back are the warty parts
    { a: J('chest').add(V(0, 0.15 * sc, 0)), b: J('chest').add(V(0, -0.1 * sc, 0)), bone: 'chest', count: 80, reach: 1.4, win: sides },
    { a: J('spine'), b: J('chest'), bone: 'spine', count: 34, reach: 1.4, win: sides },
  ];
  for (const sd of ['l', 'r'] as const) {
    const sx = sd === 'l' ? 1 : -1;
    // arms: reject anything inboard of the limb axis (that is the torso or the other limb)
    const armReject = (p: THREE.Vector3, c: THREE.Vector3) => (p.x - c.x) * sx < -0.12 * sc;
    const legReject = (p: THREE.Vector3, c: THREE.Vector3) => (p.x - c.x) * sx < -0.1 * sc;
    zones.push(
      { a: J(`upperarm_${sd}`), b: J(`forearm_${sd}`), bone: `upperarm_${sd}`, count: 60, reach: 0.9, reject: armReject },
      { a: J(`forearm_${sd}`), b: J(`hand_${sd}`), bone: `forearm_${sd}`, count: 40, reach: 0.8, reject: armReject },
      { a: J(`thigh_${sd}`), b: J(`shin_${sd}`), bone: `thigh_${sd}`, count: 32, reach: 0.9, reject: legReject },
      { a: J(`shin_${sd}`), b: J(`foot_${sd}`), bone: `shin_${sd}`, count: 24, reach: 0.8, reject: legReject },
    );
  }
  for (const z of zones) zoneWarts(proj, gear, { ...z, count: Math.round(z.count * density) }, rng, sc);
}

/** coarse dark bristles on the crown and the trapezius (details tile "hair / bristles"): a short, dense, slightly curved mat */
export function caveBristles(ctx: KindContext, gear: GearFn, proj: Projector, bucket: number) {
  const { P } = ctx;
  const sc = P.s;
  const j = P.j;
  const rng = new Rng(8100 + bucket);
  const p = V(), n = V();
  const tuft = (bone: string, len: number) => {
    // lean tangentially (back and along the surface) instead of standing straight out
    const dir = n.clone().multiplyScalar(0.4).add(V(0, 0.2, -0.45)).normalize();
    gear(spike(0.0022 * sc, len, 3, 0.35), { bone, color: rng.float() < 0.5 ? TROLL_PAL.bristle : 0x4a3e32, mat: HIDE, matrix: placeAlong(p.clone().addScaledVector(n, -0.004 * sc), dir, V(0, 0, 1)), small: true });
  };
  // crown, over the skull from above (bone: head)
  for (let i = 0; i < 30; i++) {
    const a = rng.range(0, Math.PI * 2);
    const rr = rng.range(0.03, 0.32);
    const o = V(...P.h(Math.sin(a) * rr, 0.95, Math.cos(a) * rr - 0.1));
    if (!proj.cast(o, V(0, -1, 0), 0.9 * P.headH, p, n)) continue;
    tuft('head', rng.range(0.016, 0.03) * sc);
  }
  // trapezius humps, from above: only hits that really are on the torso/neck mass (not the arm below)
  for (const sx of [1, -1]) {
    for (let i = 0; i < 18; i++) {
      const o = V(sx * rng.range(0.1, 0.34) * sc * P.build.shoulders, j.upperarm_l[1] + 0.5 * sc, rng.range(-0.25, 0.1) * sc);
      if (!proj.cast(o, V(0, -1, 0), 1.2, p, n)) continue;
      if (Math.abs(p.x) > 0.36 * sc * P.build.shoulders || p.y < j.upperarm_l[1] - 0.05 * sc) continue;
      tuft('chest', rng.range(0.018, 0.034) * sc);
    }
  }
}

/** riveted iron band round the right ankle with a short chain hanging from its lug (detail tile "weapon / worn metal") */
export function ankleShackle(ctx: KindContext, gear: GearFn, proj: Projector) {
  const { P } = ctx;
  const sc = P.s;
  const j = P.j;
  const side = 'r';
  const f = V(...j.foot_r);
  const kn = V(...j.shin_r);
  // axis of the shin; the band sits just above the foot, where the sheet puts it (~0.3 m up)
  const y0 = f.y + 0.05 * sc;
  const t = (y0 - f.y) / (kn.y - f.y);
  const cx = f.x + (kn.x - f.x) * t;
  const cz = f.z + (kn.z - f.z) * t;
  const march = (dx: number, dz: number) => {
    let lo = 0, hi = 0.7;
    for (let i = 0; i < 16; i++) {
      const m = (lo + hi) / 2;
      if (proj.dist(cx + dx * m, y0, cz + dz * m) < 0) lo = m;
      else hi = m;
    }
    return lo;
  };
  const rx = (march(1, 0) + march(-1, 0)) / 2;
  const zf = march(0, 1);
  const zb = march(0, -1);
  const ox = (march(1, 0) - march(-1, 0)) / 2;
  // no leg here (a zero-radius band would collapse to a point)
  if (rx < 0.03 * sc || zf < 0.03 * sc || zb < 0.03 * sc) return;
  const h = 0.085 * sc;
  const thick = 0.012 * sc;
  const seg = 28;
  const geo = new THREE.CylinderGeometry(1, 1, h, seg, 1, true);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    pos.setXYZ(i, x * (rx + thick), pos.getY(i), z * ((z > 0 ? zf : zb) + thick));
  }
  geo.computeVertexNormals();
  geo.translate(cx + ox, y0, cz);
  gear(geo, { bone: `shin_${side}`, color: TROLL_PAL.shackle, mat: IRON_RUSTY, ao: 0.85 });
  // rivet heads along the band's front
  for (let i = 0; i < 4; i++) {
    const a = (i - 1.5) * 0.42;
    const px = cx + ox + Math.sin(a) * (rx + thick);
    const pz = cz + Math.cos(a) * (zf + thick);
    const nn = V(Math.sin(a), 0, Math.cos(a)).normalize();
    gear(rivet(0.009 * sc, 6), { bone: `shin_${side}`, color: 0x8a6a4a, mat: IRON_RUSTY, matrix: placeAlong(V(px, y0 + (i % 2 ? 0.02 : -0.02) * sc, pz), nn, V(0, 1, 0)).multiply(new THREE.Matrix4().makeRotationX(-Math.PI / 2)), small: true });
  }
  // lug and ring on the outer side, chain hanging from it (short, ends in a broken link)
  const lugA = V(cx + ox - (rx + thick) * 0.98, y0 - h * 0.35, cz + zf * 0.25);
  gear(new THREE.TorusGeometry(0.03 * sc, 0.0075 * sc, 5, 10), { bone: `shin_${side}`, color: TROLL_PAL.shackle, mat: IRON_RUSTY, matrix: placeAlong(lugA, V(-1, 0, 0), V(0, 1, 0)), small: true });
  const path = [lugA.clone().add(V(-0.01 * sc, 0, 0)), V(lugA.x - 0.03 * sc, lugA.y - 0.09 * sc, lugA.z + 0.02 * sc), V(lugA.x - 0.05 * sc, lugA.y - 0.17 * sc, lugA.z + 0.05 * sc), V(lugA.x - 0.08 * sc, lugA.y - 0.22 * sc, lugA.z + 0.1 * sc)];
  for (const g of chainLinks(path, 0.055 * sc, 0.0095 * sc, V(0, 0, 1))) gear(g, { bone: `foot_${side}`, color: TROLL_PAL.chain, mat: IRON_RUSTY, small: true });
}
