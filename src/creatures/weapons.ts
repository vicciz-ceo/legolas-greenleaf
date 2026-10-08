/**
 * Weapons — every WeaponKind built in code. Grip at the origin, blade/tip along +Y.
 * (For shields the face points along +X, which is the back of the LEFT hand in a hand socket;
 * for bows the arrow flies along +Z and the string is on -Z.)
 *
 * Geometry is real: faceted bevelled blades (flat-shaded facets catch the light), wrapped grips
 * with ridges, guards, pommels; materials use the kit creature shader (procedural scratches,
 * leather grain, wood streaks) driven by per-vertex surface attributes, so each weapon is ONE
 * draw call. The dwarf axe head carries an engraved knotwork normal map.
 *
 * Extra API on the returned Object3D (userData):
 *   bow:        { setDraw(v 0..1), setNock(localPoint | null), showArrow(v) }   (all bows/crossbow)
 *   fireAnchor: Object3D at the torch head (pass to fx.torch)
 *   tip:        Object3D at the blade tip (trails)
 */
import * as THREE from 'three';
import type { WeaponKind } from '../core/types';
import { Rng, hashSeed, noise2 } from '../core/rng';
import { paintGeometry, mergeKitGeometries } from './kit/geometry';
import { createCreatureMaterial } from './kit/material';
import { SURFACES, surface, type SurfaceName, type SurfaceSpec } from './kit/surfaces';

type Part = THREE.BufferGeometry;

/** optional look variant (KindDef.weapons.style): e.g. the Uruk-hai falchion and white-hand shield */
export type WeaponStyle = 'default' | 'uruk' | 'orc' | 'rohan' | 'gondor' | 'elven' | 'dwarf' | 'easterling' | 'haradrim';
interface PaintArgs {
  color: number;
  mat: SurfaceName | SurfaceSpec;
  colorFn?: (p: THREE.Vector3, n: THREE.Vector3, c: THREE.Color) => void;
  ao?: number;
}

let weaponMat: THREE.MeshPhysicalMaterial | null = null;
function material(): THREE.MeshPhysicalMaterial {
  if (!weaponMat) {
    weaponMat = createCreatureMaterial({ detailScale: 0.8, detailStrength: 1.0, side: THREE.DoubleSide });
    weaponMat.userData.shared = true;
  }
  return weaponMat;
}

class Kit {
  parts: Part[] = [];
  add(g: Part, a: PaintArgs, m?: THREE.Matrix4) {
    this.parts.push(paintGeometry(g, { color: a.color, mat: a.mat, colorFn: a.colorFn, bone: 0, matrix: m, ao: a.ao ?? 1 }));
    g.dispose();
    return this;
  }
  mesh(name: string): THREE.Mesh {
    const g = mergeKitGeometries(this.parts);
    for (const p of this.parts) p.dispose();
    const m = new THREE.Mesh(g, material());
    m.name = name;
    m.castShadow = true;
    m.receiveShadow = true;
    return m;
  }
}

const _c = new THREE.Color();
const lin = (hex: number) => new THREE.Color().setHex(hex, THREE.SRGBColorSpace);

function lathe(profile: [number, number][], seg = 12): Part {
  return new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(Math.max(1e-4, r), y)), seg);
}

/** wrapped grip: lathe with helical-looking ridges */
function grip(r: number, y0: number, y1: number, ridges: number, seg = 10): Part {
  const prof: [number, number][] = [];
  const n = Math.max(8, ridges * 3);
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const y = y0 + (y1 - y0) * t;
    prof.push([r * (1 + 0.09 * Math.abs(Math.sin(t * ridges * Math.PI))) * (1 - 0.06 * Math.sin(t * Math.PI)), y]);
  }
  return lathe(prof, seg);
}

interface BladeOpts {
  len: number;
  width: number; // half width at the base
  thick: number; // half thickness at the base
  /** [t, widthMul] profile stations (t 0..1 along the blade, before the tip) */
  shape: [number, number][];
  single?: boolean;
  /** x offset of the tip (curved blades), quadratic */
  curve?: number;
  /** jagged/notched edge amplitude (orc steel) */
  jag?: number;
  seed?: number;
  /** tip length as a fraction */
  tip?: number;
  bevel?: number;
}

