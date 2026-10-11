/**
 * Ravenhill's look: the environment key (docs/refs/scenes/ravenhill/lighting.json folded into the
 * preset copies the chapter passes to level.setEnvironment) and the terrain's winter finish.
 */
import * as THREE from 'three';
import type { EnvironmentPreset, Vec3Tuple } from '../../../core/types';
import { ENVIRONMENTS } from '../../../core/environment';

const BASE = ENVIRONMENTS.ravenhill_winter;
/** the engine's preset also carries renderer-only extras (low ground mist, ...) */
type Preset = EnvironmentPreset & { mist?: number };

/**
 * The reference key: a pale overcast with a cold blue fill (sky #7e8c9d -> #c6d0d9, fog #bac7d2, key
 * #dbe7f7 at 1.55, hemisphere 0.7, bloom 0.12, vignette 0.32, saturation 0.78). The shadows are lifted a
 * little towards blue (the references have no black in the snow), but the rock stays dark against it.
 */
const GRADE = {
  lift: [-0.004, 0.0, 0.01] as Vec3Tuple,
  // a touch under 1: the midtones sit lower, so the dark rock and the shadows hold against the white snow
  gamma: [0.93, 0.945, 0.985] as Vec3Tuple,
  gain: [0.97, 1.0, 1.06] as Vec3Tuple,
  saturation: 0.8,
  vignette: 0.32,
};

const KEY: Preset = {
  ...BASE,
  // key from the left/behind the player (the player faces north through the gorge): the crag, the
  // falls and the cliff faces turned towards him catch light instead of standing in shadow
  sunDirection: [-0.42, 0.56, -0.42],
  sunIntensity: 1.75,
  hemiIntensity: 0.7,
  envIntensity: 1.05,
  exposure: 0.98,
  bloom: 0.12,
  grade: GRADE,
  mist: 0.7,
};

const fog = (color: number, density: number) => ({ color, density });

/** the gorge: thick snow haze, but the far falls still read */
export const ENV_GORGE: Preset = { ...KEY, fog: fog(0xbac7d2, 0.0036), weatherIntensity: 0.46 };
/** the bat ride and the tower: the air opens up on the heights */
export const ENV_HEIGHTS: Preset = { ...KEY, fog: fog(0xbcc8d3, 0.0026), weatherIntensity: 0.4, sunIntensity: 2.0, mist: 0.5 };
/** the establishing shot: a lull in the snow, so the tower on its crag reads from the gorge */
export const ENV_CLEAR: Preset = { ...KEY, fog: fog(0xb6c3cf, 0.002), weatherIntensity: 0.28, sunIntensity: 2.0, mist: 0.5 };
/** the falling stones: the storm thins on the heights so the blocks hang dark against the abyss */
export const ENV_SUMMIT: Preset = { ...KEY, fog: fog(0xb8c5d1, 0.002), weatherIntensity: 0.34, sunIntensity: 1.95, sunColor: 0xf2e6d4, sunDirection: [-0.6, 0.42, -0.35], mist: 0.5 };
/** the outro over the valley: clearer still, the armies visible below */
export const ENV_VALLEY: Preset = { ...KEY, fog: fog(0xb4c0cc, 0.0014), weatherIntensity: 0.25, sunIntensity: 2.05, mist: 0.4 };

// ─────────────────────────────────────────────────────────────────────────────
// Terrain finish
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Winter finish for the splat terrain: the steep layer (the gorge walls and the crag) is a cold
 * blue-grey rock instead of the stock brown, with snow lying on its ledges and on every slope that
 * faces upward, broken up by noise so the walls read as rock with snow patches, not stripes.
 */
export function tuneTerrain(mesh: THREE.Mesh): void {
  const m = mesh.material as THREE.MeshStandardMaterial;
  const prev = m.onBeforeCompile;
  m.onBeforeCompile = (shader, renderer) => {
    prev.call(m, shader, renderer);
    const u = shader.uniforms;
    // the splat shader exposes one tint per layer: flat snow, patches, steep rock
    if (u.uTintC) (u.uTintC.value as THREE.Vector3).set(0.5, 0.56, 0.68);
    if (u.uTintB) (u.uTintB.value as THREE.Vector3).set(0.7, 0.76, 0.86);
    if (u.uTintA) (u.uTintA.value as THREE.Vector3).set(0.97, 1.0, 1.06);
    shader.fragmentShader = shader.fragmentShader.replace(
      'vec3 splat = colA * wA + colB * wB + colC * wC;',
      /* glsl */ `
      {
        // snow on the ledges: upward-facing parts of the rock, patchy, with the thinnest cover on the steepest faces
        float lay = smoothstep(0.3, 0.8, nW.y + (kMid - 0.5) * 0.9 + (kHi - 0.5) * 0.4 + (kLow - 0.5) * 0.5);
        vec3 snowDust = vec3(0.80, 0.86, 0.96) * (0.9 + 0.2 * kHi);
        colC = mix(colC, snowDust, lay * 0.9);
      }
      vec3 splat = colA * wA + colB * wB + colC * wC;`,
    );
  };
  const prevKey = m.customProgramCacheKey;
  m.customProgramCacheKey = () => prevKey.call(m) + '|rh_winter';
}

