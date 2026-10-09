/**
 * Geometry helpers for the Lake-town world: baking many placed props into a few merged meshes
 * (draw-call budget), the plank platforms, strung lanterns and the far-town skyline.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { lantern, mat, plain, type ColliderDesc } from '../../../world';
import { MeshKit, normalizeGeometry } from '../../../world/util';
import { limbGeo, xf } from '../../../world/geom';
import { Rng } from '../../../core/rng';
import { D, type Platform } from './layout';

// ─────────────────────────────────────────────────────────────────────────────
// Merging placed props
// ─────────────────────────────────────────────────────────────────────────────

function materialSignature(m: THREE.Material): string {
  if (m.userData?.shared) return 'S' + m.uuid;
  const s = m as THREE.MeshStandardMaterial;
  return [
    m.type,
    s.color ? s.color.getHexString() : '',
    s.emissive ? s.emissive.getHexString() : '',
    s.emissiveIntensity,
    s.roughness,
    s.metalness,
    m.opacity,
    m.transparent ? 1 : 0,
    m.side,
    s.map ? s.map.uuid : '',
    s.normalMap ? s.normalMap.uuid : '',
  ].join('|');
}

export interface BakeOpts {
  /** swap a material for another before merging (return null to keep it) */
  replace?: (m: THREE.Material) => THREE.Material | null;
  /** chunk edge in metres: one merged mesh per (chunk, material) so far chunks are culled */
  cell?: number;
  name?: string;
}

/**
 * Bake placed (positioned, rotated) builder objects into merged static meshes. Invisible collider
 * meshes, instanced meshes, skinned meshes and shader materials are skipped (returned in `left` so
 * the caller can add them as they are). Materials with the same look collapse into one (the lantern
 * glass the builders create per call), so a town of lanterns is a handful of draw calls.
 */
/** the warm glass every lantern in the town shares (the builders' own glass reads nearly white) */
export function warmGlass(): THREE.MeshStandardMaterial {
  return plain(0xff9a40, { roughness: 0.3, emissive: 0xff7a1c, emissiveIntensity: 2.0, key: 'ltGlass' });
}

export function bakeStatic(objects: readonly THREE.Object3D[], o: BakeOpts = {}): { group: THREE.Group; left: THREE.Object3D[] } {
  const cell = o.cell ?? 70;
  const group = new THREE.Group();
  group.name = o.name ?? 'baked';
  const buckets = new Map<string, { mat: THREE.Material; geos: THREE.BufferGeometry[]; cast: boolean; recv: boolean; noAO: boolean; cx: number; cz: number }>();
  const canon = new Map<string, THREE.Material>();
  const left: THREE.Object3D[] = [];
  for (const obj of objects) {
    obj.updateWorldMatrix(true, true);
    const cx = Math.floor(obj.position.x / cell);
    const cz = Math.floor(obj.position.z / cell);
    const keep: THREE.Object3D[] = [];
    obj.traverse((ch) => {
      const m = ch as THREE.Mesh;
      if (!m.isMesh) return;
      if ((m as THREE.InstancedMesh).isInstancedMesh || (m as THREE.SkinnedMesh).isSkinnedMesh) {
        keep.push(m);
        return;
      }
      if (!m.visible || m.userData.collider || Array.isArray(m.material)) return;
      let mt = m.material as THREE.Material;
      if (!mt || mt.visible === false) return;
      mt = o.replace?.(mt) ?? mt;
      if ((mt as THREE.ShaderMaterial).isShaderMaterial) {
        keep.push(m);
        return;
      }
      const sig = materialSignature(mt);
      if (!canon.has(sig)) canon.set(sig, mt);
      const key = `${cx},${cz}|${sig}|${m.castShadow ? 1 : 0}${m.receiveShadow ? 1 : 0}${m.userData.noAO ? 1 : 0}`;
      let b = buckets.get(key);
      if (!b) buckets.set(key, (b = { mat: canon.get(sig)!, geos: [], cast: m.castShadow, recv: m.receiveShadow, noAO: !!m.userData.noAO, cx, cz }));
      const g = m.geometry.clone();
      g.applyMatrix4(m.matrixWorld);
      normalizeGeometry(g);
      b.geos.push(g);
    });
    for (const k of keep) {
      k.updateWorldMatrix(true, false);
      const w = k.matrixWorld.clone();
      k.removeFromParent();
      k.matrixAutoUpdate = true;
      w.decompose(k.position, k.quaternion, k.scale);
      left.push(k);
    }
  }
  for (const b of buckets.values()) {
    const indexed = b.geos.every((g) => g.index);
    const non = b.geos.every((g) => !g.index);
    const prepared = indexed || non ? b.geos : b.geos.map((g) => (g.index ? g.toNonIndexed() : g));
    const merged = prepared.length === 1 ? prepared[0] : mergeGeometries(prepared, false);
    if (!merged) continue;
    merged.computeBoundingSphere();
    merged.computeBoundingBox();
    const mesh = new THREE.Mesh(merged, b.mat);
    mesh.castShadow = b.cast;
    mesh.receiveShadow = b.recv;
    if (b.noAO) mesh.userData.noAO = true;
    mesh.name = `${o.name ?? 'baked'}:${b.mat.name || b.mat.type}`;
    group.add(mesh);
  }
  return { group, left };
}

