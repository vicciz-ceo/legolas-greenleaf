/**
 * Sculpted clothing: each garment re-emits anatomy parts inflated with its own material, inside a
 * group cut by planes (hems, sleeve ends, boot tops), unioned onto the body with a tight blend so
 * the hem reads as a separate layer.
 */
import * as THREE from 'three';
import type { PrimOpts, Sculpt, V3 } from '../kit/sdf';
import type { SurfaceName, SurfaceSpec } from '../kit/surfaces';
import { emitParts, type Part, type PartTag } from './anatomy';
import type { Proportions } from './proportions';
import type { OutfitLayer, ResolvedKind } from './types';
import type { Rng } from '../../core/rng';

export interface OutfitResult {
  /** cloth panels to add as separate skinned layers */
  skirt?: { top: number; bottom: number; color: number; color2?: number; mat: SurfaceName | SurfaceSpec; panels: [number, number][]; ragged?: number };
  cloak?: { color: number; color2?: number; mat: SurfaceName | SurfaceSpec; length: number; ragged?: number };
  /** the hair is covered (hood/helmet) */
  hood?: boolean;
  /** heights of the belt (for buckles) */
  beltY?: number;
}

const TORSO: PartTag[] = ['pelvis', 'waist', 'belly', 'ribs', 'chest', 'pecs', 'back', 'trap', 'glutes', 'thigh'];
const UPPER: PartTag[] = ['waist', 'belly', 'ribs', 'chest', 'pecs', 'back', 'trap'];
const LEGS: PartTag[] = ['thigh', 'knee', 'shin', 'calf'];

/** keep y in [y0, y1] (soft edges k); `seams` also marks both edges for stitching / edge wear */
function slab(s: Sculpt, y0: number | null, y1: number | null, k: number, seams = false) {
  if (y1 !== null) s.plane([0, 1, 0], y1, { op: 'intersect', k });
  if (y0 !== null) s.plane([0, -1, 0], -y0, { op: 'intersect', k });
  if (seams) {
    if (y1 !== null) s.plane([0, 1, 0], y1, { op: 'paint', seam: 0, k: 0.002 });
    if (y0 !== null) s.plane([0, -1, 0], -y0, { op: 'paint', seam: 0, k: 0.002 });
  }
}

/** stitched / worn edge along a plane (call inside the garment's group so only it is affected) */
function seamPlane(s: Sculpt, n: V3, d: number) {
  s.plane(n, d, { op: 'paint', seam: 0, k: 0.002 });
}

/** keep the part of a limb beyond `at` along direction L (left side; mirrored for right) */
function limbCut(s: Sculpt, L: THREE.Vector3, at: V3, keepBeyond: boolean, k: number, seam = false) {
  const n = keepBeyond ? L.clone().multiplyScalar(-1) : L.clone();
  const d = n.x * at[0] + n.y * at[1] + n.z * at[2];
  s.plane([n.x, n.y, n.z], d, { op: 'intersect', k });
  if (seam) seamPlane(s, [n.x, n.y, n.z], d);
}

