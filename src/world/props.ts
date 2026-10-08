/**
 * Props: rocks, boulder fields, barrels, crates, torches, braziers, banners, wells, ladders, chains,
 * skeletons, weapon racks, ice sheets, bats, fallen logs, boats, lanterns.
 *
 * Every builder returns `{ object, colliders }` (see colliders.ts). Origins sit on the ground
 * (y = 0 at the base) unless noted. Colliders are in the object's local space: place the object,
 * then call `addColliders(physics, built.colliders, built.object)`.
 */
import * as THREE from 'three';
import { Rng, hashSeed } from '../core/rng';
import { mat, plain } from './mats';
import { latheGeo, limbGeo, rockGeometry, xf, type RockOpts } from './geom';
import { MeshKit, bakeFaceBoxUV, type Area, type HeightFn } from './util';
import { flame } from './fire';
import { applyWind, tickWind } from './shader';
import { getTextureSet } from './textures';
import type { Built, ColliderDesc } from './colliders';

export { addColliders, removeColliders, colliderMesh } from './colliders';
export type { ColliderDesc, Built } from './colliders';
export type { ColliderOpts } from './colliders';

const group = (name: string, kit: MeshKit): THREE.Group => kit.build({ name });

// ───────────────────────────────────────────────────────────────────────────────────────────
// Rocks
// ───────────────────────────────────────────────────────────────────────────────────────────

export type RockKind = 'rock' | 'cliff' | 'ice' | 'dark';

function rockMaterial(kind: RockKind, moss: boolean): THREE.Material {
  switch (kind) {
    case 'cliff': return mat('cliff', { vertexColors: moss, key: 'rk' });
    case 'ice': return mat('ice', { key: 'rk' });
    case 'dark': return mat('rock', { vertexColors: moss, rgb: [0.55, 0.52, 0.5], key: 'rkd' });
    default: return mat('rock', { vertexColors: moss, key: 'rk' });
  }
}

/** one rock. `size` = radius in metres (rocks are ~1.4 wide per unit). Sits on y = 0. */
export function rock(size = 1, seed = 1, o: RockOpts & { kind?: RockKind } = {}): Built {
  const geo = rockGeometry(seed, o);
  const mesh = new THREE.Mesh(geo, rockMaterial(o.kind ?? 'rock', !!o.moss));
  const flat = o.flat ?? 0.72;
  mesh.scale.setScalar(size);
  mesh.position.y = 0.42 * flat * size;
  mesh.castShadow = mesh.receiveShadow = true;
  const g = new THREE.Group();
  g.name = 'rock';
  g.add(mesh);
  geo.computeBoundingBox();
  const bb = geo.boundingBox!;
  const hx = Math.max(Math.abs(bb.min.x), bb.max.x) * size;
  const hz = Math.max(Math.abs(bb.min.z), bb.max.z) * size;
  const h = (bb.max.y - bb.min.y) * size;
  const colliders: ColliderDesc[] = [{ kind: 'cyl', x: 0, z: 0, r: Math.min(hx, hz) * 0.82, y0: 0, y1: h * 0.82, opts: { material: 'stone', tag: 'rock' } }];
  return { object: g, colliders };
}

export interface BoulderOpts {
  seed?: number;
  kind?: RockKind;
  moss?: number;
  exclude?: (x: number, z: number) => boolean;
  /** rocks at least this big (radius) get a collider (default 0.55) */
  colliderMin?: number;
  /** bury depth as a fraction of the radius (default 0.15) */
  sink?: number;
  /** cluster tightness 0..1 */
  clump?: number;
}

/** instanced scatter of rocks (5 variants). Colliders are in world coordinates. */
export function boulderField(area: Area, count: number, size: [number, number], heightAt: HeightFn, o: BoulderOpts = {}): Built {
  const rng = new Rng(hashSeed('boulders', o.seed ?? 1, count, area.center.x, area.center.z));
  const nVar = 5;
  const moss = o.moss ?? 0;
  const buckets: THREE.Matrix4[][] = Array.from({ length: nVar }, () => []);
  const cols: THREE.Color[][] = Array.from({ length: nVar }, () => []);
  const colliders: ColliderDesc[] = [];
  const centers: [number, number][] = [];
  const nc = Math.max(1, Math.round(count / 6));
  for (let i = 0; i < nc; i++) centers.push([area.center.x + (rng.float() * 2 - 1) * area.halfSize[0], area.center.z + (rng.float() * 2 - 1) * area.halfSize[1]]);
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  let guard = 0;
  let placed = 0;
  while (placed < count && guard++ < count * 10) {
    let x: number;
    let z: number;
    if (rng.float() < (o.clump ?? 0.5)) {
      const c = centers[Math.floor(rng.float() * centers.length)];
      x = c[0] + rng.gauss() * 4;
      z = c[1] + rng.gauss() * 4;
      if (Math.abs(x - area.center.x) > area.halfSize[0] || Math.abs(z - area.center.z) > area.halfSize[1]) continue;
    } else {
      x = area.center.x + (rng.float() * 2 - 1) * area.halfSize[0];
      z = area.center.z + (rng.float() * 2 - 1) * area.halfSize[1];
    }
    if (o.exclude?.(x, z)) continue;
    const v = Math.floor(rng.float() * nVar);
    const s = size[0] + Math.pow(rng.float(), 2) * (size[1] - size[0]);
    const flat = 0.72;
    const y = heightAt(x, z) + 0.42 * flat * s - s * (o.sink ?? 0.15);
    e.set((rng.float() - 0.5) * 0.25, rng.float() * Math.PI * 2, (rng.float() - 0.5) * 0.25);
    q.setFromEuler(e);
    buckets[v].push(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), q.clone(), new THREE.Vector3(s, s * (0.8 + rng.float() * 0.5), s * (0.85 + rng.float() * 0.3))));
    const b = 0.8 + rng.float() * 0.35;
    cols[v].push(new THREE.Color(b, b * (0.97 + rng.float() * 0.06), b * (0.94 + rng.float() * 0.08)));
    if (s >= (o.colliderMin ?? 0.55)) {
      colliders.push({ kind: 'cyl', x, z, r: s * 0.95, y0: heightAt(x, z) - 0.5, y1: heightAt(x, z) + s * 1.0, opts: { material: 'stone', tag: 'rock' } });
    }
    placed++;
  }
  const g = new THREE.Group();
  g.name = 'boulders';
  for (let v = 0; v < nVar; v++) {
    if (!buckets[v].length) continue;
    const geo = rockGeometry(v + 11, { moss });
    const m = new THREE.InstancedMesh(geo, rockMaterial(o.kind ?? 'rock', moss > 0), buckets[v].length);
    buckets[v].forEach((mm, i) => {
      m.setMatrixAt(i, mm);
      m.setColorAt(i, cols[v][i]);
    });
    m.instanceMatrix.needsUpdate = true;
    m.computeBoundingSphere();
    m.castShadow = m.receiveShadow = true;
    g.add(m);
  }
  return { object: g, colliders };
}

// ───────────────────────────────────────────────────────────────────────────────────────────
// Barrels and crates
// ───────────────────────────────────────────────────────────────────────────────────────────

