/**
 * Gimli, son of Gloin (docs/refs/gimli): a very stocky dwarf, ~1.46 m to the crown (the sheet's 1.53 m
 * includes the pointed helm), a knee-length mail hauberk over quilted brown leather with a leather
 * tabard panel front and back, crossed straps with a square bronze boss, layered steel pauldrons with
 * bronze edges, a pointed iron helm with a bronze brow band and cheek plates, a forked red-brown
 * beard in two braids with bronze clasps, wild wavy hair, bracers, charcoal trousers, short thick
 * boots, a battle axe in the right hand and two throwing axes in sheaths at the hips.
 */
import * as THREE from 'three';
import { Rng } from '../../../../core/rng';
import type { V3 } from '../../../kit/sdf';
import { surface } from '../../../kit/surfaces';
import type { KindContext, KindDef } from '../../types';
import { anatomyParts, emitParts } from '../../anatomy';
import { arcPlate, mergeAll, put, studs } from './armor';
import { STEEL, domeHelm } from './headgear';
import { devNum, mix } from './common';
import { addBeard, addBrows, addHairdo, braidClasps, hairMaterial, sculptBeardMass, withHair } from './hair';
import { sculptBand, sculptTorsoGarment, slab } from './garments';
import { sculptHairCap } from '../../hairstyles';
import { frameAt, makeProjector, ringSnap, snapPoint, V, type Projector } from '../uruks_bosses/common';

/** sRGB albedos from docs/refs/gimli/spec.json, cross-checked against observed.samples (lit) and the turnaround */
export const GIMLI = {
  // sheet: root #62351f, tip #875033, observed (lit) #542310: a saturated copper red-brown. The
  // strand shader lifts and pales it, so the albedos sit deeper and redder than the sheet hexes.
  hair: 0x371306,
  hairTip: 0x5a240d,
  hairLight: 0x74361a,
  beard: 0x3b1507,
  beardTip: 0x5c2410,
  // sheet face #bd896c, lit #b66551: ruddy, weathered. Warmer/deeper albedo so it does not render as clay.
  skin: 0x7a4430,
  skin2: 0x683622,
  lips: 0x743a30,
  eyes: 0x6e4a22, // sheet #756346, a little darker (deep-set, in shadow under the brow)
  // sheet cloth #4d382b / observed #312925: charcoal wool leggings
  trousers: 0x33302d,
  // sheet leather #513a28 / observed #4d3226: boots read a warm reddish brown
  boots: 0x3d281c,
  bootsTrim: 0x382417,
  // mail: observed greys ~#4a4948, rings are dark gunmetal (turnaround), not bright steel
  mail: 0x4a4540,
  jerkin: 0x2a1405, // quilted/tooled brown leather (tabard, straps, sleeves)
  jerkinTrim: 0x3c2a1a,
  belt: 0x241911,
  bracers: 0x2a1c11,
  // sheet metal #60605a, observed #747274: hammered iron, a light grey with a warm cast
  steel: 0x5a5a5c,
  steelDark: 0x47474a,
  // bronze fittings: observed #8c714f
  bronze: 0x86602a,
  brass: 0x9a7632,
  buckle: 0x9b7a3c,
};

/** hammered, darker gunmetal chain (the kit's `mail` pattern is bright and sparkly by default) */
const MAIL = surface('mail', { rough: 0.6, metal: 0.6 });
/** bronze fittings: duller and browner than the kit's bright gold */
/** the cloth skirt fades its pattern in from the waist: a stronger ring pattern keeps the mail readable */
const SKIRT_MAIL = surface('mail', { rough: 0.6, metal: 0.6, pat: { scales: 2.6 } });
const BRONZE_D = surface('gold', { rough: 0.5 });
/** quilted/stitched brown leather: tooled, so the tabard and straps carry the embossed knot-work look */
const LEATHER = surface('leather_tooled', { rough: 0.7, sheen: 0 });
const LEATHER_PLAIN = surface('leather_worn', { rough: 0.7 });
/** wool trousers: dense twill */
const WOOL = surface('twill', { rough: 0.9, sheen: 0.2 });
/** hammered iron of the pauldrons and helm: lighter than the kit's dark steel */
const IRON = surface('metal_hammered', { rough: 0.5, metal: 0.85 });

