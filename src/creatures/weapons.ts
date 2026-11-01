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
import { createCreatureMaterial, cloneCreatureMaterial } from './kit/material';
import { atlasTexture, ensureEmblem, emblemUV, type Emblem } from './weapons_atlas';
import { SURFACES, surface, type SurfaceName, type SurfaceSpec } from './kit/surfaces';

type Part = THREE.BufferGeometry;

/** optional look variant (KindDef.weapons.style): e.g. the Uruk-hai falchion and white-hand shield; 'elven' = Tauriel's
 *  brass-fitted, leather-hilted knives (elven_knives only; bows ignore it, Legolas keeps the default cream bone hilt) */
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

/** the weapon material with the emblem atlas as its map (shield faces); vertices without uv read white */
let atlasMat: THREE.MeshPhysicalMaterial | null = null;
function emblemMaterial(): THREE.MeshPhysicalMaterial {
  const tex = atlasTexture();
  if (!tex) return material();
  if (!atlasMat) {
    atlasMat = cloneCreatureMaterial(material());
    atlasMat.map = tex;
    atlasMat.userData.shared = true;
  }
  return atlasMat;
}

type UVFn = (p: THREE.Vector3, n: THREE.Vector3) => [number, number];

class Kit {
  parts: Part[] = [];
  private uvs: (UVFn | null)[] = [];
  add(g: Part, a: PaintArgs, m?: THREE.Matrix4, uv?: UVFn) {
    this.parts.push(paintGeometry(g, { color: a.color, mat: a.mat, colorFn: a.colorFn, bone: 0, matrix: m, ao: a.ao ?? 1 }));
    this.uvs.push(uv ?? null);
    g.dispose();
    return this;
  }
  mesh(name: string): THREE.Mesh {
    const g = mergeKitGeometries(this.parts);
    // emblem faces: planar uv into the atlas (every other vertex stays at (0,0) = the white texel)
    const useAtlas = this.uvs.some((f) => f);
    if (useAtlas) {
      const uv = new Float32Array(g.attributes.position.count * 2);
      const p = new THREE.Vector3(), n = new THREE.Vector3();
      let o = 0;
      this.parts.forEach((part, i) => {
        const f = this.uvs[i];
        const pp = part.attributes.position, nn = part.attributes.normal;
        if (f) for (let v = 0; v < pp.count; v++) {
          const [u, w] = f(p.fromBufferAttribute(pp, v), n.fromBufferAttribute(nn, v));
          uv[(o + v) * 2] = u;
          uv[(o + v) * 2 + 1] = w;
        }
        o += pp.count;
      });
      g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    }
    for (const p of this.parts) p.dispose();
    const m = new THREE.Mesh(g, useAtlas ? emblemMaterial() : material());
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
  /** [t, widthMul, centreOffset?] profile stations (t 0..1 along the blade, before the tip; the
   *  optional 3rd value moves the blade's centre line sideways in metres: recurved sabres) */
  shape: [number, number, number?][];
  /** resample the stations to this many rings (more vertices for colour/rust, smoother curves) */
  rings?: number;
  /** x of the tip point (default: the end of the curve). Everything is given for an edge on +X, then mirrored by `edge` */
  tipX?: number;
  /** -1 puts the cutting edge of a single-edged blade on -X */
  edge?: 1 | -1;
  /** edge ratio: thickness is a fraction along the blade (spine taper); 0.55 default */
  taper?: number;
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
  let st = o.shape;
  if (o.rings && o.rings > st.length) {
    const res: [number, number, number][] = [];
    for (let i = 0; i < o.rings; i++) {
      const t = i / (o.rings - 1) * (st[st.length - 1][0] - st[0][0]) + st[0][0];
      let k = 0;
      while (k < st.length - 2 && st[k + 1][0] < t) k++;
      const a = st[k], b = st[k + 1];
      const f = (t - a[0]) / Math.max(1e-6, b[0] - a[0]);
      res.push([t, a[1] + (b[1] - a[1]) * f, (a[2] ?? 0) + ((b[2] ?? 0) - (a[2] ?? 0)) * f]);
    }
    st = res;
  }
  const tipT = 1 - (o.tip ?? 0.12);
  const mir = o.edge === -1;
  const mx = mir ? -1 : 1;
  const rings: { y: number; x: number; pts: [number, number][] }[] = [];
  for (const [t, wm, cx] of st) {
    const tt = t * tipT;
    const w = o.width * wm;
    const h = o.thick * (1 - (o.taper ?? 0.55) * tt);
    const j = o.jag ? o.jag * (rnd.float() < 0.5 ? rnd.float() : 0) : 0;
    const j2 = o.jag ? o.jag * (rnd.float() < 0.5 ? rnd.float() : 0) : 0;
    rings.push({ y: tt * o.len, x: ((o.curve ?? 0) * tt * tt + (cx ?? 0)) * mx, pts: section(w, h, j2, -j).map(([px, pz]) => [px * mx, pz] as [number, number]) });
  }
  const lastCx = st[st.length - 1][2] ?? 0;
  const tip = { y: o.len, x: (o.tipX ?? (o.curve ?? 0) * (o.single ? 1.05 : 1) + (o.single ? o.width * 0.55 : 0) + lastCx) * mx };
  const pos: number[] = [];
  const tri = (a: number[], bb: number[], c: number[]) => (mir ? pos.push(...a, ...c, ...bb) : pos.push(...a, ...bb, ...c));
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
  // recurve: the outer limb sweeps forward (away from the archer) into curled tips
  if (t > 0.74) z += o.recurve * Math.pow((t - 0.74) / 0.26, 2.2);
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
    // (the carving is in the shader; a few more rings keep the recurve smooth)
    const N = o.carved ? 36 : 30;
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
      // carved (Galadhrim) bows: leaf work cut into the polished limbs (the kit's tooled pattern)
      mat: o.crude ? surface('wood', { rough: 0.85 }) : o.carved ? surface('wood', { rough: 0.42, pat: { leather: -0.6, fur: 0.7 } }) : surface('wood', { rough: 0.5 }),
      colorFn: (p, n, c) => {
        woodColor(o.wood, o.seed)(p, n, c);
        const t = Math.abs(p.y) / o.half;
        if (t > 0.86) c.lerp(tipC, Math.min(1, (t - 0.86) / 0.06) * 0.85);
        // darker inlaid bands where the limbs leave the riser and before the recurve
        if (o.carved && (Math.abs(t - 0.2) < 0.012 || Math.abs(t - 0.72) < 0.01)) c.lerp(tipC, 0.75);
      },
    });
  }
  // riser + grip wrap + arrow shelf
  k.add(lathe([[0.0, -0.11], [0.014, -0.105], [0.019, -0.07], [0.021, 0], [0.019, 0.07], [0.014, 0.105], [0.0, 0.11]], 10).scale(1, 1, 1.25).translate(0, 0, 0.004), { color: o.wood, mat: 'wood', colorFn: woodColor(o.wood, o.seed) });
  k.add(grip(0.0215, -0.06, 0.055, o.carved ? 15 : 9, 10).scale(1, 1, 1.25).translate(0, 0, 0.004), { color: o.gripColor, mat: o.crude ? 'rags' : 'leather_worn' });
  if (o.carved) {
    // metal binding rings at both ends of the leather grip wrap
    for (const y of [-0.064, 0.059]) k.add(new THREE.TorusGeometry(0.0222, 0.0032, 5, 14).rotateX(Math.PI / 2).scale(1, 1, 1.25).translate(0, y, 0.004), { color: 0xa88a52, mat: 'gold' });
  }
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
  // Explicit normals. The positions are all zero until setDraw() writes them, so computed normals
  // would be (0,0,0); normalize(0) in the shader is NaN, which bloom/SMAA then smear over the whole
  // frame (the "medium quality goes black" bug). The x-offset quad faces ±Z, the z-offset quad ±X.
  const sNor = new Float32Array(2 * 8 * 3);
  for (let seg = 0; seg < 2; seg++) {
    for (let i = 0; i < 8; i++) {
      const k = (seg * 8 + i) * 3;
      if (i < 4) sNor[k + 2] = 1;
      else sNor[k] = 1;
    }
  }
  sGeo.setAttribute('normal', new THREE.BufferAttribute(sNor, 3));
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

/** blade stations from left/right edge functions (edge on +X); half-widths in metres, use with width: 1 */
function edgeStations(n: number, l: (t: number) => number, r: (t: number) => number): [number, number, number][] {
  const out: [number, number, number][] = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    out.push([t, (r(t) - l(t)) / 2, (r(t) + l(t)) / 2]);
  }
  return out;
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * weathered steel: pitted rust patches, bright nicked bevels. `amount` 0..1 is how much of the blade
 * has rusted through; `rust` is the oxide colour, `base` the grey iron.
 */