export function barrel(o: { height?: number; open?: boolean; seed?: number; lying?: boolean } = {}): Built {
  const h = o.height ?? 0.95;
  const rng = new Rng(hashSeed('barrel', o.seed ?? 1));
  const k = h / 0.9;
  const bulge = (y: number) => 0.36 + 0.095 * Math.sin((y / 0.9) * Math.PI);
  const prof: [number, number][] = [];
  for (let i = 0; i <= 10; i++) {
    const y = (i / 10) * 0.9;
    prof.push([bulge(y), y]);
  }
  const kit = new MeshKit();
  const wood = mat('old_wood', { key: 'barrel', rgb: [1.05, 0.95, 0.85] });
  const iron = mat('metal_dark', { key: 'barrel' });
  const body = latheGeo(prof, 28, 1.2, true);
  kit.add(wood, body);
  // lid
  const lid = new THREE.CircleGeometry(0.34, 28);
  lid.rotateX(-Math.PI / 2);
  lid.translate(0, 0.885, 0);
  const luv = lid.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < luv.count; i++) luv.setXY(i, luv.getX(i) * 0.8, luv.getY(i) * 0.8);
  if (!o.open) kit.add(wood, lid);
  else {
    const dark = new THREE.CircleGeometry(0.32, 20);
    dark.rotateX(-Math.PI / 2);
    dark.translate(0, 0.7, 0);
    kit.add(plain(0x1a140e, { roughness: 0.4 }), dark);
  }
  const bottom = new THREE.CircleGeometry(0.34, 20);
  bottom.rotateX(Math.PI / 2);
  kit.add(wood, bottom);
  for (const y of [0.07, 0.24, 0.66, 0.83]) {
    const band = latheGeo([[bulge(y - 0.025) + 0.012, y - 0.025], [bulge(y - 0.025) + 0.016, y - 0.02], [bulge(y + 0.025) + 0.016, y + 0.02], [bulge(y + 0.025) + 0.012, y + 0.025]], 28, 0.5);
    kit.add(iron, band);
  }
  const g = group('barrel', kit);
  g.scale.setScalar(k);
  if (o.lying) {
    g.rotation.z = Math.PI / 2;
    g.position.y = 0.46 * k;
  }
  g.rotation.y = rng.float() * Math.PI * 2;
  const wrap = new THREE.Group();
  wrap.add(g);
  const r = 0.44 * k;
  const colliders: ColliderDesc[] = o.lying
    ? [{ kind: 'box', center: [0, r, 0], half: [0.45 * k, r * 0.9, r * 0.9], opts: { material: 'wood', tag: 'barrel' } }]
    : [{ kind: 'cyl', x: 0, z: 0, r, y0: 0, y1: h, opts: { material: 'wood', tag: 'barrel' } }];
  return { object: wrap, colliders };
}

export function crate(size: number | [number, number, number] = 0.9, o: { seed?: number } = {}): Built {
  const [w, h, d] = typeof size === 'number' ? [size, size, size] : size;
  const rng = new Rng(hashSeed('crate', o.seed ?? 1, w, h, d));
  const kit = new MeshKit();
  const plank = mat('wood_planks', { key: 'crate', rgb: [1.0, 0.9, 0.78] });
  const frame = mat('old_wood', { key: 'crate' });
  const t = 0.05;
  const yaw = 0;
  kit.box(plank, [w - 0.02, h - 0.02, d - 0.02], [0, h / 2, 0], yaw, { tile: 1.2 });
  const p = 0.065;
  // corner posts and rails
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) kit.box(frame, [p, h + 0.01, p], [sx * (w / 2 - p / 2 + 0.005), h / 2, sz * (d / 2 - p / 2 + 0.005)], 0, { tile: 1.2 });
  for (const sy of [0.04, h - 0.04]) {
    for (const sz of [-1, 1]) kit.box(frame, [w + 0.012, 0.075, p], [0, sy, sz * (d / 2 - p / 2 + 0.005)], 0, { tile: 1.2 });
    for (const sx of [-1, 1]) kit.box(frame, [p, 0.075, d + 0.012], [sx * (w / 2 - p / 2 + 0.005), sy, 0], 0, { tile: 1.2 });
  }
  // diagonal braces on the long faces
  for (const sz of [-1, 1]) kit.box(frame, [Math.hypot(w, h) * 0.8, 0.06, t], [0, h / 2, sz * (d / 2 + 0.008)], 0, { tile: 1.2 }, [0, Math.atan2(h, w) * (rng.chance(0.5) ? 1 : -1) * 0 + 0]);
  const g = group('crate', kit);
  const colliders: ColliderDesc[] = [{ kind: 'box', center: [0, h / 2, 0], half: [w / 2, h / 2, d / 2], opts: { material: 'wood', tag: 'crate' } }];
  return { object: g, colliders };
}

// ───────────────────────────────────────────────────────────────────────────────────────────
// Fire props
// ───────────────────────────────────────────────────────────────────────────────────────────

/** hand torch standing upright (origin at the base), or a wall torch in an iron bracket (`wall`) */
export function torch(o: { lit?: boolean; wall?: boolean; length?: number } = {}): Built & { flameAnchor: THREE.Object3D } {
  const L = o.length ?? 1.0;
  const kit = new MeshKit();
  const wood = mat('old_wood', { key: 'torch' });
  const iron = mat('metal_dark', { key: 'torch' });
  const cloth = mat('cloth_wool', { key: 'torch', rgb: [0.25, 0.2, 0.15] });
  kit.add(wood, limbGeo([0, 0, 0], [0, L, 0], 0.03, 0.036, 8, 0.5));
  const head = latheGeo([[0.0, 0], [0.045, 0], [0.065, 0.06], [0.07, 0.12], [0.05, 0.17], [0.0, 0.18]], 12, 0.3);
  head.translate(0, L - 0.04, 0);
  kit.add(cloth, head);
  kit.add(iron, limbGeo([0, L - 0.03, 0], [0, L - 0.025, 0], 0.052, 0.052, 10, 0.3));
  const g = group('torch', kit);
  const anchor = new THREE.Object3D();
  anchor.position.set(0, L + 0.12, 0);
  anchor.name = 'flameAnchor';
  g.add(anchor);
  if (o.lit !== false) {
    const f = flame(0.42, 0.22, 0.3);
    f.position.copy(anchor.position).add(new THREE.Vector3(0, -0.12, 0));
    g.add(f);
    const f2 = flame(0.26, 0.14, 1.1);
    f2.position.copy(f.position);
    g.add(f2);
  }
  let root: THREE.Object3D = g;
  const colliders: ColliderDesc[] = [];
  if (o.wall) {
    // iron bracket: torch tilted out from a wall plane at z = 0 (wall behind, flame toward +z)
    const k2 = new MeshKit();
    k2.box(iron, [0.12, 0.28, 0.025], [0, 0, -0.01], 0, { tile: 0.5 });
    k2.add(iron, limbGeo([0, -0.05, 0], [0, -0.05, 0.28], 0.015, 0.015, 6, 0.3));
    k2.add(iron, limbGeo([0, -0.17, -0.01], [0, -0.05, 0.22], 0.012, 0.012, 6, 0.3));
    k2.add(iron, new THREE.TorusGeometry(0.06, 0.012, 6, 12), xf(0, -0.03, 0.29, 0, 1, 1, 1, Math.PI / 2));
    const br = group('bracket', k2);
    const tilt = new THREE.Group();
    tilt.add(g);
    g.position.set(0, -0.15, 0.29);
    tilt.rotation.x = 0;
    const wrap = new THREE.Group();
    wrap.add(br, tilt);
    root = wrap;
    wrap.position.y = 0;
  }
  return { object: root, colliders, flameAnchor: anchor };
}

