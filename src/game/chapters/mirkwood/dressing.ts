/**
 * Mirkwood: set dressing (visual only, art-direction pass against docs/refs/scenes/mirkwood).
 *
 * Everything here is generated in code and merged / instanced so the whole layer costs a handful of
 * draw calls:
 *   - creeping surface roots that lace the forest floor around every hero oak (the 3-6 m gnarled bases)
 *   - jagged broken stumps and a few more fallen giants along the lane edges
 *   - bracket fungi stacked on the trunks
 *   - leaf litter (rust, ochre, brown) on the mud
 *   - dark puddles with a warm sky sheen, and warm light pools where the canopy shafts land
 *
 * The 4 m traversal lane stays free: surface roots are flush with the ground (a few cm proud near
 * the trunk), stumps and logs are kept out of the clearings, and nothing here adds a collider
 * except the stumps outside the play areas.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { LevelAPI } from '../../../core/types';
import { addColliders } from '../../../world';
import { Rng, fbm2 } from '../../../core/rng';
import { C1, C2, C3, CLEARINGS, STARTS, centerX, inClearing, V } from './layout';
import type { HeroTree } from './world';

type P3 = [number, number, number];

/** tiny indexed-geometry accumulator */
class Buf {
  pos: number[] = [];
  nor: number[] = [];
  uv: number[] = [];
  idx: number[] = [];
  get count(): number {
    return this.pos.length / 3;
  }
  geometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
}

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _t = new THREE.Vector3();
const _n = new THREE.Vector3();
const _bn = new THREE.Vector3();

/** sweep a lumpy circle along a polyline (parallel transport frame) */
function sweep(buf: Buf, pts: P3[], radii: number[], seg: number, tile: number, lump: number, seed: number): void {
  const n = pts.length;
  if (n < 2) return;
  const base = buf.count;
  _n.set(0, 1, 0);
  let dist = 0;
  for (let i = 0; i < n; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[Math.min(n - 1, i + 1)];
    _t.set(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]).normalize();
    if (Math.abs(_t.y) > 0.95) _n.set(1, 0, 0);
    // project the previous normal onto the plane orthogonal to the tangent
    _n.addScaledVector(_t, -_n.dot(_t)).normalize();
    _bn.crossVectors(_t, _n);
    if (i > 0) dist += _a.set(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1], pts[i][2] - pts[i - 1][2]).length();
    const r = radii[i];
    const nTiles = Math.max(1, Math.round((Math.PI * 2 * r) / tile));
    for (let k = 0; k <= seg; k++) {
      const th = (k / seg) * Math.PI * 2;
      const c = Math.cos(th);
      const s = Math.sin(th);
      const rr = r * (1 + lump * (Math.sin(th * 3 + seed + i * 0.7) * 0.5 + Math.sin(th * 5 - seed * 1.7 + i * 1.3) * 0.3));
      const nx = _n.x * c + _bn.x * s;
      const ny = _n.y * c + _bn.y * s;
      const nz = _n.z * c + _bn.z * s;
      buf.pos.push(pts[i][0] + nx * rr, pts[i][1] + ny * rr, pts[i][2] + nz * rr);
      buf.nor.push(nx, ny, nz);
      buf.uv.push((k / seg) * nTiles, dist / tile);
    }
  }
  for (let i = 0; i < n - 1; i++) {
    for (let k = 0; k < seg; k++) {
      const a = base + i * (seg + 1) + k;
      const b = a + 1;
      const c = a + seg + 1;
      const d = c + 1;
      buf.idx.push(a, b, c, b, d, c);
    }
  }
}

