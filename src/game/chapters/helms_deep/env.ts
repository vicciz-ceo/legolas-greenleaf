/**
 * Helm's Deep lighting: the storm night (a tweaked copy of helms_deep_storm with less fog, so the
 * host in the coomb reads as a dark sea with torches) and the dawn the Hornburg survives to.
 * lerpEnv() blends them for the dawn ramp (applied in a handful of steps: every setEnvironment
 * re-bakes the image-based lighting).
 */
import * as THREE from 'three';
import { ENVIRONMENTS, type EnvironmentPresetEx } from '../../../core/environment';
import type { SkyDef, Vec3Tuple } from '../../../core/types';

const base = ENVIRONMENTS.helms_deep_storm as EnvironmentPresetEx;
const baseSky = base.sky as Extract<SkyDef, { kind: 'gradient' }>;

/**
 * The storm night. Starts from the preset and folds in the reference pack's lighting key
 * (docs/refs/scenes/helms_deep/lighting.json): a neutral moonlight (#9baecb) instead of the
 * blue-purple wash, a cooler and darker shadow fill, bloom held back to flames and hot glints,
 * a light vignette so the flanks stay readable. Intensities are judged by eye against the
 * gameplay_view reference (the json's absolute numbers assume a different baseline).
 */
export const STORM: EnvironmentPresetEx = {
  ...base,
  // the moon stands behind the coomb and to the west (azimuth 300): it rakes the outer wall face, the
  // merlons throw long shadows across the walkway, and the Hornburg's west face (the one the gameplay
  // camera sees from the wall) is lit instead of a dark silhouette
  sky: { ...baseSky, top: 0x03060d, horizon: 0x22304a, bottom: 0x05070c, clouds: 1, cloudColor: 0x26344c, moon: { elevation: 38, azimuth: 300, size: 2.4, color: 0xaebfe0 } },
  sunColor: 0x9baecb,
  sunIntensity: 1.05,
  // the ground bounce is what lights the shadow side of the walls and the stair (a near-black ground colour
  // left every face away from the moon pitch black)
  hemiSky: 0x2e405c,
  hemiGround: 0x17202c,
  hemiIntensity: 1.45,
  envIntensity: 0.6,
  // FogExp2: thick fog swallows the host and the Hornburg; the json's 0.01 is for a stage with
  // its own haze layers, here the fog stays thin and the ground mist (below) does the layering
  fog: { color: 0x16202e, density: 0.0058 },
  exposure: 1.5,
  bloom: 0.2,
  grade: { lift: [0.0, 0.005, 0.016], gamma: [0.98, 1.0, 1.04], gain: [0.93, 0.99, 1.1], saturation: 0.82, vignette: 0.32 },
  mist: 0.5,
  // clouds a little lighter than the sky behind them, so the storm has a ceiling and the ridges a backdrop
  cloudLit: 0x3e4f70,
  cloudShade: 0x0f141d,
  weather: 'storm',
  // the rain was a curtain across the whole frame (notes: gap 1): much thinner (0.72 -> 0.42 -> 0.22), so the
  // wall, the host and the crosshair zone read through it
  weatherIntensity: 0.22,
};

export const DAWN: EnvironmentPresetEx = {
  ...STORM,
  name: STORM.name, // keeps the preset's reverb
  sky: { kind: 'gradient', top: 0x41557a, horizon: 0xd99a6e, bottom: 0x3a3836, stars: 0, clouds: 0.75, cloudColor: 0x8a7f86, moon: { elevation: 34, azimuth: 75, size: 0.01, color: 0xaebfe0 } },
  sunDirection: [0.82, 0.1, 0.56],
  sunColor: 0xffb47a,
  sunIntensity: 2.6,
  hemiSky: 0x8b97b0,
  hemiGround: 0x3a3229,
  hemiIntensity: 0.95,
  envIntensity: 0.9,
  fog: { color: 0x8c8790, density: 0.0042 },
  exposure: 1.1,
  bloom: 0.4,
  grade: { lift: [0.01, 0.006, 0.0], gamma: [1.0, 1.0, 1.0], gain: [1.08, 1.0, 0.9], saturation: 0.98, vignette: 0.42 },
  mist: 0.7,
  glow: 1.5,
  glowColor: 0xffa060,
  sunDisc: 0.7,
  sunSize: 1.1,
  cloudLit: 0xe8b090,
  cloudShade: 0x4a4656,
  weather: 'rain',
  weatherIntensity: 0.12,
  ambience: 'rain',
};

