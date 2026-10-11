/**
 * Cinematic character light (owner: shell, finishing pass).
 *
 * While a chapter runs a cinematic (level.cinematic(true)) or a scripted camera shot, a soft key light
 * rides with the camera, up and to the left of the lens, so the faces in a close-up read instead of
 * sinking into the shadow side. It never casts shadows and has a short reach (it lights what the
 * camera is framing, not the set behind it).
 *
 * The light lives in the scene for the whole session with intensity 0 when idle: adding or removing a
 * light changes the light count and recompiles every material, an intensity change does not.
 * Brightness follows the environment (a fraction of its sun + sky light), so a night scene gets a
 * night-strength fill. Chapters tune or disable it with `level.characterLight?.(...)`.
 */
import * as THREE from 'three';
import type { EnvironmentPreset } from '../core/types';
import { damp } from '../core/math';

/** how far the light reaches (m) */
const RANGE = 9;
/** typical lens-to-face distance the brightness is computed for (m) */
const SUBJECT_D = 2.5;

export interface CharacterLight {
  readonly light: THREE.PointLight;
  /** ease toward on/off; place the light relative to the camera. dtReal in seconds. */
  update(dtReal: number, on: boolean, opts: { intensity: number; color: number } | null, camera: THREE.Camera, env: EnvironmentPreset): void;
  /** off at once (level unload) */
  reset(): void;
  dispose(): void;
}

/** target intensity (candela) for an environment: ~a quarter of the sun plus ~half the sky light at the subject */
export function characterLightIntensity(env: Pick<EnvironmentPreset, 'sunIntensity' | 'hemiIntensity'>, mul = 1): number {
  const lux = 0.25 * (env.sunIntensity ?? 0) + 0.45 * (env.hemiIntensity ?? 0);
  return Math.min(16, Math.max(2, lux * SUBJECT_D * SUBJECT_D)) * Math.max(0, mul);
}

const _right = new THREE.Vector3();
const _up = new THREE.Vector3();
const _fwd = new THREE.Vector3();

export function createCharacterLight(scene: THREE.Scene): CharacterLight {
  const light = new THREE.PointLight(0xfff1e0, 0, RANGE, 2);
  light.castShadow = false;
  light.name = 'character-light';
  scene.add(light);
  let k = 0;
  return {
    light,
    update(dtReal, on, opts, camera, env) {
      const want = on && opts ? 1 : 0;
      k = damp(k, want, want > k ? 2.5 : 4, Math.max(0, dtReal));
      if (Math.abs(k - want) < 1e-3) k = want;
      if (opts) light.color.setHex(opts.color);
      light.intensity = k * characterLightIntensity(env, opts?.intensity ?? 1);
      if (light.intensity <= 0) return;
      camera.updateMatrixWorld();
      const e = camera.matrixWorld.elements;
      _right.set(e[0], e[1], e[2]).normalize();
      _up.set(e[4], e[5], e[6]).normalize();
      _fwd.set(-e[8], -e[9], -e[10]).normalize();
      // key from up-left of the lens and a little ahead of it
      light.position.set(e[12], e[13], e[14]).addScaledVector(_right, -0.9).addScaledVector(_up, 0.75).addScaledVector(_fwd, 0.35);
    },
    reset() {
      k = 0;
      light.intensity = 0;
    },
    dispose() {
      light.removeFromParent();
      light.dispose();
    },
  };
}
