/**
 * Sheet-calibrated parts for the Uruk-hai and the berserker (docs/refs/uruk, docs/refs/berserker).
 * Kept apart from `uruk.ts` so the shared `URUK_PAL` and the exported armour helpers that Lurtz,
 * Bolg and the trolls import stay exactly as they were.
 *
 * Colours: the sheets' `design` hex is the target and `observed.samples` the lit render. The lab
 * renders warmer/lighter than a hex suggests for skin and darker for plate, so skin is pushed
 * redder and deeper than the sheet's grey-brown `skin_base_hex`, and plate is a dark brown-black
 * that the rust shader lifts in its pits.
 */
import * as THREE from 'three';
import type { KindContext } from '../../types';
import { emitParts, type Part } from '../../anatomy';
import { surface } from '../../../kit/surfaces';
import type { PrimOpts } from '../../../kit/sdf';
import { V, Builder, surfaceStrip, frameAt, snapPoint, paintSnapped, ellipticalBand, rivet, ribbon, lerp, smooth, placeAlong, type GearFn, type Projector, type SnapMode, type SnapPoint } from './common';

export const URUK_SHEET_PAL = {
  // uruk sheet: skin_base #4d4033, lit face sample #673d2e -> a deep red-brown albedo
  skin: 0x3d2a21,
  skin2: 0x281a14,
  lips: 0x3b2420,
  scatter: 0x7c3624,
  eyes: 0xb08c30, // iris #b29138
  // blackened_plates #454742 (lit #191512): dark brown-black iron, rust in the pits
  iron: 0x201a15, // blackened plate, a warm near-black (sheet lit #191512)
  ironEdge: 0x4a2c1c, // rust on the rims only
  // black_kilt #302d27 (lit #2c2825), leather_belt #493828 (lit #1d1813), boots #352f28 (lit #27211e)
  kilt: 0x24201c,
  kilt2: 0x17140f, // hem grime
  strip: 0x231a13,
  strip2: 0x18110d,
  belt: 0x2a2018,
  boots: 0x211c18,
  boots2: 0x16120f,
  trousers: 0x2a241f, // near-black armoured trousers
  strap: 0x241b14,
  mail: 0x3d3d40,
  // berserker sheet: skin lit #684d44 (chest), kilt #201f20, belt #322822 (lit), wraps #241f1b, helmet #292724
  bskin: 0x3a2b26,
  bskin2: 0x251a16,
  bscatter: 0x6e3326,
  bkilt: 0x1b1a1a,
  bkilt2: 0x131212,
  bbelt: 0x2a211b, // belt and wraps dark (lit sheet #322822 / #241f1b)
  bstrap: 0x4a3524, // the hanging belt tongue is rusty brown
  bwrap: 0x2a211b,
  bwrap2: 0x1c1713,
  bhelm: 0x3a3532, // rusty iron
  copper: 0x8a5a3a,
  dirt: 0xc8c4bf, // handprints: chalky off-white (lit sheet #c8c4bf / #e7e8ea)
};

/** blackened plate: dark gunmetal, hammered, with scratched edges (iron_rusty read as orange camouflage here) */
export const SHEET_IRON = surface('metal_dark', { rough: 0.72, metal: 0.6, pat: { scratches: 1.2, pores: 0.4, scales: -0.4 } });
export const SHEET_LEATHER = surface('leather_worn', { rough: 0.74 });

/** distance from (cx, cz) to the first surface along (dx, dz) at height y (marching out of the leg) */
function exitDist(proj: Projector, cx: number, y: number, cz: number, dx: number, dz: number, max = 0.3): number {
  let t = 0;
  while (t < max && proj.dist(cx + dx * t, y, cz + dz * t) < 0) t += 0.004;
  return t;
}

