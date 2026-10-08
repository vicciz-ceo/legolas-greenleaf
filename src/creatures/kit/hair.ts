/**
 * Kit — hair & fur: strand cards (ribbons) and braids with an anisotropic highlight.
 *
 *  - growStrands()     grow strand polylines from roots under gravity, pushed out of ellipsoid
 *                      colliders (scalp, neck, back) — gives natural hanging/combed hair
 *  - hairGeometry()    ribbons (cards facing away from the colliders) + braids → one skinned
 *                      BufferGeometry with uv (u across, v root→tip) and vertex colour
 *  - createHairMaterial()  MeshPhysicalMaterial with a generated strand texture (alpha-tested),
 *                      GGX anisotropy along the fibres and a sheen for the soft scatter
 * Skinning: you pass a weight function (model-space point, 0..1 along strand) → bone weights,
 * so strands follow the head near the root and spring bones further down.
 */
import * as THREE from 'three';
import { mulberry32 } from '../../core/rng';
import type { V3 } from './sdf';

export interface EllipsoidCollider {
  c: V3;
  r: V3;
}

export interface GrowRoot {
  p: V3;
  /** initial direction (will be bent by gravity) */
  dir: V3;
  length: number;
  /** extra offset from colliders for this strand (layering) */
  lift?: number;
  /** card width at the root */
  width?: number;
  /** strand colour override (sRGB) */
  color?: number;
  /** stop growing once the strand drops below this height (model y) */
  minY?: number;
  /** rigidly skin this strand to one bone (overrides the weight function) */
  bone?: number;
}

export interface Strand {
  /** rigid bone (overrides the weight function) */
  bone?: number;
  points: THREE.Vector3[];
  /** outward hint per point (card normal) */
  normals: THREE.Vector3[];
  width: number;
  tipWidth: number;
  color?: number;
}

export interface GrowOpts {
  segments?: number;
  /** how quickly strands bend toward gravity (per metre); 0 = straight */
  gravity?: number;
  colliders?: EllipsoidCollider[];
  /** random wobble (radians per segment) */
  jitter?: number;
  seed?: number;
  /** default card width */
  width?: number;
  /** tip width as a fraction of root width */
  taper?: number;
  /** gentle wave (amplitude in m, wavelength in m) */
  wave?: { amp: number; length: number };
  /** index of a collider the strands hug (stay on its surface at their lift) while above its
   *  lower part — combed hair lying on the scalp. Below that they fall freely. */
  hug?: number | 'nearest';
  /** outward-normal y below which hugging stops (default -0.2) */
  hugUntil?: number;
  /** collider indices used for card normals (default: all). Leave out face/ear colliders so
   *  cards near the hairline lie flat on the scalp instead of twisting toward the face. */
  normalColliders?: number[];
}

/** signed-ish distance to an ellipsoid and its outward normal */
function ellipsoidPush(p: THREE.Vector3, e: EllipsoidCollider, margin: number, outN: THREE.Vector3): boolean {
  const lx = (p.x - e.c[0]) / (e.r[0] + margin);
  const ly = (p.y - e.c[1]) / (e.r[1] + margin);
  const lz = (p.z - e.c[2]) / (e.r[2] + margin);
  const k = Math.sqrt(lx * lx + ly * ly + lz * lz);
  outN.set(lx / (e.r[0] + margin), ly / (e.r[1] + margin), lz / (e.r[2] + margin)).normalize();
  if (k >= 1 || k < 1e-6) return false;
  p.set(e.c[0] + (lx / k) * (e.r[0] + margin), e.c[1] + (ly / k) * (e.r[1] + margin), e.c[2] + (lz / k) * (e.r[2] + margin));
  return true;
}

const _n = new THREE.Vector3();
const _best = new THREE.Vector3();