function oxide(seed: number, base: number, rust: number, edge: number, amount: number, scale = 1) {
  const cb = lin(base), cr = lin(rust), ce = lin(edge);
  const n = noise2(seed * 7 + 3);
  return (p: THREE.Vector3, nn: THREE.Vector3, c: THREE.Color) => {
    const f = n(p.x * 26 * scale + seed, p.y * 9 * scale) * 0.6 + n(p.x * 80 * scale, p.y * 30 * scale) * 0.4;
    const r = smooth(1 - amount * 1.35 - 0.1, 1 - amount * 1.35 + 0.45, f * 0.5 + 0.5);
    c.copy(cb).lerp(cr, r);
    c.multiplyScalar(0.72 + 0.4 * n(p.x * 150, p.y * 55) + 0.2 * f);
    const bev = smooth(0.5, 0.93, Math.abs(nn.x));
    c.lerp(ce, bev * 0.55 * (1 - r * 0.8));
  };
}

/** leather / cord wrap: a tube whose radius ripples along a helix; returns the geometry and the ridge test */
function wrapGeo(r: number, y0: number, y1: number, o: { rings?: number; seg?: number; turns?: number; ridge?: number; strands?: number } = {}) {
  const rings = o.rings ?? 16, seg = o.seg ?? 8, turns = o.turns ?? 5, ridge = o.ridge ?? 0.22, strands = o.strands ?? 1;
  const pos: number[] = [], idx: number[] = [];
  const phase = (th: number, t: number) => Math.pow(0.5 + 0.5 * Math.cos(strands * th + Math.PI * 2 * turns * t), 1.6);
  for (let i = 0; i <= rings; i++) {
    const t = i / rings;
    const y = y0 + (y1 - y0) * t;
    for (let j = 0; j < seg; j++) {
      const th = (j / seg) * Math.PI * 2;
      const rad = r * (1 + ridge * phase(th, t)) * (1 - 0.05 * Math.sin(Math.PI * t));
      pos.push(Math.cos(th) * rad, y, Math.sin(th) * rad);
    }
  }
  for (let i = 0; i < rings; i++)
    for (let j = 0; j < seg; j++) {
      const a = i * seg + j, b = i * seg + ((j + 1) % seg), c = a + seg, d = b + seg;
      idx.push(a, b, c, b, d, c);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const ph = (p: THREE.Vector3) => phase(Math.atan2(p.z, p.x), (p.y - y0) / (y1 - y0));
  return { geo: g, ph };
}

/** wrapped leather colour: raised wraps lighter, the gaps between dark */
function wrapColor(ph: (p: THREE.Vector3) => number, hi: number, lo: number, seed = 1) {
  const ch = lin(hi), cl = lin(lo);
  const n = noise2(seed + 40);
  return (p: THREE.Vector3, _n: THREE.Vector3, c: THREE.Color) => {
    c.copy(cl).lerp(ch, smooth(0.15, 0.7, ph(p)));
    c.multiplyScalar(0.85 + 0.3 * (n(p.y * 45, Math.atan2(p.z, p.x) * 3) * 0.5 + 0.5));
  };
}

/** iron collar / band ring: short lathe */
function band(r: number, y: number, h: number, seg = 10, flare = 1.0): Part {
  return lathe([[r * flare, y - h / 2], [r * 1.08, y - h * 0.35], [r * 1.08, y + h * 0.35], [r * flare, y + h / 2]], seg);
}

/** heavy Uruk-hai falchion: broad single-edged blade, straight spine, notched belly and a clipped
 *  point; dark pitted iron, black leather grip, small curled quillons (sheet: uruk_falchion, 0.85 m) */
function falchion(seed: number): THREE.Object3D {
  const k = new Kit();
  const L = 0.66;
  const l = (t: number) => -0.034 + 0.003 * t;
  const r = (t: number) => {
    if (t < 0.08) return 0.016 + (t / 0.08) * 0.02;
    if (t < 0.5) return 0.036 + ((t - 0.08) / 0.42) * 0.024;
    if (t < 0.74) return 0.06 - ((t - 0.5) / 0.24) * 0.01;
    if (t < 0.79) return 0.05 - ((t - 0.74) / 0.05) * 0.02; // notch
    if (t < 0.84) return 0.03 + ((t - 0.79) / 0.05) * 0.022;
    return 0.052 - ((t - 0.84) / 0.16) * 0.034;
  };
  k.add(
    blade({ len: L, width: 1, thick: 0.0058, single: true, edge: -1, shape: edgeStations(19, l, r), tipX: -0.02, tip: 0.12, bevel: 0.3, jag: 0.0018, seed }),
    { color: 0x5a5a5c, mat: surface('metal_dark', { rough: 0.5, pat: { pores: 0.9 } }), colorFn: oxide(seed, 0x6a6b6e, 0x6e4a34, 0xb4b2ac, 0.2) },
    new THREE.Matrix4().makeTranslation(0, 0.05, 0),
  );
  // the curled quillons
  k.add(new THREE.BoxGeometry(0.1, 0.014, 0.022).translate(0, 0.04, 0), { color: 0x2e2c2a, mat: 'metal_dark' });
  for (const sx of [1, -1]) k.add(new THREE.ConeGeometry(0.009, 0.034, 5).rotateZ(-sx * Math.PI / 2).translate(sx * 0.062, 0.043, 0), { color: 0x2e2c2a, mat: 'metal_dark' });
  const wg = wrapGeo(0.0155, -0.1, 0.035, { rings: 12, seg: 7, turns: 4, ridge: 0.2 });
  k.add(wg.geo, { color: 0x1c1816, mat: 'leather_worn', colorFn: wrapColor(wg.ph, 0x2a2420, 0x100e0c, seed) });
  k.add(lathe([[0, -0.152], [0.006, -0.15], [0.018, -0.13], [0.02, -0.112], [0.015, -0.098], [0.0, -0.098]], 7), { color: 0x2e2c2a, mat: 'metal_dark' });
  return withTip(k.mesh('falchion'), 0.05 + L);
}

/** Legolas' pair of white knives: long sabre-curved leaf blades with a fuller, swept leaf-wing guard,
 *  an ivory handle and a leaf-bud pommel (sheet: elven_knives, 0.65 m each; odd seeds curve the other way) */
function elvenKnife(seed: number, style: WeaponStyle = 'default'): THREE.Object3D {
  const k = new Kit();
  const brass = style === 'elven';
  const s = seed & 1 ? 1 : -1;
  const L = 0.42;
  const hw = (t: number) => 0.0155 + 0.0085 * Math.sin(Math.min(1, t * 2.4) * Math.PI * 0.5) - 0.012 * smooth(0.45, 1, t) - 0.003 * t;
  const sh: [number, number][] = [];
  for (let i = 0; i < 14; i++) sh.push([i / 13, hw(i / 13)]);
  const etch = noise2(seed + 9);
  k.add(
    blade({ len: L, width: 1, thick: 0.0045, shape: sh, curve: -0.062 * s, tip: 0.1, seed, bevel: 0.55 }),
    {
      color: 0xc0c4cc,
      mat: surface('metal', { rough: 0.22, metal: 0.82 }),
      colorFn: (p, n, c) => {
        steel(0xd2d7de, 0xf8fafc, 0.02)(p, n, c);
        // etched leaf work in the lower half of the blade, near the guard
        const f = Math.max(0, Math.sin((p.y - 0.05) * 140 + Math.abs(p.x - 0.0) * 260 * s)) * (1 - smooth(0.05, 0.28, p.y));
        c.multiplyScalar(1 - 0.16 * f * (0.6 + etch(p.y * 30, p.x * 90) * 0.4));
        if (Math.abs(n.z) > 0.9) c.multiplyScalar(0.93 + 0.1 * etch(p.y * 12, 1));
      },
    },
    new THREE.Matrix4().makeTranslation(0, 0.05, 0),
  );
  // swept leaf-wing guard: curves down toward the blade
  for (const sx of [1, -1]) {
    const sh2 = new THREE.Shape();
    sh2.moveTo(0, -0.006);
    sh2.bezierCurveTo(sx * 0.02, -0.013, sx * 0.05, -0.006, sx * 0.064, 0.04);
    sh2.bezierCurveTo(sx * 0.05, 0.02, sx * 0.022, 0.014, 0, 0.014);
    sh2.closePath();
    k.add(new THREE.ExtrudeGeometry(sh2, { depth: 0.007, bevelEnabled: true, bevelSize: 0.0014, bevelThickness: 0.0014, bevelSegments: 1, curveSegments: 5 }).translate(0, 0.04, -0.0035), { color: brass ? 0xb08a4a : 0xd2d6dc, mat: brass ? surface('gold', { rough: 0.38 }) : surface('metal', { rough: 0.22 }) });
  }
  k.add(lathe([[0, 0.03], [0.012, 0.034], [0.012, 0.048], [0.006, 0.058], [0, 0.058]], 8).scale(1.1, 1, 0.7), { color: brass ? 0xb08a4a : 0xd6dade, mat: brass ? 'gold' : 'metal' });
  // ivory handle (Tauriel's style 'elven': a brown leather-wrapped hilt with brass fittings) with a gentle swell and olive leaf etching
  const ivory = lin(0xe8e0cc), leaf = lin(0x8a8466);
  if (brass) {
    const wg = wrapGeo(0.0125, -0.115, 0.036, { rings: 14, seg: 7, turns: 7, ridge: 0.2 });
    k.add(wg.geo.scale(1, 1, 0.85), { color: 0x4a3222, mat: 'leather_worn', colorFn: wrapColor(wg.ph, 0x6a4830, 0x26180f, seed) });
  } else k.add(lathe([[0, -0.12], [0.0075, -0.118], [0.0115, -0.1], [0.0135, -0.06], [0.0125, -0.0], [0.0105, 0.02], [0.0125, 0.036], [0, 0.04]], 9).scale(1, 1, 0.82), {
    color: 0xe8e0cc,
    mat: surface('bone', { rough: 0.45 }),
    colorFn: (p, _n, c) => {
      const th = Math.atan2(p.z, p.x);
      const lf = Math.max(0, Math.sin(th * 2 + p.y * 62)) * smooth(0.55, 0.9, Math.sin(p.y * 22 + th));
      c.copy(ivory).multiplyScalar(0.92 + 0.12 * etch(p.y * 20, th));
      c.lerp(leaf, lf * 0.3);
    },
  });
  // leaf-bud pommel
  k.add(lathe([[0, -0.182], [0.004, -0.175], [0.011, -0.15], [0.0135, -0.132], [0.01, -0.12], [0, -0.118]], 8).scale(1, 1, 0.8), { color: brass ? 0xb08a4a : 0xd0d4da, mat: brass ? 'gold' : 'metal' });
  return withTip(k.mesh('elven_knife'), 0.05 + L);
}

/** curved blades: 'scimitar' (the orc sabre: a rusted recurved blade, curled quillons, long wrapped
 *  grip, hooked pommel; styles other than 'orc' are cleaner brass-hilted steel) and the crude orc
 *  'cleaver' (a wide notched plate with a slanted point, a hole and a long wrapped haft) */
function curvedBlade(kind: 'scimitar' | 'cleaver', seed: number, style: WeaponStyle = 'default'): THREE.Object3D {
  const k = new Kit();
  const orc = style === 'orc' || style === 'uruk';
  if (kind === 'scimitar') {
    const L = 0.68;
    // the belly (edge) bulges to -X, the tip swings back toward the guard line
    const hwf = (t: number) => 0.019 + 0.027 * Math.sin(Math.min(1, t * 1.7) * Math.PI * 0.5) - 0.034 * smooth(0.6, 1, t);
    const cxf = (t: number) => 0.088 * Math.sin(Math.PI * Math.pow(t, 0.92)) - 0.02 * t;
    const st: [number, number, number][] = [];
    for (let i = 0; i < 20; i++) {
      const t = i / 19;
      st.push([t, Math.max(0.004, hwf(t)), cxf(t)]);
    }
    k.add(
      blade({ len: L, width: 1, thick: 0.0052, single: true, edge: -1, shape: st, tipX: -0.025, tip: 0.1, bevel: 0.32, seed, jag: orc ? 0.0034 : 0.0006 }),
      orc
        ? { color: 0x6a6866, mat: surface('metal_rusty', { rough: 0.62 }), colorFn: oxide(seed, 0x5c5c5a, 0x7c4a2a, 0xa8a49a, 0.5) }
        : { color: 0x9a9a98, mat: surface('metal', { rough: 0.3 }), colorFn: steel(0x80827f, 0xd0d2d0, 0.04, 0.12, seed) },
      new THREE.Matrix4().makeTranslation(0, 0.045, 0),
    );
    // curled S-quillons and the guard block
    const gc = orc ? 0x4a4642 : 0xa08048;
    const gm: SurfaceName = orc ? 'metal_dark' : 'gold';
    k.add(new THREE.BoxGeometry(0.03, 0.02, 0.024).translate(0, 0.036, 0), { color: gc, mat: gm });
    for (const sx of [1, -1]) {
      k.add(new THREE.CylinderGeometry(0.0075, 0.0105, 0.075, 5).rotateZ(Math.PI / 2).translate(sx * 0.055, 0.036, 0), { color: gc, mat: gm });
      k.add(new THREE.TorusGeometry(0.017, 0.0062, 4, 8, Math.PI * 1.4).rotateZ(sx > 0 ? 0.3 : Math.PI - 0.3).translate(sx * 0.095, 0.05, 0), { color: gc, mat: gm });
    }
    const wg = wrapGeo(0.0145, -0.14, 0.03, { rings: 12, seg: 7, turns: 6, ridge: 0.2 });
    k.add(wg.geo, { color: 0x4a3322, mat: 'leather_worn', colorFn: wrapColor(wg.ph, 0x5c4028, 0x24180f, seed) });
    // hooked pommel
    k.add(lathe([[0, -0.2], [0.008, -0.195], [0.017, -0.17], [0.019, -0.148], [0.015, -0.138], [0, -0.138]], 7), { color: gc, mat: gm });
    k.add(new THREE.ConeGeometry(0.01, 0.045, 5).rotateZ(0.7).translate(0.012, -0.205, 0), { color: gc, mat: gm });
    return withTip(k.mesh(kind), 0.045 + L);
  }
  // crude orc cleaver
  const L = 0.56;
  const hw = 0.088;
  // spine on -X, cutting edge (with the saw teeth) on +X; the point is cut slanted toward the edge
  const l = (t: number) => -hw + 0.02 * t + (t > 0.83 ? (t - 0.83) / 0.17 * 0.1 : 0);
  const r = (t: number) => hw + 0.004 * Math.sin(t * 9);
  k.add(
    blade({ len: L, width: 1, thick: 0.0075, single: true, edge: -1, shape: edgeStations(20, l, r), tipX: hw * 0.8, tip: 0.04, bevel: 0.22, jag: 0.011, seed }),
    {
      color: 0x6a4a36,
      mat: surface('metal_rusty', { rough: 0.7 }),
      colorFn: (p, n, c) => {
        oxide(seed, 0x6a5444, 0xa0562a, 0x9a9488, 0.42, 1.3)(p, n, c);
        // the hole near the heel
        const d = Math.hypot(p.x - 0.0, p.y - 0.17);
        if (d < 0.016) c.setRGB(0.012, 0.01, 0.009);
        else if (d < 0.022) c.multiplyScalar(0.55);
      },
    },
    new THREE.Matrix4().makeTranslation(0, 0.1, 0),
  );
  const wg = wrapGeo(0.0235, -0.15, 0.115, { rings: 11, seg: 7, turns: 7, ridge: 0.2 });
  k.add(wg.geo, { color: 0x4a3322, mat: 'leather_worn', colorFn: wrapColor(wg.ph, 0x6a4630, 0x2c1c12, seed) });
  k.add(band(0.0255, 0.108, 0.022, 7), { color: 0x4a3c34, mat: 'metal_rusty' });
  k.add(band(0.0255, -0.155, 0.024, 7), { color: 0x4a3c34, mat: 'metal_rusty' });
  k.add(lathe([[0, -0.19], [0.016, -0.186], [0.025, -0.168], [0.024, -0.15], [0.0, -0.148]], 7), { color: 0x4a3c34, mat: 'metal_rusty' });
  return withTip(k.mesh(kind), 0.1 + L);
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
    for (let h = 0; h < heads.length; h++) {
      const gi = heads[h].index ? heads[h].toNonIndexed() : heads[h];
      const pa = gi.attributes.position.array as Float32Array;
      const na = gi.attributes.normal.array as Float32Array;
      if (h === 1) {
        // the mirrored bit (scale -1) keeps its triangle order, which turns it inside out: swap
        // the 2nd and 3rd vertex of every triangle so it faces outward like the first one
        for (let t = 0; t + 8 < pa.length; t += 9) {
          for (let c = 0; c < 3; c++) {
            const a = pa[t + 3 + c];
            pa[t + 3 + c] = pa[t + 6 + c];
            pa[t + 6 + c] = a;
            const b = na[t + 3 + c];
            na[t + 3 + c] = na[t + 6 + c];
            na[t + 6 + c] = b;
          }
        }
      }
      pos.push(...pa);
      nor.push(...na);
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

/** Gimli's double-bitted axe: wide flared crescent bits with a triangular cut-out and bronze knotwork
 *  inlay, a bronze socket and collars, a dark haft over a cord-wrapped grip and a faceted bronze
 *  pommel (sheet: gimli_axe, 1.15 m, bits 0.6 m across) */
function gimliAxe(seed: number): THREE.Object3D {
  const root = new THREE.Group();
  root.name = 'dwarf_axe';
  const k = new Kit();
  const BRONZE = surface('gold', { rough: 0.5, metal: 0.8 });
  const bz = lin(0x7a5a2c), bzd = lin(0x3a2812);
  const n2 = noise2(seed + 31);
  const bronze = (p: THREE.Vector3, _n: THREE.Vector3, c: THREE.Color) => {
    c.copy(bz).lerp(bzd, smooth(0.2, 0.9, n2(p.x * 60 + p.z * 20, p.y * 60) * 0.5 + 0.5) * 0.5);
  };
  // dark haft above the grip, cord-wrapped grip below
  k.add(lathe([[0.0, -0.36], [0.019, -0.355], [0.0185, -0.2], [0.0175, 0.1], [0.018, 0.5], [0.0, 0.52]], 8), { color: 0x4a2a1a, mat: surface('wood', { rough: 0.55 }), colorFn: woodColor(0x4e2c1c, seed) });
  const g1 = wrapGeo(0.0205, -0.34, 0.02, { rings: 28, seg: 8, turns: 9, ridge: 0.26 });
  k.add(g1.geo, { color: 0x3a2a1c, mat: 'leather_worn', colorFn: wrapColor(g1.ph, 0x6a4c30, 0x1c120a, seed) });
  const g2 = wrapGeo(0.0215, -0.33, 0.01, { rings: 28, seg: 8, turns: -9, ridge: 0.2 });
  k.add(g2.geo, { color: 0x3a2a1c, mat: 'leather_worn', colorFn: wrapColor(g2.ph, 0x5a4028, 0x1c120a, seed + 1) });
  // bronze collars (upper and lower) with a diamond band, and the pommel
  for (const [y, h] of [[0.03, 0.03], [0.065, 0.045], [0.335, 0.05]] as [number, number][]) k.add(band(0.0235, y, h, 8), { color: 0x8a6a34, mat: BRONZE, colorFn: bronze });
  k.add(lathe([[0, -0.425], [0.02, -0.418], [0.036, -0.39], [0.037, -0.365], [0.026, -0.345], [0.0, -0.343]], 8), { color: 0x8a6a34, mat: BRONZE, colorFn: bronze });
  // socket block holding the bits
  k.add(new THREE.BoxGeometry(0.075, 0.27, 0.075).translate(0, 0.49, 0), { color: 0x8a6a34, mat: BRONZE, colorFn: (p, n, c) => {
    bronze(p, n, c);
    // dark knotwork bands
    const band2 = Math.abs(Math.sin(p.y * 90)) > 0.93;
    if (band2) c.multiplyScalar(0.55);
  } });
  for (const y of [0.365, 0.615]) k.add(new THREE.BoxGeometry(0.095, 0.03, 0.095).translate(0, y, 0), { color: 0x7a5a2c, mat: BRONZE, colorFn: bronze });
  // the two bits: crescent steel with horns and a triangular cut-out
  const bit = (sx: number) => {
    const sh = new THREE.Shape();
    const X = (x: number) => x * sx;
    sh.moveTo(X(0.035), 0.1);
    sh.quadraticCurveTo(X(0.11), 0.125, X(0.17), 0.175);
    sh.quadraticCurveTo(X(0.24), 0.215, X(0.295), 0.255);
    sh.bezierCurveTo(X(0.4), 0.14, X(0.4), -0.12, X(0.3), -0.245);
    sh.quadraticCurveTo(X(0.2), -0.18, X(0.14), -0.13);
    sh.quadraticCurveTo(X(0.09), -0.115, X(0.035), -0.1);
    sh.closePath();
    const hole = new THREE.Path();
    hole.moveTo(X(0.085), 0.03);
    hole.lineTo(X(0.2), 0.065);
    hole.lineTo(X(0.2), -0.07);
    hole.lineTo(X(0.12), -0.07);
    hole.closePath();
    sh.holes.push(hole);
    return new THREE.ExtrudeGeometry(sh, { depth: 0.022, bevelEnabled: true, bevelThickness: 0.008, bevelSize: 0.007, bevelSegments: 2, curveSegments: 7 }).translate(0, 0, -0.011);
  };
  const toNonIndexed = (g: THREE.BufferGeometry, flip: boolean) => {
    const gi = g.index ? g.toNonIndexed() : g;
    const pa = gi.attributes.position.array as Float32Array;
    const na = gi.attributes.normal.array as Float32Array;
    if (flip) {
      for (let t = 0; t + 8 < pa.length; t += 9)
        for (let c = 0; c < 3; c++) {
          const a = pa[t + 3 + c];
          pa[t + 3 + c] = pa[t + 6 + c];
          pa[t + 6 + c] = a;
          const b = na[t + 3 + c];
          na[t + 3 + c] = na[t + 6 + c];
          na[t + 6 + c] = b;
        }
    }
    return { pa, na };
  };
  const pos: number[] = [], nor: number[] = [];
  for (const sx of [1, -1]) {
    // building the shape already mirrored yields the right winding after ExtrudeGeometry's own check
    const { pa, na } = toNonIndexed(bit(sx), false);
    pos.push(...pa);
    nor.push(...na);
  }
  const mergedHead = new THREE.BufferGeometry();
  mergedHead.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  mergedHead.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  const uvs = new Float32Array((pos.length / 3) * 2);
  for (let i = 0; i < pos.length / 3; i++) {
    uvs[i * 2] = pos[i * 3] * 6 + 0.5;
    uvs[i * 2 + 1] = pos[i * 3 + 1] * 6 + 0.5;
  }
  mergedHead.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  mergedHead.translate(0, 0.49, 0);
  const tex = knotwork();
  const headMat = new THREE.MeshStandardMaterial({
    color: 0x9a948a,
    map: tex.color,
    metalness: 1,
    roughness: 1,
    roughnessMap: tex.rough,
    normalMap: tex.normal,
    normalScale: new THREE.Vector2(0.7, 0.7),
    side: THREE.DoubleSide,
  });
  const head = new THREE.Mesh(mergedHead, headMat);
  head.name = 'dwarf_axe_head';
  head.castShadow = true;
  // bronze knotwork panels where the bits meet the socket
  for (const sx of [1, -1]) {
    k.add(new THREE.BoxGeometry(0.075, 0.2, 0.036).translate(sx * 0.0745, 0.49, 0), { color: 0x7a5a2c, mat: BRONZE, colorFn: (p, n, c) => {
      bronze(p, n, c);
      const dd = Math.abs(((p.x * sx * 70 + p.y * 50) % 1 + 1) % 1 - 0.5);
      const dd2 = Math.abs(((p.x * sx * 70 - p.y * 50) % 1 + 1) % 1 - 0.5);
      if (dd < 0.1 || dd2 < 0.1) c.multiplyScalar(0.5);
    } });
  }
  root.add(k.mesh('dwarf_axe_haft'));
  root.add(head);
  return withTip(root, 0.74);
}

function polearm(kind: 'pike' | 'spear', seed: number): THREE.Object3D {
  const k = new Kit();
  const pike = kind === 'pike';
  const y0 = pike ? -0.75 : -0.6;
  const y1 = pike ? 1.9 : 1.4;
  const HL = pike ? 0.34 : 0.26;
  haft(k, y0, y1, pike ? 0.0185 : 0.016, pike ? 0x4a382c : 0x5a4430);
  // leaf head: a mid-rib, widest above the socket, and a dark iron socket with langets down the haft
  const hw = pike ? 0.034 : 0.026;
  k.add(blade({ len: HL, width: hw, thick: 0.0075, shape: [[0, 0.3], [0.12, 0.85], [0.3, 1], [0.6, 0.74], [0.85, 0.36], [1, 0.1]], rings: 6, seed, tip: 0.1, bevel: 0.7 }), { color: 0x8a8884, mat: pike ? surface('metal_dark', { rough: 0.45, pat: { pores: 0.6 } }) : 'metal', colorFn: oxide(seed, 0x6c6c6a, 0x6e4a32, 0xb8b8b4, pike ? 0.2 : 0.08, 1.4) }, new THREE.Matrix4().makeTranslation(0, y1, 0));
  k.add(lathe([[0.0185, y1 - 0.09], [0.026, y1 - 0.075], [0.019, y1 + 0.02], [0.0, y1 + 0.022]], 6), { color: 0x4c4a48, mat: 'metal_dark' });
  if (pike) {
    k.add(lathe([[0.0, y0 - 0.03], [0.02, y0 + 0.006], [0.0195, y0 + 0.05], [0.0, y0 + 0.052]], 5), { color: 0x4a4846, mat: 'metal_dark' });
  }
  return withTip(k.mesh(kind), y1 + HL);
}


/** orc morning star (Bolg, Gundabad): a long leather-wrapped haft with iron bands, a studded collar
 *  and a hammered cuboid head carrying pyramid spikes on every face, spiked corners and a long
 *  point (sheet: bolg_mace, 1.5 m; Bolg's hand socket scales it 1.7 / 1.55 / 1.7) */
function morningStar(seed: number): THREE.Object3D {
  const k = new Kit();
  const rnd = new Rng(seed + 17);
  const RUST = surface('iron_rusty', { rough: 0.62 });
  const ironC = lin(0x6a625a), rustC = lin(0x7c4a2c);
  const n2 = noise2(seed + 5);
  const iron = (hi = 0.34): ((p: THREE.Vector3, n: THREE.Vector3, c: THREE.Color) => void) => (p, _n, c) => {
    const f = n2(p.x * 38 + p.z * 21, p.y * 30 + p.z * 17) * 0.5 + 0.5;
    c.copy(ironC).lerp(rustC, smooth(0.55, 0.95, f) * hi * 2.2).multiplyScalar(0.8 + 0.4 * n2(p.x * 120, p.y * 90 + p.z * 40));
  };
  // haft: dark wood core, wrapped leather, iron bands
  k.add(lathe([[0.0, -0.215], [0.02, -0.21], [0.02, -0.19], [0.0165, -0.17], [0.0165, 0.355], [0.0, 0.365]], 8), { color: 0x3a2a1e, mat: 'wood', colorFn: woodColor(0x3a2a1e, seed) });
  const wg = wrapGeo(0.0185, -0.14, 0.305, { rings: 26, seg: 8, turns: 14, ridge: 0.16 });
  k.add(wg.geo, { color: 0x3a2616, mat: 'leather_worn', colorFn: wrapColor(wg.ph, 0x543a26, 0x1c120a, seed) });
  for (const [y, h] of [[-0.205, 0.04], [-0.12, 0.016], [0.295, 0.022]] as [number, number][]) k.add(band(0.0215, y, h, 8), { color: 0x5a4a3c, mat: RUST, colorFn: iron(0.5) });
  // butt cap with a knob
  k.add(lathe([[0, -0.26], [0.01, -0.255], [0.02, -0.235], [0.022, -0.215], [0.0, -0.213]], 7), { color: 0x5a4a3c, mat: RUST, colorFn: iron(0.5) });
  // collar: stepped flange with rivets
  k.add(lathe([[0.019, 0.325], [0.034, 0.331], [0.04, 0.345], [0.036, 0.365], [0.045, 0.38], [0.0, 0.385]], 9), { color: 0x54402f, mat: RUST, colorFn: iron(0.45) });
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    k.add(new THREE.SphereGeometry(0.0065, 4, 3).translate(Math.cos(a) * 0.04, 0.347, Math.sin(a) * 0.04), { color: 0x7a7060, mat: 'metal_dark' });
  }
  // the head: a chamfered, hammered iron block
  const Y = 0.48, H = 0.088;
  const box = new THREE.BoxGeometry(H * 2, H * 2, H * 2, 2, 2, 2);
  const bp = box.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < bp.count; i++) {
    const x = bp.getX(i), y = bp.getY(i), z = bp.getZ(i);
    // pull the corners in (chamfer) and dent the faces a little
    const m = Math.max(Math.abs(x), Math.abs(y), Math.abs(z)) / H;
    const s = 1 - 0.1 * Math.max(0, Math.abs(x) / H + Math.abs(y) / H + Math.abs(z) / H - 2);
    const d = 1 + 0.03 * Math.sin(x * 90 + y * 70 + z * 50 + seed) * m;
    bp.setXYZ(i, x * s * d, y * s * d, z * s * d);
  }
  box.computeVertexNormals();
  k.add(box.translate(0, Y, 0), { color: 0x5e5a54, mat: RUST, colorFn: iron(0.5) });
  // pyramid spikes: one on every face, a small one on each corner, and a long point
  const faces: [number, number, number][] = [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, -1, 0]];
  const up = new THREE.Vector3(0, 1, 0);
  const place = (dir: THREE.Vector3, dist: number, geo: THREE.BufferGeometry, col: number) => {
    const q = new THREE.Quaternion().setFromUnitVectors(up, dir.clone().normalize());
    const m = new THREE.Matrix4().makeRotationFromQuaternion(q).setPosition(dir.clone().normalize().multiplyScalar(dist).add(new THREE.Vector3(0, Y, 0)));
    k.add(geo, { color: col, mat: RUST, colorFn: iron(0.6) }, m);
  };
  for (const f of faces) place(new THREE.Vector3(...f), H * 0.9, new THREE.ConeGeometry(0.036, 0.062 + rnd.range(-0.004, 0.006), 4).translate(0, 0.031, 0).rotateY(Math.PI / 4), 0x6a5a4a);
  for (const sx of [1, -1]) for (const sy of [1, -1]) for (const sz of [1, -1]) {
    place(new THREE.Vector3(sx, sy * 0.9, sz), H * 1.4, new THREE.ConeGeometry(0.024, 0.065 + rnd.range(-0.005, 0.01), 4).translate(0, 0.025, 0).rotateY(Math.PI / 4), 0x6a5a4a);
  }
  place(up, H * 0.9, new THREE.ConeGeometry(0.028, 0.15, 5).translate(0, 0.075, 0), 0x6a5a4a);
  return withTip(k.mesh('mace'), Y + H + 0.15);
}

