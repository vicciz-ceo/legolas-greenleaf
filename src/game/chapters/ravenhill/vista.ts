/**
 * Ravenhill's far world: Erebor and the mountain ranges round the horizon, the snow country beyond the
 * playable terrain (with dark forest belts and the frozen river in the valley) and the cloud banks that
 * wind round the peaks. Everything here is baked vertex-colour geometry (no textures), well beyond the
 * play space: nothing collides, nothing casts a shadow.
 *
 * Colour harmony follows docs/refs/scenes/ravenhill/palette.png: neutral blue-grey rock, cool white snow,
 * a pale horizon (#c6d0d9) that the haze dissolves into.
 */
import * as THREE from 'three';
import type { LevelAPI } from '../../../core/types';
import { fbm2 } from '../../../core/rng';
import { smoothstep } from '../../../core/math';
import { heightAt, TERRAIN } from './layout';

const ROCK = new THREE.Color(0x585f69);
const ROCK_WARM = new THREE.Color(0x6a655f);
const SNOW = new THREE.Color(0xe9eff6);
const SNOW_SHADE = new THREE.Color(0x9fb0c6);
const HAZE = new THREE.Color(0xbfcad6);
const FOREST = new THREE.Color(0x1f292f);
const ICE = new THREE.Color(0xa9c6dc);

const SUN = new THREE.Vector3(-0.62, 0.5, -0.5).normalize();

/** a ridged-noise crest (0..1, sharp at the arêtes) */
function ridged(x: number, z: number, scale: number, oct: number, seed: number): number {
  const n = 1 - Math.abs(fbm2(x * scale, z * scale, oct, seed) * 1.7);
  return Math.max(0, n) * Math.max(0, n);
}

function peak(x: number, z: number, cx: number, cz: number, h: number, r: number): number {
  const d2 = (x - cx) * (x - cx) + (z - cz) * (z - cz);
  return h * Math.exp(-d2 / (2 * r * r));
}

/** Erebor and the northern massif */
function northH(x: number, z: number): number {
  const d = Math.hypot((x - 150) * 0.85, z - 930);
  const cone = Math.max(0, 1 - d / 880);
  const body = Math.pow(cone, 1.3) * 330;
  const crest = ridged(x, z, 0.0042, 5, 91) * 150 * smoothstep(0.05, 0.55, cone);
  const spurs = ridged(x + 120, z, 0.0085, 4, 97) * 70 * smoothstep(0.0, 0.5, cone);
  const peaks = peak(x, z, 150, 930, 170, 75) + peak(x, z, -60, 860, 110, 70) + peak(x, z, 330, 800, 120, 80) + peak(x, z, 40, 1020, 150, 90);
  const fine = fbm2(x * 0.02, z * 0.02, 3, 95) * 16 * smoothstep(0, 0.4, cone);
  // the north-west and north-east ranges lower on either side
  const wing = (ridged(x, z, 0.0055, 5, 101) * 130 + 40) * smoothstep(340, 700, Math.abs(x - 100)) * smoothstep(380, 560, z);
  const foot = 18 + fbm2(x * 0.01, z * 0.01, 3, 92) * 14;
  return Math.max(foot, body + crest + spurs + peaks + fine, wing * 0.9);
}

/** the ranges east and west of the gorge and the low hills in the far south */
function flankH(x: number, z: number): number {
  const side = Math.abs(x);
  const ramp = smoothstep(380, 900, side);
  const r = ridged(x, z, 0.0048, 5, 111);
  const base = 32 + fbm2(x * 0.006, z * 0.006, 4, 112) * 30;
  return base + (r * 190 + 50) * ramp;
}

function southH(x: number, z: number): number {
  const ramp = smoothstep(-480, -1000, z);
  const r = ridged(x, z, 0.0045, 5, 121);
  const base = 4 + fbm2(x * 0.007, z * 0.007, 4, 122) * 10;
  return base + (r * 170 + 40) * ramp;
}

interface Region {
  name: string;
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  nx: number;
  nz: number;
  H: (x: number, z: number) => number;
  /** origin of the haze (horizontal distance) */
  hazeBias: number;
}

