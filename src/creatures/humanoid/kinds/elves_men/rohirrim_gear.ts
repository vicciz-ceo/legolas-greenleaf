/**
 * Rigid straps, plates and hair for the Rohirrim and the Lake-town man, placed from the anatomy
 * section ellipses (independent of the 6 cm body mesh, which cannot hold a 3 cm strap).
 */
import * as THREE from 'three';
import type { Proportions } from '../../proportions';
import type { SurfaceName, SurfaceSpec } from '../../../kit/surfaces';
import type { V3 } from '../../../kit/sdf';
import type { KindContext } from '../../types';
import { skirtGeometry } from '../../cloth';
import { anatomyParts, emitParts } from '../../anatomy';
import { SKIRT_PANELS } from './cloth';
import { attachSkinned, devSkip } from './common';
import { slab } from './garments';
import { mergeAll, put, taperedTube, torsoSection } from './geo';

/**
 * Hem panels hanging from the hips (a copy of `addSkirt` with a `grow` that can be negative, so an
 * outer torso garment sculpted over the hips reads as the outer layer instead of the cloth panels
 * covering it from the belt down).
 */
export function addHemSkirt(ctx: KindContext, o: { top: number; bottom: number; color: number; color2?: number; mat?: SurfaceName | SurfaceSpec; flare?: number; grow?: number; ragged?: number; panels?: [number, number][] }) {
  if (devSkip('skirt')) return;
  const geo = skirtGeometry(ctx.P, ctx.rig, { top: o.top, bottom: o.bottom, color: o.color, color2: o.color2, mat: o.mat ?? 'cloth', panels: o.panels ?? SKIRT_PANELS, flare: o.flare, grow: o.grow, ragged: o.ragged, seed: ctx.spec.seed ?? 0 });
  attachSkinned(ctx, geo, 'body', { small: false, name: 'skirt' });
}

/** point on the torso surface at height y, for x across the chest; side +1 front, -1 back; `off` pushes it out */
export function torsoSurface(P: Proportions, x: number, y: number, side: 1 | -1, off: number): { p: THREE.Vector3; n: THREE.Vector3 } {
  const sec = torsoSection(P, y);
  const zc = (sec.zf + sec.zb) / 2;
  const hd = (sec.zf - sec.zb) / 2;
  const q = Math.max(-0.97, Math.min(0.97, x / sec.rx));
  const c = Math.sqrt(1 - q * q);
  const n = new THREE.Vector3(q / sec.rx, 0, (side * c) / hd).normalize();
  const p = new THREE.Vector3(x, y, zc + side * hd * c).addScaledVector(n, off);
  return { p, n };
}

/** a flat ribbon hugging the torso along a path of (x, y) pairs on the front or back */
export function torsoRibbon(P: Proportions, path: [number, number][], side: 1 | -1, width: number, off: number): THREE.BufferGeometry {
  const pts = path.map(([x, y]) => torsoSurface(P, x, y, side, off));
  const pos: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)].p;
    const b = pts[Math.min(pts.length - 1, i + 1)].p;
    const t = b.clone().sub(a).normalize();
    const sd = new THREE.Vector3().crossVectors(pts[i].n, t).normalize();
    for (const k of [-1, 1]) {
      const v = pts[i].p.clone().addScaledVector(sd, (k * width) / 2);
      pos.push(v.x, v.y, v.z);
    }
  }
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = i * 2;
    const b = a + 2;
    // wind so that the face normal points away from the torso
    const e1 = new THREE.Vector3(pos[b * 3] - pos[a * 3], pos[b * 3 + 1] - pos[a * 3 + 1], pos[b * 3 + 2] - pos[a * 3 + 2]);
    const e2 = new THREE.Vector3(pos[(a + 1) * 3] - pos[a * 3], pos[(a + 1) * 3 + 1] - pos[a * 3 + 1], pos[(a + 1) * 3 + 2] - pos[a * 3 + 2]);
    const fn = new THREE.Vector3().crossVectors(e1, e2);
    if (fn.dot(pts[i].n) >= 0) idx.push(a, b, a + 1, a + 1, b, b + 1);
    else idx.push(a, a + 1, b, a + 1, b + 1, b);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/**
 * Hair under a helm. The kit's strand cards are combed over the crown and poke through any dome,
 * so a helmed head gets sculpted locks instead: a short fall over the nape (sculpted into the body)
 * plus wavy tapered locks (rigid gear on the chest bone) that fall from under the helm over the
 * back and lie on the mail shoulders (docs/refs/rohirrim: waves to the shoulders and upper back).
 */