/** cave-troll club (and the orcs' smaller one): a gnarled, burled log with a bulbous head clamped by
 *  two riveted iron bands, a cord-wrapped grip and a knob at the end (sheet: cave_troll_club, 2.7 m held
 *  by a 2.5x hand socket, so ~1.08 m here). Other styles are the same club at 0.72 scale. */
function club(seed: number, style: WeaponStyle): THREE.Object3D {
  const k = new Kit();
  const sc = style === 'default' ? 1 : 0.72;
  const rnd = new Rng(seed + 3);
  const n2 = noise2(seed + 11);
  const prof = (y: number): number => {
    // radius along the log: knob, neck, slim cord-wrapped grip, swelling to a bulbous burl head
    const pts: [number, number][] = [[-0.24, 0.0], [-0.235, 0.046], [-0.2, 0.062], [-0.165, 0.038], [-0.12, 0.03], [0.0, 0.034], [0.2, 0.05], [0.4, 0.085], [0.55, 0.125], [0.68, 0.165], [0.78, 0.172], [0.84, 0.14], [0.862, 0.07], [0.87, 0.0]];
    for (let i = 0; i + 1 < pts.length; i++) {
      if (y <= pts[i + 1][0]) {
        const t = (y - pts[i][0]) / (pts[i + 1][0] - pts[i][0]);
        return pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t;
      }
    }
    return 0;
  };
  const rings = 26, seg = 11;
  const pos: number[] = [], idx: number[] = [];
  const lump = (y: number, th: number) => {
    const c = Math.cos(th), s = Math.sin(th);
    const head = smooth(0.35, 0.7, y);
    return 1 + (0.12 + 0.2 * head) * n2(c * 1.5 + y * 2.4, s * 1.5 + y * 1.9) + 0.07 * n2(c * 4 + y * 9, s * 4 - y * 7) * (0.4 + head);
  };
  for (let i = 0; i <= rings; i++) {
    const y = -0.24 + (i / rings) * 1.11;
    for (let j = 0; j < seg; j++) {
      const th = (j / seg) * Math.PI * 2;
      const r = Math.max(0.004, prof(y)) * lump(y, th);
      pos.push(Math.cos(th) * r, y, Math.sin(th) * r);
    }
  }
  for (let i = 0; i < rings; i++)
    for (let j = 0; j < seg; j++) {
      const a = i * seg + j, b = i * seg + ((j + 1) % seg), c = a + seg, d = b + seg;
      idx.push(a, b, c, b, d, c);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const woodA = lin(0x62381f), woodB = lin(0x36200f), char = lin(0x1c130d), pale = lin(0x7c5030);
  k.add(g, {
    color: 0x6a4228,
    mat: surface('wood', { rough: 0.86, pat: { wrinkles: 1.1, fur: 1.2 } }),
    colorFn: (p, _n, c) => {
      const th = Math.atan2(p.z, p.x);
      const f = n2(Math.cos(th) * 3 + p.y * 5, Math.sin(th) * 3) * 0.5 + 0.5;
      const grain = n2(Math.cos(th) * 12, p.y * 3.2 + Math.sin(th) * 12) * 0.5 + 0.5;
      c.copy(woodB).lerp(woodA, 0.3 + 0.7 * f).lerp(pale, smooth(0.62, 0.9, grain) * 0.4);
      c.lerp(char, smooth(0.78, 1.0, f) * 0.5 + smooth(0.8, 0.88, p.y) * 0.3);
    },
  });
  // burls: a few knobs on the head
  for (let i = 0; i < 4; i++) {
    const th = rnd.range(0, Math.PI * 2), y = rnd.range(0.62, 0.84), rr = prof(y) * 1.12;
    const kn = new THREE.IcosahedronGeometry(rnd.range(0.035, 0.06), 1).scale(1, rnd.range(0.7, 1), 1);
    k.add(kn.translate(Math.cos(th) * rr, y, Math.sin(th) * rr), { color: 0x6a4228, mat: surface('wood', { rough: 0.9, pat: { wrinkles: 1.1 } }), colorFn: woodColor(0x6a4228, seed + i) });
  }
  // riveted iron bands clamping the head
  for (const [y, h] of [[0.5, 0.045], [0.66, 0.05]] as [number, number][]) {
    const r = prof(y) * 1.25 + 0.006;
    k.add(lathe([[r * 0.95, y - h * 0.6], [r, y - h * 0.5], [r, y + h * 0.5], [r * 0.95, y + h * 0.6]], 14), { color: 0x4a4440, mat: surface('iron_rusty', { rough: 0.6 }), colorFn: oxide(seed + 2, 0x4c4642, 0x7a4a2c, 0x8a8680, 0.5) });
    for (let i = 0; i < 7; i++) {
      const th = (i / 7) * Math.PI * 2 + y * 3;
      k.add(new THREE.SphereGeometry(0.011, 5, 3).translate(Math.cos(th) * r, y, Math.sin(th) * r), { color: 0x8a847a, mat: 'metal_dark' });
    }
  }
  // cord-wrapped grip: the wrap crosses twice
  const wg = wrapGeo(0.037, -0.13, 0.19, { rings: 18, seg: 8, turns: 7, ridge: 0.28, strands: 1 });
  k.add(wg.geo, { color: 0x4a3524, mat: 'leather_worn', colorFn: wrapColor(wg.ph, 0x6a5038, 0x2a1c12, seed) });
  const wg2 = wrapGeo(0.0385, -0.12, 0.18, { rings: 18, seg: 8, turns: -7, ridge: 0.2, strands: 1 });
  k.add(wg2.geo, { color: 0x4a3524, mat: 'leather_worn', colorFn: wrapColor(wg2.ph, 0x5a4430, 0x24170e, seed + 1) });
  const m = k.mesh('club');
  if (sc !== 1) m.geometry.scale(sc, sc, sc);
  return withTip(m, 0.87 * sc);
}

/** heavy war hammer: a riveted slab head of two iron blocks clamped by bands, pyramid spikes on the
 *  faces and spiked ends, a thick iron-banded haft and a spiked butt (sheet: war_hammer, 2.5 m held by
 *  a 2.5x hand socket, so ~1.0 m here). Other styles are a 0.72 scale version for human-sized hands. */
function warhammer(seed: number, style: WeaponStyle): THREE.Object3D {
  const k = new Kit();
  const sc = style === 'default' ? 1 : 0.72;
  const RUST = surface('iron_rusty', { rough: 0.58, pat: { scales: -0.5 } });
  const n2 = noise2(seed + 21);
  const ironC = lin(0x403d39), rustC = lin(0x74462a), dark = lin(0x242220);
  const iron = (rust = 0.3) => (p: THREE.Vector3, n: THREE.Vector3, c: THREE.Color) => {
    const f = n2(p.x * 24 + p.z * 13, p.y * 22 + p.z * 11) * 0.5 + 0.5;
    c.copy(ironC).lerp(rustC, smooth(0.55, 0.95, f) * rust * 2).multiplyScalar(0.78 + 0.4 * n2(p.x * 90 + p.y * 40, p.y * 70 + p.z * 50));
    c.lerp(dark, smooth(0.6, 1, Math.abs(n.y)) * 0.1);
  };
  const Y = 0.625;
  // slab head: two blocks, central strap band, end plates with bevel
  const blk = (w: number, x: number) => {
    const g = new THREE.BoxGeometry(w, 0.31, 0.27, 3, 3, 3);
    const p = g.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      const sx = p.getX(i), sy = p.getY(i), sz = p.getZ(i);
      const e = Math.max(0, Math.abs(sy) / 0.155 + Math.abs(sz) / 0.135 - 1.4) * 0.02;
      p.setXYZ(i, sx, sy * (1 - e * 2), sz * (1 - e * 2) + 0.004 * Math.sin(sx * 120 + sy * 80 + seed));
    }
    g.computeVertexNormals();
    return g.translate(x, Y, 0);
  };
  k.add(blk(0.29, -0.16), { color: 0x6f6a62, mat: RUST, colorFn: iron(0.3) });
  k.add(blk(0.29, 0.16), { color: 0x6f6a62, mat: RUST, colorFn: iron(0.3) });
  // central clamp band + end bands (darker, with rivets)
  for (const x of [0, -0.3, 0.3]) {
    k.add(new THREE.BoxGeometry(x === 0 ? 0.07 : 0.035, 0.335, 0.295).translate(x, Y, 0), { color: 0x4c4742, mat: RUST, colorFn: iron(0.45) });
    for (const sz of [1, -1]) for (let i = 0; i < 4; i++) k.add(new THREE.SphereGeometry(0.0125, 5, 3).translate(x, Y - 0.115 + i * 0.077, sz * 0.15), { color: 0x9a9488, mat: 'metal_dark' });
  }
  // pyramid spikes: four on each broad face, big spikes on both ends
  for (const sz of [1, -1]) for (const [x, y] of [[-0.19, 0.06], [-0.19, -0.08], [0.19, 0.06], [0.19, -0.08]]) {
    k.add(new THREE.ConeGeometry(0.036, 0.07, 4).translate(0, 0.035, 0).rotateY(Math.PI / 4).rotateX(sz * Math.PI / 2).translate(x, Y + y, sz * 0.135), { color: 0x8a8478, mat: RUST, colorFn: iron(0.2) });
  }
  for (const sx of [1, -1]) for (const [y, z] of [[0.08, 0.07], [-0.08, 0.07], [0.08, -0.07], [-0.08, -0.07]])
    k.add(new THREE.ConeGeometry(0.03, 0.1, 4).translate(0, 0.05, 0).rotateY(Math.PI / 4).rotateZ(-sx * Math.PI / 2).translate(sx * 0.318, Y + y, z), { color: 0x8a8478, mat: RUST, colorFn: iron(0.2) });
  // haft: thick wood under iron-strapped wraps
  k.add(lathe([[0.0, -0.14], [0.034, -0.135], [0.03, -0.1], [0.034, 0.42], [0.036, 0.52]], 9), { color: 0x4a3426, mat: 'wood', colorFn: woodColor(0x4a3426, seed) });
  const wg = wrapGeo(0.0375, -0.05, 0.46, { rings: 28, seg: 9, turns: 10, ridge: 0.24 });
  k.add(wg.geo, { color: 0x4a4440, mat: RUST, colorFn: (p, n, c) => {
    wrapColor(wg.ph, 0x6a645c, 0x24201c, seed)(p, n, c);
    c.lerp(rustC, smooth(0.5, 1, n2(p.y * 14, Math.atan2(p.z, p.x) * 2) * 0.5 + 0.5) * 0.35);
  } });
  for (const y of [-0.06, 0.14, 0.3, 0.46]) {
    k.add(band(0.04, y, 0.03, 9), { color: 0x4c4742, mat: RUST, colorFn: iron(0.4) });
    for (let i = 0; i < 6; i++) {
      const th = (i / 6) * Math.PI * 2 + y * 5;
      k.add(new THREE.SphereGeometry(0.0085, 4, 3).translate(Math.cos(th) * 0.043, y, Math.sin(th) * 0.043), { color: 0x9a9488, mat: 'metal_dark' });
    }
  }
  // butt: a studded ferrule ending in a spike
  k.add(lathe([[0.0, -0.215], [0.012, -0.2], [0.03, -0.15], [0.05, -0.12], [0.058, -0.1], [0.04, -0.075], [0.0, -0.075]], 9), { color: 0x5a554e, mat: RUST, colorFn: iron(0.35) });
  const m = k.mesh('warhammer');
  if (sc !== 1) m.geometry.scale(sc, sc, sc);
  return withTip(m, (Y + 0.185) * sc);
}