export function sculptOutfit(s: Sculpt, P: Proportions, parts: Part[], def: ResolvedKind, rng: Rng): OutfitResult {
  const res: OutfitResult = {};
  const sc = P.s;
  const j = P.j;
  const hipY = j.thigh_l[1];
  const kneeY = j.shin_l[1];
  const L = P.hand.l.L;
  const layers = def.outfit.filter((l) => l.chance === undefined || rng.float() < l.chance);
  const order: OutfitLayer['type'][] = [
    'leggings', 'trousers', 'wraps', 'shoes', 'boots', 'gloves', 'shirt', 'gambeson', 'tunic', 'rags', 'mail_shirt', 'robe',
    'jerkin', 'vest', 'bracers', 'scarf', 'collar', 'belt', 'sash', 'fur_mantle', 'hood', 'loincloth', 'skirt', 'cloak',
  ];
  layers.sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type));
  for (const l of layers) {
    const t = l.thickness ?? 0;
    const mat = (m: SurfaceName): SurfaceName | SurfaceSpec => l.mat ?? m;
    const base = (m: SurfaceName, extra: PrimOpts = {}): PrimOpts => ({ color: l.color, mat: mat(m), ...extra });
    const tight = 0.0035 * sc;
    switch (l.type) {
      case 'leggings':
      case 'trousers': {
        const inf = (l.type === 'leggings' ? 0.0045 : 0.011) * sc + t;
        s.group('union', tight, () => {
          emitParts(s, parts, [...LEGS, 'glutes', 'pelvis', 'waist', 'belly'], { ...base('cloth'), inflate: inf });
          slab(s, P.ankleH + 0.02 * sc, hipY + 0.14 * sc, 0.01 * sc);
        });
        break;
      }
      case 'wraps': {
        s.group('union', tight, () => {
          emitParts(s, parts, ['shin', 'calf'], { ...base('rags', { k: 0.02 * sc, noise: { amp: 0.0025 * sc, freq: 60 / sc, type: 'ridged' } }), inflate: 0.006 * sc + t });
          slab(s, P.ankleH, kneeY - 0.05 * sc, 0.008 * sc);
        });
        s.mirrored(() =>
          s.group('union', tight, () => {
            emitParts(s, parts, ['forearm'], { ...base('rags', { k: 0.02 * sc, noise: { amp: 0.002 * sc, freq: 70 / sc, type: 'ridged' } }), inflate: 0.005 * sc + t, oneSide: true });
            limbCut(s, L, [P.j.forearm_l[0] + L.x * P.foreArm * 0.2, P.j.forearm_l[1] + L.y * P.foreArm * 0.2, P.j.forearm_l[2]], true, 0.01 * sc);
          }),
        );
        break;
      }
      case 'shoes':
      case 'boots': {
        const top = l.type === 'shoes' ? P.ankleH + 0.03 * sc : P.ankleH + (kneeY - P.ankleH) * (l.length ?? 0.82);
        const inf = 0.0085 * sc + t;
        s.group('union', tight, () => {
          emitParts(s, parts, ['foot', 'toes'], { ...base('leather', { k: 0.03 * sc }), inflate: inf });
          emitParts(s, parts, ['shin', 'calf'], { ...base('leather', { k: 0.03 * sc }), inflate: inf + 0.002 * sc });
          slab(s, null, top, 0.006 * sc, l.type === 'boots');
        });
        // sole
        s.mirrored(() => {
          const f = j.foot_l;
          const toe = j.toe_l;
          s.box([f[0] + 0.004 * sc, 0.009 * sc, (f[2] + toe[2]) / 2 + 0.02 * sc], [0.05 * sc * P.build.footSize, 0.009 * sc, P.footLen * 0.53], 0.008 * sc, {
            color: l.color2 ?? 0x241a12,
            mat: 'leather_worn',
            bone: 'foot_l',
            bone2: 'toe_l',
            blendAxis: [[0, 0, f[2]], [0, 0, toe[2] + 0.02 * sc]],
            blend: [0.5, 0.8],
            k: 0.006 * sc,
          });
          if (l.type === 'boots') {
            // folded cuff at the top
            const cy = top - 0.012 * sc;
            const kr = 0.047 * sc * P.build.bulk + inf;
            s.torus([j.shin_l[0] - 0.0 * sc, cy, j.shin_l[2] - 0.008 * sc], kr + 0.004 * sc, 0.0085 * sc, { color: l.color2 ?? l.color, mat: mat('leather'), bone: 'shin_l', k: 0.006 * sc });
          }
        });
        break;
      }
      case 'gloves': {
        s.group('union', tight, () => {
          emitParts(s, parts, ['hand', 'fingers', 'thumb'], { ...base('leather'), inflate: 0.0028 * sc + t });
        });
        break;
      }
      case 'shirt':
      case 'tunic':
      case 'gambeson':
      case 'rags':
      case 'robe':
      case 'mail_shirt': {
        const m: SurfaceName = l.type === 'mail_shirt' ? 'mail' : l.type === 'rags' ? 'rags' : l.type === 'gambeson' ? 'cloth' : 'cloth';
        const inf = (l.type === 'gambeson' ? 0.018 : l.type === 'mail_shirt' ? 0.012 : 0.0065) * sc + t;
        const noise = l.type === 'rags' ? { amp: 0.004 * sc, freq: 25 / sc, type: 'ridged' as const, octaves: 2 } : l.type === 'gambeson' ? { amp: 0.003 * sc, freq: 18 / sc, type: 'ridged' as const, octaves: 2 } : undefined;
        const sleeve = l.type === 'rags' ? 0.4 : l.type === 'mail_shirt' ? 0.5 : 1;
        // ONE group for torso + neck + both sleeves, so the garment's smooth blends mirror the
        // skin's (separate groups leave the skin's shoulder/neck bulges poking through).
        const neckTop = j.neck[1] + 0.03 * sc;
        const sleeveParts: PartTag[] = sleeve >= 1 ? ['deltoid', 'upperarm', 'forearm'] : ['deltoid', 'upperarm'];
        s.group('union', tight, () => {
          emitParts(s, parts, [...TORSO, 'neck'], { ...base(m, { noise }), inflate: inf });
          emitParts(s, parts, sleeveParts, { ...base(m, { noise }), inflate: inf * 0.85 });
          slab(s, hipY - 0.03 * sc, neckTop, 0.008 * sc);
          if (l.type !== 'rags' && l.type !== 'mail_shirt') seamPlane(s, [0, 1, 0], neckTop);
          // sleeve ends ("keep not beyond" cuts are compatible across sides)
          const hemmed = l.type !== 'rags' && l.type !== 'mail_shirt';
          s.mirrored(() => {
            if (sleeve < 1) limbCut(s, L, [P.j.upperarm_l[0] + L.x * P.upperArm * sleeve, P.j.upperarm_l[1] + L.y * P.upperArm * sleeve, P.j.upperarm_l[2]], false, 0.008 * sc, hemmed);
            else limbCut(s, L, [P.j.hand_l[0] - L.x * 0.012 * sc, P.j.hand_l[1] - L.y * 0.012 * sc, P.j.hand_l[2]], false, 0.006 * sc, hemmed);
          });
        });
        if (l.type !== 'shirt' && (l.length ?? 0.4) > 0.05) {
          const len = l.type === 'robe' ? 1 : l.length ?? 0.4;
          const bottom = l.type === 'robe' ? P.ankleH + 0.04 * sc : hipY - (hipY - kneeY) * len * 1.05;
          const panels: [number, number][] =
            l.type === 'robe'
              ? [[-Math.PI * 0.98, -0.12], [0.12, Math.PI * 0.98]]
              : [[-0.62, 0.62], [0.75, 2.35], [2.45, 3.83], [3.93, 5.53]];
          res.skirt = { top: hipY + 0.035 * sc, bottom, color: l.color, color2: l.color2, mat: mat(m), panels, ragged: l.type === 'rags' ? 0.05 * sc : undefined };
        }
        // collar trim ring at the neckline
        if (l.type !== 'rags') {
          s.group('union', 0.003 * sc, () => {
            emitParts(s, parts, ['neck', 'trap'], { ...base(m), color: l.color2 ?? l.color, inflate: inf + 0.003 * sc });
            slab(s, neckTop - 0.018 * sc, neckTop, 0.004 * sc);
          });
        }
        break;
      }
      case 'jerkin':
      case 'vest': {
        const inf = 0.014 * sc + t;
        s.group('union', 0.0025 * sc, () => {
          emitParts(s, parts, [...UPPER, 'pelvis', 'glutes', 'thigh', 'neck'], { ...base(l.type === 'jerkin' ? 'suede' : 'leather'), inflate: inf });
          slab(s, hipY + (l.length !== undefined ? -0.08 * l.length * sc : 0.02 * sc), j.neck[1] + 0.04 * sc, 0.005 * sc, true);
          // arm holes: the plane leans outward downward, so the vest opens at the shoulder joint
          // only and still wraps the ribs fully below the armpit
          const an = new THREE.Vector3(1, 0.42, 0).normalize();
          const ap: V3 = [P.shoulderX * 0.9, j.upperarm_l[1] - 0.01 * sc, 0];
          const ad = an.x * ap[0] + an.y * ap[1];
          s.mirrored(() => {
            s.plane([an.x, an.y, 0], ad, { op: 'intersect', k: 0.008 * sc });
            seamPlane(s, [an.x, an.y, 0], ad);
          });
        });

        break;
      }
      case 'bracers': {
        const inf = 0.0095 * sc + t;
        s.mirrored(() =>
          s.group('union', 0.002 * sc, () => {
            emitParts(s, parts, ['forearm'], { ...base('leather', { k: 0.02 * sc }), inflate: inf, oneSide: true });
            limbCut(s, L, [P.j.hand_l[0] - L.x * 0.008 * sc, P.j.hand_l[1] - L.y * 0.008 * sc, P.j.hand_l[2]], false, 0.004 * sc, true);
            limbCut(s, L, [P.j.forearm_l[0] + L.x * P.foreArm * 0.3, P.j.forearm_l[1] + L.y * P.foreArm * 0.3, P.j.forearm_l[2]], true, 0.004 * sc, true);
          }),
        );
        // (edges are stitched and worn via the seam channel; thin tooled rings alias at body resolution)
        break;
      }
      case 'belt':
      case 'sash': {
        const y = hipY + 0.07 * sc;
        res.beltY = y;
        const hw = (l.type === 'sash' ? 0.045 : 0.021) * sc;
        s.group('union', 0.002 * sc, () => {
          emitParts(s, parts, ['pelvis', 'waist', 'belly', 'glutes', 'thigh'], { ...base(l.type === 'sash' ? 'cloth' : 'leather'), inflate: 0.02 * sc + t });
          slab(s, y - hw, y + hw, 0.003 * sc, l.type === 'belt');
        });
        break;
      }
      case 'collar':
      case 'scarf': {
        const inf = (l.type === 'scarf' ? 0.022 : 0.012) * sc;
        s.group('union', 0.004 * sc, () => {
          emitParts(s, parts, ['neck', 'trap'], { ...base(l.type === 'scarf' ? 'wool' : 'leather', { k: 0.03 * sc, noise: l.type === 'scarf' ? { amp: 0.004 * sc, freq: 30 / sc, type: 'ridged' } : undefined }), inflate: inf });
          slab(s, j.neck[1] - 0.04 * sc, j.neck[1] + 0.05 * sc, 0.01 * sc);
        });
        break;
      }
      case 'fur_mantle': {
        s.group('union', 0.006 * sc, () => {
          emitParts(s, parts, ['trap', 'chest', 'back', 'deltoid'], { ...base('fur', { k: 0.05 * sc, noise: { amp: 0.012 * sc, freq: 22 / sc, type: 'fbm', octaves: 3 } }), inflate: 0.03 * sc + t });
          slab(s, j.chest[1] + 0.09 * sc, null, 0.02 * sc);
        });
        break;
      }
      case 'hood': {
        res.hood = true;
        const u = P.headH;
        s.group('union', 0.004 * sc, () => {
          s.ellipsoid(P.h(0, 0.06, -0.06), [0.37 * u, 0.45 * u, 0.48 * u], { color: l.color, mat: mat('wool'), bone: 'head', k: 0.02 * sc });
          s.cone([0, j.neck[1], -0.03 * sc], P.h(0, -0.3, -0.12), 0.1 * sc, 0.12 * sc, { color: l.color, mat: mat('wool'), bone: 'neck', bone2: 'head', k: 0.06 * sc });
          s.ellipsoid(P.h(0, -0.15, 0.42), [0.27 * u, 0.42 * u, 0.32 * u], { op: 'subtract', k: 0.04 * u });
        });
        break;
      }
      case 'loincloth':
      case 'skirt': {
        const len = l.length ?? (l.type === 'loincloth' ? 0.5 : 0.6);
        res.skirt = {
          top: hipY + 0.035 * sc,
          bottom: hipY - (hipY - kneeY) * len * 1.1,
          color: l.color,
          color2: l.color2,
          mat: mat(l.type === 'loincloth' ? 'rags' : 'cloth'),
          panels: l.type === 'loincloth' ? [[-0.5, 0.5], [Math.PI - 0.55, Math.PI + 0.55]] : [[-0.7, 0.7], [0.8, 2.3], [2.4, 3.88], [3.98, 5.48]],
          ragged: l.type === 'loincloth' ? 0.04 * sc : undefined,
        };
        break;
      }
      case 'cloak': {
        res.cloak = { color: l.color, color2: l.color2, mat: mat('wool'), length: l.length ?? 0.75 };
        // clasp/mantle at the shoulders
        s.group('union', 0.004 * sc, () => {
          emitParts(s, parts, ['trap', 'back'], { ...base('wool', { k: 0.04 * sc }), inflate: 0.02 * sc });
          slab(s, j.upperarm_l[1] - 0.05 * sc, null, 0.01 * sc);
          s.plane([0, 0, 1], 0.02 * sc, { op: 'intersect', k: 0.02 * sc });
        });
        break;
      }
    }
  }
  return res;
}
