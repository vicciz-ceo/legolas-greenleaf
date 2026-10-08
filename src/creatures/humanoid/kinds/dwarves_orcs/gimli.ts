/**
 * Gimli, son of Gloin (Fellowship / Two Towers look): 1.37 m, enormously broad, wild auburn hair
 * and a long braided beard with metal clasps, mail over leather, a pointed iron helm, a
 * dwarf axe. Gruff and proud.
 */
import * as THREE from 'three';
import { Rng } from '../../../../core/rng';
import type { V3 } from '../../../kit/sdf';
import { createWeapon } from '../../../weapons';
import type { KindContext, KindDef } from '../../types';
import { lathe, mat4, mergeAll, put, shell, spike, studs, tube, arcPlate } from './armor';
import { devNum, mix, shade } from './common';
import { addBeard, addHairdo, sculptBeardMass } from './hair';
import { sculptHairCap } from '../../hairstyles';

export const GIMLI = {
  hair: 0x7b3f1f,
  hairTip: 0x9a5a2c,
  hairLight: 0xa86a33,
  beard: 0x8e4a24,
  beardTip: 0xb06a30,
  skin: 0xd59a7c,
  skin2: 0xbf6c58,
  lips: 0xa85c52,
  eyes: 0x3a2a1c,
  trousers: 0x4a3a2c,
  boots: 0x33241a,
  bootsTrim: 0x4a3626,
  mail: 0x85847e,
  jerkin: 0x3e2a1e,
  jerkinTrim: 0x5a3c28,
  belt: 0x2c1e14,
  bracers: 0x4a3222,
  steel: 0x6f7073,
  steelDark: 0x4a4b4e,
  bronze: 0x9b7432,
  brass: 0xb08a40,
};

/** Gimli's pointed iron helm: flared rim band, central ridge, rivets, hinged cheek plates */
function dwarfHelm(ctx: KindContext) {
  const { P } = ctx;
  const u = P.headH;
  const C = GIMLI;
  const tilt = new THREE.Matrix4().makeRotationX(-0.1);
  const centre = P.h(0, 0.04, -0.06);
  const place = new THREE.Matrix4().makeTranslation(centre[0], centre[1], centre[2]).multiply(tilt).multiply(new THREE.Matrix4().makeScale(1, 1, 1.28));
  // dome profile (radius, y) in head units around the helm axis
  const prof: [number, number][] = [
    [0.4, -0.04], [0.405, 0.03], [0.392, 0.12], [0.36, 0.22], [0.305, 0.32], [0.235, 0.41], [0.155, 0.48], [0.085, 0.53], [0.04, 0.565], [0.016, 0.59], [0.0, 0.605],
  ].map(([r, y]) => [r * u, y * u]);
  const dome = lathe(prof, 28);
  put(ctx, dome, { bone: 'head', color: C.steel, mat: 'metal_dark', matrix: place, ao: 0.95 });
  // flared bronze rim band
  const band = lathe([[0.42 * u, -0.07 * u], [0.44 * u, -0.05 * u], [0.445 * u, 0.0], [0.425 * u, 0.055 * u], [0.405 * u, 0.06 * u], [0.4 * u, 0.0], [0.4 * u, -0.05 * u]], 28);
  put(ctx, band, { bone: 'head', color: C.bronze, mat: 'gold', matrix: place });
  // central ridge over the dome front → back, following the profile
  const ridgePts: V3[] = [];
  const up = prof.filter((_, i) => i >= 1);
  for (let i = 0; i < up.length; i++) ridgePts.push([0, up[i][1] + 0.006 * u, up[i][0] + 0.01 * u]);
  for (let i = up.length - 1; i >= 0; i--) ridgePts.push([0, up[i][1] + 0.006 * u, -(up[i][0] + 0.01 * u)]);
  put(ctx, tube(ridgePts, 0.016 * u, { seg: 40, radial: 5 }), { bone: 'head', color: C.bronze, mat: 'gold', matrix: place });
  // rivets along the rim band
  const rv: V3[] = [];
  for (let i = 0; i < 26; i++) {
    const a = (i / 26) * Math.PI * 2;
    rv.push([Math.sin(a) * 0.428 * u, 0.0, Math.cos(a) * 0.428 * u]);
  }
  const rg = studs(rv, 0.012 * u, 0.8);
  if (rg) put(ctx, rg, { bone: 'head', color: C.brass, mat: 'gold', matrix: place, small: true });
  // finial ball
  put(ctx, new THREE.SphereGeometry(0.03 * u, 8, 6).translate(0, 0.605 * u, 0), { bone: 'head', color: C.bronze, mat: 'gold', matrix: place, small: true });
  // hinged cheek plates
  for (const sx of [1, -1]) {
    const plate = arcPlate(0.375 * u, 0.26 * u, 1.0, sx > 0 ? 0 : Math.PI, 10);
    plate.translate(...P.h(0, -0.15, -0.03));
    put(ctx, plate, { bone: 'head', color: C.steelDark, mat: 'metal_dark', small: true });
    const tr = arcPlate(0.381 * u, 0.02 * u, 1.0, sx > 0 ? 0 : Math.PI, 10).translate(...P.h(0, -0.285, -0.03));
    put(ctx, tr, { bone: 'head', color: C.bronze, mat: 'gold', small: true });
  }
}

