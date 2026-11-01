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
import { V, ellipticalBand, rivet, ribbon, lerp, smooth, placeAlong, ringRadii, type GearFn, type Projector } from './common';

export const URUK_SHEET_PAL = {
  // uruk sheet: skin_base #4d4033, lit face sample #673d2e -> a deep red-brown albedo
  skin: 0x3d2a21,
  skin2: 0x281a14,
  lips: 0x3b2420,
  scatter: 0x7c3624,
  eyes: 0xb08c30, // iris #b29138
  // blackened_plates #454742 (lit #191512): dark brown-black iron, rust in the pits
  iron: 0x2a2623,
  ironDark: 0x25211e,
  ironEdge: 0x5a5249, // worn bright edge of the lames
  // black_kilt #302d27 (lit #2c2825), leather_belt #493828 (lit #1d1813), boots #352f28 (lit #27211e)
  kilt: 0x1f1c19,
  kilt2: 0x161412,
  strip: 0x231a13,
  strip2: 0x18110d,
  belt: 0x30241a,
  boots: 0x211c18,
  boots2: 0x16120f,
  trousers: 0x151311,
  strap: 0x241b14,
  mail: 0x3d3d40,
  // berserker sheet: skin lit #684d44 (chest), kilt #201f20, belt #322822 (lit), wraps #241f1b, helmet #292724
  bskin: 0x3a2b26,
  bskin2: 0x251a16,
  bscatter: 0x6e3326,
  bkilt: 0x1b1a1a,
  bkilt2: 0x131212,
  bbelt: 0x3b2c20,
  bwrap: 0x2e261f,
  bwrap2: 0x1f1913,
  bhelm: 0x3a3631,
  rustSword: 0x6d625a, // sword_iron lit #625955
};

/** blackened plate: dull hammered dark iron with scratched edges (iron_rusty read as orange camouflage here) */
export const SHEET_IRON = surface('metal_dark', { rough: 0.6, metal: 0.55, pat: { scratches: 1.0, pores: 0.6, scales: -0.5 } });
export const SHEET_LEATHER = surface('leather_worn', { rough: 0.74 });
export const SHEET_MAIL = surface('mail', { rough: 0.55 });

/** distance from (cx, cz) to the first surface along (dx, dz) at height y (marching out of the leg) */
export function exitDist(proj: Projector, cx: number, y: number, cz: number, dx: number, dz: number, max = 0.3): number {
  let t = 0;
  while (t < max && proj.dist(cx + dx * t, y, cz + dz * t) < 0) t += 0.004;
  return t;
}

/** worn bright edge on the lower rim of a band: lifts the colour toward the plate's bare metal */
const rimWear = (yBot: number, h: number, c0: number) => (p: THREE.Vector3, _n: THREE.Vector3, c: THREE.Color) => {
  const t = 1 - smooth(0, 0.35, (p.y - yBot) / h);
  c.lerp(new THREE.Color().setHex(c0, THREE.SRGBColorSpace), 0.55 * t);
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
      const rx = (exitDist(proj, cx, yc, cz, 1, 0) + exitDist(proj, cx, yc, cz, -1, 0)) / 2;
      const zf = exitDist(proj, cx, yc, cz, 0, 1);
      const zb = exitDist(proj, cx, yc, cz, 0, -1);
      const rz = (zf + zb) / 2;
      const m = new THREE.Matrix4().makeTranslation(cx, yc, cz);
      const geo = ellipticalBand(rx + 0.008 * sc, rz + 0.008 * sc, rx + 0.014 * sc, rz + 0.014 * sc, h, 0.006 * sc, 12, 0, Math.PI * 2, (zf - zb) / 2);
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
    const r = ringRadii(proj, y);
    const m = new THREE.Matrix4().makeTranslation(0, y, 0);
    gear(ellipticalBand(r.rx + 0.014 * sc, (r.zf + r.zb) / 2 + 0.014 * sc, r.rx + 0.014 * sc, (r.zf + r.zb) / 2 + 0.014 * sc, h, 0.0065 * sc, 20, 0, Math.PI * 2, (r.zf - r.zb) / 2), { bone: 'hips', color: URUK_SHEET_PAL.belt, mat: SHEET_LEATHER, matrix: m, ao: 0.85 });
  }
  {
    const r = ringRadii(proj, beltY - 0.02 * sc);
    const zf = r.zf + 0.026 * sc;
    gear(new THREE.BoxGeometry(0.07 * sc, 0.09 * sc, 0.014 * sc), { bone: 'hips', color: iron, mat: SHEET_IRON, matrix: new THREE.Matrix4().makeTranslation(0, beltY - 0.022 * sc, zf), small: true });
    for (const sx of [1, -1]) for (const dy of [0.012, -0.056]) gear(rivet(0.0075 * sc, 5), { bone: 'hips', color: URUK_SHEET_PAL.ironEdge, mat: SHEET_IRON, matrix: new THREE.Matrix4().makeTranslation(sx * 0.024 * sc, beltY + dy * sc, zf + 0.007 * sc).multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2)), small: true });
  }
  // tapered hip lames hanging over the kilt, shorter and wider toward the hem
  const top = beltY - 0.05 * sc;
  for (let k = 0; k < lames; k++) {
    const yT = top - k * 0.055 * sc;
    const h = 0.075 * sc;
    const rt = ringRadii(proj, yT);
    const rb = ringRadii(proj, yT - h);
    const out = (0.03 + k * 0.012) * sc;
    for (const sx of [1, -1]) {
      const a0 = sx > 0 ? 0.55 : -1.55;
      const a1 = sx > 0 ? 1.55 : -0.55;
      const g = ellipticalBand(rt.rx + out, (rt.zf + rt.zb) / 2 + out, rb.rx + out + 0.016 * sc, (rb.zf + rb.zb) / 2 + out + 0.016 * sc, h, 0.007 * sc, 6, a0, a1, (rt.zf - rt.zb) / 2);
      gear(g, { bone: 'hips', color: iron, mat: SHEET_IRON, matrix: new THREE.Matrix4().makeTranslation(0, yT - h / 2, 0), ao: 0.85, colorFn: rimWear(yT - h, h, URUK_SHEET_PAL.ironEdge) });
    }
  }
}

