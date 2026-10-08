/**
 * Shader patching helpers shared by all world modules (macro variation, wind, ...).
 */
import * as THREE from 'three';

type Shader = Parameters<THREE.Material['onBeforeCompile']>[0];

/** Chain an extra onBeforeCompile hook onto a material (keeps earlier hooks and extends the program cache key). */
export function patchShader(mat: THREE.Material, key: string, fn: (shader: Shader) => void): void {
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, renderer) => {
    prev.call(mat, shader, renderer);
    fn(shader);
  };
  const prevKey = mat.customProgramCacheKey;
  mat.customProgramCacheKey = () => prevKey.call(mat) + '|' + key;
}

export const GLSL_HASH_NOISE = /* glsl */ `
float wHash3(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float wNoise3(vec3 x){
  vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(wHash3(i + vec3(0,0,0)), wHash3(i + vec3(1,0,0)), f.x), mix(wHash3(i + vec3(0,1,0)), wHash3(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(wHash3(i + vec3(0,0,1)), wHash3(i + vec3(1,0,1)), f.x), mix(wHash3(i + vec3(0,1,1)), wHash3(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float wFbm3(vec3 p){ return wNoise3(p) * 0.55 + wNoise3(p * 2.17 + 7.1) * 0.3 + wNoise3(p * 4.7 + 3.3) * 0.15; }
`;

export interface MacroOpts {
  /** world-space frequency, 1/metres (default 0.07 = ~14 m features) */
  scale?: number;
  /** brightness variation 0..1 (default 0.3) */
  strength?: number;
  /** hue-ish warm/cool variation 0..1 (default 0.08) */
  tint?: number;
  /** vertical rain-streak weathering 0..1 (stone walls). default 0 */
  streaks?: number;
}

/**
 * World-space low-frequency brightness/tint variation on albedo: kills visible tiling on large
 * surfaces. Works on instanced and normal meshes.
 */
export function applyMacroVariation(mat: THREE.Material, o: MacroOpts = {}): void {
  const scale = o.scale ?? 0.07;
  const strength = o.strength ?? 0.3;
  const tint = o.tint ?? 0.08;
  const streaks = o.streaks ?? 0;
  patchShader(mat, `macro${scale}_${strength}_${tint}_${streaks}`, (shader) => {
    shader.uniforms.uMacro = { value: new THREE.Vector3(scale, strength, tint) };
    shader.uniforms.uStreak = { value: streaks };
    shader.uniforms.uStreakBase = { value: 0 };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vMacroPos;')
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        {
          vec4 mw = vec4(transformed, 1.0);
          #ifdef USE_INSTANCING
            mw = instanceMatrix * mw;
          #endif
          vMacroPos = (modelMatrix * mw).xyz;
        }`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vMacroPos;\nuniform vec3 uMacro;\nuniform float uStreak;\nuniform float uStreakBase;\n${GLSL_HASH_NOISE}`)
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        {
          float mv = wFbm3(vMacroPos * uMacro.x);
          float mv2 = wNoise3(vMacroPos * uMacro.x * 0.37 + 11.0);
          diffuseColor.rgb *= 1.0 + (mv - 0.5) * 2.0 * uMacro.y;
          diffuseColor.rgb *= vec3(1.0 + (mv2 - 0.5) * uMacro.z * 2.0, 1.0, 1.0 - (mv2 - 0.5) * uMacro.z * 2.0);
          if (uStreak > 0.0) {
            float hz = vMacroPos.x * 0.55 + vMacroPos.z * 0.55;
            float st = wNoise3(vec3(hz * 1.7, vMacroPos.y * 0.06, 3.0)) * 0.6 + wNoise3(vec3(hz * 4.3, vMacroPos.y * 0.16, 9.0)) * 0.4;
            float drip = smoothstep(0.52, 0.8, st);
            float soil = 1.0 - smoothstep(0.0, 5.0, vMacroPos.y - uStreakBase);
            diffuseColor.rgb *= 1.0 - uStreak * (drip * 0.55 + soil * 0.25);
          }
        }`,
      );
  });
}

/** Shared wind uniforms. Updated automatically from performance.now() by materials via onBeforeRender helpers. */
export const windUniforms = {
  uTime: { value: 0 },
  uWindDir: { value: new THREE.Vector2(0.8, 0.6) },
  uWindStrength: { value: 1 },
};
let windOverride: number | null = null;
/** Freeze wind time (used by deterministic lab snapshots). Pass null to resume. */
export function setWindTime(t: number | null): void {
  windOverride = t;
  if (t !== null) windUniforms.uTime.value = t;
}
export function tickWind(): void {
  windUniforms.uTime.value = windOverride ?? performance.now() / 1000;
}

/**
 * Vertex wind sway. Geometry needs a vec2 attribute `aWind`: x = bend weight (0 at the root, 1 at the
 * top), y = flutter weight (leaves). `heightScale` converts weight to metres of sway at full strength.
 */
export function applyWind(mat: THREE.Material, o: { bend?: number; flutter?: number } = {}): void {
  const bend = o.bend ?? 0.35;
  const flutter = o.flutter ?? 0.12;
  patchShader(mat, `wind${bend}_${flutter}`, (shader) => {
    shader.uniforms.uTime = windUniforms.uTime;
    shader.uniforms.uWindDir = windUniforms.uWindDir;
    shader.uniforms.uWindStrength = windUniforms.uWindStrength;
    shader.uniforms.uWindParams = { value: new THREE.Vector2(bend, flutter) };
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        attribute vec2 aWind;
        uniform float uTime; uniform vec2 uWindDir; uniform float uWindStrength; uniform vec2 uWindParams;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        {
          vec3 wbase = vec3(modelMatrix[3].xyz);
          #ifdef USE_INSTANCING
            wbase = (modelMatrix * vec4(instanceMatrix[3].xyz, 1.0)).xyz;
          #endif
          float ph = wbase.x * 0.11 + wbase.z * 0.083;
          float gust = sin(uTime * 0.7 + ph) * 0.55 + sin(uTime * 1.9 + ph * 1.7) * 0.3 + sin(uTime * 0.23 + ph * 0.3) * 0.5 + 0.35;
          float b = aWind.x * aWind.x * uWindParams.x * uWindStrength;
          transformed.xz += uWindDir * gust * b;
          float fl = aWind.y * uWindParams.y * uWindStrength;
          transformed += vec3(sin(uTime * 4.3 + position.x * 5.1 + position.z * 3.7 + ph),
                              sin(uTime * 3.1 + position.y * 4.3 + ph * 2.0) * 0.6,
                              sin(uTime * 3.7 + position.z * 5.9 + position.x * 2.3)) * fl * (0.5 + gust * 0.5);
        }`,
      );
  });
}
