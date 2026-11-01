/**
 * Thranduil, the Elvenking (~1.9 m): long platinum hair, a cold severe face, a crown of dark twigs
 * hung with autumn leaves and berries, a silver brocade under-robe, a floor-length wine-red velvet
 * coat (open front, A-line skirt with a short train, embroidered with silver vines, a high flared
 * stand collar, embroidered yokes and cuffs) and a small silver filigree belt. The sheet prescribes
 * no weapon. Refined against docs/refs/thranduil.
 */
import * as THREE from 'three';
import { Rng, hashSeed } from '../../../../core/rng';
import { surface } from '../../../kit/surfaces';
import type { V3 } from '../../../kit/sdf';
import type { SurfaceSpec } from '../../../kit/surfaces';
import type { KindContext, KindDef } from '../../types';
import { anatomyParts, emitParts } from '../../anatomy';
import { devNum, devSkip, attachSkinned, withHair } from './common';
import { skirtGeometry } from '../../cloth';
import { along, instances, leaf, mergeAll, put, ring, studs, taperedTube, torsoSection, tube } from './geo';
import { POLISHED } from './armor';
import { addHair, noKitHair } from './hair';
import { limbCutAfter, limbCutBefore, sculptShoulderCap, sculptTorso } from './garments';

const PAL = {
  hair: 0xc9c2b6, // sheet: platinum-silver, root #bdbcb4 → tip #e1e0d8 (warm so it doesn't render blue-grey)
  hairTip: 0xeae6de,
  // sheet skin #e7c7b7 (observed lit #e8bcae), ivory rather than pink
  skin: 0xe3c6b0,
  skin2: 0xd3b09a,
  lips: 0x8f5a52,
  brows: 0x6e5f4c,
  eyes: 0x8b9a9d, // spec #5d8bb5, but the sheet's iris reads grey (#8a9aa6 in the skin tile)
  leggings: 0x34343a,
  boots: 0x5a4a3e, // worn brown leather #665447
  robe: 0x93928b, // cool silver brocade: design #c2beb4, observed #998a81
  robeTrim: 0x9b9a92,
  cloak: 0x5a1020,
  cloakTrim: 0x9d9a90, // silver-grey vine work (the gold of the earlier pass read as tan)
  belt: 0x6e5d3c,
  silver: 0xc4c4cc,
  gold: 0xc8a860,
  collar: 0x4a0c18, // velvet #6c192e deepened (the velvet sheen lifts it)
  embroidery: 0x6f6c63, // dull silver-grey thread
  leafRed: 0x8a4a22, // a few muted orange autumn leaves in the embroidery
  leafOlive: 0x5b5a3a, // olive leaves
  hemTrim: 0x56544f, // thin silver-grey hem border
  twig: 0x3a2a1e, // crown wood (observed #382219)
};

/** the geometry of the coat skirt surface, as skirtGeometry builds it plus the stretch applied below */
interface SkirtShape {
  top: number;
  bottom: number;
  widen: number;
  train: number;
  at(a: number, v: number): THREE.Vector3;
}

function skirtShape(ctx: KindContext, top: number, bottom: number, flare: number, widen: number, train: number, grow = 0): SkirtShape {
  const { P } = ctx;
  const s = P.s;
  const g = P.build.bulk;
  const hips = P.build.hips;
  const rx0 = 0.158 * s * hips * Math.sqrt(g) + 0.012 * s + grow;
  const rz0 = 0.112 * s * Math.sqrt(g) + 0.012 * s + grow;
  const legR = 0.08 * s * g;
  const rx1 = Math.max(rx0, P.hipX + legR + 0.03 * s + grow) + flare;
  const rz1 = Math.max(rz0, legR + 0.035 * s + grow) + flare * 0.8;
  const H = top - bottom;
  return {
    top,
    bottom,
    widen,
    train,
    at(a, v) {
      const rx = (rx0 + (rx1 - rx0) * Math.sqrt(v)) * (1 + widen * Math.pow(v, 1.05));
      const rz = rz0 + (rz1 - rz0) * Math.sqrt(v);
      const z = Math.cos(a) * rz - 0.01 * s;
      const back = Math.min(1, Math.max(0, -z / 0.2));
      const y = Math.max(0.012, top - H * v - train * back * Math.pow(v, 3));
      return new THREE.Vector3(Math.sin(a) * rx, y, z);
    },
  };
}

