/**
 * Parts for the human kinds (easterling, haradrim): shoulder lames, scale armour surfaces, jewellery, plumes,
 * forearm cuffs, a few-triangle skinned cloth sheet builder and some shared sculpted pieces.
 */
import * as THREE from 'three';
import { noise2 } from '../../../../core/rng';
import { makeSkinnedMesh, type RigDef } from '../../../kit/rig';
import type { V3 } from '../../../kit/sdf';
import { SURFACES, surface, type SurfaceName, type SurfaceSpec } from '../../../kit/surfaces';
import { anatomyParts, emitParts } from '../../anatomy';
import type { Proportions } from '../../proportions';
import type { KindContext } from '../../types';
import { put, shell, spike, taperedTube } from './armor';
import { placeAlong, snapPoint, V, type Projector } from '../uruks_bosses/common';

/** gilded bronze scale armour: stippled dark bronze between big overlapping scales (sheet: worn gilt scales) */
export const GOLD_SCALES = surface('gold', { rough: 0.55, pat: { scales: 4.2, scratches: 0.6, pores: 0.45 } });
export const BLACK_SCALES = surface('metal_dark', { rough: 0.42, metal: 0.85, pat: { scales: 3.0, scratches: 0.5 } });
/** worn gilt (helmets, rosettes, buckles) with hammered dents */
export const GILT = surface('gold', { rough: 0.42, pat: { scales: -0.6, scratches: 0.7, pores: 0.4 } });
/** woven wool/linen for the red cloth (soft sheen tinted by the albedo) */
export const WOVEN = surface('cloth', { rough: 0.9, sheen: 0.35, pat: { weave: 1.2 } });

/** stacked, flared half-shell shoulder lames: the lowest is the biggest, each one above it `shrink` smaller and a little higher */
export function layeredPauldrons(ctx: KindContext, o: { color: number; trim?: number; mat?: SurfaceName | SurfaceSpec; trimMat?: SurfaceName | SurfaceSpec; layers?: number; size?: number; spike?: number; sides?: ('l' | 'r')[]; rise?: number; shrink?: number; tilt?: number }) {
  const { P } = ctx;
  const s = P.s;
  const g = Math.sqrt(P.build.bulk);
  const layers = o.layers ?? 3;
  const trim = o.trim ?? o.color;
  const th = Math.PI * 0.34;
  for (const side of o.sides ?? (['l', 'r'] as const)) {
    const sx = side === 'l' ? 1 : -1;
    const sh = P.j[`upperarm_${side}`];
    for (let k = 0; k < layers; k++) {
      const R = 0.1 * s * g * (o.size ?? 1) * Math.pow(o.shrink ?? 0.83, k);
      const geo = shell(R, R * 0.5, R * 1.05, { th0: 0, th1: th, w: 10, h: 3 });
      const m = new THREE.Matrix4()
        .makeTranslation(sh[0] + sx * 0.018 * s, sh[1] + (0.004 + k * (o.rise ?? 0.022)) * s, sh[2])
        .multiply(new THREE.Matrix4().makeRotationZ(-sx * ((o.tilt ?? 0.55) - k * 0.05)));
      put(ctx, geo, { bone: `upperarm_${side}`, color: o.color, mat: o.mat ?? 'gold', matrix: m });
      const rg = new THREE.TorusGeometry(R * 0.99, 0.0045 * s * 1.3, 3, 12).rotateX(Math.PI / 2);
      rg.scale(Math.sin(th), 1, Math.sin(th) * 1.05).translate(0, Math.cos(th) * R * 0.5, 0);
      put(ctx, rg, { bone: `upperarm_${side}`, color: trim, mat: o.trimMat ?? 'gold', matrix: m, small: true });
    }
    if (o.spike) put(ctx, spike([sh[0] + sx * 0.05 * s, sh[1] + 0.085 * s, sh[2]], [sx * 0.35, 1, 0], o.spike * s, 0.014 * s, 6), { bone: `upperarm_${side}`, color: trim, mat: o.trimMat ?? 'gold', small: true });
  }
}

