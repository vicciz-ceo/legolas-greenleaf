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
float gSkin = 0.0;
float gH = 0.0;
float gAlbedo = 1.0;

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
float kfade(float feature, float px) {
  return 1.0 - smoothstep(feature * 0.25, feature * 0.9, px);
}
// gH: height (m), gAlbedo: cavity darkening; returns roughness offset
float kitDetail() {
  vec3 p = vRest / detailScale;
  float px = length(fwidth(vRest)) / detailScale;
  float H = 0.0;
  float R = 0.0;
  float cav = 0.0;
  // pores
  float w = vPat0.x;
  if (w > 0.01) {
    float f = kfade(0.0016, px);
    float n = kvn(p * 620.0);
    float pore = smoothstep(0.35, 0.95, n);
    float micro = kvn(p * 170.0 + 7.0) * 0.5 + kvn(p * 41.0 + 3.0) * 0.5;
    H += w * (f * (-pore * 5e-5) + kfade(0.006, px) * micro * 2.5e-5);
    R += w * (pore * 0.05 * f + micro * 0.04 * kfade(0.006, px));
    cav += w * pore * 0.05 * f;
  }
  // cloth weave (triplanar)
  w = vPat0.y;
  if (w > 0.01) {
    vec3 bn = pow(abs(vRestN), vec3(4.0));
    bn /= (bn.x + bn.y + bn.z + 1e-5);
    float sc = 560.0;
    float wv = kweave2(p.yz * sc) * bn.x + kweave2(p.xz * sc) * bn.y + kweave2(p.xy * sc) * bn.z;
    float f = kfade(1.0 / sc, px);
    float lump = kvn(p * 40.0) * 0.6 + kvn(p * 9.0) * 0.4;
    H += w * (f * (wv - 0.5) * 9e-5 + lump * 1.2e-4 * kfade(0.03, px));
    R += w * ((0.5 - wv) * 0.08 * f + lump * 0.05);
    cav += w * (1.0 - wv) * 0.12 * f;
  }
  // leather grain + creases
  w = vPat0.z;
  if (w > 0.01) {
    float g = kvn(p * 380.0) * 0.6 + kvn(p * 900.0) * 0.4;
    float c = 1.0 - abs(kvn(p * vec3(55.0, 22.0, 55.0)));
    c = pow(c, 6.0);
    float big = kvn(p * 12.0);
    H += w * (g * 3.5e-5 * kfade(0.002, px) - c * 1.2e-4 * kfade(0.012, px));
    R += w * (big * 0.08 + c * 0.08 - g * 0.04);
    cav += w * (c * 0.18 + max(big, 0.0) * 0.05);
  }
  // scales / mail rings
  w = vPat0.w;
  if (w > 0.01) {
    vec2 cc = kcell(p * 85.0);
    float edge = smoothstep(0.0, 0.18, cc.y - cc.x);
    float dome = 1.0 - cc.x;
    float f = kfade(0.012, px);
    H += w * f * (dome * dome * 2.6e-4 * edge - (1.0 - edge) * 1.2e-4);
    cav += w * f * (1.0 - edge) * 0.45;
    R += w * f * (1.0 - edge) * 0.12;
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
  gH = H * detailScale * detailStrength;
  gAlbedo = clamp(1.0 - cav, 0.6, 1.0);
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
	vSurf = surf; vPat0 = pat0; vPat1 = pat1; vAO = ao; vRest = position; vRestN = normal;`,
      );
    if (!patchedLights) patchedLights = patchLights();
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${GLSL_COMMON}`)
      .replace('#include <lights_physical_pars_fragment>', patchedLights)
      .replace(
        '#include <roughnessmap_fragment>',
        `float kitR = kitDetail();
	gSkin = vSurf.w;
	diffuseColor.rgb *= gAlbedo;
	float roughnessFactor = clamp( ( vSurf.x + kitR ) * roughness, 0.04, 1.0 );`,
      )
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = vSurf.y * metalness;')
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
	normal = kitPerturb( - vViewPosition, normal, faceDirection );`,
      )
      .replace(
        '#include <lights_physical_fragment>',
        `#include <lights_physical_fragment>
	#ifdef USE_SHEEN
		// cloth sheen tinted by the albedo (a white sheen washes dark cloth out)
		material.sheenColor = mix( vec3( 0.04 ), diffuseColor.rgb * 1.6 + 0.03, 0.85 ) * vSurf.z;
	#endif
	// fibrous surfaces scatter their specular: cloth relies on sheen, not a dielectric GGX lobe
	material.specularColor *= ( 1.0 - 0.8 * vSurf.z );
	material.specularColorBlended = mix( material.specularColor, diffuseColor.rgb, metalnessFactor );
	material.specularF90 *= ( 1.0 - 0.7 * vSurf.z );`,
      )
      .replace(
        '#include <aomap_fragment>',
        `#include <aomap_fragment>
	reflectedLight.indirectDiffuse *= vAO;
	reflectedLight.indirectSpecular *= vAO * vAO;
	reflectedLight.directDiffuse *= mix( 1.0, vAO, 0.35 );`,
      );
  };
  mat.customProgramCacheKey = () => 'kit-creature-v1';
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