/** hem panels like the shared addSkirt, widened into the coat's wide A-line (sheet: hem ~1.1 m across)
 *  with a short train: the kit's ring skirt is stretched sideways towards the hem */
function wideSkirt(ctx: KindContext, shape: SkirtShape, o: { color: number; color2?: number; mat: SurfaceSpec; panels: [number, number][]; flare: number; grow?: number }) {
  const { P, rig, spec } = ctx;
  if (devSkip('skirt')) return;
  const { top, bottom } = shape;
  const geo = skirtGeometry(P, rig, { top, bottom, color: o.color, color2: o.color2, mat: o.mat, panels: o.panels, flare: o.flare, grow: o.grow, seed: spec.seed ?? 0 });
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const t = Math.min(1, Math.max(0, (top - pos.getY(i)) / (top - bottom)));
    pos.setX(i, pos.getX(i) * (1 + shape.widen * Math.pow(t, 1.05)));
    const z = pos.getZ(i);
    const back = Math.min(1, Math.max(0, -z / 0.2));
    pos.setY(i, Math.max(0.012, pos.getY(i) - shape.train * back * Math.pow(t, 3)));
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  attachSkinned(ctx, geo, 'body', { small: false, name: 'skirt' });
}

/** dull silver-grey vine embroidery on the coat skirt: a stem with alternating flat leaves along paths on
 *  the skirt surface. Skinned to the skirt spring bones (front vines to skirt_f, the back vine to skirt_b),
 *  so it moves with the cloth. */
function embroideredVines(ctx: KindContext, shape: SkirtShape) {
  const { P } = ctx;
  const sc = P.s;
  const thread = surface('cloth', { sheen: 0.1, rough: 0.85, pat: { weave: 0.5 } });
  const leafGeo = leaf(0.045 * sc, 0.016 * sc, { droop: 0.1, cup: 0.3, rows: 2, rib: 0.3 });
  const lift = 0.0035 * sc;
  const groups: Record<string, { stems: THREE.BufferGeometry[]; olive: THREE.Matrix4[]; red: THREE.Matrix4[] }> = {
    skirt_f: { stems: [], olive: [], red: [] },
    skirt_b: { stems: [], olive: [], red: [] },
  };
  const vine = (bone: 'skirt_f' | 'skirt_b', a0: number, a1: number, v0: number, v1: number, step: number, size: number, phase = 0) => {
    const grp = groups[bone];
    const n = 16;
    const pts: V3[] = [];
    const P3: THREE.Vector3[] = [];
    for (let i = 0; i <= n; i++) {
      const f = i / n;
      // a gentle S-curve so the stem reads as a vine
      const a = a0 + (a1 - a0) * f + Math.sin(f * 9 + phase) * 0.012;
      const p = shape.at(a, v0 + (v1 - v0) * f);
      const nrm = new THREE.Vector3(p.x, 0, p.z).normalize();
      p.addScaledVector(nrm, lift);
      P3.push(p);
      pts.push([p.x, p.y, p.z]);
    }
    grp.stems.push(tube(pts, 0.0016 * sc, { seg: n, radial: 3 }));
    let acc = 0;
    let side = 1;
    for (let i = 1; i <= n; i++) {
      acc += P3[i].distanceTo(P3[i - 1]);
      if (acc < step) continue;
      acc = 0;
      const tan = P3[Math.min(n, i + 1)].clone().sub(P3[Math.max(0, i - 1)]).normalize();
      if (tan.y < 0) tan.negate(); // vines grow upward
      const nrm = new THREE.Vector3(P3[i].x, 0, P3[i].z).normalize();
      const sd = new THREE.Vector3().crossVectors(tan, nrm).normalize();
      side = -side;
      const dir = tan.clone().multiplyScalar(0.75).addScaledVector(sd, 0.65 * side);
      const m = along([P3[i].x, P3[i].y, P3[i].z], [dir.x, dir.y, dir.z], [nrm.x, nrm.y, nrm.z], size);
      (i % 4 === 0 ? grp.red : grp.olive).push(m);
    }
  };
  // two vines along the front edges (they stop short of the opening edge), one continuous vine up the back
  for (const sg of [1, -1]) vine('skirt_f', sg * 0.52, sg * 0.5, 0.05, 0.88, 0.042 * sc, 1);
  vine('skirt_b', Math.PI, Math.PI, 0.04, 0.9, 0.038 * sc, 1.2, 1);
  for (const bone of ['skirt_f', 'skirt_b'] as const) {
    const g = groups[bone];
    put(ctx, mergeAll(g.stems), { bone, color: PAL.embroidery, mat: thread, small: true });
    put(ctx, instances(leafGeo, g.olive), { bone, color: PAL.leafOlive, mat: thread, small: true });
    put(ctx, instances(leafGeo, g.red), { bone, color: PAL.leafRed, mat: thread, small: true });
  }
}

