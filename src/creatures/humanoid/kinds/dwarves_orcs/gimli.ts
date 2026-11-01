/**
 * Gimli, son of Gloin (docs/refs/gimli): a very stocky dwarf, 1.37 m to the crown (the sheet's 1.53 m
 * overall comes from the tall pointed helm), a knee-length mail hauberk over quilted brown leather
 * sleeves with a leather tabard panel front and back, crossed straps with a square bronze boss,
 * layered steel pauldrons with bronze edges, a pointed iron helm with a bronze brow band, cheek
 * plates and nasal strip, a forked red-brown beard in two braids with bronze clasps, wild wavy hair,
 * bracers, charcoal trousers, short thick boots, a battle axe in the right hand and two throwing
 * axes in sheaths at the hips.
 */
import * as THREE from 'three';
import { Rng } from '../../../../core/rng';
import type { WeightFn } from '../../../kit/hair';
import type { V3 } from '../../../kit/sdf';
import { surface } from '../../../kit/surfaces';
import type { KindContext, KindDef } from '../../types';
import { anatomyParts, emitParts } from '../../anatomy';
import { arcPlate, mergeAll, put, ring, studs } from './armor';
import { domeHelm } from './headgear';
import { devNum, mix } from './common';
import { addBeard, addBrows, addHairdo, braidGeometry, hairMaterial, queueHair, sculptBeardMass, withHair } from './hair';
import { limbCutAfter, limbCutBefore, sculptBand, sculptTorsoGarment, slab } from './garments';
import { sculptHairCap } from '../../hairstyles';
import { frameAt, makeProjector, ringSnap, snapPoint, V, type Projector } from '../uruks_bosses/common';

/** sRGB albedos from docs/refs/gimli/spec.json, cross-checked against observed.samples (lit) and the turnaround */
export const GIMLI = {
  // sheet: root #62351f, tip #875033, observed (lit) #542310: a copper red-brown. The strand shader
  // lifts and pales it (and the lab key is bright), so the albedos sit deeper than the sheet hexes.
  hair: 0x44200e,
  hairTip: 0x683a1c,
  hairLight: 0x74421f,
  beard: 0x44200e,
  beardTip: 0x683a1c,
  /** braids are tube meshes lit without the strand highlight: a brighter albedo than the strands */
  braid: 0x7a3c1e,
  // sheet face #bd896c, lit #b66551: ruddy, weathered. Warmer/deeper albedo so it does not render as clay.
  skin: 0x7a4430,
  skin2: 0x683622,
  lips: 0x743a30,
  eyes: 0x6e4a22, // sheet #756346, browner (it reads grey-green under AgX)
  // sheet cloth #4d382b / observed #312925: charcoal wool trousers
  trousers: 0x2e2a27,
  // sheet leather #513a28 / observed #4d3226: boots read a warm reddish brown
  boots: 0x35231a,
  bootsTrim: 0x2c1d13,
  // mail: sheet charcoal (lit #312925-#4a4540); a rough, barely metallic albedo keeps the sky from washing it pale
  mail: 0x3a3330,
  /** the sculpted torso renders darker than the cloth skirt, so its mail albedo is lifted (sheet patch #392f2c) */
  mailBody: 0x504642,
  // quilted / tooled brown leather (sleeves, tabard, straps): sheet #513a28
  leather: 0x4a3322,
  leatherTrim: 0x5e4430,
  /** tabard and hem band (the cloth pipeline renders leather brighter: sheet patch #553d33) */
  tabard: 0x3e2a1c,
  /** quilted upper-arm sleeves */
  sleeve: 0x2e1e12,
  belt: 0x2c1f15,
  bracers: 0x3a281a,
  // sheet metal #60605a, observed #747274: worn pewter dome
  steel: 0x4b4946,
  steelDark: 0x3a3937,
  // bronze fittings: observed #8c714f
  bronze: 0x86602a,
  brass: 0x9a7632,
  buckle: 0x9b7a3c,
};

/** hammered chain: dark, rough and only a little metallic (the kit default is a bright sparkly steel) */
const MAIL = surface('mail', { rough: 0.75, metal: 0.35 });
/** quilted/stitched brown leather: tooled, so the tabard and straps carry the embossed knot-work look */
const LEATHER = surface('leather_tooled', { rough: 0.7, sheen: 0 });
const LEATHER_PLAIN = surface('leather_worn', { rough: 0.7 });
/** quilted leather sleeves */
const QUILT = surface('leather', { rough: 0.78, pat: { leather: 0.9 } });
/** wool trousers: dense twill */
const WOOL = surface('twill', { rough: 0.9, sheen: 0.2 });
/** worn pewter: hammered iron with a low sheen (dome, pauldrons, plates) */
const IRON = surface('metal_hammered', { rough: 0.62, metal: 0.4 });
/** bronze fittings: duller and browner than the kit's bright gold */
const BRONZE_D = surface('gold', { rough: 0.5 });

