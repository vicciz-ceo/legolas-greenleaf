/**
 * Cave troll details (docs/refs/cave_troll): warts over the whole hide, the coarse bristles on the
 * shoulders and scalp, and the riveted iron shackle on the RIGHT ankle with its short chain.
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
  /** angular window (radians around the axis; 0 = the first perpendicular) or all */
  win?: [number, number];
}

/** warts scattered over a limb/torso segment: cast inward from outside so every wart sits on the real surface */
function zoneWarts(proj: Projector, gear: GearFn, z: WartZone, rng: Rng, sc: number, color: number, big: number) {
  const axis = z.b.clone().sub(z.a);
  const len = axis.length();
  axis.normalize();
  const [u, w] = perp(axis);
  const p = V(), n = V();
  for (let i = 0; i < z.count; i++) {
    const t = rng.float();
    const th = z.win ? rng.range(z.win[0], z.win[1]) : rng.range(0, Math.PI * 2);
    const dir = u.clone().multiplyScalar(Math.cos(th)).addScaledVector(w, Math.sin(th));
    const c = z.a.clone().addScaledVector(axis, t * len);
    const o = c.clone().addScaledVector(dir, z.reach);
    if (!proj.cast(o, dir.clone().negate(), z.reach * 1.1, p, n)) continue;
    // pores and warts: mostly small, a few big pink-tipped ones
    const r = (rng.float() < 0.1 ? rng.range(0.016, 0.03) * big : rng.range(0.006, 0.014)) * sc;
    const g = WART_GEO.clone().scale(r, r * 0.75, r);
    const m = placeAlong(p.clone().addScaledVector(n, -r * 0.18), n.clone(), V(0, 0, 1));
    gear(g, { bone: z.bone, color: rng.float() < 0.25 ? 0x7a6450 : color, mat: HIDE, matrix: m, small: true, ao: 0.8 });
  }
}

export function caveWarts(ctx: KindContext, gear: GearFn, proj: Projector, bucket: number, density = 1) {
  const { P } = ctx;
  const sc = P.s;
  const j = P.j;
  const rng = new Rng(7000 + bucket);
  const J = (k: string) => V(...j[k]);
  const col = TROLL_PAL.wart;
  const zones: WartZone[] = [
    // torso: shoulders and upper back are the most warty (detail tile "skin"), the belly less
    { a: J('chest').add(V(0, 0.15 * sc, 0)), b: J('chest').add(V(0, -0.1 * sc, 0)), bone: 'chest', count: 70, reach: 1.4 },
    { a: J('spine'), b: J('chest'), bone: 'spine', count: 30, reach: 1.4 },
    { a: J('neck'), b: J('neck').add(V(0, 0.1 * sc, 0)), bone: 'chest', count: 14, reach: 0.8 },
  ];
  for (const sd of ['l', 'r'] as const) {
    zones.push(
      { a: J(`upperarm_${sd}`), b: J(`forearm_${sd}`), bone: `upperarm_${sd}`, count: 55, reach: 0.9 },
      { a: J(`forearm_${sd}`), b: J(`hand_${sd}`), bone: `forearm_${sd}`, count: 36, reach: 0.8 },
      { a: J(`thigh_${sd}`), b: J(`shin_${sd}`), bone: `thigh_${sd}`, count: 30, reach: 0.9 },
      { a: J(`shin_${sd}`), b: J(`foot_${sd}`), bone: `shin_${sd}`, count: 24, reach: 0.8 },
    );
  }
  for (const z of zones) zoneWarts(proj, gear, { ...z, count: Math.round(z.count * density) }, rng, sc, col, 1);
}