/** faceted blade (flat shaded) along +Y from y=0 */
function blade(o: BladeOpts): Part {
  const rnd = new Rng(o.seed ?? 1);
  const b = o.bevel ?? 0.38;
  const section = (w: number, h: number, jagL: number, jagR: number): [number, number][] =>
    o.single
      ? [
          [w + jagR, 0], [w * (1 - b), h * 0.5], [-w * 0.75, h], [-w, h * 0.7], [-w, -h * 0.7], [-w * 0.75, -h], [w * (1 - b), -h * 0.5],
        ]
      : [
          [w + jagR, 0], [w * (1 - b), h * 0.45], [w * 0.25, h], [-w * 0.25, h], [-w * (1 - b), h * 0.45], [-w - jagL, 0],
          [-w * (1 - b), -h * 0.45], [-w * 0.25, -h], [w * 0.25, -h], [w * (1 - b), -h * 0.45],
        ];
  const st = o.shape;
  const tipT = 1 - (o.tip ?? 0.12);
  const rings: { y: number; x: number; pts: [number, number][] }[] = [];
  for (const [t, wm] of st) {
    const tt = t * tipT;
    const w = o.width * wm;
    const h = o.thick * (1 - 0.55 * tt);
    const j = o.jag ? o.jag * (rnd.float() < 0.5 ? rnd.float() : 0) : 0;
    const j2 = o.jag ? o.jag * (rnd.float() < 0.5 ? rnd.float() : 0) : 0;
    rings.push({ y: tt * o.len, x: (o.curve ?? 0) * tt * tt, pts: section(w, h, j2, -j) });
  }
  const tip = { y: o.len, x: (o.curve ?? 0) * (o.single ? 1.05 : 1) + (o.single ? o.width * 0.55 : 0) };
  const pos: number[] = [];
  const tri = (a: number[], bb: number[], c: number[]) => pos.push(...a, ...bb, ...c);
  const n = rings[0].pts.length;
  for (let r = 0; r + 1 < rings.length; r++) {
    const A = rings[r], B = rings[r + 1];
    for (let i = 0; i < n; i++) {
      const i2 = (i + 1) % n;
      const a0 = [A.x + A.pts[i][0], A.y, A.pts[i][1]];
      const a1 = [A.x + A.pts[i2][0], A.y, A.pts[i2][1]];
      const b0 = [B.x + B.pts[i][0], B.y, B.pts[i][1]];
      const b1 = [B.x + B.pts[i2][0], B.y, B.pts[i2][1]];
      tri(a0, b0, b1);
      tri(a0, b1, a1);
    }
  }
  const L = rings[rings.length - 1];
  for (let i = 0; i < n; i++) {
    const i2 = (i + 1) % n;
    tri([L.x + L.pts[i][0], L.y, L.pts[i][1]], [tip.x, tip.y, 0], [L.x + L.pts[i2][0], L.y, L.pts[i2][1]]);
  }
  // base cap
  const F0 = rings[0];
  for (let i = 1; i + 1 < n; i++) tri([F0.x + F0.pts[0][0], F0.y, F0.pts[0][1]], [F0.x + F0.pts[i + 1][0], F0.y, F0.pts[i + 1][1]], [F0.x + F0.pts[i][0], F0.y, F0.pts[i][1]]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

/** steel colouring: bright polished edges, darker flats, optional rust/grime */
function steel(base: number, edge: number, width: number, grime = 0, seed = 1) {
  const cb = lin(base), ce = lin(edge);
  const n2 = noise2(seed);
  return (p: THREE.Vector3, _n: THREE.Vector3, c: THREE.Color) => {
    const e = Math.min(1, Math.abs(p.x) / Math.max(1e-4, width));
    c.copy(cb).lerp(ce, Math.pow(e, 6) * 0.9);
    if (grime > 0) {
      const g = Math.max(0, n2(p.x * 40 + p.z * 30, p.y * 25)) * grime;
      c.lerp(_c.setRGB(0.18, 0.09, 0.04), g);
    }
  };
}

function woodColor(base: number, seed = 2) {
  const cb = lin(base);
  const n2 = noise2(seed);
  return (p: THREE.Vector3, _n: THREE.Vector3, c: THREE.Color) => {
    const g = n2(p.x * 30 + p.z * 30, p.y * 2.5) * 0.5 + n2(p.x * 90, p.y * 9) * 0.25;
    c.copy(cb).multiplyScalar(0.85 + 0.25 * g);
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Bows
// ─────────────────────────────────────────────────────────────────────────────

interface BowOpts {
  half: number; // half length (m)
  brace: number;
  recurve: number;
  width: number;
  thick: number;
  wood: number;
  gripColor: number;
  tipColor?: number;
  stringColor: number;
  crude?: boolean;
  fletch: number;
  carved?: boolean;
  seed: number;
}

function bowLimbCenter(o: BowOpts, y: number): number {
  // z of the limb centre line at height |y| (string side is -Z)
  const t = Math.min(1, Math.abs(y) / o.half);
  let z = -o.brace * 0.82 * Math.pow(Math.max(0, (t - 0.08) / 0.92), 1.65);
  if (t > 0.8) z += o.recurve * Math.pow((t - 0.8) / 0.2, 2);
  return z + 0.012;
}

function buildBow(o: BowOpts): THREE.Object3D {
  const root = new THREE.Group();
  root.name = 'bow';
  const k = new Kit();
  const rnd = new Rng(o.seed);
  // limbs: swept rounded-rect section, one strip per side
  for (const sgn of [1, -1]) {
    const pos: number[] = [];
    const idx: number[] = [];
    const N = 30;
    const ring = 6;
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      const y = sgn * (0.07 + t * (o.half - 0.07));
      const z = bowLimbCenter(o, y);
      // tangent for orientation
      const z2 = bowLimbCenter(o, y + sgn * 0.01);
      const ang = Math.atan2(z2 - z, 0.01);
      const w = o.width * (1 - 0.68 * t) * (o.crude ? 1 + (rnd.float() - 0.5) * 0.15 : 1);
      const th = o.thick * (1 - 0.6 * t);
      for (let j = 0; j < ring; j++) {
        const a = (j / ring) * Math.PI * 2;
        const lx = Math.cos(a) * w * 0.5;
        const lz = Math.sin(a) * th * 0.5 * (Math.abs(Math.sin(a)) > 0.7 ? 1 : 1.05);
        // rotate section by limb angle around X
        const yy = y - lz * Math.sin(ang) * sgn;
        const zz = z + lz * Math.cos(ang);
        pos.push(lx, yy, zz);
      }
    }
    for (let i = 0; i < N; i++)
      for (let j = 0; j < ring; j++) {
        const a = i * ring + j, b = i * ring + ((j + 1) % ring);
        const c = a + ring, d = b + ring;
        if (sgn > 0) idx.push(a, c, b, b, c, d);
        else idx.push(a, b, c, b, d, c);
      }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    const tipC = lin(o.tipColor ?? o.wood);
    k.add(g, {
      color: o.wood,
      mat: o.crude ? surface('wood', { rough: 0.85 }) : surface('wood', { rough: 0.5 }),
      colorFn: (p, n, c) => {
        woodColor(o.wood, o.seed)(p, n, c);
        const t = Math.abs(p.y) / o.half;
        if (t > 0.9) c.lerp(tipC, 0.8);
        if (o.carved && t > 0.15 && t < 0.75) {
          // carved vine pattern on the belly/back
          const v = Math.sin(p.y * 160 + Math.sin(p.y * 40) * 2) * Math.sin(p.x * 400);
          if (v > 0.55) c.multiplyScalar(0.55);
        }
      },
    });
  }
  // riser + grip wrap + arrow shelf
  k.add(lathe([[0.0, -0.11], [0.014, -0.105], [0.019, -0.07], [0.021, 0], [0.019, 0.07], [0.014, 0.105], [0.0, 0.11]], 10).scale(1, 1, 1.25).translate(0, 0, 0.004), { color: o.wood, mat: 'wood', colorFn: woodColor(o.wood, o.seed) });
  k.add(grip(0.0215, -0.06, 0.055, 9, 10).scale(1, 1, 1.25).translate(0, 0, 0.004), { color: o.gripColor, mat: o.crude ? 'rags' : 'suede' });
  k.add(new THREE.BoxGeometry(0.012, 0.012, 0.03).translate(0.012, 0.068, 0.0), { color: o.gripColor, mat: 'leather' });
  if (o.crude) {
    for (const y of [-0.3, 0.25, 0.42]) k.add(grip(0.018, y, y + 0.035, 4, 6).translate(0, 0, bowLimbCenter(o, y)), { color: 0x4a3a28, mat: 'rags' });
  }
  const body = k.mesh('bow_body');
  root.add(body);
  // string (dynamic): two thin crossed quads per segment, tip → nock → tip
  const sGeo = new THREE.BufferGeometry();
  const sPos = new Float32Array(2 * 8 * 3);
  sGeo.setAttribute('position', new THREE.BufferAttribute(sPos, 3));
  const sIdx: number[] = [];
  for (let seg = 0; seg < 2; seg++) {
    const b = seg * 8;
    sIdx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2, b + 4, b + 5, b + 6, b + 5, b + 7, b + 6);
  }
  sGeo.setIndex(sIdx);
  const painted = paintGeometry(sGeo, { color: o.stringColor, mat: 'linen', bone: 0 });
  sGeo.dispose();
  const string = new THREE.Mesh(painted, material());
  string.name = 'bow_string';
  string.castShadow = false;
  string.frustumCulled = false;
  root.add(string);
  const tipY = o.half * 0.965;
  const tipZ = bowLimbCenter(o, tipY) - o.thick * 0.3;
  const stringPos = string.geometry.attributes.position as THREE.BufferAttribute;
  const nock = new THREE.Vector3(0, 0.0, -o.brace);
  const thick = 0.0016;
  const writeSeg = (seg: number, a: THREE.Vector3, b: THREE.Vector3) => {
    const o8 = seg * 8;
    const pts = [
      [a.x - thick, a.y, a.z], [a.x + thick, a.y, a.z], [b.x - thick, b.y, b.z], [b.x + thick, b.y, b.z],
      [a.x, a.y, a.z - thick], [a.x, a.y, a.z + thick], [b.x, b.y, b.z - thick], [b.x, b.y, b.z + thick],
    ];
    pts.forEach((p, i) => stringPos.setXYZ(o8 + i, p[0], p[1], p[2]));
  };
  // limb flex: store rest positions, bend tips back with draw
  const limbPos = body.geometry.attributes.position as THREE.BufferAttribute;
  const rest = (limbPos.array as Float32Array).slice();
  let lastDraw = -1;
  const top = new THREE.Vector3();
  const bot = new THREE.Vector3();
  // nocked arrow
  const arrow = buildArrowMesh(o.fletch, o.crude ? 0x2a2620 : 0xc8b490, o.crude);
  arrow.visible = false;
  root.add(arrow);
  const api = {
    draw: 0,
    setDraw(v: number) {
      v = Math.max(0, Math.min(1, v));
      this.draw = v;
      if (Math.abs(v - lastDraw) > 1e-3) {
        lastDraw = v;
        const arr = limbPos.array as Float32Array;
        for (let i = 0; i < limbPos.count; i++) {
          const y = rest[i * 3 + 1];
          const t = Math.max(0, (Math.abs(y) - 0.08) / o.half);
          const f = t * t * v;
          arr[i * 3 + 1] = y * (1 - 0.06 * f);
          arr[i * 3 + 2] = rest[i * 3 + 2] - 0.12 * f * (o.half / 0.8);
        }
        limbPos.needsUpdate = true;
      }
      const f = v;
      top.set(0, tipY * (1 - 0.06 * f), tipZ - 0.12 * f * (o.half / 0.8));
      bot.set(0, -top.y, top.z);
      writeSeg(0, top, nock);
      writeSeg(1, nock, bot);
      stringPos.needsUpdate = true;
      arrow.position.set(0.011, nock.y + 0.004, nock.z);
    },
    /** nock point in bow-local space (null = string at rest for the current draw) */
    setNock(p: THREE.Vector3 | null) {
      if (p) nock.copy(p);
      else nock.set(0, 0, -o.brace - 0.56 * this.draw);
      this.setDraw(this.draw);
    },
    showArrow(v: boolean) {
      arrow.visible = v;
    },
  };
  api.setDraw(0);
  root.userData.bow = api;
  const tip = new THREE.Object3D();
  tip.position.set(0, o.half, bowLimbCenter(o, o.half));
  tip.name = 'tip';
  root.add(tip);
  root.userData.tip = tip;
  return root;
}

function buildArrowMesh(fletch: number, shaft: number, crude?: boolean): THREE.Mesh {
  const k = new Kit();
  const L = 0.74;
  // along +Z from the nock (z=0)
  const rot = new THREE.Matrix4().makeRotationX(Math.PI / 2);
  k.add(new THREE.CylinderGeometry(0.0042, 0.0042, L - 0.06, 6, 1, true).translate(0, (L - 0.06) / 2 + 0.01, 0), { color: shaft, mat: 'wood' }, rot);
  k.add(new THREE.CylinderGeometry(0.0055, 0.005, 0.016, 6).translate(0, 0.006, 0), { color: 0x2a2420, mat: 'horn' }, rot);
  // head: leaf blade
  const head = blade({ len: 0.07, width: 0.011, thick: 0.0022, shape: [[0, 0.4], [0.35, 1], [0.8, 0.7]], seed: 3, jag: crude ? 0.003 : 0 });
  k.add(head, { color: crude ? 0x3a3530 : 0xb8b8c0, mat: crude ? 'metal_rusty' : 'metal' }, new THREE.Matrix4().makeTranslation(0, 0, L - 0.05).multiply(rot));
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + Math.PI / 2;
    const vane = new THREE.BufferGeometry();
    const pts = [[0.004, 0.025], [0.017, 0.045], [0.017, 0.13], [0.004, 0.15]];
    const verts: number[] = [];
    for (const [r, y] of pts) verts.push(Math.cos(a) * r, y, Math.sin(a) * r);
    vane.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    vane.setIndex([0, 1, 2, 0, 2, 3]);
    vane.computeVertexNormals();
    k.add(vane, { color: fletch, mat: 'linen' }, rot);
  }
  const m = k.mesh('arrow');
  m.castShadow = false;
  return m;
}

// ─────────────────────────────────────────────────────────────────────────────
// Knotwork normal map (dwarf axe engraving)
// ─────────────────────────────────────────────────────────────────────────────

let knotTex: { normal: THREE.DataTexture; rough: THREE.DataTexture; color: THREE.DataTexture } | null = null;
function knotwork() {
  if (knotTex) return knotTex;
  const S = 256;
  const h = new Float32Array(S * S);
  const n = 3; // interlace cells per tile
  const band = 0.16;
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const u = (x / S) * n, v = (y / S) * n;
      // two diagonal families of rounded bands (distance to the nearest diagonal line)
      const d1 = Math.abs(((u + v) % 1 + 1) % 1 - 0.5);
      const d2 = Math.abs(((u - v) % 1 + 1) % 1 - 0.5);
      const b1 = Math.max(0, 1 - d1 / band);
      const b2 = Math.max(0, 1 - d2 / band);
      // over/under alternates per crossing (checker on the crossing lattice)
      const cu = Math.floor(u + v + 0.5), cv = Math.floor(u - v + 0.5);
      const over1 = ((cu + cv) & 1) === 0;
      let top: number;
      if (b1 > 0 && b2 > 0) top = over1 ? Math.max(b1, b2 * 0.35) : Math.max(b2, b1 * 0.35);
      else top = Math.max(b1, b2);
      // rounded profile with a central groove line (engraved double-line look)
      const prof = top > 0 ? Math.sqrt(top) * (1 - 0.35 * Math.exp(-Math.pow((1 - top) * 6, 2))) : 0;
      // plain border band around the tile edge
      const fx = Math.min(x, S - 1 - x) / S, fy = Math.min(y, S - 1 - y) / S;
      const edge = Math.min(fx, fy);
      h[y * S + x] = edge < 0.03 ? 0.85 : edge < 0.045 ? 0.0 : prof * 0.85;
    }
  const nd = new Uint8Array(S * S * 4);
  const rd = new Uint8Array(S * S * 4);
  const cd = new Uint8Array(S * S * 4);
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const hx = h[y * S + ((x + 1) % S)] - h[y * S + ((x - 1 + S) % S)];
      const hy = h[((y + 1) % S) * S + x] - h[((y - 1 + S) % S) * S + x];
      const nx = -hx * 1.6, ny = -hy * 1.6, nz = 1;
      const l = Math.hypot(nx, ny, nz);
      const i = (y * S + x) * 4;
      nd[i] = Math.round((nx / l * 0.5 + 0.5) * 255);
      nd[i + 1] = Math.round((ny / l * 0.5 + 0.5) * 255);
      nd[i + 2] = Math.round((nz / l * 0.5 + 0.5) * 255);
      nd[i + 3] = 255;
      const hv = h[y * S + x];
      // engraved grooves (low) are rougher and darker
      const r = hv > 0.2 ? 0.3 : 0.7;
      rd[i] = rd[i + 1] = rd[i + 2] = Math.round(r * 255);
      rd[i + 3] = 255;
      const c = hv > 0.2 ? 215 : 150;
      cd[i] = c;
      cd[i + 1] = Math.round(c * 0.95);
      cd[i + 2] = Math.round(c * 0.85);
      cd[i + 3] = 255;
    }
  const mk = (d: Uint8Array, cs: THREE.ColorSpace) => {
    const t = new THREE.DataTexture(d, S, S, THREE.RGBAFormat);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.magFilter = THREE.LinearFilter;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.generateMipmaps = true;
    t.anisotropy = 4;
    t.colorSpace = cs;
    t.needsUpdate = true;
    t.userData.shared = true;
    return t;
  };
  knotTex = { normal: mk(nd, THREE.NoColorSpace), rough: mk(rd, THREE.NoColorSpace), color: mk(cd, THREE.SRGBColorSpace) };
  return knotTex;
}