// ─────────────────────────────────────────────────────────────────────────────
// Platforms (market, quay, dock)
// ─────────────────────────────────────────────────────────────────────────────

export interface PanelGrid {
  /** panel centres and sizes in world space (y = deck surface) */
  panels: { cx: number; cz: number; hx: number; hz: number }[];
}

/**
 * A plank platform on piles: the visual deck, the beams, piles, a rope rail with posts and the
 * collider list. With `panels`, the deck is split into separate panel colliders (the quay, so
 * Bolg's slam can knock planks loose); `breakable` decides which panels are left out of the merged
 * deck mesh (the caller draws those as one instanced mesh).
 */
export function platform(
  p: Platform,
  o: { panels?: { nx: number; nz: number; breakable?: (cx: number, cz: number) => boolean }; seed?: number; rails?: Partial<Record<'n' | 's' | 'e' | 'w', boolean>>; lamps?: boolean } = {},
): { object: THREE.Group; colliders: ColliderDesc[]; panels: PanelGrid['panels']; breakables: PanelGrid['panels']; lanterns: THREE.Vector3[] } {
  const kit = new MeshKit();
  const rng = new Rng((o.seed ?? 1) * 977 + Math.round(p.cx * 3 + p.cz));
  const planks = mat('wood_planks', { key: 'ltDeck', rgb: [0.66, 0.54, 0.43] });
  const old = mat('old_wood', { key: 'ltBeam', rgb: [0.78, 0.75, 0.7] });
  const rope = plain(0x5d4f34, { roughness: 1, key: 'rope' });
  const colliders: ColliderDesc[] = [];
  const panels: PanelGrid['panels'] = [];
  const breakables: PanelGrid['panels'] = [];
  const lanterns: THREE.Vector3[] = [];
  const w = p.hx * 2;
  const d = p.hz * 2;

  if (o.panels) {
    const { nx, nz } = o.panels;
    const pw = w / nx;
    const pd = d / nz;
    for (let i = 0; i < nx; i++) {
      for (let j = 0; j < nz; j++) {
        const cx = p.cx - p.hx + (i + 0.5) * pw;
        const cz = p.cz - p.hz + (j + 0.5) * pd;
        const panel = { cx, cz, hx: pw / 2, hz: pd / 2 };
        panels.push(panel);
        if (o.panels.breakable?.(cx, cz)) breakables.push(panel);
        else kit.box(planks, [pw + 0.02, 0.2, pd + 0.02], [cx, D - 0.1, cz], (i + j) % 2 ? 0 : 0, { tile: 1.25, offset: [rng.float(), rng.float()] });
        colliders.push({ kind: 'box', center: [cx, D - 0.1, cz], half: [pw / 2, 0.1, pd / 2], opts: { material: 'wood', tag: 'deck' } });
      }
    }
  } else {
    kit.box(planks, [w, 0.2, d], [p.cx, D - 0.1, p.cz], 0, { tile: 1.25 });
    colliders.push({ kind: 'box', center: [p.cx, D - 0.1, p.cz], half: [p.hx, 0.1, p.hz], opts: { material: 'wood', tag: 'deck' } });
  }
  // beams under the deck: a grid of joists and two heavy stringers
  for (let x = p.cx - p.hx + 0.6; x <= p.cx + p.hx - 0.5; x += 1.6) kit.box(old, [0.2, 0.28, d - 0.2], [x, D - 0.34, p.cz], 0, { tile: 0.8 });
  for (const sz of [-1, 1]) kit.box(old, [w + 0.1, 0.3, 0.26], [p.cx, D - 0.4, p.cz + sz * (p.hz - 0.13)], 0, { tile: 0.8 });
  // piles on a grid, longer ones at the corners
  const nxp = Math.max(2, Math.round(w / 3.4) + 1);
  const nzp = Math.max(2, Math.round(d / 3.4) + 1);
  for (let i = 0; i < nxp; i++) {
    for (let j = 0; j < nzp; j++) {
      const x = p.cx - p.hx + 0.3 + (i / (nxp - 1)) * (w - 0.6);
      const z = p.cz - p.hz + 0.3 + (j / (nzp - 1)) * (d - 0.6);
      const r = 0.17 + rng.float() * 0.04;
      const tall = (i === 0 || i === nxp - 1) && (j === 0 || j === nzp - 1);
      kit.add(old, limbGeo([x, -3.6, z], [x, tall ? D + 1.0 : D - 0.25, z], r * 1.1, r, 8, 0.8));
      colliders.push({ kind: 'cyl', x, z, r: r * 1.1, y0: -3.6, y1: -0.2, opts: { walkable: false, material: 'wood', tag: 'pile' } });
    }
  }
  // rope rails on the open sides, posts every ~3 m with a lantern on the corner posts
  const sides: { a: [number, number]; b: [number, number]; key: 'n' | 's' | 'e' | 'w' }[] = [
    { a: [p.cx - p.hx, p.cz - p.hz], b: [p.cx + p.hx, p.cz - p.hz], key: 's' },
    { a: [p.cx - p.hx, p.cz + p.hz], b: [p.cx + p.hx, p.cz + p.hz], key: 'n' },
    { a: [p.cx - p.hx, p.cz - p.hz], b: [p.cx - p.hx, p.cz + p.hz], key: 'w' },
    { a: [p.cx + p.hx, p.cz - p.hz], b: [p.cx + p.hx, p.cz + p.hz], key: 'e' },
  ];
  for (const s of sides) {
    if (o.rails?.[s.key] === false) continue;
    const len = Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1]);
    const n = Math.max(1, Math.round(len / 3.2));
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const x = s.a[0] + (s.b[0] - s.a[0]) * t;
      const z = s.a[1] + (s.b[1] - s.a[1]) * t;
      const corner = i === 0 || i === n;
      kit.add(old, limbGeo([x, D - 0.3, z], [x, D + (corner ? 1.5 : 1.0), z], 0.07, 0.06, 7, 0.6));
      if (corner && o.lamps !== false) lanterns.push(new THREE.Vector3(x, D + 1.38, z));
      if (i < n) {
        const t2 = (i + 1) / n;
        const x2 = s.a[0] + (s.b[0] - s.a[0]) * t2;
        const z2 = s.a[1] + (s.b[1] - s.a[1]) * t2;
        kit.add(rope, limbGeo([x, D + 0.85, z], [x2, D + 0.82, z2], 0.016, 0.016, 4, 0.3));
        kit.add(rope, limbGeo([x, D + 0.45, z], [x2, D + 0.43, z2], 0.013, 0.013, 4, 0.3));
      }
    }
  }
  const object = kit.build({ name: 'platform_' + p.name });
  return { object, colliders, panels, breakables, lanterns };
}