/** coarse dark bristles rooted on the trapezius, shoulders and the crown (details tile "hair / bristles") */
export function caveBristles(ctx: KindContext, gear: GearFn, proj: Projector, bucket: number) {
  const { P } = ctx;
  const sc = P.s;
  const j = P.j;
  const rng = new Rng(8100 + bucket);
  const p = V(), n = V();
  const tuft = (len: number, r: number, _bend: number) => spike(r, len, 3);
  const put = (o: THREE.Vector3, d: THREE.Vector3, count: number, bone: string, lenMul = 1) => {
    for (let i = 0; i < count; i++) {
      const oo = o.clone().add(V(rng.range(-1, 1) * 0.35 * sc, rng.range(-0.1, 0.1) * sc, rng.range(-0.5, 0.2) * sc));
      if (!proj.cast(oo, d, 1.2, p, n)) continue;
      const len = rng.range(0.03, 0.065) * sc * lenMul;
      const dir = n.clone().multiplyScalar(0.8).add(V(0, 0.5, -0.1)).normalize();
      gear(tuft(len, 0.0045 * sc, 0.25), { bone, color: rng.float() < 0.5 ? TROLL_PAL.bristle : 0x3a3c30, mat: HIDE, matrix: placeAlong(p.clone().addScaledVector(n, -0.004 * sc), dir, V(0, 0, 1)), small: true });
    }
  };
  // trapezius humps and the top of both shoulders, from above
  for (const sx of [1, -1]) {
    const o = V(sx * 0.52 * sc * P.build.shoulders, j.upperarm_l[1] + 0.45 * sc, -0.03 * sc);
    put(o, V(0, -1, 0), 40, 'chest');
  }
  // a few coarse bristles on the crown and brow ridge ("sparse coarse bristles on scalp", hair detail tile)
  for (let i = 0; i < 14; i++) {
    const a = rng.range(0, Math.PI * 2);
    const rr = rng.range(0.05, 0.3);
    const o = V(...P.h(Math.sin(a) * rr, 0.9, Math.cos(a) * rr - 0.08));
    if (!proj.cast(o, V(0, -1, 0), 0.9 * P.headH, p, n)) continue;
    gear(spike(0.0035 * sc, rng.range(0.015, 0.03) * sc, 3), { bone: 'head', color: 0x3c352c, mat: HIDE, matrix: placeAlong(p.clone().addScaledVector(n, -0.003 * sc), n.clone().add(V(0, 0.4, -0.2)).normalize(), V(0, 0, 1)), small: true });
  }
  // upper back between the shoulder blades, from behind
  put(V(0, j.chest[1] + 0.02 * sc, -0.9 * sc), V(0, 0, 1), 26, 'chest', 0.8);
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
  // flat rims top and bottom (the band is a strap, not a tube)
  for (const sgn of [-1, 1]) {
    const rim = new THREE.TorusGeometry(1, 0.0075 * sc, 4, seg).rotateX(Math.PI / 2);
    const rp = rim.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < rp.count; i++) rp.setXYZ(i, rp.getX(i) * (rx + thick), rp.getY(i), rp.getZ(i) * ((rp.getZ(i) > 0 ? zf : zb) + thick));
    rim.translate(cx + ox, y0 + sgn * h / 2, cz);
    gear(rim, { bone: `shin_${side}`, color: TROLL_PAL.shackle, mat: IRON_RUSTY, small: true });
  }
  // rivet heads along the band's front
  for (let i = 0; i < 4; i++) {
    const a = (i - 1.5) * 0.42;
    const px = cx + ox + Math.sin(a) * (rx + thick);
    const pz = cz + Math.cos(a) * (zf + thick);
    const nn = V(Math.sin(a), 0, Math.cos(a)).normalize();
    gear(rivet(0.009 * sc, 6), { bone: `shin_${side}`, color: 0x7a6048, mat: IRON_RUSTY, matrix: placeAlong(V(px, y0 + (i % 2 ? 0.02 : -0.02) * sc, pz), nn, V(0, 1, 0)).multiply(new THREE.Matrix4().makeRotationX(-Math.PI / 2)), small: true });
  }
  // lug and ring on the outer side, chain hanging from it (short, ends in a broken link)
  const lugA = V(cx + ox - (rx + thick) * 0.98, y0 - h * 0.35, cz + zf * 0.25);
  gear(new THREE.TorusGeometry(0.03 * sc, 0.0075 * sc, 5, 10), { bone: `shin_${side}`, color: TROLL_PAL.shackle, mat: IRON_RUSTY, matrix: placeAlong(lugA, V(-1, 0, 0), V(0, 1, 0)), small: true });
  const path = [lugA.clone().add(V(-0.01 * sc, 0, 0)), V(lugA.x - 0.03 * sc, lugA.y - 0.09 * sc, lugA.z + 0.02 * sc), V(lugA.x - 0.05 * sc, lugA.y - 0.17 * sc, lugA.z + 0.05 * sc), V(lugA.x - 0.08 * sc, lugA.y - 0.22 * sc, lugA.z + 0.1 * sc)];
  for (const g of chainLinks(path, 0.055 * sc, 0.0095 * sc, V(0, 0, 1))) gear(g, { bone: `foot_${side}`, color: TROLL_PAL.chain, mat: IRON_RUSTY, small: true });
}
