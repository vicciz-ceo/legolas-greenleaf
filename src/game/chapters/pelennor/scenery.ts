/**
 * Pelennor Fields: the art-direction layer. Everything here is scenery (no colliders, no gameplay):
 *   - mountainRing: the White Mountains and the dark Ered Nimrais/Ephel Duath as one jagged, snow-capped
 *     heightfield ring inside the camera's far plane (1200 m), so the horizon is a range, not a flat cut
 *   - puddles: sky-mirroring pools of brown water lying in the churned ground
 *   - clods: lumpy clods of turned earth across the mud (instanced, one draw call)
 *   - debris: wheels and splintered planks of the siege (instanced)
 *   - hostForest: the pike-forests, flags and standards of the hosts, drawn as a handful of instanced
 *     meshes so the far ranks read as dense armies at almost no cost
 * Nothing allocates per frame; every geometry is built once at load.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { LevelAPI } from '../../../core/types';
import { Rng, fbm2 } from '../../../core/rng';
import { clamp, smoothstep } from '../../../core/math';
import { lake, mat, worldQuality } from '../../../world';
import { applyFogCap } from '../../../world/shader';

type Ground = (x: number, z: number) => number;

const bump = (a: number, centreDeg: number, widthDeg: number): number => {
  let d = Math.abs(((a * 180) / Math.PI - centreDeg + 540) % 360 - 180);
  d /= widthDeg;
  return Math.exp(-d * d);
};

/**
 * One ring-shaped heightfield of mountains around the field (az 0 = +Z, 90 = +X, like the sky).
 * Tall, snow-capped and blue-slate in the south-west (the White Mountains behind the city), darker and
 * browner in the east (the mountains of Shadow), low in the north. Inside the 1200 m far plane.
 */