// ─────────────────────────────────────────────────────────────────────────────
// Weapon builders
// ─────────────────────────────────────────────────────────────────────────────

function withTip(obj: THREE.Object3D, y: number): THREE.Object3D {
  const tip = new THREE.Object3D();
  tip.name = 'tip';
  tip.position.set(0, y, 0);
  obj.add(tip);
  obj.userData.tip = tip;
  return obj;
}

function sword(kind: 'sword' | 'elven_sword', seed: number): THREE.Object3D {
  const k = new Kit();
  const elven = kind === 'elven_sword';
  const len = elven ? 0.82 : 0.86;
  const w = elven ? 0.021 : 0.026;
  k.add(blade({ len, width: w, thick: 0.0042, shape: elven ? [[0, 0.8], [0.15, 0.85], [0.55, 1.08], [0.85, 0.75], [1, 0.45]] : [[0, 1], [0.6, 0.92], [0.9, 0.75], [1, 0.5]], seed, tip: elven ? 0.16 : 0.1 }), { color: 0xb8bcc4, mat: surface('metal', { rough: 0.22 }), colorFn: steel(0xa8aeb6, 0xf0f2f6, w * 1.05) }, new THREE.Matrix4().makeTranslation(0, 0.09, 0));
  if (elven) {
    // curved swept guard
    const guard = new THREE.TorusGeometry(0.07, 0.007, 6, 16, Math.PI * 0.9).rotateZ(Math.PI * 0.05).scale(1, 0.45, 1).translate(0, 0.07, 0);
    k.add(guard, { color: 0xc8b070, mat: 'gold' });
  } else {
    k.add(new THREE.BoxGeometry(0.17, 0.018, 0.026).translate(0, 0.08, 0), { color: 0x6a6a70, mat: 'metal_dark' });
  }
  k.add(grip(0.0145, -0.12, 0.072, 11), { color: elven ? 0x3a2a1e : 0x2c2018, mat: 'leather' });
  k.add(lathe([[0, -0.165], [0.018, -0.16], [0.024, -0.145], [0.02, -0.128], [0.012, -0.12]], 10), { color: elven ? 0xc8b070 : 0x8a8a90, mat: elven ? 'gold' : 'metal' });
  return withTip(k.mesh(kind), len + 0.09);
}