/** iron brazier on a tripod. Origin at the base, bowl rim at 0.95 m. */
export function brazier(o: { lit?: boolean; scale?: number } = {}): Built & { flameAnchor: THREE.Object3D } {
  const s = o.scale ?? 1;
  const kit = new MeshKit();
  const iron = mat('metal_dark', { key: 'brazier', rgb: [0.9, 0.85, 0.8] });
  const bowl = latheGeo([[0.0, 0.0], [0.12, 0.0], [0.22, 0.06], [0.34, 0.17], [0.42, 0.3], [0.45, 0.34], [0.42, 0.35], [0.38, 0.3], [0.3, 0.18], [0.2, 0.1], [0.0, 0.07]], 20, 0.8);
  bowl.translate(0, 0.6, 0);
  kit.add(iron, bowl);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.4;
    kit.add(iron, limbGeo([Math.cos(a) * 0.28, 0.72, Math.sin(a) * 0.28], [Math.cos(a) * 0.4, 0.02, Math.sin(a) * 0.4], 0.025, 0.02, 6, 0.5));
    kit.add(iron, limbGeo([Math.cos(a) * 0.4, 0.02, Math.sin(a) * 0.4], [Math.cos(a) * 0.43, 0.0, Math.sin(a) * 0.43], 0.03, 0.03, 6, 0.5));
  }
  kit.add(iron, new THREE.TorusGeometry(0.31, 0.014, 6, 20), xf(0, 0.28, 0, 0, 1, 1, 1, Math.PI / 2));
  const g = group('brazier', kit);
  // coals
  const coalMat = new THREE.MeshStandardMaterial({ color: 0x120a06, roughness: 0.9, emissive: 0xff5a14, emissiveIntensity: 1.6 });
  coalMat.name = 'coals';
  const coals = new THREE.Mesh(new THREE.SphereGeometry(0.36, 14, 6, 0, Math.PI * 2, 0, Math.PI * 0.35), coalMat);
  coals.scale.y = 0.3;
  coals.position.y = 0.88;
  g.add(coals);
  const anchor = new THREE.Object3D();
  anchor.position.set(0, 1.0, 0);
  g.add(anchor);
  if (o.lit !== false) {
    for (const [fh, fw, sd, ox, oz] of [[0.7, 0.42, 0.2, 0, 0], [0.5, 0.34, 1.3, 0.12, 0.08], [0.42, 0.3, 2.4, -0.1, -0.1]] as [number, number, number, number, number][]) {
      const f = flame(fh, fw, sd);
      f.position.set(ox, 0.9, oz);
      g.add(f);
    }
  }
  g.scale.setScalar(s);
  const colliders: ColliderDesc[] = [{ kind: 'cyl', x: 0, z: 0, r: 0.4 * s, y0: 0, y1: 0.95 * s, opts: { walkable: false, material: 'metal', tag: 'brazier' } }];
  return { object: g, colliders, flameAnchor: anchor };
}

// ───────────────────────────────────────────────────────────────────────────────────────────
// Banners
// ───────────────────────────────────────────────────────────────────────────────────────────

export type Emblem = 'none' | 'white_hand' | 'eye' | 'white_tree' | 'horse' | 'hammer' | 'wolf';

const bannerTex = new Map<string, THREE.CanvasTexture>();