// ─────────────────────────────────────────────────────────────────────────────
// Rope railings
// ─────────────────────────────────────────────────────────────────────────────

/** posts every ~3 m and two sagging ropes along each segment */
export function railing(segs: { ax: number; az: number; bx: number; bz: number }[]): THREE.Group {
  const kit = new MeshKit();
  const post = mat('old_wood', { key: 'ltBeam', rgb: [0.78, 0.75, 0.7] });
  const rope = plain(0x5d4f34, { roughness: 1, key: 'rope' });
  for (const s of segs) {
    const len = Math.hypot(s.bx - s.ax, s.bz - s.az);
    const n = Math.max(1, Math.round(len / 3));
    let px = s.ax;
    let pz = s.az;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const x = s.ax + (s.bx - s.ax) * t;
      const z = s.az + (s.bz - s.az) * t;
      kit.add(post, limbGeo([x, D - 0.3, z], [x, D + (i === 0 || i === n ? 1.18 : 1.05), z], 0.065, 0.055, 6, 0.6));
      if (i > 0) {
        const sag = 0.05;
        kit.add(rope, limbGeo([px, D + 0.94, pz], [x, D + 0.94 - sag, z], 0.016, 0.016, 4, 0.3));
        kit.add(rope, limbGeo([px, D + 0.52, pz], [x, D + 0.52 - sag, z], 0.013, 0.013, 4, 0.3));
      }
      px = x;
      pz = z;
    }
  }
  return kit.build({ name: 'railing' });
}

// ─────────────────────────────────────────────────────────────────────────────
// Strung lanterns, nets, cloth
// ─────────────────────────────────────────────────────────────────────────────