function mountainMesh(level: LevelAPI, r: Region): void {
  const nx = r.nx;
  const nz = r.nz;
  const pos = new Float32Array((nx + 1) * (nz + 1) * 3);
  const col = new Float32Array((nx + 1) * (nz + 1) * 3);
  const idx: number[] = [];
  for (let j = 0; j <= nz; j++) {
    for (let i = 0; i <= nx; i++) {
      const x = r.x0 + ((r.x1 - r.x0) * i) / nx;
      const z = r.z0 + ((r.z1 - r.z0) * j) / nz;
      const k = (j * (nx + 1) + i) * 3;
      pos[k] = x;
      pos[k + 1] = r.H(x, z) - 30;
      pos[k + 2] = z;
    }
  }
  for (let j = 0; j < nz; j++)
    for (let i = 0; i < nx; i++) {
      const a = j * (nx + 1) + i;
      idx.push(a, a + nx + 1, a + 1, a + 1, a + nx + 1, a + nx + 2);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const nrm = g.getAttribute('normal') as THREE.BufferAttribute;
  const c = new THREE.Color();
  const tmp = new THREE.Color();
  for (let i = 0; i < nrm.count; i++) {
    const x = pos[i * 3];
    const y = pos[i * 3 + 1];
    const z = pos[i * 3 + 2];
    const nxn = nrm.getX(i);
    const ny = nrm.getY(i);
    const nzn = nrm.getZ(i);
    const n1 = fbm2(x * 0.02, z * 0.02, 3, 131);
    const n2 = fbm2(x * 0.07 + y * 0.03, z * 0.07, 2, 132);
    // snow: sits on gentle slopes and everywhere the winter has covered the valleys; steep arêtes stay rock
    const snowLine = 55 + n1 * 70;
    const snow = Math.min(1, smoothstep(0.42, 0.78, ny + n2 * 0.18) * 0.95 + (1 - smoothstep(snowLine - 30, snowLine + 40, y)) * 0.6 * smoothstep(0.3, 0.6, ny));
    tmp.copy(ROCK).lerp(ROCK_WARM, 0.5 + n2 * 0.5);
    // strata: faint horizontal banding in the rock
    tmp.multiplyScalar(0.86 + 0.14 * Math.sin(y * 0.16 + n1 * 5));
    c.copy(tmp).lerp(SNOW, snow);
    // light: a fake key from the left/camera side so the faces read (the real sun is behind the mountain)
    const lit = Math.max(0, nxn * SUN.x + ny * SUN.y + nzn * SUN.z);
    const shade = 0.5 + 0.62 * lit;
    c.multiplyScalar(shade);
    // cool blue shadows
    tmp.copy(SNOW_SHADE).multiplyScalar(0.55);
    c.lerp(tmp, (1 - lit) * 0.22 * (0.4 + snow));
    // aerial perspective: distance, and the cloud/valley haze clinging low on the flanks
    const d = Math.hypot(x, z - 60);
    const hz = Math.min(0.88, smoothstep(300, 2200, d) * 0.55 + r.hazeBias + (1 - smoothstep(30, 300, y)) * 0.36);
    c.lerp(HAZE, hz);
    col[i * 3] = c.r;
    col[i * 3 + 1] = c.g;
    col[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, fog: false }));
  m.name = 'rh_range_' + r.name;
  m.castShadow = m.receiveShadow = false;
  m.userData.noAO = true;
  m.frustumCulled = false;
  level.root.add(m);
}

/** Erebor, the flank ranges and the southern hills */
export function buildRanges(level: LevelAPI): void {
  mountainMesh(level, { name: 'north', x0: -1100, x1: 1200, z0: 380, z1: 1700, nx: 230, nz: 132, H: northH, hazeBias: 0.1 });
  mountainMesh(level, { name: 'west', x0: -1900, x1: -440, z0: -420, z1: 700, nx: 110, nz: 84, H: flankH, hazeBias: 0.2 });
  mountainMesh(level, { name: 'east', x0: 440, x1: 1900, z0: -420, z1: 700, nx: 110, nz: 84, H: flankH, hazeBias: 0.2 });
  mountainMesh(level, { name: 'south', x0: -1700, x1: 1700, z0: -1900, z1: -460, nx: 190, nz: 80, H: southH, hazeBias: 0.28 });
}