/** heavy Uruk-hai falchion: broad single-edged blade widening to a clipped point, dark steel */
function falchion(seed: number): THREE.Object3D {
  const k = new Kit();
  k.add(blade({ len: 0.78, width: 0.03, thick: 0.0055, single: true, curve: 0.02, shape: [[0, 0.85], [0.4, 1.05], [0.75, 1.45], [0.92, 1.5], [1, 1.2]], seed, tip: 0.08, bevel: 0.3 }), { color: 0x6a6a6c, mat: surface('metal_dark', { rough: 0.38 }), colorFn: steel(0x505256, 0xb8bcc0, 0.045, 0.25, seed) }, new THREE.Matrix4().makeTranslation(0, 0.07, 0));
  k.add(new THREE.BoxGeometry(0.12, 0.022, 0.03).translate(0, 0.06, 0), { color: 0x2e2c2a, mat: 'metal_dark' });
  k.add(grip(0.016, -0.15, 0.05, 9), { color: 0x1c1816, mat: 'leather_worn' });
  k.add(new THREE.CylinderGeometry(0.022, 0.026, 0.03, 6).translate(0, -0.165, 0), { color: 0x2e2c2a, mat: 'metal_dark' });
  return withTip(k.mesh('falchion'), 0.85);
}

function elvenKnife(seed: number): THREE.Object3D {
  const k = new Kit();
  // Legolas' white-handled knife: slightly curved, leaf-like single edge
  k.add(blade({ len: 0.3, width: 0.018, thick: 0.0035, single: true, curve: -0.018, shape: [[0, 0.85], [0.3, 1], [0.7, 0.95], [1, 0.6]], seed, tip: 0.2 }), { color: 0xc0c4cc, mat: surface('metal', { rough: 0.2 }), colorFn: steel(0xb0b6c0, 0xf4f6f8, 0.02) }, new THREE.Matrix4().makeTranslation(0, 0.055, 0));
  k.add(new THREE.TorusGeometry(0.022, 0.0045, 6, 12, Math.PI).rotateZ(Math.PI).scale(1.2, 0.5, 0.9).translate(0, 0.052, 0), { color: 0xd8d4c8, mat: 'metal' });
  k.add(lathe([[0, -0.1], [0.011, -0.098], [0.0135, -0.08], [0.0115, -0.03], [0.013, 0.02], [0.012, 0.045], [0.0, 0.05]], 10).scale(1, 1, 0.82), { color: 0xeae4d6, mat: 'bone' });
  k.add(lathe([[0, -0.118], [0.009, -0.115], [0.013, -0.104], [0.01, -0.097], [0, -0.096]], 8), { color: 0xd0ccc0, mat: 'metal' });
  return withTip(k.mesh('elven_knife'), 0.355);
}

