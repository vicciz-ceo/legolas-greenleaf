/** Cheap animated flame meshes for torches, braziers and campfires (additive, no lights). */
import * as THREE from 'three';

const flameUniforms = { uTime: { value: 0 } };
let flameOverride: number | null = null;
export function setFlameTime(t: number | null): void {
  flameOverride = t;
  if (t !== null) flameUniforms.uTime.value = t;
}
const tickFlame = (): void => {
  flameUniforms.uTime.value = flameOverride ?? performance.now() / 1000;
};

let flameMat: THREE.ShaderMaterial | null = null;
function material(): THREE.ShaderMaterial {
  if (flameMat) return flameMat;
  flameMat = new THREE.ShaderMaterial({
    uniforms: flameUniforms,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      attribute float aSeed;
      varying vec2 vUv; varying float vSeed;
      uniform float uTime;
      void main() {
        vUv = uv; vSeed = aSeed;
        vec3 p = position;
        float h = uv.y;
        float t = uTime * 3.0 + aSeed * 40.0;
        p.x += sin(t * 1.7 + h * 5.0) * 0.18 * h * h;
        p.z += sin(t * 1.3 + h * 4.0 + 1.7) * 0.18 * h * h;
        p.y *= 1.0 + 0.12 * sin(t * 2.3 + aSeed * 7.0);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      varying vec2 vUv; varying float vSeed;
      uniform float uTime;
      float h21(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
      float n2(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
        return mix(mix(h21(i), h21(i+vec2(1,0)), f.x), mix(h21(i+vec2(0,1)), h21(i+vec2(1,1)), f.x), f.y); }
      void main() {
        float y = vUv.y;
        float x = (vUv.x - 0.5) * 2.0;
        float t = uTime * 2.2 + vSeed * 30.0;
        float width = (1.0 - pow(y, 1.4)) * (0.85 + 0.25 * sin(y * 6.0 - t * 2.0));
        float shape = 1.0 - smoothstep(width * 0.55, width, abs(x));
        float turb = n2(vec2(x * 2.2 + vSeed * 9.0, y * 3.5 - t * 1.6));
        shape *= smoothstep(0.0, 0.25, turb + (1.0 - y) * 0.75 - y * 0.35);
        float core = smoothstep(0.7, 0.0, abs(x) / max(width, 0.05)) * (1.0 - y);
        vec3 col = mix(vec3(0.95, 0.22, 0.03), vec3(1.0, 0.6, 0.14), core);
        col = mix(col, vec3(1.0, 0.82, 0.45), core * core * (1.0 - y) * 0.6);
        float a = shape * (1.0 - smoothstep(0.75, 1.0, y)) * smoothstep(0.0, 0.06, y);
        gl_FragColor = vec4(col * (0.75 + core * 0.45), a * 0.85);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  flameMat.name = 'flame';
  return flameMat;
}

/**
 * Flame: three crossed tall quads. Origin at the base. `height` and `width` in metres. The mesh has
 * userData.noAO, no shadows, and animates from performance.now().
 */
export function flame(height = 0.5, width = 0.25, seed = 0): THREE.Mesh {
  const n = 3;
  const pos: number[] = [];
  const uv: number[] = [];
  const sd: number[] = [];
  const idx: number[] = [];
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI + seed;
    const cx = Math.cos(a) * width * 0.5;
    const cz = Math.sin(a) * width * 0.5;
    const b = pos.length / 3;
    const rows = 5;
    for (let r = 0; r <= rows; r++) {
      const v = r / rows;
      for (const side of [-1, 1]) {
        pos.push(cx * side, v * height, cz * side);
        uv.push(side < 0 ? 0 : 1, v);
        sd.push(seed + k * 0.37);
      }
    }
    for (let r = 0; r < rows; r++) {
      const i = b + r * 2;
      idx.push(i, i + 1, i + 3, i, i + 3, i + 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('aSeed', new THREE.Float32BufferAttribute(sd, 1));
  g.setIndex(idx);
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, height * 0.5, 0), Math.max(height, width));
  const m = new THREE.Mesh(g, material());
  m.castShadow = false;
  m.receiveShadow = false;
  m.userData.noAO = true;
  m.renderOrder = 3;
  m.name = 'flame';
  m.onBeforeRender = tickFlame;
  return m;
}
