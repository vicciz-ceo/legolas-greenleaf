/**
 * Bucket-specific hair, beards and stubble. The kit grows hair from the static `KindDef`; the
 * rank-and-file kinds here need a different look per seed bucket, so those kinds define
 * `hair: stringy, density 0` (which only creates the spring-bone chain and a barely visible scalp
 * cap) and everything visible is grown here with the kit's own hair API and attached as a skinned
 * extra (see common.attachSkinned). Named characters use the kit's hair directly.
 */
import type { Rng } from '../../../../core/rng';
import { buildHair, sculptHairCap } from '../../hairstyles';
import type { BeardDef, HairDef, KindContext } from '../../types';
import { devSkip, mix, queueHair } from './common';

/** the placeholder hair a rank-and-file kind defines statically: no strands, no visible cap, chain bones kept */
export function noKitHair(skinColor: number): HairDef {
  return { style: 'stringy', color: skinColor, density: 0 };
}

/**
 * Head hair (+ optional beard) built with the kit's hairstyle code for this bucket's look and
 * attached as a skinned extra. Also sculpts the matching scalp cap into the body.
 */
export function addHair(ctx: KindContext, o: { hair?: HairDef | null; beard?: BeardDef | null; hooded?: boolean; rng: Rng; cap?: boolean; /** 1 = the kit's cheap hair (45 % of the cards, 7 segments instead of 12): crowds */ lod?: 0 | 1; /** push the back/shoulder colliders out so long hair hangs over a cloak */ backClear?: number }) {
  const { P, rig, sculpt: s } = ctx;
  if (devSkip('hair')) return;
  const hooded = !!o.hooded;
  if (o.hair && o.cap !== false && !hooded) sculptHairCap(s, P, o.hair, hooded);
  const Pm = o.backClear ? ({ ...P, build: { ...P.build, chest: P.build.chest * o.backClear } } as typeof P) : P;
  const geo = buildHair(Pm, rig, o.hair ?? null, o.beard ?? null, o.rng, o.lod ?? 0, hooded).geo;
  if (!geo) return;
  const col = o.hair?.color ?? o.beard?.color ?? 0x302010;
  queueHair(ctx, geo, col);
}

export interface StubbleOpts {
  color: number;
  /** painted shadow strength 0..1 */
  paint?: number;
  /** length of the short hairs (m, unscaled) */
  length?: number;
  /** number of cards at LOD0 */
  count?: number;
  /** include the upper lip */
  mustache?: boolean;
  /** extend the growth up the cheeks (a full short beard) */
  cheeks?: number;
  rng: Rng;
}

/** darkened skin paint for stubble: jaw, chin, upper lip, sideburns and lower cheeks */
export function paintStubble(ctx: KindContext, o: { color: number; paint?: number; mustache?: boolean; cheeks?: number }) {
  const { P, sculpt: s } = ctx;
  const u = P.headH;
  const skin = ctx.def.skin;
  const shadow = mix(skin.color, o.color, 0.62);
  const paint = o.paint ?? 0.5;
  const cheeks = o.cheeks ?? 0.6;
  const pj = { op: 'paint' as const, mat: 'skin_weathered' as const, bone: 'jaw', color: shadow, k: 0.07 * u };
  s.ellipsoid(P.h(0, -0.43, 0.2), [0.24 * u, 0.16 * u, 0.19 * u], { ...pj, strength: paint });
  s.ellipsoid(P.h(0, -0.5, 0.27), [0.14 * u, 0.07 * u, 0.1 * u], { ...pj, strength: paint * 0.9 });
  s.mirrored(() => {
    s.ellipsoid(P.h(0.2, -0.3, 0.1), [0.07 * u, 0.15 * u, 0.15 * u], { ...pj, bone: 'head', strength: paint * 0.9 });
    s.ellipsoid(P.h(0.16, -0.3, 0.24), [0.1 * u, 0.09 * u, 0.1 * u], { ...pj, bone: 'head', strength: paint * cheeks });
  });
  if (o.mustache !== false) s.ellipsoid(P.h(0, -0.345, 0.385), [0.12 * u, 0.026 * u, 0.06 * u], { ...pj, bone: 'head', k: 0.03 * u, strength: paint * 0.9 });
}