/** a jagged, splintered broken trunk: ring grid whose columns end at different heights */
function stumpGeometry(rng: Rng, r: number, h: number): THREE.BufferGeometry {
  const seg = 14;
  const rows = 6;
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const tops: number[] = [];
  for (let k = 0; k <= seg; k++) tops.push(0);
  // jagged column heights: a few tall splinters among shorter teeth
  const spikes = 2 + Math.floor(rng.float() * 2);
  const spikeAt = Array.from({ length: spikes }, () => rng.float() * seg);
  for (let k = 0; k < seg; k++) {
    let t = 0.38 + 0.3 * rng.float();
    for (const s of spikeAt) {
      const d = Math.min(Math.abs(k - s), seg - Math.abs(k - s));
      t = Math.max(t, 1 - d * 0.2);
    }
    tops[k] = h * t;
  }
  tops[seg] = tops[0];
  for (let j = 0; j <= rows; j++) {
    const f = j / rows;
    for (let k = 0; k <= seg; k++) {
      const th = (k / seg) * Math.PI * 2;
      const flare = 1 + 0.9 * Math.exp(-f * tops[k] * 1.6 / Math.max(0.5, r));
      const lump = 1 + 0.14 * Math.sin(th * 3 + h) + 0.08 * Math.sin(th * 7 + r * 5);
      // splinter tips narrow towards the top
      const taper = 1 - 0.42 * Math.pow(f, 2.2);
      const rr = r * flare * lump * taper;
      pos.push(Math.cos(th) * rr, f * tops[k], Math.sin(th) * rr);
      uv.push((k / seg) * ((Math.PI * 2 * r) / 2.4), (f * tops[k]) / 2.4);
    }
  }
  for (let j = 0; j < rows; j++) {
    for (let k = 0; k < seg; k++) {
      const a = j * (seg + 1) + k;
      idx.push(a, a + seg + 1, a + 1, a + 1, a + seg + 1, a + seg + 2);
    }
  }
  // top cap: a shallow dished fan so the hollow stump does not show its inside
  const cIdx = pos.length / 3;
  let avg = 0;
  for (let k = 0; k < seg; k++) avg += tops[k];
  pos.push(0, (avg / seg) * 0.82, 0);
  uv.push(0.5, 0.5);
  const topRow = rows * (seg + 1);
  for (let k = 0; k < seg; k++) idx.push(topRow + k, topRow + k + 1, cIdx);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** a soft radial glow, white with alpha (cached) */
let glowTex: THREE.DataTexture | null = null;
function glowTexture(): THREE.DataTexture {
  if (glowTex) return glowTex;
  const W = 64;
  const d = new Uint8Array(W * W * 4);
  for (let y = 0; y < W; y++) {
    for (let x = 0; x < W; x++) {
      const r = Math.min(1, Math.hypot((x + 0.5) / W * 2 - 1, (y + 0.5) / W * 2 - 1));
      const a = Math.pow(1 - r, 1.8) * (0.7 + 0.3 * (1 - r));
      const i = (y * W + x) * 4;
      d[i] = d[i + 1] = d[i + 2] = 255;
      d[i + 3] = Math.round(a * 255);
    }
  }
  const t = new THREE.DataTexture(d, W, W, THREE.RGBAFormat);
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  t.userData.shared = true;
  glowTex = t;
  return t;
}

/** a veined oak leaf on a transparent ground (canvas, 64 px) */
function leafTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  g.clearRect(0, 0, 64, 64);
  g.fillStyle = '#d8d0c0';
  g.beginPath();
  g.moveTo(32, 3);
  // lobed outline, right side then mirrored
  const lobes = [[44, 10], [40, 16], [52, 22], [46, 29], [56, 36], [47, 42], [50, 50], [38, 52], [34, 60]];
  for (const [x, y] of lobes) g.lineTo(x, y);
  g.lineTo(32, 62);
  for (let i = lobes.length - 1; i >= 0; i--) g.lineTo(64 - lobes[i][0], lobes[i][1]);
  g.closePath();
  g.fill();
  g.strokeStyle = 'rgba(70,60,40,0.9)';
  g.lineWidth = 1.6;
  g.beginPath();
  g.moveTo(32, 62);
  g.lineTo(32, 6);
  g.stroke();
  g.lineWidth = 1;
  for (let y = 14; y < 56; y += 7) {
    g.beginPath();
    g.moveTo(32, y + 6);
    g.lineTo(46, y - 2);
    g.moveTo(32, y + 6);
    g.lineTo(18, y - 2);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

export interface DressingOpts {
  level: LevelAPI;
  ground: (x: number, z: number) => number;
  heroes: HeroTree[];
  probe: (hi: number, angle: number, h: number) => { point: THREE.Vector3; normal: THREE.Vector3 };
  /** the warm key light direction (toward the light) */
  sun: THREE.Vector3;
  /** light-shaft landing spots [x, z, radius] */
  pools: [number, number, number][];
  /** the oak bark material used for roots and stumps (tinted clone) */
  bark: THREE.Material;
  /** the hollow's mouth (centre of the dark opening at the far end) */
  hollow: THREE.Vector3;
}

export { sweep, Buf };

export function buildDressing(o: DressingOpts): void {
  const { level, ground, heroes } = o;
  const root = level.root;
  const physics = level.ctx.physics;
  const rng = new Rng(8801);
  const dressing = new THREE.Group();
  dressing.name = 'mirkwood_dressing';
  root.add(dressing);

  const nearHero = (x: number, z: number, pad: number) => heroes.some((h) => Math.hypot(x - h.x, z - h.z) < h.r0 + pad);

  // ── creeping surface roots ───────────────────────────────────────────────
  {
    const buf = new Buf();
    for (const h of heroes) {
      // every hero gets 6-8 long roots; the ones pointing into the play area stay shorter and flatter
      const n = 6 + Math.floor(rng.float() * 3);
      const a0 = rng.float() * Math.PI * 2;
      for (let i = 0; i < n; i++) {
        const a = a0 + (i / n) * Math.PI * 2 + (rng.float() - 0.5) * 0.5;
        // distance from the nearest play-area centre along this root's outward end
        const ex = h.x + Math.cos(a) * (h.r0 + 8);
        const ez = h.z + Math.sin(a) * (h.r0 + 8);
        const intoPlay = inClearing(ex, ez, 1);
        const L = (intoPlay ? 3.5 : 5.5) + rng.float() * (intoPlay ? 3 : 7);
        const r0 = (intoPlay ? 0.2 : 0.3) + rng.float() * 0.2;
        const steps = Math.max(6, Math.round(L / 0.8));
        const pts: P3[] = [];
        const radii: number[] = [];
        let ang = a;
        let px = h.x + Math.cos(a) * h.r0 * 0.95;
        let pz = h.z + Math.sin(a) * h.r0 * 0.95;
        for (let k = 0; k <= steps; k++) {
          const t = k / steps;
          const r = r0 * (1 - 0.82 * Math.pow(t, 0.8)) + 0.03;
          // meander, bump, half-buried: the crest sits a little above the soil
          const y = ground(px, pz) + r * (0.35 + 0.25 * Math.sin(k * 1.7 + i)) + (1 - t) * (1 - t) * 0.28;
          pts.push([px, y, pz]);
          radii.push(r);
          ang += (fbm2(px * 0.4, pz * 0.4, 2, 31 + i) * 0.5) * 0.5;
          px += Math.cos(ang) * (L / steps);
          pz += Math.sin(ang) * (L / steps);
        }
        sweep(buf, pts, radii, 7, 2.4, 0.16, i * 2.3 + h.x);
        // a forked side root
        if (rng.chance(0.7) && steps > 7) {
          const k0 = Math.floor(steps * (0.3 + rng.float() * 0.25));
          const side = rng.chance(0.5) ? 1 : -1;
          const sang = Math.atan2(pts[k0 + 1][2] - pts[k0][2], pts[k0 + 1][0] - pts[k0][0]) + side * (0.6 + rng.float() * 0.5);
          const sp: P3[] = [];
          const sr: number[] = [];
          let sx = pts[k0][0];
          let sz = pts[k0][2];
          const sn = Math.max(4, Math.round(steps * 0.45));
          for (let k = 0; k <= sn; k++) {
            const t = k / sn;
            const r = radii[k0] * (1 - 0.85 * t) + 0.02;
            sp.push([sx, ground(sx, sz) + r * 0.3, sz]);
            sr.push(r);
            sx += Math.cos(sang + Math.sin(k * 1.3) * 0.25) * 0.75;
            sz += Math.sin(sang + Math.sin(k * 1.3) * 0.25) * 0.75;
          }
          sweep(buf, sp, sr, 6, 2.4, 0.14, i * 1.1);
        }
      }
    }
    const mesh = new THREE.Mesh(buf.geometry(), o.bark);
    mesh.name = 'surface_roots';
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    dressing.add(mesh);
  }

  // ── the floor between the trunks: arching roots, fallen twigs and branches ──
  // (the reference path is laced with roots and litter all the way to the camera; here the surface roots stop at
  // the trunk rings, so the open lane read as a bare plane.) Flush with the ground, no colliders.
  {
    const roots = new Buf();
    const sticks = new Buf();
    const fr = new Rng(5521);
    const lane = (z: number) => centerX(z) + (fr.float() * 2 - 1) * 17;
    for (let i = 0; i < 118; i++) {
      // the first 54 lie in the play areas (what the gameplay camera looks at), the rest along the lane
      let px: number;
      let pz: number;
      if (i < 54) {
        const [cx, cz, cr] = CLEARINGS[i % 3];
        const a = fr.float() * Math.PI * 2;
        const d = Math.sqrt(fr.float()) * cr * 0.95;
        px = cx + Math.cos(a) * d;
        pz = cz + Math.sin(a) * d;
      } else {
        pz = -30 + fr.float() * 128;
        px = lane(pz);
      }
      if (nearHero(px, pz, 1.5)) continue;
      const L = 2.6 + fr.float() * 4.2;
      const r0 = 0.1 + fr.float() * 0.12;
      const steps = Math.max(6, Math.round(L / 0.55));
      const arch = 0.05 + fr.float() * 0.16;
      let ang = fr.float() * Math.PI * 2;
      const pts: P3[] = [];
      const radii: number[] = [];
      for (let k = 0; k <= steps; k++) {
        const t = k / steps;
        const r = r0 * (1 - 0.75 * t) + 0.025;
        // half buried at the ends, humped in the middle
        const y = ground(px, pz) + r * 0.35 + Math.sin(Math.PI * Math.min(1, t * 1.2)) * arch * (0.6 + 0.4 * Math.sin(k * 1.9 + i));
        pts.push([px, y, pz]);
        radii.push(r * (0.8 + 0.4 * Math.sin(Math.PI * Math.min(1, t * 1.2))));
        ang += fbm2(px * 0.5, pz * 0.5, 2, 61 + i) * 0.45;
        px += Math.cos(ang) * (L / steps);
        pz += Math.sin(ang) * (L / steps);
      }
      sweep(roots, pts, radii, 6, 2.4, 0.16, i * 1.7);
    }
    for (let i = 0; i < 300; i++) {
      const z = -32 + fr.float() * 130;
      const x0 = lane(z);
      const len = 0.7 + Math.pow(fr.float(), 1.8) * 2.6;
      const a = fr.float() * Math.PI * 2;
      const r = 0.02 + fr.float() * 0.035;
      const pts: P3[] = [];
      const radii: number[] = [];
      const n = Math.max(3, Math.round(len / 0.5));
      for (let k = 0; k <= n; k++) {
        const t = k / n;
        const x = x0 + Math.cos(a + 0.25 * Math.sin(k * 2.1 + i)) * t * len;
        const zz = z + Math.sin(a + 0.25 * Math.sin(k * 2.1 + i)) * t * len;
        pts.push([x, ground(x, zz) + r * 0.7, zz]);
        radii.push(r * (1 - 0.55 * t));
      }
      sweep(sticks, pts, radii, 4, 2.4, 0.2, i);
      // a side twig on the longer ones
      if (len > 1.5 && fr.chance(0.7)) {
        const k0 = Math.floor(n * 0.5);
        const sa = a + (fr.chance(0.5) ? 1 : -1) * (0.6 + fr.float() * 0.5);
        const tw: P3[] = [];
        const tr: number[] = [];
        for (let k = 0; k <= 3; k++) {
          const x = pts[k0][0] + Math.cos(sa) * k * 0.28;
          const zz = pts[k0][2] + Math.sin(sa) * k * 0.28;
          tw.push([x, ground(x, zz) + r * 0.7 + k * 0.012, zz]);
          tr.push(Math.max(0.008, r * 0.55 * (1 - k / 4)));
        }
        sweep(sticks, tw, tr, 4, 2.4, 0.2, i + 3);
      }
    }
    if (roots.count) {
      const mesh = new THREE.Mesh(roots.geometry(), o.bark);
      mesh.name = 'floor_roots';
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      dressing.add(mesh);
    }
    if (sticks.count) {
      const mesh = new THREE.Mesh(sticks.geometry(), new THREE.MeshStandardMaterial({ color: 0x5a4630, roughness: 0.95, metalness: 0 }));
      mesh.name = 'floor_sticks';
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      dressing.add(mesh);
    }
  }

  // ── jagged stumps (snags), kept out of the play areas ────────────────────
  {
    const geos: THREE.BufferGeometry[] = [];
    const spots: [number, number, number][] = [];
    let guard = 0;
    while (spots.length < 26 && guard++ < 900) {
      const z = -30 + rng.float() * 128;
      const x = centerX(z) + (rng.float() < 0.5 ? -1 : 1) * (6 + rng.float() * 22);
      if (inClearing(x, z, 2.5) || nearHero(x, z, 4)) continue;
      if (spots.some((s) => Math.hypot(s[0] - x, s[1] - z) < 7)) continue;
      spots.push([x, z, 0.4 + rng.float() * 0.55]);
    }
    for (const [x, z, r] of spots) {
      const hgt = 1.0 + rng.float() * 2.6;
      const g = stumpGeometry(rng, r, hgt);
      g.rotateY(rng.float() * Math.PI * 2);
      g.rotateZ((rng.float() - 0.5) * 0.08);
      g.translate(x, ground(x, z) - 0.15, z);
      geos.push(g);
      addColliders(physics, [{ kind: 'cyl', x, z, r: r * 0.85, y0: ground(x, z) - 1, y1: ground(x, z) + hgt, opts: { walkable: false, material: 'wood', tag: 'tree' } }]);
    }
    if (geos.length) {
      const mesh = new THREE.Mesh(mergeGeometries(geos)!, o.bark);
      mesh.name = 'snags';
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      dressing.add(mesh);
      geos.forEach((g) => g.dispose());
    }
  }

  // ── bracket fungi stacked on the trunks ──────────────────────────────────
  {
    const geos: THREE.BufferGeometry[] = [];
    const q = new THREE.Quaternion();
    const m = new THREE.Matrix4();
    const up = V(0, 1, 0);
    const tmp = V(0, 0, 0);
    heroes.forEach((h, hi) => {
      const clusters = 3 + Math.floor(rng.float() * 3);
      for (let c = 0; c < clusters; c++) {
        const ang = rng.float() * Math.PI * 2;
        const y0 = 0.8 + rng.float() * 3.6;
        const tiers = 2 + Math.floor(rng.float() * 3);
        for (let t = 0; t < tiers; t++) {
          const hit = o.probe(hi, ang + (rng.float() - 0.5) * 0.12, y0 + t * (0.28 + rng.float() * 0.2));
          const rad = 0.16 + rng.float() * 0.26;
          const g = new THREE.SphereGeometry(1, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2);
          g.scale(rad, rad * 0.32, rad * 0.8);
          // colour: warm tan on top, cream gills below
          const col: number[] = [];
          const p = g.attributes.position;
          for (let i = 0; i < p.count; i++) {
            const top = p.getY(i) / (rad * 0.32);
            const rim = Math.hypot(p.getX(i), p.getZ(i)) / rad;
            const k = 0.55 + 0.45 * top;
            col.push(((0.46 + 0.22 * rim) * k + 0.1) * 0.72, ((0.3 + 0.16 * rim) * k + 0.08) * 0.7, ((0.17 + 0.1 * rim) * k + 0.05) * 0.68);
          }
          g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
          // the shelf's +Y axis points along the bark normal (tilted a touch downward), sunk 25 % in
          tmp.copy(hit.normal).addScaledVector(up, -0.18).normalize();
          q.setFromUnitVectors(up, tmp);
          m.compose(hit.point.clone().addScaledVector(hit.normal, -rad * 0.08), q.multiply(new THREE.Quaternion().setFromAxisAngle(up, rng.float() * 6.28)), V(1, 1, 1));
          g.applyMatrix4(m);
          g.deleteAttribute('uv');
          geos.push(g);
        }
      }
    });
    if (geos.length) {
      const merged = mergeGeometries(geos.map((g) => g.toNonIndexed()))!;
      const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0 });
      const mesh = new THREE.Mesh(merged, mat);
      mesh.name = 'bracket_fungi';
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      dressing.add(mesh);
      geos.forEach((g) => g.dispose());
    }
  }

  // ── moss: green cushions on the trunk bases and the ground around them ───
  // (the reference trunks wear bright moss over warm bark; the bark texture alone is a dull olive)
  {
    const geos: THREE.BufferGeometry[] = [];
    const q = new THREE.Quaternion();
    const m = new THREE.Matrix4();
    const up = V(0, 1, 0);
    const tmp = V(0, 0, 0);
    const cushion = (rad: number, flat: number, seedV: number): THREE.BufferGeometry => {
      const g = new THREE.SphereGeometry(1, 9, 6, 0, Math.PI * 2, 0, Math.PI / 2);
      const p = g.attributes.position;
      const col: number[] = [];
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i);
        const y = p.getY(i);
        const z = p.getZ(i);
        const n = 1 + 0.22 * fbm2(x * 2.1 + seedV, z * 2.1, 2, 5) + 0.12 * Math.sin(x * 7 + z * 5 + seedV);
        p.setXYZ(i, x * rad * n, y * rad * flat * (0.8 + 0.4 * n), z * rad * n);
        const k = 0.75 + 0.5 * fbm2(x * 3 + seedV, z * 3, 2, 9) + 0.3 * y;
        col.push(0.12 * k, 0.17 * k, 0.045 * k);
      }
      g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      g.deleteAttribute('uv');
      return g;
    };
    heroes.forEach((h, hi) => {
      // clinging to the bark, thickest at the foot
      const onBark = 9 + Math.floor(rng.float() * 4);
      for (let c = 0; c < onBark; c++) {
        const ang = rng.float() * Math.PI * 2;
        const y = 0.15 + Math.pow(rng.float(), 1.6) * 3.4;
        const hit = o.probe(hi, ang, y);
        const rad = 0.22 + rng.float() * 0.4;
        const g = cushion(rad, 0.7, hi * 7 + c);
        tmp.copy(hit.normal).normalize();
        q.setFromUnitVectors(up, tmp);
        m.compose(hit.point.clone().addScaledVector(hit.normal, -rad * 0.12), q.multiply(new THREE.Quaternion().setFromAxisAngle(up, rng.float() * 6.28)), V(1, 1, 1));
        g.applyMatrix4(m);
        geos.push(g);
      }
      // mounds on the ground around the base, between the roots
      const onGround = 7 + Math.floor(rng.float() * 3);
      for (let c = 0; c < onGround; c++) {
        const ang = rng.float() * Math.PI * 2;
        const d = h.r0 * (0.95 + rng.float() * 0.9);
        const x = h.x + Math.cos(ang) * d;
        const z = h.z + Math.sin(ang) * d;
        if (inClearing(x, z, -3)) continue;
        const rad = 0.35 + rng.float() * 0.6;
        const g = cushion(rad, 0.4, hi * 11 + c);
        g.rotateY(rng.float() * 6.28);
        g.translate(x, ground(x, z) - 0.02, z);
        geos.push(g);
      }
    });
    if (geos.length) {
      const merged = mergeGeometries(geos)!;
      merged.computeVertexNormals();
      const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 });
      const mesh = new THREE.Mesh(merged, mat);
      mesh.name = 'moss';
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      dressing.add(mesh);
      geos.forEach((g) => g.dispose());
    }
  }

  // ── leaf litter: three batches, hidden when far behind the player ────────
  {
    const tex = leafTexture();
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshStandardMaterial({ map: tex, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.8, metalness: 0 });
    mat.name = 'leaf_litter';
    const zones: [number, number][] = [[-34, 24], [24, 62], [62, 108]];
    const palette: [number, number, number][] = [
      [0.62, 0.3, 0.07], [0.7, 0.46, 0.12], [0.42, 0.22, 0.07], [0.3, 0.2, 0.07], [0.5, 0.38, 0.1], [0.34, 0.34, 0.09],
    ];
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const m = new THREE.Matrix4();
    const col = new THREE.Color();
    const batches: THREE.InstancedMesh[] = [];
    const centers: THREE.Vector3[] = [];
    for (const [z0, z1] of zones) {
      const N = 2300;
      const im = new THREE.InstancedMesh(geo, mat, N);
      let k = 0;
      let guard = 0;
      while (k < N && guard++ < N * 30) {
        const z = z0 + rng.float() * (z1 - z0);
        const x = centerX(z) + (rng.float() * 2 - 1) * 26;
        // drifts: clumpy, thicker under the trees and along the roots, thinner on the open mud
        const dens = 0.5 + 0.5 * fbm2(x * 0.09, z * 0.09, 3, 77);
        if (rng.float() > dens * dens + 0.12) continue;
        const s = 0.16 + rng.float() * 0.2;
        e.set((rng.float() - 0.5) * 0.35, rng.float() * Math.PI * 2, (rng.float() - 0.5) * 0.35);
        q.setFromEuler(e);
        m.compose(V(x, ground(x, z) + 0.02 + rng.float() * 0.03, z), q, V(s, s, s));
        im.setMatrixAt(k, m);
        const c = palette[Math.floor(rng.float() * palette.length)];
        const v = 0.55 + rng.float() * 0.6;
        col.setRGB(c[0] * v, c[1] * v, c[2] * v);
        im.setColorAt(k, col);
        k++;
      }
      im.count = k;
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
      im.computeBoundingSphere();
      im.castShadow = false;
      im.receiveShadow = true;
      im.userData.noAO = true;
      im.name = 'leaf_litter';
      dressing.add(im);
      batches.push(im);
      centers.push(V(0, 0, (z0 + z1) / 2));
    }
    level.onUpdate(() => {
      const pz = level.ctx.player.position.z;
      for (let i = 0; i < batches.length; i++) batches[i].visible = Math.abs(pz - centers[i].z) < 52;
    });
  }

  // ── puddles: dark, glossy, with a warm sheen at grazing angles ───────────
  {
    const sites: [number, number, number][] = [];
    const zs = [-24, -16, -9, -3, 4, 11, 17, 24, 30, 36, 45, 52, 60, 67, 74, 82];
    for (const z of zs) {
      const n = rng.chance(0.6) ? 2 : 1;
      for (let i = 0; i < n; i++) {
        const x = centerX(z) + (rng.float() - 0.5) * 11;
        sites.push([x, z, 0.7 + rng.float() * 1.5]);
      }
    }
    // always a few in front of each start, where the gameplay camera looks (the reference lane is full of them)
    for (const s of STARTS) {
      const fx = Math.sin(s.facing);
      const fz = Math.cos(s.facing);
      for (const [d, side, r] of [[5.5, -2.2, 0.8], [9, 2.8, 1.1], [13, -1.2, 1.0]] as const) {
        sites.push([s.pos.x + fx * d - fz * side, s.pos.z + fz * d + fx * side, r]);
      }
    }
    const geos: THREE.BufferGeometry[] = [];
    const RINGS = 5;
    const SEG = 20;
    for (const [x, z, r] of sites) {
      // skip steep or tree-crowded spots
      const hc = ground(x, z);
      const slope = Math.max(Math.abs(ground(x + r, z) - hc), Math.abs(ground(x - r, z) - hc), Math.abs(ground(x, z + r) - hc), Math.abs(ground(x, z - r) - hc));
      if (slope > r * 0.22 || nearHero(x, z, 0.4)) continue;
      const pos: number[] = [];
      const col: number[] = [];
      const idx: number[] = [];
      const wob = rng.float() * 10;
      for (let j = 0; j <= RINGS; j++) {
        const f = j / RINGS;
        for (let k = 0; k < SEG; k++) {
          const th = (k / SEG) * Math.PI * 2;
          const rr = r * f * (1 + 0.28 * Math.sin(th * 2 + wob) + 0.16 * Math.sin(th * 3 - wob * 1.7));
          const px = x + Math.cos(th) * rr * 1.25;
          const pz = z + Math.sin(th) * rr * 0.85;
          pos.push(px, ground(px, pz) + 0.018, pz);
          const a = j === RINGS ? 0 : j === RINGS - 1 ? 0.7 : 1;
          col.push(1, 1, 1, a);
        }
      }
      for (let j = 0; j < RINGS; j++) {
        for (let k = 0; k < SEG; k++) {
          const a = j * SEG + k;
          const b = j * SEG + ((k + 1) % SEG);
          const c = a + SEG;
          const d = b + SEG;
          idx.push(a, b, c, b, d, c); // counter-clockwise from above (the normals point up)
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(col, 4));
      g.setIndex(idx);
      const nrm = new Float32Array(pos.length);
      for (let i = 0; i < nrm.length; i += 3) nrm[i + 1] = 1;
      g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
      geos.push(g);
    }
    if (geos.length) {
      const mat = new THREE.MeshPhysicalMaterial({
        color: 0x1a150e, roughness: 0.04, metalness: 0, vertexColors: true, transparent: true, opacity: 0.88, envMapIntensity: 0.8,
        specularColor: new THREE.Color(0xffe2a8), specularIntensity: 0.5, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
      });
      // the canopy-dimmed IBL leaves a mirror-smooth puddle as just a darker patch: add the hazy sky sheen that
      // grows towards grazing angles (the reference puddles flash pale where the lane meets the light)
      mat.onBeforeCompile = (shader) => {
        shader.fragmentShader = shader.fragmentShader.replace(
          '#include <emissivemap_fragment>',
          '#include <emissivemap_fragment>\n  float puddleFres = pow(1.0 - clamp(dot(normalize(vViewPosition), normal), 0.0, 1.0), 3.0);\n  totalEmissiveRadiance += vec3(0.2, 0.21, 0.14) * (0.06 + 0.94 * puddleFres);',
        );
      };
      mat.customProgramCacheKey = () => 'mirk_puddle_sheen';
      const mesh = new THREE.Mesh(mergeGeometries(geos)!, mat);
      mesh.name = 'puddles';
      mesh.receiveShadow = true;
      mesh.userData.noAO = true;
      mesh.renderOrder = 1;
      dressing.add(mesh);
      geos.forEach((g) => g.dispose());
    }
  }

  // ── warm light pools where the shafts land ───────────────────────────────
  {
    const mat = new THREE.MeshBasicMaterial({
      map: glowTexture(), color: 0xe9d994, transparent: true, opacity: 0.15, blending: THREE.AdditiveBlending, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
    });
    const geos: THREE.BufferGeometry[] = [];
    // the pool is the shaft's footprint: stretched along the horizontal part of the light direction
    const sx = -o.sun.x;
    const sz = -o.sun.z;
    const yaw = Math.atan2(sx, sz);
    for (const [x, z, r] of o.pools) {
      const SEGX = 6;
      const g = new THREE.PlaneGeometry(1, 1, SEGX, SEGX);
      g.rotateX(-Math.PI / 2);
      g.scale(r * 3.2, 1, r * 2.2);
      g.rotateY(yaw);
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const px = p.getX(i) + x;
        const pz = p.getZ(i) + z;
        p.setXYZ(i, px, ground(px, pz) + 0.05, pz);
      }
      g.deleteAttribute('normal');
      geos.push(g);
    }
    if (geos.length) {
      const mesh = new THREE.Mesh(mergeGeometries(geos)!, mat);
      mesh.name = 'light_pools';
      mesh.renderOrder = 2;
      mesh.userData.noAO = true;
      dressing.add(mesh);
      geos.forEach((g) => g.dispose());
    }
  }

  hollowMouth(o, dressing, rng);

  void C1;
  void C2;
  void C3;
}

