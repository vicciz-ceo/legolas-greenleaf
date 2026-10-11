/**
 * Kit — creature detail material.
 *
 * A MeshPhysicalMaterial patched with onBeforeCompile so ONE material renders every surface of a
 * creature (skin, cloth, leather, metal, chitin, fur …) from per-vertex attributes:
 *   color (rgb)      albedo
 *   surf  (vec4)     roughness, metalness, sheen amount, skin-scatter amount
 *   pat0  (vec4)     pattern weights: pores, weave, leather, scales
 *   pat1  (vec4)     pattern weights: chitin, fur, scratches, wrinkles
 *   ao    (float)    baked SDF ambient occlusion
 * Detail is procedural in the REST pose (object position before skinning), so it sticks to the
 * skin while animating: 3D noise for pores/leather/chitin/wrinkles/fur, triplanar for cloth weave,
 * cellular noise for scales and mail. Heights become a bump via screen-space derivatives
 * (Mikkelsen surface gradient), faded out when a feature gets smaller than a pixel.
 * Skin gets wrap lighting with a warm red scatter tint (cheap subsurface look).
 */
import * as THREE from 'three';

export interface CreatureMaterialOpts {
  /** scale of the procedural detail (1 = human; 2.5 = troll; 0.6 = small creature) */
  detailScale?: number;
  /** multiplier on bump strength */
  detailStrength?: number;
  /** overall roughness multiplier */
  roughness?: number;
  /** subsurface scatter tint for skin wrap lighting (sRGB) */
  scatterColor?: number;
  /** wrap amount 0..1 */
  wrap?: number;
  side?: THREE.Side;
  /** emissive base (glowing creatures) */
  emissive?: number;
  emissiveIntensity?: number;
  /** clearcoat (wet / glossy chitin) */
  clearcoat?: number;
  clearcoatRoughness?: number;
}