// ── landmark heights (m above the ground): the sheet's, scaled to the 1.37 m body ──
const HEIGHT = 1.37;
const HEAD_SIZE = 1.4;
const LEG_LENGTH = 0.82;
const FOOT_SIZE = 1.2;
const SC0 = HEIGHT / 1.85;
/** the figure the gear dimensions below were calibrated on (the 1.46 m pass); `k` scales them to the body */
const SC_CALIBRATED = 1.46 / 1.85;
/** hip joint height: the same formula as computeProportions() in humanoid/proportions.ts */
const HIP_Y = 0.512 * HEIGHT * LEG_LENGTH * Math.min(1.08, 1 / Math.max(0.75, HEAD_SIZE * 0.12 + 0.88));
const ANKLE_Y = 0.082 * SC0 * FOOT_SIZE;
const KNEE_Y = ANKLE_Y + (HIP_Y - ANKLE_Y) * 0.5;
/** belt at ~0.745 m (sheet 0.77 m, scaled to the shorter body) */
const BELT_Y = 0.745;
const BELT_RAISE = (BELT_Y - HIP_Y) / SC0 - 0.07;
/** mail skirt hem ~0.40 m (sheet 0.42 m) and boot tops ~0.29 m (sheet 0.30 m) */
const SKIRT_LEN = 0.57;
const SKIRT_GROW = 0.012;
const HEM_Y = HIP_Y - (HIP_Y - KNEE_Y) * SKIRT_LEN * 1.1;
const BOOT_LEN = (0.29 - ANKLE_Y) / (KNEE_Y - ANKLE_Y);
/** where the crossed straps meet on the chest/back (sheet ~1.06 m front, ~1.0 m back) */
const CROSS_Y = 0.99;
/** tip of the pointed helm above the crown: 1.53 m overall on the sheet */
const HELM_PROFILE: [number, number][] = [
  [0.4, -0.05], [0.405, 0.03], [0.392, 0.13], [0.36, 0.26], [0.31, 0.4], [0.245, 0.52], [0.17, 0.62], [0.1, 0.71], [0.052, 0.775], [0.02, 0.845], [0.0, 0.88],
];
const HELM_Y = 0.12;
/** the dome is a little wider and deeper than the head (the sheet's helm reads big), and leans back */
const HELM_WIDE = 1.05;

/** Gimli's pointed pewter helm: bronze brow band, central ridge, rivets */
function dwarfHelm(ctx: KindContext) {
  domeHelm(ctx, { color: GIMLI.steel, trim: GIMLI.bronze, mat: IRON, trimMat: BRONZE_D, profile: HELM_PROFILE.map(([r, y]) => [r * HELM_WIDE, y] as [number, number]), zScale: 1.34, tilt: -0.16, y: HELM_Y, finial: 'spike', rivets: 22, bandWidth: 1.6, cheeks: false });
}

/** hinged, bronze-framed cheek plates under the brow band and a diamond ornament at the centre of the band */
function helmFittings(ctx: KindContext, proj: Projector | null) {
  const { P } = ctx;
  const u = P.headH;
  const C = GIMLI;
  const yBand = 0.075 + HELM_Y - 0.07 * 1.6; // bottom edge of the brow band (head units)
  const ph = 0.095 / u; // plate height 0.095 m
  const arc = 0.065 / (0.372 * u); // plate width 0.065 m
  for (const sx of [1, -1]) {
    const c = sx > 0 ? 0 : Math.PI;
    const at = (y: number) => new THREE.Matrix4().makeTranslation(...P.h(0, y, -0.03));
    const yc = yBand - ph / 2 + 0.01;
    put(ctx, arcPlate(0.372 * u, ph * u, arc, c, 6), { bone: 'head', color: C.steel, mat: IRON, matrix: at(yc), small: true });
    // bronze frame: top hinge bar, bottom bar and the two side strips
    put(ctx, arcPlate(0.378 * u, 0.02 * u, arc + 0.08, c, 6), { bone: 'head', color: C.bronze, mat: BRONZE_D, matrix: at(yBand + 0.005), small: true });
    put(ctx, arcPlate(0.378 * u, 0.02 * u, arc + 0.08, c, 6), { bone: 'head', color: C.bronze, mat: BRONZE_D, matrix: at(yc - ph / 2), small: true });
    for (const d of [-arc / 2, arc / 2]) put(ctx, arcPlate(0.378 * u, ph * u, 0.05, c + d, 3), { bone: 'head', color: C.bronze, mat: BRONZE_D, matrix: at(yc), small: true });
  }
  const m = new THREE.Matrix4().makeTranslation(...P.h(0, 0.075 + HELM_Y, 0.54)).multiply(new THREE.Matrix4().makeRotationX(-0.1)).multiply(new THREE.Matrix4().makeRotationZ(Math.PI / 4));
  put(ctx, new THREE.BoxGeometry(0.1 * u, 0.1 * u, 0.012 * u), { bone: 'head', color: C.bronze, mat: BRONZE_D, matrix: m, small: true });
  put(ctx, new THREE.BoxGeometry(0.056 * u, 0.056 * u, 0.012 * u).translate(0, 0, 0.007 * u), { bone: 'head', color: C.steelDark, mat: IRON, matrix: m, small: true });
  // flat bronze nasal strip (0.03 m wide) from the brow band down the bridge of the nose
  if (proj) {
    const hp = V(), hn = V();
    const y = P.h(0, 0.0, 0)[1];
    if (snapPoint(proj, [0, y, 0], 'f', hp, hn)) {
      const mm = frameAt(hp.addScaledVector(hn, 0.0025), hn);
      put(ctx, new THREE.BoxGeometry(0.026, 0.16 * u, 0.005), { bone: 'head', color: C.bronze, mat: BRONZE_D, matrix: mm, small: true });
    }
  }
}

