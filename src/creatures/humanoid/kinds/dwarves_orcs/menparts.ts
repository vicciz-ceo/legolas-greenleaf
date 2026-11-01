/**
 * Parts for the human kinds (easterling, haradrim): layered pauldrons, scale armour surfaces,
 * jewellery, plumes, forearm cuffs, skinned cloth sheets and a few shared sculpted pieces.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Rng } from '../../../../core/rng';
import { makeSkinnedMesh } from '../../../kit/rig';
import type { V3 } from '../../../kit/sdf';
import { surface, type SurfaceName, type SurfaceSpec } from '../../../kit/surfaces';
import { anatomyParts, emitParts } from '../../anatomy';
import { skirtGeometry } from '../../cloth';
import type { KindContext } from '../../types';
import { put, ring, shell, spike, studs, taperedTube } from './armor';
import { placeAlong, snapPoint, V, type Projector } from '../uruks_bosses/common';

/** gilded bronze scale armour: dark stippled bronze, big overlapping scales (sheet: worn gilt scales) */
export const GOLD_SCALES = surface('gold', { rough: 0.5, pat: { scales: 1.9, scratches: 0.6, pores: 0.45 } });
export const BRONZE_SCALES = surface('gold', { rough: 0.55, pat: { scales: 1.9, scratches: 0.6, pores: 0.5 } });
export const BLACK_SCALES = surface('metal_dark', { rough: 0.42, metal: 0.85, pat: { scales: 1.9, scratches: 0.5 } });
export const LAMELLAR = surface('leather_worn', { rough: 0.6, pat: { scales: 1.6, leather: 0.8 } });
/** worn gilt (helmets, rosettes, buckles) with hammered dents */
export const GILT = surface('gold', { rough: 0.42, pat: { scales: -0.6, scratches: 0.7, pores: 0.4 } });
/** woven wool/linen for the red cloth (soft sheen tinted by the albedo) */
export const WOVEN = surface('cloth', { rough: 0.9, sheen: 0.35, pat: { weave: 1.2 } });

/** layered, rounded shoulder plates with edge rings and an optional spike */
export function layeredPauldrons(ctx: KindContext, o: { color: number; trim?: number; mat?: SurfaceName | SurfaceSpec; trimMat?: SurfaceName | SurfaceSpec; layers?: number; size?: number; spike?: number; sides?: ('l' | 'r')[]; drop?: number }) {
  const { P } = ctx;
  const s = P.s;
  const g = Math.sqrt(P.build.bulk);
  const layers = o.layers ?? 3;
  const trim = o.trim ?? o.color;
  for (const side of o.sides ?? (['l', 'r'] as const)) {
    const sx = side === 'l' ? 1 : -1;
    const sh = P.j[`upperarm_${side}`];
    for (let k = 0; k < layers; k++) {
      const R = (0.1 - k * 0.006) * s * g * (o.size ?? 1);
      const th = Math.PI * (0.4 - k * 0.03);
      const geo = shell(R, R * 0.75, R * 1.05, { th0: 0, th1: th, w: 10, h: 4 });
      const m = new THREE.Matrix4()
        .makeTranslation(sh[0] + sx * 0.018 * s, sh[1] + (0.032 - k * (o.drop ?? 0.032)) * s, sh[2])
        .multiply(new THREE.Matrix4().makeRotationZ(-sx * (0.6 + k * 0.1)));
      put(ctx, geo, { bone: `upperarm_${side}`, color: o.color, mat: o.mat ?? 'gold', matrix: m });
      const rg = new THREE.TorusGeometry(R * 0.99, 0.0045 * s * 1.3, 3, 12).rotateX(Math.PI / 2);
      rg.scale(Math.sin(th), 1, Math.sin(th) * 1.05).translate(0, Math.cos(th) * R * 0.75, 0);
      put(ctx, rg, { bone: `upperarm_${side}`, color: trim, mat: o.trimMat ?? 'gold', matrix: m, small: true });
    }
    if (o.spike) put(ctx, spike([sh[0] + sx * 0.05 * s, sh[1] + 0.085 * s, sh[2]], [sx * 0.35, 1, 0], o.spike * s, 0.014 * s, 6), { bone: `upperarm_${side}`, color: trim, mat: o.trimMat ?? 'gold', small: true });
  }
}