/** a sagging cord between two points with small glowing lanterns hung on it */
export function lanternString(a: THREE.Vector3, b: THREE.Vector3, count: number, sag = 0.7, seed = 1): THREE.Group {
  const kit = new MeshKit();
  const rope = plain(0x2a2218, { roughness: 1, key: 'cord' });
  const glass = plain(0xff9a40, { roughness: 0.3, emissive: 0xff7a1c, emissiveIntensity: 2.0, key: 'strungGlass' });
  const iron = mat('metal_dark', { key: 'lantern' });
  const rng = new Rng(seed);
  const n = 12;
  let prev = a.clone();
  const p = new THREE.Vector3();
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    p.lerpVectors(a, b, t);
    p.y -= Math.sin(t * Math.PI) * sag;
    kit.add(rope, limbGeo([prev.x, prev.y, prev.z], [p.x, p.y, p.z], 0.012, 0.012, 4, 0.3));
    prev.copy(p);
  }
  for (let i = 0; i < count; i++) {
    const t = (i + 0.5 + (rng.float() - 0.5) * 0.3) / count;
    p.lerpVectors(a, b, t);
    p.y -= Math.sin(t * Math.PI) * sag;
    kit.add(rope, limbGeo([p.x, p.y, p.z], [p.x, p.y - 0.22, p.z], 0.006, 0.006, 3, 0.3));
    kit.add(iron, new THREE.CylinderGeometry(0.07, 0.085, 0.025, 6), xf(p.x, p.y - 0.46, p.z));
    kit.add(iron, new THREE.ConeGeometry(0.1, 0.09, 6), xf(p.x, p.y - 0.25, p.z));
    kit.add(glass, new THREE.CylinderGeometry(0.075, 0.062, 0.18, 8), xf(p.x, p.y - 0.35, p.z));
  }
  const g = kit.build({ name: 'lantern_string', castShadow: false });
  g.traverse((c) => {
    if ((c as THREE.Mesh).isMesh && ((c as THREE.Mesh).material as THREE.Material) === glass) c.userData.noAO = true;
  });
  return g;
}

let netTexture: THREE.CanvasTexture | null = null;
/**
 * A hand-knotted fishing-net texture (alpha tested), built once: an irregular diamond mesh (every knot
 * jittered, slightly different rope thickness, a knot dot at each crossing), tileable. Thin and soft, so it
 * fades into a haze with distance instead of moire-ing like a chain-link fence.
 */