/** boot cuffs, straps and buckles (the boots layer is a plain tube: the sheet's boots are strapped and cuffed) */
function bootFittings(ctx: KindContext) {
  const { P } = ctx;
  const k = P.s / SC_CALIBRATED;
  const C = GIMLI;
  const top = P.ankleH + (P.j.shin_l[1] - P.ankleH) * BOOT_LEN;
  for (const sx of [1, -1]) {
    const side = sx > 0 ? 'l' : 'r';
    const sh = P.j[`shin_${side}`];
    const ft = P.j[`foot_${side}`];
    const bone = `shin_${side}`;
    const at = (y: number) => {
      const f = (y - ft[1]) / Math.max(1e-3, sh[1] - ft[1]);
      return new THREE.Matrix4().makeTranslation(ft[0] + (sh[0] - ft[0]) * f, y, ft[2] + (sh[2] - ft[2]) * f + 0.004 * k);
    };
    const rAt = (y: number) => (0.064 + 0.01 * ((y - P.ankleH) / (top - P.ankleH))) * k * Math.sqrt(P.build.bulk / 1.3);
    // folded cuff at the top
    put(ctx, new THREE.CylinderGeometry(rAt(top) + 0.012 * k, rAt(top) + 0.004 * k, 0.055 * k, 16, 1, true), { bone, color: C.bootsTrim, mat: LEATHER_PLAIN, matrix: at(top - 0.026 * k), small: true });
    // two buckled straps, buckle plates on the outside
    for (const y of [top - 0.1 * k, top - 0.185 * k]) {
      const r = rAt(y);
      put(ctx, new THREE.CylinderGeometry(r + 0.012 * k, r + 0.012 * k, 0.026 * k, 16, 1, true), { bone, color: C.belt, mat: LEATHER_PLAIN, matrix: at(y), small: true });
      put(ctx, new THREE.BoxGeometry(0.014 * k, 0.03 * k, 0.026 * k).translate(sx * (r + 0.016 * k), 0, 0.0), { bone, color: C.bronze, mat: BRONZE_D, matrix: at(y), small: true });
    }
  }
}

/** a crossed-strap diagonal band across the torso, crossing at height `cy` (both signs meet at x = 0) */
function strapAcross(ctx: KindContext, o: { color: number; mat: typeof LEATHER; width: number; inflate: number; sign: 1 | -1; cy: number; tilt: number }) {
  const { P, sculpt: s } = ctx;
  const sc = P.s;
  const parts = anatomyParts(P);
  const n = new THREE.Vector3(o.sign * o.tilt, 1.25, 0).normalize();
  const c = n.dot(new THREE.Vector3(0, o.cy, 0));
  const hw = o.width * 0.5;
  s.group('union', 0.002 * sc, () => {
    emitParts(s, parts, ['ribs', 'chest', 'pecs', 'back', 'trap', 'waist', 'belly'], { color: o.color, color2: GIMLI.leatherTrim, colorNoise: 0.3, colorFreq: 30 / sc, mat: o.mat, inflate: o.inflate });
    s.plane([n.x, n.y, n.z], c + hw, { op: 'intersect', k: 0.003 * sc });
    s.plane([-n.x, -n.y, -n.z], -(c - hw), { op: 'intersect', k: 0.003 * sc });
    // stitched edges of the strap
    s.plane([n.x, n.y, n.z], c + hw, { op: 'paint', seam: 0, k: 0.002 });
    s.plane([-n.x, -n.y, -n.z], -(c - hw), { op: 'paint', seam: 0, k: 0.002 });
  });
}

/** quilted brown leather upper arms and mail forearm sleeves (under the bracers), mail only at the yoke */
function sleeves(ctx: KindContext) {
  const { P, sculpt: s } = ctx;
  const sc = P.s;
  const C = GIMLI;
  const parts = anatomyParts(P);
  const L = P.hand.l.L;
  const sh = P.j.upperarm_l;
  const el = P.j.forearm_l;
  const wr = P.j.hand_l;
  s.mirrored(() => {
    s.group('union', 0.004 * sc, () => {
      emitParts(s, parts, ['upperarm'], { color: C.sleeve, color2: C.leather, colorNoise: 0.35, colorFreq: 26 / sc, mat: QUILT, inflate: 0.034 * sc, oneSide: true });
      limbCutBefore(s, L, [el[0] + L.x * 0.012 * sc, el[1] + L.y * 0.012 * sc, el[2]], 0.006 * sc);
      limbCutAfter(s, L, [sh[0] - L.x * 0.03 * sc, sh[1] - L.y * 0.03 * sc, sh[2]], 0.01 * sc);
    });
    s.group('union', 0.004 * sc, () => {
      emitParts(s, parts, ['forearm'], { color: C.mailBody, mat: MAIL, inflate: 0.022 * sc, oneSide: true });
      limbCutBefore(s, L, [wr[0] - L.x * 0.012 * sc, wr[1] - L.y * 0.012 * sc, wr[2]], 0.006 * sc);
      limbCutAfter(s, L, [el[0] - L.x * 0.02 * sc, el[1] - L.y * 0.02 * sc, el[2]], 0.006 * sc);
    });
  });
}