/** worn bright edge on the lower rim of a band, with patchy scratches across the face */
const rimWear = (yBot: number, h: number, c0: number) => {
  const edge = new THREE.Color().setHex(c0, THREE.SRGBColorSpace);
  return (p: THREE.Vector3, _n: THREE.Vector3, c: THREE.Color) => {
    const t = 1 - smooth(0, 0.28, (p.y - yBot) / h);
    const m = 0.5 + 0.5 * Math.sin(p.x * 61 + p.z * 47) * Math.sin(p.y * 53 + p.x * 29);
    c.lerp(edge, Math.min(0.85, 0.85 * t * (0.4 + 0.6 * m)));
  };
};

/** shin plates (greaves) over the boots, with a knee cop. Sculpted in the SDF so they follow the leg. */
export function greaves(ctx: KindContext, parts: Part[], o: { color?: number; mat?: typeof SHEET_IRON; calf?: number } = {}) {
  const { P, sculpt: s } = ctx;
  const sc = P.s;
  const j = P.j;
  const g = P.build.bulk;
  const kneeY = j.shin_l[1];
  const color = o.color ?? URUK_SHEET_PAL.iron;
  const mat = o.mat ?? SHEET_IRON;
  const y0 = P.ankleH + 0.11 * sc;
  const y1 = kneeY - 0.03 * sc;
  s.group('union', 0.003 * sc, () => {
    emitParts(s, parts, ['shin', 'calf'], { color, mat, inflate: (0.02 + 0.012 * (o.calf ?? 1)) * sc, k: 0.02 * sc, noise: { amp: 0.0014 * sc, freq: 40 / sc, type: 'dents' } });
    s.plane([0, 1, 0], y1, { op: 'intersect', k: 0.004 * sc });
    s.plane([0, -1, 0], -y0, { op: 'intersect', k: 0.004 * sc });
  });
  // knee cop
  s.mirrored(() => s.ellipsoid([j.shin_l[0], kneeY + 0.004 * sc, j.shin_l[2] + 0.034 * sc], [0.058 * sc * g, 0.054 * sc, 0.045 * sc], { bone: 'shin_l', color, mat, k: 0.012 * sc }));
}

/** overlapping lames strapped round each shin (placed on the finished sculpt) */
export function greaveLames(ctx: KindContext, gear: GearFn, proj: Projector, o: { color?: number; mat?: typeof SHEET_IRON; n?: number } = {}) {
  const { P } = ctx;
  const sc = P.s;
  const j = P.j;
  const kneeY = j.shin_l[1];
  const n = o.n ?? 3;
  const color = o.color ?? URUK_SHEET_PAL.iron;
  const y0 = P.ankleH + 0.14 * sc;
  const y1 = kneeY - 0.075 * sc;
  for (const sx of [1, -1]) {
    const cx = j.shin_l[0] * sx;
    const bone = sx > 0 ? 'shin_l' : 'shin_r';
    for (let k = 0; k < n; k++) {
      const yTop = lerp(y1, y0 + 0.06 * sc, n === 1 ? 0 : k / (n - 1));
      const h = 0.06 * sc;
      const yc = yTop - h / 2;
      const cz = j.shin_l[2];
      const rx = Math.min(0.12 * sc, (exitDist(proj, cx, yc, cz, 1, 0) + exitDist(proj, cx, yc, cz, -1, 0)) / 2);
      const zf = exitDist(proj, cx, yc, cz, 0, 1);
      const zb = exitDist(proj, cx, yc, cz, 0, -1);
      const rz = (zf + zb) / 2;
      const m = new THREE.Matrix4().makeTranslation(cx, yc, cz);
      const geo = ellipticalBand(rx + 0.008 * sc, rz + 0.008 * sc, rx + 0.014 * sc, rz + 0.014 * sc, h, 0.006 * sc, 7, -2.0, 2.0, (zf - zb) / 2);
      gear(geo, { bone, color, mat: o.mat ?? SHEET_IRON, matrix: m, ao: 0.85, colorFn: rimWear(yc - h / 2, h, URUK_SHEET_PAL.ironEdge) });
    }
  }
}