// ─────────────────────────────────────────────────────────────────────────────
// The snow country round the playable terrain
// ─────────────────────────────────────────────────────────────────────────────

/** centre line of the far valley river (south of the gorge mouth) */
const valleyRiverX = (z: number): number => 40 + 90 * Math.sin(z * 0.006 + 0.7) + 40 * Math.sin(z * 0.017);

/**
 * A coarse copy of the world's height function out to the horizon, sunk a little under the real terrain
 * (which hides it), coloured as snow with belts of dark forest and the pale ribbon of the valley river.
 */
export function buildFarGround(level: LevelAPI): void {
  const half = 1750;
  const n = 140;
  const cell = (half * 2) / n;
  const cx = 0;
  const cz = 60;
  const hide = TERRAIN.size / 2 - 4; // cells wholly inside the real terrain are dropped
  const pos = new Float32Array((n + 1) * (n + 1) * 3);
  const col = new Float32Array((n + 1) * (n + 1) * 3);
  const farH = (x: number, z: number): number => {
    // the world's own height function near the play space, blending to the ranges' base level far away
    const hw = heightAt(x, z);
    const far = smoothstep(260, 620, Math.hypot(x - TERRAIN.center[0], z - TERRAIN.center[1]));
    const northPlain = 26 + fbm2(x * 0.004, z * 0.004, 4, 141) * 22;
    const southPlain = 2 + fbm2(x * 0.005, z * 0.005, 4, 142) * 6;
    const plain = z > 30 ? northPlain : southPlain;
    return hw + (plain - hw) * far * 0.85;
  };
  for (let j = 0; j <= n; j++) {
    for (let i = 0; i <= n; i++) {
      const x = cx - half + i * cell;
      const z = cz - half + j * cell;
      const k = (j * (n + 1) + i) * 3;
      pos[k] = x;
      pos[k + 1] = farH(x, z) - 2.2;
      pos[k + 2] = z;
    }
  }
  const idx: number[] = [];
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      const xa = cx - half + i * cell;
      const za = cz - half + j * cell;
      if (Math.abs(xa + cell / 2 - TERRAIN.center[0]) < hide - cell && Math.abs(za + cell / 2 - TERRAIN.center[1]) < hide - cell) continue;
      const a = j * (n + 1) + i;
      idx.push(a, a + n + 1, a + 1, a + 1, a + n + 1, a + n + 2);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const nrm = g.getAttribute('normal') as THREE.BufferAttribute;
  const c = new THREE.Color();
  const tmp = new THREE.Color();
  for (let i = 0; i < nrm.count; i++) {
    const x = pos[i * 3];
    const y = pos[i * 3 + 1];
    const z = pos[i * 3 + 2];
    const ny = nrm.getY(i);
    const nxn = nrm.getX(i);
    const nzn = nrm.getZ(i);
    const f1 = fbm2(x * 0.006, z * 0.006, 4, 151);
    const f2 = fbm2(x * 0.03, z * 0.03, 3, 152);
    c.copy(SNOW).multiplyScalar(0.92 + 0.08 * f2);
    // forest belts on the gentle slopes and valley floors
    const treeW = smoothstep(0.02, 0.28, f1 + f2 * 0.1) * smoothstep(0.82, 0.95, ny) * (1 - smoothstep(70, 140, y));
    tmp.copy(FOREST).lerp(SNOW, 0.12 + 0.18 * (f2 * 0.5 + 0.5));
    c.lerp(tmp, treeW * 0.8);
    // rock on the steeper ground
    c.lerp(tmp.copy(ROCK).multiplyScalar(0.9), smoothstep(0.86, 0.6, ny) * 0.8);
    // the frozen river through the southern valley
    if (z < -150) {
      const d = Math.abs(x - valleyRiverX(z));
      const rw = 1 - smoothstep(18, 46, d);
      c.lerp(ICE, rw * 0.9);
    }
    const lit = Math.max(0, nxn * SUN.x + ny * SUN.y + nzn * SUN.z);
    c.multiplyScalar(0.7 + 0.45 * lit);
    col[i * 3] = c.r;
    col[i * 3 + 1] = c.g;
    col[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0, envMapIntensity: 0.6 }));
  m.name = 'rh_far_ground';
  m.castShadow = m.receiveShadow = false;
  m.userData.noAO = true;
  m.frustumCulled = false;
  level.root.add(m);
}