/** torso half-widths at height y, measured out of the spine axis (not through the arms hanging beside it) */
function torso(proj: Projector, y: number) {
  return { rx: (exitDist(proj, 0, y, 0, 1, 0, 0.5) + exitDist(proj, 0, y, 0, -1, 0, 0.5)) / 2, zf: exitDist(proj, 0, y, 0, 0, 1, 0.5), zb: exitDist(proj, 0, y, 0, 0, -1, 0.5) };
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
  for (let k = 0; k < n; k++) {
    const yB = botY + 0.006 * sc + k * step;
    const h = step + 0.014 * sc;
    const rt = torso(proj, yB + h);
    const rb = torso(proj, yB);
    const e = 0.01 * sc;
    const g = ellipticalBand(rt.rx + e * 0.6, (rt.zf + rt.zb) / 2 + e * 0.6, rb.rx + e * 1.5, (rb.zf + rb.zb) / 2 + e * 1.5, h, 0.006 * sc, 14, 0, Math.PI * 2, (rt.zf - rt.zb) / 2);
    gear(g, { bone: 'spine', color: iron, mat: SHEET_IRON, matrix: new THREE.Matrix4().makeTranslation(0, yB + h / 2, 0), ao: 0.85, colorFn: rimWear(yB, h, URUK_SHEET_PAL.ironEdge) });
  }
}

/** berserker: a wide two-tier riveted belt, ring buckle and the long strap hanging over the kilt */
export function berserkerBelt(ctx: KindContext, gear: GearFn, proj: Projector, beltY: number) {
  const { P } = ctx;
  const sc = P.s;
  const col = URUK_SHEET_PAL.bbelt;
  for (const [y, h] of [[beltY + 0.02 * sc, 0.06 * sc], [beltY - 0.045 * sc, 0.055 * sc]] as [number, number][]) {
    const r = ringRadii(proj, y);
    gear(ellipticalBand(r.rx + 0.016 * sc, (r.zf + r.zb) / 2 + 0.016 * sc, r.rx + 0.016 * sc, (r.zf + r.zb) / 2 + 0.016 * sc, h, 0.007 * sc, 20, 0, Math.PI * 2, (r.zf - r.zb) / 2), {
      bone: 'hips',
      color: col,
      mat: SHEET_LEATHER,
      matrix: new THREE.Matrix4().makeTranslation(0, y, 0),
      ao: 0.85,
    });
  }
  const r = ringRadii(proj, beltY);
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
  const len = 0.5 * sc;
  const zk = r.zf + 0.06 * sc;
  const pts: THREE.Vector3[] = [];
  const nrm: THREE.Vector3[] = [];
  for (let i = 0; i <= 6; i++) {
    const t = i / 6;
    pts.push(V(x0 + 0.012 * sc * t, y0 - len * t, zk + 0.02 * sc * t));
    nrm.push(V(0, 0.12, 1).normalize());
  }
  gear(ribbon(pts, nrm, 0.036 * sc, 0.008 * sc, 1, { outerOnly: true, noInner: true }, 6), { bone: 'hips', color: col, mat: SHEET_LEATHER, small: true });
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
      const rx = (exitDist(proj, cx, yc, cz, 1, 0) + exitDist(proj, cx, yc, cz, -1, 0)) / 2;
      const zf = exitDist(proj, cx, yc, cz, 0, 1);
      const zb = exitDist(proj, cx, yc, cz, 0, -1);
      const tilt = (k % 2 ? 1 : -1) * 0.012 * sc;
      const geo = ellipticalBand(rx + 0.006 * sc, (zf + zb) / 2 + 0.006 * sc, rx + 0.008 * sc + tilt, (zf + zb) / 2 + 0.008 * sc + tilt, h, 0.005 * sc, 12, 0, Math.PI * 2, (zf - zb) / 2);
      gear(geo, { bone, color: k % 2 ? URUK_SHEET_PAL.bwrap : URUK_SHEET_PAL.bwrap2, mat: SHEET_LEATHER, matrix: new THREE.Matrix4().makeTranslation(cx, yc, cz), ao: 0.85 });
    }
  }
}