export function mountainRing(level: LevelAPI, cx: number, cz: number, citAz: number): THREE.Mesh {
  const RA = 640;
  const RB = 1050;
  const NA = 360;
  const NR = 30;
  const cnt = (NA + 1) * (NR + 1);
  const pos = new Float32Array(cnt * 3);
  const uv = new Float32Array(cnt * 2);
  const hts = new Float32Array(cnt);
  const azs = new Float32Array(cnt);
  let k = 0;
  for (let j = 0; j <= NR; j++) {
    const t = j / NR;
    const r = RA + t * (RB - RA);
    for (let i = 0; i <= NA; i++) {
      const a = (i / NA) * Math.PI * 2;
      const wrap = i === NA ? 0 : i; // the seam closes on itself
      const aa = (wrap / NA) * Math.PI * 2;
      const x = cx + Math.sin(aa) * r;
      const z = cz + Math.cos(aa) * r;
      // tall behind the city, along the south-west range and the eastern wall; low and rolling in the north
      const amp =
        0.3 +
        0.36 * bump(aa, citAz, 40) +
        0.5 * bump(aa, 250, 60) +
        0.42 * bump(aa, 112, 42) +
        0.3 * bump(aa, 305, 32) +
        0.16 * bump(aa, 150, 30);
      const env = smoothstep(0.0, 0.8, t);
      const ridged = 1 - Math.abs(fbm2(x * 0.0029, z * 0.0029, 4, 51));
      const crag = Math.pow(clamp(ridged, 0, 1), 1.9);
      const mass = 0.5 + 0.5 * (0.5 + 0.5 * fbm2(x * 0.0014, z * 0.0014, 2, 52));
      const detail = fbm2(x * 0.016, z * 0.016, 3, 53) * 22 + fbm2(x * 0.06, z * 0.06, 2, 54) * 6;
      const h = (50 + 400 * crag * mass) * amp * env + detail * env - 26 * (1 - env);
      pos[k * 3] = x;
      pos[k * 3 + 1] = h;
      pos[k * 3 + 2] = z;
      uv[k * 2] = x / 190;
      uv[k * 2 + 1] = z / 190;
      hts[k] = h;
      azs[k] = (a * 180) / Math.PI;
      k++;
    }
  }
  const idx: number[] = [];
  const row = NA + 1;
  for (let j = 0; j < NR; j++) {
    for (let i = 0; i < NA; i++) {
      const a = j * row + i;
      // outward ring: (a, a+1) on the inner edge, (a+row) on the outer; wound to face up and inward
      idx.push(a, a + row, a + 1, a + 1, a + row, a + row + 1);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const nor = geo.getAttribute('normal') as THREE.BufferAttribute;
  const col = new Float32Array(cnt * 3);
  for (let n = 0; n < cnt; n++) {
    const h = hts[n];
    const ny = Math.abs(nor.getY(n));
    const west = bump((azs[n] * Math.PI) / 180, 250, 90);
    const east = bump((azs[n] * Math.PI) / 180, 112, 50);
    // slate in the west and south, a browner, darker rock in the east
    const base = 0.44 - 0.08 * east;
    const nz = 0.5 + 0.5 * fbm2(pos[n * 3] * 0.01, pos[n * 3 + 2] * 0.01, 2, 55);
    const shade = base * (0.78 + 0.4 * nz) * (0.7 + 0.5 * ny);
    const line = 150 + 70 * (nz - 0.5) - 30 * east;
    const snow = smoothstep(line, line + 110, h + (ny - 0.55) * 80);
    const rr = shade * (0.9 + 0.06 * east - 0.06 * west);
    const gg = shade * (0.93 - 0.03 * east);
    const bb = shade * (1.06 + 0.06 * west - 0.1 * east);
    col[n * 3] = rr * (1 - snow) + 1.55 * snow;
    col[n * 3 + 1] = gg * (1 - snow) + 1.6 * snow;
    col[n * 3 + 2] = bb * (1 - snow) + 1.7 * snow;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.computeBoundingSphere();
  geo.computeBoundingBox();
  const m = mat('cliff', { key: 'pelennorRing', vertexColors: true, rgb: [0.62, 0.64, 0.7] });
  applyFogCap(m, 0.42);
  const mesh = new THREE.Mesh(geo, m);
  mesh.name = 'pelennor:mountains';
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.frustumCulled = false;
  mesh.userData.noAO = true;
  level.root.add(mesh);
  return mesh;
}

/** pools of brown, sky-mirroring water lying in the churned ground (planar water, irregular edge) */
export function puddles(
  level: LevelAPI,
  ground: Ground,
  list: readonly (readonly [x: number, z: number, r: number, aspect: number, yaw: number])[],
): void {
  for (let i = 0; i < list.length; i++) {
    const [x, z, r, aspect, yaw] = list[i];
    const y = ground(x, z) + 0.085;
    const cs = Math.cos(yaw);
    const sn = Math.sin(yaw);
    const ra = r * aspect;
    const mask = (px: number, pz: number): number => {
      const dx = px - x;
      const dz = pz - z;
      const u = (dx * cs - dz * sn) / ra;
      const v = (dx * sn + dz * cs) / r;
      const q = u * u + v * v;
      return clamp(1 - q + fbm2(px * 0.42 + i * 7, pz * 0.42, 2, 41) * 0.42, 0, 1);
    };
    const w = lake({
      center: [x, z],
      radius: Math.max(ra, r) * 1.25,
      y,
      cell: 0.55,
      depth: 0.4,
      color: 0x34302b,
      shallow: 0x594f42,
      foam: 0,
      ripple: 0.35,
      wave: 0,
      opacity: 0.94,
      // depth = 0.2 * mask - 0.03: dry where the mask is empty, a feathered shoreline, a deeper heart
      terrain: (px, pz) => y - 0.2 * mask(px, pz) + 0.03,
    });
    w.object.name = `pelennor:puddle${i}`;
    level.root.add(w.object);
  }
}

/** lumpy clods of turned earth, thickest where the mud is (one instanced draw call) */
export function clods(level: LevelAPI, ground: Ground, mudAt: Ground, rng: Rng, centre: THREE.Vector3, radius: number, count: number): void {
  const g = new THREE.IcosahedronGeometry(1, 1);
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    const kk = 1 + 0.38 * fbm2(x * 1.7 + 3, z * 1.9 + y, 2, 61);
    p.setXYZ(i, x * kk, y * kk * 0.55, z * kk);
  }
  g.computeVertexNormals();
  const m = mat('mud', { key: 'pelennorClod', rgb: [0.62, 0.52, 0.42] });
  const mesh = new THREE.InstancedMesh(g, m, count);
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const mm = new THREE.Matrix4();
  const c = new THREE.Color();
  let n = 0;
  let guard = 0;
  while (n < count && guard++ < count * 20) {
    const a = rng.float() * Math.PI * 2;
    const d = 5 + Math.sqrt(rng.float()) * radius;
    const x = centre.x + Math.cos(a) * d;
    const z = centre.z + Math.sin(a) * d;
    if (rng.float() > mudAt(x, z) * 1.1) continue;
    const s = 0.1 + Math.pow(rng.float(), 2.2) * 0.42;
    e.set((rng.float() - 0.5) * 0.7, rng.float() * 6.28, (rng.float() - 0.5) * 0.7);
    q.setFromEuler(e);
    mm.compose(new THREE.Vector3(x, ground(x, z) + 0.02 + s * 0.12, z), q, new THREE.Vector3(s * (0.9 + rng.float() * 0.6), s * (0.8 + rng.float() * 0.5), s * (0.9 + rng.float() * 0.6)));
    mesh.setMatrixAt(n, mm);
    const v = 0.7 + rng.float() * 0.5;
    c.setRGB(v, v * 0.97, v * 0.93);
    mesh.setColorAt(n, c);
    n++;
  }
  mesh.count = n;
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.computeBoundingSphere();
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  mesh.userData.noAO = true;
  mesh.name = 'pelennor:clods';
  level.root.add(mesh);
}

function wheelGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  parts.push(new THREE.TorusGeometry(0.86, 0.075, 6, 20));
  parts.push(new THREE.CylinderGeometry(0.15, 0.15, 0.3, 8).rotateX(Math.PI / 2));
  for (let k = 0; k < 8; k++) {
    if (k === 3 || k === 6) continue; // a couple of spokes broken away
    parts.push(new THREE.BoxGeometry(0.065, 0.74, 0.065).translate(0, 0.5, 0).rotateZ((k * Math.PI) / 4));
  }
  // a stub of axle
  parts.push(new THREE.CylinderGeometry(0.06, 0.06, 1.1, 6).rotateX(Math.PI / 2));
  return mergeGeometries(parts)!;
}

function plankGeometry(len: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(len, 0.06, 0.24, Math.max(2, Math.round(len)), 1, 1);
  // splintered, uneven ends
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    if (Math.abs(x) > len * 0.45) p.setZ(i, p.getZ(i) * (0.55 + 0.4 * Math.abs(Math.sin(i * 7.31))));
    p.setY(i, p.getY(i) + 0.012 * Math.sin(x * 3.1));
  }
  g.computeVertexNormals();
  return g;
}

