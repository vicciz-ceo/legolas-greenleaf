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
  gamma: [1.0, 1.0, 1.02] as Vec3Tuple,
  gain: [0.97, 1.0, 1.06] as Vec3Tuple,
  saturation: 0.8,
  vignette: 0.32,
};

const KEY: Preset = {
  ...BASE,
  // key from the left/behind the player (the player faces north through the gorge): the crag, the
  // falls and the cliff faces turned towards him catch light instead of standing in shadow
  sunDirection: [-0.42, 0.56, -0.42],
  sunIntensity: 1.7,
  hemiIntensity: 0.78,
  envIntensity: 1.05,
  exposure: 0.98,
  bloom: 0.12,
  grade: GRADE,
  mist: 0.7,
};

const fog = (color: number, density: number) => ({ color, density });

/** the gorge: thick snow haze, but the far falls still read */
export const ENV_GORGE: Preset = { ...KEY, fog: fog(0xbac7d2, 0.0066), weatherIntensity: 0.55 };
/** the bat ride and the tower: the air opens up on the heights */
export const ENV_HEIGHTS: Preset = { ...KEY, fog: fog(0xbcc8d3, 0.0046), weatherIntensity: 0.55, sunIntensity: 1.9, mist: 0.5 };
/** the establishing shot: a lull in the snow, so the tower on its crag reads from the gorge */
export const ENV_CLEAR: Preset = { ...KEY, fog: fog(0xb6c3cf, 0.0032), weatherIntensity: 0.32, sunIntensity: 1.95, mist: 0.5 };
/** the falling stones: the storm thins on the heights so the blocks hang dark against the abyss */
export const ENV_SUMMIT: Preset = { ...KEY, fog: fog(0xb8c5d1, 0.0034), weatherIntensity: 0.42, sunIntensity: 1.95, mist: 0.5 };
/** the outro over the valley: clearer still, the armies visible below */
export const ENV_VALLEY: Preset = { ...KEY, fog: fog(0xb4c0cc, 0.0021), weatherIntensity: 0.3, sunIntensity: 2.0, mist: 0.4 };

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
        float lay = smoothstep(0.1, 0.62, nW.y + (kMid - 0.5) * 0.7 + (kHi - 0.5) * 0.3 + (kLow - 0.5) * 0.35);
        vec3 snowDust = vec3(0.80, 0.86, 0.96) * (0.9 + 0.2 * kHi);
        colC = mix(colC, snowDust, lay * 0.92);
      }
      vec3 splat = colA * wA + colB * wB + colC * wC;`,
    );
  };
  const prevKey = m.customProgramCacheKey;
  m.customProgramCacheKey = () => prevKey.call(m) + '|rh_winter';
}