export function sculptHelmHair(ctx: KindContext, o: { color: number; color2: number; length?: number }) {
  const { P, sculpt: s } = ctx;
  const sc = P.s;
  const u = P.headH;
  const len = o.length ?? 1;
  const base = { color: o.color, color2: o.color2, colorNoise: 0.5, colorFreq: 60 / sc, mat: 'hair' as const };
  s.group('union', 0.02 * u, () => {
    s.with({ ...base, bone: 'head' }, () => {
      s.ellipsoid(P.h(0, -0.24, -0.3), [0.29 * u, 0.2 * u, 0.15 * u], { k: 0.02 * u });
      s.mirrored(() => s.ellipsoid(P.h(0.335, -0.3, -0.04), [0.06 * u, 0.26 * u, 0.11 * u], { k: 0.02 * u }));
    });
  });
  const ny = P.j.neck[1];
  const wave = (a: V3, b: V3, amp: number, n = 5): V3[] => {
    const pts: V3[] = [];
    for (let i = 0; i < n; i++) {
      const f = i / (n - 1);
      pts.push([a[0] + (b[0] - a[0]) * f + Math.sin(f * Math.PI * 2.2) * amp, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f + Math.cos(f * Math.PI * 2.2) * amp * 0.5]);
    }
    return pts;
  };
  const locks: THREE.BufferGeometry[] = [];
  const lock = (a: V3, b: V3, amp: number, r0: number) => locks.push(taperedTube(wave(a, b, amp), r0, r0 * 0.4, { seg: 5, radial: 3 }));
  const zb = (y: number) => torsoSection(P, y).zb;
  const zc = (y: number) => (torsoSection(P, y).zf + torsoSection(P, y).zb) / 2;
  // down the back: three locks from the nape to the shoulder blades, over the mantle
  const yEnd = ny - (0.1 + 0.05 * len) * sc;
  for (const [x0, x1, amp] of [[-0.12, -0.15, 0.008], [0, 0.0, -0.007], [0.12, 0.15, 0.008]] as [number, number, number][]) {
    lock(P.h(x0 * 1.2, -0.3, -0.37), [x1 * sc, yEnd, zb(yEnd) - 0.036 * sc], amp * sc, 0.019 * sc);
  }
  // beside the face and onto the shoulder tops
  for (const sx of [1, -1]) {
    lock(P.h(sx * 0.37, -0.22, -0.02), [sx * 0.15 * sc, ny - 0.045 * sc, zc(ny - 0.045 * sc) + 0.012 * sc], 0.007 * sc, 0.017 * sc);
    lock(P.h(sx * 0.35, -0.2, -0.12), [sx * 0.19 * sc, ny - 0.075 * sc, zc(ny - 0.075 * sc) - 0.02 * sc], -0.007 * sc, 0.016 * sc);
  }
  put(ctx, mergeAll(locks), { bone: 'chest', color: o.color, mat: 'hair', small: true });
}

/**
 * Short curls at the ears and the nape under a knit cap (they stop above the collar): small
 * ellipsoids sculpted into the head, nothing hanging on the back.
 */
export function sculptCapCurls(ctx: KindContext, o: { color: number; color2: number }) {
  const { P, sculpt: s } = ctx;
  const sc = P.s;
  const u = P.headH;
  const base = { color: o.color, color2: o.color2, colorNoise: 0.5, colorFreq: 60 / sc, mat: 'hair' as const, bone: 'head' };
  s.group('union', 0.012 * u, () => {
    s.with(base, () => {
      s.ellipsoid(P.h(0, -0.2, -0.33), [0.26 * u, 0.11 * u, 0.09 * u], { k: 0.012 * u });
      s.mirrored(() => {
        s.ellipsoid(P.h(0.3, -0.08, -0.2), [0.07 * u, 0.09 * u, 0.09 * u], { k: 0.012 * u });
        s.ellipsoid(P.h(0.2, -0.17, -0.3), [0.07 * u, 0.08 * u, 0.07 * u], { k: 0.012 * u });
      });
    });
  });
}

/**
 * A thin flat mantle (hood worn down) over the shoulder tops: the torso's trapezius, deltoid and
 * upper chest/back parts inflated a little more than the body armour and cut flat below `y0`.
 */
export function sculptMantle(ctx: KindContext, o: { color: number; color2?: number; mat?: SurfaceName | SurfaceSpec; inflate: number; y0: number }) {
  const { P, sculpt: s } = ctx;
  const sc = P.s;
  const parts = anatomyParts(P);
  s.group('union', 0.008 * sc, () => {
    emitParts(s, parts, ['trap', 'deltoid', 'chest', 'back', 'ribs'], { color: o.color, color2: o.color2, colorNoise: o.color2 !== undefined ? 0.25 : 0, colorFreq: 30 / sc, mat: o.mat ?? 'wool', inflate: o.inflate, k: 0.02 * sc });
    slab(s, o.y0, null, 0.006 * sc, true);
  });
}