export function growStrands(roots: GrowRoot[], o: GrowOpts = {}): Strand[] {
  const segs = o.segments ?? 10;
  const grav = o.gravity ?? 9;
  const cols = o.colliders ?? [];
  const rnd = mulberry32(o.seed ?? 1);
  const out: Strand[] = [];
  const raw: THREE.Vector3[] = [];
  const cum: number[] = [];
  for (const r of roots) {
    let rawN = 0;
    const rawAt = (i: number) => raw[i];
    const rawPush = (v: THREE.Vector3) => {
      if (rawN < raw.length) raw[rawN].copy(v);
      else raw.push(v.clone());
      rawN++;
    };
    const p = new THREE.Vector3(...r.p);
    const dir = new THREE.Vector3(...r.dir).normalize();
    const step = Math.min(0.01, r.length / 12);
    const nSteps = Math.max(2, Math.ceil(r.length / step));
    const lift = r.lift ?? 0.004;
    const phase = rnd() * Math.PI * 2;
    rawPush(p);
    let travelled = 0;
    for (let i = 0; i < nSteps; i++) {
      const f = i / nSteps;
      // bend toward gravity, more as the strand leaves the scalp
      dir.y -= grav * step * (0.35 + 0.65 * f);
      dir.x += (rnd() - 0.5) * (o.jitter ?? 0.08) * (step / 0.03);
      dir.z += (rnd() - 0.5) * (o.jitter ?? 0.08) * (step / 0.03);
      dir.normalize();
      const prev = rawAt(rawN - 1);
      p.copy(prev).addScaledVector(dir, step);
      if (o.wave) {
        const sw = Math.cos(phase + (travelled * Math.PI * 2) / o.wave.length) * o.wave.amp * ((Math.PI * 2 * step) / o.wave.length);
        p.x += sw * 0.7;
        p.z += sw * 0.7;
      }
      for (let it = 0; it < 2; it++) for (const c of cols) ellipsoidPush(p, c, lift, _n);
      let hugC: EllipsoidCollider | undefined = typeof o.hug === 'number' ? cols[o.hug] : undefined;
      if (o.hug === 'nearest') {
        let best = Infinity;
        for (const c of cols) {
          const lx = (p.x - c.c[0]) / c.r[0], ly = (p.y - c.c[1]) / c.r[1], lz = (p.z - c.c[2]) / c.r[2];
          const kk = Math.sqrt(lx * lx + ly * ly + lz * lz);
          if (kk < best) {
            best = kk;
            hugC = c;
          }
        }
      }
      if (hugC) {
        const c = hugC;
        const lx = (p.x - c.c[0]) / (c.r[0] + lift), ly = (p.y - c.c[1]) / (c.r[1] + lift), lz = (p.z - c.c[2]) / (c.r[2] + lift);
        const kk = Math.sqrt(lx * lx + ly * ly + lz * lz);
        _n.set(lx / (c.r[0] + lift), ly / (c.r[1] + lift), lz / (c.r[2] + lift)).normalize();
        if (kk > 1 && _n.y > (o.hugUntil ?? -0.2)) p.set(c.c[0] + (lx / kk) * (c.r[0] + lift), c.c[1] + (ly / kk) * (c.r[1] + lift), c.c[2] + (lz / kk) * (c.r[2] + lift));
      }
      dir.subVectors(p, prev).normalize();
      p.copy(prev).addScaledVector(dir, step);
      rawPush(p);
      travelled += step;
      if (r.minY !== undefined && p.y < r.minY) break;
    }
    // resample to segs+1 points evenly along the arc
    cum.length = rawN;
    cum[0] = 0;
    for (let i = 1; i < rawN; i++) cum[i] = cum[i - 1] + raw[i].distanceTo(raw[i - 1]);
    const total = cum[rawN - 1];
    const pts: THREE.Vector3[] = [];
    let k = 0;
    for (let i = 0; i <= segs; i++) {
      const d = (total * i) / segs;
      while (k < rawN - 2 && cum[k + 1] < d) k++;
      const t = (d - cum[k]) / Math.max(1e-9, cum[k + 1] - cum[k]);
      pts.push(raw[k].clone().lerp(raw[Math.min(k + 1, rawN - 1)], Math.min(1, Math.max(0, t))));
    }
    // normals: away from the nearest collider (fallback: horizontal away from the axis)
    const nrm: THREE.Vector3[] = [];
    const ncols = o.normalColliders ? o.normalColliders.map((i) => cols[i]).filter(Boolean) : cols;
    for (const q of pts) {
      let bestD = Infinity;
      _best.set(q.x, 0, q.z).normalize();
      for (const c of ncols) {
        const lx = (q.x - c.c[0]) / c.r[0], ly = (q.y - c.c[1]) / c.r[1], lz = (q.z - c.c[2]) / c.r[2];
        const kk = Math.sqrt(lx * lx + ly * ly + lz * lz);
        if (kk < bestD) {
          bestD = kk;
          _best.set(lx / c.r[0], ly / c.r[1], lz / c.r[2]).normalize();
        }
      }
      nrm.push(_best.clone());
    }
    // smooth the card normals along the strand (no sudden twists between colliders)
    for (let pass = 0; pass < 2; pass++)
      for (let i = 1; i < nrm.length - 1; i++) nrm[i].add(nrm[i - 1]).add(nrm[i + 1]).normalize();
    const width = r.width ?? o.width ?? 0.022;
    out.push({ points: pts, normals: nrm, width, tipWidth: width * (o.taper ?? 0.45), color: r.color, bone: r.bone });
  }
  return out;
}

