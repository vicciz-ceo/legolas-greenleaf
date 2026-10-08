/**
 * GradePass: the last "look" pass. It runs AFTER OutputPass (AgX + sRGB), so it works on
 * display-referred colour.
 *
 *   focus radial blur -> chromatic aberration -> lift/gamma/gain -> saturation
 *   -> focus tint -> vignette -> damage flash -> film grain + dither -> letterbox bars
 */
import * as THREE from 'three';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

export const GradeShader = {
  name: 'GreenleafGradeShader',
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uLift: { value: new THREE.Vector3(0, 0, 0) },
    uGamma: { value: new THREE.Vector3(1, 1, 1) },
    uGain: { value: new THREE.Vector3(1, 1, 1) },
    uSaturation: { value: 1 },
    uVignette: { value: 0.3 },
    uGrain: { value: 0.03 },
    uTime: { value: 0 },
    uDamage: { value: 0 },
    uFocus: { value: 0 },
    uLetterbox: { value: 0 },
    uAspect: { value: 16 / 9 },
    uAberration: { value: 0 },
    uContrast: { value: 1 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    precision highp float;
    uniform sampler2D tDiffuse;
    uniform vec3 uLift;
    uniform vec3 uGamma;
    uniform vec3 uGain;
    uniform float uSaturation;
    uniform float uVignette;
    uniform float uGrain;
    uniform float uTime;
    uniform float uDamage;
    uniform float uFocus;
    uniform float uLetterbox;
    uniform float uAspect;
    uniform float uAberration;
    uniform float uContrast;
    varying vec2 vUv;

    float hash12(vec2 p) {
      vec3 p3 = fract(vec3(p.xyx) * 0.1031);
      p3 += dot(p3, p3.yzx + 33.33);
      return fract((p3.x + p3.y) * p3.z);
    }

    void main() {
      vec2 uv = vUv;
      vec2 d = uv - 0.5;
      vec2 dA = vec2(d.x * uAspect, d.y);
      float r = length(dA);

      vec3 c;
      // chromatic aberration: tiny, radial, grows toward the corners
      if (uAberration > 0.0001) {
        vec2 off = d * (uAberration * 0.0022) * (0.3 + r * 1.4);
        c = vec3(
          texture2D(tDiffuse, uv + off).r,
          texture2D(tDiffuse, uv).g,
          texture2D(tDiffuse, uv - off).b);
      } else {
        c = texture2D(tDiffuse, uv).rgb;
      }

      // focus mode: radial blur toward the edges
      if (uFocus > 0.001) {
        float amt = uFocus * 0.035 * smoothstep(0.08, 0.75, r);
        vec3 acc = c;
        for (int i = 1; i <= 6; i++) {
          acc += texture2D(tDiffuse, uv - d * amt * (float(i) / 6.0)).rgb;
        }
        c = acc / 7.0;
      }

      // lift / gamma / gain (display space)
      c = c * uGain;
      c = c + uLift * (1.0 - c);
      c = pow(max(c, vec3(0.0)), 1.0 / max(uGamma, vec3(0.01)));
      // gentle S-curve around mid grey
      if (uContrast > 1.001) {
        vec3 sc = c * c * (3.0 - 2.0 * c);
        c = mix(c, sc, clamp(uContrast - 1.0, 0.0, 1.0));
      }

      float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(vec3(luma), c, uSaturation);

      // focus tint: desaturate, cool teal cast, slight darkening
      if (uFocus > 0.001) {
        float l2 = dot(c, vec3(0.2126, 0.7152, 0.0722));
        vec3 teal = vec3(0.80, 1.02, 1.10);
        c = mix(c, vec3(l2) * teal, uFocus * 0.62);
        c *= 1.0 - 0.12 * uFocus;
      }

      // vignette
      float vig = smoothstep(0.30, 1.05, r);
      c *= 1.0 - uVignette * vig * vig * 1.15;

      // damage flash: red pulse creeping in from the edges (the centre stays readable)
      if (uDamage > 0.001) {
        float e = smoothstep(0.30, 1.0, r);
        float k = clamp(uDamage * (0.03 + 0.97 * e * e), 0.0, 1.0);
        vec3 blood = vec3(0.55, 0.012, 0.01) * (0.55 + 0.9 * luma);
        c = mix(c, blood, k * 0.82);
        c.r += uDamage * 0.03 * (1.0 - e);
      }

      // film grain (strongest in the mid-tones) + triangular dither against banding
      float g1 = hash12(gl_FragCoord.xy + fract(uTime * 7.31) * 311.0);
      float g2 = hash12(gl_FragCoord.xy * 1.37 + fract(uTime * 3.17) * 517.0 + 17.0);
      float grain = (g1 + g2 - 1.0);
      float lm = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c += grain * uGrain * (0.35 + 1.4 * lm * (1.0 - lm) * 2.0);
      c += (hash12(gl_FragCoord.xy + 91.7) + hash12(gl_FragCoord.xy + 13.1) - 1.0) * (1.0 / 255.0);

      // letterbox
      if (uLetterbox > 0.001) {
        float visible = min(1.0, uAspect / 2.39);
        float bar = (1.0 - visible) * 0.5 * uLetterbox;
        float edge = 1.5 / 1080.0;
        float m = smoothstep(bar - edge, bar + edge, uv.y) * smoothstep(bar - edge, bar + edge, 1.0 - uv.y);
        c *= m;
      }

      gl_FragColor = vec4(c, 1.0);
    }`,
};

export type GradePass = ShaderPass;

export function createGradePass(): ShaderPass {
  const pass = new ShaderPass(GradeShader as unknown as THREE.ShaderMaterialParameters & { uniforms: Record<string, THREE.IUniform> });
  pass.material.depthTest = false;
  pass.material.depthWrite = false;
  return pass;
}