function beamGeometry(len: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(len, 0.3, 0.32, Math.max(3, Math.round(len * 1.5)), 1, 1);
  // splintered ends and a sagging run
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const end = Math.max(0, Math.abs(x) - len * 0.4) / (len * 0.1);
    if (end > 0) {
      p.setZ(i, p.getZ(i) * (1 - 0.5 * end * Math.abs(Math.sin(i * 5.3))));
      p.setY(i, p.getY(i) * (1 - 0.35 * end * Math.abs(Math.cos(i * 3.7))));
    }
    p.setY(i, p.getY(i) + 0.05 * Math.sin((x / len) * 5));
  }
  g.computeVertexNormals();
  return g;
}

/**
 * Wheels and splintered planks lying in the mud, kept clear of the mûmak routes. `ok(x,z)` is the
 * caller's placement test (distance from the beasts' corridor and from the spawn).
 */
export function debris(
  level: LevelAPI,
  ground: Ground,
  ok: (x: number, z: number) => boolean,
  rng: Rng,
  centre: THREE.Vector3,
  radius: number,
  heroes: readonly (readonly [x: number, z: number])[] = [],
): void {
  const low = worldQuality() === 'low';
  const wood = mat('old_wood', { key: 'pelennorDebris', rgb: [0.62, 0.55, 0.48] });
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const mm = new THREE.Matrix4();
  type Pose = { y: number; rx: number; rz: number; s: number };
  const place = (geo: THREE.BufferGeometry, n: number, perHero: number, name: string, build: (r: Rng) => Pose) => {
    const total = n + heroes.length * perHero;
    const mesh = new THREE.InstancedMesh(geo, wood, total);
    let k = 0;
    // the heroes: a litter of wreckage close to the line of march, so the foreground is never bare mud
    for (const [hx, hz] of heroes) {
      for (let i = 0, g = 0; i < perHero && g < 30; g++) {
        const a = rng.float() * Math.PI * 2;
        const d = 1.5 + Math.sqrt(rng.float()) * 5.5;
        const x = hx + Math.cos(a) * d;
        const z = hz + Math.sin(a) * d;
        if (!ok(x, z)) continue;
        const o = build(rng);
        e.set(o.rx, rng.float() * 6.28, o.rz, 'YXZ');
        q.setFromEuler(e);
        mm.compose(new THREE.Vector3(x, ground(x, z) + o.y, z), q, new THREE.Vector3(o.s, o.s, o.s));
        mesh.setMatrixAt(k++, mm);
        i++;
      }
    }
    let guard = 0;
    for (let placed = 0; placed < n && guard++ < n * 60; ) {
      const a = rng.float() * Math.PI * 2;
      const d = 7 + Math.sqrt(rng.float()) * radius;
      const x = centre.x + Math.cos(a) * d;
      const z = centre.z + Math.sin(a) * d;
      if (!ok(x, z)) continue;
      const o = build(rng);
      e.set(o.rx, rng.float() * 6.28, o.rz, 'YXZ');
      q.setFromEuler(e);
      mm.compose(new THREE.Vector3(x, ground(x, z) + o.y, z), q, new THREE.Vector3(o.s, o.s, o.s));
      mesh.setMatrixAt(k++, mm);
      placed++;
    }
    mesh.count = k;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    mesh.castShadow = !low;
    mesh.receiveShadow = true;
    mesh.userData.noAO = true;
    mesh.name = name;
    level.root.add(mesh);
  };
  // planks: three lengths, flat, leaning on each other, or driven in at a slant
  for (const [len, n, ph] of [[1.7, low ? 14 : 38, 4], [2.7, low ? 12 : 30, 3], [4.2, low ? 8 : 20, 2]] as [number, number, number][]) {
    place(plankGeometry(len), n, ph, `pelennor:planks${len}`, (r) => {
      const slant = r.chance(0.4);
      return { y: slant ? 0.2 + r.float() * 0.25 : 0.05, rx: 0, rz: slant ? (r.float() - 0.5) * 1.0 : (r.float() - 0.5) * 0.16, s: 0.9 + r.float() * 0.3 };
    });
  }
  // beams: the great timbers of the engines, half-sunk or propped at a slant
  for (const [len, n, ph] of [[3.4, low ? 6 : 14, 2], [5.4, low ? 4 : 10, 1]] as [number, number, number][]) {
    place(beamGeometry(len), n, ph, `pelennor:beams${len}`, (r) => {
      const slant = r.chance(0.5);
      return { y: slant ? 0.35 + r.float() * 0.5 : 0.12, rx: 0, rz: slant ? (r.float() - 0.5) * 0.7 : (r.float() - 0.5) * 0.14, s: 0.9 + r.float() * 0.25 };
    });
  }
  // wheels: lying half-sunk, or leaning on their axle stubs (cart wheels well over a man's height)
  place(wheelGeometry(), low ? 5 : 12, 1, 'pelennor:wheels', (r) => {
    const lean = r.chance(0.55);
    const sc = 1.0 + r.float() * 0.55;
    return lean ? { y: 0.5 * sc, rx: 0, rz: Math.PI / 2 - 0.2 - r.float() * 0.3, s: sc } : { y: 0.1 + r.float() * 0.2, rx: Math.PI / 2 + (r.float() - 0.5) * 0.4, rz: (r.float() - 0.5) * 0.4, s: sc };
  });
}

