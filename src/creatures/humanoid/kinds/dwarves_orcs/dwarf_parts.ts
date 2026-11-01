/**
 * Pieces of the dwarves of Thorin's company (dwarf.ts): a sculpted leather vest with armholes and a
 * V opening, flared skirts (rigid bands on the hips), a felt hat with a floppy tip, knotwork
 * tattoos (decals that hug the finished sculpt), a square buckle, belt hatchets and quilting lines.
 * Everything here is copied or adapted from the shared dwarves_orcs helpers so this file can change
 * freely without touching the Gimli / orc / Easterling kinds.
 */
import * as THREE from 'three';
import type { V3 } from '../../../kit/sdf';
import type { SurfaceName, SurfaceSpec } from '../../../kit/surfaces';
import { anatomyParts, emitParts, type PartTag } from '../../anatomy';
import type { KindContext } from '../../types';
import {
  V,
  ellipticalBand,
  frameAt,
  ringRadii,
  snapPoint,
  Builder,
  smooth,
  ribbon,
  snapPath,
  type Projector,
  type SnapPoint,
} from '../uruks_bosses/common';
import { put, ring, taperedTube } from './armor';
import { slab } from './garments';
import { scalpPoint } from './markings';

type Mat = SurfaceName | SurfaceSpec;


const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a || 1e-9)));
  return t * t * (3 - 2 * t);
};

// ─────────────────────────────────────────────────────────────────────────────
// vest
// ─────────────────────────────────────────────────────────────────────────────

export interface VestOpts {
  color: number;
  color2?: number;
  mat: Mat;
  /** outward offset (m at P.s = 1, scaled inside) */
  inflate: number;
  /** hem height (m above the ground); null = wraps down to the belt */
  hemY: number;
  /** half width of the V opening at the top (m, scaled inside); 0 = closed */
  open?: number;
  /** y where the V ends (m above the ground) */
  openY?: number;
  /** neckline height above the neck joint (m, scaled inside) */
  neckUp?: number;
  /** arm hole plane lean: smaller = bigger armhole (default 0.42) */
  armLean?: number;
  /** also cover the pelvis / glutes down to the hem (a short jacket body) */
  skirtParts?: boolean;
  /** surface relief (pillowed quilting) */
  noise?: { amp: number; freq: number; type: 'cells' | 'dents' | 'ridged' | 'fbm'; octaves?: number };
}

