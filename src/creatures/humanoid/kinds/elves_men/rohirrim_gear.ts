/**
 * Rigid straps, plates, hair and cloth trim for the Rohirrim and the Lake-town man, placed from the
 * anatomy section ellipses (independent of the 6 cm body mesh, which cannot hold a 3 cm strap).
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
import { mergeAll, put, torsoSection, tube } from './geo';

/**
 * Hem panels hanging from the hips (a copy of `addSkirt` with a `grow` that can be negative, so an
 * outer torso garment sculpted over the hips reads as the outer layer instead of the cloth panels
 * covering it from the belt down). `trim` adds a crisp strip of another colour along the hem: the
 * cloth sheet only fades colours over a whole row (~4 cm), so the strip is built from the sheet's
 * own bottom two vertex rows (same skin weights, so it swings with the skirt).
 */
export function addHemSkirt(ctx: KindContext, o: { top: number; bottom: number; color: number; color2?: number; mat?: SurfaceName | SurfaceSpec; flare?: number; grow?: number; ragged?: number; panels?: [number, number][]; trim?: { color: number; height: number } }) {
  if (devSkip('skirt')) return;
  const geo = skirtGeometry(ctx.P, ctx.rig, { top: o.top, bottom: o.bottom, color: o.color, color2: o.color2, mat: o.mat ?? 'cloth', panels: o.panels ?? SKIRT_PANELS, flare: o.flare, grow: o.grow, ragged: o.ragged, seed: ctx.spec.seed ?? 0 });
  attachSkinned(ctx, geo, 'body', { small: false, name: 'skirt' });
  if (o.trim) {
    const strip = hemStrip(geo, o.bottom, o.trim.height, o.trim.color);
    if (strip) attachSkinned(ctx, strip, 'body', { small: true, name: 'skirt-trim' });
  }
}

/** a strip `height` tall above the lowest vertex row of a cloth sheet, in `color`, copying every vertex attribute */
function hemStrip(src: THREE.BufferGeometry, bottomY: number, height: number, color: number): THREE.BufferGeometry | null {
  const pos = src.getAttribute('position');
  const n = pos.count;
  // bottom-row vertices come in runs of consecutive indices (one run per panel); the row above is the run before it
  const isBottom = (i: number) => Math.abs(pos.getY(i) - bottomY) < 0.0015;
  const runs: [number, number][] = [];
  for (let i = 0; i < n; ) {
    if (!isBottom(i)) {
      i++;
      continue;
    }
    let j = i;
    while (j + 1 < n && isBottom(j + 1)) j++;
    runs.push([i, j]);
    i = j + 1;
  }
  if (!runs.length) return null;
  const names = Object.keys(src.attributes).filter((k) => k !== 'normal');
  const out = new THREE.BufferGeometry();
  const data: Record<string, number[]> = {};
  for (const k of names) data[k] = [];
  const idx: number[] = [];
  const c = new THREE.Color().setHex(color, THREE.SRGBColorSpace);
  let base = 0;
  for (const [r0, r1] of runs) {
    const w = r1 - r0 + 1;
    if (r0 - w < 0) continue;
    const dy = pos.getY(r0 - w) - bottomY;
    const f = Math.min(1, height / Math.max(1e-4, dy));
    for (let col = 0; col < w; col++) {
      const lo = r0 + col;
      const hi = lo - w;
      for (const k of names) {
        const a = src.getAttribute(k);
        for (let t = 0; t < a.itemSize; t++) data[k].push(a.array[lo * a.itemSize + t]);
      }
      // the upper vertex: interpolated position, bottom-row everything else
      for (const k of names) {
        const a = src.getAttribute(k);
        const from = k === 'skinIndex' || k === 'skinWeight' ? (f > 0.5 ? hi : lo) : lo;
        if (k === 'position') {
          // a millimetre or two outward (away from the skirt's axis) so the strip does not z-fight with the cloth
          const px = a.array[lo * 3] + (a.array[hi * 3] - a.array[lo * 3]) * f;
          const pz = a.array[lo * 3 + 2] + (a.array[hi * 3 + 2] - a.array[lo * 3 + 2]) * f;
          const r = Math.hypot(px, pz + 0.01) || 1;
          data[k].push(px + (px / r) * 0.0025, a.array[lo * 3 + 1] + (a.array[hi * 3 + 1] - a.array[lo * 3 + 1]) * f, pz + ((pz + 0.01) / r) * 0.0025);
        } else for (let t = 0; t < a.itemSize; t++) data[k].push(a.array[from * a.itemSize + t]);
      }
      if (col + 1 < w) {
        const a0 = base + col * 2;
        idx.push(a0, a0 + 2, a0 + 1, a0 + 1, a0 + 2, a0 + 3);
      }
    }
    base += w * 2;
  }
  if (!base) return null;
  for (const k of names) {
    const a = src.getAttribute(k);
    const arr = a.array instanceof Uint16Array ? new Uint16Array(data[k]) : new Float32Array(data[k]);
    out.setAttribute(k, new THREE.BufferAttribute(arr, a.itemSize));
  }
  const col = out.getAttribute('color');
  for (let i = 0; i < col.count; i++) col.setXYZ(i, c.r, c.g, c.b);
  out.setIndex(idx);
  out.computeVertexNormals();
  return out;
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
  return ribbonFrom(
    pts.map((q) => q.p),
    pts.map((q) => q.n),
    pts.map(() => width),
  );
}