/** the Elvenking's crown: a low woven twig ring with forked branches tilted outward (tall clusters at the
 *  temples, short sprigs front and back), deep autumn leaves and a few red berries */
function elvenCrown(ctx: KindContext, rng: Rng) {
  const { P } = ctx;
  const u = P.headH;
  const bandR = 0.35;
  const wood = PAL.twig;
  const woodMat = surface('wood', { rough: 0.7, pat: { wrinkles: 1.3 } });
  const leafMat = surface('cloth', { rough: 0.7, sheen: 0.2, pat: { weave: 0 } });
  const woven: THREE.BufferGeometry[] = [];
  for (let k = 0; k < 3; k++) {
    const pts: V3[] = [];
    for (let i = 0; i <= 32; i++) {
      const a = (i / 32) * Math.PI * 2;
      const wob = Math.sin(a * 7 + k * 2.1) * 0.012 + (k - 1) * 0.012;
      const y = 0.185 - 0.05 * Math.max(0, -Math.cos(a)) + wob;
      pts.push(P.h(Math.sin(a) * (bandR + 0.01 * Math.cos(a * 7 + k)), y, -0.055 + Math.cos(a) * 0.455));
    }
    woven.push(tube(pts, 0.0085 * u, { seg: 60, radial: 4, closed: true }));
  }
  put(ctx, mergeAll(woven), { bone: 'head', color: wood, mat: woodMat, small: true });
  const twigs: THREE.BufferGeometry[] = [];
  const twigs2: THREE.BufferGeometry[] = [];
  const leaves: THREE.Matrix4[] = [];
  const berries: V3[] = [];
  const leafGeo = leaf(0.1 * u, 0.04 * u, { droop: 0.3, cup: 0.4, rows: 2, rib: 0.3 });
  const addLeaf = (p: V3, dir: V3) => leaves.push(along(p, dir, [rng.range(-1, 1), 0.3, rng.range(-1, 1)], rng.range(0.8, 1.3)));
  // azimuth a from the front: clusters at the temples, a few short sprigs front and back
  const specs: { a: number; h: number }[] = [];
  for (const sd of [1, -1]) for (let k = 0; k < 6; k++) specs.push({ a: sd * (0.95 + k * 0.17 + rng.range(-0.04, 0.04)), h: (0.82 - Math.abs(k - 2.4) * 0.06) * (0.9 + 0.2 * rng.float()) });
  for (const a of [Math.PI - 0.3, Math.PI + 0.35]) specs.push({ a, h: 0.2 });
  // a front-centre fork and upright twigs between it and the temple clusters
  specs.push({ a: 0, h: 0.5 }, { a: 0.4, h: 0.55 }, { a: -0.4, h: 0.55 }, { a: 0.68, h: 0.6 }, { a: -0.68, h: 0.6 });
  for (const sp of specs) {
    const sx = Math.sin(sp.a);
    const cz = Math.cos(sp.a);
    const root: V3 = P.h(sx * bandR, 0.19, -0.055 + cz * 0.455);
    // tilt 20-35 degrees outward (radially) from the ring
    const lean = Math.tan(0.18 + 0.22 * rng.float()) * sp.h;
    const ox = sx * lean * u;
    const oz = (cz > 0 ? 0.55 : 1) * (cz * lean * u) - 0.02 * u;
    const mid: V3 = [root[0] + ox * 0.5, root[1] + sp.h * u * 0.5, root[2] + oz * 0.5];
    const tip: V3 = [root[0] + ox, root[1] + sp.h * u, root[2] + oz];
    twigs.push(taperedTube([root, mid, tip], 0.0115 * u, 0.0035 * u, { seg: 10, radial: 4 }));
    const forks = sp.h > 0.3 ? 4 : 1;
    for (let f = 0; f < forks; f++) {
      const t = 0.2 + f * 0.19;
      const base: V3 = [root[0] + (tip[0] - root[0]) * t, root[1] + (tip[1] - root[1]) * t, root[2] + (tip[2] - root[2]) * t];
      const side = f % 2 ? -1 : 1;
      const end: V3 = [base[0] + (side * 0.15 + sx * 0.1) * u, base[1] + 0.14 * u, base[2] - 0.04 * u];
      twigs2.push(taperedTube([base, [(base[0] + end[0]) / 2 + side * 0.02 * u, (base[1] + end[1]) / 2, (base[2] + end[2]) / 2], end], 0.0058 * u, 0.0024 * u, { seg: 6, radial: 3 }));
      addLeaf(end, [end[0] - base[0], end[1] - base[1], end[2] - base[2]]);
      if (f % 2 === 0) addLeaf([(base[0] + end[0]) / 2, (base[1] + end[1]) / 2, (base[2] + end[2]) / 2], [side * 0.8, 0.5, 0.3]);
      if (berries.length < 14 && rng.float() < 0.45) berries.push([end[0] + 0.004 * u, end[1] - 0.012 * u, end[2]]);
    }
    addLeaf(tip, [tip[0] - mid[0], tip[1] - mid[1], tip[2] - mid[2]]);
    addLeaf(mid, [sx * 0.7, 0.5, 0.2]);
  }
  put(ctx, mergeAll(twigs), { bone: 'head', color: wood, mat: woodMat, small: true });
  put(ctx, mergeAll(twigs2), { bone: 'head', color: 0x5a4632, mat: woodMat, small: true });
  [0x9a3a18, 0xb04a1c, 0x7e2412, 0xa8561f].forEach((c, ci, all) => {
    const sub = leaves.filter((_, i) => i % all.length === ci);
    if (sub.length) put(ctx, instances(leafGeo, sub), { bone: 'head', color: c, mat: leafMat, small: true });
  });
  if (berries.length) put(ctx, studs(berries, 0.0085 * u, 1), { bone: 'head', color: 0xa31f1f, mat: surface('lips', { rough: 0.3 }), small: true });
}