function curvedBlade(kind: 'scimitar' | 'cleaver', seed: number): THREE.Object3D {
  const k = new Kit();
  const rnd = new Rng(seed);
  if (kind === 'scimitar') {
    k.add(blade({ len: 0.74, width: 0.026, thick: 0.004, single: true, curve: -0.12, shape: [[0, 0.9], [0.5, 1.1], [0.85, 1.25], [1, 0.9]], seed, jag: 0.002 * rnd.float() }), { color: 0x9a9a98, mat: 'metal', colorFn: steel(0x80827f, 0xd0d2d0, 0.03, 0.15, seed) }, new THREE.Matrix4().makeTranslation(0, 0.07, 0));
    k.add(new THREE.BoxGeometry(0.1, 0.014, 0.024).translate(0, 0.062, 0), { color: 0xa08048, mat: 'gold' });
    k.add(grip(0.014, -0.09, 0.055, 8), { color: 0x3a2418, mat: 'leather' });
    k.add(lathe([[0, -0.13], [0.016, -0.12], [0.012, -0.095]], 8), { color: 0xa08048, mat: 'gold' });
    return withTip(k.mesh(kind), 0.8);
  }
  // crude orc cleaver: wide, notched, rusty
  k.add(blade({ len: 0.5, width: 0.055, thick: 0.006, single: true, curve: 0.03, shape: [[0, 0.7], [0.3, 1], [0.8, 1.2], [1, 1.1]], jag: 0.012, seed, tip: 0.06, bevel: 0.25 }), { color: 0x5a5048, mat: 'metal_rusty', colorFn: steel(0x4a423a, 0x8a8278, 0.06, 0.6, seed) }, new THREE.Matrix4().makeTranslation(0, 0.06, 0));
  k.add(grip(0.017, -0.11, 0.06, 6), { color: 0x2a221a, mat: 'rags' });
  k.add(new THREE.CylinderGeometry(0.02, 0.022, 0.02, 6).translate(0, -0.12, 0), { color: 0x3a342e, mat: 'metal_rusty' });
  return withTip(k.mesh(kind), 0.56);
}

function haft(k: Kit, y0: number, y1: number, r: number, color: number, wrap?: number) {
  k.add(new THREE.CylinderGeometry(r * 0.92, r, y1 - y0, 8, 4).translate(0, (y0 + y1) / 2, 0), { color, mat: 'wood', colorFn: woodColor(color) });
  if (wrap !== undefined) k.add(grip(r * 1.12, y0 + 0.05, y0 + 0.3, 8, 8), { color: wrap, mat: 'leather' });
}