/** a sleeveless vest: wraps the torso, open at the shoulder joints and (optionally) in a V at the front */
export function sculptVest(ctx: KindContext, o: VestOpts) {
  const { P, sculpt: s } = ctx;
  const sc = P.s;
  const j = P.j;
  const parts = anatomyParts(P);
  const tags: PartTag[] = ['waist', 'belly', 'ribs', 'chest', 'pecs', 'back', 'trap', 'neck', ...(o.skirtParts ? (['pelvis', 'glutes'] as PartTag[]) : [])];
  const opt = { color: o.color, color2: o.color2, colorNoise: o.color2 !== undefined ? 0.45 : 0, colorFreq: 30 / sc, mat: o.mat, inflate: o.inflate * sc, noise: o.noise ? { ...o.noise, amp: o.noise.amp * sc, freq: o.noise.freq / sc } : undefined };
  s.group('union', 0.0025 * sc, () => {
    emitParts(s, parts, tags, opt);
    slab(s, o.hemY, j.neck[1] + (o.neckUp ?? 0.012) * sc, 0.005 * sc);
    s.plane([0, -1, 0], -o.hemY, { op: 'paint', seam: 0, k: 0.002 });
    s.plane([0, 1, 0], j.neck[1] + (o.neckUp ?? 0.012) * sc, { op: 'paint', seam: 0, k: 0.002 });
    // arm holes: the plane leans outward downward so the vest opens only at the shoulder joint
    const an = new THREE.Vector3(1, o.armLean ?? 0.42, 0).normalize();
    const ap: V3 = [P.shoulderX * 0.9, j.upperarm_l[1] - 0.01 * sc, 0];
    const ad = an.x * ap[0] + an.y * ap[1];
    s.mirrored(() => {
      s.plane([an.x, an.y, 0], ad, { op: 'intersect', k: 0.008 * sc });
      s.plane([an.x, an.y, 0], ad, { op: 'paint', seam: 0, k: 0.002 });
    });
    // V opening at the front (the tunic or mail shows)
    if (o.open && o.open > 0) {
      const b = P.build;
      const zf = 0.1 * sc * b.chest * b.bulk + o.inflate * sc;
      const yTop = j.neck[1] + 0.02 * sc;
      const yBot = o.openY ?? j.chest[1] - 0.12 * sc;
      s.cone([0, yTop, zf + 0.02 * sc], [0, yBot, zf + 0.02 * sc], o.open * sc, 0.006 * sc, { op: 'subtract', k: 0.006 * sc });
    }
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// skirt (rigid band on the hips)
// ─────────────────────────────────────────────────────────────────────────────

export interface SkirtOpts {
  yTop: number;
  yBot: number;
  /** height where the body is measured for the top radii (default yTop) */
  yRef?: number;
  color: number;
  mat: Mat;
  /** thickness of the band (m, scaled inside) */
  thick?: number;
  /** extra radius at the hem over the top (m, scaled inside) */
  flare?: number;
  /** growth of the top over the measured body (m, scaled inside) */
  out?: number;
  /** half angle of a gap at the front / back (radians) */
  gapFront?: number;
  gapBack?: number;
  seg?: number;
  bone?: string;
  small?: boolean;
  colorFn?: (p: THREE.Vector3, n: THREE.Vector3, c: THREE.Color) => void;
}

/** a flared elliptical band hanging from yTop to yBot, sized from the body measured at yTop */
export function skirt(ctx: KindContext, proj: Projector, o: SkirtOpts) {
  const { P } = ctx;
  const sc = P.s;
  const g = Math.sqrt(P.build.bulk);
  const rt = ringRadii(proj, o.yRef ?? o.yTop);
  const out = (o.out ?? 0.012) * sc;
  const flare = (o.flare ?? 0.05) * sc;
  const rxTop = rt.rx + out;
  const rzTop = (rt.zf + rt.zb) / 2 + out;
  // the hem must clear the thighs
  const rxBot = Math.max(rxTop + flare, P.hipX + 0.095 * sc * g);
  const rzBot = rzTop + flare * 0.9;
  const h = o.yTop - o.yBot;
  let a0 = 0;
  let a1 = Math.PI * 2;
  if (o.gapFront) {
    a0 = o.gapFront;
    a1 = Math.PI * 2 - o.gapFront;
  } else if (o.gapBack) {
    a0 = -Math.PI + o.gapBack;
    a1 = Math.PI - o.gapBack;
  }
  const geo = ellipticalBand(rxTop, rzTop, rxBot, rzBot, h, (o.thick ?? 0.012) * sc, o.seg ?? 24, a0, a1, (rt.zf - rt.zb) / 2);
  geo.translate(0, (o.yTop + o.yBot) / 2, 0);
  put(ctx, geo, { bone: o.bone ?? 'hips', color: o.color, mat: o.mat, small: o.small, colorFn: o.colorFn });
}

// ─────────────────────────────────────────────────────────────────────────────
// buckles, hatchets, rings
// ─────────────────────────────────────────────────────────────────────────────

/** a square cast buckle (frame, tongue bar) on the belt front, snapped to the finished sculpt */
export function squareBuckle(ctx: KindContext, proj: Projector, beltY: number, color: number, o: { w?: number; h?: number; mat?: Mat; x?: number } = {}) {
  const sc = ctx.P.s;
  const p = V();
  const n = V();
  if (!snapPoint(proj, [o.x ?? 0, beltY, 0.3], 'f', p, n)) return;
  const m = frameAt(p.addScaledVector(n, 0.0015 * sc), n, V(0, 1, 0));
  const w = (o.w ?? 0.056) * sc;
  const h = (o.h ?? 0.046) * sc;
  const t = 0.0085 * sc;
  const d = 0.007 * sc;
  const list: THREE.BufferGeometry[] = [
    new THREE.BoxGeometry(w, t, d).translate(0, h / 2 - t / 2, 0),
    new THREE.BoxGeometry(w, t, d).translate(0, -h / 2 + t / 2, 0),
    new THREE.BoxGeometry(t, h, d).translate(-w / 2 + t / 2, 0, 0),
    new THREE.BoxGeometry(t, h, d).translate(w / 2 - t / 2, 0, 0),
    new THREE.BoxGeometry(t * 0.8, h * 0.9, d * 0.8).translate(-w * 0.1, 0, 0.002 * sc),
  ];
  const merged = mergeBoxes(list);
  put(ctx, merged, { bone: 'hips', color, mat: o.mat ?? 'metal_dark', matrix: m, small: true });
}

function mergeBoxes(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const pos: number[] = [];
  const nor: number[] = [];
  const idx: number[] = [];
  for (const g of list) {
    const base = pos.length / 3;
    const p = g.attributes.position;
    const n = g.attributes.normal;
    for (let i = 0; i < p.count; i++) {
      pos.push(p.getX(i), p.getY(i), p.getZ(i));
      nor.push(n.getX(i), n.getY(i), n.getZ(i));
    }
    const ix = g.index!;
    for (let i = 0; i < ix.count; i++) idx.push(base + ix.getX(i));
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  out.setIndex(idx);
  return out;
}

/** a small throwing axe hung at a hip: leather sheath on the belt and a flared steel head (sheet: bald dwarf) */
export function hipHatchet(ctx: KindContext, side: 1 | -1, beltY: number, o: { steel: number; leather: number; haft: number }) {
  const { P } = ctx;
  const sc = P.s;
  const g = Math.sqrt(P.build.bulk);
  const rx = 0.158 * sc * g * (0.9 + 0.1 * P.build.hips);
  // head: a thin crescent blade shape extruded a little
  const sh = new THREE.Shape();
  sh.moveTo(0, 0);
  sh.lineTo(0.03, 0.006);
  sh.quadraticCurveTo(0.075, 0.0, 0.082, -0.058);
  sh.quadraticCurveTo(0.04, -0.03, 0.0, -0.034);
  sh.lineTo(0, 0);
  const blade = new THREE.ExtrudeGeometry(sh, { depth: 0.006, bevelEnabled: false, curveSegments: 3 });
  blade.translate(0, 0, -0.003);
  blade.scale(0.62 * sc, 0.62 * sc, 0.62 * sc);
  // the head sits low at the hip, blade pointing outward and down; haft is the sheath strip going up
  const headM = new THREE.Matrix4().compose(new THREE.Vector3(side * (rx + 0.006 * sc), beltY - 0.045 * sc, 0.035 * sc), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -Math.PI / 2, side * 0.12)), new THREE.Vector3(1, 1, 1));
  put(ctx, blade, { bone: 'hips', color: o.steel, mat: 'metal_hammered', matrix: headM, small: true });
  const sheathLen = 0.1 * sc;
  const sheath = new THREE.BoxGeometry(0.02 * sc, sheathLen, 0.016 * sc).translate(side * (rx + 0.004 * sc), beltY - 0.02 * sc, 0.03 * sc);
  put(ctx, sheath, { bone: 'hips', color: o.leather, mat: 'leather_worn', small: true });
  const haft = new THREE.CylinderGeometry(0.0075 * sc, 0.0075 * sc, 0.085 * sc, 5).translate(side * (rx + 0.008 * sc), beltY + 0.045 * sc, 0.03 * sc);
  put(ctx, haft, { bone: 'hips', color: o.haft, mat: 'wood', small: true });
}

/**
 * surfaceDecal from uruks_bosses/common.ts with a coverage threshold: only cells that touch ink are
 * emitted (a decal over a whole patch costs ~1.2k triangles; the ink itself is ~35 % of the area).
 */
function inkDecal(o: { proj: Projector; frame: THREE.Matrix4; w: number; h: number; cell: number; mask: (x: number, y: number) => number; lift: number; paint: number; skin: number; minMask?: number }) {
  const nx = Math.ceil(o.w / o.cell);
  const ny = Math.ceil(o.h / o.cell);
  const W = nx + 1;
  const M: number[] = [];
  const P: THREE.Vector3[] = [];
  const Nn: THREE.Vector3[] = [];
  const tmp = V();
  for (let j = 0; j <= ny; j++)
    for (let i = 0; i <= nx; i++) {
      const x = -o.w / 2 + i * o.cell;
      const y = -o.h / 2 + j * o.cell;
      M.push(o.mask(x, y));
      P.push(tmp.set(x, y, 0).applyMatrix4(o.frame).clone());
      Nn.push(V());
    }
  const b = new Builder();
  const id: number[] = new Array(P.length).fill(-1);
  const key = (p: THREE.Vector3) => `${Math.round(p.x * 1e4)},${Math.round(p.y * 1e4)},${Math.round(p.z * 1e4)}`;
  const maskByPos = new Map<string, number>();
  const getV = (k: number): number => {
    if (id[k] >= 0) return id[k];
    const p = P[k];
    const n = Nn[k];
    if (!o.proj.project(p, n)) {
      id[k] = -2;
      return -2;
    }
    p.addScaledVector(n, o.lift);
    id[k] = b.vert(p, n);
    maskByPos.set(key(p), M[k]);
    return id[k];
  };
  const thr = o.minMask ?? 0.45;
  let any = false;
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) {
      const a = j * W + i;
      if (Math.max(M[a], M[a + 1], M[a + W], M[a + W + 1]) < thr) continue;
      const va = getV(a), vb = getV(a + 1), vc = getV(a + W + 1), vd = getV(a + W);
      if (va < 0 || vb < 0 || vc < 0 || vd < 0) continue;
      b.quad(va, vb, vc, vd, Nn[a].clone().add(Nn[a + 1]).add(Nn[a + W]).add(Nn[a + W + 1]));
      any = true;
    }
  if (!any) return null;
  const cPaint = new THREE.Color().setHex(o.paint, THREE.SRGBColorSpace);
  const cSkin = new THREE.Color().setHex(o.skin, THREE.SRGBColorSpace);
  const colorFn = (p: THREE.Vector3, _n: THREE.Vector3, c: THREE.Color) => {
    const m = maskByPos.get(key(p)) ?? 0;
    c.copy(cSkin).lerp(cPaint, smooth(0.25, 0.7, m));
  };
  return { geo: b.geometry(), colorFn };
}

// ─────────────────────────────────────────────────────────────────────────────
// knotwork tattoos
// ─────────────────────────────────────────────────────────────────────────────

type Seg = [number, number, number, number];

function segDist(x: number, y: number, s: Seg): number {
  const dx = s[2] - s[0];
  const dy = s[3] - s[1];
  const l2 = dx * dx + dy * dy || 1e-9;
  const t = Math.max(0, Math.min(1, ((x - s[0]) * dx + (y - s[1]) * dy) / l2));
  return Math.hypot(x - (s[0] + dx * t), y - (s[1] + dy * t));
}

/** polylines → a soft mask (1 on the line, 0 beyond `halfW + soft`) */
function lineMask(polys: [number, number][][], halfW: number, soft: number) {
  const segs: Seg[] = [];
  for (const p of polys) for (let i = 0; i + 1 < p.length; i++) segs.push([p[i][0], p[i][1], p[i + 1][0], p[i + 1][1]]);
  return (x: number, y: number): number => {
    let d = 1e9;
    for (const s of segs) {
      const dd = segDist(x, y, s);
      if (dd < d) d = dd;
    }
    return Math.max(0, Math.min(1, (halfW + soft - d) / (2 * soft)));
  };
}

/** a rectilinear labyrinth (key-fret): a double spiral with side stubs, filling w × h */
function mazePolys(w: number, h: number, step: number): [number, number][][] {
  const polys: [number, number][][] = [];
  const x0 = -w / 2;
  const x1 = w / 2;
  const y0 = -h / 2;
  const y1 = h / 2;
  // spiral from the outside in
  const sp: [number, number][] = [];
  let a = x0, b = y0, c = x1, d = y1;
  sp.push([a, b]);
  for (let i = 0; i < 9; i++) {
    sp.push([c, b]);
    sp.push([c, d]);
    sp.push([a, d]);
    a += step;
    sp.push([a, b + step]);
    b += step;
    c -= step;
    d -= step;
    if (a >= c - step * 0.5 || b >= d - step * 0.5) break;
    sp.push([a, b]);
  }
  polys.push(sp);
  // stubs pointing inward from the outer wall, breaking the regularity into a fret
  for (let i = 1; i < 6; i++) {
    const x = x0 + (w * i) / 6;
    polys.push([[x, y0], [x, y0 + step * 1.2]]);
    polys.push([[x + step * 0.5, y1], [x + step * 0.5, y1 - step * 1.2]]);
  }
  return polys;
}

/** an interlaced three-strand braid with a ringed boss at its foot (celtic arm band), w × h */
function knotPolys(w: number, h: number): [number, number][][] {
  const polys: [number, number][][] = [];
  const A = w * 0.3;
  const lam = h * 0.42;
  for (let k = 0; k < 3; k++) {
    const ph = (k * Math.PI * 2) / 3;
    const p: [number, number][] = [];
    for (let i = 0; i <= 28; i++) {
      const y = h * 0.5 - (i / 28) * h * 0.72;
      p.push([A * Math.sin((y / lam) * Math.PI * 2 + ph), y]);
    }
    polys.push(p);
  }
  // borders
  polys.push([[-w * 0.46, h * 0.5], [-w * 0.46, -h * 0.22]]);
  polys.push([[w * 0.46, h * 0.5], [w * 0.46, -h * 0.22]]);
  // concentric rings (the boss) at the foot
  const cy = -h * 0.36;
  for (const r of [0.07, 0.135, 0.2]) {
    const rr = r * w * 1.1;
    const p: [number, number][] = [];
    for (let i = 0; i <= 20; i++) {
      const t = (i / 20) * Math.PI * 2;
      p.push([Math.cos(t) * rr, cy + Math.sin(t) * rr]);
    }
    polys.push(p);
  }
  polys.push([[0, cy - w * 0.22], [0, cy + w * 0.22]]);
  polys.push([[-w * 0.22, cy], [w * 0.22, cy]]);
  return polys;
}

/** the knotwork of the bald dwarf: a labyrinth patch on each side of the crown and a braid band on each upper arm */
export function knotTattoos(ctx: KindContext, proj: Projector, o: { ink: number; skin: number; skinMat?: Mat; head?: boolean; arms?: boolean }) {
  const { P } = ctx;
  const k = P.s / 0.735; // the designs below are drawn for a 1.36 m dwarf
  const kh = P.headH / 0.218;
  const dec = (frame: THREE.Matrix4, w: number, h: number, mask: (x: number, y: number) => number, bone: string, lift: number, cell = 0.0072 * k) => {
    const r = inkDecal({ proj, frame, w, h, cell, mask, lift, paint: o.ink, skin: o.skin });
    if (!r) return;
    put(ctx, r.geo, { bone, color: o.skin, mat: o.skinMat ?? 'skin_weathered', colorFn: r.colorFn, small: true });
  };
  if (o.head !== false) {
    // two patches on the upper forehead / temples (sheet front: a patch each side of the centre line;
    // profile: it runs back over the temple)
    const w = 0.12 * kh;
    const h = 0.08 * kh;
    const maze = lineMask(mazePolys(w, h, 0.0125 * kh), 0.0034 * kh, 0.0012);
    for (const sd of [1, -1]) {
      const rough = new THREE.Vector3(...scalpPoint(ctx, sd * 0.78, 0.7));
      const n = V();
      if (!proj.project(rough, n)) continue;
      const m = frameAt(rough, n, V(sd * -0.25, 1, -0.55));
      dec(m, w, h, maze, 'head', 0.0012 * kh);
    }
  }
  if (o.arms !== false) {
    const L = P.hand.l.L;
    const w = 0.1 * k;
    const h = 0.17 * k;
    const knot = lineMask(knotPolys(w, h), 0.0033 * k, 0.0012);
    for (const sd of [1, -1]) {
      const sh = P.j.upperarm_l;
      // outer side of the upper arm, a little above its middle
      const q: V3 = [sd * (sh[0] + L.x * P.upperArm * 0.4), sh[1] + L.y * P.upperArm * 0.4, sh[2]];
      const p = V();
      const n = V();
      if (!snapPoint(proj, q, sd > 0 ? 'l' : 'r', p, n)) continue;
      // local +Y points up the arm toward the shoulder
      const up = V(sd * -L.x, -L.y, 0);
      dec(frameAt(p, n, up), w, h, knot, sd > 0 ? 'upperarm_l' : 'upperarm_r', 0.0012 * k);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// the floppy felt hat
// ─────────────────────────────────────────────────────────────────────────────

export interface FeltHatOpts {
  color: number;
  color2?: number;
  mat: Mat;
  /** brim radius (head units); the rolled cuff sits on its rim */
  brim?: number;
  /** how far the side and back brim droop (head units) */
  droop?: number;
  /** height of the hat's cuff on the head (head units; the brow is at 0.075) */
  y?: number;
  /** thickness of the rolled cuff (head units) */
  roll?: number;
  band?: number;
}

/**
 * A soft slouchy felt hat: a short rolled cuff resting on the brows and a crown that rises, folds
 * over and hangs its capped tip down at the left of the head, past ear height (sheet: front view tip
 * to the viewer's right, profile tip hangs to the back).
 */
export function feltHat(ctx: KindContext, o: FeltHatOpts) {
  const { P } = ctx;
  const u = P.headH;
  const h = P.h;
  const y0 = o.y ?? 0.07;
  const zOff = -0.07;
  const brim = o.brim ?? 0.52;
  const droop = o.droop ?? 0.06;
  const Rh = 0.41;
  const rollR = o.roll ?? 0.034;
  // crown spine (head units, relative to the cuff centre): a tapered chain that rises, then bends over
  // with a lateral offset and falls
  const spine = new THREE.CatmullRomCurve3(
    [
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0, 0.22, -0.02),
      new THREE.Vector3(0.03, 0.42, -0.04),
      new THREE.Vector3(0.15, 0.53, -0.06),
      new THREE.Vector3(0.38, 0.43, -0.08),
      new THREE.Vector3(0.62, 0.2, -0.08),
      new THREE.Vector3(0.74, -0.08, -0.08),
    ],
    false,
    'catmullrom',
    0.5,
  );
  const nS = 16;
  const nR = 14;
  const frames = spine.computeFrenetFrames(nS, false);
  const pos: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= nS; i++) {
    const t = i / nS;
    const c = spine.getPointAt(t);
    const r = Rh * Math.pow(1 - 0.82 * Math.pow(t, 0.9), 1.0) * (1 + 0.1 * Math.sin(t * Math.PI)) + 0.025 * (1 - t);
    for (let j = 0; j <= nR; j++) {
      const a = (j / nR) * Math.PI * 2;
      const nrm = frames.normals[i];
      const bin = frames.binormals[i];
      const x = c.x + (nrm.x * Math.cos(a) + bin.x * Math.sin(a)) * r;
      const y = c.y + (nrm.y * Math.cos(a) + bin.y * Math.sin(a)) * r;
      const z = c.z + (nrm.z * Math.cos(a) + bin.z * Math.sin(a)) * r * 1.1;
      const q = h(x, y0 + y, zOff + z);
      pos.push(q[0], q[1], q[2]);
    }
  }
  for (let i = 0; i < nS; i++)
    for (let j = 0; j < nR; j++) {
      const a = i * (nR + 1) + j;
      const b = a + nR + 1;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  // cap the tip: a fan from the last ring to a point just past it
  const tip = spine.getPointAt(1);
  const tq = h(tip.x, y0 + tip.y, zOff + tip.z);
  const apex = pos.length / 3;
  pos.push(tq[0], tq[1], tq[2]);
  for (let j = 0; j < nR; j++) idx.push(nS * (nR + 1) + j, apex, nS * (nR + 1) + j + 1);
  const crown = new THREE.BufferGeometry();
  crown.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  crown.setIndex(idx);
  crown.computeVertexNormals();
  // the brim: a short annulus, nearly flat so the eyes stay clear, with a thick rolled cuff on its rim
  const bp: number[] = [];
  const bi: number[] = [];
  const nPh = 30;
  const nT = 2;
  const edge: THREE.Vector3[] = [];
  for (let i = 0; i <= nT; i++) {
    const t = i / nT;
    for (let j = 0; j <= nPh; j++) {
      const ph = (j / nPh) * Math.PI * 2;
      const r = Rh * 0.98 + (brim - Rh * 0.98) * t;
      const side = Math.abs(Math.sin(ph));
      const back = Math.max(0, -Math.cos(ph));
      const y = -droop * Math.pow(t, 1.4) * (0.3 + 0.7 * side + 0.4 * back);
      const q = h(Math.sin(ph) * r, y0 + y + 0.01, zOff + Math.cos(ph) * r * 1.12);
      bp.push(q[0], q[1], q[2]);
      if (i === nT && j < nPh) edge.push(new THREE.Vector3(q[0], q[1], q[2]));
    }
  }
  for (let i = 0; i < nT; i++)
    for (let j = 0; j < nPh; j++) {
      const a = i * (nPh + 1) + j;
      const b = a + nPh + 1;
      bi.push(a, b, a + 1, a + 1, b, b + 1);
    }
  const brimG = new THREE.BufferGeometry();
  brimG.setAttribute('position', new THREE.Float32BufferAttribute(bp, 3));
  brimG.setIndex(bi);
  brimG.computeVertexNormals();
  const c1 = new THREE.Color().setHex(o.color, THREE.SRGBColorSpace);
  const c2 = new THREE.Color().setHex(o.color2 ?? o.color, THREE.SRGBColorSpace);
  const cc = new THREE.Color();
  const top = P.headC[1] + 0.22 * u;
  const colorFn = (p: THREE.Vector3, _n: THREE.Vector3, c: THREE.Color) => {
    // sun-faded crown
    const f = smoothstep(top, top + 0.5 * u, p.y);
    c.copy(cc.copy(c1).lerp(c2, f * 0.6));
  };
  put(ctx, crown, { bone: 'head', color: o.color, mat: o.mat, colorFn });
  put(ctx, brimG, { bone: 'head', color: o.color, mat: o.mat, colorFn });
  const roll = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(edge, true, 'centripetal'), 40, rollR * u, 6, true);
  put(ctx, roll, { bone: 'head', color: o.color, mat: o.mat });
  if (o.band) {
    const ring = new THREE.TorusGeometry(Rh * 1.01 * u, 0.02 * u, 4, 24).rotateX(Math.PI / 2).scale(1, 1, 1.12);
    ring.translate(...h(0, y0 + 0.05, zOff));
    put(ctx, ring, { bone: 'head', color: o.band, mat: 'leather_worn', small: true });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// quilting, real straps, chin braids
// ─────────────────────────────────────────────────────────────────────────────

function mergeIndexed(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const pos: number[] = [];
  const nor: number[] = [];
  const idx: number[] = [];
  for (const g of list) {
    const base = pos.length / 3;
    const p = g.attributes.position;
    const n = g.attributes.normal;
    for (let i = 0; i < p.count; i++) {
      pos.push(p.getX(i), p.getY(i), p.getZ(i));
      nor.push(n.getX(i), n.getY(i), n.getZ(i));
    }
    const ix = g.index!;
    for (let i = 0; i < ix.count; i++) idx.push(base + ix.getX(i));
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  out.setIndex(idx);
  return out;
}

/**
 * The quilted grid of a padded vest: thin dark channels on the chest and back (columns and rows),
 * snapped to the sculpt and pressed half into it. Thicker and lighter than a stitch line so they read
 * at game distance without turning into a black wireframe.
 */
export function quiltGrid(ctx: KindContext, proj: Projector, o: { cols: number[]; rows: number[]; y0: number; y1: number; halfW: number; color: number; radius: number; skipY?: [number, number] }) {
  const { P } = ctx;
  const k = P.s / 0.735;
  const lines: THREE.Vector3[][] = [];
  const p = V();
  const n = V();
  const lift = 0.0006 * k;
  for (const mode of ['f', 'b'] as const) {
    for (const y of o.rows) {
      const row: THREE.Vector3[] = [];
      for (let x = -o.halfW; x <= o.halfW + 1e-6; x += 0.045 * k) if (snapPoint(proj, [x, y, 0], mode, p, n)) row.push(p.clone().addScaledVector(n, lift));
      if (row.length > 1) lines.push(row);
    }
    for (const x of o.cols) {
      let col: THREE.Vector3[] = [];
      for (let y = o.y0; y <= o.y1 + 1e-6; y += 0.045 * k) {
        if (o.skipY && y > o.skipY[0] && y < o.skipY[1]) {
          if (col.length > 1) lines.push(col);
          col = [];
          continue;
        }
        if (snapPoint(proj, [x, y, 0], mode, p, n)) col.push(p.clone().addScaledVector(n, lift));
      }
      if (col.length > 1) lines.push(col);
    }
  }
  const list: THREE.BufferGeometry[] = [];
  for (const l of lines) list.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(l, false, 'centripetal'), Math.max(2, l.length - 1), o.radius * k, 3, false));
  if (list.length) put(ctx, mergeIndexed(list), { bone: 'chest', color: o.color, mat: 'wool', small: true, ao: 1 });
}

/** a thin leather strap across the chest or back (one diagonal), lying on the finished sculpt */
export function crossStrap(ctx: KindContext, proj: Projector, o: { sign: 1 | -1; side: 'f' | 'b'; color: number; mat: Mat; width: number; thick: number }) {
  const { P } = ctx;
  const sc = P.s;
  const k = sc / 0.735;
  const n = new THREE.Vector3(o.sign, 1.25, 0).normalize();
  const c = n.dot(new THREE.Vector3(0, P.j.chest[1] + 0.05 * sc, 0));
  const pts: SnapPoint[] = [];
  for (let i = 0; i <= 10; i++) {
    const x = (-0.17 + (0.34 * i) / 10) * k;
    pts.push([x, (c - n.x * x) / n.y, 0, o.side, 0.7]);
  }
  const path = snapPath(proj, pts, 0.001);
  if (path.p.length < 3) return;
  put(ctx, ribbon(path.p, path.n, o.width, o.thick, 1, { outerOnly: true, noInner: true }, 12), { bone: 'chest', color: o.color, mat: o.mat });
}

/**
 * Braids hanging from the chin: tapered tubes laid down the chest with brass rings. Real geometry,
 * outside the hair-card alpha path so they cannot be culled.
 */
export function chinBraids(ctx: KindContext, proj: Projector, o: { color: number; brass: number; xs: number[]; lens: number[]; radius: number; rings: number }) {
  const { P } = ctx;
  const sc = P.s;
  const u = P.headH;
  const k = sc / 0.735;
  const p = V();
  const n = V();
  const y0 = P.h(0, -0.56, 0)[1];
  o.xs.forEach((xu, bi) => {
    const L = o.lens[bi] * k;
    const pts: V3[] = [];
    const surf: THREE.Vector3[] = [];
    for (let i = 0; i <= 5; i++) {
      const t = i / 5;
      const x = xu * u * (1 + 0.1 * t);
      const y = y0 - L * t;
      if (!snapPoint(proj, [x, y, 0], 'f', p, n)) continue;
      const q = p.clone().addScaledVector(n, o.radius * k * (1.0 - 0.3 * t) + 0.002 * k);
      pts.push([q.x, q.y, q.z]);
      surf.push(q);
    }
    if (pts.length < 3) return;
    put(ctx, taperedTube(pts, o.radius * k, o.radius * 0.55 * k, { seg: 6, radial: 5 }), { bone: 'jaw', color: o.color, mat: 'hair' });
    const curve = new THREE.CatmullRomCurve3(surf, false, 'catmullrom', 0.4);
    for (let r = 0; r < o.rings; r++) {
      const t = o.rings === 1 ? 0.9 : 0.42 + (0.52 * r) / (o.rings - 1);
      const c = curve.getPointAt(t);
      const d = curve.getTangentAt(t);
      put(ctx, ring([c.x, c.y, c.z], [d.x, d.y, d.z], o.radius * 1.12 * k * (1 - 0.25 * t), 0.0045 * k, 6), { bone: 'jaw', color: o.brass, mat: 'gold', small: true });
    }
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// body layers: tunic / mail / coat with a belly pad, and the belt
// ─────────────────────────────────────────────────────────────────────────────

export interface LayerOpts {
  color: number;
  color2?: number;
  mat: Mat;
  /** thickness over the body (m, scaled inside) */
  inflate: number;
  /** sleeve length: 0 = none, 1 = elbow, 2 = wrist */
  sleeve?: number;
  /** lowest point of the layer (m above the ground) */
  hemY: number;
  /** a barrel of cloth at the waist: half widths (m at the nominal 1.36 m dwarf) and centre height */
  pad?: { rx: number; rz: number; y: number; ry?: number; dz?: number };
  /** neckline above the neck joint (m, scaled) */
  neckUp?: number;
  noNeck?: boolean;
  /** sleeve thickness (m, scaled); default 0.9 × inflate */
  sleeveInflate?: number;
}

const TORSO: PartTag[] = ['pelvis', 'waist', 'belly', 'ribs', 'chest', 'pecs', 'back', 'trap', 'glutes'];

/** torso (+ barrel pad) + sleeves as one smooth garment; the skirt below is added as gear by the caller */
export function bodyLayer(ctx: KindContext, o: LayerOpts) {
  const { P, sculpt: s } = ctx;
  const sc = P.s;
  const k = sc / 0.735;
  const j = P.j;
  const parts = anatomyParts(P);
  const L = P.hand.l.L;
  const sleeve = o.sleeve ?? 0;
  const opt = { color: o.color, color2: o.color2, colorNoise: o.color2 !== undefined ? 0.4 : 0, colorFreq: 26 / sc, mat: o.mat };
  const neckTop = j.neck[1] + (o.neckUp ?? 0.03) * sc;
  s.group('union', 0.004 * sc, () => {
    s.group('union', 0.0, () => {
      emitParts(s, parts, [...TORSO, ...(o.noNeck ? [] : (['neck'] as PartTag[])), ...(sleeve > 0 ? (['deltoid'] as PartTag[]) : [])], { ...opt, inflate: o.inflate * sc });
      if (o.pad) {
        const p = o.pad;
        s.ellipsoid([0, p.y, (p.dz ?? 0.006) * k], [p.rx * k, (p.ry ?? 0.15) * k, p.rz * k], { ...opt, k: 0.05 * sc, bone: 'spine', bone2: 'chest', blend: [0.4, 1.0] });
      }
      slab(s, o.hemY, neckTop, 0.008 * sc);
    });
    if (sleeve > 0) {
      s.mirrored(() =>
        s.group('union', 0.004 * sc, () => {
          emitParts(s, parts, sleeve > 1 ? ['upperarm', 'forearm'] : ['upperarm'], { ...opt, inflate: (o.sleeveInflate ?? o.inflate * 0.9) * sc, oneSide: true });
          const sh = j.upperarm_l;
          const end: V3 = [
            sh[0] + L.x * P.upperArm * Math.min(sleeve, 1) + L.x * P.foreArm * Math.max(0, sleeve - 1) * 0.97,
            sh[1] + L.y * P.upperArm * Math.min(sleeve, 1) + L.y * P.foreArm * Math.max(0, sleeve - 1) * 0.97,
            sh[2],
          ];
          const dEnd = L.x * end[0] + L.y * end[1] + L.z * end[2];
          s.plane([L.x, L.y, L.z], dEnd, { op: 'intersect', k: 0.006 * sc });
          s.plane([L.x, L.y, L.z], dEnd, { op: 'paint', seam: 0, k: 0.002 });
          const st: V3 = [sh[0] - L.x * 0.03 * sc, sh[1] - L.y * 0.03 * sc, sh[2]];
          s.plane([-L.x, -L.y, -L.z], -(L.x * st[0] + L.y * st[1] + L.z * st[2]), { op: 'intersect', k: 0.01 * sc });
        }),
      );
    }
  });
}

/** a gathered sleeve cuff: a rounded ring around each forearm near the wrist (rigid gear) */
export function sleeveCuffs(ctx: KindContext, o: { color: number; mat: Mat; at?: number; extra?: number }) {
  const { P } = ctx;
  const sc = P.s;
  const L = P.hand.l.L;
  const g = Math.sqrt(P.build.bulk);
  for (const side of ['l', 'r'] as const) {
    const sx = side === 'l' ? 1 : -1;
    const e0 = P.j[`forearm_${side}`];
    const t = P.foreArm * (o.at ?? 0.88);
    const at: V3 = [e0[0] + sx * L.x * t, e0[1] + L.y * t, e0[2]];
    const dir = new THREE.Vector3(sx * L.x, L.y, 0).normalize();
    const geo = new THREE.TorusGeometry((0.032 * g + 0.012 + (o.extra ?? 0)) * sc, 0.011 * sc, 5, 14);
    const m = new THREE.Matrix4().compose(new THREE.Vector3(...at), new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir), new THREE.Vector3(1, 1, 1));
    put(ctx, geo, { bone: `forearm_${side}`, color: o.color, mat: o.mat, matrix: m, small: true });
  }
}

/** a belt: the body (and any barrel pad) inflated, cut to a band; leather with seams */
export function sculptBelt(ctx: KindContext, o: { y: number; hw: number; color: number; mat: Mat; inflate: number; pad?: { rx: number; rz: number; dz?: number } }) {
  const { P, sculpt: s } = ctx;
  const sc = P.s;
  const k = sc / 0.735;
  const parts = anatomyParts(P);
  s.group('union', 0.002 * sc, () => {
    emitParts(s, parts, ['pelvis', 'waist', 'belly', 'glutes'], { color: o.color, mat: o.mat, inflate: o.inflate * sc });
    if (o.pad) s.ellipsoid([0, o.y, (o.pad.dz ?? 0.006) * k], [o.pad.rx * k + o.inflate * sc * 0.6, 0.15 * k, o.pad.rz * k + o.inflate * sc * 0.6], { color: o.color, mat: o.mat, k: 0.04 * sc, bone: 'spine', bone2: 'chest', blend: [0.4, 1.0] });
    slab(s, o.y - o.hw * sc, o.y + o.hw * sc, 0.003 * sc);
    s.plane([0, 1, 0], o.y + o.hw * sc, { op: 'paint', seam: 0, k: 0.002 });
    s.plane([0, -1, 0], -(o.y - o.hw * sc), { op: 'paint', seam: 0, k: 0.002 });
  });
}
