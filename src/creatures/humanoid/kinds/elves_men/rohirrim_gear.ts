/**
 * Rigid straps and plates on the torso for the Rohirrim, placed from the anatomy section ellipses
 * (independent of the 6 cm body mesh, which cannot hold a 3 cm strap).
 */
import * as THREE from 'three';
import type { Proportions } from '../../proportions';
import type { SurfaceName, SurfaceSpec } from '../../../kit/surfaces';
import type { KindContext } from '../../types';
import { skirtGeometry } from '../../cloth';
import { SKIRT_PANELS } from './cloth';
import { attachSkinned, devSkip } from './common';
import { torsoSection } from './geo';

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
 * Hair under a helm: the kit's strand cards are combed over the crown and poke through any dome,
 * so a helmed head gets sculpted locks instead: a fall over the nape and down the back, and a lock
 * on each side of the face behind the cheek plates (docs/refs/rohirrim: long waves to the shoulders).
 */
export function sculptHelmHair(ctx: KindContext, o: { color: number; color2: number; length?: number }) {
  const { P, sculpt: s } = ctx;
  const sc = P.s;
  const u = P.headH;
  const len = o.length ?? 1;
  const base = { color: o.color, color2: o.color2, colorNoise: 0.55, colorFreq: 60 / sc, mat: 'hair' as const };
  const sec = torsoSection(P, P.j.neck[1] - 0.05 * sc);
  s.group('union', 0.02 * u, () => {
    s.with({ ...base, bone: 'head' }, () => {
      s.ellipsoid(P.h(0, -0.22, -0.3), [0.3 * u, 0.2 * u, 0.16 * u], { k: 0.02 * u });
      s.mirrored(() => s.ellipsoid(P.h(0.335, -0.3, -0.04), [0.065 * u, 0.28 * u, 0.12 * u], { k: 0.02 * u }));
    });
    s.with({ ...base, bone: 'neck' }, () => {
      const y = P.j.neck[1] - 0.045 * sc * len;
      s.ellipsoid([0, y, sec.zb - 0.045 * sc], [0.105 * sc, 0.1 * sc * len, 0.05 * sc], { k: 0.025 * u });
    });
  });
}