export interface Host {
  cx: number;
  cz: number;
  hx: number;
  hz: number;
  /** flag colour of the host */
  flag: number;
  /** how many shafts */
  n: number;
}

/**
 * The pike-forests of the hosts: thousands of upright shafts with a few flags, and tall standards.
 * Drawn instanced and unlit-cheap, so the ranks beyond the crowds read as armies. (Never casts shadows.)
 */
export function hostForest(level: LevelAPI, ground: Ground, hosts: readonly Host[], standards: readonly (readonly [x: number, z: number, h: number, colour: number])[], rng: Rng): void {
  const low = worldQuality() === 'low';
  const shaft = new THREE.BoxGeometry(0.1, 1, 0.1).translate(0, 0.5, 0);
  const tip = new THREE.ConeGeometry(0.11, 0.3, 4).translate(0, 1.0, 0);
  const shaftTip = mergeGeometries([shaft, tip])!;
  const dark = new THREE.MeshLambertMaterial({ color: 0x3a3028 });
  const total = hosts.reduce((s, h) => s + Math.round(h.n * (low ? 0.4 : 1)), 0);
  const spears = new THREE.InstancedMesh(shaftTip, dark, total);
  const flagGeo = new THREE.PlaneGeometry(0.9, 0.55).translate(0.45, 0, 0);
  const flagMat = new THREE.MeshLambertMaterial({ color: 0xffffff, side: THREE.DoubleSide });
  const flagCount = hosts.reduce((s, h) => s + Math.round(h.n * (low ? 0.4 : 1) * 0.07), 0);
  const flags = new THREE.InstancedMesh(flagGeo, flagMat, flagCount);
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const mm = new THREE.Matrix4();
  const c = new THREE.Color();
  let ns = 0;
  let nf = 0;
  for (const h of hosts) {
    const n = Math.round(h.n * (low ? 0.4 : 1));
    for (let i = 0; i < n; i++) {
      const x = h.cx + (rng.float() * 2 - 1) * h.hx;
      const z = h.cz + (rng.float() * 2 - 1) * h.hz;
      const len = 3.6 + rng.float() * 1.2;
      e.set((rng.float() - 0.5) * 0.18, rng.float() * 6.28, (rng.float() - 0.5) * 0.18, 'YXZ');
      q.setFromEuler(e);
      const y = ground(x, z) + 1.0;
      mm.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(1, len, 1));
      spears.setMatrixAt(ns++, mm);
      if (nf < flagCount && rng.chance(0.07)) {
        e.set(0, rng.float() * 6.28, 0);
        q.setFromEuler(e);
        mm.compose(new THREE.Vector3(x, y + len - 0.45, z), q, new THREE.Vector3(1, 1, 1));
        flags.setMatrixAt(nf, mm);
        c.setHex(rng.chance(0.25) ? 0x15130f : h.flag);
        flags.setColorAt(nf, c);
        nf++;
      }
    }
  }
  spears.count = ns;
  flags.count = nf;
  for (const m of [spears, flags]) {
    m.instanceMatrix.needsUpdate = true;
    m.computeBoundingSphere();
    m.castShadow = false;
    m.receiveShadow = false;
    m.userData.noAO = true;
  }
  if (flags.instanceColor) flags.instanceColor.needsUpdate = true;
  spears.name = 'pelennor:pikes';
  flags.name = 'pelennor:flags';
  level.root.add(spears, flags);

  // tall standards: a pole and a big banner of cloth hanging from a crossbar
  if (!standards.length) return;
  const pole = new THREE.CylinderGeometry(0.1, 0.14, 1, 6).translate(0, 0.5, 0);
  const cloth = new THREE.PlaneGeometry(2.0, 1, 1, 6).translate(1.1, -0.5, 0);
  const cp = cloth.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < cp.count; i++) cp.setZ(i, Math.sin(cp.getY(i) * 5.0 + cp.getX(i) * 1.7) * 0.18 * Math.abs(cp.getX(i) - 0.1));
  cloth.computeVertexNormals();
  const poles = new THREE.InstancedMesh(pole, dark, standards.length);
  const cloths = new THREE.InstancedMesh(cloth, flagMat, standards.length);
  const sc = new THREE.Vector3();
  standards.forEach(([x, z, hgt, colour], i) => {
    e.set(0, rng.float() * 6.28, (rng.float() - 0.5) * 0.08);
    q.setFromEuler(e);
    const y = ground(x, z) - 0.2;
    mm.compose(new THREE.Vector3(x, y, z), q, sc.set(1, hgt, 1));
    poles.setMatrixAt(i, mm);
    mm.compose(new THREE.Vector3(x, y + hgt - 0.3, z), q, sc.set(1, hgt * 0.34, 1));
    cloths.setMatrixAt(i, mm);
    c.setHex(colour);
    cloths.setColorAt(i, c);
  });
  for (const m of [poles, cloths]) {
    m.instanceMatrix.needsUpdate = true;
    m.computeBoundingSphere();
    m.castShadow = false;
    m.receiveShadow = false;
    m.userData.noAO = true;
  }
  if (cloths.instanceColor) cloths.instanceColor.needsUpdate = true;
  poles.name = 'pelennor:standards';
  cloths.name = 'pelennor:standardCloth';
  level.root.add(poles, cloths);
}