/**
 * A short sculpted beard: a layer of hair-surface volume hugging the mandible, chin, cheeks and
 * upper lip (a few triangles, reads as dense short hair). `thick` is the pile height (head
 * units), `cheeks` how far up the cheeks it reaches, `chin` extra length at the chin point.
 */
export function sculptBeard(ctx: KindContext, o: { color: number; color2?: number; thick?: number; cheeks?: number; chin?: number; mustache?: boolean; mouthGap?: number }) {
  const { P, sculpt: s } = ctx;
  const u = P.headH;
  const sc = P.s;
  const f = ctx.def.face;
  const jw = f.jaw;
  const jl = f.jawLength;
  const t = o.thick ?? 0.07;
  const ch = o.cheeks ?? 0.6;
  const mat = 'hair' as const;
  const noise = { amp: 0.0022 * sc, freq: 120 / sc, type: 'ridged' as const, octaves: 2 };
  const base = { color: o.color, color2: o.color2, colorNoise: o.color2 !== undefined ? 0.5 : 0, colorFreq: 60 / sc, mat, noise };
  s.group('union', 0.02 * u, () => {
    // along the mandible (same chain as the skin's, thicker)
    s.with({ ...base, bone: 'head', bone2: 'jaw', blend: [0.25, 0.8] }, () => {
      s.mirrored(() => {
        const ear = P.h(0.265 * jw, -0.2, -0.045);
        const gon = P.h(0.222 * jw, -0.39 * jl, 0.0);
        const chinSide = P.h(0.08 * (0.7 + 0.3 * jw), -0.5 * jl, 0.265);
        s.cone(ear, gon, (0.055 + t * 0.6) * u, (0.052 * jw + t) * u, { k: 0.02 * u, blendAxis: [ear, chinSide] });
        s.cone(gon, chinSide, (0.052 * jw + t) * u, (0.05 + t * 1.15) * u, { k: 0.02 * u, blendAxis: [ear, chinSide] });
        // upper cheeks / sideburn
        s.ellipsoid(P.h(0.2, -0.26, 0.09), [0.05 * u, 0.12 * u * (0.5 + ch), 0.12 * u], { k: 0.025 * u });
        if (ch > 0.5) s.ellipsoid(P.h(0.15, -0.3, 0.22), [(0.06 + t) * u, (0.05 + t * 0.6 + 0.06 * ch) * u, (0.05 + t * 0.8) * u], { k: 0.025 * u });
      });
    });
    s.with({ ...base, bone: 'jaw' }, () => {
      s.ellipsoid(P.h(0, -0.482 * jl, 0.288 + 0.03 * (f.chin - 1)), [(0.08 * (0.8 + 0.2 * jw) + t * 0.9) * u, (0.06 + t * 0.9 + (o.chin ?? 0)) * u, (0.066 + t * 1.1) * u], { k: 0.025 * u });
      s.ellipsoid(P.h(0, -0.43, 0.25), [0.1 * u, 0.09 * u, 0.1 * u], { k: 0.025 * u });
    });
    if (o.mustache !== false) {
      s.with({ ...base, bone: 'head' }, () => {
        s.mirrored(() => s.cone(P.h(0.0, -0.336, 0.392), P.h(0.095, -0.37, 0.355), 0.022 * u + t * 0.25 * u, 0.02 * u + t * 0.2 * u, { k: 0.02 * u }));
      });
    }
    // keep the mouth and lips clear
    s.ellipsoid(P.h(0, -0.405 - (o.mouthGap ?? 0) * 0.0, 0.43), [0.082 * u * f.lips.width, 0.034 * u, 0.06 * u], { op: 'subtract', k: 0.012 * u });
  });
}