function pauldrons(ctx: KindContext) {
  const { P } = ctx;
  const s = P.s;
  const g = Math.sqrt(P.build.bulk);
  const C = GIMLI;
  for (const side of ['l', 'r'] as const) {
    const sx = side === 'l' ? 1 : -1;
    const sh = P.j[`upperarm_${side}`];
    for (let k = 0; k < 3; k++) {
      const R = (0.098 - k * 0.006) * s * 1.2 * g;
      const geo = shell(R, R * 0.75, R * 1.05, { th0: 0, th1: Math.PI * (0.4 - k * 0.03), w: 14, h: 6 });
      const m = new THREE.Matrix4()
        .makeTranslation(sh[0] + sx * 0.02 * s, sh[1] + (0.035 - k * 0.032) * s, sh[2])
        .multiply(new THREE.Matrix4().makeRotationZ(-sx * (0.62 + k * 0.1)));
      put(ctx, geo, { bone: `upperarm_${side}`, color: k === 2 ? C.steelDark : C.steel, mat: 'metal_dark', matrix: m });
      // bronze edge ring on each lamella
      const ring = new THREE.TorusGeometry(R * 0.985, 0.0045 * s * 1.3, 4, 20).rotateX(Math.PI / 2).scale(1, 1, 1.02);
      const th = Math.PI * (0.43 - k * 0.04);
      ring.scale(Math.sin(th), 1, Math.sin(th)).translate(0, Math.cos(th) * R * 0.62, 0);
      put(ctx, ring, { bone: `upperarm_${side}`, color: C.bronze, mat: 'gold', matrix: m, small: true });
    }
    // a short spike on top
    put(ctx, spike([sh[0] + sx * 0.05 * s, sh[1] + 0.085 * s, sh[2]], [sx * 0.35, 1, 0], 0.07 * s, 0.014 * s, 6), { bone: `upperarm_${side}`, color: C.steel, mat: 'metal', small: true });
  }
}

/** big buckle, pouch and two throwing axes on the belt */
function beltGear(ctx: KindContext) {
  const { P } = ctx;
  const s = P.s;
  const C = GIMLI;
  const hipY = P.j.thigh_l[1];
  const by = hipY + 0.07 * s;
  const bz = 0.104 * s * P.build.bulk * (1 + P.build.belly * 0.4) + 0.034 * s;
  // belt plate (square, bronze) with a boss
  put(ctx, new THREE.BoxGeometry(0.075 * s, 0.062 * s, 0.01 * s).translate(0, by, bz), { bone: 'hips', color: C.bronze, mat: 'gold', small: true });
  put(ctx, new THREE.SphereGeometry(0.02 * s, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2).rotateX(Math.PI / 2).translate(0, by, bz + 0.006 * s), { bone: 'hips', color: C.brass, mat: 'gold', small: true });
  // studs around the belt
  const pts: V3[] = [];
  const rx = 0.145 * s * Math.sqrt(P.build.bulk) * (0.9 + 0.1 * P.build.hips);
  const rz = 0.105 * s * P.build.bulk * (1 + P.build.belly * 0.4) + 0.022 * s;
  for (let i = 0; i < 18; i++) {
    const a = -Math.PI * 0.75 + (i / 17) * Math.PI * 1.5;
    if (Math.abs(a) < 0.18) continue;
    pts.push([Math.sin(a) * rx * 1.06, by, Math.cos(a) * rz * 1.06]);
  }
  const sg = studs(pts, 0.0065 * s, 0.7);
  if (sg) put(ctx, sg, { bone: 'hips', color: C.brass, mat: 'gold', small: true });
  // two throwing axes hung crosswise at the back of the belt
  for (const sx of [1, -1]) {
    ctx.object(
      () => {
        const ax = createWeapon('axe', 5 + (sx > 0 ? 0 : 1));
        ax.scale.setScalar(0.55 * s);
        const hold = new THREE.Group();
        hold.add(ax);
        hold.position.set(sx * 0.13 * s, by + 0.02 * s, -0.115 * s * P.build.bulk);
        hold.rotation.set(0.2, 0, -sx * (Math.PI / 2 + 0.65));
        return hold;
      },
      { bone: 'hips', small: true },
    );
  }
}