const GLSL_COMMON = /* glsl */ `
varying vec2 vSeam;
varying vec4 vSurf;
varying vec4 vPat0;
varying vec4 vPat1;
varying float vAO;
varying vec3 vRest;
varying vec3 vRestN;
uniform float detailStrength;
uniform float detailScale;
uniform vec3 scatterColor;
uniform float wrapAmount;
uniform float kitDebug;
float gSkin = 0.0;
float gH = 0.0;
float gAlbedo = 1.0;
vec3 gTint = vec3( 1.0 );
// rust (pitted metal): 0..1 coverage and its colour; rust is a rough dielectric
float gRustK = 0.0;
vec3 gRust = vec3( 0.0 );

float kh13(vec3 p3) {
  p3 = fract(p3 * 0.1031);
  p3 += dot(p3, p3.zyx + 31.32);
  return fract((p3.x + p3.y) * p3.z);
}
float kvn(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  vec3 u = f * f * (3.0 - 2.0 * f);
  float a = kh13(i), b = kh13(i + vec3(1.0, 0.0, 0.0));
  float c = kh13(i + vec3(0.0, 1.0, 0.0)), d = kh13(i + vec3(1.0, 1.0, 0.0));
  float e = kh13(i + vec3(0.0, 0.0, 1.0)), f1 = kh13(i + vec3(1.0, 0.0, 1.0));
  float g = kh13(i + vec3(0.0, 1.0, 1.0)), h = kh13(i + vec3(1.0, 1.0, 1.0));
  return mix(mix(mix(a, b, u.x), mix(c, d, u.x), u.y), mix(mix(e, f1, u.x), mix(g, h, u.x), u.y), u.z) * 2.0 - 1.0;
}
// cellular F1 (x) and F2 (y)
vec2 kcell(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  float d1 = 8.0, d2 = 8.0;
  for (int z = -1; z <= 1; z++)
  for (int y = -1; y <= 1; y++)
  for (int x = -1; x <= 1; x++) {
    vec3 g = vec3(float(x), float(y), float(z));
    vec3 o = vec3(kh13(i + g), kh13(i + g + 17.13), kh13(i + g + 41.71));
    vec3 r = g + o - f;
    float d = dot(r, r);
    if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) { d2 = d; }
  }
  return sqrt(vec2(d1, d2));
}
float kweave2(vec2 uv) {
  vec2 c = fract(uv);
  vec2 id = floor(uv);
  float ck = mod(id.x + id.y, 2.0);
  float a = sin(3.14159 * c.x) * (0.55 + 0.45 * sin(3.14159 * c.y));
  float b = sin(3.14159 * c.y) * (0.55 + 0.45 * sin(3.14159 * c.x));
  return mix(a, b, ck);
}
// 2/1 twill: diagonal ribs over the thread crossings (wool twill, denim-like)
float ktwill2(vec2 uv) {
  float d = fract((uv.x + uv.y) / 3.0);
  float rib = smoothstep(0.0, 0.3, d) * (1.0 - smoothstep(0.55, 0.95, d));
  float thr = sin(3.14159 * fract(uv.y)) * (0.75 + 0.25 * sin(3.14159 * fract(uv.x)));
  return mix(thr, rib, 0.6);
}
float kfade(float feature, float px) {
  return 1.0 - smoothstep(feature * 0.25, feature * 0.9, px);
}
// Tooled (embossed) leather, 2D: a staggered field of tilted leaves, each raised and smooth
// (burnished) with an incised outline, a midrib and side veins, on a darker stippled ground.
// uv in metres (rest pose / detailScale). Returns (height m, cavity 0..1, raised 0..1, rough offset).
vec4 ktooled(vec2 uv, float px) {
  vec2 cs = vec2(0.05, 0.088);
  vec2 g = uv / cs;
  float col = floor(g.x);
  g.y += mod(col, 2.0) * 0.5;
  vec2 id = vec2(col, floor(g.y));
  vec2 f = fract(g) - 0.5;
  float hsh = kh13(vec3(id, 3.7));
  float side = mod(id.x + id.y, 2.0) * 2.0 - 1.0;
  float ang = side * (0.22 + 0.2 * hsh);
  vec2 q = vec2(f.x * cs.x - side * 0.003, f.y * cs.y);
  float ca = cos(ang), sa = sin(ang);
  q = vec2(ca * q.x - sa * q.y, sa * q.x + ca * q.y);
  float L = 0.035 * (0.84 + 0.22 * hsh);
  float W = 0.0108 * (0.82 + 0.34 * fract(hsh * 7.31));
  float r = (L * L + W * W) / (2.0 * W);
  float c = r - W;
  float d = length(vec2(abs(q.x) + c, q.y)) - r;
  float pw = px * 0.6;
  float fg = kfade(0.0022, px);
  float inside = 1.0 - smoothstep(-0.0012, 0.0003, d);
  float outline = (1.0 - smoothstep(0.00035, 0.0009 + pw, abs(d + 0.0002))) * fg;
  float tipT = 1.0 - smoothstep(0.55 * L, 0.95 * L, abs(q.y));
  float midrib = (1.0 - smoothstep(0.00022, 0.0005 + pw, abs(q.x))) * inside * tipT * fg;
  float vd = abs(fract((q.y - abs(q.x) * 1.35) / 0.007) - 0.5) * 0.007;
  float veins = (1.0 - smoothstep(0.00018, 0.0004 + pw, vd)) * (1.0 - smoothstep(-0.0022, -0.0008, d)) * step(0.0007, abs(q.x)) * fg;
  // a scrolling stem every other column, between the leaves
  float stemX = (fract(uv.x / (cs.x * 2.0)) - 0.5) * cs.x * 2.0 - 0.007 * sin(uv.y * 90.0 + col);
  float stem = (1.0 - smoothstep(0.0005, 0.0011 + pw, abs(abs(stemX) - 0.0009))) * (1.0 - inside) * fg;
  float stip = kvn(vec3(uv * 2600.0, 1.3)) * kfade(0.0008, px);
  float H = inside * (1.6e-4 + 0.6e-4 * (1.0 - smoothstep(-0.004, 0.0, d))) - outline * 1.5e-4 - midrib * 0.7e-4 - veins * 0.45e-4 - stem * 1.0e-4 + (1.0 - inside) * stip * 1.5e-5;
  // at mid range the incised outline survives as a soft darker rim around each raised leaf
  float rim = (1.0 - smoothstep(0.0, 0.003, abs(d + 0.0004))) * kfade(0.016, px) * (1.0 - fg);
  float cav = outline * 0.5 + rim * 0.22 + midrib * 0.22 + veins * 0.14 + stem * 0.35 + (1.0 - inside) * 0.12 * kfade(0.04, px);
  float R = (1.0 - inside) * (0.08 + stip * 0.04) - inside * 0.07 + outline * 0.08;
  return vec4(H, cav, inside * kfade(0.03, px), R);
}
// gH: height (m), gAlbedo: cavity darkening, gTint: colour multiplier; returns roughness offset
float kitDetail() {
  vec3 p = vRest / detailScale;
  float px = length(fwidth(vRest)) / detailScale;
  float H = 0.0;
  float R = 0.0;
  float cav = 0.0;
  gTint = vec3( 1.0 );
  vec3 bn = pow(abs(vRestN), vec3(4.0));
  bn /= (bn.x + bn.y + bn.z + 1e-5);
  // pores (skin, stone, pitted metal); negative weight = scarred skin (pores + healed cuts)
  float w = abs(vPat0.x);
  if (w > 0.01) {
    float f = kfade(0.0016, px);
    float n = kvn(p * 620.0);
    float pore = smoothstep(0.35, 0.95, n);
    float fm = kfade(0.006, px);
    float micro = kvn(p * 170.0 + 7.0) * 0.5 + kvn(p * 41.0 + 3.0) * 0.5;
    // fine crosshatched skin lines (the diamond relief of real skin)
    float fl = kfade(0.003, px);
    float l1 = 1.0 - abs(kvn(p * vec3(320.0, 95.0, 320.0) + 13.0));
    float l2 = 1.0 - abs(kvn(p * vec3(95.0, 320.0, 140.0) + 29.0));
    float lines = pow(max(l1, l2), 14.0) * fl;
    H += w * (f * (-pore * 8e-5) + fm * micro * 3.2e-5 - lines * 1.3e-5);
    R += w * (pore * 0.06 * f + micro * 0.05 * fm + lines * 0.02);
    cav += w * (pore * 0.06 * f + lines * 0.018);
    if (vPat0.x < -0.01) {
      // healed cuts: zero-sets of low-frequency 3D noise cross the skin as long curved lines,
      // broken into segments; raised, glossy, red-purple scar tissue with a faint halo
      float s1 = abs(kvn(p * vec3(6.5, 10.0, 6.5) + 41.0));
      float s2 = abs(kvn(p * vec3(10.0, 5.5, 8.5) + 73.0));
      float g1 = smoothstep(0.15, 0.4, kvn(p * 3.1 + 5.0));
      float g2 = smoothstep(0.2, 0.45, kvn(p * 2.7 + 9.0));
      float wd = 0.04;
      float c1 = (1.0 - smoothstep(wd * 0.25, wd, s1)) * g1;
      float c2 = (1.0 - smoothstep(wd * 0.25, wd, s2)) * g2;
      float sc = max(c1, c2);
      float halo = max((1.0 - smoothstep(wd, wd * 5.0, s1)) * g1, (1.0 - smoothstep(wd, wd * 5.0, s2)) * g2);
      float sv = kfade(0.012, px);
      H += w * sc * 1.1e-4 * kfade(0.006, px);
      R -= sc * 0.14;
      gTint *= mix(vec3(1.0), vec3(0.72, 0.42, 0.46), clamp(sc * sv + halo * 0.22, 0.0, 1.0));
    }
  }
  // living skin: mottling, capillary warmth and faint spots (keeps faces from reading as clay),
  // plus oily / dry patches in the roughness
  if (vSurf.w > 0.3) {
    float sk = vSurf.w;
    float mott = kvn(p * 36.0) * 0.6 + kvn(p * 11.0 + 5.0) * 0.4;
    float warm = smoothstep(-0.2, 0.7, kvn(p * 19.0 + 17.0));
    float spot = smoothstep(0.62, 0.92, kvn(p * 230.0 + 3.0)) * kfade(0.004, px);
    gTint *= mix(vec3(1.0), vec3(1.0 + 0.07 * mott, 1.0 + 0.04 * mott - 0.025 * warm, 1.0 + 0.03 * mott - 0.075 * warm), sk);
    cav += sk * spot * 0.06;
    R += sk * (kvn(p * 6.0 + 2.0) * 0.07 + kvn(p * 23.0) * 0.03);
  }
  // cloth: plain weave (weight > 0) or 2/1 twill (weight < 0), triplanar
  w = abs(vPat0.y);
  if (w > 0.01) {
    float sc = 560.0;
    float wv;
    if (vPat0.y > 0.0) wv = kweave2(p.yz * sc) * bn.x + kweave2(p.xz * sc) * bn.y + kweave2(p.xy * sc) * bn.z;
    else wv = ktwill2(p.zy * sc) * bn.x + ktwill2(p.xz * sc) * bn.y + ktwill2(p.xy * sc) * bn.z;
    float f = kfade(1.0 / sc, px);
    float lump = kvn(p * 40.0) * 0.6 + kvn(p * 9.0) * 0.4;
    float slub = kvn(vec3(p.x * 30.0, p.y * 600.0, p.z * 30.0)) * kfade(0.004, px);
    H += w * (f * (wv - 0.5) * 9e-5 + lump * 1.2e-4 * kfade(0.03, px));
    R += w * ((0.5 - wv) * 0.08 * f + lump * 0.05);
    cav += w * ((1.0 - wv) * 0.12 * f + max(-lump, 0.0) * 0.06);
    gTint *= 1.0 + w * (lump * 0.05 + slub * 0.035);
  }
  // leather grain + creases (weight > 0); weight < 0 = tooled leather (embossed leaf work)
  w = abs(vPat0.z);
  if (w > 0.01) {
    float g = kvn(p * 380.0) * 0.6 + kvn(p * 900.0) * 0.4;
    float c = 1.0 - abs(kvn(p * vec3(55.0, 22.0, 55.0)));
    c = pow(c, 6.0);
    float big = kvn(p * 12.0);
    float mot = kvn(p * 45.0 + 9.0);
    H += w * (g * 3.5e-5 * kfade(0.002, px) - c * 6e-5 * kfade(0.012, px));
    R += w * (big * 0.08 + c * 0.05 - g * 0.04);
    cav += w * (c * 0.07 + max(big, 0.0) * 0.05);
    // grime settles where little light reaches; exposed edges are burnished lighter
    cav += w * (1.0 - vAO) * 0.12;
    gTint *= 1.0 + w * (mot * 0.06 + smoothstep(0.75, 1.0, vAO) * 0.03);
    if (vPat0.z < -0.01) {
      vec4 t = vec4(0.0);
      if (bn.x > 0.03) t += ktooled(p.zy, px) * bn.x;
      if (bn.y > 0.03) t += ktooled(p.xz, px) * bn.y;
      if (bn.z > 0.03) t += ktooled(p.xy, px) * bn.z;
      H += w * t.x;
      cav += w * t.y;
      R += w * t.w;
      gTint *= 1.0 + w * t.z * 0.08;
    }
  }
  // scales / mail rings (weight > 0); weight < 0 = hammered metal (overlapping shallow dents)
  w = abs(vPat0.w);
  if (w > 0.01) {
    vec2 cc = kcell(p * (vPat0.w > 0.0 ? 85.0 : 32.0));
    float f = kfade(vPat0.w > 0.0 ? 0.012 : 0.03, px);
    if (vPat0.w > 0.0) {
      float edge = smoothstep(0.0, 0.18, cc.y - cc.x);
      float dome = 1.0 - cc.x;
      H += w * f * (dome * dome * 2.6e-4 * edge - (1.0 - edge) * 1.2e-4);
      cav += w * f * (1.0 - edge) * 0.45;
      R += w * f * (1.0 - edge) * 0.12;
    } else {
      float dent = smoothstep(0.0, 0.9, cc.x);
      float ridge = 1.0 - smoothstep(0.0, 0.12, cc.y - cc.x);
      H += w * f * ((dent * dent) * 2.2e-4 + ridge * 0.6e-4);
      R += w * f * (ridge * 0.06 - dent * 0.03);
      cav += w * f * (1.0 - dent) * 0.05;
    }
  }
  // chitin: smooth plates with grooves and fine pits
  w = vPat1.x;
  if (w > 0.01) {
    vec2 cc = kcell(p * 14.0);
    float groove = 1.0 - smoothstep(0.0, 0.06, cc.y - cc.x);
    float pits = smoothstep(0.55, 0.9, kvn(p * 420.0));
    float bumps = kvn(p * 33.0);
    H += w * (bumps * 2.2e-4 * kfade(0.03, px) - groove * 3.5e-4 * kfade(0.02, px) - pits * 3e-5 * kfade(0.0025, px));
    R += w * (pits * 0.15 + groove * 0.2 - 0.05);
    cav += w * (groove * 0.5 + pits * 0.1);
  }
  // fur / wood grain streaks (along rest +Y)
  w = vPat1.y;
  if (w > 0.01) {
    float s = kvn(vec3(p.x * 900.0, p.y * 70.0, p.z * 900.0)) * 0.6 + kvn(vec3(p.x * 300.0, p.y * 20.0, p.z * 300.0)) * 0.4;
    float f = kfade(0.0025, px);
    H += w * s * 7e-5 * f;
    R += w * s * 0.08;
    cav += w * max(-s, 0.0) * 0.3 * f;
  }
  // scratches (metal)
  w = vPat1.z;
  if (w > 0.01) {
    float s1 = 1.0 - abs(kvn(vec3(p.x * 2600.0, p.y * 60.0, p.z * 140.0)));
    float s2 = 1.0 - abs(kvn(vec3(p.x * 90.0, p.y * 2200.0 + 5.0, p.z * 1800.0)));
    float fs = kfade(0.0025, px);
    float sc = smoothstep(0.93, 1.0, max(s1, s2)) * fs;
    float wear = kvn(p * 18.0) * 0.6 + kvn(p * 70.0) * 0.4 * kfade(0.012, px);
    H += w * -sc * 1.5e-5;
    R += w * (wear * 0.1 + sc * 0.12);
    cav += w * max(wear, 0.0) * 0.08;
  }
  // wrinkles / bark
  w = vPat1.w;
  if (w > 0.01) {
    float r1 = 1.0 - abs(kvn(p * vec3(70.0, 150.0, 70.0)));
    float r2 = 1.0 - abs(kvn(p * 260.0 + 11.0));
    float wr = pow(r1, 5.0) * 0.7 + pow(r2, 6.0) * 0.3;
    H += w * -wr * 2.4e-4 * kfade(0.01, px);
    cav += w * wr * 0.35;
    R += w * wr * 0.06;
  }
  // metal: handled / exposed areas polish (lower roughness), pitted metal rusts — orange-brown,
  // rough and non-metallic — first in the crevices (low baked AO), then in blotches
  float mtl = vSurf.y;
  if (mtl > 0.05) {
    float exposed = smoothstep(0.6, 0.97, vAO);
    R -= exposed * 0.07 * mtl;
    float rw = smoothstep(0.35, 1.1, abs(vPat0.x)) * mtl;
    if (rw > 0.01) {
      float rn = kvn(p * 21.0) * 0.55 + kvn(p * 64.0 + 3.0) * 0.3 + kvn(p * 210.0 + 1.0) * 0.15 * kfade(0.006, px);
      float rust = smoothstep(-0.2, 0.45, rn + (1.0 - vAO) * 0.9 - exposed * 0.35) * rw;
      gRustK = rust * 0.92;
      gRust = mix(vec3(0.075, 0.03, 0.013), vec3(0.2, 0.072, 0.026), clamp(0.5 + rn * 0.9, 0.0, 1.0));
      R += rust * 0.28;
      H += rust * kvn(p * 480.0) * 4e-5 * kfade(0.0025, px);
    }
  }
  // seams: edge wear and a dashed stitch line along garment edges. vSeam.x is the signed distance
  // (m) to the garment edge plane, interpolated linearly — exact for planes, so it stays crisp.
  if (vSeam.y > 0.05) {
    float sw = clamp((vSeam.y - 0.05) / 0.5, 0.0, 1.0);
    float sd = abs(vSeam.x);
    float pw = fwidth(vSeam.x) * 0.75 + 1e-5;
    // burnished, lighter edge (leather) / lighter fold (cloth)
    float leatherK = clamp(abs(vPat0.z), 0.0, 1.0);
    float wear = (1.0 - smoothstep(0.0, 0.009, sd)) * sw * mix(0.3, 1.0, leatherK);
    // stitches 6 mm in from the edge: raised thread, dashed (period ≈ 5 mm)
    float line = 1.0 - smoothstep(0.0008, 0.0008 + pw + 0.0005, abs(sd - 0.006));
    float ph = fract(dot(vRest, vec3(0.83, 0.61, 0.97)) * 200.0);
    float dash = smoothstep(0.06, 0.16, ph) * (1.0 - smoothstep(0.6, 0.7, ph));
    float vis = sw * kfade(0.0045, px);
    float st = line * dash * vis;
    float hole = line * (1.0 - dash) * vis;
    H += st * 8e-5 - hole * 5e-5 - wear * 2e-5;
    R += -wear * 0.12 + st * 0.06;
    gTint *= mix( vec3( 1.0 ), vec3( 1.22, 1.17, 1.1 ), wear * 0.6 ) * mix( 1.0, mix( 0.6, 0.5, leatherK ), st ) * mix( 1.0, 0.78, hole );
  }
  gH = H * detailScale * detailStrength;
  gAlbedo = clamp(1.0 - cav, 0.55, 1.0);
  return R;
}
vec3 kitPerturb(vec3 surf_pos, vec3 surf_norm, float faceDir) {
  vec3 sx = dFdx(surf_pos);
  vec3 sy = dFdy(surf_pos);
  float dBs = dFdx(gH);
  float dBt = dFdy(gH);
  vec3 R1 = cross(sy, surf_norm);
  vec3 R2 = cross(surf_norm, sx);
  float det = dot(sx, R1) * faceDir;
  vec3 grad = sign(det) * (dBs * R1 + dBt * R2);
  return normalize(abs(det) * surf_norm - grad);
}
`;