/** the wide belt (two buckled straps), hip lames on each side and a mail apron, hung under the cuirass */
export function beltAndFaulds(ctx: KindContext, gear: GearFn, proj: Projector, o: { beltY: number; lames?: number } = { beltY: 0 }) {
  const { P } = ctx;
  const sc = P.s;
  const beltY = o.beltY;
  const lames = o.lames ?? 3;
  const iron = URUK_SHEET_PAL.iron;
  // two leather straps round the waist with a plate buckle and studs
  const straps: [number, number][] = [
    [beltY, 0.052 * sc],
    [beltY - 0.054 * sc, 0.042 * sc],
  ];
  for (const [y, h] of straps) {
    const r = torso(proj, y);
    const m = new THREE.Matrix4().makeTranslation(0, y, 0);
    gear(ellipticalBand(r.rx + 0.014 * sc, (r.zf + r.zb) / 2 + 0.014 * sc, r.rx + 0.014 * sc, (r.zf + r.zb) / 2 + 0.014 * sc, h, 0.0065 * sc, 20, 0, Math.PI * 2, (r.zf - r.zb) / 2), { bone: 'hips', color: URUK_SHEET_PAL.belt, mat: SHEET_LEATHER, matrix: m, ao: 0.85 });
  }
  {
    const r = torso(proj, beltY - 0.02 * sc);
    const zf = r.zf + 0.026 * sc;
    gear(new THREE.BoxGeometry(0.07 * sc, 0.09 * sc, 0.014 * sc), { bone: 'hips', color: iron, mat: SHEET_IRON, matrix: new THREE.Matrix4().makeTranslation(0, beltY - 0.022 * sc, zf), small: true });
    for (const sx of [1, -1]) for (const dy of [0.012, -0.056]) gear(rivet(0.0075 * sc, 5), { bone: 'hips', color: URUK_SHEET_PAL.ironEdge, mat: SHEET_IRON, matrix: new THREE.Matrix4().makeTranslation(sx * 0.024 * sc, beltY + dy * sc, zf + 0.007 * sc).multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2)), small: true });
  }
  // tapered hip lames hanging over the kilt, shorter and wider toward the hem
  const top = beltY - 0.05 * sc;
  for (let k = 0; k < lames; k++) {
    const yT = top - k * 0.055 * sc;
    const h = 0.075 * sc;
    const rt = torso(proj, yT);
    const rb = torso(proj, yT - h);
    const out = (0.03 + k * 0.02) * sc;
    for (const sx of [1, -1]) {
      const a0 = sx > 0 ? 0.55 : -1.55;
      const a1 = sx > 0 ? 1.55 : -0.55;
      const g = ellipticalBand(rt.rx + out, (rt.zf + rt.zb) / 2 + out, rb.rx + out + 0.03 * sc, (rb.zf + rb.zb) / 2 + out + 0.03 * sc, h, 0.007 * sc, 6, a0, a1, (rt.zf - rt.zb) / 2);
      gear(g, { bone: 'hips', color: iron, mat: SHEET_IRON, matrix: new THREE.Matrix4().makeTranslation(0, yT - h / 2, 0), ao: 0.85, colorFn: rimWear(yT - h, h, URUK_SHEET_PAL.ironEdge) });
    }
  }
}

/** torso half-widths at height y, measured out of the spine axis (not through the arms hanging beside it) */
function torso(proj: Projector, y: number) {
  return { rx: Math.min(0.34, (exitDist(proj, 0, y, 0, 1, 0, 0.5) + exitDist(proj, 0, y, 0, -1, 0, 0.5)) / 2), zf: exitDist(proj, 0, y, 0, 0, 1, 0.5), zb: exitDist(proj, 0, y, 0, 0, -1, 0.5) };
}