// ─────────────────────────────────────────────────────────────────────────────
// Winter finish for stone and rock (snow on every upward face)
// ─────────────────────────────────────────────────────────────────────────────

const winterMats = new Map<string, THREE.Material>();

/**
 * Give a stone/rock material a winter finish: snow lying on every upward-facing surface (broken up by
 * noise, so ledges and the tops of blocks are white and the sides stay dark), and the rock itself
 * pulled towards a cool blue-grey with its crack contrast eased. The shared (cached) material is cloned,
 * never edited, so the other chapters' stone is untouched.
 */
function winterMaterial(src: THREE.Material, snow: number): THREE.Material {
  const key = `${src.uuid}|${snow}`;
  let m = winterMats.get(key);
  if (m) return m;
  m = src.clone();
  const std = m as THREE.MeshStandardMaterial;
  const prev = std.onBeforeCompile;
  std.onBeforeCompile = (shader, renderer) => {
    prev?.call(std, shader, renderer);
    shader.vertexShader = shader.vertexShader
      .replace('void main() {', 'varying vec3 vRhN;\nvarying vec3 vRhP;\nvoid main() {')
      .replace(
        '#include <beginnormal_vertex>',
        /* glsl */ `#include <beginnormal_vertex>
        {
          vec3 rhn = objectNormal;
          #ifdef USE_INSTANCING
            rhn = mat3(instanceMatrix) * rhn;
          #endif
          vRhN = normalize(mat3(modelMatrix) * rhn);
        }`,
      )
      .replace(
        '#include <begin_vertex>',
        /* glsl */ `#include <begin_vertex>
        {
          vec4 rhp = vec4(transformed, 1.0);
          #ifdef USE_INSTANCING
            rhp = instanceMatrix * rhp;
          #endif
          vRhP = (modelMatrix * rhp).xyz;
        }`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        'void main() {',
        /* glsl */ `varying vec3 vRhN;
        varying vec3 vRhP;
        float rhH(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
        float rhV(vec3 p) {
          vec3 i = floor(p); vec3 f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(mix(rhH(i), rhH(i + vec3(1,0,0)), f.x), mix(rhH(i + vec3(0,1,0)), rhH(i + vec3(1,1,0)), f.x), f.y),
                     mix(mix(rhH(i + vec3(0,0,1)), rhH(i + vec3(1,0,1)), f.x), mix(rhH(i + vec3(0,1,1)), rhH(i + vec3(1,1,1)), f.x), f.y), f.z);
        }
        void main() {`,
      )
      .replace(
        '#include <color_fragment>',
        /* glsl */ `#include <color_fragment>
        {
          float rhn = rhV(vRhP * 1.15) * 0.6 + rhV(vRhP * 4.3) * 0.4;
          float lay = smoothstep(0.38, 0.8, normalize(vRhN).y + (rhn - 0.5) * 0.6);
          float l = dot(diffuseColor.rgb, vec3(0.3, 0.59, 0.11));
          vec3 rockC = mix(diffuseColor.rgb, vec3(l) * vec3(0.9, 0.97, 1.1), 0.4);
          vec3 snowC = vec3(0.78, 0.85, 0.95) * (0.9 + 0.2 * rhn);
          diffuseColor.rgb = mix(rockC, snowC, lay * ${snow.toFixed(2)});
        }`,
      );
  };
  const prevKey = std.customProgramCacheKey;
  std.customProgramCacheKey = () => `${prevKey.call(std)}|rh_wintermat_${snow}`;
  winterMats.set(key, m);
  return m;
}

/** winter-finish every mesh under `root` (instanced or not); `snow` 0..1 is how white the upward faces go */
export function winterize(root: THREE.Object3D, snow = 0.85): void {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const m = mesh.material;
    if (Array.isArray(m) || !(m as THREE.MeshStandardMaterial).isMeshStandardMaterial) return;
    mesh.material = winterMaterial(m, snow);
  });
}