function thranduilExtras(ctx: KindContext) {
  const { P, sculpt: s } = ctx;
  const sc = P.s;
  const j = P.j;
  const ny = j.neck[1];
  const hipY = j.thigh_l[1];
  const g = Math.sqrt(P.build.bulk);
  const L = P.hand.l.L;
  const parts = anatomyParts(P);
  // velvet: a soft, albedo-tinted sheen over a fine nap
  const wine = surface('cloth', { sheen: 0.7, rough: 0.78, pat: { weave: 0.35 } });
  const brocade = surface('linen', { sheen: 0.75, rough: 0.5, pat: { weave: 1.2 } });

  withHair(ctx, () => {
    // long hair that hangs over the coat
    addHair(ctx, { hair: { style: 'long_straight', color: PAL.hair, tipColor: PAL.hairTip, length: 1.14, density: devNum('density', 0.46), braids: 'none' }, rng: new Rng(hashSeed('thranduil', 'hair')), backClear: 1.45 });
  });

  // ── the crown ──
  elvenCrown(ctx, new Rng(hashSeed('thranduil', 'crown')));

  // The torso garments run well below the skirts' tops (the skirts start 4 cm under the hip joint), so
  // the join is hidden inside the torso hem; both hems are the collar colour.
  const skirtTop = hipY - 0.04 * sc;
  // ── silver brocade under-robe: a close tunic and one continuous panel from the belt to the hem ──
  sculptTorso(ctx, { color: PAL.robe, mat: brocade, inflate: 0.003 * sc, hem: 0.45, sleeve: 0, neck: true, seams: false, color2: PAL.robe, colorNoise: 0 });
  const robeShape = skirtShape(ctx, skirtTop, P.ankleH + 0.07 * sc, 0.02 * sc, 0.35, 0, 0);
  wideSkirt(ctx, robeShape, { color: PAL.robe, color2: PAL.robeTrim, mat: brocade, flare: 0.02 * sc, panels: [[-0.8, 0.8]], grow: 0 });

  // ── the wine-red coat: sleeves to the wrist, open down the front, floor-length skirts ──
  sculptTorso(ctx, { color: PAL.collar, mat: wine, inflate: 0.0095 * sc, hem: 0.45, sleeve: 2, neck: false, seams: false, thighs: true, frontOpen: { top: 0.07 * sc, bottom: 0.046 * sc, y1: ny + 0.0 * sc } });
  // silver vine along both edges of the opening on the torso
  {
    const yTop = ny - 0.02 * sc;
    const yBot = hipY - 0.1 * sc;
    // the opening is a cone from `top` at the neck (y1 = ny) to `bottom` at the hem - 6 cm
    const y1 = ny;
    const y0 = hipY - (hipY - j.shin_l[1]) * 0.45 - 0.03 * sc - 0.06 * sc;
    for (const sg of [1, -1]) {
      const pts: V3[] = [];
      for (let i = 0; i <= 10; i++) {
        const f = i / 10;
        const y = yTop + (yBot - yTop) * f;
        const w = (0.07 + (0.046 - 0.07) * ((y1 - y) / (y1 - y0))) * sc * 0.97;
        pts.push([sg * w, y, torsoSection(P, y).zf + 0.0112 * sc]);
      }
      put(ctx, tube(pts, 0.0028 * sc, { seg: 14, radial: 3 }), { bone: 'chest', color: PAL.cloakTrim, mat: brocade, small: true });
    }
  }
  // the coat's skirts: an A-line from the waist, one panel round the back (no centre slit), a short train
  const coatShape = skirtShape(ctx, skirtTop, P.ankleH + 0.04 * sc, 0.085 * sc, 0.62, 0.08 * sc, 0.004 * sc);
  wideSkirt(ctx, coatShape, { color: PAL.collar, color2: PAL.hemTrim, mat: wine, flare: 0.085 * sc, panels: [[0.34, Math.PI * 2 - 0.34]], grow: 0.004 * sc });
  embroideredVines(ctx, coatShape);

  // ── stiff high collar of the coat, flaring up behind the neck to about ear height ──
  s.group('union', 0.012 * sc, () => {
    s.ellipsoid([0, ny + 0.09 * sc, -0.05 * sc], [0.12 * sc * g, 0.14 * sc, 0.085 * sc], { color: PAL.collar, mat: wine, bone: 'chest', k: 0.02 * sc });
    s.mirrored(() => s.ellipsoid([0.085 * sc * g, ny + 0.075 * sc, -0.045 * sc], [0.028 * sc, 0.09 * sc, 0.05 * sc], { color: PAL.collar, mat: wine, bone: 'chest', k: 0.015 * sc }));
    s.ellipsoid([0, ny + 0.09 * sc, 0.0], [0.07 * sc * P.build.neckThick, 0.2 * sc, 0.088 * sc], { op: 'subtract', k: 0.014 * sc });
    s.ellipsoid([0, ny + 0.06 * sc, 0.11 * sc], [0.06 * sc, 0.13 * sc, 0.075 * sc], { op: 'subtract', k: 0.02 * sc });
    s.plane([0, 1, 0], ny + 0.21 * sc, { op: 'intersect', k: 0.01 * sc });
    s.plane([0, 1, 0], ny + 0.21 * sc, { op: 'paint', seam: 0, k: 0.002 });
  });
  {
    const pts: V3[] = [];
    for (let i = 0; i <= 22; i++) {
      const a = -Math.PI * 0.82 + (i / 22) * Math.PI * 1.64;
      pts.push([Math.sin(a) * 0.088 * sc * g * 1.2, ny + 0.205 * sc, -0.05 * sc + Math.cos(a) * 0.07 * sc * 1.1]);
    }
    put(ctx, tube(pts, 0.0026 * sc, { seg: 30, radial: 3 }), { bone: 'chest', color: PAL.cloakTrim, mat: brocade, small: true });
  }

  // ── shoulder yokes in the coat's wine velvet with silver-grey embroidery (no metal) ──
  sculptShoulderCap(ctx, { color: PAL.collar, mat: wine, side: 'both', inflate: 0.009 * sc, reach: 0.25 });

  // ── flared embroidered cuffs: a raised silver-grey band at each wrist, the sleeve end flaring ──
  for (const [t0, t1, inf, col] of [[0.8, 0.99, 0.0165, PAL.collar], [0.9, 0.97, 0.0185, PAL.embroidery]] as [number, number, number, number][]) {
    s.mirrored(() =>
      s.group('union', 0.0015 * sc, () => {
        emitParts(s, parts, ['forearm'], { color: col, mat: col === PAL.embroidery ? brocade : wine, inflate: inf * sc, k: 0.02 * sc, oneSide: true });
        const a0: V3 = [j.forearm_l[0] + L.x * P.foreArm * t0, j.forearm_l[1] + L.y * P.foreArm * t0, j.forearm_l[2]];
        const a1: V3 = [j.forearm_l[0] + L.x * P.foreArm * t1, j.forearm_l[1] + L.y * P.foreArm * t1, j.forearm_l[2]];
        limbCutAfter(s, L, a0, 0.003 * sc);
        limbCutBefore(s, L, a1, 0.003 * sc);
      }),
    );
  }

  // ── filigree belt: a small silver leaf plate at the waist (sheet: ~1.27 m, just under the ribs) ──
  const by = j.chest[1] - 0.045 * sc;
  const zf = torsoSection(P, by).zf + 0.012 * sc;
  put(ctx, new THREE.CircleGeometry(0.0105 * sc, 12), { bone: 'chest', color: PAL.gold, mat: 'gold', matrix: new THREE.Matrix4().makeTranslation(0, by, zf + 0.004 * sc), small: true });
  const plate = leaf(0.062 * sc, 0.016 * sc, { droop: 0, cup: 0.15, rows: 4, rib: 0.4 });
  const mats: THREE.Matrix4[] = [];
  for (const sg of [1, -1]) {
    mats.push(along([sg * 0.004 * sc, by, zf], [sg, 0, 0], [0, 0, 1], 1));
    mats.push(along([sg * 0.004 * sc, by + 0.003 * sc, zf + 0.001 * sc], [sg * 0.8, 0.5, 0], [0, 0, 1], 0.6));
    mats.push(along([sg * 0.004 * sc, by - 0.003 * sc, zf + 0.001 * sc], [sg * 0.8, -0.5, 0], [0, 0, 1], 0.6));
  }
  mats.push(along([0, by + 0.004 * sc, zf], [0, 1, 0], [0, 0, 1], 0.55), along([0, by - 0.004 * sc, zf], [0, -1, 0], [0, 0, 1], 0.55));
  put(ctx, instances(plate, mats), { bone: 'chest', color: PAL.silver, mat: POLISHED, small: true });
  put(ctx, ring([0, by, zf + 0.0045 * sc], [0, 0, 1], 0.0125 * sc, 0.002 * sc, 14, 3), { bone: 'chest', color: PAL.gold, mat: 'gold', small: true });

  // ── brooch holding the cloak at the throat ──
  put(ctx, new THREE.SphereGeometry(0.015 * sc, 8, 5).scale(1, 1, 0.5).translate(0, ny - 0.045 * sc, 0.084 * sc), { bone: 'chest', color: PAL.gold, mat: 'gold', small: true });
  put(ctx, new THREE.SphereGeometry(0.007 * sc, 6, 4).translate(0, ny - 0.045 * sc, 0.092 * sc), { bone: 'chest', color: 0xb02828, mat: surface('lips', { rough: 0.2 }), small: true });
}