/** frame of the (left) arm at rest: unit arm axis L and the "up-out" direction perpendicular to it */
function armFrame(P: KindContext['P'], sx: 1 | -1) {
  const L = new THREE.Vector3(P.hand.l.L.x * sx, P.hand.l.L.y, P.hand.l.L.z);
  const up = new THREE.Vector3(Math.cos(Math.PI / 4) * sx, Math.sin(Math.PI / 4), 0);
  const z = new THREE.Vector3().crossVectors(up, L);
  return { L, up, z };
}

/** layered pauldrons: a domed cap over the shoulder and three lames stepping down the upper arm, each with a bronze edge */
function pauldrons(ctx: KindContext) {
  const { P } = ctx;
  const k = (P.s / SC_CALIBRATED) * 1.1;
  const C = GIMLI;
  const g = Math.sqrt(P.build.bulk / 1.3);
  for (const sx of [1, -1] as const) {
    const side = sx > 0 ? 'l' : 'r';
    const sh = new THREE.Vector3(...P.j[`upperarm_${side}`]);
    const { L, up, z } = armFrame(P, sx);
    const basis = new THREE.Matrix4().makeBasis(up, L, z);
    const at = (along: number, out: number) => basis.clone().setPosition(sh.clone().addScaledVector(L, along * k).addScaledVector(up, out * k));
    const bone = `upperarm_${side}`;
    // dome cap with a bronze rim band
    const capGeo = new THREE.SphereGeometry(1, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2).scale(0.115 * k * g, 0.095 * k * g, 0.128 * k * g).rotateZ(-Math.PI / 2);
    put(ctx, capGeo, { bone, color: C.steel, mat: IRON, matrix: at(0.03, -0.012) });
    const rim = new THREE.SphereGeometry(1, 20, 2, 0, Math.PI * 2, Math.PI / 2 - 0.12, 0.12).scale(0.119 * k * g, 0.099 * k * g, 0.132 * k * g).rotateZ(-Math.PI / 2);
    put(ctx, rim, { bone, color: C.bronze, mat: BRONZE_D, matrix: at(0.03, -0.012), small: true });
    // lames stepping down the arm
    for (let i = 0; i < 3; i++) {
      const along = 0.095 + 0.062 * i;
      const r = (0.108 - 0.007 * i) * k * g;
      const h = 0.082 * k;
      const lame = new THREE.CylinderGeometry(r * 1.05, r * 0.96, h, 16, 1, true, -1.85 + Math.PI / 2, 3.7);
      put(ctx, lame, { bone, color: i === 2 ? C.steelDark : C.steel, mat: IRON, matrix: at(along, 0) });
      const trim = new THREE.CylinderGeometry(r * 1.05 + 0.004 * k, r * 1.05 + 0.004 * k, 0.019 * k, 16, 1, true, -1.85 + Math.PI / 2, 3.7);
      put(ctx, trim, { bone, color: C.bronze, mat: BRONZE_D, matrix: at(along + h / 2 - 0.006 * k, 0), small: true });
    }
    // round boss at the front of the cap
    const boss = new THREE.SphereGeometry(0.02 * k, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2).rotateX(Math.PI / 2);
    const bp = sh.clone().addScaledVector(up, 0.065 * k).add(new THREE.Vector3(0, 0, 0.105 * k * g));
    put(ctx, boss, { bone, color: C.brass, mat: BRONZE_D, matrix: new THREE.Matrix4().makeTranslation(bp.x, bp.y, bp.z), small: true });
  }
}

/** wide bronze vambrace plates over the dark leather bracers, on the outside of both forearms */
function vambraces(ctx: KindContext) {
  const { P } = ctx;
  const k = P.s / SC_CALIBRATED;
  for (const sx of [1, -1] as const) {
    const side = sx > 0 ? 'l' : 'r';
    const el = new THREE.Vector3(...P.j[`forearm_${side}`]);
    const { L, up, z } = armFrame(P, sx);
    const basis = new THREE.Matrix4().makeBasis(up, L, z);
    const place = (along: number) => basis.clone().setPosition(el.clone().addScaledVector(L, along));
    const len = P.foreArm;
    const r = 0.062 * k;
    const bone = `forearm_${side}`;
    put(ctx, new THREE.CylinderGeometry(r * 0.98, r * 0.9, len * 0.5, 14, 1, true, -1.3 + Math.PI / 2, 2.6), { bone, color: GIMLI.bronze, mat: BRONZE_D, matrix: place(len * 0.46), small: true });
    // dark leather underlay rings at both ends (hides the wrist gap)
    for (const a of [0.12, 0.88]) put(ctx, new THREE.CylinderGeometry(r * 0.92, r * 0.88, 0.04 * k, 14, 1, true), { bone, color: GIMLI.belt, mat: LEATHER_PLAIN, matrix: place(len * a), small: true });
    for (const a of [0.22, 0.7]) {
      const band = new THREE.CylinderGeometry(r * 1.0 + 0.003 * k, r * 0.94 + 0.003 * k, 0.014 * k, 14, 1, true, -1.5 + Math.PI / 2, 3.0);
      put(ctx, band, { bone, color: GIMLI.brass, mat: BRONZE_D, matrix: place(len * a), small: true });
    }
  }
}