function blunt(kind: 'mace' | 'club' | 'warhammer', seed: number, style: WeaponStyle = 'default'): THREE.Object3D {
  if (kind === 'mace' && style === 'orc') return morningStar(seed);
  if (kind === 'club') return club(seed, style);
  if (kind === 'warhammer') return warhammer(seed, style);
  const k = new Kit();
  haft(k, -0.2, 0.6, 0.016, 0x3e2e22, 0x2a2018);
  const y = 0.62;
  k.add(new THREE.SphereGeometry(0.035, 10, 8).translate(0, y, 0), { color: 0x6a6660, mat: 'metal_dark' });
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    k.add(new THREE.BoxGeometry(0.008, 0.09, 0.035).translate(0, 0, 0.03).applyMatrix4(new THREE.Matrix4().makeRotationY(a)).translate(0, y, 0), { color: 0x7a7670, mat: 'metal_dark' });
  }
  return withTip(k.mesh(kind), 0.68);
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
  // prod across the front: bow limbs (±Y) → crossbow ±X (horizontal in a hand: the hand socket's
  // X is T × L), bow arrow (+Z) → +Y (along the stock), bow string (−Z) → toward the stock (−Y)
  bow.rotation.set(-Math.PI / 2, Math.PI / 2, 0, 'YXZ');
  bow.position.set(0, 0.46, 0.04);
  root.add(bow);
  root.userData.bow = bow.userData.bow;
  return withTip(root, 0.5);
}