/** overlapping shingled lames over the chest/back of a plate cuirass (replaces the smooth blob) */
export function chestLames(ctx: KindContext, gear: GearFn, proj: Projector, botY: number) {
  const { P } = ctx;
  const sc = P.s;
  const j = P.j;
  const topY = j.upperarm_l[1] - 0.12 * sc;
  const step = 0.07 * sc;
  const n = Math.max(2, Math.floor((topY - botY) / step));
  const iron = URUK_SHEET_PAL.iron;
  // never wider than the chest itself (at shoulder height the delts and traps would flare the top lame into a saucer)
  const cap = torso(proj, j.chest[1]).rx * 1.06;
  for (let k = 0; k < n; k++) {
    const yB = botY + 0.006 * sc + k * step;
    const h = step + 0.014 * sc;
    const rt = torso(proj, yB + h);
    const rb = torso(proj, yB);
    rt.rx = Math.min(rt.rx, cap);
    rb.rx = Math.min(rb.rx, cap);
    const e = 0.01 * sc;
    const g = ellipticalBand(rt.rx + e * 0.6, (rt.zf + rt.zb) / 2 + e * 0.6, rb.rx + e * 1.5, (rb.zf + rb.zb) / 2 + e * 1.5, h, 0.006 * sc, 12, 0, Math.PI * 2, (rt.zf - rt.zb) / 2);
    gear(g, { bone: 'spine', color: iron, mat: SHEET_IRON, matrix: new THREE.Matrix4().makeTranslation(0, yB + h / 2, 0), ao: 0.85, colorFn: rimWear(yB, h, URUK_SHEET_PAL.ironEdge) });
    if (k === 0) {
      // the lowest lame ends in a pointed V over the belt (sheet front view)
      const w = 0.056 * sc;
      const shape = new THREE.Shape([new THREE.Vector2(-w, 0), new THREE.Vector2(w, 0), new THREE.Vector2(0, -0.1 * sc)]);
      const tip = new THREE.ExtrudeGeometry(shape, { depth: 0.006 * sc, bevelEnabled: false });
      gear(tip, { bone: 'spine', color: iron, mat: SHEET_IRON, matrix: new THREE.Matrix4().makeTranslation(0, yB + 0.012 * sc, rb.zf + e * 1.5 + 0.004 * sc), ao: 0.85, small: true, colorFn: rimWear(yB - 0.1 * sc, 0.1 * sc, URUK_SHEET_PAL.ironEdge) });
    }
  }
}