/** a ribbon along `centres`: width per point, facing `normals` (the visible side) */
function ribbonFrom(centres: THREE.Vector3[], normals: THREE.Vector3[], widths: number[]): THREE.BufferGeometry {
  const pos: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i < centres.length; i++) {
    const a = centres[Math.max(0, i - 1)];
    const b = centres[Math.min(centres.length - 1, i + 1)];
    const t = b.clone().sub(a).normalize();
    const sd = new THREE.Vector3().crossVectors(normals[i], t).normalize();
    for (const k of [-1, 1]) {
      const v = centres[i].clone().addScaledVector(sd, (k * widths[i]) / 2);
      pos.push(v.x, v.y, v.z);
    }
  }
  for (let i = 0; i + 1 < centres.length; i++) {
    const a = i * 2;
    const b = a + 2;
    // wind so that the face normal points toward `normals`
    const e1 = new THREE.Vector3(pos[b * 3] - pos[a * 3], pos[b * 3 + 1] - pos[a * 3 + 1], pos[b * 3 + 2] - pos[a * 3 + 2]);
    const e2 = new THREE.Vector3(pos[(a + 1) * 3] - pos[a * 3], pos[(a + 1) * 3 + 1] - pos[a * 3 + 1], pos[(a + 1) * 3 + 2] - pos[a * 3 + 2]);
    const fn = new THREE.Vector3().crossVectors(e1, e2);
    if (fn.dot(normals[i]) >= 0) idx.push(a, b, a + 1, a + 1, b, b + 1);
    else idx.push(a, a + 1, b, a + 1, b + 1, b);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** a tapered wavy ribbon (a lock of hair) from a to b: a sine wave sideways, wider at the root, facing `nrm` */
function lockRibbon(a: V3, b: V3, nrm: V3, width: number, amp: number, periods = 1.4, n = 5): THREE.BufferGeometry {
  const A = new THREE.Vector3(...a);
  const B = new THREE.Vector3(...b);
  const N = new THREE.Vector3(...nrm).normalize();
  const dir = B.clone().sub(A).normalize();
  const side = new THREE.Vector3().crossVectors(N, dir).normalize();
  const centres: THREE.Vector3[] = [];
  const normals: THREE.Vector3[] = [];
  const widths: number[] = [];
  for (let i = 0; i < n; i++) {
    const f = i / (n - 1);
    centres.push(A.clone().lerp(B, f).addScaledVector(side, Math.sin(f * Math.PI * 2 * periods) * amp * (0.35 + 0.65 * f)));
    normals.push(N);
    widths.push(width * (1 - 0.55 * f * f));
  }
  return ribbonFrom(centres, normals, widths);
}

/**
 * Hair under a helm. The kit's strand cards are combed over the crown and poke through any dome,
 * so a helmed head gets sculpted hair instead: a short fall over the nape (sculpted into the body)
 * plus a few wide overlapping wavy ribbons (rigid gear on the chest bone) that fall from under the
 * helm over the back as one golden-brown mass and lie on the shoulders in front of the ears
 * (docs/refs/rohirrim: waves to the shoulder blades).
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
  const zb = (y: number) => torsoSection(P, y).zb;
  const zc = (y: number) => (torsoSection(P, y).zf + torsoSection(P, y).zb) / 2;
  const locks: THREE.BufferGeometry[] = [];
  // down the back: three overlapping ribbons (~5 cm) from the nape to the shoulder blades, layered 4 mm apart
  const yEnd = ny - (0.1 + 0.05 * len) * sc;
  [-1, 0, 1].forEach((k, i) => {
    const z = zb(yEnd) - (0.034 + 0.004 * i) * sc;
    locks.push(lockRibbon(P.h(k * 0.14, -0.3, -0.37 - 0.01 * i), [k * 0.045 * sc, yEnd + (k === 0 ? 0 : 0.02 * sc), z], [0, 0, -1], 0.052 * sc, 0.011 * sc * (k === 0 ? -1 : 1)));
  });
  // beside the face and onto the shoulder tops, the wave mirrored by side
  for (const sx of [1, -1]) {
    const e1: V3 = [sx * 0.15 * sc, ny - 0.045 * sc, zc(ny - 0.045 * sc) + 0.012 * sc];
    const e2: V3 = [sx * 0.19 * sc, ny - 0.075 * sc, zc(ny - 0.075 * sc) - 0.02 * sc];
    locks.push(lockRibbon(P.h(sx * 0.37, -0.22, -0.02), e1, [sx * 0.7, 0.35, 0.5], 0.04 * sc, 0.008 * sc * sx));
    locks.push(lockRibbon(P.h(sx * 0.35, -0.2, -0.12), e2, [sx * 0.7, 0.35, 0.4], 0.04 * sc, -0.008 * sc * sx));
  }
  put(ctx, mergeAll(locks), { bone: 'chest', color: o.color, mat: 'hair', small: true });
}

/**
 * Short curls at the ears and the nape under a knit cap, from under the brim to the collar: a
 * ragged lobe at the back and a curl at each ear, sculpted into the head.
 */
export function sculptCapCurls(ctx: KindContext, o: { color: number; color2: number }) {
  const { P, sculpt: s } = ctx;
  const sc = P.s;
  const u = P.headH;
  const noise = { amp: 0.0035 * sc, freq: 70 / sc, type: 'ridged' as const, octaves: 2 };
  const base = { color: o.color, color2: o.color2, colorNoise: 0.5, colorFreq: 60 / sc, mat: 'hair' as const, bone: 'head', noise };
  s.group('union', 0.015 * u, () => {
    s.with(base, () => {
      // back lobe: reaches about 1.52 m (bottom ~0.37 head units below the head centre), clear of the collar
      s.ellipsoid(P.h(0, -0.2, -0.4), [0.3 * u, 0.17 * u, 0.12 * u], { k: 0.015 * u });
      s.mirrored(() => {
        // curls pushed out beside each ear, down to jaw level, and a tuft behind it
        s.ellipsoid(P.h(0.355, -0.14, -0.06), [0.06 * u, 0.2 * u, 0.12 * u], { k: 0.015 * u });
        s.ellipsoid(P.h(0.25, -0.2, -0.34), [0.1 * u, 0.15 * u, 0.1 * u], { k: 0.015 * u });
      });
    });
  });
}

/**
 * A thin flat mantle (hood worn down) over the shoulder tops, in a thin sculpted layer: trapezius,
 * upper chest and upper back only (the mail covers the shoulders and arms), cut flat below `y0`, with
 * a short hood drape at the back and a rolled collar at the base of the neck.
 */
export function sculptMantle(ctx: KindContext, o: { color: number; color2?: number; mat?: SurfaceName | SurfaceSpec; inflate: number; y0: number }) {
  const { P, sculpt: s } = ctx;
  const sc = P.s;
  const parts = anatomyParts(P);
  const mat = o.mat ?? 'wool';
  s.group('union', 0.008 * sc, () => {
    emitParts(s, parts, ['trap', 'chest', 'back'], { color: o.color, color2: o.color2, colorNoise: o.color2 !== undefined ? 0.25 : 0, colorFreq: 30 / sc, mat, inflate: o.inflate, k: 0.02 * sc });
    slab(s, o.y0, null, 0.006 * sc, true);
    // a short hood drape lying on the upper back
    const ny = P.j.neck[1];
    const yd = ny - 0.07 * sc;
    s.ellipsoid([0, yd, torsoSection(P, yd).zb - 0.01 * sc], [0.1 * sc, 0.055 * sc, 0.03 * sc], { color: o.color, mat, bone: 'chest', k: 0.02 * sc });
  });
  // the rolled collar round the base of the neck (~3 cm)
  const ny = P.j.neck[1];
  const pts: V3[] = [];
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    pts.push([Math.sin(a) * 0.085 * sc * P.build.neckThick, ny - 0.012 * sc + Math.cos(a) * 0.004 * sc, -0.012 * sc + Math.cos(a) * 0.08 * sc * Math.sqrt(P.build.neckThick)]);
  }
  put(ctx, tube(pts, 0.015 * sc, { seg: 10, radial: 3, closed: true }), { bone: 'neck', color: o.color, mat, small: true });
}