/**
 * The dark web hollow (layout.json S2: 20 x 10 x 16 m): a black half-dome cut into the slope, framed by
 * a gnarled root arch with ribs and hanging roots. Silk is added by world.ts in front of it.
 */
function hollowMouth(o: DressingOpts, parent: THREE.Group, rng: Rng): void {
  const { ground, hollow } = o;
  const cz = hollow.z + 3;
  const R = 10.5;
  // the cave: the inside of a half-sphere, near-black with a faint rise in value towards the lip
  const dome = new THREE.SphereGeometry(R, 32, 14, 0, Math.PI, 0, Math.PI / 2);
  dome.scale(1, 0.95, 1.15);
  const cp = dome.attributes.position;
  const cc: number[] = [];
  for (let i = 0; i < cp.count; i++) {
    const hgt = cp.getY(i) / R;
    const depth = cp.getZ(i) / (R * 1.15);
    const v = 0.012 + 0.03 * (1 - depth) + 0.012 * hgt;
    cc.push(v * 0.9, v, v * 0.8);
  }
  dome.setAttribute('color', new THREE.Float32BufferAttribute(cc, 3));
  const gy = ground(hollow.x, cz) - 1.2;
  dome.translate(hollow.x, gy, cz);
  const cave = new THREE.Mesh(dome, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide }));
  cave.name = 'hollow_cave';
  cave.userData.noAO = true;
  parent.add(cave);

  // the root arch: two pillars that curve inward and meet overhead, ribs inside, hanging roots
  const buf = new Buf();
  const archR = R * 0.93;
  const arcPts = (side: number, lift: number, zOff: number, yMax: number, steps: number): { pts: P3[]; radii: number[] } => {
    const pts: P3[] = [];
    const radii: number[] = [];
    for (let k = 0; k <= steps; k++) {
      const t = k / steps;
      const a = side * (Math.PI / 2) * (1 - t * (0.93 + lift)); // from the side up over the top
      const x = hollow.x + Math.sin(a) * archR * (1 + 0.05 * Math.sin(t * 9 + side));
      const y = gy + Math.cos(a) * yMax + 1.6 * Math.sin(t * Math.PI) * 0.4;
      const z = cz - 0.5 + zOff + Math.sin(t * 7 + side * 2) * 0.5;
      pts.push([x, y, z]);
      radii.push(1.25 * (1 - 0.7 * t) + 0.22);
    }
    return { pts, radii };
  };
  for (const side of [-1, 1]) {
    for (let r = 0; r < 3; r++) {
      const a = arcPts(side, 0.02 * r, -r * 0.9 + (rng.float() - 0.5) * 0.6, 9.6 + r * 0.5, 18);
      for (let i = 0; i < a.radii.length; i++) a.radii[i] *= 1 - r * 0.28;
      sweep(buf, a.pts, a.radii, 9, 2.4, 0.22, side * 3 + r);
    }
  }
  // hanging roots / vines across the opening
  for (let i = 0; i < 16; i++) {
    const x = hollow.x + (rng.float() * 2 - 1) * 8.2;
    const top = gy + 7.5 + rng.float() * 3.2 - Math.abs(x - hollow.x) * 0.25;
    const len = 2.2 + rng.float() * 5;
    const pts: P3[] = [];
    const radii: number[] = [];
    for (let k = 0; k <= 8; k++) {
      const t = k / 8;
      pts.push([x + Math.sin(k * 0.8 + i) * 0.25, top - t * len, cz - 0.2 + Math.cos(k * 0.6 + i * 2) * 0.25]);
      radii.push(0.16 * (1 - t * 0.7) + 0.03);
    }
    sweep(buf, pts, radii, 5, 2.4, 0.2, i);
  }
  const arch = new THREE.Mesh(buf.geometry(), o.bark);
  arch.name = 'hollow_arch';
  arch.castShadow = true;
  arch.receiveShadow = true;
  parent.add(arch);
}