/** a throwing-axe head: flared blade, flat, with the blade facing forward and a little outward */
function throwingAxeHead(sx: number, k: number): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(0.012, 0.03).bezierCurveTo(0.05, 0.034, 0.078, 0.06, 0.082, 0.056).lineTo(0.092, 0.0).lineTo(0.082, -0.056).bezierCurveTo(0.078, -0.06, 0.05, -0.034, 0.012, -0.03).lineTo(0.012, 0.03);
  const blade = new THREE.ExtrudeGeometry(shape, { depth: 0.008, bevelEnabled: false, steps: 1 }).translate(0, 0, -0.004);
  blade.scale(k, k, k);
  blade.rotateY(-Math.PI / 2 + sx * 0.26); // ~15 degrees out
  return blade;
}

/** belt hardware: studs and a square knot-work plate, two throwing axes in sheaths slanting out over the hips */
function beltGear(ctx: KindContext, proj: Projector | null) {
  const { P } = ctx;
  const k = P.s / SC_CALIBRATED;
  const C = GIMLI;
  const by = HIP_Y + (0.07 + BELT_RAISE) * P.s;
  if (proj) {
    const pts: V3[] = [];
    const p = V(), n = V();
    for (let i = 0; i < 28; i++) {
      const a = (i / 28) * Math.PI * 2;
      if (Math.abs(Math.sin(a / 2)) < 0.12) continue; // the plate
      const hit = ringSnap(proj, a, by, 0, 0, p, n);
      if (hit) pts.push([hit.p.x + hit.n.x * 0.002 * k, hit.p.y, hit.p.z + hit.n.z * 0.002 * k]);
    }
    const sg = studs(pts, 0.0062 * k, 0.6);
    if (sg) put(ctx, sg, { bone: 'hips', color: C.brass, mat: BRONZE_D, small: true });
    const hp = V(), hn = V();
    if (snapPoint(proj, [0, by, 0.3], 'f', hp, hn)) {
      const m = frameAt(hp.addScaledVector(hn, 0.003 * k), hn);
      put(ctx, new THREE.BoxGeometry(0.082 * k, 0.062 * k, 0.008 * k), { bone: 'hips', color: C.bronze, mat: BRONZE_D, matrix: m, small: true });
      put(ctx, new THREE.BoxGeometry(0.052 * k, 0.04 * k, 0.006 * k).translate(0, 0, 0.006 * k), { bone: 'hips', color: C.steelDark, mat: IRON, matrix: m, small: true });
      put(ctx, new THREE.SphereGeometry(0.014 * k, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2).rotateX(Math.PI / 2).translate(0, 0, 0.01 * k), { bone: 'hips', color: C.brass, mat: BRONZE_D, matrix: m, small: true });
    }
  }
  // two throwing axes: heads at the belt, handles in leather sheaths slanting outward over the hips
  const slant = 0.3;
  const len = 0.26 * k;
  for (const sx of [1, -1]) {
    const x0 = sx * 0.2 * k;
    const top = by - 0.03;
    const zz = 0.03 * k;
    const head = throwingAxeHead(sx, k * 1.7).translate(x0, by - 0.004, zz);
    const g = mergeAll([head]);
    if (g) put(ctx, g, { bone: 'hips', color: C.steel, mat: IRON, small: true });
    const sheath = new THREE.CylinderGeometry(0.019 * k, 0.0155 * k, len, 8).translate(0, -len / 2, 0).rotateZ(sx * slant).translate(x0, top, zz);
    put(ctx, sheath, { bone: 'hips', color: 0x3a2616, mat: LEATHER_PLAIN, small: true });
    for (const t of [0.02 * k, 0.24 * k]) {
      const ringGeo = new THREE.CylinderGeometry(0.0215 * k, 0.0205 * k, 0.012 * k, 8).rotateZ(sx * slant).translate(x0 + sx * Math.sin(slant) * t, top - Math.cos(slant) * t, zz);
      put(ctx, ringGeo, { bone: 'hips', color: C.bronze, mat: BRONZE_D, small: true });
    }
    put(ctx, new THREE.BoxGeometry(0.03 * k, 0.07 * k, 0.026 * k).translate(x0, by - 0.012, zz), { bone: 'hips', color: C.bronze, mat: BRONZE_D, small: true });
  }
}

/**
 * A leather hem band with bronze studs round the mail skirt. The cloth skirt is skinned to the thigh and
 * `skirt_f/b` bones at the hem, so the band is cut into four arcs, each rigid to the bone that carries
 * that part of the hem.
 */