/** berserker: a wide two-tier riveted belt, ring buckle and the long strap hanging over the kilt */
export function berserkerBelt(ctx: KindContext, gear: GearFn, proj: Projector, beltY: number) {
  const { P } = ctx;
  const sc = P.s;
  const col = URUK_SHEET_PAL.bbelt;
  for (const [y, h] of [[beltY + 0.02 * sc, 0.06 * sc], [beltY - 0.045 * sc, 0.055 * sc]] as [number, number][]) {
    const r = torso(proj, y);
    gear(ellipticalBand(r.rx + 0.016 * sc, (r.zf + r.zb) / 2 + 0.016 * sc, r.rx + 0.016 * sc, (r.zf + r.zb) / 2 + 0.016 * sc, h, 0.007 * sc, 20, 0, Math.PI * 2, (r.zf - r.zb) / 2), {
      bone: 'hips',
      color: col,
      mat: SHEET_LEATHER,
      matrix: new THREE.Matrix4().makeTranslation(0, y, 0),
      ao: 0.85,
    });
  }
  const r = torso(proj, beltY);
  const zf = r.zf + 0.03 * sc;
  gear(new THREE.TorusGeometry(0.034 * sc, 0.007 * sc, 6, 14), { bone: 'hips', color: URUK_SHEET_PAL.ironEdge, mat: SHEET_IRON, matrix: new THREE.Matrix4().makeTranslation(-0.01 * sc, beltY - 0.012 * sc, zf), small: true });
  // rivets along the upper strap
  for (let i = 0; i < 7; i++) {
    const a = lerp(-1.25, 1.25, i / 6);
    if (Math.abs(a) < 0.18) continue;
    const y = beltY + 0.02 * sc;
    const rx = r.rx + 0.024 * sc;
    const rz = (r.zf + r.zb) / 2 + 0.024 * sc;
    const p = V(Math.sin(a) * rx, y, Math.cos(a) * rz + (r.zf - r.zb) / 2);
    const nn = V(Math.sin(a) / rx, 0, Math.cos(a) / rz).normalize();
    gear(rivet(0.0075 * sc, 5), { bone: 'hips', color: URUK_SHEET_PAL.ironEdge, mat: SHEET_IRON, matrix: placeAlong(p, nn, V(0, 1, 0)).multiply(new THREE.Matrix4().makeRotationX(-Math.PI / 2)), small: true });
  }
  // the long tongue of the belt: hangs from the buckle down the front of the kilt, a little to the left
  const x0 = 0.05 * sc;
  const y0 = beltY - 0.02 * sc;
  // down to a hand's width above the kilt's hem (hem = hip height minus 0.97 of the thigh length)
  const hemY = P.j.thigh_l[1] - (P.j.thigh_l[1] - P.j.shin_l[1]) * 0.97;
  const len = Math.max(0.3 * sc, y0 - (hemY + 0.08 * sc));
  const zk = r.zf + 0.055 * sc;
  const pts: THREE.Vector3[] = [];
  const nrm: THREE.Vector3[] = [];
  for (let i = 0; i <= 6; i++) {
    const t = i / 6;
    pts.push(V(x0 + 0.012 * sc * t, y0 - len * t, zk + 0.05 * sc * t));
    nrm.push(V(0, 0.12, 1).normalize());
  }
  gear(ribbon(pts, nrm, 0.04 * sc, 0.008 * sc, 1, { outerOnly: true, noInner: true }, 6), { bone: 'hips', color: URUK_SHEET_PAL.bstrap, mat: SHEET_LEATHER, small: true });
}

/** berserker: leather wraps round the lower legs, a few bound rings from the ankle to under the knee */
export function legWraps(ctx: KindContext, gear: GearFn, proj: Projector, n = 3) {
  const { P } = ctx;
  const sc = P.s;
  const j = P.j;
  const kneeY = j.shin_l[1];
  const y0 = P.ankleH + 0.07 * sc;
  const y1 = kneeY - 0.13 * sc;
  for (const sx of [1, -1]) {
    const cx = j.shin_l[0] * sx;
    const cz = j.shin_l[2];
    const bone = sx > 0 ? 'shin_l' : 'shin_r';
    for (let k = 0; k < n; k++) {
      const yc = lerp(y0, y1, k / (n - 1));
      const h = 0.05 * sc;
      const rx = Math.min(0.12 * sc, (exitDist(proj, cx, yc, cz, 1, 0) + exitDist(proj, cx, yc, cz, -1, 0)) / 2);
      const zf = exitDist(proj, cx, yc, cz, 0, 1);
      const zb = exitDist(proj, cx, yc, cz, 0, -1);
      const tilt = (k % 2 ? 1 : -1) * 0.012 * sc;
      const geo = ellipticalBand(rx + 0.006 * sc, (zf + zb) / 2 + 0.006 * sc, rx + 0.008 * sc + tilt, (zf + zb) / 2 + 0.008 * sc + tilt, h, 0.005 * sc, 12, 0, Math.PI * 2, (zf - zb) / 2);
      gear(geo, { bone, color: k % 2 ? URUK_SHEET_PAL.bwrap : URUK_SHEET_PAL.bwrap2, mat: SHEET_LEATHER, matrix: new THREE.Matrix4().makeTranslation(cx, yc, cz), ao: 0.85 });
    }
  }
}

/** dark cloth under the berserker's kilt (waist, hips and the upper thighs down to just above the hem), so
 *  the gaps between the kilt's panels show cloth, never bare skin */