function axe(kind: 'axe' | 'dwarf_axe', seed: number): THREE.Object3D {
  const root = new THREE.Group();
  root.name = kind;
  const k = new Kit();
  const dwarf = kind === 'dwarf_axe';
  const L = dwarf ? 0.78 : 0.7;
  haft(k, -0.25, L, 0.017, dwarf ? 0x5a3a20 : 0x4a3424, dwarf ? 0x3a2416 : 0x2a2018);
  // steel collar & butt spike
  k.add(new THREE.CylinderGeometry(0.023, 0.023, 0.06, 8).translate(0, L - 0.06, 0), { color: 0x7a7468, mat: 'metal' });
  k.add(new THREE.ConeGeometry(0.02, 0.06, 6).rotateX(Math.PI).translate(0, -0.28, 0), { color: 0x7a7468, mat: 'metal' });
  root.add(k.mesh(kind + '_haft'));
  // head: extruded bearded bit(s)
  const shape = new THREE.Shape();
  if (dwarf) {
    shape.moveTo(0.02, 0.05);
    shape.quadraticCurveTo(0.09, 0.07, 0.15, 0.11);
    shape.quadraticCurveTo(0.2, 0.0, 0.16, -0.12);
    shape.quadraticCurveTo(0.09, -0.08, 0.04, -0.03);
    shape.lineTo(0.02, -0.03);
    shape.lineTo(0.02, 0.05);
  } else {
    shape.moveTo(0.02, 0.035);
    shape.quadraticCurveTo(0.08, 0.05, 0.13, 0.08);
    shape.quadraticCurveTo(0.15, -0.0, 0.13, -0.08);
    shape.quadraticCurveTo(0.07, -0.05, 0.02, -0.035);
    shape.lineTo(0.02, 0.035);
  }
  const ex = new THREE.ExtrudeGeometry(shape, { depth: 0.016, bevelEnabled: true, bevelThickness: 0.007, bevelSize: 0.006, bevelSegments: 2, curveSegments: 10 });
  ex.translate(0, 0, -0.008);
  const heads: THREE.BufferGeometry[] = [ex];
  if (dwarf) heads.push(ex.clone().scale(-1, 1, 1));
  const mergedHead = new THREE.BufferGeometry();
  {
    const pos: number[] = [], nor: number[] = [], uv: number[] = [];
    for (const g of heads) {
      const gi = g.index ? g.toNonIndexed() : g;
      pos.push(...(gi.attributes.position.array as Float32Array));
      nor.push(...(gi.attributes.normal.array as Float32Array));
      uv.push(...(gi.attributes.uv.array as Float32Array));
    }
    mergedHead.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    mergedHead.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    // planar UVs from x/y so the knotwork maps across the cheeks
    const uvs = new Float32Array((pos.length / 3) * 2);
    for (let i = 0; i < pos.length / 3; i++) {
      uvs[i * 2] = pos[i * 3] * 7 + 0.5;
      uvs[i * 2 + 1] = pos[i * 3 + 1] * 7 + 0.5;
    }
    mergedHead.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    void uv;
  }
  mergedHead.translate(0, L - 0.07, 0);
  const tex = knotwork();
  const headMat = new THREE.MeshStandardMaterial({
    color: dwarf ? 0xb8b0a0 : 0x8a8680,
    map: dwarf ? tex.color : null,
    metalness: 1,
    roughness: dwarf ? 1 : 0.45,
    roughnessMap: dwarf ? tex.rough : null,
    normalMap: dwarf ? tex.normal : null,
    normalScale: new THREE.Vector2(0.8, 0.8),
  });
  const head = new THREE.Mesh(mergedHead, headMat);
  head.name = kind + '_head';
  head.castShadow = true;
  root.add(head);
  for (const g of heads) g.dispose();
  return withTip(root, L);
}

function polearm(kind: 'pike' | 'spear', seed: number): THREE.Object3D {
  const k = new Kit();
  const pike = kind === 'pike';
  const y0 = pike ? -1.0 : -0.6;
  const y1 = pike ? 2.5 : 1.4;
  haft(k, y0, y1, pike ? 0.019 : 0.016, pike ? 0x3a2c22 : 0x5a4430);
  k.add(blade({ len: pike ? 0.32 : 0.26, width: pike ? 0.03 : 0.026, thick: 0.006, shape: [[0, 0.3], [0.25, 1], [0.7, 0.7], [1, 0.4]], seed, tip: 0.15, jag: pike ? 0.0 : 0 }), { color: 0x8a8884, mat: pike ? 'metal_dark' : 'metal', colorFn: steel(0x6a6a68, 0xc8c8c4, 0.03, pike ? 0.3 : 0, seed) }, new THREE.Matrix4().makeTranslation(0, y1, 0));
  k.add(new THREE.CylinderGeometry(0.016, 0.022, 0.08, 8).translate(0, y1 - 0.02, 0), { color: 0x5a5a58, mat: 'metal_dark' });
  if (pike) k.add(new THREE.ConeGeometry(0.02, 0.07, 6).rotateX(Math.PI).translate(0, y0 - 0.03, 0), { color: 0x4a4a48, mat: 'metal_dark' });
  return withTip(k.mesh(kind), y1 + (pike ? 0.32 : 0.26));
}

function blunt(kind: 'mace' | 'club' | 'warhammer', seed: number): THREE.Object3D {
  const k = new Kit();
  const rnd = new Rng(seed);
  if (kind === 'club') {
    // knobbly wooden club (trolls scale it up through their hand socket)
    const prof: [number, number][] = [];
    for (let i = 0; i <= 14; i++) {
      const t = i / 14;
      prof.push([0.025 + 0.075 * Math.pow(t, 1.6) + rnd.range(-0.006, 0.006), -0.25 + t * 1.15]);
    }
    prof.push([0.05, 0.92], [0.0, 0.94]);
    const g = lathe(prof, 9);
    const p = g.attributes.position as THREE.BufferAttribute;
    const n3 = noise2(seed);
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const kk = 1 + 0.18 * n3(Math.atan2(z, x) * 2, y * 6);
      p.setXYZ(i, x * kk, y, z * kk);
    }
    g.computeVertexNormals();
    k.add(g, { color: 0x4a3626, mat: surface('wood', { rough: 0.9, pat: { wrinkles: 1.2 } }), colorFn: woodColor(0x4a3626, seed) });
    for (let i = 0; i < 7; i++) {
      const a = rnd.range(0, Math.PI * 2), y = rnd.range(0.35, 0.85);
      const sp = new THREE.ConeGeometry(0.012, 0.07, 5).translate(0, 0.07, 0);
      const r = 0.025 + 0.075 * Math.pow((y + 0.25) / 1.15, 1.6);
      const m = new THREE.Matrix4().makeTranslation(Math.cos(a) * r, y, Math.sin(a) * r).multiply(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(Math.sin(a) * 1.4, 0, -Math.cos(a) * 1.4)));
      k.add(sp, { color: 0x3a3632, mat: 'metal_rusty' }, m);
    }
    return withTip(k.mesh(kind), 0.94);
  }
  haft(k, -0.2, kind === 'warhammer' ? 0.82 : 0.6, 0.016, 0x3e2e22, 0x2a2018);
  if (kind === 'mace') {
    const y = 0.62;
    k.add(new THREE.SphereGeometry(0.035, 10, 8).translate(0, y, 0), { color: 0x6a6660, mat: 'metal_dark' });
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      k.add(new THREE.BoxGeometry(0.008, 0.09, 0.035).translate(0, 0, 0.03).applyMatrix4(new THREE.Matrix4().makeRotationY(a)).translate(0, y, 0), { color: 0x7a7670, mat: 'metal_dark' });
    }
    return withTip(k.mesh(kind), 0.68);
  }
  const y = 0.8;
  k.add(new THREE.BoxGeometry(0.075, 0.05, 0.05).translate(0.045, y, 0), { color: 0x6a6660, mat: 'metal_dark', colorFn: steel(0x5a5652, 0x8a8682, 0.1, 0.2, seed) });
  k.add(new THREE.ConeGeometry(0.02, 0.09, 4).rotateZ(Math.PI / 2).translate(-0.05, y, 0), { color: 0x6a6660, mat: 'metal_dark' });
  k.add(new THREE.ConeGeometry(0.012, 0.06, 4).translate(0, y + 0.05, 0), { color: 0x6a6660, mat: 'metal_dark' });
  return withTip(k.mesh(kind), y + 0.08);
}

