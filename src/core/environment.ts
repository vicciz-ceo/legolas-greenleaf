/**
 * Environments: art-directed presets for every EnvironmentName + the procedural sky.
 *
 * Sky = (a) the physical `Sky` addon (preetham atmosphere) with a procedural cloud/haze layer on
 * top, or (b) a gradient dome with stars, moon, milky way and clouds, or (c) a plain cave dome.
 * The same meshes are used for the visible sky (a dome that follows the camera, drawn first with
 * depth tests off) and for the PMREM bake that lights the scene (image-based lighting).
 *
 * The horizon haze is tinted with the FogExp2 colour, so distant geometry dissolves into the sky
 * without a seam.
 */
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import type { EnvironmentName, EnvironmentPreset, SkyDef, Vec3Tuple } from './types';

// ─────────────────────────────────────────────────────────────────────────────
// Preset extensions (all optional, so plain EnvironmentPreset objects keep working)
// ─────────────────────────────────────────────────────────────────────────────

export interface EnvironmentPresetEx extends EnvironmentPreset {
  /** 0..2 volumetric light-shaft strength (ray-marched through the sun shadow map). Default 0 = off. */
  shafts?: number;
  /** 0..1.5 low ground mist (fx draws wisps of fog colour near the ground). Default 0. */
  mist?: number;
  /** S-curve contrast applied in the grade pass (default 1.12) */
  contrast?: number;
  /** 0..1 how strongly the horizon dissolves into the fog colour. Default 0.95. */
  haze?: number;
  /** height of the haze band as a sine of elevation (default derived from fog density) */
  hazeHeight?: number;
  /** 0..2 strength of the warm glow around the key light in gradient skies (default 1) */
  glow?: number;
  /** colour of that glow (default = sunColor) */
  glowColor?: number;
  /** override cloud lit / shadowed colours (sRGB hex) */
  cloudLit?: number;
  cloudShade?: number;
  /** cloud drift speed multiplier (default 1) */
  cloudSpeed?: number;
  /** cloud feature size multiplier (default 1; larger = smaller clouds) */
  cloudScale?: number;
  /** cloud softness 0..1 (default 0.5; higher = fluffier overcast) */
  cloudSoft?: number;
  /** brightness multiplier of the physical sky (default 0.4) */
  skyGain?: number;
  /** 0..1 visible sun disc brightness (default 1 for physical skies, 0 for gradient skies) */
  sunDisc?: number;
  /** apparent sun radius in degrees (default 0.6) */
  sunSize?: number;
  /** extra emissive glow along the lower horizon (Mordor), sRGB hex */
  horizonGlow?: number;
  horizonGlowAmount?: number;
}

export function resolvePreset(p: EnvironmentName | EnvironmentPreset): EnvironmentPresetEx {
  return typeof p === 'string' ? (ENVIRONMENTS[p] as EnvironmentPresetEx) : (p as EnvironmentPresetEx);
}

const _tmpV = new THREE.Vector3();

/** direction FROM the scene TOWARD the key light */
export function lightDirectionOf(env: EnvironmentPresetEx, out: THREE.Vector3): THREE.Vector3 {
  if (env.sunDirection) return out.set(env.sunDirection[0], env.sunDirection[1], env.sunDirection[2]).normalize();
  const s = env.sky;
  if (s.kind === 'physical') return dirFromAngles(s.elevation, s.azimuth, out);
  if (s.kind === 'gradient' && s.moon) return dirFromAngles(s.moon.elevation, s.moon.azimuth, out);
  return out.set(0.35, 0.85, 0.4).normalize();
}