export function underSkirt(ctx: KindContext, parts: Part[], o: { topY: number; botY: number }) {
  const { P, sculpt: s } = ctx;
  const sc = P.s;
  s.group('union', 0.004 * sc, () => {
    emitParts(s, parts, ['pelvis', 'glutes', 'waist', 'belly'], {
      color: URUK_SHEET_PAL.bkilt,
      color2: URUK_SHEET_PAL.bkilt,
      colorNoise: 0,
      colorFreq: 30 / sc,
      mat: surface('rags', { rough: 0.95 }),
      inflate: 0.004 * sc + 0.006 * sc * P.build.bulk,
      k: 0.03 * sc,
    });
    s.plane([0, 1, 0], o.topY, { op: 'intersect', k: 0.004 * sc });
    s.plane([0, -1, 0], -o.botY, { op: 'intersect', k: 0.004 * sc });
  });
}

/**
 * A chalky handprint (sheet): a solid palm with four thick splayed fingers, a thumb and a few short drips, draped over
 * the surface in strips. A light noise mask lets the skin show through in about 12 % of it.
 */
export function dirtyHand(
  ctx: KindContext,
  gear: GearFn,
  proj: Projector,
  o: { pos: [number, number, number]; mode?: SnapMode; up?: [number, number, number]; size: number; bone: string; rot?: number; seed?: number; skin: number },
) {
  const { P } = ctx;
  const p = V();
  const n = V();
  if (!snapPoint(proj, o.pos, o.mode ?? 'f', p, n)) return;
  const frame = frameAt(p, n, o.up ? V(...o.up) : V(0, 1, 0));
  if (o.rot) frame.multiply(new THREE.Matrix4().makeRotationZ(o.rot));
  const seed = o.seed ?? 1;
  const S = o.size;
  const lift = 0.0022 * P.s;
  const b = new Builder();
  let r = seed * 12.9898;
  const rnd = () => {
    r = (Math.sin(r) * 43758.5453) % 1;
    return Math.abs(r) - 0.5;
  };
  const Pt = (x: number, y: number): [number, number] => [(x + rnd() * 0.02) * S, (y + rnd() * 0.02) * S];
  // palm: three wide strips
  for (const [y, h] of [[-0.17, 0.13], [-0.05, 0.13], [0.06, 0.12]] as [number, number][]) surfaceStrip(proj, frame, Pt(-0.22, y), Pt(0.22, y), h * S, h * S, lift, 5, b);
  // four thick fingers
  const fingers: [number, number, number, number, number][] = [
    [-0.16, 0.08, -0.31, 0.4, 0.105],
    [-0.055, 0.1, -0.09, 0.53, 0.105],
    [0.055, 0.1, 0.1, 0.51, 0.105],
    [0.16, 0.08, 0.3, 0.38, 0.095],
  ];
  for (const [x0, y0, x1, y1, w] of fingers) surfaceStrip(proj, frame, Pt(x0, y0), Pt(x1, y1), w * S, w * S * 0.8, lift, 4, b);
  surfaceStrip(proj, frame, Pt(-0.2, -0.13), Pt(-0.44, 0.03), 0.115 * S, 0.085 * S, lift, 4, b);
  surfaceStrip(proj, frame, Pt(0, -0.22), Pt(0, -0.46), 0.3 * S, 0.26 * S, lift, 4, b);
  // short drips down from the palm's lower edge
  for (const [x, len] of [[-0.17, 0.14], [0.17, 0.1], [0.0, 0.2]] as [number, number][]) surfaceStrip(proj, frame, Pt(x, -0.3), Pt(x + 0.006, -0.3 - len), 0.055 * S, 0.025 * S, lift, 3, b);
  if (!b.idx.length) return;
  const white = new THREE.Color().setHex(URUK_SHEET_PAL.dirt, THREE.SRGBColorSpace);
  const skin = new THREE.Color().setHex(o.skin, THREE.SRGBColorSpace);
  gear(b.geometry(), {
    bone: o.bone,
    color: URUK_SHEET_PAL.dirt,
    mat: surface('skin_orc', { rough: 0.85, skin: 0.2 }),
    colorFn: (q, _n, c) => {
      // chalky and opaque: a light blotch mask (about 12 %) lets the skin through, plus an uneven tone
      const m = 0.5 + 0.5 * Math.sin(q.x * 83 + seed) * Math.sin(q.y * 71 + q.z * 57 + seed * 2) + 0.3 * Math.sin(q.x * 190 + q.y * 170 + seed);
      const through = smooth(0.92, 1.1, m);
      c.copy(white).multiplyScalar(0.88 + 0.12 * Math.sin(q.x * 47 + q.y * 41 + seed * 3)).lerp(skin, 0.7 * through);
    },
  });
}