// ── landmark heights (m above the ground), from the calibrated sheet compare (286.9 px/m) ──
const HEIGHT = 1.46;
/** hip joint height from proportions.ts for this build (headSize 1.3, legLength 0.8) */
const HIP_Y = 0.512 * HEIGHT * 0.8 * Math.min(1.08, 1 / Math.max(0.75, 1.3 * 0.12 + 0.88));
const SC0 = HEIGHT / 1.85;
/** belt at 0.77 m (sheet) */
const BELT_Y = 0.77;
const BELT_RAISE = (BELT_Y - HIP_Y) / SC0 - 0.07;
/** where the crossed straps meet on the chest/back (sheet front 1.06 m, back 1.0 m) */
const CROSS_Y = 1.04;

/** Gimli's pointed iron helm: bronze brow band, central bronze ridge, hinged cheek plates */
function dwarfHelm(ctx: KindContext) {
  const prof: [number, number][] = [
    [0.4, -0.05], [0.405, 0.03], [0.392, 0.12], [0.36, 0.23], [0.305, 0.33], [0.235, 0.42], [0.155, 0.49], [0.085, 0.545], [0.04, 0.585], [0.016, 0.615], [0.0, 0.64],
  ];
  domeHelm(ctx, { color: GIMLI.steel, trim: GIMLI.bronze, mat: IRON, trimMat: BRONZE_D, profile: prof, tilt: -0.08, y: 0.07, finial: 'spike', rivets: 14, bandWidth: 1.0, cheeks: false });
}

/** bronze-framed cheek plates hanging from the brow band, and a diamond ornament at the centre of the band */
function helmFittings(ctx: KindContext) {
  const { P } = ctx;
  const u = P.headH;
  const C = GIMLI;
  for (const sx of [1, -1]) {
    const c = sx > 0 ? 0 : Math.PI;
    const at = (y: number) => new THREE.Matrix4().makeTranslation(...P.h(0, y, -0.03));
    put(ctx, arcPlate(0.372 * u, 0.25 * u, 0.62, c, 8), { bone: 'head', color: C.steel, mat: IRON, matrix: at(0.01), small: true });
    // bronze frame: top and bottom bars and the two side strips
    put(ctx, arcPlate(0.378 * u, 0.026 * u, 0.66, c, 8), { bone: 'head', color: C.bronze, mat: BRONZE_D, matrix: at(0.115), small: true });
    put(ctx, arcPlate(0.378 * u, 0.026 * u, 0.66, c, 8), { bone: 'head', color: C.bronze, mat: BRONZE_D, matrix: at(-0.095), small: true });
    for (const d of [-0.3, 0.3]) put(ctx, arcPlate(0.378 * u, 0.25 * u, 0.05, c + d, 3), { bone: 'head', color: C.bronze, mat: BRONZE_D, matrix: at(0.01), small: true });
  }
  const m = new THREE.Matrix4().makeTranslation(...P.h(0, 0.145, 0.525)).multiply(new THREE.Matrix4().makeRotationX(-0.1)).multiply(new THREE.Matrix4().makeRotationZ(Math.PI / 4));
  put(ctx, new THREE.BoxGeometry(0.1 * u, 0.1 * u, 0.012 * u), { bone: 'head', color: C.bronze, mat: BRONZE_D, matrix: m, small: true });
  put(ctx, new THREE.BoxGeometry(0.056 * u, 0.056 * u, 0.012 * u).translate(0, 0, 0.007 * u), { bone: 'head', color: C.steelDark, mat: IRON, matrix: m, small: true });
}