function paintEmblem(ctx: CanvasRenderingContext2D, w: number, h: number, emblem: Emblem): void {
  ctx.save();
  ctx.translate(w / 2, h * 0.42);
  const u = w / 100;
  ctx.fillStyle = '#e8e4da';
  ctx.strokeStyle = '#e8e4da';
  ctx.lineCap = 'round';
  switch (emblem) {
    case 'white_hand': {
      ctx.beginPath();
      ctx.ellipse(0, 18 * u, 17 * u, 21 * u, 0, 0, Math.PI * 2);
      ctx.fill();
      const fingers: [number, number, number][] = [[-22, -2, -0.35], [-9, -22, -0.1], [5, -26, 0.05], [18, -20, 0.2]];
      for (const [fx, fy, rot] of fingers) {
        ctx.save();
        ctx.translate(fx * u, (fy + 20) * u);
        ctx.rotate(rot);
        ctx.lineWidth = 9 * u;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(0, -24 * u);
        ctx.stroke();
        ctx.restore();
      }
      ctx.save();
      ctx.translate(-20 * u, 30 * u);
      ctx.rotate(-1.0);
      ctx.lineWidth = 10 * u;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(0, -20 * u);
      ctx.stroke();
      ctx.restore();
      break;
    }
    case 'eye': {
      const g = ctx.createRadialGradient(0, 0, 2 * u, 0, 0, 34 * u);
      g.addColorStop(0, '#fff2a0');
      g.addColorStop(0.45, '#ff9a1c');
      g.addColorStop(1, 'rgba(180,30,0,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(0, 0, 38 * u, 20 * u, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#0a0604';
      ctx.beginPath();
      ctx.ellipse(0, 0, 5 * u, 17 * u, 0, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'white_tree': {
      ctx.lineWidth = 7 * u;
      ctx.beginPath();
      ctx.moveTo(0, 40 * u);
      ctx.lineTo(0, -10 * u);
      ctx.stroke();
      ctx.lineWidth = 4 * u;
      for (const [dx, dy] of [[-26, -26], [26, -26], [-34, -4], [34, -4], [-18, 8], [18, 8], [0, -34]] as [number, number][]) {
        ctx.beginPath();
        ctx.moveTo(0, (dy > 0 ? 30 : 8) * u);
        ctx.quadraticCurveTo(dx * 0.3 * u, dy * 0.4 * u, dx * u, dy * u);
        ctx.stroke();
      }
      // seven stars
      for (let i = 0; i < 7; i++) {
        const a = -Math.PI / 2 + (i - 3) * 0.32;
        ctx.beginPath();
        ctx.arc(Math.cos(a) * 48 * u, Math.sin(a) * 48 * u - 14 * u, 2.4 * u, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case 'horse': {
      ctx.fillStyle = '#ece6d4';
      ctx.beginPath();
      ctx.moveTo(-34 * u, 8 * u);
      ctx.quadraticCurveTo(-30 * u, -8 * u, -12 * u, -10 * u);
      ctx.lineTo(10 * u, -12 * u);
      ctx.quadraticCurveTo(24 * u, -34 * u, 36 * u, -30 * u);
      ctx.lineTo(40 * u, -22 * u);
      ctx.lineTo(32 * u, -16 * u);
      ctx.quadraticCurveTo(26 * u, 4 * u, 24 * u, 14 * u);
      ctx.lineTo(30 * u, 40 * u);
      ctx.lineTo(24 * u, 40 * u);
      ctx.lineTo(14 * u, 16 * u);
      ctx.lineTo(-10 * u, 16 * u);
      ctx.lineTo(-24 * u, 38 * u);
      ctx.lineTo(-30 * u, 36 * u);
      ctx.lineTo(-28 * u, 20 * u);
      ctx.lineTo(-40 * u, 34 * u);
      ctx.lineTo(-44 * u, 28 * u);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'hammer': {
      ctx.lineWidth = 7 * u;
      ctx.beginPath();
      ctx.moveTo(-24 * u, 34 * u);
      ctx.lineTo(18 * u, -22 * u);
      ctx.stroke();
      ctx.fillRect(-4 * u, -40 * u, 40 * u, 20 * u);
      ctx.fillRect(-34 * u, 30 * u, 30 * u, 8 * u);
      break;
    }
    case 'wolf': {
      ctx.beginPath();
      ctx.moveTo(-30 * u, 30 * u);
      ctx.lineTo(-26 * u, -4 * u);
      ctx.lineTo(-14 * u, -28 * u);
      ctx.lineTo(-8 * u, -14 * u);
      ctx.lineTo(8 * u, -14 * u);
      ctx.lineTo(14 * u, -28 * u);
      ctx.lineTo(26 * u, -4 * u);
      ctx.lineTo(30 * u, 30 * u);
      ctx.lineTo(8 * u, 20 * u);
      ctx.lineTo(-8 * u, 20 * u);
      ctx.closePath();
      ctx.fill();
      break;
    }
    default:
      break;
  }
  ctx.restore();
}

function bannerTexture(color: number, emblem: Emblem): THREE.CanvasTexture {
  const key = `${color}|${emblem}`;
  let t = bannerTex.get(key);
  if (t) return t;
  const W = 256;
  const H = 512;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d')!;
  const col = new THREE.Color(color).getStyle();
  ctx.fillStyle = col;
  ctx.fillRect(0, 0, W, H);
  // cloth weave and fold shading
  const img = ctx.getImageData(0, 0, W, H);
  const rng = new Rng(hashSeed('banner', color));
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const weave = ((x >> 1) + (y >> 1)) % 2 ? 1.0 : 0.94;
      const fold = 0.88 + 0.12 * Math.sin(x * 0.09 + Math.sin(y * 0.02) * 2);
      const f = weave * fold * (0.96 + rng.float() * 0.08);
      img.data[i] *= f;
      img.data[i + 1] *= f;
      img.data[i + 2] *= f;
    }
  }
  ctx.putImageData(img, 0, 0);
  paintEmblem(ctx, W, H, emblem);
  // frayed, dark lower edge
  const edge = ctx.createLinearGradient(0, H * 0.9, 0, H);
  edge.addColorStop(0, 'rgba(0,0,0,0)');
  edge.addColorStop(1, 'rgba(0,0,0,0.35)');
  ctx.fillStyle = edge;
  ctx.fillRect(0, H * 0.9, W, H * 0.1);
  t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.userData.shared = true;
  bannerTex.set(key, t);
  return t;
}

/** standing banner: pole + hanging cloth with an emblem. Cloth sways in the wind. Origin at the pole base. */
export function banner(color = 0x8a1c14, emblem: Emblem = 'none', o: { height?: number; clothW?: number; clothH?: number } = {}): Built {
  const H = o.height ?? 3.2;
  const cw = o.clothW ?? 1.1;
  const ch = o.clothH ?? 2.2;
  const kit = new MeshKit();
  const wood = mat('old_wood', { key: 'banner' });
  const iron = mat('metal_dark', { key: 'banner' });
  kit.add(wood, limbGeo([0, 0, 0], [0, H, 0], 0.045, 0.035, 8, 0.6));
  kit.add(wood, limbGeo([-0.05, H - 0.2, 0], [cw + 0.05, H - 0.2, 0], 0.025, 0.025, 6, 0.6));
  kit.add(iron, new THREE.SphereGeometry(0.06, 8, 6), xf(0, H + 0.04, 0));
  kit.add(iron, limbGeo([0, H + 0.04, 0], [0, H + 0.28, 0], 0.045, 0.002, 6, 0.3));
  const g = group('banner', kit);
  // cloth
  const segX = 6;
  const segY = 14;
  const geo = new THREE.PlaneGeometry(cw, ch, segX, segY);
  geo.translate(cw / 2, -ch / 2 + H - 0.22, 0);
  const wind = new Float32Array((segX + 1) * (segY + 1) * 2);
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const v = 1 - (pos.getY(i) - (H - 0.22 - ch)) / ch; // 0 at the top bar, 1 at the hem
    const x = pos.getX(i) / cw;
    wind[i * 2] = Math.min(1, 0.15 + x * 0.6 + v * 0.3);
    wind[i * 2 + 1] = 0.5 * v;
  }
  geo.setAttribute('aWind', new THREE.BufferAttribute(wind, 2));
  const set = getTextureSet('cloth_wool');
  const cloth = new THREE.MeshPhysicalMaterial({
    map: bannerTexture(color, emblem),
    normalMap: (() => {
      const n = set.normalMap.clone();
      n.repeat.set(4, 8);
      n.userData.shared = true;
      return n;
    })(),
    roughness: 0.82,
    sheen: 0.5,
    sheenColor: new THREE.Color(0xd8d0c0),
    sheenRoughness: 0.6,
    side: THREE.DoubleSide,
  });
  applyWind(cloth, { bend: 0.5, flutter: 0.22 });
  const m = new THREE.Mesh(geo, cloth);
  m.castShadow = m.receiveShadow = true;
  m.onBeforeRender = tickWind;
  g.add(m);
  const colliders: ColliderDesc[] = [{ kind: 'cyl', x: 0, z: 0, r: 0.07, y0: 0, y1: H, opts: { walkable: false, tag: 'banner' } }];
  return { object: g, colliders };
}

// ───────────────────────────────────────────────────────────────────────────────────────────
// Well, ladder, chain
// ───────────────────────────────────────────────────────────────────────────────────────────

export function ringColliders(cx: number, cz: number, rIn: number, rOut: number, y0: number, y1: number, n = 10, opts: ColliderDesc['opts'] = {}): ColliderDesc[] {
  const out: ColliderDesc[] = [];
  const rm = (rIn + rOut) / 2;
  const chord = 2 * rOut * Math.tan(Math.PI / n);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    out.push({ kind: 'box', center: [cx + Math.cos(a) * rm, (y0 + y1) / 2, cz + Math.sin(a) * rm], half: [(rOut - rIn) / 2, (y1 - y0) / 2, chord / 2], yaw: -a, opts });
  }
  return out;
}

/** stone well with a wooden frame. `hole` leaves the shaft open (colliders form a ring). */
export function well(o: { radius?: number; roof?: boolean; water?: boolean } = {}): Built {
  const R = o.radius ?? 0.85;
  const kit = new MeshKit();
  const stone = mat('stone_blocks', { key: 'well' });
  const wood = mat('old_wood', { key: 'well' });
  const ring = latheGeo([[R - 0.22, -0.4], [R, -0.4], [R, 0.92], [R + 0.03, 0.92], [R + 0.03, 1.0], [R - 0.25, 1.0], [R - 0.25, 0.92], [R - 0.22, 0.92]], 28, 1.6);
  kit.add(stone, ring);
  if (o.water !== false) {
    const w = new THREE.CircleGeometry(R - 0.22, 20);
    w.rotateX(-Math.PI / 2);
    w.translate(0, -0.2, 0);
    kit.add(plain(0x040a0c, { roughness: 0.05, metalness: 0.2, key: 'wellwater' }), w);
  }
  if (o.roof !== false) {
    for (const s of [-1, 1]) kit.add(wood, limbGeo([s * (R + 0.02), 0.9, 0], [s * (R + 0.02), 2.3, 0], 0.07, 0.06, 8, 0.8));
    kit.add(wood, limbGeo([-R - 0.1, 2.15, 0], [R + 0.1, 2.15, 0], 0.06, 0.06, 8, 0.8));
    kit.add(wood, limbGeo([-0.3, 2.14, 0], [0.3, 2.14, 0], 0.09, 0.09, 8, 0.4));
    const sh = mat('shingles', { key: 'well' });
    kit.box(sh, [R * 2 + 0.5, 0.05, 0.9], [0, 2.6, 0.38], 0, { tile: 1 }, [-0.7, 0]);
    kit.box(sh, [R * 2 + 0.5, 0.05, 0.9], [0, 2.6, -0.38], 0, { tile: 1 }, [0.7, 0]);
    kit.add(plain(0x3a2a1a, { key: 'rope' }), limbGeo([0, 2.1, 0], [0, 1.1, 0], 0.012, 0.012, 5, 0.3));
    kit.add(wood, latheGeo([[0.0, 0], [0.12, 0], [0.15, 0.05], [0.16, 0.22], [0.0, 0.22]], 10, 0.4), xf(0, 0.92, 0));
  }
  const g = group('well', kit);
  return { object: g, colliders: ringColliders(0, 0, R - 0.25, R + 0.03, -0.4, 1.0, 12, { material: 'stone', tag: 'well' }) };
}

/** wooden ladder. Origin at the foot, rising along +y (lean it by rotating the object). */
export function ladder(height = 3, o: { width?: number; hooks?: boolean; rungGap?: number } = {}): Built {
  const w = o.width ?? 0.5;
  const gap = o.rungGap ?? 0.3;
  const kit = new MeshKit();
  const wood = mat('old_wood', { key: 'ladder', rgb: [1.05, 0.95, 0.85] });
  for (const s of [-1, 1]) kit.add(wood, limbGeo([s * w / 2, 0, 0], [s * w / 2, height, 0], 0.035, 0.03, 6, 0.6));
  for (let y = gap; y < height - 0.05; y += gap) kit.add(wood, limbGeo([-w / 2, y, 0], [w / 2, y, 0], 0.022, 0.022, 5, 0.6));
  if (o.hooks) {
    const iron = mat('metal_dark', { key: 'ladder' });
    for (const s of [-1, 1]) {
      kit.add(iron, limbGeo([s * w / 2, height - 0.05, 0], [s * w / 2, height + 0.18, -0.03], 0.02, 0.016, 5, 0.3));
      kit.add(iron, limbGeo([s * w / 2, height + 0.18, -0.03], [s * w / 2, height + 0.2, -0.22], 0.016, 0.014, 5, 0.3));
    }
  }
  return { object: group('ladder', kit), colliders: [] };
}

/** hanging chain, origin at the top link, hanging down along -y */
export function chain(length = 4, o: { link?: number; thick?: number } = {}): Built {
  const link = o.link ?? 0.1;
  const thick = o.thick ?? 0.018;
  const kit = new MeshKit();
  const iron = mat('metal_dark', { key: 'chain', rgb: [0.9, 0.85, 0.8] });
  const n = Math.max(2, Math.floor(length / (link * 0.78)));
  const tor = new THREE.TorusGeometry(link / 2 - thick, thick, 6, 12);
  for (let i = 0; i < n; i++) {
    const g = tor.clone();
    g.scale(0.62, 1, 1);
    g.rotateY(i % 2 ? Math.PI / 2 : 0);
    g.translate(0, -i * link * 0.78 - link / 2, 0);
    kit.add(iron, g);
  }
  tor.dispose();
  return { object: group('chain', kit), colliders: [] };
}

// ───────────────────────────────────────────────────────────────────────────────────────────
// Skeleton
// ───────────────────────────────────────────────────────────────────────────────────────────

export type SkeletonPose = 'lying' | 'sitting' | 'slumped' | 'sprawled';

type P3 = [number, number, number];

/** dwarf-sized skeleton (origin on the ground below the pelvis). `scale` 1 = 1.75 m human. */
export function skeleton(pose: SkeletonPose = 'lying', seed = 1, scale = 0.82): Built {
  const rng = new Rng(hashSeed('skel', seed));
  const kit = new MeshKit();
  const bone = mat('bone', { key: 'skel' });
  const dark = plain(0x0a0806, { roughness: 1, key: 'sockets' });
  // joints in a local frame, metres at human scale
  let pelvis: P3, neck: P3, head: P3, shL: P3, shR: P3, elL: P3, elR: P3, haL: P3, haR: P3, hipL: P3, hipR: P3, knL: P3, knR: P3, ftL: P3, ftR: P3;
  const j = () => (rng.float() - 0.5) * 0.06;
  if (pose === 'lying' || pose === 'sprawled') {
    const t = pose === 'sprawled' ? 0.5 : 0;
    pelvis = [0, 0.08, 0];
    neck = [0.06 * t, 0.07, 0.56];
    head = [0.1 * t, 0.1, 0.68];
    shL = [-0.19, 0.08, 0.5]; shR = [0.19, 0.08, 0.5];
    elL = [-0.34, 0.05, 0.42 + t * 0.2]; elR = [0.33, 0.05, 0.38 - t * 0.2];
    haL = [-0.46 - t * 0.2, 0.04, 0.24 + t * 0.3]; haR = [0.4, 0.04, 0.2 - t * 0.2];
    hipL = [-0.09, 0.08, 0]; hipR = [0.09, 0.08, 0];
    knL = [-0.14 - t * 0.1, 0.07, -0.42]; knR = [0.13 + t * 0.15, 0.07, -0.4];
    ftL = [-0.16 - t * 0.2, 0.04, -0.82]; ftR = [0.2 + t * 0.2, 0.04, -0.8];
  } else if (pose === 'sitting') {
    pelvis = [0, 0.1, 0];
    neck = [0, 0.6, -0.08];
    head = [0, 0.72, -0.06];
    shL = [-0.18, 0.55, -0.08]; shR = [0.18, 0.55, -0.08];
    elL = [-0.22, 0.32, -0.05]; elR = [0.23, 0.3, 0.0];
    haL = [-0.22, 0.1, 0.12]; haR = [0.25, 0.12, 0.2];
    hipL = [-0.09, 0.1, 0]; hipR = [0.09, 0.1, 0];
    knL = [-0.15, 0.4, 0.38]; knR = [0.13, 0.36, 0.4];
    ftL = [-0.16, 0.03, 0.68]; ftR = [0.15, 0.03, 0.62];
  } else {
    pelvis = [0, 0.1, 0];
    neck = [0, 0.46, 0.18];
    head = [0, 0.44, 0.34];
    shL = [-0.18, 0.44, 0.14]; shR = [0.18, 0.44, 0.14];
    elL = [-0.2, 0.26, 0.2]; elR = [0.2, 0.24, 0.24];
    haL = [-0.16, 0.08, 0.34]; haR = [0.16, 0.08, 0.38];
    hipL = [-0.09, 0.1, 0]; hipR = [0.09, 0.1, 0];
    knL = [-0.2, 0.32, 0.36]; knR = [0.1, 0.12, 0.42];
    ftL = [-0.3, 0.03, 0.6]; ftR = [0.12, 0.03, 0.72];
  }
  const jig = (p: P3): P3 => [p[0] + j(), p[1], p[2] + j()];
  const knob = (p: P3, r: number) => kit.add(bone, new THREE.SphereGeometry(r, 6, 4), xf(p[0], p[1], p[2]), { tile: 0.3 });
  const seg = (a: P3, b: P3, r0: number, r1: number) => kit.add(bone, limbGeo(a, b, r0, r1, 5, 0.3));
  // limbs
  for (const [sh, el, ha] of [[shL, elL, haL], [shR, elR, haR]] as [P3, P3, P3][]) {
    seg(sh, el, 0.017, 0.013); knob(sh, 0.025); knob(el, 0.02);
    seg(el, ha, 0.012, 0.009);
    // hand: fan of finger bones
    for (let f = -2; f <= 2; f++) {
      const d: P3 = [ha[0] - el[0], ha[1] - el[1], ha[2] - el[2]];
      const l = Math.hypot(...d) || 1;
      seg(ha, [ha[0] + (d[0] / l) * 0.09 + f * 0.012, ha[1] + (d[1] / l) * 0.09, ha[2] + (d[2] / l) * 0.09 + f * 0.008], 0.005, 0.003);
    }
  }
  for (const [hp, kn, ft] of [[hipL, knL, ftL], [hipR, knR, ftR]] as [P3, P3, P3][]) {
    seg(hp, kn, 0.022, 0.016); knob(hp, 0.03); knob(kn, 0.026);
    seg(kn, ft, 0.015, 0.011);
    knob(ft, 0.02);
    kit.add(bone, limbGeo([ft[0], ft[1], ft[2]], [ft[0] + (ft[0] > 0 ? 0.01 : -0.01), 0.025, ft[2] + 0.1], 0.016, 0.01, 5, 0.3));
  }
  // pelvis
  kit.add(bone, new THREE.SphereGeometry(1, 8, 5), xf((hipL[0] + hipR[0]) / 2, pelvis[1] + 0.02, pelvis[2] + 0.01, 0, 0.14, 0.07, 0.09));
  // spine + ribs
  const spineDir: P3 = [neck[0] - pelvis[0], neck[1] - pelvis[1], neck[2] - pelvis[2]];
  const sl = Math.hypot(...spineDir);
  const sd: P3 = [spineDir[0] / sl, spineDir[1] / sl, spineDir[2] / sl];
  for (let i = 0; i < 14; i++) {
    const t = 0.12 + (i / 13) * 0.88;
    const p: P3 = [pelvis[0] + spineDir[0] * t, pelvis[1] + spineDir[1] * t, pelvis[2] + spineDir[2] * t];
    knob(p, 0.014 + (i % 2) * 0.002);
  }
  // rib frame: a side vector perpendicular to the spine and world-up-ish
  const side: P3 = [1, 0, 0];
  let fwd: P3 = [sd[1] * side[2] - sd[2] * side[1], sd[2] * side[0] - sd[0] * side[2], sd[0] * side[1] - sd[1] * side[0]];
  const fl = Math.hypot(...fwd) || 1;
  fwd = [fwd[0] / fl, fwd[1] / fl, fwd[2] / fl];
  // choose the forward axis that points away from the ground (chest faces up when lying)
  const upish = pose === 'lying' || pose === 'sprawled';
  if ((upish && fwd[1] < 0) || (!upish && fwd[2] < 0)) fwd = [-fwd[0], -fwd[1], -fwd[2]];
  for (let i = 0; i < 8; i++) {
    const t = 0.38 + (i / 7) * 0.5;
    const c: P3 = [pelvis[0] + spineDir[0] * t, pelvis[1] + spineDir[1] * t, pelvis[2] + spineDir[2] * t];
    const wid = (0.1 + 0.05 * Math.sin((i / 7) * Math.PI * 0.9 + 0.2)) * (i > 5 ? 0.85 : 1);
    const dep = wid * 0.82;
    for (const sgn of [-1, 1]) {
      const pts: P3[] = [];
      for (let k = 0; k <= 5; k++) {
        const a = (k / 5) * Math.PI * 0.62;
        const sx = Math.sin(a) * wid * sgn;
        const sf = (1 - Math.cos(a)) * dep * 0.9;
        pts.push([c[0] + side[0] * sx + fwd[0] * sf - sd[0] * k * 0.004, c[1] + side[1] * sx + fwd[1] * sf - sd[1] * k * 0.004, c[2] + side[2] * sx + fwd[2] * sf - sd[2] * k * 0.004]);
      }
      for (let k = 0; k < 5; k++) seg(pts[k], pts[k + 1], 0.0075, 0.0075);
    }
  }
  // skull
  const hp = jig(head);
  const tilt = pose === 'slumped' ? 0.5 : pose === 'sitting' ? 0.1 : 0.0;
  const sk = new THREE.SphereGeometry(1, 12, 8);
  kit.add(bone, sk, xf(hp[0], hp[1] + 0.04, hp[2], 0, 0.085, 0.1, 0.105, tilt + (upish ? -0.2 : 0)), { tile: 0.25 });
  const jaw = new THREE.BoxGeometry(0.075, 0.035, 0.085);
  kit.add(bone, jaw, xf(hp[0], hp[1] - 0.03, hp[2] + 0.015 * (upish ? -1 : 1), 0, 1, 1, 1, tilt));
  for (const s of [-1, 1]) {
    const sock = new THREE.SphereGeometry(0.024, 6, 5);
    // sockets face "up" when lying on the back, forward when sitting
    const off: P3 = upish ? [s * 0.035, 0.1, 0.025] : [s * 0.035, 0.05, 0.085];
    kit.add(dark, sock, xf(hp[0] + off[0], hp[1] + off[1] - (upish ? 0.02 : 0), hp[2] + off[2]));
  }
  void neck;
  const g = group('skeleton', kit);
  g.scale.setScalar(scale);
  g.rotation.y = rng.float() * 0.6 - 0.3;
  const wrap = new THREE.Group();
  wrap.add(g);
  return { object: wrap, colliders: [] };
}

// ───────────────────────────────────────────────────────────────────────────────────────────
// Weapon rack
// ───────────────────────────────────────────────────────────────────────────────────────────

export function weaponRack(o: { width?: number; seed?: number } = {}): Built {
  const w = o.width ?? 2.0;
  const rng = new Rng(hashSeed('rack', o.seed ?? 1));
  const kit = new MeshKit();
  const wood = mat('old_wood', { key: 'rack' });
  const iron = mat('metal_dark', { key: 'rack' });
  const steel = mat('metal_bright', { key: 'rack', rgb: [0.8, 0.8, 0.82] });
  const leather = mat('leather', { key: 'rack' });
  for (const s of [-1, 1]) {
    kit.add(wood, limbGeo([s * w / 2, 0, -0.18], [s * w / 2, 1.5, 0], 0.045, 0.04, 6, 0.8));
    kit.add(wood, limbGeo([s * w / 2, 0, 0.18], [s * w / 2, 1.5, 0], 0.045, 0.04, 6, 0.8));
  }
  kit.add(wood, limbGeo([-w / 2 - 0.05, 1.42, 0], [w / 2 + 0.05, 1.42, 0], 0.04, 0.04, 6, 0.8));
  kit.add(wood, limbGeo([-w / 2, 0.45, 0], [w / 2, 0.45, 0], 0.035, 0.035, 6, 0.8));
  kit.add(wood, limbGeo([-w / 2, 0.95, 0.02], [w / 2, 0.95, 0.02], 0.03, 0.03, 6, 0.8));
  // spears leaning into the upper bar
  const n = Math.floor(w / 0.22);
  for (let i = 0; i < n; i++) {
    const x = -w / 2 + 0.15 + (i / Math.max(1, n - 1)) * (w - 0.3);
    const kind = rng.float();
    if (kind < 0.45) {
      kit.add(wood, limbGeo([x, 0.0, 0.08], [x + (rng.float() - 0.5) * 0.04, 2.2, 0.0], 0.017, 0.014, 5, 0.6));
      kit.add(steel, limbGeo([x, 2.2, 0.0], [x, 2.46, 0.0], 0.03, 0.002, 4, 0.3));
    } else if (kind < 0.75) {
      kit.add(wood, limbGeo([x, 0.2, 0.07], [x, 1.45, 0.02], 0.02, 0.018, 5, 0.6));
      kit.box(steel, [0.2, 0.22, 0.02], [x + 0.08, 1.4, 0.02], 0, { tile: 0.4 });
    } else {
      kit.add(leather, limbGeo([x, 0.5, 0.06], [x, 1.2, 0.04], 0.012, 0.012, 5, 0.4));
      kit.box(steel, [0.05, 0.9, 0.014], [x, 0.98, 0.06], 0, { tile: 0.4 });
      kit.box(iron, [0.18, 0.03, 0.03], [x, 0.54, 0.06], 0, { tile: 0.4 });
    }
  }
  // round shield on the frame
  kit.add(wood, new THREE.CylinderGeometry(0.34, 0.34, 0.035, 20), xf(w * 0.28, 0.7, 0.16, 0, 1, 1, 1, Math.PI / 2));
  kit.add(iron, new THREE.SphereGeometry(0.08, 8, 6), xf(w * 0.28, 0.7, 0.19, 0, 1, 1, 0.5));
  const g = group('weapon_rack', kit);
  return { object: g, colliders: [{ kind: 'box', center: [0, 0.8, 0], half: [w / 2 + 0.05, 0.8, 0.22], opts: { walkable: false, tag: 'rack' } }] };
}

// ───────────────────────────────────────────────────────────────────────────────────────────
// Ice
// ───────────────────────────────────────────────────────────────────────────────────────────

/** irregular ice slab. Top at y = thickness * 0.6. The collider is walkable ice. */
export function iceSheet(size: number | [number, number] = 4, seed = 1, o: { thickness?: number } = {}): Built {
  const [sx, sz] = typeof size === 'number' ? [size, size * 0.8] : size;
  const th = o.thickness ?? 0.5;
  const rng = new Rng(hashSeed('ice', seed));
  const shape = new THREE.Shape();
  const n = 14;
  const pts: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const r = 0.8 + rng.float() * 0.2 + Math.sin(a * 3 + seed) * 0.08;
    pts.push([Math.cos(a) * sx * 0.5 * r, Math.sin(a) * sz * 0.5 * r]);
  }
  shape.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < n; i++) shape.lineTo(pts[i][0], pts[i][1]);
  shape.closePath();
  let geo: THREE.BufferGeometry = new THREE.ExtrudeGeometry(shape, { depth: th, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.06, bevelSegments: 2, steps: 1 });
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, -th * 0.4, 0);
  geo.deleteAttribute('uv');
  geo.computeVertexNormals();
  // uneven top
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) if (pos.getY(i) > th * 0.3) pos.setY(i, pos.getY(i) + Math.sin(pos.getX(i) * 1.7 + seed) * 0.02 + Math.cos(pos.getZ(i) * 2.3) * 0.015);
  geo.computeVertexNormals();
  geo = bakeFaceBoxUV(geo, 2.0, rng.float(), rng.float());
  const m = new THREE.Mesh(geo, mat('ice', { key: 'sheet' }));
  m.castShadow = m.receiveShadow = true;
  const g = new THREE.Group();
  g.name = 'ice_sheet';
  g.add(m);
  const colliders: ColliderDesc[] = [{ kind: 'box', center: [0, (th * 0.6 - th * 0.4) / 2, 0], half: [sx * 0.4, (th * 1.0) / 2, sz * 0.4], opts: { material: 'ice', tag: 'ice' } }];
  return { object: g, colliders };
}