const _a = new THREE.Color();
const _b = new THREE.Color();
const lc = (a: number, b: number, t: number) => _a.setHex(a).lerp(_b.setHex(b), t).getHex();
const ln = (a: number, b: number, t: number) => a + (b - a) * t;
const lv = (a: Vec3Tuple, b: Vec3Tuple, t: number): Vec3Tuple => [ln(a[0], b[0], t), ln(a[1], b[1], t), ln(a[2], b[2], t)];

function dirOf(e: EnvironmentPresetEx): Vec3Tuple {
  if (e.sunDirection) return e.sunDirection;
  const s = e.sky as Extract<SkyDef, { kind: 'gradient' }>;
  const m = s.moon!;
  const el = THREE.MathUtils.degToRad(m.elevation);
  const az = THREE.MathUtils.degToRad(m.azimuth);
  return [Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)];
}

/** blend storm night -> dawn, t in 0..1 */
export function lerpEnv(a: EnvironmentPresetEx, b: EnvironmentPresetEx, t: number): EnvironmentPresetEx {
  const sa = a.sky as Extract<SkyDef, { kind: 'gradient' }>;
  const sb = b.sky as Extract<SkyDef, { kind: 'gradient' }>;
  const da = dirOf(a);
  const db = dirOf(b);
  const dir = new THREE.Vector3(...lv(da, db, t)).normalize();
  return {
    ...a,
    name: a.name,
    sky: {
      kind: 'gradient',
      top: lc(sa.top, sb.top, t),
      horizon: lc(sa.horizon, sb.horizon, t),
      bottom: lc(sa.bottom, sb.bottom, t),
      stars: 0,
      clouds: ln(sa.clouds ?? 1, sb.clouds ?? 1, t),
      cloudColor: lc(sa.cloudColor ?? 0x1d2736, sb.cloudColor ?? 0x1d2736, t),
      moon: { ...sa.moon!, size: ln(sa.moon!.size, sb.moon!.size, Math.min(1, t * 1.6)) },
    },
    sunDirection: [dir.x, dir.y, dir.z],
    sunColor: lc(a.sunColor, b.sunColor, t),
    sunIntensity: ln(a.sunIntensity, b.sunIntensity, t),
    hemiSky: lc(a.hemiSky, b.hemiSky, t),
    hemiGround: lc(a.hemiGround, b.hemiGround, t),
    hemiIntensity: ln(a.hemiIntensity, b.hemiIntensity, t),
    envIntensity: ln(a.envIntensity, b.envIntensity, t),
    fog: { color: lc(a.fog.color, b.fog.color, t), density: ln(a.fog.density, b.fog.density, t) },
    exposure: ln(a.exposure, b.exposure, t),
    bloom: ln(a.bloom, b.bloom, t),
    grade: {
      lift: lv(a.grade.lift, b.grade.lift, t),
      gamma: lv(a.grade.gamma, b.grade.gamma, t),
      gain: lv(a.grade.gain, b.grade.gain, t),
      saturation: ln(a.grade.saturation, b.grade.saturation, t),
      vignette: ln(a.grade.vignette, b.grade.vignette, t),
    },
    mist: ln(a.mist ?? 0, b.mist ?? 0, t),
    glow: ln(a.glow ?? 1, b.glow ?? 1, t),
    glowColor: lc(a.glowColor ?? a.sunColor, b.glowColor ?? b.sunColor, t),
    sunDisc: ln(a.sunDisc ?? 0, b.sunDisc ?? 0, t * t),
    sunSize: ln(a.sunSize ?? 0.6, b.sunSize ?? 0.6, t),
    cloudLit: lc(a.cloudLit ?? 0x2a3446, b.cloudLit ?? 0x2a3446, t),
    cloudShade: lc(a.cloudShade ?? 0x0c1018, b.cloudShade ?? 0x0c1018, t),
    weather: t < 0.85 ? 'storm' : 'rain',
    weatherIntensity: t < 0.85 ? ln(a.weatherIntensity ?? 0.22, 0.2, t / 0.85) : ln(0.45, b.weatherIntensity ?? 0.1, (t - 0.85) / 0.15),
  };
}