/** boot cuffs, straps and buckles (the boots layer is a plain tube: the sheet's boots are strapped and cuffed) */
function bootFittings(ctx: KindContext) {
  const { P } = ctx;
  const sc = P.s;
  const k = sc / SC0;
  const C = GIMLI;
  const top = P.ankleH + (P.j.shin_l[1] - P.ankleH) * 0.87;
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
    emitParts(s, parts, ['ribs', 'chest', 'pecs', 'back', 'trap', 'waist', 'belly'], { color: o.color, color2: GIMLI.jerkinTrim, colorNoise: 0.3, colorFreq: 30 / sc, mat: o.mat, inflate: o.inflate });
    s.plane([n.x, n.y, n.z], c + hw, { op: 'intersect', k: 0.003 * sc });
    s.plane([-n.x, -n.y, -n.z], -(c - hw), { op: 'intersect', k: 0.003 * sc });
    // stitched edges of the strap
    s.plane([n.x, n.y, n.z], c + hw, { op: 'paint', seam: 0, k: 0.002 });
    s.plane([-n.x, -n.y, -n.z], -(c - hw), { op: 'paint', seam: 0, k: 0.002 });
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
  const sc = P.s;
  const k = sc / SC0;
  const C = GIMLI;
  const g = Math.sqrt(P.build.bulk / 1.3);
  for (const sx of [1, -1] as const) {
    const side = sx > 0 ? 'l' : 'r';
    const sh = new THREE.Vector3(...P.j[`upperarm_${side}`]);
    const { L, up, z } = armFrame(P, sx);
    const basis = new THREE.Matrix4().makeBasis(up, L, z);
    const at = (along: number, out: number) => basis.clone().setPosition(sh.clone().addScaledVector(L, along * k).addScaledVector(up, out * k));
    const bone = `upperarm_${side}`;
    // cap: a half ellipsoid with its pole along "up-out", plus a thin bronze rim band
    const capGeo = new THREE.SphereGeometry(1, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2).scale(0.115 * k * g, 0.088 * k * g, 0.128 * k * g).rotateZ(-Math.PI / 2);
    put(ctx, capGeo, { bone, color: C.steel, mat: IRON, matrix: at(0.03, -0.012) });
    const rim = new THREE.SphereGeometry(1, 20, 2, 0, Math.PI * 2, Math.PI / 2 - 0.1, 0.1).scale(0.118 * k * g, 0.091 * k * g, 0.131 * k * g).rotateZ(-Math.PI / 2);
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
    const bp = sh.clone().addScaledVector(up, 0.06 * k).addScaledVector(L, 0.0).add(new THREE.Vector3(0, 0, 0.1 * k * g));
    put(ctx, boss, { bone, color: C.brass, mat: BRONZE_D, matrix: new THREE.Matrix4().makeTranslation(bp.x, bp.y, bp.z), small: true });
  }
}

/** bronze-edged vambrace plates on the outside of both forearms */
function vambraces(ctx: KindContext) {
  const { P } = ctx;
  const sc = P.s;
  const k = sc / SC0;
  for (const sx of [1, -1] as const) {
    const side = sx > 0 ? 'l' : 'r';
    const el = new THREE.Vector3(...P.j[`forearm_${side}`]);
    const { L, up, z } = armFrame(P, sx);
    const basis = new THREE.Matrix4().makeBasis(up, L, z);
    const place = (along: number) => basis.clone().setPosition(el.clone().addScaledVector(L, along));
    const len = P.foreArm;
    const r = 0.054 * k;
    const bone = `forearm_${side}`;
    const plate = new THREE.CylinderGeometry(r * 0.98, r * 0.9, len * 0.36, 12, 1, true, -0.95 + Math.PI / 2, 1.9);
    put(ctx, plate, { bone, color: GIMLI.bronze, mat: BRONZE_D, matrix: place(len * 0.4), small: true });
    for (const a of [0.2, 0.6]) {
      const band = new THREE.CylinderGeometry(r * 1.0 + 0.003 * k, r * 0.94 + 0.003 * k, 0.015 * k, 14, 1, true, -1.3 + Math.PI / 2, 2.6);
      put(ctx, band, { bone, color: GIMLI.brass, mat: BRONZE_D, matrix: place(len * a), small: true });
    }
  }
}