function netTex(): THREE.CanvasTexture {
  if (netTexture) return netTexture;
  const N = 256;
  const c = document.createElement('canvas');
  c.width = c.height = N;
  const g = c.getContext('2d')!;
  g.clearRect(0, 0, N, N);
  const rng = new Rng(917);
  const cols = 7;
  const rows = 14; // diamond rows: a knot every half cell, alternate rows offset
  const cw = N / cols;
  const rh = N / rows;
  const knots: { x: number; y: number }[][] = [];
  for (let j = 0; j < rows; j++) {
    const row: { x: number; y: number }[] = [];
    for (let i = 0; i < cols; i++) {
      row.push({ x: (i + (j % 2 ? 0.5 : 0)) * cw + (rng.float() - 0.5) * cw * 0.28, y: j * rh + (rng.float() - 0.5) * rh * 0.5 });
    }
    knots.push(row);
  }
  g.lineCap = 'round';
  const seg = (a: { x: number; y: number }, b: { x: number; y: number }, w: number, al: number) => {
    g.strokeStyle = `rgba(214,200,168,${al})`;
    g.lineWidth = w;
    for (const ox of [-N, 0, N]) {
      for (const oy of [-N, 0, N]) {
        g.beginPath();
        g.moveTo(a.x + ox, a.y + oy);
        // a slack rope: the midpoint sags a little, differently per strand
        g.quadraticCurveTo((a.x + b.x) / 2 + ox + (rng.float() - 0.5) * 3, (a.y + b.y) / 2 + oy + 1.5 + rng.float() * 2, b.x + ox, b.y + oy);
        g.stroke();
      }
    }
  }
  for (let j = 0; j < rows; j++) {
    const nj = (j + 1) % rows;
    for (let i = 0; i < cols; i++) {
      const a = knots[j][i];
      const off = j % 2 ? 1 : 0;
      // the two strands below: (i + off - 1) and (i + off) on the next row, wrapped
      const l = knots[nj][(i + off - 1 + cols) % cols];
      const r = knots[nj][(i + off) % cols];
      const wrapFix = (p: { x: number; y: number }, base: { x: number; y: number }) => {
        let x = p.x;
        let y = p.y;
        if (x - base.x > N / 2) x -= N;
        if (x - base.x < -N / 2) x += N;
        if (y - base.y < -N / 2) y += N;
        return { x, y };
      };
      seg(a, wrapFix(l, a), 2.1 + rng.float() * 1.2, 0.8 + rng.float() * 0.2);
      seg(a, wrapFix(r, a), 2.1 + rng.float() * 1.2, 0.8 + rng.float() * 0.2);
    }
  }
  g.fillStyle = 'rgba(224,210,176,0.95)';
  for (const row of knots) for (const k of row) for (const ox of [-N, 0, N]) for (const oy of [-N, 0, N]) {
    g.beginPath();
    g.arc(k.x + ox, k.y + oy, 2.6, 0, Math.PI * 2);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  t.userData.shared = true;
  netTexture = t;
  return t;
}

/**
 * A fishing net hung from a rope between two posts: a slack irregular mesh with a ragged lower hem, a
 * billow, corks along the top rope and lead weights on the hem. Returns one group (net + kit).
 */
export function netSheet(a: THREE.Vector3, b: THREE.Vector3, height: number, sag = 0.5): THREE.Group {
  const seg = 14;
  const rowsN = 6;
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const len = a.distanceTo(b);
  const dx = (b.x - a.x) / Math.max(len, 1e-3);
  const dz = (b.z - a.z) / Math.max(len, 1e-3);
  const nx = -dz;
  const nz = dx;
  const rng = new Rng(Math.floor(a.x * 13 + a.z * 7 + 500));
  const hem: number[] = [];
  for (let i = 0; i <= seg; i++) hem.push(0.72 + rng.float() * 0.32);
  const p = new THREE.Vector3();
  const top = (t: number, out: THREE.Vector3) => {
    out.lerpVectors(a, b, t);
    out.y -= Math.sin(t * Math.PI) * sag;
    return out;
  };
  for (let i = 0; i <= seg; i++) {
    const t = i / seg;
    top(t, p);
    for (let k = 0; k <= rowsN; k++) {
      const v = k / rowsN;
      const drop = v * height * hem[i];
      // the net bellies out and swings: a gentle billow along its width, strongest at the bottom
      const bil = Math.sin(t * Math.PI * 3 + v * 2.2) * 0.1 * v;
      pos.push(p.x + nx * bil, p.y - drop, p.z + nz * bil);
      uv.push((t * len) / 2.1, (v * height) / 2.1);
    }
  }
  const row = rowsN + 1;
  for (let i = 0; i < seg; i++) {
    for (let k = 0; k < rowsN; k++) {
      const q = i * row + k;
      idx.push(q, q + row, q + 1, q + 1, q + row, q + row + 1);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const m = new THREE.MeshStandardMaterial({ map: netTex(), alphaTest: 0.2, side: THREE.DoubleSide, roughness: 1, color: 0x8b7a58 });
  const mesh = new THREE.Mesh(geo, m);
  mesh.castShadow = false;
  mesh.userData.noAO = true;
  mesh.name = 'net_mesh';
  // posts, the head rope, corks and weights
  const kit = new MeshKit();
  const wood = mat('old_wood', { key: 'ltBeam', rgb: [0.78, 0.75, 0.7] });
  const rope = plain(0x5d4f34, { roughness: 1, key: 'rope' });
  const cork = plain(0xb59c6a, { roughness: 0.9, key: 'netCork' });
  const lead = plain(0x2a2a2c, { roughness: 0.7, metalness: 0.4, key: 'netLead' });
  const q = new THREE.Vector3();
  for (const e of [a, b]) kit.add(wood, limbGeo([e.x, D - 0.3, e.z], [e.x, e.y + 0.35, e.z], 0.065, 0.05, 6, 0.6));
  let prev = top(0, new THREE.Vector3());
  for (let i = 1; i <= seg; i++) {
    top(i / seg, q);
    kit.add(rope, limbGeo([prev.x, prev.y, prev.z], [q.x, q.y, q.z], 0.014, 0.014, 4, 0.3));
    prev = prev.copy(q);
  }
  const floats = Math.max(3, Math.round(len / 0.7));
  for (let i = 0; i <= floats; i++) {
    top(i / floats, q);
    kit.add(cork, new THREE.SphereGeometry(0.055, 6, 5), xf(q.x, q.y - 0.02, q.z));
  }
  const weights = Math.max(2, Math.round(len / 1.2));
  for (let i = 0; i <= weights; i++) {
    const t = i / weights;
    const hi = hem[Math.min(seg, Math.round(t * seg))];
    top(t, q);
    kit.add(lead, new THREE.SphereGeometry(0.035, 5, 4), xf(q.x, q.y - height * hi, q.z));
  }
  const g = new THREE.Group();
  g.name = 'net';
  g.add(mesh, kit.build({ name: 'net_kit', castShadow: false }));
  return g;
}

// ─────────────────────────────────────────────────────────────────────────────
// Warm light pools (fake bounce light under lanterns and fires) and lamp posts
// ─────────────────────────────────────────────────────────────────────────────

let poolTexture: THREE.CanvasTexture | null = null;
function poolTex(): THREE.CanvasTexture {
  if (poolTexture) return poolTexture;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(64, 64, 2, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,190,110,1)');
  grad.addColorStop(0.3, 'rgba(255,150,70,0.55)');
  grad.addColorStop(0.65, 'rgba(255,120,50,0.16)');
  grad.addColorStop(1, 'rgba(255,100,40,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.userData.shared = true; // cached across levels: never disposed with one
  poolTexture = t;
  return t;
}

/** additive warm pools of light on the planks: one merged mesh, one draw call */
export function lightPools(spots: { x: number; z: number; r: number; a?: number; y?: number }[]): THREE.Mesh {
  const pos: number[] = [];
  const uv: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  spots.forEach((s, i) => {
    const y = s.y ?? D + 0.035;
    const a = s.a ?? 1;
    const o = i * 4;
    pos.push(s.x - s.r, y, s.z - s.r, s.x + s.r, y, s.z - s.r, s.x + s.r, y, s.z + s.r, s.x - s.r, y, s.z + s.r);
    uv.push(0, 0, 1, 0, 1, 1, 0, 1);
    for (let k = 0; k < 4; k++) col.push(a, a, a);
    idx.push(o, o + 2, o + 1, o, o + 3, o + 2);
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx);
  geo.computeBoundingSphere();
  const m = new THREE.MeshBasicMaterial({ map: poolTex(), vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.42 });
  const mesh = new THREE.Mesh(geo, m);
  mesh.renderOrder = 2;
  mesh.userData.noAO = true;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.name = 'light_pools';
  return mesh;
}

let glintTexture: THREE.CanvasTexture | null = null;
/**
 * A vertical streak of broken light for the water, written pixel by pixel (white, alpha only): a faint soft
 * core that narrows toward the far end, and short bright dashes (a reflection on small ripples).
 */
function glintTex(): THREE.CanvasTexture {
  if (glintTexture) return glintTexture;
  const W = 64;
  const H = 256;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  const img = g.createImageData(W, H);
  const rng = new Rng(2024);
  const a = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    const v = y / (H - 1); // 0 = under the light (canvas top), 1 = the far end
    const along = Math.min(1, v / 0.08) * Math.pow(1 - v, 1.3);
    const half = 0.08 + 0.2 * v;
    for (let x = 0; x < W; x++) {
      const u = (x + 0.5) / W - 0.5;
      a[y * W + x] = 0.16 * along * Math.exp(-(u * u) / (half * half));
    }
  }
  for (let i = 0; i < 140; i++) {
    const v = Math.pow(rng.float(), 1.3);
    const y = Math.floor(v * (H - 2));
    const half = 0.08 + 0.2 * v;
    const cx = 0.5 + (rng.float() + rng.float() - 1) * half * 1.4;
    const len = 3 + rng.float() * 14 * (1 - v * 0.5);
    const al = (0.3 + rng.float() * 0.6) * Math.min(1, v / 0.05) * Math.pow(1 - v, 0.9);
    for (let x = 0; x < W; x++) {
      const d = Math.abs(x + 0.5 - cx * W);
      if (d < len) {
        const k = 1 - d / len;
        a[y * W + x] = Math.max(a[y * W + x], al * k);
        if (rng.float() < 0.3 && y + 1 < H) a[(y + 1) * W + x] = Math.max(a[(y + 1) * W + x], al * k * 0.5);
      }
    }
  }
  for (let i = 0; i < W * H; i++) {
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = 255;
    img.data[i * 4 + 3] = Math.round(Math.max(0, Math.min(1, a[i])) * 255);
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.userData.shared = true;
  glintTexture = t;
  return t;
}

export interface Glint {
  x: number;
  z: number;
  /** width and length (m); the streak runs along `yaw` (0 = along +z) */
  w: number;
  l: number;
  yaw?: number;
  a?: number;
  /** tint, 0xrrggbb */
  color?: number;
}

/** reflections on the lake: warm streaks under lit houses and lamps, a cold glitter toward the moon. One mesh, additive. */
export function waterGlints(items: Glint[], y = 0.045): THREE.Mesh {
  const pos: number[] = [];
  const uv: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const c = new THREE.Color();
  items.forEach((s, i) => {
    const yaw = s.yaw ?? 0;
    const sx = Math.cos(yaw);
    const sz = -Math.sin(yaw);
    const fx = Math.sin(yaw);
    const fz = Math.cos(yaw);
    const hw = s.w / 2;
    const corner = (u: number, v: number) => [s.x + sx * hw * u + fx * s.l * v, y, s.z + sz * hw * u + fz * s.l * v];
    // v 0 at the near end (under the light), 1 the far end
    const p = [corner(-1, 0), corner(1, 0), corner(1, 1), corner(-1, 1)];
    for (const q of p) pos.push(q[0], q[1], q[2]);
    uv.push(0, 1, 1, 1, 1, 0, 0, 0);
    c.setHex(s.color ?? 0xffa860);
    const a = s.a ?? 1;
    for (let k = 0; k < 4; k++) col.push(c.r * a, c.g * a, c.b * a);
    const o = i * 4;
    idx.push(o, o + 2, o + 1, o, o + 3, o + 2);
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx);
  geo.computeBoundingSphere();
  const m = new THREE.MeshBasicMaterial({ map: glintTex(), vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.9, fog: true });
  const mesh = new THREE.Mesh(geo, m);
  mesh.renderOrder = 2;
  mesh.userData.noAO = true;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.frustumCulled = false;
  mesh.name = 'water_glints';
  return mesh;
}

/** a lamp post on the edge of a walkway: pole, bracket and a lit lantern */
export function lampPost(x: number, z: number, side: number, alongZ: boolean): THREE.Group {
  const kit = new MeshKit();
  const wood = mat('old_wood', { key: 'ltBeam', rgb: [0.78, 0.75, 0.7] });
  const iron = mat('metal_dark', { key: 'lantern' });
  kit.add(wood, limbGeo([0, D - 0.4, 0], [0, D + 2.35, 0], 0.07, 0.055, 7, 0.6));
  const bx = alongZ ? -side * 0.34 : 0;
  const bz = alongZ ? 0 : -side * 0.34;
  kit.add(iron, limbGeo([0, D + 2.2, 0], [bx, D + 2.38, bz], 0.022, 0.02, 5, 0.3));
  const g = kit.build({ name: 'lamp_post' });
  const lan = lantern({ lit: true });
  lan.object.position.set(bx, D + 2.44, bz);
  g.add(lan.object);
  g.position.set(x, 0, z);
  return g;
}

// ─────────────────────────────────────────────────────────────────────────────
// Mist banks drifting over the lake
// ─────────────────────────────────────────────────────────────────────────────

function mistTex(seed: number): THREE.CanvasTexture {
  const rng = new Rng(seed);
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  // alphaMap reads the green channel: grey blobs on black
  g.fillStyle = '#000';
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 14; i++) {
    const x = rng.float() * 256;
    const y = rng.float() * 256;
    const r = 30 + rng.float() * 50;
    for (const ox of [-256, 0, 256]) {
      for (const oy of [-256, 0, 256]) {
        const grad = g.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, r);
        grad.addColorStop(0, `rgba(255,255,255,${0.55 + rng.float() * 0.4})`);
        grad.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = grad;
        g.fillRect(x + ox - r, y + oy - r, r * 2, r * 2);
      }
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

const MIST_OPACITY = [0.3, 0.22, 0.15];

/** a few big horizontal sheets of soft mist just above the water that drift slowly (thinner seen from the roofs) */
export function mistLayers(center: THREE.Vector3, size = 360, layers = 3): { group: THREE.Group; update(dt: number, camY?: number): void } {
  const group = new THREE.Group();
  group.name = 'mist';
  const maps: THREE.CanvasTexture[] = [];
  for (let i = 0; i < layers; i++) {
    const tex = mistTex(40 + i * 7);
    tex.repeat.set(size / 70, size / 70);
    maps.push(tex);
    // unlit, so it must be dark: a pale unlit sheet over a night lake reads as a snow field
    const m = new THREE.MeshBasicMaterial({ color: 0x232f47, alphaMap: tex, transparent: true, opacity: MIST_OPACITY[i] ?? 0.14, depthWrite: false, fog: true });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(size, size), m);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(center.x, 0.22 + i * 0.55, center.z);
    mesh.renderOrder = 3;
    mesh.userData.noAO = true;
    mesh.frustumCulled = false;
    group.add(mesh);
  }
  let t = 0;
  const mats = group.children.map((c) => (c as THREE.Mesh).material as THREE.MeshBasicMaterial);
  return {
    group,
    update(dt: number, camY = 3) {
      t += dt;
      // from above the town the sheets would be seen flat-on: thin them out with height
      const f = THREE.MathUtils.clamp(1 - (camY - 3.2) / 5, 0.3, 1);
      mats.forEach((m, i) => (m.opacity = (MIST_OPACITY[i] ?? 0.14) * f));
      maps.forEach((m, i) => {
        m.offset.x = t * (0.004 + i * 0.002);
        m.offset.y = t * (0.002 - i * 0.0015);
      });
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// The far town: cheap lit silhouettes beyond the playable ring
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Dozens of gabled houses on stilts as ONE mesh (dark walls + shingle roofs) and one emissive mesh
 * for the lit windows. Placed on rings around the playable town and thinned toward the shore.
 */
export function farTown(inner: (x: number, z: number) => boolean, seed = 5, count = 90): THREE.Group {
  const rng = new Rng(seed);
  const wallGeos: THREE.BufferGeometry[] = [];
  const roofGeos: THREE.BufferGeometry[] = [];
  const winGeos: THREE.BufferGeometry[] = [];
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const place = (g: THREE.BufferGeometry, x: number, y: number, z: number, yaw: number, into: THREE.BufferGeometry[]) => {
    e.set(0, yaw, 0);
    q.setFromEuler(e);
    m.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(1, 1, 1));
    const c = g.clone();
    c.applyMatrix4(m);
    into.push(c);
  };
  let placed = 0;
  let guard = 0;
  const taken: [number, number][] = [];
  while (placed < count && guard++ < 4000) {
    const ang = rng.float() * Math.PI * 2;
    const r = 70 + Math.pow(rng.float(), 0.8) * 120;
    const x = Math.cos(ang) * r * 1.18;
    const z = 25 + Math.sin(ang) * r * 0.95;
    if (inner(x, z) || z > 176 || taken.some(([tx, tz]) => Math.hypot(tx - x, tz - z) < 9)) continue;
    taken.push([x, z]);
    const w = 5 + rng.float() * 3.5;
    const dd = 4.2 + rng.float() * 1.6;
    const h = 2.6 + (rng.chance(0.3) ? 2.7 : 0);
    const yaw = Math.round(rng.float() * 4) * (Math.PI / 2) + (rng.float() - 0.5) * 0.12;
    const wall = new THREE.BoxGeometry(w, h, dd);
    wall.translate(0, D + h / 2, 0);
    place(wall, x, 0, z, yaw, wallGeos);
    // piles / deck
    const deck = new THREE.BoxGeometry(w + 1, 0.3, dd + 1);
    deck.translate(0, D - 0.15, 0);
    place(deck, x, 0, z, yaw, wallGeos);
    // gable roof: a triangular prism
    const rise = (dd / 2 + 0.4) * 0.66;
    const sh = new THREE.Shape();
    sh.moveTo(-dd / 2 - 0.4, 0);
    sh.lineTo(dd / 2 + 0.4, 0);
    sh.lineTo(0, rise);
    sh.closePath();
    const roof = new THREE.ExtrudeGeometry(sh, { depth: w + 0.9, bevelEnabled: false });
    roof.rotateY(Math.PI / 2);
    roof.translate(-(w + 0.9) / 2, D + h, 0);
    place(roof, x, 0, z, yaw, roofGeos);
    if (rng.chance(0.55)) {
      const win = new THREE.PlaneGeometry(0.9, 0.9);
      win.translate((rng.float() - 0.5) * (w - 2), D + 1.4, dd / 2 + 0.02);
      place(win, x, 0, z, yaw, winGeos);
      if (rng.chance(0.5)) {
        const win2 = new THREE.PlaneGeometry(0.9, 0.9);
        win2.translate((rng.float() - 0.5) * (w - 2), D + 1.4, -dd / 2 - 0.02);
        win2.rotateY(Math.PI);
        place(win2, x, 0, z, yaw, winGeos);
      }
    }
    placed++;
  }
  const g = new THREE.Group();
  g.name = 'far_town';
  const mk = (geos: THREE.BufferGeometry[], material: THREE.Material, cast = false) => {
    if (!geos.length) return;
    const gs = geos.map((x) => normalizeGeometry(x.index ? x.toNonIndexed() : x));
    const merged = mergeGeometries(gs, false);
    if (!merged) return;
    merged.computeBoundingSphere();
    const mesh = new THREE.Mesh(merged, material);
    mesh.castShadow = cast;
    mesh.receiveShadow = false;
    mesh.userData.noAO = true;
    g.add(mesh);
  };
  mk(wallGeos, new THREE.MeshStandardMaterial({ color: 0x1b1814, roughness: 0.95 }));
  mk(roofGeos, new THREE.MeshStandardMaterial({ color: 0x24262a, roughness: 0.9 }));
  mk(winGeos, new THREE.MeshStandardMaterial({ color: 0xffcc88, emissive: 0xff9a40, emissiveIntensity: 1.8, roughness: 0.5 }));
  return g;
}