function torch(seed: number): THREE.Object3D {
  const k = new Kit();
  const n2 = noise2(seed + 4);
  // tapering haft with a knob foot and a rough iron band
  k.add(lathe([[0.0, -0.285], [0.02, -0.28], [0.03, -0.26], [0.032, -0.235], [0.021, -0.205], [0.0205, 0.0], [0.028, 0.3], [0.0, 0.31]], 7), {
    color: 0x5a3c26,
    mat: surface('wood', { rough: 0.82 }),
    colorFn: (p, n, c) => {
      woodColor(0x5a3c26, seed)(p, n, c);
      c.multiplyScalar(0.9 + 0.2 * n2(Math.atan2(p.z, p.x) * 2, p.y * 8));
    },
  });
  k.add(band(0.031, 0.305, 0.034, 7), { color: 0x3c3834, mat: 'metal_rusty' });
  // burlap-wrapped, pitch-soaked head: bound strips with frayed ends
  const head = lathe([[0.026, 0.3], [0.05, 0.322], [0.066, 0.37], [0.064, 0.425], [0.04, 0.47], [0.0, 0.49]], 8);
  const p = head.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const th = Math.atan2(z, x);
    const kk = 1 + 0.1 * n2(Math.cos(th) * 2.4 + y * 20, Math.sin(th) * 2.4) + 0.05 * Math.sin(th * 3 + y * 60);
    p.setXYZ(i, x * kk, y, z * kk);
  }
  head.computeVertexNormals();
  const burlap = lin(0x7a5c34), pitch = lin(0x1c1612), ember = lin(0x4a1c06);
  k.add(head, {
    color: 0x7a5c34,
    mat: surface('rags', { rough: 0.98 }),
    colorFn: (q, _n, c) => {
      const th = Math.atan2(q.z, q.x);
      const strip = 0.5 + 0.5 * Math.sin(th * 2 + q.y * 70);
      c.copy(burlap).multiplyScalar(0.6 + 0.6 * smooth(0.2, 0.8, strip) + 0.2 * n2(q.y * 90, th * 6));
      c.lerp(pitch, smooth(0.36, 0.5, 0.8 - Math.abs(q.y - 0.36) * 5 * 0.4) * 0.18 + smooth(0.43, 0.48, q.y) * 0.6);
      c.lerp(ember, smooth(0.455, 0.48, q.y) * 0.5);
    },
  });
  // twine binding and fraying loose cloth tails
  k.add(new THREE.TorusGeometry(0.066, 0.004, 3, 8).rotateX(Math.PI / 2).translate(0, 0.39, 0), { color: 0x2a2018, mat: 'rags' });
  for (let i = 0; i < 3; i++) {
    const th = (i / 3) * Math.PI * 2 + 0.4;
    k.add(new THREE.ConeGeometry(0.011, 0.07, 3).rotateX(Math.PI).translate(Math.cos(th) * 0.064, 0.31, Math.sin(th) * 0.064), { color: 0x6a5030, mat: 'rags' });
  }
  const m = k.mesh('torch');
  const anchor = new THREE.Object3D();
  anchor.name = 'fireAnchor';
  anchor.position.set(0, 0.47, 0);
  m.add(anchor);
  m.userData.fireAnchor = anchor;
  return withTip(m, 0.49);
}