/** painted muscle cavities on the finished torso: sternum, linea alba and ab grid, pec undersides, lat grooves */
export function muscleShade(ctx: KindContext, proj: Projector, o: { dark: number; hair?: number }) {
  const { P, sculpt: s } = ctx;
  const sc = P.s;
  const j = P.j;
  const sh = P.build.shoulders;
  const dark: PrimOpts = { color: o.dark, mat: 'skin_brute', bone: 'chest', k: 0.012 * sc, strength: 0.5 };
  const stroke = (pts: SnapPoint[], radius: number, bone = 'chest', strength = 0.5) => paintSnapped(s, proj, pts, radius, { ...dark, bone, strength });
  const cy = j.chest[1];
  const dy = j.upperarm_l[1];
  // sternum groove and linea alba
  stroke([[0, dy - 0.02 * sc, 0.3 * sc, 'f'], [0, cy - 0.04 * sc, 0.3 * sc, 'f'], [0, cy - 0.13 * sc, 0.3 * sc, 'f']], 0.007 * sc);
  // pec undersides
  for (const sx of [1, -1]) stroke([[sx * 0.02 * sc, cy - 0.045 * sc, 0.3 * sc, 'f'], [sx * 0.06 * sc, cy - 0.05 * sc, 0.3 * sc, 'f'], [sx * 0.105 * sc * sh, cy - 0.035 * sc, 0.3 * sc, 'f']], 0.008 * sc, 'chest', 0.55);
  // ab grid (three cross lines)
  for (const k of [0, 1, 2]) {
    const y = cy - (0.085 + k * 0.045) * sc;
    stroke([[-0.045 * sc, y, 0.3 * sc, 'f'], [0.045 * sc, y, 0.3 * sc, 'f']], 0.0055 * sc, 'spine', 0.45);
  }
  // lat grooves and the serratus edge down the sides
  stroke([[0.17 * sc * sh, dy - 0.07 * sc, 0, 'l'], [0.15 * sc * sh, cy - 0.04 * sc, 0, 'l'], [0.13 * sc * sh, cy - 0.12 * sc, 0, 'l']], 0.009 * sc, 'chest', 0.45);
  stroke([[-0.17 * sc * sh, dy - 0.07 * sc, 0, 'r'], [-0.15 * sc * sh, cy - 0.04 * sc, 0, 'r'], [-0.13 * sc * sh, cy - 0.12 * sc, 0, 'r']], 0.009 * sc, 'chest', 0.45);
}

/** near-black armoured trousers over the thighs (brawnBody's thigh muscle is added after the outfit, in skin colour) */
export function thighTrousers(ctx: KindContext, parts: Part[], o: { topY: number; botY: number }) {
  const { P, sculpt: s } = ctx;
  const sc = P.s;
  s.group('union', 0.004 * sc, () => {
    emitParts(s, parts, ['thigh', 'knee', 'glutes', 'pelvis'], {
      color: URUK_SHEET_PAL.trousers,
      mat: surface('leather_worn', { rough: 0.8 }),
      inflate: 0.03 * sc,
      k: 0.03 * sc,
    });
    s.plane([0, 1, 0], o.topY, { op: 'intersect', k: 0.004 * sc });
    s.plane([0, -1, 0], -o.botY, { op: 'intersect', k: 0.004 * sc });
  });
}