export function gimliExtras(ctx: KindContext) {
  const { P, sculpt: s } = ctx;
  const C = GIMLI;
  const rng = new Rng(0x61a11);
  const sc = P.s;
  const u = P.headH;
  // ── scalp cap (under the helm / hair), eyebrows and a heavier brow ──
  const hair = { style: 'long_wavy' as const, color: C.hair, tipColor: C.hairTip, length: 1.0, density: 1.25, bounce: 0.5 };
  sculptHairCap(s, P, hair);
  // bushy brows
  s.mirrored((side) => {
    s.cone(P.h(0.2, 0.09, 0.355), P.h(0.04, 0.095, 0.4), 0.021 * u, 0.017 * u, { op: 'paint', color: C.hair, mat: 'hair', bone: 'head', k: 0.012 * u, strength: 0.95 });
    void side;
  });
  if (!devNum('nohair', 0)) addHairdo(ctx, { color: C.hair, tip: C.hairTip, deep: mix(C.hair, 0x000000, 0.3), length: 0.55 * sc, count: 150, width: 0.042, wave: 0.8, wild: 0.35, comb: 0.9, front: 0.2, back: -0.4, gravity: 5 }, new Rng(0x517));
  // ── beard: long, forked into a mass with two braids and a moustache ──
  if (!devNum('nobeard', 0)) sculptBeardMass(ctx, { color: mix(C.beard, 0x000000, 0.25), color2: C.hair, length: 0.4 * sc, width: 1.06, fullness: 1.15 });
  if (!devNum('nobeard', 0)) addBeard(
    ctx,
    {
      color: C.beard,
      tip: C.beardTip,
      deep: mix(C.beard, 0x000000, 0.35),
      length: 0.4 * sc,
      locks: 15,
      perLock: 8,
      spread: 1.05,
      cheeks: true,
      wave: 0.7,
      width: 0.045,
      moustache: { length: 0.1 * sc, droop: 0.5, curl: 0.5 },
      braids: [
        { x: 0.05, length: 0.46 * sc, radius: 0.017 },
        { x: -0.05, length: 0.46 * sc, radius: 0.017 },
      ],
    },
    rng,
  );
  // ── armour ──
  if (ctx.helmet) dwarfHelm(ctx);
  if (ctx.armor >= 0.5) pauldrons(ctx);
  beltGear(ctx);
  void mix;
  void shade;
  void mat4;
  void mergeAll;
}

export const gimliDef: KindDef = {
  label: 'Gimli',
  height: 1.37,
  build: { shoulders: 1.34, hips: 1.24, bulk: 1.4, belly: 0.4, chest: 1.3, armLength: 0.94, legLength: 0.8, headSize: 1.3, neck: 0.4, neckThick: 1.4, handSize: 1.32, footSize: 1.15, muscle: 0.55 },
  face: {
    jaw: 1.2, jawLength: 0.95, chin: 0.9, brow: 1.5, cheekbones: 1.15,
    nose: { length: 1.2, width: 1.5, bridge: 1.1, hook: 0.25, tip: 1.4 },
    lips: { width: 1.0, fullness: 0.85 }, ears: 'round', earSize: 1.0, eyeSize: 0.92, eyeOpen: 0.78, eyeSpacing: 1.0, foreheadSlope: 0.12,
  },
  skin: { color: GIMLI.skin, color2: GIMLI.skin2, blotch: 0.45, blemish: 0.2, scars: 1, wrinkles: 0.55, lips: GIMLI.lips, brows: GIMLI.hair, surface: 'skin_weathered', scatter: 0xd0503a },
  eyes: { color: GIMLI.eyes, sclera: 0xe2d6c8 },
  // chain bones only: the visible hair and beard are grown in extras (see hair.ts)
  hair: { style: 'stringy', color: GIMLI.hair, density: 0 },
  beard: { style: 'stubble', color: GIMLI.beard, length: 0.08 },
  outfit: [
    { type: 'trousers', color: GIMLI.trousers },
    { type: 'boots', color: GIMLI.boots, color2: GIMLI.bootsTrim, length: 0.95 },
    { type: 'mail_shirt', color: GIMLI.mail, length: 0.6 },
    { type: 'jerkin', color: GIMLI.jerkin, color2: GIMLI.jerkinTrim, mat: 'leather_worn', length: 0.4 },
    { type: 'belt', color: GIMLI.belt },
    { type: 'bracers', color: GIMLI.bracers, color2: GIMLI.belt },
  ],
  armor: [],
  weapons: { right: 'dwarf_axe', style: 'dwarf' },
  palette: GIMLI,
  anim: { swagger: 0.5, aggression: 0.55, stance: 1.2, cadence: 1.05, armSwing: 1.0 },
  variation: { height: 0, bulk: 0, skin: 0 },
  detail: { res: devNum('res', 0.0215), headRes: devNum('headRes', 0.0085), faceRes: devNum('faceRes', 0.0055), detailScale: 1.3 },
  sfx: { voice: 'dwarf', weight: 0.7 },
  extras: gimliExtras,
};