// ─────────────────────────────────────────────────────────────────────────────
// Cloud banks
// ─────────────────────────────────────────────────────────────────────────────

let cloudTex: THREE.CanvasTexture | null = null;

/** soft fbm blotches with a faded rim, white in the centre of each bank (canvas, once) */
function cloudTexture(): THREE.CanvasTexture {
  if (cloudTex) return cloudTex;
  const S = 256;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const ctx = cv.getContext('2d')!;
  const img = ctx.createImageData(S, S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const u = x / S;
      const v = y / S;
      const n = fbm2(u * 5, v * 5, 4, 161) * 0.5 + fbm2(u * 11 + 3, v * 11, 3, 162) * 0.3 + 0.5;
      const dx = u - 0.5;
      const dy = v - 0.5;
      const rim = 1 - smoothstep(0.28, 0.5, Math.hypot(dx, dy));
      const a = Math.max(0, Math.min(1, (n - 0.42) * 2.4)) * rim;
      const k = (y * S + x) * 4;
      img.data[k] = 255;
      img.data[k + 1] = 255;
      img.data[k + 2] = 255;
      img.data[k + 3] = Math.round(a * 255);
    }
  }
  ctx.putImageData(img, 0, 0);
  cloudTex = new THREE.CanvasTexture(cv);
  cloudTex.colorSpace = THREE.SRGBColorSpace;
  cloudTex.wrapS = cloudTex.wrapT = THREE.ClampToEdgeWrapping;
  return cloudTex;
}

/**
 * Banks of mist lying in the valleys and round the peaks: big horizontal sheets with a faded rim, alpha
 * blotched by noise, at several altitudes. Looking across them from the heights gives the layered haze
 * of the reference paintings.
 */
export function buildCloudBanks(level: LevelAPI): void {
  const tex = cloudTexture();
  // [x, y, z, size, opacity, spin]
  const banks: [number, number, number, number, number, number][] = [
    // the valley beyond the gorge mouth (kept clear of the play space: nothing hangs over the gorge)
    [-30, 18, -290, 380, 0.34, 0.3],
    [150, 30, -340, 520, 0.3, 1.9],
    [-210, 42, -270, 420, 0.28, 3.1],
    [40, 58, -500, 760, 0.3, 0.9],
    // between Ravenhill and the mountain, above the bat ride's ceiling
    [200, 135, 430, 640, 0.28, 2.6],
    [-300, 150, 470, 700, 0.26, 1.4],
    // round Erebor
    [60, 190, 650, 900, 0.34, 0.8],
    [340, 260, 750, 800, 0.3, 2.0],
    [-220, 320, 830, 900, 0.28, 4.0],
    // east and west of the crag, level with the tower's top floor
    [-340, 70, 170, 380, 0.26, 5.2],
    [330, 74, 100, 380, 0.26, 0.5],
  ];
  const geo = new THREE.PlaneGeometry(1, 1);
  geo.rotateX(-Math.PI / 2);
  for (const [x, y, z, s, o, spin] of banks) {
    const m = new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: o, depthWrite: false, color: 0xd5dfe9, fog: false });
    const mesh = new THREE.Mesh(geo, m);
    mesh.position.set(x, y, z);
    mesh.rotation.y = spin;
    mesh.scale.set(s, 1, s);
    mesh.renderOrder = -1;
    mesh.castShadow = mesh.receiveShadow = false;
    mesh.userData.noAO = true;
    mesh.frustumCulled = false;
    mesh.name = 'rh_cloud_bank';
    level.root.add(mesh);
  }
}