export type WeightFn = (p: THREE.Vector3, along: number, out: [number, number][]) => void;

export interface HairGeoOpts {
  /** sRGB root colour and tip colour (vertex colour multiplies the strand texture) */
  color: number;
  tipColor?: number;
  weights: WeightFn;
  /** card curl: bend the card across its width (0 = flat) for volume */
  curl?: number;
  /** brightness at the root (darker roots give depth), default 0.72 */
  rootShade?: number;
  /** length over which the root shade fades out (m), default 0.04 */
  rootLength?: number;
}

export interface BraidDef {
  points: V3[];
  radius: number;
  /** strand crossings per metre */
  twist?: number;
  color?: number;
}

const _side = new THREE.Vector3();
const _tan = new THREE.Vector3();
const _c = new THREE.Color();
const _c2 = new THREE.Color();

/** Build ribbon cards + braid tubes into one skinned geometry (uv: u across, v root→tip). */
export function hairGeometry(strands: Strand[], braids: BraidDef[], o: HairGeoOpts): THREE.BufferGeometry {
  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  const col: number[] = [];
  const si: number[] = [];
  const sw: number[] = [];
  const idx: number[] = [];
  const wtmp: [number, number][] = [];
  let rigidBone = -1;
  const pushVert = (p: THREE.Vector3, n: THREE.Vector3, u: number, v: number, c: THREE.Color, along: number) => {
    pos.push(p.x, p.y, p.z);
    nor.push(n.x, n.y, n.z);
    uv.push(u, v);
    col.push(c.r, c.g, c.b);
    wtmp.length = 0;
    if (rigidBone >= 0) wtmp.push([rigidBone, 1]);
    else o.weights(p, along, wtmp);
    wtmp.sort((a, b) => b[1] - a[1]);
    let s = 0;
    for (let k = 0; k < 4; k++) s += wtmp[k]?.[1] ?? 0;
    s = s || 1;
    for (let k = 0; k < 4; k++) {
      si.push(wtmp[k]?.[0] ?? 0);
      sw.push((wtmp[k]?.[1] ?? 0) / s);
    }
  };
  const root = new THREE.Color().setHex(o.color, THREE.SRGBColorSpace);
  const tip = new THREE.Color().setHex(o.tipColor ?? o.color, THREE.SRGBColorSpace);
  const curl = o.curl ?? 0.25;
  let uOff = 0;
  for (const s of strands) {
    rigidBone = s.bone ?? -1;
    const n = s.points.length;
    const base = pos.length / 3;
    const sc = s.color !== undefined ? _c2.setHex(s.color, THREE.SRGBColorSpace) : null;
    // each card samples a different slice of the strand texture
    uOff = (uOff + 0.37) % 1;
    let strandLen = 0;
    for (let i = 1; i < n; i++) strandLen += s.points[i].distanceTo(s.points[i - 1]);
    const rootFrac = Math.min(1, (o.rootLength ?? 0.04) / Math.max(1e-4, strandLen));
    for (let i = 0; i < n; i++) {
      const p = s.points[i];
      const along = i / (n - 1);
      if (i < n - 1) _tan.subVectors(s.points[i + 1], p);
      else _tan.subVectors(p, s.points[i - 1]);
      _tan.normalize();
      const nm = s.normals[i];
      _side.crossVectors(_tan, nm).normalize();
      const w = (s.width + (s.tipWidth - s.width) * along) * 0.5;
      // root slightly darker, tips toward the tip colour
      const rs0 = o.rootShade ?? 0.72;
      _c.copy(sc ?? root).multiplyScalar(rs0 + (1 - rs0) * Math.min(1, along / rootFrac));
      if (o.tipColor !== undefined) _c.lerp(tip, along * along * 0.8);
      // three verts across (centre raised along the normal for a curved card)
      for (let k = -1; k <= 1; k++) {
        const q = p.clone().addScaledVector(_side, k * w).addScaledVector(nm, (k === 0 ? 1 : 0) * w * curl);
        const nn = nm.clone().addScaledVector(_side, k * 0.35).normalize();
        pushVert(q, nn, uOff * 4 + (k + 1) * 0.5, along, _c, along);
      }
    }
    // wound so the front face points along the card normal (outward): with DoubleSide the
    // normal is flipped on back faces, and inward-facing cards rendered the lit side dark
    for (let i = 0; i < n - 1; i++) {
      const a = base + i * 3;
      const b = base + (i + 1) * 3;
      idx.push(a, a + 1, b, a + 1, b + 1, b, a + 1, a + 2, b + 1, a + 2, b + 2, b + 1);
    }
  }
  rigidBone = -1;
  // braids: tubes with lumpy radius (3-strand look)
  for (const br of braids) {
    const curve = new THREE.CatmullRomCurve3(br.points.map((p) => new THREE.Vector3(...p)));
    const len = curve.getLength();
    const segs = Math.max(8, Math.round(len / 0.012));
    const radial = 5;
    const frames = curve.computeFrenetFrames(segs, false);
    const base = pos.length / 3;
    const bc = br.color !== undefined ? new THREE.Color().setHex(br.color, THREE.SRGBColorSpace) : root;
    const twist = br.twist ?? 60;
    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      const p = curve.getPointAt(t);
      const N = frames.normals[i];
      const B = frames.binormals[i];
      const taper = 1 - 0.45 * t * t;
      for (let j = 0; j <= radial; j++) {
        const a = (j / radial) * Math.PI * 2;
        // lumps: three interleaved strands twisting along the braid
        const lump = 0.75 + 0.25 * Math.abs(Math.sin(a * 1.5 + t * len * twist));
        const r = br.radius * taper * lump;
        const nrm = N.clone().multiplyScalar(Math.cos(a)).addScaledVector(B, Math.sin(a));
        const q = p.clone().addScaledVector(nrm, r);
        _c.copy(bc).multiplyScalar(0.8 + 0.2 * lump);
        pushVert(q, nrm, j / radial, t, _c, 0.5 + 0.5 * t);
      }
    }
    for (let i = 0; i < segs; i++)
      for (let j = 0; j < radial; j++) {
        const a = base + i * (radial + 1) + j;
        const b = a + radial + 1;
        idx.push(a, a + 1, b, a + 1, b + 1, b);
      }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
  g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

let strandTex: THREE.DataTexture | null = null;
/** RGBA strand texture: dense fibres, wispy edges and tips. Shared (do not dispose). */
export function strandTexture(): THREE.DataTexture {
  if (strandTex) return strandTex;
  const W = 256, H = 256;
  const data = new Uint8Array(W * H * 4);
  const rnd = mulberry32(777);
  // fibre table per column
  const fib: { b: number; end: number; a: number }[] = [];
  for (let x = 0; x < W; x++) {
    const u = (x % 64) / 64; // 4 tiles across (cards pick one)
    const edge = Math.min(u, 1 - u) * 2; // 0 at card edge, 1 at centre
    // brightness is a LINEAR multiplier on the vertex colour (texture is not sRGB-decoded)
    fib.push({ b: 0.74 + rnd() * 0.3, end: 0.72 + rnd() * 0.28 * (0.4 + edge), a: edge < 0.25 ? (rnd() < edge * 3.2 ? 1 : 0) : rnd() < 0.94 ? 1 : 0.35 });
  }
  for (let y = 0; y < H; y++) {
    const v = y / (H - 1);
    for (let x = 0; x < W; x++) {
      const f = fib[x];
      const i = (y * W + x) * 4;
      // subtle lengthwise variation
      const vary = 0.92 + 0.08 * Math.sin(v * 37 + x * 0.7);
      const b = Math.min(1, f.b * vary);
      data[i] = data[i + 1] = data[i + 2] = Math.round(b * 255);
      // tips end at different lengths; roots fade in over the first few % (no square card starts)
      const tipFade = v > f.end ? 0 : v < 0.012 ? (v / 0.012 > (x % 7) / 7 ? 1 : 0) : 1;
      data[i + 3] = Math.round(f.a * tipFade * 255);
    }
  }
  const t = new THREE.DataTexture(data, W, H, THREE.RGBAFormat);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.ClampToEdgeWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.colorSpace = THREE.NoColorSpace;
  t.anisotropy = 4;
  t.needsUpdate = true;
  t.userData.shared = true;
  strandTex = t;
  return t;
}

export interface HairMaterialOpts {
  roughness?: number;
  /** strength of the Kajiya-Kay strand highlight (0..1.5) */
  anisotropy?: number;
  sheen?: number;
  sheenColor?: number;
  alphaTest?: number;
  /** highlight tint (sRGB), defaults to a warm white */
  highlight?: number;
}

const KK_COMMON = /* glsl */ `
vec3 gHairT = vec3( 0.0, 1.0, 0.0 );
uniform float hairSpec;
uniform vec3 hairHighlight;
`;

/**
 * Hair: alpha-tested strand cards with a Kajiya-Kay highlight along the strand direction
 * (tangent = UV v direction from screen derivatives): a sharp primary lobe shifted toward the
 * root and a broader secondary lobe tinted by the hair colour. Specular F0/F90 kept low so dark
 * hair stays dark at grazing angles.
 */
export function createHairMaterial(o: HairMaterialOpts = {}): THREE.MeshPhysicalMaterial {
  const m = new THREE.MeshPhysicalMaterial({
    map: strandTexture(),
    vertexColors: true,
    roughness: o.roughness ?? 0.55,
    metalness: 0,
    sheen: o.sheen ?? 0.3,
    sheenRoughness: 0.5,
    sheenColor: new THREE.Color(o.sheenColor ?? 0x6a6258),
    alphaTest: o.alphaTest ?? 0.45,
    side: THREE.DoubleSide,
    specularIntensity: 0.25,
  });
  const hl = new THREE.Color().setHex(o.highlight ?? 0xfff4e0, THREE.SRGBColorSpace);
  const uniforms = { hairSpec: { value: o.anisotropy ?? 0.7 }, hairHighlight: { value: new THREE.Vector3(hl.r, hl.g, hl.b) } };
  m.userData.hairUniforms = uniforms;
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    let chunk = THREE.ShaderChunk.lights_physical_pars_fragment;
    const target = 'reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseContribution );';
    if (chunk.includes(target)) {
      chunk = chunk.replace(
        target,
        `${target}
	{
		// Kajiya-Kay strand highlights
		vec3 H = normalize( directLight.direction + geometryViewDir );
		vec3 T1 = normalize( gHairT + geometryNormal * 0.12 );
		vec3 T2 = normalize( gHairT - geometryNormal * 0.1 );
		float d1 = dot( T1, H ), d2 = dot( T2, H );
		float s1 = pow( sqrt( max( 0.0, 1.0 - d1 * d1 ) ), 110.0 );
		float s2 = pow( sqrt( max( 0.0, 1.0 - d2 * d2 ) ), 28.0 );
		float wrapL = saturate( dot( geometryNormal, directLight.direction ) * 0.5 + 0.5 );
		reflectedLight.directSpecular += directLight.color * wrapL * hairSpec * ( s1 * 0.18 * hairHighlight + s2 * 0.35 * material.diffuseColor );
	}`,
      );
    }
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${KK_COMMON}`)
      .replace('#include <lights_physical_pars_fragment>', chunk)
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
	{
		// strand direction = direction of increasing v (cotangent frame from derivatives)
		vec3 dp1 = dFdx( - vViewPosition ), dp2 = dFdy( - vViewPosition );
		vec2 duv1 = dFdx( vMapUv ), duv2 = dFdy( vMapUv );
		vec3 dp2perp = cross( dp2, normal ), dp1perp = cross( normal, dp1 );
		vec3 B = dp2perp * duv1.y + dp1perp * duv2.y;
		gHairT = length( B ) > 1e-9 ? normalize( B ) : vec3( 0.0, 1.0, 0.0 );
	}`,
      );
  };
  m.customProgramCacheKey = () => 'kit-hair-v2';
  return m;
}