function patchLights(): string {
  let chunk = THREE.ShaderChunk.lights_physical_pars_fragment;
  const target = 'vec3 irradiance = dotNL * directLight.color;';
  if (!chunk.includes(target)) {
    console.warn('[kit] could not patch skin wrap lighting (three.js chunk changed)');
    return chunk;
  }
  chunk = chunk.replace(
    target,
    `vec3 irradiance = dotNL * directLight.color;
	vec3 irradianceDiffuse = irradiance;
	if ( gSkin > 0.001 ) {
		float ndl = dot( geometryNormal, directLight.direction );
		float wrapW = wrapAmount * gSkin;
		float wrapped = saturate( ( ndl + wrapW ) / ( 1.0 + wrapW ) );
		float scatter = saturate( wrapped - dotNL );
		irradianceDiffuse = ( dotNL + scatter * scatterColor * 0.75 ) * directLight.color;
	}`,
  );
  chunk = chunk.replace(
    'reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseContribution );',
    'reflectedLight.directDiffuse += irradianceDiffuse * BRDF_Lambert( material.diffuseContribution );',
  );
  return chunk;
}

let patchedLights: string | null = null;

/** Create the shared creature material. Clone it per instance if you need per-instance flash. */
export function createCreatureMaterial(o: CreatureMaterialOpts = {}): THREE.MeshPhysicalMaterial {
  const mat = new THREE.MeshPhysicalMaterial({
    vertexColors: true,
    roughness: o.roughness ?? 1,
    metalness: 1,
    sheen: 1,
    sheenRoughness: 0.55,
    sheenColor: new THREE.Color(0xffffff),
    side: o.side ?? THREE.FrontSide,
    emissive: new THREE.Color(o.emissive ?? 0x000000),
    emissiveIntensity: o.emissiveIntensity ?? 1,
    clearcoat: o.clearcoat ?? 0,
    clearcoatRoughness: o.clearcoatRoughness ?? 0.3,
    specularIntensity: 0.9,
  });
  const scatter = new THREE.Color().setHex(o.scatterColor ?? 0xd0402a, THREE.SRGBColorSpace);
  const uniforms = {
    detailStrength: { value: o.detailStrength ?? 1 },
    detailScale: { value: o.detailScale ?? 1 },
    scatterColor: { value: new THREE.Vector3(scatter.r, scatter.g, scatter.b) },
    wrapAmount: { value: o.wrap ?? 0.55 },
    /** 1 = visualise the seam channel (lab debugging) */
    kitDebug: { value: 0 },
  };
  mat.userData.kitUniforms = uniforms;
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
attribute vec4 surf;
attribute vec4 pat0;
attribute vec4 pat1;
attribute float ao;
attribute vec2 seam;
varying vec2 vSeam;
varying vec4 vSurf;
varying vec4 vPat0;
varying vec4 vPat1;
varying float vAO;
varying vec3 vRest;
varying vec3 vRestN;`,
      )
      .replace(
        '#include <color_vertex>',
        `#include <color_vertex>
	vSurf = surf; vPat0 = pat0; vPat1 = pat1; vAO = ao; vRest = position; vRestN = normal; vSeam = seam;`,
      );
    if (!patchedLights) patchedLights = patchLights();
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${GLSL_COMMON}`)
      .replace('#include <lights_physical_pars_fragment>', patchedLights)
      .replace(
        '#include <roughnessmap_fragment>',
        `float kitR = kitDetail();
	gSkin = vSurf.w;
	diffuseColor.rgb *= gAlbedo * gTint;
	diffuseColor.rgb = mix( diffuseColor.rgb, gRust * gAlbedo, gRustK );
	if ( kitDebug > 0.5 ) diffuseColor.rgb = vec3( vSeam.y, 1.0 - clamp( abs( vSeam.x ) * 60.0, 0.0, 1.0 ), 0.1 );
	float roughnessFactor = clamp( ( vSurf.x + kitR ) * roughness, 0.04, 1.0 );`,
      )
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = vSurf.y * metalness * ( 1.0 - gRustK );')
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
	normal = kitPerturb( - vViewPosition, normal, faceDirection );`,
      )
      .replace(
        '#include <lights_physical_fragment>',
        `#include <lights_physical_fragment>
	#ifdef USE_SHEEN
		// cloth sheen tinted by the albedo and never brighter than it (a white or boosted sheen
		// washes cloth out to pastel under bright sky light)
		material.sheenColor = ( diffuseColor.rgb * 1.05 + 0.012 ) * vSurf.z;
	#endif
	// fibrous surfaces scatter their specular: cloth relies on sheen, not a dielectric GGX lobe
	material.specularColor *= ( 1.0 - 0.8 * vSurf.z );
	material.specularColorBlended = mix( material.specularColor, diffuseColor.rgb, metalnessFactor );
	material.specularF90 *= ( 1.0 - 0.7 * vSurf.z );`,
      )
      .replace(
        '#include <aomap_fragment>',
        `#include <aomap_fragment>
	// skin scatters light into its own creases: soften the baked AO there (no dark smears on faces),
	// but keep enough to seat the eyes in their sockets and shape lips, nostrils and muscle
	float kitAO = mix( vAO, 1.0, 0.4 * vSurf.w );
	reflectedLight.indirectDiffuse *= kitAO;
	reflectedLight.indirectSpecular *= kitAO * kitAO;
	reflectedLight.directDiffuse *= mix( 1.0, kitAO, 0.3 );`,
      );
  };
  mat.customProgramCacheKey = () => 'kit-creature-v4';
  return mat;
}

/** clone a creature material keeping the shared uniforms object semantics (independent values) */
export function cloneCreatureMaterial(src: THREE.MeshPhysicalMaterial): THREE.MeshPhysicalMaterial {
  const m = src.clone();
  const u = src.userData.kitUniforms as Record<string, { value: unknown }> | undefined;
  if (u) {
    const nu: Record<string, { value: unknown }> = {};
    for (const [k, v] of Object.entries(u)) nu[k] = { value: (v.value as { clone?: () => unknown }).clone ? (v.value as { clone: () => unknown }).clone() : v.value };
    m.userData.kitUniforms = nu;
    m.onBeforeCompile = (shader, r) => {
      src.onBeforeCompile.call(m, shader, r);
      Object.assign(shader.uniforms, nu);
    };
  }
  m.customProgramCacheKey = src.customProgramCacheKey;
  return m;
}