function hemBand(ctx: KindContext) {
  const { P } = ctx;
  const sc = P.s;
  const g = P.build.bulk;
  const grow = SKIRT_GROW * sc;
  // the cloth skirt's hem ellipse (humanoid/cloth.ts, skirtGeometry)
  const rx0 = 0.158 * sc * P.build.hips * Math.sqrt(g) + 0.012 * sc + grow;
  const rz0 = 0.112 * sc * Math.sqrt(g) + 0.012 * sc + grow;
  const legR = 0.08 * sc * g;
  const flare = 0.04 * sc;
  const rx = Math.max(rx0, P.hipX + legR + 0.03 * sc + grow) + flare + 0.004 * sc;
  const rz = Math.max(rz0, legR + 0.035 * sc + grow) + flare * 0.8 + 0.004 * sc;
  const h = 0.045 * (sc / SC_CALIBRATED);
  const y = HEM_Y + h / 2 - 0.004;
  const arcs: { bone: string; a0: number; a1: number }[] = [
    { bone: 'skirt_f', a0: -Math.PI / 4, a1: Math.PI / 4 },
    { bone: 'thigh_l', a0: Math.PI / 4, a1: (3 * Math.PI) / 4 },
    { bone: 'skirt_b', a0: (3 * Math.PI) / 4, a1: (5 * Math.PI) / 4 },
    { bone: 'thigh_r', a0: (5 * Math.PI) / 4, a1: (7 * Math.PI) / 4 },
  ];
  for (const { bone, a0, a1 } of arcs) {
    if (!ctx.rig.has(bone)) continue;
    const band = new THREE.CylinderGeometry(1, 1, h, 14, 1, true, a0, a1 - a0).scale(rx, 1, rz).translate(0, y, -0.01 * sc);
    put(ctx, band, { bone, color: GIMLI.tabard, mat: LEATHER, small: true });
    const edge = new THREE.CylinderGeometry(1, 1, 0.006, 14, 1, true, a0, a1 - a0).scale(rx + 0.002, 1, rz + 0.002).translate(0, HEM_Y + 0.001, -0.01 * sc);
    put(ctx, edge, { bone, color: GIMLI.bronze, mat: BRONZE_D, small: true });
    const pts: V3[] = [];
    const n = 7;
    for (let i = 0; i < n; i++) {
      const a = a0 + ((i + 0.5) / n) * (a1 - a0);
      pts.push([Math.sin(a) * (rx + 0.003), y, Math.cos(a) * (rz + 0.003) - 0.01 * sc]);
    }
    const sg = studs(pts, 0.0055 * (sc / SC_CALIBRATED), 0.6);
    if (sg) put(ctx, sg, { bone, color: GIMLI.brass, mat: BRONZE_D, small: true });
  }
}

/** the two thick braids: from the chin corners in a clear V down to the belt, copper red, with two bronze clasps each */
function beardBraids(ctx: KindContext, proj: Projector | null, beardLen: number) {
  const { P, rig } = ctx;
  const u = P.headH;
  const sc = P.s;
  const iJaw = rig.boneIndex('jaw');
  const iB1 = rig.boneIndex('beard1');
  const iB2 = rig.boneIndex('beard2');
  const chinY = P.headC[1] - 0.6 * u;
  const span = Math.max(0.05, beardLen + 0.1 * sc);
  const w: WeightFn = (p, _a, out) => {
    if (iB1 < 0 || p.y > chinY) {
      out.push([iJaw, 1]);
      return;
    }
    const t = Math.min(1, (chinY - p.y) / span);
    out.push([iJaw, Math.max(0, 1 - t * 2)], [iB1, Math.min(1, t * 2) * (1 - t)], [iB2, t * t]);
  };
  const radius = 0.024 * (sc / SC_CALIBRATED); // ~0.045 m thick
  const yEnd = BELT_Y + 0.02;
  const p0 = P.h(0.19, -0.5, 0.24);
  const n = 6;
  for (const sx of [1, -1]) {
    const pts: V3[] = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const y = p0[1] + (yEnd - p0[1]) * t;
      const x = sx * (Math.abs(p0[0]) + (0.105 - Math.abs(p0[0])) * Math.pow(t, 0.8));
      let z = 0.17 * sc + radius * 2;
      const hp = V(), hn = V();
      if (proj && snapPoint(proj, [x, y, 0], 'f', hp, hn)) z = hp.z + radius * 0.9 + 0.006;
      pts.push(i === 0 ? [sx * Math.abs(p0[0]), p0[1], p0[2]] : [x, y, Math.max(z, p0[2] * 0.6)]);
    }
    const geo = braidGeometry(pts, radius, GIMLI.braid, w, { seg: 16, radial: 6, taper: 0.3, twist: 30 });
    queueHair(ctx, geo, GIMLI.hair);
    // two bronze clasp rings per braid (the ring is just wider than the braid)
    const curve = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(p[0], p[1], p[2])), false, 'catmullrom', 0.3);
    for (const t of [0.42, 0.97]) {
      const p = curve.getPointAt(t);
      const d = curve.getTangentAt(t);
      put(ctx, ring([p.x, p.y, p.z], [d.x, d.y, d.z], radius * (1 - 0.3 * t * t) + 0.005, 0.0055, 10), { bone: 'beard2', color: GIMLI.bronze, mat: BRONZE_D, small: true });
    }
  }
}

/** colour of the first hair piece queued (the brows), which keys the merged hair material */
const BROW_COLOR = mix(GIMLI.hair, 0x000000, 0.35);