/** gold neck ring (torque) and ear rings */
export function jewelry(ctx: KindContext, o: { color?: number; neck?: boolean; ears?: boolean }) {
  const { P } = ctx;
  const s = P.s;
  const c = o.color ?? 0xb58d3d;
  if (o.neck) {
    const r = (0.066 * P.build.neckThick * Math.sqrt(P.build.bulk) + 0.012) * s;
    put(ctx, new THREE.TorusGeometry(r, 0.0075 * s, 6, 20).rotateX(Math.PI / 2 - 0.25).translate(0, P.j.neck[1] + 0.012 * s, 0.0), { bone: 'neck', color: c, mat: GILT, small: true });
  }
  if (o.ears) {
    for (const sd of [1, -1]) put(ctx, new THREE.TorusGeometry(0.014 * s, 0.0025 * s, 4, 10).translate(...P.h(sd * 0.36, -0.2, -0.015)), { bone: 'head', color: c, mat: GILT, small: true });
  }
}

/** a horsehair plume streaming back from the crown */
export function plume(ctx: KindContext, o: { color: number; length?: number; y?: number; spread?: number; n?: number; mat?: SurfaceName }) {
  const { P } = ctx;
  const u = P.headH;
  const n = o.n ?? 7;
  const len = (o.length ?? 0.9) * u;
  for (let i = 0; i < n; i++) {
    const f = n === 1 ? 0 : i / (n - 1) - 0.5;
    const base = P.h(f * 0.12 * (o.spread ?? 1), (o.y ?? 0.62) - Math.abs(f) * 0.04, 0.0);
    const pts: V3[] = [base, [base[0] + f * 0.1 * u, base[1] + 0.12 * u, base[2] - 0.2 * u], [base[0] + f * 0.22 * u, base[1] + 0.12 * u, base[2] - 0.5 * u], [base[0] + f * 0.34 * u, base[1] - len * 0.35, base[2] - 0.7 * u]];
    put(ctx, taperedTube(pts, 0.05 * u, 0.012 * u, { seg: 10, radial: 4 }), { bone: 'head', color: o.color, mat: o.mat ?? 'wool', small: true });
  }
}

/** a low horsehair brush along the crown of a dome helmet (Easterling helm), front to back: about `height` m tall and ~3 cm wide,
 *  highest at the back of the crown, with a ragged top edge */