function crossbow(seed: number): THREE.Object3D {
  const root = new THREE.Group();
  root.name = 'crossbow';
  const k = new Kit();
  // stock along +Y (tip forward), grip at the origin
  k.add(new THREE.BoxGeometry(0.04, 0.62, 0.05).translate(0, 0.18, 0.02), { color: 0x4a3422, mat: 'wood', colorFn: woodColor(0x4a3422, seed) });
  k.add(new THREE.BoxGeometry(0.035, 0.16, 0.06).translate(0, -0.06, -0.03).applyMatrix4(new THREE.Matrix4().makeRotationX(-0.3)), { color: 0x3e2c1e, mat: 'wood' });
  k.add(new THREE.BoxGeometry(0.012, 0.05, 0.012).translate(0, 0.0, -0.02), { color: 0x5a5a58, mat: 'metal_dark' });
  root.add(k.mesh('crossbow_stock'));
  const bow = buildBow({ half: 0.32, brace: 0.06, recurve: 0.02, width: 0.035, thick: 0.02, wood: 0x2e2a26, gripColor: 0x2a2018, stringColor: 0x8a7a60, fletch: 0x3a3028, crude: true, seed });
  // prod across the front: bow +Y → crossbow X, bow string (-Z) → toward the stock (-Y)
  bow.rotation.set(0, 0, Math.PI / 2);
  bow.rotation.order = 'ZXY';
  bow.rotateX(-Math.PI / 2);
  bow.position.set(0, 0.46, 0.04);
  root.add(bow);
  root.userData.bow = bow.userData.bow;
  return withTip(root, 0.5);
}

function torch(seed: number): THREE.Object3D {
  const k = new Kit();
  haft(k, -0.25, 0.32, 0.017, 0x4a3626);
  // cloth-wrapped, pitch-soaked head
  const head = lathe([[0.015, 0.28], [0.034, 0.3], [0.04, 0.36], [0.038, 0.42], [0.028, 0.46], [0.0, 0.47]], 9);
  const p = head.attributes.position as THREE.BufferAttribute;
  const n2 = noise2(seed);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const kk = 1 + 0.12 * n2(Math.atan2(z, x) * 3, y * 40);
    p.setXYZ(i, x * kk, y, z * kk);
  }
  head.computeVertexNormals();
  k.add(head, { color: 0x1e1a16, mat: surface('rags', { rough: 0.98 }), colorFn: (q, _n, c) => c.lerp(_c.setRGB(0.25, 0.1, 0.02), Math.max(0, (q.y - 0.42) * 15)) });
  k.add(new THREE.CylinderGeometry(0.02, 0.02, 0.025, 8).translate(0, 0.27, 0), { color: 0x4a4440, mat: 'metal_rusty' });
  const m = k.mesh('torch');
  const anchor = new THREE.Object3D();
  anchor.name = 'fireAnchor';
  anchor.position.set(0, 0.44, 0);
  m.add(anchor);
  m.userData.fireAnchor = anchor;
  return withTip(m, 0.47);
}