/** a little double-bit throwing axe head: flared blade, bronze eye, handle running down into a sheath */
function throwingAxe(sx: number, beltY: number, k: number): THREE.BufferGeometry[] {
  const shape = new THREE.Shape();
  shape.moveTo(0.012, 0.03).bezierCurveTo(0.05, 0.034, 0.078, 0.06, 0.082, 0.056).lineTo(0.092, 0.0).lineTo(0.082, -0.056).bezierCurveTo(0.078, -0.06, 0.05, -0.034, 0.012, -0.03).lineTo(0.012, 0.03);
  const blade = new THREE.ExtrudeGeometry(shape, { depth: 0.008, bevelEnabled: false, steps: 1 }).translate(0, 0, -0.004);
  blade.scale(k, k, k);
  blade.rotateY(-Math.PI / 2 + sx * 0.45);
  blade.translate(sx * 0.215, beltY - 0.012, 0.03);
  return [blade];
}

/** belt hardware: a wide leather band with bronze studs and a square knot-work plate, throwing axes in sheaths */
function beltGear(ctx: KindContext, proj: Projector | null) {
  const { P } = ctx;
  const sc = P.s;
  const k = sc / SC0;
  const C = GIMLI;
  const by = HIP_Y + (0.07 + BELT_RAISE) * sc;
  // studs round the belt
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
    // square plate with a diamond boss on the front
    const hp = V(), hn = V();
    if (snapPoint(proj, [0, by, 0.3], 'f', hp, hn)) {
      const m = frameAt(hp.addScaledVector(hn, 0.003 * k), hn);
      put(ctx, new THREE.BoxGeometry(0.082 * k, 0.062 * k, 0.008 * k), { bone: 'hips', color: C.bronze, mat: BRONZE_D, matrix: m, small: true });
      put(ctx, new THREE.BoxGeometry(0.052 * k, 0.04 * k, 0.006 * k).translate(0, 0, 0.006 * k), { bone: 'hips', color: C.steelDark, mat: IRON, matrix: m, small: true });
      put(ctx, new THREE.SphereGeometry(0.014 * k, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2).rotateX(Math.PI / 2).translate(0, 0, 0.01 * k), { bone: 'hips', color: C.brass, mat: BRONZE_D, matrix: m, small: true });
    }
  }
  // two throwing axes: heads at the belt, handles in leather sheaths running down the hips
  for (const sx of [1, -1]) {
    const parts: THREE.BufferGeometry[] = throwingAxe(sx, by - 0.004, k * 1.35);
    const g = mergeAll(parts);
    if (g) put(ctx, g, { bone: 'hips', color: C.steel, mat: IRON, small: true });
    const x = sx * 0.215;
    const top = by - 0.03;
    const zz = 0.03;
    const sheath = new THREE.CylinderGeometry(0.019 * k, 0.0155 * k, 0.26 * k, 8).translate(x, top - 0.13 * k, zz);
    put(ctx, sheath, { bone: 'hips', color: 0x3a2616, mat: LEATHER_PLAIN, small: true });
    for (const t of [0.02, 0.24]) {
      put(ctx, new THREE.CylinderGeometry(0.0215 * k, 0.0205 * k, 0.012 * k, 8).translate(x, top - t * k, zz), { bone: 'hips', color: C.bronze, mat: BRONZE_D, small: true });
    }
    // eye block where the head meets the handle
    put(ctx, new THREE.BoxGeometry(0.03 * k, 0.07 * k, 0.026 * k).translate(x, by - 0.012, zz), { bone: 'hips', color: C.bronze, mat: BRONZE_D, small: true });
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
    u.hairSpec.value = 0.3;
    const c = new THREE.Color().setHex(0xa05a30, THREE.SRGBColorSpace);
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
  // ── scalp cap (under the helm / hair), eyebrows and a heavier brow ──
  const hair = { style: 'long_wavy' as const, color: C.hair, tipColor: C.hairTip, length: 1.0, density: 1.25, bounce: 0.5 };
  sculptHairCap(s, P, hair);
  // bushy brows
  addBrows(ctx, { color: BROW_COLOR, count: 14, length: 0.085, width: 0.016, y: 0.075, z: 0.395 }, new Rng(0xb70));
  // deep-set eyes: dark sockets, ruddy cheeks and nose
  s.mirrored(() => s.ellipsoid(P.h(0.135, -0.055, 0.33), [0.095 * u, 0.06 * u, 0.06 * u], { op: 'paint', color: 0x7e4232, mat: 'skin_weathered', bone: 'head', k: 0.04 * u, strength: 0.55 }));
  s.mirrored(() => s.ellipsoid(P.h(0.17, -0.2, 0.31), [0.1 * u, 0.08 * u, 0.06 * u], { op: 'paint', color: 0xa24a38, mat: 'skin_weathered', bone: 'head', k: 0.05 * u, strength: 0.7 }));
  s.ellipsoid(P.h(0, -0.27, 0.52), [0.075 * u, 0.06 * u, 0.06 * u], { op: 'paint', color: 0xb05444, mat: 'skin_weathered', bone: 'head', k: 0.04 * u, strength: 0.6 });
  // ── hauberk: mail to the elbow, over the shoulders; the skirt is the outfit's `skirt` layer ──
  sculptTorsoGarment(ctx, { color: C.mail, mat: MAIL, inflate: 0.036 * sc, hem: 0.0, sleeve: 1.0 });
  // mail "shorts" under the skirt: the trousers' thighs would poke out at the hips and through the gaps between skirt panels
  {
    const hipY = P.j.thigh_l[1];
    const kneeY = P.j.shin_l[1];
    const hem = hipY - (hipY - kneeY) * 0.58 * 1.1;
    const parts = anatomyParts(P);
    s.group('union', 0.004 * sc, () => {
      emitParts(s, parts, ['thigh'], { color: C.mail, mat: MAIL, inflate: 0.03 * sc });
      slab(s, hem + 0.015 * sc, hipY + 0.05 * sc, 0.004 * sc);
    });
  }
  // leather straps crossed on chest and back (sheet front crossing ~1.06 m, back ~1.0 m)
  for (const sign of [1, -1] as const) strapAcross(ctx, { color: C.jerkin, mat: LEATHER, width: 0.05 * sc, inflate: 0.043 * sc, sign, cy: CROSS_Y, tilt: 0.95 });
  // wide leather belt over the hauberk
  sculptBand(ctx, { color: C.belt, mat: LEATHER_PLAIN, y0: BELT_Y - 0.036 * sc, y1: BELT_Y + 0.036 * sc, inflate: 0.05 * sc });
  // ── hair and beard ──
  if (!devNum('nohair', 0)) addHairdo(ctx, { color: C.hair, tip: C.hairTip, deep: mix(C.hair, 0x000000, 0.3), length: 0.82 * sc, count: 260, width: 0.05, wave: 0.9, wild: 0.5, comb: 0.9, front: 0.27, back: -0.4, gravity: 4.5, segments: 5 }, new Rng(0x517));
  // beard: a forked mass with two thick braids and a moustache
  if (!devNum('nobeard', 0)) sculptBeardMass(ctx, { color: mix(C.beard, 0x000000, 0.25), color2: C.hair, length: 0.42 * sc, width: 1.1, fork: 1.2, fullness: 1.7, clear: 0.015 * sc });
  const br = !devNum('nobeard', 0)
    ? addBeard(
        ctx,
        {
          color: C.beard,
          tip: C.beardTip,
          deep: mix(C.beard, 0x000000, 0.35),
          length: 0.36 * sc,
          clear: 0.05 * sc,
          locks: 24,
          perLock: 13,
          segments: 6,
          spread: 1.1,
          shape: 'forked',
          cheeks: true,
          wave: 0.7,
          width: 0.05,
          moustache: { length: 0.1 * sc, droop: 0.5, curl: 0.5 },
          braids: [
            { x: 0.23, length: 0.5 * sc, radius: 0.036 },
            { x: -0.23, length: 0.5 * sc, radius: 0.036 },
          ],
        },
        rng,
      )
    : null;
  if (br) braidClasps(ctx, br.braidPaths, C.bronze);
  // ── armour ──
  if (ctx.helmet) {
    dwarfHelm(ctx);
    helmFittings(ctx);
  }
  bootFittings(ctx);
  if (ctx.armor >= 0.5) pauldrons(ctx);
  vambraces(ctx);
  // gear placed on the finished sculpt
  const proj = makeProjector(s, { min: [-0.45, 0.4, -0.35], max: [0.45, 1.3, 0.4] });
  if (proj) {
    const hp = V(), hn = V();
    // bronze square bosses where the straps cross: front and back
    for (const face of ['f', 'b'] as const) {
      if (snapPoint(proj, [0, CROSS_Y, 0], face, hp, hn)) {
        const m = frameAt(hp.addScaledVector(hn, 0.002 * sc), hn);
        put(ctx, new THREE.BoxGeometry(0.052 * sc, 0.052 * sc, 0.006 * sc), { bone: 'chest', color: C.bronze, mat: BRONZE_D, matrix: m.clone().multiply(new THREE.Matrix4().makeRotationZ(Math.PI / 4)), small: true });
        put(ctx, new THREE.BoxGeometry(0.03 * sc, 0.03 * sc, 0.006 * sc).translate(0, 0, 0.005 * sc), { bone: 'chest', color: C.steelDark, mat: IRON, matrix: m.clone().multiply(new THREE.Matrix4().makeRotationZ(Math.PI / 4)), small: true });
        put(ctx, new THREE.SphereGeometry(0.009 * sc, 6, 4, 0, Math.PI * 2, 0, Math.PI / 2).rotateX(Math.PI / 2).translate(0, 0, 0.009 * sc), { bone: 'chest', color: C.brass, mat: BRONZE_D, matrix: m, small: true });
      }
    }
  }
  beltGear(ctx, proj);
  void STEEL;
  void arcPlate;
  void WOOL;
  void MAIL;
}

