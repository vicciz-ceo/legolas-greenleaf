/**
 * Bucket-specific hair, beards and stubble. The kit grows hair from the static `KindDef`; the
 * rank-and-file kinds here need a different look per seed bucket, so those kinds define
 * `hair: stringy, density 0` (which only creates the spring-bone chain and a barely visible scalp
 * cap) and everything visible is grown here with the kit's own hair API and attached as a skinned
 * extra (see common.attachSkinned). Named characters use the kit's hair directly.
 */
import * as THREE from 'three';
import type { Rng } from '../../../../core/rng';
import { hairGeometry, type Strand } from '../../../kit/hair';
import { sdfProbe, type SdfProbe, type V3 } from '../../../kit/sdf';
import { buildHair, sculptHairCap } from '../../hairstyles';
import type { BeardDef, HairDef, KindContext } from '../../types';
import { hairMaterial, mergeHairGeos, mix, queueHair } from './common';

/** the placeholder hair a rank-and-file kind defines statically: no strands, no visible cap, chain bones kept */
export function noKitHair(skinColor: number): HairDef {
  return { style: 'stringy', color: skinColor, density: 0 };
}

/**
 * Head hair (+ optional beard) built with the kit's hairstyle code for this bucket's look and
 * attached as a skinned extra. Also sculpts the matching scalp cap into the body.
 */
export function addHair(ctx: KindContext, o: { hair?: HairDef | null; beard?: BeardDef | null; hooded?: boolean; rng: Rng; cap?: boolean }) {
  const { P, rig, sculpt: s } = ctx;
  const hooded = !!o.hooded;
  if (o.hair && o.cap !== false && !hooded) sculptHairCap(s, P, o.hair, hooded);
  const geo = buildHair(P, rig, o.hair ?? null, o.beard ?? null, o.rng, 0, hooded).geo;
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

/** a face-surface probe (build once per extras call and reuse) */
export function faceProbe(ctx: KindContext): SdfProbe {
  const { P } = ctx;
  return sdfProbe(ctx.sculpt.compile(), P.h(-0.34, -0.7, 0.05), P.h(0.34, 0.1, 0.62));
}

/**
 * Stubble or a short beard: darkened skin paint along the jaw, chin, upper lip and sideburns, plus
 * a layer of very short hair cards rooted on the sculpted surface (placed with an SDF probe).
 * Returns the geometry (also attached).
 */
export function addStubble(ctx: KindContext, o: StubbleOpts): THREE.BufferGeometry | null {
  const { P, sculpt: s, rig } = ctx;
  const u = P.headH;
  const sc = P.s;
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

  // ── short hairs ──
  const probe = faceProbe(ctx);
  const iJaw = rig.boneIndex('jaw');
  const iHead = rig.boneIndex('head');
  const strands: Strand[] = [];
  const count = o.count ?? 260;
  const len0 = (o.length ?? 0.016) * sc;
  const base = new THREE.Color().setHex(o.color, THREE.SRGBColorSpace);
  const tmp = new THREE.Color();
  let tries = 0;
  while (strands.length < count && tries < count * 14) {
    tries++;
    const x = o.rng.range(-0.3, 0.3);
    const y = o.rng.range(-0.58, -0.1);
    const ax = Math.abs(x);
    // region mask in head units
    const lowFace = y < -0.37 && ax < 0.27 - (y < -0.5 ? 0.12 : 0);
    const jawLine = y < -0.26 && ax > 0.16 && ax < 0.29;
    const cheek = y < -0.2 && ax > 0.1 && ax < 0.24 && o.rng.float() < cheeks;
    const sideburn = ax > 0.22 && ax < 0.3 && y > -0.3 && y < -0.1;
    const lip = o.mustache !== false && ax < 0.12 && y > -0.37 && y < -0.31;
    const mouth = ax < 0.1 && y > -0.435 && y < -0.365;
    if (mouth) continue;
    if (!(lowFace || jawLine || cheek || sideburn || lip)) continue;
    const p0: V3 = P.h(x, y, 0.5);
    const p = probe.project(p0, 10);
    // reject points that did not land on the front of the face
    const hx = (p[0] - P.headC[0]) / u, hy = (p[1] - P.headC[1]) / u, hz = (p[2] - P.headC[2]) / u;
    if (hz < 0.0 || Math.abs(hx - x) > 0.08 || Math.abs(hy - y) > 0.08) continue;
    const n = probe.normal(p);
    const nv = new THREE.Vector3(n[0], n[1], n[2]);
    // grow downward and outward, hugging the skin
    const dir = nv.clone().multiplyScalar(0.45).add(new THREE.Vector3(0, -0.9, 0.1)).normalize();
    const len = len0 * o.rng.range(0.7, 1.3);
    const pts: THREE.Vector3[] = [];
    const nrm: THREE.Vector3[] = [];
    for (let k = 0; k <= 2; k++) {
      const pp = new THREE.Vector3(p[0], p[1], p[2]).addScaledVector(nv, 0.0005 * sc * (1 + k)).addScaledVector(dir, (len * k) / 2);
      pts.push(pp);
      nrm.push(nv.clone());
    }
    tmp.copy(base).multiplyScalar(o.rng.range(0.75, 1.1));
    strands.push({ points: pts, normals: nrm, width: 0.0042 * sc, tipWidth: 0.0016 * sc, color: tmp.getHex(THREE.SRGBColorSpace), bone: y < -0.36 ? iJaw : iHead });
  }
  if (!strands.length) return null;
  const geo = hairGeometry(strands, [], { color: o.color, weights: (_p, _a, out) => out.push([iHead, 1]), curl: 0, rootShade: 0.8 });
  queueHair(ctx, geo, o.color);
  return geo;
}

void hairMaterial;
void mergeHairGeos;
