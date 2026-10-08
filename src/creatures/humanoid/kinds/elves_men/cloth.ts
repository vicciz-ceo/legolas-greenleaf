/**
 * Bucket-specific cloth sheets. The kit builds skirt panels and cloaks from the static outfit; the
 * rank-and-file kinds need different colours (and lengths) per seed bucket, so they declare the
 * layers in `KindDef.outfit` with `chance: 0` (which creates the spring bones but no cloth) and
 * add the sheets here with the kit's own `skirtGeometry` / `cloakGeometry`, attached as skinned
 * extras that share the instance's body material.
 */
import type { SurfaceName, SurfaceSpec } from '../../../kit/surfaces';
import { skirtGeometry, cloakGeometry } from '../../cloth';
import { emitParts, anatomyParts } from '../../anatomy';
import type { KindContext } from '../../types';
import { attachSkinned, devSkip } from './common';
import { slab } from './garments';

export const SKIRT_PANELS: [number, number][] = [[-0.62, 0.62], [0.75, 2.35], [2.45, 3.83], [3.93, 5.53]];
export const COAT_PANELS: [number, number][] = [[-Math.PI * 0.98, -0.12], [0.12, Math.PI * 0.98]];

/** hem panels hanging from the hips: `length` 0..1 of the hip→knee distance (>1 = below the knee) */
export function addSkirt(ctx: KindContext, o: { color: number; color2?: number; mat?: SurfaceName | SurfaceSpec; length: number; panels?: [number, number][]; ragged?: number; flare?: number; bottom?: number }) {
  const { P, rig, spec } = ctx;
  const sc = P.s;
  const hipY = P.j.thigh_l[1];
  const kneeY = P.j.shin_l[1];
  const top = hipY + 0.035 * sc;
  const bottom = o.bottom ?? hipY - (hipY - kneeY) * o.length * 1.05;
  if (devSkip('skirt')) return;
  const geo = skirtGeometry(P, rig, { top, bottom, color: o.color, color2: o.color2, mat: o.mat ?? 'cloth', panels: o.panels ?? SKIRT_PANELS, flare: o.flare, ragged: o.ragged, seed: spec.seed ?? 0 });
  attachSkinned(ctx, geo, 'body', { small: false, name: 'skirt' });
}

/** a cloak from the shoulders, with the shoulder mantle sculpted into the body */
export function addCloak(ctx: KindContext, o: { color: number; color2?: number; mat?: SurfaceName | SurfaceSpec; length: number; ragged?: number; mantle?: boolean }) {
  const { P, rig, sculpt: s, spec } = ctx;
  const sc = P.s;
  const j = P.j;
  const mat = o.mat ?? 'wool';
  const geo = cloakGeometry(P, rig, { color: o.color, color2: o.color2, mat, length: o.length, ragged: o.ragged, seed: spec.seed ?? 0 });
  attachSkinned(ctx, geo, 'body', { small: false, name: 'cloak' });
  if (o.mantle !== false) {
    const parts = anatomyParts(P);
    s.group('union', 0.004 * sc, () => {
      emitParts(s, parts, ['trap', 'back'], { color: o.color, mat, k: 0.04 * sc, inflate: 0.02 * sc });
      slab(s, j.upperarm_l[1] - 0.05 * sc, null, 0.01 * sc);
      s.plane([0, 0, 1], 0.02 * sc, { op: 'intersect', k: 0.02 * sc });
    });
  }
}