export function crest(ctx: KindContext, o: { color: number; height: number; profile: [number, number][]; y?: number; zs?: number; mat?: SurfaceName | SurfaceSpec }) {
  const { P } = ctx;
  const u = P.headH;
  const zs = o.zs ?? 1.28;
  const prof = o.profile;
  const n = prof.length;
  const ridge: [number, number][] = []; // (z, y) in head units along the dome's centre line, front to back
  for (let i = 1; i <= n - 2; i++) ridge.push([prof[i][0] * zs - 0.06, prof[i][1] + 0.075 + (o.y ?? 0)]);
  for (let i = n - 2; i >= 1; i--) ridge.push([-prof[i][0] * zs - 0.06, prof[i][1] + 0.075 + (o.y ?? 0)]);
  const i0 = Math.floor(ridge.length * 0.2);
  const i1 = Math.ceil(ridge.length * 0.9);
  const seg = ridge.slice(i0, i1 + 1);
  const pos: number[] = [];
  const idx: number[] = [];
  const w = 0.014 * P.s;
  seg.forEach(([z, y], i) => {
    const t = i / (seg.length - 1);
    const rag = i % 2 ? 0.82 : 1;
    const h = o.height * Math.pow(Math.sin(Math.PI * Math.min(1, t * 0.88 + 0.06)), 0.6) * (0.55 + 0.45 * t) * rag;
    const base = P.h(0, y - 0.03, z);
    const top: V3 = [base[0], base[1] + h + 0.03 * u, base[2]];
    for (const [x, q] of [[-w, base], [w, base], [-w * 0.6, top], [w * 0.6, top]] as [number, V3][]) pos.push(q[0] + x, q[1], q[2]);
  });
  for (let i = 0; i + 1 < seg.length; i++) {
    const a = i * 4;
    const b = a + 4;
    idx.push(a, a + 2, b, b, a + 2, b + 2, a + 1, b + 1, a + 3, b + 1, b + 3, a + 3, a + 2, a + 3, b + 2, b + 2, a + 3, b + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  put(ctx, g, { bone: 'head', color: o.color, mat: o.mat ?? surface('hair', { rough: 0.9, sheen: 0, pat: { fur: 0.3 } }), small: true });
}

// ─────────────────────────────────────────────────────────────────────────────
// skinned cloth sheets: the kit's skirt weighting (hips / thighs / skirt_f, skirt_b) on a grid we control, so a skirt or a
// coat costs a few hundred triangles (one or two divisions per colour column) instead of the kit's fixed 3.5 cm cells
// ─────────────────────────────────────────────────────────────────────────────

/** attach a geometry carrying kit skin weights as a skinned mesh sharing the body material */
export function attachBodySkinned(ctx: KindContext, geo: THREE.BufferGeometry, name: string, o: { small?: boolean } = {}) {
  geo.userData.shared = true;
  ctx.object(
    () => {
      const holder = new THREE.Group();
      holder.name = 'skinned-extra';
      let mesh: THREE.SkinnedMesh | null = null;
      let tried = false;
      const base = holder.updateMatrixWorld;
      holder.updateMatrixWorld = function (this: THREE.Group, force?: boolean) {
        if (!mesh && !tried && this.parent) {
          let p: THREE.Object3D | null = this.parent;
          while (p && !mesh) {
            const body = p.children.find((c) => (c as THREE.SkinnedMesh).isSkinnedMesh) as THREE.SkinnedMesh | undefined;
            if (body) {
              mesh = makeSkinnedMesh(geo, body.material as THREE.Material, { skeleton: body.skeleton } as never, body.boundingSphere?.radius ?? 2, body.boundingSphere ? ([body.boundingSphere.center.x, body.boundingSphere.center.y, body.boundingSphere.center.z] as V3) : undefined);
              mesh.name = name;
              mesh.castShadow = true;
              mesh.receiveShadow = true;
              p.add(mesh);
            }
            p = p.parent;
          }
          if (!mesh) tried = true;
        }
        if (mesh) mesh.visible = this.visible;
        base.call(this, force);
      };
      return holder;
    },
    { bone: 'head', small: o.small ?? false },
  );
}

/** one colour column of a sheet: from angle a0 to a1 (radians from +Z toward +X), `nu` divisions, pushed out by `out` m */
export interface SheetCol {
  a0: number;
  a1: number;
  color: number;
  nu?: number;
  out?: number;
}

export interface SheetOpts {
  cols: SheetCol[];
  top: number;
  bottom: number;
  /** radii at the waist (default: the kit skirt's) and at the hem */
  rx0?: number;
  rz0?: number;
  rx1: number;
  rz1: number;
  /** radius(v) = r0 + (r1 - r0) * v^curve with v 0 at the top and 1 at the hem (the kit uses 0.5) */
  curve?: number;
  rows?: number;
  mat?: SurfaceName | SurfaceSpec;
  /** a hem band of `band` (fraction of the height) in another colour */
  hem?: { color: number; band: number };
  /** soft fold amplitude (m) */
  fold?: number;
  seed?: number;
}

const _c = new THREE.Color();

/** default waist radii of the kit's skirt, for sheets that start at the hips */
export function waistRadii(P: Proportions, grow = 0): { rx0: number; rz0: number } {
  const s = P.s;
  const sg = Math.sqrt(P.build.bulk);
  return { rx0: 0.158 * s * P.build.hips * sg + 0.012 * s + grow, rz0: 0.112 * s * sg + 0.012 * s + grow };
}

/** radius (x, z) of a sheet at height y, to hang things on it */
export function sheetRadius(P: Proportions, o: SheetOpts, y: number): { rx: number; rz: number } {
  const w = waistRadii(P);
  const v = Math.min(1, Math.max(0, (o.top - y) / (o.top - o.bottom)));
  const r = Math.pow(v, o.curve ?? 0.7);
  const rx0 = o.rx0 ?? w.rx0;
  const rz0 = o.rz0 ?? w.rz0;
  return { rx: rx0 + (o.rx1 - rx0) * r, rz: rz0 + (o.rz1 - rz0) * r - 0.01 * P.s };
}

/** the sheets as one geometry with the kit's attribute layout (merged: one draw call) */
export function sheetGeometry(P: Proportions, rig: RigDef, sheets: SheetOpts[]): THREE.BufferGeometry {
  const pos: number[] = [];
  const col: number[] = [];
  const surf: number[] = [];
  const pat0: number[] = [];
  const pat1: number[] = [];
  const seam: number[] = [];
  const ao: number[] = [];
  const si: number[] = [];
  const sw: number[] = [];
  const idx: number[] = [];
  const s = P.s;
  const iH = rig.boneIndex('hips');
  const iTL = rig.boneIndex('thigh_l');
  const iTR = rig.boneIndex('thigh_r');
  const iSF = rig.boneIndex('skirt_f');
  const iSB = rig.boneIndex('skirt_b');
  const w: [number, number][] = [];
  for (const o of sheets) {
    const spec: SurfaceSpec = typeof o.mat === 'string' ? SURFACES[o.mat] : o.mat ?? SURFACES.cloth;
    const H = o.top - o.bottom;
    const band = o.hem?.band ?? 0;
    const rows = o.rows ?? 6;
    const vs: number[] = [];
    for (let i = 0; i <= rows; i++) vs.push((i / rows) * (1 - band));
    if (band > 0) vs.push(1);
    const aMin = Math.min(...o.cols.map((c) => c.a0));
    const aMax = Math.max(...o.cols.map((c) => c.a1));
    const closed = aMax - aMin > Math.PI * 2 - 0.02;
    const waist = waistRadii(P);
    const rx0 = o.rx0 ?? waist.rx0;
    const rz0 = o.rz0 ?? waist.rz0;
    const curve = o.curve ?? 0.7;
    const seed = o.seed ?? 3;
    const n2 = noise2(seed);
    for (const c of o.cols) {
      const nu = c.nu ?? 1;
      const start = pos.length / 3;
      for (let iv = 0; iv < vs.length; iv++) {
        const v = vs[iv];
        const rr = Math.pow(v, curve);
        const ease = v * v * (3 - 2 * v);
        const hemmed = o.hem !== undefined && v >= 1;
        _c.setHex(hemmed ? o.hem!.color : c.color, THREE.SRGBColorSpace);
        for (let iu = 0; iu <= nu; iu++) {
          const a = c.a0 + ((c.a1 - c.a0) * iu) / nu;
          const rx = rx0 + (o.rx1 - rx0) * rr + (c.out ?? 0);
          const rz = rz0 + (o.rz1 - rz0) * rr + (c.out ?? 0);
          const fold = (o.fold ?? 0) * (n2(a * 3, seed) + Math.sin(a * 7 + seed)) * 0.5 * ease;
          pos.push(Math.sin(a) * (rx + fold), o.top - H * v, Math.cos(a) * (rz + fold) - 0.01 * s);
          col.push(_c.r, _c.g, _c.b);
          surf.push(spec.rough, spec.metal, spec.sheen, spec.skin);
          pat0.push(spec.pat[0], spec.pat[1], spec.pat[2], spec.pat[3]);
          pat1.push(spec.pat[4], spec.pat[5], spec.pat[6], spec.pat[7]);
          const edge = Math.min(H * (1 - v), closed ? 9 : (a - aMin) * rx, closed ? 9 : (aMax - a) * rx);
          seam.push(-Math.min(0.03, edge), 1);
          ao.push(0.55 + 0.45 * v);
          // weights as the kit's skirt: hips at the top, thighs at the sides, skirt_f / skirt_b front and back
          w.length = 0;
          const side = Math.sin(a);
          const front = Math.max(0, Math.cos(a));
          const back = Math.max(0, -Math.cos(a));
          const lower = Math.min(1, v * 1.25);
          w.push([iH, Math.max(0.0001, 1 - lower * 0.9)], [iTL, side > 0 ? side * side * lower : 0], [iTR, side < 0 ? side * side * lower : 0]);
          if (iSF >= 0) w.push([iSF, front * front * lower * 0.9]);
          if (iSB >= 0) w.push([iSB, back * back * lower * 0.9]);
          w.sort((x, y) => y[1] - x[1]);
          let sum = 0;
          for (let i = 0; i < 4; i++) sum += w[i]?.[1] ?? 0;
          sum = sum || 1;
          for (let i = 0; i < 4; i++) {
            si.push(w[i]?.[0] ?? 0);
            sw.push((w[i]?.[1] ?? 0) / sum);
          }
        }
      }
      for (let iv = 0; iv < vs.length - 1; iv++)
        for (let iu = 0; iu < nu; iu++) {
          const a = start + iv * (nu + 1) + iu;
          const b = a + nu + 1;
          idx.push(a, b, a + 1, a + 1, b, b + 1);
        }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('surf', new THREE.Float32BufferAttribute(surf, 4));
  g.setAttribute('pat0', new THREE.Float32BufferAttribute(pat0, 4));
  g.setAttribute('pat1', new THREE.Float32BufferAttribute(pat1, 4));
  g.setAttribute('seam', new THREE.Float32BufferAttribute(seam, 2));
  g.setAttribute('ao', new THREE.Float32BufferAttribute(ao, 1));
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
  g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
  g.setIndex(new THREE.BufferAttribute(Uint32Array.from(idx), 1));
  g.computeVertexNormals();
  return g;
}

/** skirt / coat sheets from the hips down (the outfit needs a `skirt` layer with `chance: 0` so the spring bones exist) */
export function addClothSheets(ctx: KindContext, sheets: SheetOpts[], name = 'cloth') {
  attachBodySkinned(ctx, sheetGeometry(ctx.P, ctx.rig, sheets), name);
}

// ─────────────────────────────────────────────────────────────────────────────
// sculpted pieces
// ─────────────────────────────────────────────────────────────────────────────

/** a cuff / vambrace on the forearm: t from the elbow (0) to the wrist (1), proud of the sleeve by `inflate` */
export function forearmBand(ctx: KindContext, o: { t0: number; t1: number; color: number; color2?: number; mat: SurfaceName | SurfaceSpec; inflate: number; seam?: boolean }) {
  const { P, sculpt: s } = ctx;
  const sc = P.s;
  const j = P.j;
  const L = P.hand.l.L;
  const parts = anatomyParts(P);
  const a0: V3 = [j.forearm_l[0] + L.x * P.foreArm * o.t0, j.forearm_l[1] + L.y * P.foreArm * o.t0, j.forearm_l[2]];
  const a1: V3 = [j.forearm_l[0] + L.x * P.foreArm * o.t1, j.forearm_l[1] + L.y * P.foreArm * o.t1, j.forearm_l[2]];
  s.mirrored(() =>
    s.group('union', 0.0018 * sc, () => {
      emitParts(s, parts, ['forearm'], { color: o.color, color2: o.color2, colorNoise: o.color2 !== undefined ? 0.45 : undefined, colorFreq: 40 / sc, mat: o.mat, inflate: o.inflate, k: 0.02 * sc, oneSide: true });
      const d0 = L.x * a0[0] + L.y * a0[1] + L.z * a0[2];
      const d1 = L.x * a1[0] + L.y * a1[1] + L.z * a1[2];
      s.plane([-L.x, -L.y, -L.z], -d0, { op: 'intersect', k: 0.003 * sc });
      s.plane([L.x, L.y, L.z], d1, { op: 'intersect', k: 0.003 * sc });
      if (o.seam !== false) {
        s.plane([-L.x, -L.y, -L.z], -d0, { op: 'paint', seam: 0, k: 0.002 });
        s.plane([L.x, L.y, L.z], d1, { op: 'paint', seam: 0, k: 0.002 });
      }
    }),
  );
}

/** a horizontal slab of the lower leg (greaves, boot bands) between two heights */
export function shinBand(ctx: KindContext, o: { y0: number; y1: number; color: number; color2?: number; mat: SurfaceName | SurfaceSpec; inflate: number; tags?: ('shin' | 'calf' | 'knee')[] }) {
  const { P, sculpt: s } = ctx;
  const sc = P.s;
  const parts = anatomyParts(P);
  s.group('union', 0.002 * sc, () => {
    emitParts(s, parts, o.tags ?? ['shin', 'calf'], { color: o.color, color2: o.color2, colorNoise: o.color2 !== undefined ? 0.45 : undefined, colorFreq: 40 / sc, mat: o.mat, inflate: o.inflate, k: 0.03 * sc });
    s.plane([0, 1, 0], o.y1, { op: 'intersect', k: 0.003 * sc });
    s.plane([0, -1, 0], -o.y0, { op: 'intersect', k: 0.003 * sc });
    s.plane([0, 1, 0], o.y1, { op: 'paint', seam: 0, k: 0.002 });
    s.plane([0, -1, 0], -o.y0, { op: 'paint', seam: 0, k: 0.002 });
  });
}

/** a cap over the front half of the knee (a gilt knee guard, not a full ring) */
export function kneeCap(ctx: KindContext, o: { y0: number; y1: number; color: number; mat: SurfaceName | SurfaceSpec; inflate: number }) {
  const { P, sculpt: s } = ctx;
  const sc = P.s;
  const parts = anatomyParts(P);
  s.group('union', 0.002 * sc, () => {
    emitParts(s, parts, ['knee', 'shin'], { color: o.color, mat: o.mat, inflate: o.inflate, k: 0.02 * sc });
    s.plane([0, 1, 0], o.y1, { op: 'intersect', k: 0.003 * sc });
    s.plane([0, -1, 0], -o.y0, { op: 'intersect', k: 0.003 * sc });
    s.plane([0, 0, -1], -(P.j.shin_l[2] + 0.004 * sc), { op: 'intersect', k: 0.004 * sc });
    s.plane([0, 1, 0], o.y1, { op: 'paint', seam: 0, k: 0.002 });
    s.plane([0, -1, 0], -o.y0, { op: 'paint', seam: 0, k: 0.002 });
  });
}

/** a wrapped cloth scarf / cowl: stacked thick rings round the neck and over the shoulders */
export function cowl(ctx: KindContext, o: { color: number; color2?: number; mat?: SurfaceName | SurfaceSpec; rings?: number; thick?: number; spread?: number; lift?: number }) {
  const { P, sculpt: s } = ctx;
  const sc = P.s;
  const ny = P.j.neck[1];
  const r = (0.062 * P.build.neckThick * Math.sqrt(P.build.bulk) + (o.thick ?? 0.034)) * sc;
  const n = o.rings ?? 3;
  s.with({ color: o.color, color2: o.color2, colorNoise: o.color2 !== undefined ? 0.5 : 0, colorFreq: 22 / sc, mat: o.mat ?? WOVEN, noise: { amp: 0.0035 * sc, freq: 30 / sc, type: 'ridged', octaves: 2 } }, () => {
    for (let i = 0; i < n; i++) {
      const f = n === 1 ? 0 : i / (n - 1);
      s.torus([0, ny + (o.lift ?? 0.065) * sc - f * 0.058 * sc, -0.012 * sc + f * 0.006 * sc], r * (1 + f * 0.5 * (o.spread ?? 1)), (0.028 + 0.004 * f) * sc, { k: 0.016 * sc, rot: [0.12 - f * 0.1, 0, f % 0.2 > 0.1 ? 0.06 : -0.05], bone: f > 0.5 ? 'chest' : 'neck' });
    }
  });
}

/** place a rigid disc/rosette on the sculpted surface at (x, y): snapped from the front */
export function surfaceMatrix(proj: Projector, x: number, y: number, lift: number, up = V(0, 1, 0), back = false): THREE.Matrix4 | null {
  const hp = V();
  const hn = V();
  if (!snapPoint(proj, [x, y, back ? -0.4 : 0.4], back ? 'b' : 'f', hp, hn)) return null;
  hp.addScaledVector(hn, lift);
  return placeAlong(hp, hn, up);
}

/** a gilt rosette: raised disc, rim ring and a boss (local +Y = outward) */
export function rosetteGeo(r: number, rim = 0.18): THREE.BufferGeometry {
  const geos: THREE.BufferGeometry[] = [];
  const disc = new THREE.CylinderGeometry(r, r * 1.04, r * 0.22, 9, 1);
  geos.push(disc);
  const rg = new THREE.TorusGeometry(r * 0.92, r * rim, 3, 9).rotateX(Math.PI / 2).translate(0, r * 0.12, 0);
  geos.push(rg);
  geos.push(new THREE.SphereGeometry(r * 0.42, 6, 2, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, r * 0.1, 0));
  const out = mergeSimple(geos);
  return out;
}

function mergeSimple(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const pos: number[] = [];
  const nor: number[] = [];
  for (const g of list) {
    const ng = g.index ? g.toNonIndexed() : g;
    ng.computeVertexNormals();
    for (const v of ng.attributes.position.array) pos.push(v);
    for (const v of ng.attributes.normal.array) nor.push(v);
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  return out;
}