export const gimliDef: KindDef = {
  label: 'Gimli',
  height: HEIGHT,
  build: { shoulders: 1.36, hips: 1.4, bulk: 1.3, belly: 0.3, chest: 1.4, armLength: 0.95, legLength: 0.8, headSize: 1.3, neck: 0.4, neckThick: 1.4, handSize: 1.32, footSize: 1.2, muscle: 0.55 },
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
    // short, thick boots with a folded cuff (top ~0.30 m in the sheet)
    { type: 'boots', color: GIMLI.boots, color2: GIMLI.bootsTrim, length: 0.87, thickness: 0.014, mat: LEATHER_PLAIN },
    // the hauberk itself is sculpted in extras; this is the swinging mail skirt with a leather tabard front and back
    {
      type: 'skirt',
      // the cloth skirt renders brighter than the sculpted torso, so its albedos sit lower
      color: mix(GIMLI.mail, 0x000000, 0.35),
      color2: GIMLI.jerkin,
      mat: SKIRT_MAIL,
      length: 0.58,
      thickness: 0.012,
      strips: { count: 2, color: 0x140a04, color2: 0x24140a, mat: LEATHER_PLAIN, width: 0.17, length: 1.0 },
    },
    { type: 'belt', color: GIMLI.belt, offset: BELT_RAISE, thickness: 0.006, mat: LEATHER_PLAIN },
    { type: 'bracers', color: GIMLI.bracers, color2: GIMLI.belt, length: 0.82, thickness: 0.012, mat: LEATHER },
  ],
  armor: [],
  weapons: { right: 'dwarf_axe', style: 'dwarf' },
  palette: GIMLI,
  anim: { swagger: 0.5, aggression: 0.55, stance: 1.2, cadence: 1.05, armSwing: 1.0 },
  variation: { height: 0, bulk: 0, skin: 0 },
  // named character: a fine face region within the 45k budget
  detail: { res: devNum('res', 0.03), headRes: devNum('headRes', 0.0095), faceRes: devNum('faceRes', 0.0056), refine: 1, hands: false, detailScale: devNum('ds', 0.55) },
  sfx: { voice: 'dwarf', weight: 0.7 },
  extras: gimliExtras,
};