/** copper-red hair: the kit's default strand highlight is a pale cream that turns dark red hair beige */
function tuneHairMaterial() {
  const m = hairMaterial(BROW_COLOR);
  m.roughness = 0.82;
  m.sheen = 0.04;
  m.specularIntensity = 0.05;
  const u = m.userData.hairUniforms as { hairSpec: { value: number }; hairHighlight: { value: THREE.Vector3 } } | undefined;
  if (u) {
    u.hairSpec.value = 0.2;
    const c = new THREE.Color().setHex(0x80502c, THREE.SRGBColorSpace);
    u.hairHighlight.value.set(c.r, c.g, c.b);
  }
}

export function gimliExtras(ctx: KindContext) {
  tuneHairMaterial();
  withHair(ctx, () => gimliBody(ctx));
}

function gimliBody(ctx: KindContext) {
  const { P, sculpt: s } = ctx;
  const C = GIMLI;
  const rng = new Rng(0x61a11);
  const sc = P.s;
  const u = P.headH;
  const beardLen = 0.36 * sc;
  // ── scalp cap (under the helm / hair), eyebrows and a heavier brow ──
  const hair = { style: 'long_wavy' as const, color: C.hair, tipColor: C.hairTip, length: 1.0, density: 1.25, bounce: 0.5 };
  sculptHairCap(s, P, hair);
  addBrows(ctx, { color: BROW_COLOR, count: 14, length: 0.085, width: 0.016, y: 0.075, z: 0.395 }, new Rng(0xb70));
  // deep-set eyes: dark sockets, ruddy cheeks and nose
  s.mirrored(() => s.ellipsoid(P.h(0.135, -0.055, 0.33), [0.095 * u, 0.06 * u, 0.06 * u], { op: 'paint', color: 0x7e4232, mat: 'skin_weathered', bone: 'head', k: 0.04 * u, strength: 0.55 }));
  s.mirrored(() => s.ellipsoid(P.h(0.17, -0.2, 0.31), [0.1 * u, 0.08 * u, 0.06 * u], { op: 'paint', color: 0xa24a38, mat: 'skin_weathered', bone: 'head', k: 0.05 * u, strength: 0.7 }));
  s.ellipsoid(P.h(0, -0.27, 0.52), [0.075 * u, 0.06 * u, 0.06 * u], { op: 'paint', color: 0xb05444, mat: 'skin_weathered', bone: 'head', k: 0.04 * u, strength: 0.6 });
  // ── hauberk: mail yoke over the shoulders; sleeves are leather (see `sleeves`); the skirt is the outfit's `skirt` layer ──
  sculptTorsoGarment(ctx, { color: C.mailBody, mat: MAIL, inflate: 0.036 * sc, hem: 0.0, sleeve: 0, shoulders: true });
  sleeves(ctx);
  // mail "shorts" under the skirt: the trousers' thighs would poke out at the hips and through the gaps between skirt panels
  {
    const parts = anatomyParts(P);
    s.group('union', 0.004 * sc, () => {
      emitParts(s, parts, ['thigh'], { color: C.mailBody, mat: MAIL, inflate: 0.03 * sc });
      slab(s, HEM_Y + 0.015 * sc, HIP_Y + 0.05 * sc, 0.004 * sc);
    });
  }
  // leather straps crossed on chest and back
  for (const sign of [1, -1] as const) strapAcross(ctx, { color: C.leather, mat: LEATHER, width: 0.05 * sc, inflate: 0.043 * sc, sign, cy: CROSS_Y, tilt: 0.95 });
  // wide leather belt over the hauberk
  sculptBand(ctx, { color: C.belt, mat: LEATHER_PLAIN, y0: BELT_Y - 0.036 * sc, y1: BELT_Y + 0.036 * sc, inflate: 0.05 * sc });
  // beard mass (forked)
  if (!devNum('nobeard', 0)) sculptBeardMass(ctx, { color: mix(C.beard, 0x000000, 0.25), color2: C.hair, length: 0.42 * sc, width: 1.1, fork: 1.2, fullness: 1.7, clear: 0.015 * sc });
  // everything sculpted: snapshot the surface for the gear that sits on it
  const proj = makeProjector(s, { min: [-0.45, 0.35, -0.35], max: [0.45, 1.3, 0.4] });
  // ── hair and beard ──
  if (!devNum('nohair', 0)) addHairdo(ctx, { color: C.hair, tip: C.hairTip, deep: mix(C.hair, 0x000000, 0.3), length: 0.74 * sc, count: 230, width: 0.05, wave: 0.9, wild: 0.8, comb: 0.9, front: 0.27, back: -0.4, gravity: 3.5, segments: 5 }, new Rng(0x517));
  if (!devNum('nobeard', 0)) {
    addBeard(
      ctx,
      {
        color: C.beard,
        tip: C.beardTip,
        deep: mix(C.beard, 0x000000, 0.35),
        length: beardLen,
        clear: 0.05 * sc,
        locks: 22,
        perLock: 12,
        segments: 6,
        spread: 1.1,
        shape: 'forked',
        cheeks: true,
        wave: 0.7,
        width: 0.05,
        moustache: { length: 0.1 * sc, droop: 0.5, curl: 0.5 },
      },
      rng,
    );
    beardBraids(ctx, proj, beardLen);
  }
  // ── armour ──
  if (ctx.helmet) {
    dwarfHelm(ctx);
    helmFittings(ctx, proj);
  }
  bootFittings(ctx);
  if (ctx.armor >= 0.5) pauldrons(ctx);
  vambraces(ctx);
  hemBand(ctx);
  if (proj) {
    const hp = V(), hn = V();
    // bronze square bosses where the straps cross: front and back
    for (const face of ['f', 'b'] as const) {
      if (snapPoint(proj, [0, CROSS_Y, 0], face, hp, hn)) {
        const m = frameAt(hp.addScaledVector(hn, 0.002 * sc), hn);
        const rot = m.clone().multiply(new THREE.Matrix4().makeRotationZ(Math.PI / 4));
        put(ctx, new THREE.BoxGeometry(0.052 * sc, 0.052 * sc, 0.006 * sc), { bone: 'chest', color: C.bronze, mat: BRONZE_D, matrix: rot, small: true });
        put(ctx, new THREE.BoxGeometry(0.03 * sc, 0.03 * sc, 0.006 * sc).translate(0, 0, 0.005 * sc), { bone: 'chest', color: C.steelDark, mat: IRON, matrix: rot, small: true });
        put(ctx, new THREE.SphereGeometry(0.009 * sc, 6, 4, 0, Math.PI * 2, 0, Math.PI / 2).rotateX(Math.PI / 2).translate(0, 0, 0.009 * sc), { bone: 'chest', color: C.brass, mat: BRONZE_D, matrix: m, small: true });
      }
    }
  }
  beltGear(ctx, proj);
}