export const thranduilDef: KindDef = {
  label: 'Thranduil',
  height: 1.9,
  build: { shoulders: 0.95, hips: 0.94, bulk: 0.78, chest: 0.95, armLength: 1.0, legLength: 1.03, headSize: 0.96, neck: 1.1, neckThick: 0.88, handSize: 0.98, footSize: 0.98, muscle: 0.02 },
  face: {
    jaw: 0.88,
    jawLength: 1.06,
    chin: 1.1,
    brow: 1.05,
    cheekbones: 1.25,
    nose: { length: 1.08, width: 0.8, bridge: 1.15, hook: 0.05, tip: 0.8 },
    lips: { width: 0.88, fullness: 0.7 },
    ears: 'pointed',
    earSize: 1.05,
    eyeSize: 1.0,
    eyeSpacing: 1.0,
    eyeTilt: 0.16,
    eyeOpen: 0.82,
    foreheadSlope: 0.1,
  },
  skin: { color: PAL.skin, color2: PAL.skin2, blotch: 0.05, blemish: 0.0, wrinkles: 0, lips: PAL.lips, brows: PAL.brows, scatter: 0xc88a78, surface: 'skin' },
  eyes: { color: PAL.eyes, sclera: 0xf0ece4 },
  hair: noKitHair(PAL.skin),
  beard: null,
  outfit: [
    { type: 'leggings', color: PAL.robe, mat: surface('linen', { sheen: 0.75, rough: 0.5, pat: { weave: 1.2 } }) }, // under the coat: the brocade colour, so anything poking through the open front matches
    { type: 'boots', color: PAL.boots, color2: 0x1e1b19, length: 0.9 },
    // spring bones only: the skirt and cloak sheets are built in extras
    { type: 'skirt', color: PAL.robe, chance: 0 },
  ],
  armor: [],
  // the sheet prescribes no weapon (notes.md); he is lab-only
  weapons: { right: 'none', left: 'none' },
  palette: PAL,
  sfx: { voice: 'elf', hurt: 'hurt', die: 'player_death', footstep: 'footstep', weight: 0.4 },
  anim: { grace: 1, swagger: 0.12, aggression: 0.2, stance: 1.0, armSwing: 0.7, cadence: 0.95 },
  variation: { height: 0, bulk: 0, skin: 0 },
  // named character: a fine face region within the 45k budget
  detail: { detailScale: 1, res: devNum('res', 0.05), headRes: devNum('headRes', 0.0085), faceRes: devNum('faceRes', 0.0056), refine: 1, hands: false },
  extras: thranduilExtras,
};