/** gold neck ring (torque), arm bangles and ear rings */
export function jewelry(ctx: KindContext, o: { color?: number; neck?: boolean; arms?: number; ears?: boolean; rng?: Rng; armT?: number }) {
  const { P } = ctx;
  const s = P.s;
  const c = o.color ?? 0xb58d3d;
  if (o.neck) {
    const r = (0.066 * P.build.neckThick * Math.sqrt(P.build.bulk) + 0.012) * s;
    put(ctx, new THREE.TorusGeometry(r, 0.0075 * s, 6, 20).rotateX(Math.PI / 2 - 0.25).translate(0, P.j.neck[1] + 0.012 * s, 0.0), { bone: 'neck', color: c, mat: GILT, small: true });
  }
  for (let i = 0; i < (o.arms ?? 0); i++) {
    for (const sd of ['l', 'r'] as const) {
      const a = P.j[`forearm_${sd}`];
      const w = P.j[`hand_${sd}`];
      const t = (o.armT ?? 0.3) + i * 0.16;
      const p: V3 = [a[0] + (w[0] - a[0]) * t, a[1] + (w[1] - a[1]) * t, a[2]];
      const d: V3 = [w[0] - a[0], w[1] - a[1], 0];
      put(ctx, ring(p, d, 0.037 * s * (1 - t * 0.35), 0.0055 * s, 10), { bone: `forearm_${sd}`, color: c, mat: GILT, small: true });
    }
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

/** a short upright horsehair crest running front to back over a dome helmet (Easterling helm): rises from the brow to a
 *  peak behind the crown and falls to the nape */
export function crest(ctx: KindContext, o: { color: number; height?: number; profile: [number, number][]; y?: number; zs?: number; mat?: SurfaceName; tail?: number }) {
  const { P } = ctx;
  const u = P.headH;
  const zs = o.zs ?? 1.28;
  const prof = o.profile;
  const n = prof.length;
  const ridge: [number, number][] = []; // (z, y) in head units along the dome's centre line, front to back
  for (let i = 1; i <= n - 2; i++) ridge.push([prof[i][0] * zs - 0.06, prof[i][1] + 0.075 + (o.y ?? 0)]);
  for (let i = n - 2; i >= 1; i--) ridge.push([-prof[i][0] * zs - 0.06, prof[i][1] + 0.075 + (o.y ?? 0)]);
  const pts: V3[] = ridge.map(([z, y], i) => {
    const t = i / (ridge.length - 1);
    return P.h(0, y + 0.03 + (o.height ?? 0.2) * Math.pow(Math.sin(Math.PI * Math.min(1, t * 0.9 + 0.05)), 1.3), z);
  });
  // only the crown part of the ridge carries the horsehair
  const crownPts = pts.slice(Math.floor(pts.length * 0.22), Math.ceil(pts.length * 0.9));
  const last = crownPts[crownPts.length - 1];
  crownPts.push([last[0], last[1] - (o.tail ?? 0.06) * u, last[2] - 0.05 * u]);
  const g = taperedTube(crownPts, 0.08 * u, 0.05 * u, { seg: 12, radial: 5 });
  g.scale(0.5, 1, 1); // a blade of horsehair, not a round rope
  put(ctx, g, { bone: 'head', color: o.color, mat: o.mat ?? 'hair', small: true });
}

/** a sash/belt with gold studs */
export function studdedBand(ctx: KindContext, o: { y: number; color: number; n?: number; rx?: number; rz?: number }) {
  const { P } = ctx;
  const s = P.s;
  const rx = o.rx ?? 0.15 * s * Math.sqrt(P.build.bulk);
  const rz = o.rz ?? (0.108 * s * P.build.bulk * (1 + P.build.belly * 0.4) + 0.02 * s);
  const pts: V3[] = [];
  const n = o.n ?? 14;
  for (let i = 0; i < n; i++) {
    const a = -Math.PI * 0.8 + (i / (n - 1)) * Math.PI * 1.6;
    pts.push([Math.sin(a) * rx, o.y, Math.cos(a) * rz]);
  }
  const g = studs(pts, 0.0065 * s);
  if (g) put(ctx, g, { bone: 'hips', color: o.color, mat: GILT, small: true });
}

// ─────────────────────────────────────────────────────────────────────────────
// skinned cloth sheets (the kit's own skirt geometry with per-bucket panels and colours)
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

export interface SkirtOpts {
  color: number;
  color2?: number;
  mat?: SurfaceName | SurfaceSpec;
  /** hem height (m) */
  bottom: number;
  /** top (m); default just above the hip joints */
  top?: number;
  panels: [number, number][];
  flare?: number;
  ragged?: number;
  grow?: number;
  tatter?: number;
  strips?: { count: number; color: number; color2?: number; mat?: SurfaceName | SurfaceSpec; width: number; length: number; phase?: number };
  name?: string;
}

/** skirt / coat-tail panels from the hips down (the outfit needs a `skirt` layer with `chance: 0` so the spring bones exist).
 *  Several sheets can be passed; they are merged into one skinned mesh (one draw call). */
export function addSkirtCloth(ctx: KindContext, opts: SkirtOpts | SkirtOpts[]) {
  const { P, rig, spec } = ctx;
  const hipY = P.j.thigh_l[1];
  const list = Array.isArray(opts) ? opts : [opts];
  const geos = list.map((o) =>
    skirtGeometry(P, rig, {
      top: o.top ?? hipY + 0.035 * P.s,
      bottom: o.bottom,
      color: o.color,
      color2: o.color2,
      mat: o.mat ?? WOVEN,
      panels: o.panels,
      flare: o.flare,
      ragged: o.ragged,
      grow: o.grow,
      tatter: o.tatter,
      strips: o.strips,
      seed: spec.seed ?? 0,
    }),
  );
  const geo = geos.length === 1 ? geos[0] : mergeGeometries(geos, false);
  if (geos.length > 1) for (const g of geos) g.dispose();
  attachBodySkinned(ctx, geo, list[0].name ?? 'skirt');
}

/** radius (x, z) of the kit's skirt sheet at height y (mirrors `skirtGeometry`), to hang things on it */
export function skirtRadius(P: KindContext['P'], top: number, bottom: number, y: number, flare?: number, grow = 0): { rx: number; rz: number } {
  const s = P.s;
  const g = P.build.bulk;
  const rx0 = 0.158 * s * P.build.hips * Math.sqrt(g) + 0.012 * s + grow;
  const rz0 = 0.112 * s * Math.sqrt(g) + 0.012 * s + grow;
  const legR = 0.08 * s * g;
  const fl = flare ?? 0.04 * s;
  const rx1 = Math.max(rx0, P.hipX + legR + 0.03 * s + grow) + fl;
  const rz1 = Math.max(rz0, legR + 0.035 * s + grow) + fl * 0.8;
  const vv = Math.min(1, Math.max(0, (top - y) / (top - bottom)));
  return { rx: rx0 + (rx1 - rx0) * Math.sqrt(vv), rz: rz0 + (rz1 - rz0) * Math.sqrt(vv) - 0.01 * s };
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
export function surfaceMatrix(proj: Projector, x: number, y: number, lift: number, up = V(0, 1, 0)): THREE.Matrix4 | null {
  const hp = V();
  const hn = V();
  if (!snapPoint(proj, [x, y, 0.4], 'f', hp, hn)) return null;
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