interface KiteDef {
  emblem: Emblem;
  W: number;
  top: number;
  bottom: number;
  /** half width (fraction of W) at v = 0 (point) .. 1 (top) */
  hw: (v: number) => number;
  /** top edge height at across a = -1..1 */
  topEdge: (a: number) => number;
  /** depth of the face bulge (m); a ridge puts a crisp fold down the middle */
  bulge: number;
  ridge: boolean;
}

/**
 * Kite shields: a curved plate (a grid sheet bent back at the edges), a swept rim, a back shell and
 * the grip. The face takes its paint from the emblem atlas (planar uv): 'gondor' black with the white
 * tree and a bright steel rim; 'uruk' notched black iron with Saruman's white hand and a dark rim.
 * The grip bar is at the origin and the face looks along +X (sheets: gondor_shield 1.15 m, uruk_shield 1.0 m).
 */
function kiteShield(seed: number, def: KiteDef): THREE.Object3D {
  const k = new Kit();
  const tree = def.emblem === 'gondor';
  ensureEmblem(def.emblem);
  const C = tree ? 8 : 10; // columns (even for a ridge)
  const R = 12;
  const X0 = 0.088;
  const surf = (a: number, v: number): [number, number, number] => {
    const hwv = def.hw(v) * def.W;
    const top = def.topEdge(a);
    const y = def.bottom + v * (top - def.bottom);
    const depth = def.bulge * (0.45 + 0.55 * v) * (def.ridge ? 1 - Math.abs(a) : 1 - a * a);
    return [X0 + depth, y, a * hwv];
  };
  // face sheet (one half-grid per side so a ridge stays crisp)
  const face = (a0: number, a1: number, cols: number) => {
    const pos: number[] = [], idx: number[] = [];
    for (let j = 0; j <= R; j++)
      for (let i = 0; i <= cols; i++) pos.push(...surf(a0 + ((a1 - a0) * i) / cols, j / R));
    for (let j = 0; j < R; j++)
      for (let i = 0; i < cols; i++) {
        const a = j * (cols + 1) + i, b = a + 1, c = a + cols + 1, d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  };
  const topMax = Math.max(def.topEdge(0), def.topEdge(1));
  const uv: UVFn = (p) => emblemUV(def.emblem, 1 - (p.z + def.W) / (2 * def.W), (p.y - def.bottom) / (topMax - def.bottom));
  const halves: [number, number][] = def.ridge ? [[-1, 0], [0, 1]] : [[-1, 1]];
  const faceMat = tree ? surface('metal_dark', { rough: 0.34, metal: 0.55 }) : surface('metal_rusty', { rough: 0.6, metal: 0.5 });
  for (const [a0, a1] of halves) k.add(face(a0, a1, def.ridge ? C / 2 : C), { color: 0xffffff, mat: faceMat }, undefined, uv);
  // back shell: a coarser, inset copy in dark wood / leather
  const back = (cols: number) => {
    const pos: number[] = [], idx: number[] = [];
    for (let j = 0; j <= 6; j++)
      for (let i = 0; i <= cols; i++) {
        const [x, y, z] = surf(-1 + (2 * i) / cols, (j / 6) * 0.995 + 0.003);
        pos.push(x - 0.022, y, z * 0.985);
      }
    for (let j = 0; j < 6; j++)
      for (let i = 0; i < cols; i++) {
        const a = j * (cols + 1) + i, b = a + 1, c = a + cols + 1, d = c + 1;
        idx.push(a, b, c, b, d, c);
      }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  };
  const n2 = noise2(seed + 3);
  k.add(back(4), { color: 0x3a2e22, mat: 'wood', colorFn: (p, n, c) => { woodColor(0x3a2e22, seed)(p, n, c); c.multiplyScalar(0.8 + 0.2 * n2(p.y * 10, p.z * 10)); } });
  // rim: a rolled edge swept around the outline
  const outline: THREE.Vector3[] = [];
  const push = (a: number, v: number) => {
    const [x, y, z] = surf(a, v);
    outline.push(new THREE.Vector3(x - 0.004, y, z * 1.012));
  };
  for (let j = 0; j <= R; j++) push(-1, j / R); // left edge up (from the point)
  for (let i = 1; i <= C * 2 - 1; i++) push(-1 + (2 * i) / (C * 2), 1);
  for (let j = R; j >= 0; j--) push(1, j / R);
  const curve = new THREE.CatmullRomCurve3(outline, false, 'catmullrom', 0.2);
  const rimGeo = new THREE.TubeGeometry(curve, 44, tree ? 0.0105 : 0.0125, 4, false);
  const rimColor = tree ? 0xcdd1d5 : 0x3a3834;
  k.add(rimGeo, tree
    ? { color: rimColor, mat: surface('metal', { rough: 0.3, metal: 0.65 }), colorFn: (p, n, c) => { c.copy(lin(rimColor)).multiplyScalar(0.85 + 0.25 * n2(p.y * 24, p.z * 24)); } }
    : { color: rimColor, mat: 'iron_rusty', colorFn: oxide(seed, 0x3c3a36, 0x6a4028, 0x6a665e, 0.4, 2) });
  // grip bar and strap behind
  k.add(new THREE.CylinderGeometry(0.014, 0.014, 0.13, 7), { color: 0x2a2018, mat: 'leather' });
  k.add(new THREE.BoxGeometry(0.03, 0.16, 0.03).translate(0.03, 0, 0), { color: 0x3a2e22, mat: 'wood' });
  return withTip(k.mesh('shield'), def.top);
}

const GONDOR_SHIELD: KiteDef = {
  emblem: 'gondor', W: 0.232, top: 0.43, bottom: -0.55,
  hw: (v) => Math.min(1, Math.pow(Math.max(0, v), 0.62) * 1.02),
  topEdge: (a) => 0.43 - 0.045 * Math.abs(a) ** 1.4,
  bulge: 0.062, ridge: false,
};
const URUK_SHIELD: KiteDef = {
  emblem: 'uruk', W: 0.245, top: 0.42, bottom: -0.58,
  hw: (v) => Math.min(1, Math.pow(Math.max(0, v), 0.75) * 1.04) * (1 - 0.1 * smooth(0.85, 1, v)),
  topEdge: (a) => 0.42 - 0.075 * Math.pow(1 - Math.abs(a), 1.5),
  bulge: 0.07, ridge: true,
};

function shield(seed: number, style: WeaponStyle = 'default'): THREE.Object3D {
  if (style === 'uruk') return kiteShield(seed, URUK_SHIELD);
  if (style === 'gondor') return kiteShield(seed, GONDOR_SHIELD);
  const k = new Kit();
  const R = style === 'dwarf' ? 0.36 : 0.45;
  const horse = style !== 'dwarf' && style !== 'easterling';
  if (horse) ensureEmblem('rohan');
  const X0 = 0.058;
  const green = lin(0x2e4a2a), gold = lin(0xb08a3a), red = lin(0x7a2a1a), wood = lin(0x6a4a2a);
  const n2 = noise2(seed);
  // front: a shallow dome, rings x segments grid (the atlas maps it planar)
  const RN = 7, SG = 36;
  const dome = (r: number) => X0 + 0.036 * (1 - Math.pow(r / R, 2.2)) + 0.0 * r;
  const pos: number[] = [], idx: number[] = [];
  pos.push(dome(0), 0, 0);
  for (let i = 1; i <= RN; i++) {
    const r = (i / RN) * R * 0.985;
    for (let j = 0; j < SG; j++) {
      const th = (j / SG) * Math.PI * 2;
      pos.push(dome(r), Math.cos(th) * r, Math.sin(th) * r);
    }
  }
  for (let j = 0; j < SG; j++) idx.push(0, 1 + j, 1 + ((j + 1) % SG));
  for (let i = 0; i < RN - 1; i++)
    for (let j = 0; j < SG; j++) {
      const a = 1 + i * SG + j, b = 1 + i * SG + ((j + 1) % SG), c = a + SG, d = b + SG;
      idx.push(a, c, b, b, c, d);
    }
  const fg = new THREE.BufferGeometry();
  fg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  fg.setIndex(idx);
  fg.computeVertexNormals();
  k.add(
    fg,
    horse
      ? { color: 0xffffff, mat: surface('wood', { rough: 0.7 }) }
      : {
          color: 0x6a4a2a,
          mat: surface('wood', { rough: 0.7 }),
          colorFn: (p, _n, c) => {
            const r = Math.hypot(p.y, p.z) / R;
            c.copy(style === 'dwarf' ? lin(0x5a5248) : lin(0x8a6a30));
            if (Math.abs(Math.sin(r * 18)) > 0.92) c.multiplyScalar(0.6);
            const wear = n2(p.y * 14, p.z * 14) * 0.5 + n2(p.y * 50, p.z * 50) * 0.3;
            if (wear > 0.45) c.lerp(wood, 0.8);
            c.multiplyScalar(0.92 + 0.12 * n2(p.y * 6, p.z * 60));
          },
        },
    undefined,
    horse ? (p) => emblemUV('rohan', 1 - (p.z + R) / (2 * R), (p.y + R) / (2 * R)) : undefined,
  );
  void green; void gold; void red;
  // back: plain dark planks
  const back = lathe([[0, -0.01], [R * 0.5, -0.004], [R * 0.97, 0.0], [R, 0.004], [R * 0.99, 0.014], [0, 0.012]], 24).rotateZ(-Math.PI / 2).translate(X0 - 0.012, 0, 0);
  k.add(back, { color: 0x4a3626, mat: 'wood', colorFn: (p, n, c) => { woodColor(0x4a3626, seed)(p, n, c); c.multiplyScalar(0.8 + 0.2 * n2(p.y * 14, p.z * 4)); } });
  // iron rim, boss and boss studs
  k.add(new THREE.TorusGeometry(R, 0.0125, 5, 44).rotateY(Math.PI / 2).translate(X0 + 0.004, 0, 0), { color: 0x6a645c, mat: surface('iron_rusty', { rough: 0.55 }), colorFn: oxide(seed, 0x625c54, 0x7a4a2c, 0x8a8478, 0.35, 2) });
  const bx = X0 + 0.036;
  k.add(new THREE.SphereGeometry(0.085, 14, 6, 0, Math.PI * 2, 0, Math.PI * 0.5).rotateZ(-Math.PI / 2).scale(0.62, 1, 1).translate(bx - 0.004, 0, 0), { color: 0x8a8478, mat: surface('metal', { rough: 0.4, metal: 0.7 }), colorFn: steel(0x9a948a, 0xc8c2b8, 1, 0.25, seed) });
  k.add(new THREE.TorusGeometry(0.09, 0.008, 4, 16).rotateY(Math.PI / 2).translate(bx - 0.004, 0, 0), { color: 0x6a645c, mat: 'metal_dark' });
  for (let i = 0; i < 8; i++) {
    const th = (i / 8) * Math.PI * 2;
    k.add(new THREE.SphereGeometry(0.0085, 4, 3).translate(bx - 0.002, Math.cos(th) * 0.09, Math.sin(th) * 0.09), { color: 0x9a948a, mat: 'metal_dark' });
  }
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
      // Galadhrim recurve: golden polished wood, darker curled tips, dark leather grip wrap
      return buildBow({ half: 0.79, brace: 0.17, recurve: 0.12, width: 0.034, thick: 0.022, wood: 0xbf9b62, gripColor: 0x33251a, tipColor: 0x5a4026, stringColor: 0xd8d0bc, fletch: 0xf2f0ea, carved: true, seed });
    case 'orc_bow':
      return buildBow({ half: 0.55, brace: 0.13, recurve: 0.05, width: 0.032, thick: 0.024, wood: 0x2e241c, gripColor: 0x3a2e22, stringColor: 0x6a5a48, fletch: 0x2a2622, crude: true, seed });
    case 'uruk_bow':
      return buildBow({ half: 0.7, brace: 0.16, recurve: 0.09, width: 0.04, thick: 0.028, wood: 0x1c1a18, gripColor: 0x2a2420, tipColor: 0x3a3632, stringColor: 0x5a5248, fletch: 0x1a1816, crude: false, seed });
    case 'elven_knives':
      return elvenKnife(seed, style);
    case 'sword':
    case 'elven_sword':
      return sword(kind, seed);
    case 'scimitar':
    case 'cleaver':
      return curvedBlade(kind, seed, style);
    case 'axe':
      return axe(kind, seed);
    case 'dwarf_axe':
      return gimliAxe(seed);
    case 'pike':
    case 'spear':
      return polearm(kind, seed);
    case 'mace':
    case 'club':
    case 'warhammer':
      return blunt(kind, seed, style);
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