function shield(seed: number, style: WeaponStyle = 'default'): THREE.Object3D {
  const k = new Kit();
  const R = style === 'uruk' ? 0.46 : style === 'dwarf' ? 0.36 : 0.42;
  // slightly domed wooden disc: built around +Y then turned so the face points +X
  const prof: [number, number][] = [[0, 0.03], [R * 0.3, 0.027], [R * 0.7, 0.016], [R * 0.98, 0.0], [R, -0.012], [R * 0.97, -0.018], [0.0, -0.01]];
  const disc = lathe(prof, 36);
  const green = lin(0x2e4a2a), gold = lin(0xb08a3a), red = lin(0x7a2a1a), wood = lin(0x6a4a2a);
  const n2 = noise2(seed);
  const toFace = new THREE.Matrix4().makeRotationZ(-Math.PI / 2).premultiply(new THREE.Matrix4().makeTranslation(0.06, 0, 0));
  k.add(disc, {
    color: 0x6a4a2a,
    mat: surface('wood', { rough: 0.7 }),
    colorFn: (p, n, c) => {
      // after the matrix: face plane is YZ, face normal +X
      const r = Math.hypot(p.y, p.z) / R;
      const a = Math.atan2(p.z, p.y);
      // lathe normals face inward here: test the face by position (front dome is at x > 0.055)
      void n;
      if (p.x < 0.062 && r > 0.2) {
        c.copy(wood).multiplyScalar(0.8 + 0.2 * n2(p.y * 30, p.z * 4));
        return;
      }
      if (style === 'uruk') {
        // black shield with Saruman's white hand
        c.setRGB(0.02, 0.02, 0.02);
        const hx = p.y / R, hz = p.z / R;
        const palm = Math.hypot(hx * 1.1, hz + 0.1) < 0.28;
        let finger = false;
        for (let f = 0; f < 5; f++) {
          const ang = -0.9 + f * 0.42;
          const fx = Math.sin(ang), fz = Math.cos(ang);
          const t = hx * fx + (hz + 0.1) * fz;
          const d = Math.abs(hx * fz - (hz + 0.1) * fx);
          if (t > 0.15 && t < 0.62 - Math.abs(f - 2) * 0.06 && d < 0.055) finger = true;
        }
        if (palm || finger) c.setRGB(0.75, 0.72, 0.68);
      } else if (style === 'gondor') {
        c.setRGB(0.015, 0.015, 0.018);
        const tx = Math.abs(p.z / R), ty = p.y / R;
        const trunk = tx < 0.04 && ty > -0.55 && ty < 0.3;
        const crown = Math.hypot(tx * 1.3, ty - 0.35) < 0.3 && Math.sin(Math.atan2(ty - 0.35, tx) * 7) > -0.2;
        if (trunk || crown) c.setRGB(0.7, 0.7, 0.68);
        if (r > 0.9) c.setRGB(0.4, 0.4, 0.42);
      } else if (style === 'dwarf' || style === 'easterling') {
        c.copy(style === 'dwarf' ? lin(0x5a5248) : lin(0x8a6a30));
        if (Math.abs(Math.sin(r * 18)) > 0.92) c.multiplyScalar(0.6);
      } else {
        // Rohan sun rays: alternating green / gold sectors, red ring
        const sector = Math.floor(((a + Math.PI) / (Math.PI * 2)) * 16) & 1;
        c.copy(sector ? green : gold);
        if (r > 0.78 && r < 0.88) c.copy(red);
        if (r < 0.25) c.copy(gold);
      }
      // worn paint showing wood
      const wear = n2(p.y * 14, p.z * 14) * 0.5 + n2(p.y * 50, p.z * 50) * 0.3;
      if (wear > 0.45) c.lerp(wood, 0.8);
      c.multiplyScalar(0.92 + 0.12 * n2(p.y * 6, p.z * 60));
    },
  }, toFace);
  // iron rim and boss
  k.add(new THREE.TorusGeometry(R, 0.012, 6, 40).rotateY(Math.PI / 2).translate(0.06, 0, 0), { color: 0x6a645c, mat: 'metal_dark' });
  k.add(new THREE.SphereGeometry(0.075, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.5).rotateZ(-Math.PI / 2).scale(0.6, 1, 1).translate(0.09, 0, 0), { color: 0x8a8478, mat: 'metal', colorFn: steel(0x8a8478, 0xb0aaa0, 1, 0.2, seed) });
  // grip bar behind
  k.add(new THREE.CylinderGeometry(0.014, 0.014, 0.12, 8).translate(0, 0, 0), { color: 0x2a2018, mat: 'leather' });
  k.add(new THREE.BoxGeometry(0.03, 0.14, 0.03).translate(0.035, 0, 0), { color: 0x4a3a28, mat: 'wood' });
  return withTip(k.mesh('shield'), R);
}

const WEAPON_CACHE = new Map<string, THREE.Object3D>();

function build(kind: WeaponKind, seed: number, style: WeaponStyle = 'default'): THREE.Object3D {
  if (kind === 'sword' && style === 'uruk') return falchion(seed);
  switch (kind) {
    case 'elven_bow':
      return buildBow({ half: 0.79, brace: 0.17, recurve: 0.07, width: 0.034, thick: 0.022, wood: 0xcfbf98, gripColor: 0x3a2e24, tipColor: 0xe8dcc0, stringColor: 0xe0dccc, fletch: 0xf2f0ea, carved: true, seed });
    case 'orc_bow':
      return buildBow({ half: 0.55, brace: 0.13, recurve: 0.05, width: 0.032, thick: 0.024, wood: 0x2e241c, gripColor: 0x3a2e22, stringColor: 0x6a5a48, fletch: 0x2a2622, crude: true, seed });
    case 'uruk_bow':
      return buildBow({ half: 0.7, brace: 0.16, recurve: 0.09, width: 0.04, thick: 0.028, wood: 0x1c1a18, gripColor: 0x2a2420, tipColor: 0x3a3632, stringColor: 0x5a5248, fletch: 0x1a1816, crude: false, seed });
    case 'elven_knives':
      return elvenKnife(seed);
    case 'sword':
    case 'elven_sword':
      return sword(kind, seed);
    case 'scimitar':
    case 'cleaver':
      return curvedBlade(kind, seed);
    case 'axe':
    case 'dwarf_axe':
      return axe(kind, seed);
    case 'pike':
    case 'spear':
      return polearm(kind, seed);
    case 'mace':
    case 'club':
    case 'warhammer':
      return blunt(kind, seed);
    case 'crossbow':
      return crossbow(seed);
    case 'torch':
      return torch(seed);
    case 'shield':
      return shield(seed, style);
    default: {
      const g = new THREE.Group();
      g.name = 'none';
      return g;
    }
  }
}

const DYNAMIC: WeaponKind[] = ['elven_bow', 'orc_bow', 'uruk_bow', 'crossbow'];

/**
 * Create a weapon. Grip at the origin, blade/tip along +Y. Geometry is cached per (kind, seed%8)
 * and shared between instances (marked userData.shared — do not dispose it). Bows and crossbows
 * are built per instance because their string and limb flex are animated.
 */
export function createWeapon(kind: WeaponKind, seed = 1, style: WeaponStyle = 'default'): THREE.Object3D {
  const sd = Math.abs(Math.floor(seed)) % 8;
  if (DYNAMIC.includes(kind)) {
    const b = build(kind, sd, style);
    b.userData.kind = kind;
    return b;
  }
  const key = `${kind}|${sd}|${style}`;
  let tpl = WEAPON_CACHE.get(key);
  if (!tpl) {
    tpl = build(kind, sd, style);
    tpl.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) m.geometry.userData.shared = true;
    });
    WEAPON_CACHE.set(key, tpl);
  }
  const c = tpl.clone(true);
  c.traverse((o) => {
    if (o.name === 'tip') c.userData.tip = o;
    if (o.name === 'fireAnchor') c.userData.fireAnchor = o;
  });
  c.userData.kind = kind;
  return c;
}

/** dispose per-instance weapon resources (shared cached geometry/materials are kept) */
export function disposeWeapon(obj: THREE.Object3D) {
  obj.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh && !m.geometry.userData.shared) m.geometry.dispose();
  });
}

/** weapon kinds in display order (lab sheet) */
export const WEAPON_KINDS: WeaponKind[] = ['elven_bow', 'elven_knives', 'elven_sword', 'sword', 'scimitar', 'cleaver', 'axe', 'dwarf_axe', 'mace', 'warhammer', 'club', 'spear', 'pike', 'orc_bow', 'uruk_bow', 'crossbow', 'torch', 'shield'];

void SURFACES;