export function dirFromAngles(elevationDeg: number, azimuthDeg: number, out: THREE.Vector3): THREE.Vector3 {
  const el = THREE.MathUtils.degToRad(elevationDeg);
  const az = THREE.MathUtils.degToRad(azimuthDeg);
  return out.set(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
}

// ─────────────────────────────────────────────────────────────────────────────
// Sky dome shader
// ─────────────────────────────────────────────────────────────────────────────

const DOME_VS = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = position;
    vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_Position = p.xyww; // depth = 1 (far plane)
  }`;

const DOME_FS = /* glsl */ `
  precision highp float;
  varying vec3 vDir;

  uniform float uMode;        // 0 = overlay on top of the physical sky, 1 = gradient, 2 = cave
  uniform vec3 uTop;
  uniform vec3 uHorizon;
  uniform vec3 uBottom;
  uniform vec3 uFog;
  uniform float uHazeK;
  uniform float uHazeAmt;
  uniform vec3 uSunDir;
  uniform vec3 uSunCol;
  uniform vec3 uGlowCol;
  uniform float uGlowAmt;
  uniform float uGlowPow;
  uniform vec3 uHGlowCol;
  uniform float uHGlowAmt;
  uniform float uCover;
  uniform float uSoft;
  uniform float uCloudScale;
  uniform float uCloudSpeed;
  uniform vec3 uCloudLit;
  uniform vec3 uCloudShade;
  uniform float uStars;
  uniform vec3 uMoonDir;
  uniform vec3 uMoonCol;
  uniform float uMoonSize;    // angular radius, radians
  uniform float uMoonOn;
  uniform float uSunDisc;
  uniform float uSunSize;
  uniform float uTime;
  uniform float uFlash;
  uniform vec3 uFlashDir;

  float hash12(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }
  float hash13(vec3 p3) {
    p3 = fract(p3 * 0.1031);
    p3 += dot(p3, p3.zyx + 31.32);
    return fract((p3.x + p3.y) * p3.z);
  }
  vec3 hash33(vec3 p3) {
    p3 = fract(p3 * vec3(0.1031, 0.1030, 0.0973));
    p3 += dot(p3, p3.yxz + 33.33);
    return fract((p3.xxy + p3.yxx) * p3.zyx);
  }
  float vn(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), f.x),
               mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), f.x), f.y);
  }
  float vn3(vec3 p) {
    vec3 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(hash13(i), hash13(i + vec3(1,0,0)), f.x),
                   mix(hash13(i + vec3(0,1,0)), hash13(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(hash13(i + vec3(0,0,1)), hash13(i + vec3(1,0,1)), f.x),
                   mix(hash13(i + vec3(0,1,1)), hash13(i + vec3(1,1,1)), f.x), f.y), f.z);
  }
  const mat2 ROT = mat2(1.6, 1.2, -1.2, 1.6);
  float fbm3(vec2 p) {
    float a = 0.5, s = 0.0;
    for (int i = 0; i < 3; i++) { s += a * vn(p); p = ROT * p; a *= 0.5; }
    return s / 0.875;
  }
  float fbm5(vec2 p, float detail) {
    float a = 0.5, s = 0.0, n = 0.0;
    for (int i = 0; i < 5; i++) {
      float w = a * (i >= 3 ? detail : 1.0);
      s += w * vn(p); n += w;
      p = ROT * p; a *= 0.5;
    }
    return s / n;
  }
  float cloudField(vec2 p, float detail) {
    vec2 q = vec2(fbm3(p * 0.45 + 2.1), fbm3(p * 0.45 + vec2(5.2, 1.3)));
    return fbm5(p + 1.7 * q, detail);
  }

  // premultiplied rgba
  vec4 clouds(vec3 d) {
    if (uCover < 0.005 || d.y <= 0.0) return vec4(0.0);
    float hfade = smoothstep(0.0, 0.2, d.y);
    float detail = smoothstep(0.03, 0.4, d.y);
    vec2 uv = d.xz / (d.y + 0.14) * uCloudScale;
    vec2 wind = vec2(uTime * 0.012, uTime * 0.005) * uCloudSpeed;
    vec2 p = uv + wind;
    float f = clamp((cloudField(p, detail) - 0.5) * 1.8 + 0.5, 0.0, 1.0);
    float thr = mix(0.80, 0.36, uCover);
    float soft = mix(0.10, 0.34, uSoft);
    float dens = smoothstep(thr, thr + soft, f);
    // thin high cirrus streaks
    float ci = vn(vec2(uv.x * 0.35 + wind.x * 0.5, uv.y * 2.6 + wind.y)) ;
    float cirrus = smoothstep(0.55, 0.95, ci) * 0.22 * uCover * smoothstep(0.1, 0.4, d.y);
    dens = max(dens, cirrus * 0.8);
    if (dens < 0.003) return vec4(0.0);

    // lighting: compare the field toward the sun with the local value
    vec2 sd = uSunDir.xz;
    float sl = length(sd);
    sd = sl > 1e-4 ? sd / sl : vec2(0.0, 1.0);
    float reach = 0.10 + 0.22 * (1.0 - clamp(uSunDir.y, 0.0, 1.0));
    float fl = clamp((cloudField(p + sd * reach, detail) - 0.5) * 1.8 + 0.5, 0.0, 1.0);
    float shadow = clamp(0.62 - (fl - f) * 4.2, 0.0, 1.0);
    float thick = smoothstep(thr, thr + 0.35, f);
    float lit = shadow * mix(1.0, 0.55, thick * 0.9);
    lit = max(lit, (1.0 - dens) * 0.55 * (0.5 + 0.5 * shadow));
    // low sun: only clouds facing the sun catch its light
    float lowSun = 1.0 - smoothstep(0.08, 0.45, uSunDir.y);
    float facing = smoothstep(-0.75, 0.85, dot(d, uSunDir));
    lit *= mix(1.0, facing, lowSun * 0.85);
    vec3 col = mix(uCloudShade, uCloudLit, lit);
    // forward scattering rim when looking toward the light
    float cs = max(dot(d, uSunDir), 0.0);
    col += uCloudLit * pow(cs, 5.0) * (1.0 - dens * 0.7) * 0.6;
    float a = dens * hfade;
    return vec4(col * a, a);
  }

  vec3 starField(vec3 d) {
    if (uStars < 0.001) return vec3(0.0);
    vec3 p = d * 190.0;
    vec3 ip = floor(p);
    vec3 fp = fract(p);
    vec3 h = hash33(ip);
    float present = step(1.0 - uStars * 0.14, h.x);
    vec3 centre = 0.25 + 0.5 * hash33(ip + 17.0);
    float dist = length(fp - centre);
    float mag = pow(h.y, 6.0);
    float s = smoothstep(0.34, 0.0, dist) * present * (0.15 + mag * 3.2);
    float tw = 0.85 + 0.15 * sin(uTime * (1.5 + h.z * 3.0) + h.z * 40.0);
    vec3 tint = mix(vec3(0.75, 0.85, 1.0), vec3(1.0, 0.88, 0.7), h.z);
    return tint * s * tw * 2.2;
  }

  vec3 milkyWay(vec3 d) {
    if (uStars < 0.001) return vec3(0.0);
    vec3 axis = normalize(vec3(0.35, 0.82, 0.45));
    float band = exp(-pow(dot(d, axis) / 0.2, 2.0));
    float n = vn3(d * 7.0) * 0.6 + vn3(d * 17.0) * 0.4;
    float dark = smoothstep(0.35, 0.8, vn3(d * 11.0 + 5.0));
    return vec3(0.55, 0.62, 0.85) * band * n * (1.0 - dark * 0.7) * 0.05 * uStars;
  }

  vec3 moon(vec3 d, out float cover) {
    cover = 0.0;
    float cm = dot(d, uMoonDir);
    float cr = cos(uMoonSize);
    vec3 col = vec3(0.0);
    // soft halo (wide + tight)
    float ang = acos(clamp(cm, -1.0, 1.0));
    col += uMoonCol * (exp(-ang / (uMoonSize * 5.0)) * 0.10 + exp(-ang / (uMoonSize * 22.0)) * 0.035);
    if (cm > cr * 0.999) {
      vec3 t = normalize(cross(uMoonDir, vec3(0.0, 1.0, 0.0)) + 1e-5);
      vec3 b = cross(t, uMoonDir);
      vec2 uv = vec2(dot(d, t), dot(d, b)) / sin(uMoonSize);
      float r2 = dot(uv, uv);
      float disc = smoothstep(1.0, 0.965, r2);
      float nz = sqrt(max(1.0 - r2, 0.0));
      vec3 n = vec3(uv, nz);
      float lam = clamp(dot(n, normalize(vec3(-0.45, 0.28, 0.85))) * 0.8 + 0.28, 0.05, 1.0);
      float maria = 0.45 + 0.55 * smoothstep(0.35, 0.65, vn(uv * 2.6 + 4.0) * 0.6 + vn(uv * 6.5) * 0.3 + vn(uv * 14.0) * 0.1);
      float craters = 0.9 + 0.1 * vn(uv * 30.0);
      col = mix(col, uMoonCol * lam * maria * craters * 9.0, disc);
      cover = disc;
    }
    return col;
  }

  void main() {
    vec3 d = normalize(vDir);
    vec3 base = vec3(0.0);
    vec3 emis = vec3(0.0);
    float baseA = 0.0;

    if (uMode > 1.5) {
      base = uTop; baseA = 1.0;
    } else {
      if (uMode > 0.5) {
        float y = d.y;
        float up = 1.0 - exp(-clamp(y, 0.0, 1.0) * 3.4);
        base = mix(uHorizon, uTop, up);
        base = mix(base, uBottom, smoothstep(0.0, -0.35, y));
        // key-light glow (dusk / moon scatter)
        float cs = max(dot(d, uSunDir), 0.0);
        float hz = exp(-abs(y) * 2.2);
        base += uGlowCol * (pow(cs, uGlowPow) * uGlowAmt * (0.35 + 0.65 * hz));
        base += uGlowCol * (pow(cs, 3.0) * uGlowAmt * 0.012);
        // horizon glow band (e.g. volcanic light)
        base += uHGlowCol * uHGlowAmt * exp(-abs(y) * 5.0) * (0.6 + 0.4 * vn(vec2(atan(d.z, d.x) * 3.0, 0.0)));
        baseA = 1.0;
        float vis = smoothstep(0.0, 0.12, y);
        float moonCover = 0.0;
        vec3 m = uMoonOn > 0.5 ? moon(d, moonCover) : vec3(0.0);
        emis += (starField(d) + milkyWay(d)) * vis * (1.0 - moonCover) + m;
      }
      // sun disc + corona (bounded HDR: the physical sky addon's own disc overflows half floats)
      if (uSunDisc > 0.001) {
        float ang = acos(clamp(dot(d, uSunDir), -1.0, 1.0));
        float disc = smoothstep(uSunSize, uSunSize * 0.82, ang);
        float corona = exp(-ang / (uSunSize * 5.0)) * 0.4 + exp(-ang / (uSunSize * 26.0)) * 0.07;
        emis += uSunCol * (disc * 7.0 + corona) * uSunDisc * smoothstep(-0.02, 0.03, d.y);
      }
    }

    vec4 cl = clouds(d);
    // lightning lights the clouds from within
    if (uFlash > 0.001) {
      float fa = pow(max(dot(d, uFlashDir), 0.0), 2.0) * 0.8 + 0.2;
      vec3 fc = vec3(0.75, 0.82, 1.0) * uFlash * fa;
      cl.rgb += fc * cl.a * 3.0;
      base += fc * 0.35 * smoothstep(-0.1, 0.4, d.y);
    }
    vec4 res;
    if (uMode > 1.5) {
      res = vec4(base, 1.0);
    } else {
      res = vec4(base * baseA + emis, baseA);
      res = cl + res * (1.0 - cl.a);
    }

    // horizon haze toward the fog colour
    if (uMode < 1.5) {
      float h = uHazeAmt * exp(-max(d.y, 0.0) * uHazeK);
      if (d.y <= 0.0) h = 1.0;
      res = res * (1.0 - h) + vec4(uFog * h, h);
    }
    gl_FragColor = res;
  }`;

// ─────────────────────────────────────────────────────────────────────────────
// SkyRig
// ─────────────────────────────────────────────────────────────────────────────

function linear(hex: number, out = new THREE.Color()): THREE.Color {
  return out.setHex(hex);
}

export class SkyRig {
  /** meshes for the visible sky; add to the main scene, call update() each frame */
  readonly group = new THREE.Group();
  /** same sky centred on the origin for PMREM baking */
  readonly bakeScene = new THREE.Scene();
  private domeMat: THREE.ShaderMaterial;
  private bakeMat!: THREE.ShaderMaterial;
  private domeGeo = new THREE.BoxGeometry(2, 2, 2);
  private domeMain: THREE.Mesh;
  private domeBake: THREE.Mesh;
  private skyMain: Sky;
  private skyBake: Sky;
  private skyGain = { value: 0.4 };
  private time = 0;
  private flashDir = new THREE.Vector3(0, 0.3, 1);

  constructor() {
    this.domeMat = new THREE.ShaderMaterial({
      uniforms: {
        uMode: { value: 0 },
        uTop: { value: new THREE.Color() },
        uHorizon: { value: new THREE.Color() },
        uBottom: { value: new THREE.Color() },
        uFog: { value: new THREE.Color() },
        uHazeK: { value: 20 },
        uHazeAmt: { value: 0.95 },
        uSunDir: { value: new THREE.Vector3(0, 1, 0) },
        uSunCol: { value: new THREE.Color() },
        uGlowCol: { value: new THREE.Color() },
        uGlowAmt: { value: 0 },
        uGlowPow: { value: 6 },
        uHGlowCol: { value: new THREE.Color() },
        uHGlowAmt: { value: 0 },
        uCover: { value: 0 },
        uSoft: { value: 0.5 },
        uCloudScale: { value: 1.4 },
        uCloudSpeed: { value: 1 },
        uCloudLit: { value: new THREE.Color(1, 1, 1) },
        uCloudShade: { value: new THREE.Color(0.3, 0.3, 0.3) },
        uStars: { value: 0 },
        uMoonDir: { value: new THREE.Vector3(0, 1, 0) },
        uMoonCol: { value: new THREE.Color() },
        uMoonSize: { value: 0.04 },
        uMoonOn: { value: 0 },
        uSunDisc: { value: 0 },
        uSunSize: { value: 0.012 },
        uTime: { value: 0 },
        uFlash: { value: 0 },
        uFlashDir: { value: this.flashDir },
      },
      vertexShader: DOME_VS,
      fragmentShader: DOME_FS,
      side: THREE.BackSide,
      depthTest: false,
      depthWrite: false,
      transparent: false,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.OneFactor,
      blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
    });
    this.domeMat.name = 'Greenleaf.skyDome';

    this.skyMain = new Sky();
    this.skyBake = new Sky();
    this.skyBake.material = this.skyMain.material;
    const sm = this.skyMain.material as THREE.ShaderMaterial;
    sm.uniforms.cloudCoverage.value = 0; // we draw our own clouds
    sm.depthTest = false;
    // the addon outputs very bright, saturated radiance: scale it so IBL / sun / exposure stay balanced
    sm.onBeforeCompile = (shader) => {
      shader.uniforms.uSkyGain = this.skyGain;
      shader.fragmentShader =
        'uniform float uSkyGain;\n' +
        shader.fragmentShader.replace('gl_FragColor = vec4( texColor, 1.0 );', 'gl_FragColor = vec4( min( texColor * uSkyGain, vec3( 1.7 ) ), 1.0 );');
    };
    for (const s of [this.skyMain, this.skyBake]) {
      s.frustumCulled = false;
      s.renderOrder = -1001;
      s.userData.noAO = true;
    }

    this.domeMain = new THREE.Mesh(this.domeGeo, this.domeMat);
    // the bake dome shares every uniform with the visible one except the sun disc (IBL comes from the sun light)
    this.bakeMat = this.domeMat.clone();
    this.bakeMat.uniforms = Object.assign({}, this.domeMat.uniforms, { uSunDisc: { value: 0 } });
    this.domeBake = new THREE.Mesh(this.domeGeo, this.bakeMat);
    for (const m of [this.domeMain, this.domeBake]) {
      m.frustumCulled = false;
      m.renderOrder = -1000;
      m.userData.noAO = true;
    }
    this.group.name = 'sky';
    this.group.add(this.skyMain, this.domeMain);
    this.bakeScene.add(this.skyBake, this.domeBake);
  }

  /** push a preset's sky into the shaders. lightDir = toward the key light. */
  apply(env: EnvironmentPresetEx, lightDir: THREE.Vector3): void {
    const u = this.domeMat.uniforms;
    const sky: SkyDef = env.sky;
    const fogCol = linear(env.fog.color, u.uFog.value as THREE.Color);
    void fogCol;
    const density = env.fog.density;
    const hazeH = env.hazeHeight ?? THREE.MathUtils.clamp(density * 14, 0.07, 0.7);
    u.uHazeK.value = 3 / hazeH;
    u.uHazeAmt.value = env.haze ?? 0.95;
    (u.uSunDir.value as THREE.Vector3).copy(lightDir);
    linear(env.sunColor, u.uSunCol.value as THREE.Color);

    const showPhysical = sky.kind === 'physical';
    this.skyMain.visible = showPhysical;
    this.skyBake.visible = showPhysical;
    u.uMoonOn.value = 0;
    u.uStars.value = 0;
    u.uGlowAmt.value = 0;
    u.uHGlowAmt.value = 0;
    u.uCover.value = 0;
    u.uSunDisc.value = 0;
    u.uSunSize.value = THREE.MathUtils.degToRad(env.sunSize ?? 0.6);

    const sunLin = linear(env.sunColor);
    // default cloud colours derive from the light colour and the hemisphere (sky) colour
    const lit = new THREE.Color();
    const shade = new THREE.Color();

    if (sky.kind === 'physical') {
      u.uMode.value = 0;
      const mat = this.skyMain.material as THREE.ShaderMaterial;
      const su = mat.uniforms;
      su.turbidity.value = sky.turbidity;
      su.rayleigh.value = sky.rayleigh;
      su.mieCoefficient.value = sky.mieCoefficient;
      su.mieDirectionalG.value = sky.mieDirectionalG;
      (su.sunPosition.value as THREE.Vector3).copy(lightDir).multiplyScalar(450000);
      this.skyGain.value = env.skyGain ?? 0.4;
      su.showSunDisc.value = 0; // overflows half-float targets; we draw our own bounded disc
      su.cloudCoverage.value = 0;
      const elev = Math.max(0, lightDir.y);
      const warm = 1 - Math.min(1, elev * 2.2);
      // lit clouds: sun colour, brighter at midday; shade: bluish ambient
      const bright = 0.55 + 0.9 * Math.min(1, elev * 2 + 0.2) + env.sunIntensity * 0.06;
      lit.copy(sunLin).multiplyScalar(bright);
      linear(env.hemiSky, shade).multiplyScalar(0.35 + 0.3 * (1 - warm));
      u.uCover.value = sky.clouds ?? 0;
      u.uSunDisc.value = env.sunDisc ?? 1;
    } else if (sky.kind === 'gradient') {
      u.uMode.value = 1;
      linear(sky.top, u.uTop.value as THREE.Color);
      linear(sky.horizon, u.uHorizon.value as THREE.Color);
      linear(sky.bottom, u.uBottom.value as THREE.Color);
      u.uStars.value = sky.stars ?? 0;
      if (sky.moon) {
        u.uMoonOn.value = 1;
        const md = dirFromAngles(sky.moon.elevation, sky.moon.azimuth, _tmpV);
        (u.uMoonDir.value as THREE.Vector3).copy(md);
        linear(sky.moon.color ?? 0xdfe8ff, u.uMoonCol.value as THREE.Color);
        u.uMoonSize.value = THREE.MathUtils.degToRad(sky.moon.size);
      }
      const gl = env.glow ?? 1;
      linear(env.glowColor ?? env.sunColor, u.uGlowCol.value as THREE.Color);
      // low sun -> strong tight glow, high sun / moon -> faint wide glow
      const low = 1 - Math.min(1, Math.max(0, lightDir.y) * 1.4);
      u.uGlowAmt.value = gl * (0.25 + 0.9 * low * Math.min(1, env.sunIntensity * 0.35));
      u.uGlowPow.value = 3 + 9 * low;
      if (env.horizonGlow !== undefined) {
        linear(env.horizonGlow, u.uHGlowCol.value as THREE.Color);
        u.uHGlowAmt.value = env.horizonGlowAmount ?? 0.4;
      }
      u.uCover.value = sky.clouds ?? 0;
      u.uSunDisc.value = env.sunDisc ?? 0;
      if (sky.cloudColor !== undefined) {
        lit.setHex(sky.cloudColor).multiplyScalar(1.0);
        shade.copy(lit).multiplyScalar(0.35);
      } else {
        lit.copy(sunLin).multiplyScalar(0.7);
        linear(sky.horizon, shade).multiplyScalar(0.55);
      }
      // gradient skies are dark at night: scale cloud colours with the horizon luminance
      void shade;
    } else {
      u.uMode.value = 2;
      linear(sky.color, u.uTop.value as THREE.Color);
    }

    if (env.cloudLit !== undefined) linear(env.cloudLit, lit);
    if (env.cloudShade !== undefined) linear(env.cloudShade, shade);
    (u.uCloudLit.value as THREE.Color).copy(lit);
    (u.uCloudShade.value as THREE.Color).copy(shade);
    u.uSoft.value = env.cloudSoft ?? 0.5;
    u.uCloudScale.value = 1.4 * (env.cloudScale ?? 1);
    u.uCloudSpeed.value = env.cloudSpeed ?? 1;
    u.uFlash.value = 0;
  }

  setFlash(v: number): void {
    this.domeMat.uniforms.uFlash.value = v;
  }
  setFlashDirection(x: number, y: number, z: number): void {
    this.flashDir.set(x, y, z).normalize();
  }

  /** advance cloud drift and re-centre the visible sky on the camera */
  update(dt: number, camera: THREE.Camera): void {
    this.time += dt;
    this.domeMat.uniforms.uTime.value = this.time;
    camera.getWorldPosition(this.group.position);
  }

  dispose(): void {
    this.domeGeo.dispose();
    this.domeMat.dispose();
    this.bakeMat.dispose();
    (this.skyMain.material as THREE.Material).dispose();
    this.skyMain.geometry.dispose();
    this.skyBake.geometry.dispose();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// The presets
// ─────────────────────────────────────────────────────────────────────────────

const V = (x: number, y: number, z: number): Vec3Tuple => [x, y, z];

const defs: Record<EnvironmentName, EnvironmentPresetEx> = {
  // ── neutral bright daylight for testing ───────────────────────────────────
  arena: {
    name: 'Arena',
    sky: { kind: 'physical', elevation: 46, azimuth: 140, turbidity: 3.2, rayleigh: 1.3, mieCoefficient: 0.004, mieDirectionalG: 0.8, clouds: 0.38 },
    sunColor: 0xfff1de, sunIntensity: 3.6,
    hemiSky: 0xbcd3f2, hemiGround: 0x6b5d49, hemiIntensity: 0.18,
    envIntensity: 0.7,
    fog: { color: 0xb5c9dd, density: 0.0032 },
    exposure: 1.0, bloom: 0.12,
    grade: { lift: V(0, 0, 0), gamma: V(1, 1, 1), gain: V(1, 1, 1), saturation: 1.05, vignette: 0.22 },
    weather: 'none',
    ambience: 'wind',
  },

  // ── creature-lab / showcase ───────────────────────────────────────────────
  lab: {
    name: 'Lab',
    sky: { kind: 'gradient', top: 0x2b2f35, horizon: 0x555a61, bottom: 0x24272b, stars: 0 },
    sunColor: 0xfff0dc, sunIntensity: 2.8,
    sunDirection: V(0.45, 0.8, 0.55),
    hemiSky: 0xcfd8e6, hemiGround: 0x3a3226, hemiIntensity: 0.5,
    envIntensity: 0.7,
    fog: { color: 0x4a4e54, density: 0.0016 },
    exposure: 1.0, bloom: 0.08,
    grade: { lift: V(0, 0, 0), gamma: V(1, 1, 1), gain: V(1, 1, 1), saturation: 1.0, vignette: 0.2 },
    weather: 'none',
    haze: 0.6,
  },

  // ── Mirkwood: sickly green-teal gloom, shafts through the canopy, spores ──
  mirkwood: {
    name: 'Mirkwood',
    mist: 0.8,
    sky: { kind: 'gradient', top: 0x0b1713, horizon: 0x3c5b49, bottom: 0x0a110d, stars: 0, clouds: 0.5, cloudColor: 0x2f4a3b },
    sunColor: 0xcfe8a6, sunIntensity: 3.4,
    sunDirection: V(-0.35, 0.82, 0.3),
    hemiSky: 0x6a9a7a, hemiGround: 0x232d16, hemiIntensity: 1.1,
    envIntensity: 1.0,
    fog: { color: 0x34503f, density: 0.030 },
    exposure: 1.3, bloom: 0.32,
    grade: { lift: V(0.0, 0.012, 0.008), gamma: V(0.98, 1.03, 0.97), gain: V(0.95, 1.05, 0.93), saturation: 0.92, vignette: 0.55 },
    weather: 'spores', weatherIntensity: 0.7,
    ambience: 'forest',
    shafts: 1.4, glow: 0.2, hazeHeight: 0.5,
  },

  // ── Forest River: bright overcast, lush green, mist off the water ─────────
  forest_river: {
    name: 'Forest River',
    mist: 1.0,
    sky: { kind: 'physical', elevation: 34, azimuth: 205, turbidity: 8, rayleigh: 2.2, mieCoefficient: 0.012, mieDirectionalG: 0.7, clouds: 1.0 },
    sunColor: 0xfff1da, sunIntensity: 2.6,
    hemiSky: 0xd5e6f2, hemiGround: 0x4f6234, hemiIntensity: 0.95,
    envIntensity: 1.0,
    fog: { color: 0xbdd0d0, density: 0.0125 },
    exposure: 0.95, bloom: 0.16,
    grade: { lift: V(0.0, 0.004, 0.004), gamma: V(1.0, 1.02, 1.0), gain: V(1.0, 1.03, 0.98), saturation: 1.12, vignette: 0.38 },
    weather: 'dust', weatherIntensity: 0.25,
    ambience: 'river',
    shafts: 0.35, cloudSoft: 0.9, cloudShade: 0x7f8f98,
  },

  // ── Lake-town by night: cold blue night, warm fire glow, embers ───────────
  laketown_night: {
    name: 'Lake-town Night',
    mist: 0.6,
    sky: { kind: 'gradient', top: 0x03060f, horizon: 0x1a2a46, bottom: 0x05070d, stars: 0.85, clouds: 0.4, cloudColor: 0x253350, moon: { elevation: 33, azimuth: 205, size: 2.2, color: 0xd5e2ff } },
    sunColor: 0x86a4e6, sunIntensity: 1.15,
    hemiSky: 0x1f3158, hemiGround: 0x0e0d12, hemiIntensity: 0.55,
    envIntensity: 0.7,
    fog: { color: 0x101b2f, density: 0.0115 },
    exposure: 1.35, bloom: 0.5,
    grade: { lift: V(0.0, 0.006, 0.02), gamma: V(0.98, 1.0, 1.04), gain: V(0.96, 1.0, 1.1), saturation: 0.95, vignette: 0.5 },
    weather: 'embers', weatherIntensity: 0.5,
    ambience: 'wind',
    glow: 0.5,
  },

  // ── Ravenhill: pale overcast, falling snow, icy blue-grey ─────────────────
  ravenhill_winter: {
    name: 'Ravenhill',
    mist: 0.4,
    sky: { kind: 'gradient', top: 0x7e8c9d, horizon: 0xc6d0d9, bottom: 0x98a3ad, stars: 0, clouds: 0.92, cloudColor: 0xb4bfca },
    sunColor: 0xdbe7f7, sunIntensity: 1.9,
    sunDirection: V(-0.45, 0.55, 0.5),
    hemiSky: 0xc3d3e6, hemiGround: 0x8d99a4, hemiIntensity: 1.0,
    envIntensity: 1.05,
    fog: { color: 0xbac7d2, density: 0.0145 },
    exposure: 1.0, bloom: 0.2,
    grade: { lift: V(0.004, 0.008, 0.014), gamma: V(1.0, 1.0, 1.02), gain: V(0.97, 1.0, 1.06), saturation: 0.78, vignette: 0.42 },
    weather: 'snow', weatherIntensity: 0.85,
    ambience: 'snow_wind',
    cloudSoft: 0.9, glow: 0.2,
  },

  // ── Moria: near-black, cool fill, torch warmth, dust ──────────────────────
  moria: {
    name: 'Moria',
    mist: 0.5,
    sky: { kind: 'cave', color: 0x05070b },
    sunColor: 0x9db6d6, sunIntensity: 1.5,
    sunDirection: V(0.25, 0.92, -0.2),
    hemiSky: 0x2c3f5c, hemiGround: 0x16110c, hemiIntensity: 0.85,
    envIntensity: 0.42,
    fog: { color: 0x07090d, density: 0.021 },
    exposure: 1.9, bloom: 0.36,
    grade: { lift: V(0.004, 0.006, 0.012), gamma: V(0.99, 1.0, 1.02), gain: V(0.98, 1.0, 1.06), saturation: 0.88, vignette: 0.62 },
    weather: 'dust', weatherIntensity: 0.6,
    ambience: 'cave',
    shafts: 0.8,
  },

  // ── Amon Hen: golden late-afternoon forest, haze ──────────────────────────
  amon_hen: {
    name: 'Amon Hen',
    mist: 0.3,
    sky: { kind: 'physical', elevation: 12, azimuth: 250, turbidity: 6, rayleigh: 1.7, mieCoefficient: 0.011, mieDirectionalG: 0.86, clouds: 0.32 },
    sunColor: 0xffc684, sunIntensity: 4.0,
    hemiSky: 0x9db8d9, hemiGround: 0x5a4f2c, hemiIntensity: 0.62,
    envIntensity: 1.0,
    fog: { color: 0xdcb78c, density: 0.0115 },
    exposure: 0.95, bloom: 0.38,
    grade: { lift: V(0.012, 0.006, 0.0), gamma: V(1.0, 1.0, 0.97), gain: V(1.05, 1.0, 0.92), saturation: 1.12, vignette: 0.42 },
    weather: 'dust', weatherIntensity: 0.55,
    ambience: 'forest',
    shafts: 1.0,
  },

  // ── Helm's Deep: night storm, heavy rain, lightning, blue-black ───────────
  helms_deep_storm: {
    name: "Helm's Deep Storm",
    mist: 0.3,
    sky: { kind: 'gradient', top: 0x02040a, horizon: 0x1c2738, bottom: 0x05070c, stars: 0.0, clouds: 1.0, cloudColor: 0x1d2736, moon: { elevation: 42, azimuth: 160, size: 2.6, color: 0xaebfe0 } },
    sunColor: 0x7391cf, sunIntensity: 0.95,
    hemiSky: 0x24344f, hemiGround: 0x0b0c10, hemiIntensity: 0.6,
    envIntensity: 0.55,
    fog: { color: 0x131c29, density: 0.0165 },
    exposure: 1.4, bloom: 0.3,
    grade: { lift: V(0.0, 0.005, 0.016), gamma: V(0.98, 1.0, 1.04), gain: V(0.93, 0.99, 1.1), saturation: 0.8, vignette: 0.56 },
    weather: 'storm', weatherIntensity: 1.0,
    ambience: 'storm',
    cloudSoft: 0.85, glow: 0.1,
  },

  // ── Pelennor: dramatic morning sky, smoke columns, ash ────────────────────
  pelennor: {
    name: 'Pelennor Fields',
    mist: 0.35,
    sky: { kind: 'physical', elevation: 9, azimuth: 100, turbidity: 8, rayleigh: 2.2, mieCoefficient: 0.008, mieDirectionalG: 0.88, clouds: 0.62 },
    sunColor: 0xffb878, sunIntensity: 3.8,
    hemiSky: 0x87a1c8, hemiGround: 0x4c3b2b, hemiIntensity: 0.62,
    envIntensity: 1.0,
    fog: { color: 0xc8a68c, density: 0.0078 },
    exposure: 0.95, bloom: 0.42,
    grade: { lift: V(0.0, 0.008, 0.014), gamma: V(1.0, 1.0, 0.98), gain: V(1.06, 1.0, 0.91), saturation: 1.1, vignette: 0.46 },
    weather: 'ash', weatherIntensity: 0.35,
    ambience: 'wind',
    shafts: 0.35, cloudSoft: 0.4, cloudScale: 0.9,
  },

  // ── The Black Gate: dark red-brown sky, ash, volcanic glow ────────────────
  black_gate: {
    name: 'Black Gate',
    mist: 0.4,
    sky: { kind: 'gradient', top: 0x0a0403, horizon: 0x49190d, bottom: 0x120907, stars: 0, clouds: 0.95, cloudColor: 0x4a1d0f },
    sunColor: 0xff7a3d, sunIntensity: 1.8,
    sunDirection: V(0.2, 0.2, 0.96),
    hemiSky: 0x5a2f24, hemiGround: 0x1f120c, hemiIntensity: 0.65,
    envIntensity: 0.75,
    fog: { color: 0x331510, density: 0.0125 },
    exposure: 1.15, bloom: 0.46,
    grade: { lift: V(0.012, 0.002, 0.0), gamma: V(1.0, 0.99, 0.96), gain: V(1.07, 0.96, 0.86), saturation: 0.95, vignette: 0.56 },
    weather: 'ash', weatherIntensity: 0.85,
    ambience: 'wind',
    glow: 1.1, glowColor: 0xff5a1c, horizonGlow: 0xff4a12, horizonGlowAmount: 0.32, cloudSoft: 0.7,
  },

  // ── Menu: cinematic dusk ──────────────────────────────────────────────────
  menu: {
    name: 'Menu',
    mist: 0.25,
    sky: { kind: 'gradient', top: 0x0a1430, horizon: 0x74505f, bottom: 0x1c1b25, stars: 0.35, clouds: 0.4, cloudColor: 0xff9a5e },
    sunColor: 0xffa05a, sunIntensity: 3.2,
    sunDirection: dirTuple(5, 255),
    hemiSky: 0x3f5586, hemiGround: 0x3a2a20, hemiIntensity: 0.6,
    envIntensity: 1.0,
    fog: { color: 0x94685c, density: 0.0095 },
    exposure: 1.0, bloom: 0.5,
    grade: { lift: V(0.006, 0.004, 0.012), gamma: V(1.0, 1.0, 1.0), gain: V(1.04, 1.0, 0.95), saturation: 1.1, vignette: 0.5 },
    weather: 'dust', weatherIntensity: 0.3,
    ambience: 'wind',
    glow: 2.2, glowColor: 0xff7a30, shafts: 0.4, sunDisc: 0.9, sunSize: 0.9,
  },
};

function dirTuple(elevationDeg: number, azimuthDeg: number): Vec3Tuple {
  const v = dirFromAngles(elevationDeg, azimuthDeg, new THREE.Vector3());
  return [v.x, v.y, v.z];
}

export const ENVIRONMENTS: Record<EnvironmentName, EnvironmentPreset> = defs;
