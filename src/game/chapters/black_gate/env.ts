/**
 * Lighting for the Black Gate: a tweaked copy of the `black_gate` preset. The red sun sits low in
 * the north-north-east (behind the Gate, over Orodruin) so the hosts and the hills read as dark
 * shapes rimmed in ember light, with a cold-ash fill from the sky dome so shadows are not black
 * soup. `lerpEnv` blends two presets for the finale (the sky clears a little when Sauron falls).
 */
import * as THREE from 'three';
import { ENVIRONMENTS, type EnvironmentPresetEx } from '../../../core/environment';
import type { SkyDef, Vec3Tuple } from '../../../core/types';

const base = ENVIRONMENTS.black_gate as EnvironmentPresetEx;

export const WAR: EnvironmentPresetEx = {
  ...base,
  name: base.name, // keeps the preset's reverb
  sky: { kind: 'gradient', top: 0x140d0d, horizon: 0x93421f, bottom: 0x1c100c, stars: 0, clouds: 0.92, cloudColor: 0x5a2616 },
  sunColor: 0xff8440,
  sunIntensity: 2.7,
  sunDirection: [0.34, 0.17, -0.92],
  hemiSky: 0x8a7872,
  hemiGround: 0x30241f,
  hemiIntensity: 1.85,
  envIntensity: 1.15,
  fog: { color: 0x47281c, density: 0.0044 },
  exposure: 1.42,
  bloom: 0.5,
  grade: { lift: [0.022, 0.012, 0.02], gamma: [1.0, 0.99, 0.98], gain: [1.1, 0.96, 0.84], saturation: 0.8, vignette: 0.52 },
  mist: 0.28,
  weather: 'ash',
  weatherIntensity: 0.9,
  glow: 1.5,
  glowColor: 0xff5a1c,
  horizonGlow: 0xff5a1c,
  horizonGlowAmount: 0.38,
  cloudLit: 0xd4682a,
  cloudShade: 0x1c1010,
  cloudSoft: 0.7,
  haze: 0.9,
};

/** after the fall: the cloud deck thins, the sky greys and cools, the red goes out of the light */
export const PEACE: EnvironmentPresetEx = {
  ...WAR,
  sky: { kind: 'gradient', top: 0x3a4a6a, horizon: 0xe0b080, bottom: 0x2c2622, stars: 0, clouds: 0.55, cloudColor: 0xb8a090 },
  sunColor: 0xffd0a0,
  sunIntensity: 3.0,
  sunDirection: [0.2, 0.3, -0.93],
  hemiSky: 0xa4aab8,
  hemiGround: 0x3a3430,
  hemiIntensity: 1.2,
  fog: { color: 0x8a7c78, density: 0.0028 },
  exposure: 1.15,
  bloom: 0.4,
  grade: { lift: [0.01, 0.008, 0.012], gamma: [1, 1, 1], gain: [1.06, 1.0, 0.92], saturation: 1.0, vignette: 0.42 },
  mist: 0.5,
  weather: 'ash',
  weatherIntensity: 0.25,
  glow: 1.1,
  glowColor: 0xffb070,
  horizonGlow: 0xff9a50,
  horizonGlowAmount: 0.2,
  cloudLit: 0xe8b890,
  cloudShade: 0x5a5058,
};

const A = new THREE.Color();
const B = new THREE.Color();
const lc = (a: number, b: number, t: number) => A.setHex(a).lerp(B.setHex(b), t).getHex();
const ln = (a: number, b: number, t: number) => a + (b - a) * t;
const lv = (a: Vec3Tuple, b: Vec3Tuple, t: number): Vec3Tuple => [ln(a[0], b[0], t), ln(a[1], b[1], t), ln(a[2], b[2], t)];

/** blend two presets (gradient skies only), t in 0..1 */
export function lerpEnv(a: EnvironmentPresetEx, b: EnvironmentPresetEx, t: number): EnvironmentPresetEx {
  const sa = a.sky as Extract<SkyDef, { kind: 'gradient' }>;
  const sb = b.sky as Extract<SkyDef, { kind: 'gradient' }>;
  const dir = new THREE.Vector3(...lv(a.sunDirection!, b.sunDirection!, t)).normalize();
  return {
    ...a,
    sky: { kind: 'gradient', top: lc(sa.top, sb.top, t), horizon: lc(sa.horizon, sb.horizon, t), bottom: lc(sa.bottom, sb.bottom, t), stars: 0, clouds: ln(sa.clouds ?? 0.9, sb.clouds ?? 0.6, t), cloudColor: lc(sa.cloudColor ?? 0x5a2616, sb.cloudColor ?? 0x9a8a88, t) },
    sunColor: lc(a.sunColor, b.sunColor, t),
    sunIntensity: ln(a.sunIntensity, b.sunIntensity, t),
    sunDirection: [dir.x, dir.y, dir.z],
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
    mist: ln(a.mist ?? 0.3, b.mist ?? 0.5, t),
    weatherIntensity: ln(a.weatherIntensity ?? 0.9, b.weatherIntensity ?? 0.25, t),
    glow: ln(a.glow ?? 1, b.glow ?? 1, t),
    glowColor: lc(a.glowColor ?? a.sunColor, b.glowColor ?? b.sunColor, t),
    horizonGlow: lc(a.horizonGlow ?? 0xff5a1c, b.horizonGlow ?? 0xff9a50, t),
    horizonGlowAmount: ln(a.horizonGlowAmount ?? 0.3, b.horizonGlowAmount ?? 0.2, t),
    cloudLit: lc(a.cloudLit ?? 0xd4682a, b.cloudLit ?? 0xe8b890, t),
    cloudShade: lc(a.cloudShade ?? 0x1c1010, b.cloudShade ?? 0x5a5058, t),
  };
}