// ───────────────────────────────────────────────────────────────────────────────────────────
// Bats
// ───────────────────────────────────────────────────────────────────────────────────────────

const batUniforms = { uTime: { value: 0 } };
const tickBats = (): void => {
  batUniforms.uTime.value = performance.now() / 1000;
};

function batGeometry(): THREE.BufferGeometry {
  // body + head + ears + two wings (finger-supported membrane), unit wingspan = 1 m
  const pos: number[] = [];
  const nor: number[] = [];
  const wingW: number[] = [];
  const idx: number[] = [];
  const add = (x: number, y: number, z: number, nx: number, ny: number, nz: number, w: number) => {
    pos.push(x, y, z);
    nor.push(nx, ny, nz);
    wingW.push(w);
    return pos.length / 3 - 1;
  };
  // body: a stretched octahedron
  const b0 = add(0, 0, 0.1, 0, 0, 1, 0);
  const b1 = add(0, 0, -0.1, 0, 0, -1, 0);
  const b2 = add(0.035, 0, 0, 1, 0, 0, 0);
  const b3 = add(-0.035, 0, 0, -1, 0, 0, 0);
  const b4 = add(0, 0.035, 0, 0, 1, 0, 0);
  const b5 = add(0, -0.03, 0, 0, -1, 0, 0);
  idx.push(b0, b2, b4, b0, b4, b3, b0, b3, b5, b0, b5, b2, b1, b4, b2, b1, b3, b4, b1, b5, b3, b1, b2, b5);
  // ears
  for (const s of [-1, 1]) {
    const e0 = add(s * 0.015, 0.03, 0.1, 0, 1, 0, 0);
    const e1 = add(s * 0.03, 0.075, 0.095, 0, 1, 0, 0);
    const e2 = add(s * 0.005, 0.03, 0.085, 0, 1, 0, 0);
    idx.push(e0, e1, e2, e0, e2, e1);
  }
  // wings: shoulder, elbow, wrist, 3 finger tips, hip; weights increase outward
  for (const s of [-1, 1]) {
    const sh = add(s * 0.03, 0.01, 0.04, 0, 1, 0, 0);
    const hip = add(s * 0.03, 0.0, -0.1, 0, 1, 0, 0);
    const el = add(s * 0.2, 0.02, 0.06, 0, 1, 0, 0.35);
    const wr = add(s * 0.36, 0.03, 0.1, 0, 1, 0, 0.62);
    const t1 = add(s * 0.5, 0.0, 0.22, 0, 1, 0, 1);
    const t2 = add(s * 0.48, -0.01, 0.0, 0, 1, 0, 0.95);
    const t3 = add(s * 0.36, -0.01, -0.14, 0, 1, 0, 0.8);
    const t4 = add(s * 0.15, 0.0, -0.17, 0, 1, 0, 0.3);
    const tris: [number, number, number][] = [[sh, el, hip], [el, t4, hip], [el, wr, t4], [wr, t3, t4], [wr, t2, t3], [wr, t1, t2]];
    for (const [a, b, c] of tris) {
      idx.push(a, b, c);
      idx.push(a, c, b);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('aWing', new THREE.Float32BufferAttribute(wingW, 1));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

let batMat: THREE.MeshStandardMaterial | null = null;
function batMaterial(): THREE.MeshStandardMaterial {
  if (batMat) return batMat;
  const m = new THREE.MeshStandardMaterial({ color: 0x1a1512, roughness: 0.8, side: THREE.DoubleSide, flatShading: false });
  m.name = 'bat';
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = batUniforms.uTime;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aWing; attribute vec4 aOrbit; uniform float uTime;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        {
          // aOrbit: radius, angular speed (rad/s), phase, flap rate. instanceMatrix gives centre + scale.
          float ang = uTime * aOrbit.y + aOrbit.z;
          float flap = sin(uTime * aOrbit.w + aOrbit.z * 3.0);
          transformed.y += flap * aWing * 0.28 * sign(position.x) * 0.0 + flap * aWing * 0.3;
          transformed.z -= abs(flap) * aWing * 0.04;
          // heading = tangent of the circle, banking into the turn
          float bank = -0.35 * sign(aOrbit.y);
          float cb = cos(bank); float sb = sin(bank);
          vec3 p = transformed;
          p = vec3(p.x * cb - p.y * sb, p.x * sb + p.y * cb, p.z);
          float yaw = -ang + (aOrbit.y > 0.0 ? 3.14159265 : 0.0);
          float c = cos(yaw); float s = sin(yaw);
          p = vec3(p.x * c + p.z * s, p.y, -p.x * s + p.z * c);
          p += vec3(cos(ang) * aOrbit.x, sin(uTime * 0.7 + aOrbit.z * 5.0) * 1.2, sin(ang) * aOrbit.x * (aOrbit.y > 0.0 ? 1.0 : -1.0));
          transformed = p;
        }`,
      );
  };
  batMat = m;
  return m;
}

/** a flock of cheap distant bats circling a point (vertex-shader flapping and orbits, one draw call) */
export function batFlock(count: number, center: THREE.Vector3, radius = 20, o: { size?: number; seed?: number; height?: number } = {}): Built {
  const rng = new Rng(hashSeed('bats', o.seed ?? 1, count));
  const geo = batGeometry().clone();
  const orbit = new Float32Array(count * 4);
  const mesh = new THREE.InstancedMesh(geo, batMaterial(), count);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  for (let i = 0; i < count; i++) {
    const s = (o.size ?? 1.4) * (0.8 + rng.float() * 0.5);
    m.compose(new THREE.Vector3(center.x, center.y + (rng.float() - 0.5) * (o.height ?? 10), center.z), q, new THREE.Vector3(s, s, s));
    mesh.setMatrixAt(i, m);
    const dir = rng.chance(0.5) ? 1 : -1;
    orbit[i * 4] = radius * (0.35 + rng.float() * 0.65);
    orbit[i * 4 + 1] = dir * (0.15 + rng.float() * 0.25);
    orbit[i * 4 + 2] = rng.float() * Math.PI * 2;
    orbit[i * 4 + 3] = 9 + rng.float() * 6;
  }
  geo.setAttribute('aOrbit', new THREE.InstancedBufferAttribute(orbit, 4));
  mesh.instanceMatrix.needsUpdate = true;
  mesh.frustumCulled = false;
  mesh.castShadow = false;
  mesh.userData.noAO = true;
  mesh.onBeforeRender = tickBats;
  mesh.name = 'bat_flock';
  const g = new THREE.Group();
  g.add(mesh);
  return { object: g, colliders: [] };
}

/** a single bat circling the origin at `radius` (convenience around batFlock) */
export function bat(o: { size?: number; radius?: number; seed?: number } = {}): Built {
  return batFlock(1, new THREE.Vector3(0, 0, 0), o.radius ?? 6, { size: o.size ?? 2, seed: o.seed ?? 1, height: 0 });
}

// ───────────────────────────────────────────────────────────────────────────────────────────
// Misc
// ───────────────────────────────────────────────────────────────────────────────────────────

/** fallen mossy log lying along +x. Origin at its centre on the ground. */
export function fallenLog(length = 6, radius = 0.45, seed = 1, o: { mossy?: boolean } = {}): Built {
  const rng = new Rng(hashSeed('log', seed));
  const kit = new MeshKit();
  const bark = mat(o.mossy === false ? 'bark' : 'mossy_bark', { key: 'log' });
  const n = Math.max(3, Math.round(length / 0.8));
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= n; i++) pts.push(new THREE.Vector3(-length / 2 + (i / n) * length, radius * 0.9 + Math.sin(i * 1.3) * 0.03, Math.sin(i * 0.7 + seed) * 0.12));
  const seg = 12;
  const geoPos: number[] = [];
  const geoUv: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= n; i++) {
    const r = radius * (1 - 0.15 * (i / n)) * (1 + 0.06 * Math.sin(i * 2.1 + seed));
    for (let k = 0; k <= seg; k++) {
      const a = (k / seg) * Math.PI * 2;
      const lump = 1 + 0.09 * Math.sin(a * 3 + i) + 0.05 * Math.sin(a * 5 - i * 0.7);
      geoPos.push(pts[i].x, pts[i].y + Math.cos(a) * r * lump, pts[i].z + Math.sin(a) * r * lump);
      geoUv.push(((k / seg) * Math.PI * 2 * radius) / 2.4, (pts[i].x + length / 2) / 2.4);
    }
  }
  for (let i = 0; i < n; i++) for (let k = 0; k < seg; k++) {
    const a = i * (seg + 1) + k;
    idx.push(a, a + seg + 1, a + 1, a + 1, a + seg + 1, a + seg + 2);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(geoPos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(geoUv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  kit.add(bark, geo);
  // end caps (broken wood)
  for (const s of [-1, 1]) {
    const cap = new THREE.CircleGeometry(radius * 0.9, 12);
    cap.rotateY(s * Math.PI / 2);
    cap.translate(s * length / 2, radius * 0.9, 0);
    kit.add(mat('old_wood', { key: 'log' }), cap, null, { tile: 1 });
  }
  // a stub or two
  for (let i = 0; i < 2; i++) {
    const x = (rng.float() - 0.5) * length * 0.6;
    kit.add(bark, limbGeo([x, radius * 1.3, 0], [x + 0.3, radius * 2.0, (rng.float() - 0.5) * 0.6], 0.08, 0.04, 6, 1));
  }
  const g = group('fallen_log', kit);
  return { object: g, colliders: [{ kind: 'box', center: [0, radius * 0.9, 0], half: [length / 2, radius * 0.85, radius * 0.85], opts: { material: 'wood', tag: 'log' } }] };
}

/** hanging oil lantern (origin at the hook) */
export function lantern(o: { lit?: boolean } = {}): Built {
  const kit = new MeshKit();
  const iron = mat('metal_dark', { key: 'lantern' });
  kit.add(iron, limbGeo([0, 0, 0], [0, -0.12, 0], 0.01, 0.01, 5, 0.3));
  kit.add(iron, new THREE.ConeGeometry(0.11, 0.1, 6), xf(0, -0.17, 0));
  kit.add(iron, new THREE.CylinderGeometry(0.075, 0.09, 0.03, 6), xf(0, -0.4, 0));
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.78;
    kit.add(iron, limbGeo([Math.cos(a) * 0.1, -0.21, Math.sin(a) * 0.1], [Math.cos(a) * 0.085, -0.4, Math.sin(a) * 0.085], 0.007, 0.007, 4, 0.3));
  }
  const g = group('lantern', kit);
  const glass = new THREE.Mesh(
    new THREE.CylinderGeometry(0.095, 0.08, 0.2, 8, 1, true),
    new THREE.MeshStandardMaterial({ color: 0xffd9a0, emissive: 0xffa94a, emissiveIntensity: o.lit === false ? 0 : 2.2, roughness: 0.2, transparent: true, opacity: 0.75, side: THREE.DoubleSide }),
  );
  glass.position.y = -0.3;
  glass.userData.noAO = true;
  g.add(glass);
  return { object: g, colliders: [] };
}

/** small clinker rowboat (Lake-town). Origin at the keel centre, bow toward +z. */
export function boat(o: { length?: number; seed?: number } = {}): Built {
  const L = o.length ?? 4.2;
  const W = L * 0.34;
  const kit = new MeshKit();
  const wood = mat('wood_planks', { key: 'boat', rgb: [0.85, 0.75, 0.62] });
  const old = mat('old_wood', { key: 'boat' });
  // hull as a lofted shell: stations along z, each a half-ellipse-ish section
  const stations = 14;
  const sec = 9;
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const hullAt = (t: number) => {
    const z = (t - 0.5) * L;
    const w = W * 0.5 * Math.pow(Math.sin(Math.PI * Math.min(1, t * 0.98 + 0.02)), 0.55) * (t > 0.85 ? 1 - (t - 0.85) * 2 : 1);
    const rise = Math.pow(Math.abs(t - 0.5) * 2, 2.2) * 0.32;
    return { z, w: Math.max(0.02, w), rise };
  };
  for (let i = 0; i <= stations; i++) {
    const t = i / stations;
    const { z, w, rise } = hullAt(t);
    for (let k = 0; k <= sec; k++) {
      const a = (k / sec) * Math.PI;
      const x = -Math.cos(a) * w;
      const y = 0.46 - Math.sin(a) * 0.4 + rise - 0.06;
      pos.push(x, y, z);
      uv.push((z) / 1.2, (a * w) / 1.2);
    }
  }
  for (let i = 0; i < stations; i++) for (let k = 0; k < sec; k++) {
    const a = i * (sec + 1) + k;
    idx.push(a, a + sec + 1, a + 1, a + 1, a + sec + 1, a + sec + 2);
  }
  const hull = new THREE.BufferGeometry();
  hull.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  hull.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  hull.setIndex(idx);
  hull.computeVertexNormals();
  const hm = new THREE.Mesh(hull, new THREE.MeshStandardMaterial());
  void hm;
  const hullMat = wood.clone();
  hullMat.side = THREE.DoubleSide;
  kit.add(hullMat, hull);
  // thwarts, ribs, gunwale
  for (const z of [-L * 0.22, 0.0, L * 0.2]) kit.box(old, [W * 0.92, 0.04, 0.22], [0, 0.34, z], 0, { tile: 1 });
  kit.add(old, limbGeo([-W * 0.3, 0.2, -L * 0.42], [-W * 0.15, 0.4, -L * 0.12], 0.012, 0.012, 4, 0.5));
  const g = group('boat', kit);
  // oars
  const oar = new MeshKit();
  oar.add(old, limbGeo([0, 0, 0], [0, 0, 2.2], 0.025, 0.022, 6, 0.5));
  oar.box(old, [0.16, 0.012, 0.5], [0, 0, 2.1], 0, { tile: 0.5 });
  const oarG = group('oar', oar);
  oarG.position.set(W * 0.5 + 0.1, 0.55, 0.0);
  oarG.rotation.set(0.0, -0.7, 0.2);
  g.add(oarG);
  return { object: g, colliders: [{ kind: 'box', center: [0, 0.3, 0], half: [W * 0.4, 0.15, L * 0.38], opts: { material: 'wood', tag: 'boat' } }] };
}