export const gimliDef: KindDef = {
  label: 'Gimli',
  height: HEIGHT,
  build: { shoulders: 1.46, hips: 2.2, bulk: 1.3, belly: 0.4, chest: 1.5, armLength: 1.0, legLength: LEG_LENGTH, headSize: HEAD_SIZE, neck: 0.4, neckThick: 1.4, handSize: 1.32, footSize: FOOT_SIZE, muscle: 0.55 },
  face: {
    jaw: 1.2, jawLength: 0.95, chin: 0.9, brow: 2.0, cheekbones: 1.2,
    nose: { length: 1.2, width: 1.5, bridge: 1.1, hook: 0.25, tip: 1.4 },
    lips: { width: 1.0, fullness: 0.85 }, ears: 'round', earSize: 1.0, eyeSize: 0.86, eyeOpen: 0.62, eyeSpacing: 0.96, eyeTilt: -0.04, foreheadSlope: 0.1,
  },
  skin: { color: GIMLI.skin, color2: GIMLI.skin2, blotch: 0.45, blemish: 0.2, scars: 1, wrinkles: 0.55, lips: GIMLI.lips, brows: GIMLI.hair, surface: 'skin_weathered', scatter: 0x8a2a1a },
  eyes: { color: GIMLI.eyes, sclera: 0xbcaa96 },
  // chain bones only: the visible hair and beard are grown in extras (see hair.ts)
  hair: { style: 'stringy', color: GIMLI.hair, density: 0 },
  beard: { style: 'stubble', color: GIMLI.beard, length: 0.08 },
  outfit: [
    // charcoal wool trousers, thick: they show between the hauberk hem and the boot tops
    { type: 'trousers', color: GIMLI.trousers, mat: WOOL, thickness: 0.009 },
    // short, thick boots with a folded cuff (top ~0.29 m)
    { type: 'boots', color: GIMLI.boots, color2: GIMLI.bootsTrim, length: BOOT_LEN, thickness: 0.014, mat: LEATHER_PLAIN },
    // the hauberk itself is sculpted in extras; this is the swinging mail skirt with a leather tabard front and back
    {
      type: 'skirt',
      color: GIMLI.mail,
      color2: GIMLI.tabard,
      mat: MAIL,
      length: SKIRT_LEN,
      thickness: SKIRT_GROW,
      strips: { count: 2, color: GIMLI.tabard, color2: GIMLI.leatherTrim, mat: LEATHER, width: 0.17, length: 1.0 },
    },
    { type: 'belt', color: GIMLI.belt, offset: BELT_RAISE, thickness: 0.006, mat: LEATHER_PLAIN },
    { type: 'bracers', color: GIMLI.bracers, color2: GIMLI.belt, length: 0.95, thickness: 0.016, mat: LEATHER },
  ],
  armor: [],
  weapons: { right: 'dwarf_axe', style: 'dwarf' },
  palette: GIMLI,
  anim: { swagger: 0.5, aggression: 0.55, stance: 1.2, cadence: 1.05, armSwing: 1.0 },
  variation: { height: 0, bulk: 0, skin: 0 },
  // named character: a fine face region within the 45k budget
  detail: { res: devNum('res', 0.034), headRes: devNum('headRes', 0.0095), faceRes: devNum('faceRes', 0.0056), refine: 1, hands: false, detailScale: devNum('ds', 0.55) },
  sfx: { voice: 'dwarf', weight: 0.7 },
  extras: gimliExtras,
};
