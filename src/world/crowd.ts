/**
 * Instanced background armies. Every kind is a handful of merged mini-figure geometries (variants:
 * sword, spear, torch, banner, ...) animated entirely in the vertex shader (gait, arm pump, idle sway,
 * cloth flutter, falling when thinned). One InstancedMesh per variant, one shared material.
 *
 *   createCrowd(def, heightAt) -> { mesh, setSpeed, thin, dispose }
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { CrowdDef, CrowdHandle } from '../core/types';
import { hashSeed, Rng } from '../core/rng';
import { patchShader } from './shader';
import { worldQuality } from './quality';

// ───────────────────────────────────────────────────────────────────────────────────────────
// Figure builder
// ───────────────────────────────────────────────────────────────────────────────────────────

/** animation kinds (aAnim.w) */
const K_RIGID = 0;
const K_LEG = 1;
const K_ARM = 2;
const K_PUMP = 3;
const K_CLOTH = 4;
const K_HORSE_LEG = 5;
const K_FLAME = 6;
const K_TAIL = 7;

interface AnimSpec {
  k: number;
  ph: number;
  amp: number;
  /** weight from the vertex position in figure space */
  w: (x: number, y: number, z: number) => number;
}
const RIGID: AnimSpec = { k: K_RIGID, ph: 0, amp: 0, w: () => 0 };
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _s = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _c = new THREE.Color();

class Fig {
  parts: THREE.BufferGeometry[] = [];

  private push(geo: THREE.BufferGeometry, m: THREE.Matrix4, color: number, anim: AnimSpec, mask: number, emit: number, shade = 1): void {
    geo.deleteAttribute('uv');
    geo.applyMatrix4(m);
    const pos = geo.getAttribute('position') as THREE.BufferAttribute;
    const n = pos.count;
    const col = new Float32Array(n * 3);
    const an = new Float32Array(n * 4);
    const mk = new Float32Array(n);
    const em = new Float32Array(n);
    _c.setHex(color);
    for (let i = 0; i < n; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);
      // cheap baked occlusion: darker near the ground and in the crotch / under-arm region
      const ao = (0.62 + 0.38 * clamp01(y / 0.7)) * shade;
      col[i * 3] = _c.r * ao;
      col[i * 3 + 1] = _c.g * ao;
      col[i * 3 + 2] = _c.b * ao;
      an[i * 4] = anim.ph;
      an[i * 4 + 1] = anim.w(x, y, z);
      an[i * 4 + 2] = anim.amp;
      an[i * 4 + 3] = anim.k;
      mk[i] = mask;
      em[i] = emit;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('aAnim', new THREE.BufferAttribute(an, 4));
    geo.setAttribute('aMask', new THREE.BufferAttribute(mk, 1));
    geo.setAttribute('aEmit', new THREE.BufferAttribute(em, 1));
    this.parts.push(geo);
  }

  /** tapered cylinder from A (radius r0) to B (radius r1) */
  limb(a: [number, number, number], b: [number, number, number], r0: number, r1: number, color: number, anim: AnimSpec = RIGID, seg = 5, mask = 1, emit = 0, openEnded = true): this {
    _a.set(a[0], a[1], a[2]);
    _b.set(b[0], b[1], b[2]);
    _v.subVectors(_b, _a);
    const len = _v.length();
    if (len < 1e-5) return this;
    _q.setFromUnitVectors(_up, _v.multiplyScalar(1 / len));
    _m.compose(_s.addVectors(_a, _b).multiplyScalar(0.5), _q, new THREE.Vector3(1, 1, 1));
    this.push(new THREE.CylinderGeometry(r1, r0, len, seg, 1, openEnded), _m.clone(), color, anim, mask, emit);
    return this;
  }

  /** ellipsoid */
  ball(c: [number, number, number], rx: number, ry: number, rz: number, color: number, anim: AnimSpec = RIGID, mask = 1, emit = 0, ws = 6, hs = 3): this {
    _m.compose(_v.set(c[0], c[1], c[2]), _q.identity(), _s.set(rx, ry, rz));
    this.push(new THREE.SphereGeometry(1, ws, hs), _m.clone(), color, anim, mask, emit);
    return this;
  }

  box(c: [number, number, number], sx: number, sy: number, sz: number, color: number, anim: AnimSpec = RIGID, rot: [number, number, number] = [0, 0, 0], mask = 1, emit = 0): this {
    _q.setFromEuler(new THREE.Euler(rot[0], rot[1], rot[2], 'YXZ'));
    _m.compose(_v.set(c[0], c[1], c[2]), _q, _s.set(1, 1, 1));
    this.push(new THREE.BoxGeometry(sx, sy, sz), _m.clone(), color, anim, mask, emit);
    return this;
  }

  /** disc (shield) facing +z, rotated by rot */
  disc(c: [number, number, number], r: number, thick: number, color: number, anim: AnimSpec = RIGID, rot: [number, number, number] = [0, 0, 0], mask = 1): this {
    _q.setFromEuler(new THREE.Euler(rot[0] + Math.PI / 2, rot[1], rot[2], 'YXZ'));
    _m.compose(_v.set(c[0], c[1], c[2]), _q, _s.set(1, 1, 1));
    this.push(new THREE.CylinderGeometry(r, r, thick, 8, 1, false), _m.clone(), color, anim, mask, 0);
    return this;
  }

  cone(base: [number, number, number], tip: [number, number, number], r: number, color: number, anim: AnimSpec = RIGID, seg = 5, mask = 1, emit = 0): this {
    return this.limb(base, tip, r, 0.001, color, anim, seg, mask, emit);
  }

  build(): THREE.BufferGeometry {
    const g = mergeGeometries(this.parts, false);
    if (!g) throw new Error('[crowd] merge failed');
    g.computeBoundingSphere();
    g.computeBoundingBox();
    for (const p of this.parts) p.dispose();
    return g;
  }
}

// ───────────────────────────────────────────────────────────────────────────────────────────
// Biped template
// ───────────────────────────────────────────────────────────────────────────────────────────

type Vec3 = [number, number, number];
interface Biped {
  h: number;
  stocky?: number;
  lean?: number;
  skin: number;
  cloth: number;
  armor?: number;
  armorCover?: number;
  legs: number;
  boots: number;
  headScale?: number;
  armLong?: number;
  stride?: number;
  /** extra width of shoulders (pads) */
  pads?: number;
  mask?: number;
  /** skip the head (caller builds it) */
  noHead?: boolean;
  /** raise the weapon arm (spear / sword / torch pumped overhead) */
  raised?: boolean;
  /** skip the left arm (shield bearers build their own) */
  leftHeld?: boolean;
  /** drop small details (belt, shoulder pads) for big crowds */
  lite?: boolean;
  /** no legs (rider) */
  seated?: boolean;
  /** hip height override, y of the seat */
  hipY?: number;
}

interface Joints {
  hipY: number;
  shY: number;
  headC: Vec3;
  headR: number;
  handR: Vec3;
  handL: Vec3;
  shW: number;
  lean: number;
  armW: (y: number) => number;
}

function biped(f: Fig, o: Biped): Joints {
  const h = o.h;
  const st = o.stocky ?? 1;
  const lean = o.lean ?? 0;
  const mask = o.mask ?? 1;
  const hipY = o.hipY ?? 0.5 * h;
  const shY = (o.hipY ? o.hipY + 0.3 * h : 0.8 * h);
  const shW = 0.115 * h * st + (o.pads ?? 0);
  const hipW = 0.062 * h * st;
  const hs = (o.headScale ?? 1) * 0.062 * h;
  const stride = (o.stride ?? 1) * 0.3 * (h / 1.8);
  const armLen = (o.armLong ?? 1) * 0.32 * h;

  // legs
  if (!o.seated) {
    for (const side of [-1, 1]) {
      const an: AnimSpec = { k: K_LEG, ph: side > 0 ? 0 : Math.PI, amp: stride, w: (_x, y) => clamp01(1 - y / hipY) };
      f.limb([side * hipW, hipY, 0], [side * hipW * 1.05, 0.08, 0.01], 0.058 * h * st, 0.04 * h * st, o.legs, an, 5, mask);
      f.box([side * hipW * 1.05, 0.035, 0.05], 0.1 * h * st * 0.9, 0.07, 0.2 * h * 0.8, o.boots, an, [0, 0, 0], mask);
    }
  } else {
    // seated: thighs forward and down, short shins
    for (const side of [-1, 1]) {
      f.limb([side * hipW * 1.1, hipY, 0], [side * hipW * 2.2, hipY - 0.16, 0.34], 0.06 * h, 0.05 * h, o.legs, RIGID, 5, mask);
      f.limb([side * hipW * 2.2, hipY - 0.16, 0.34], [side * hipW * 2.4, hipY - 0.55, 0.3], 0.05 * h, 0.04 * h, o.legs, RIGID, 5, mask);
    }
  }
  // torso
  f.limb([0, hipY - 0.05, 0], [0, shY - 0.02, lean], 0.1 * h * st, 0.125 * h * st, o.cloth, RIGID, 6, mask);
  if (o.armor !== undefined && (o.armorCover ?? 0) > 0) {
    f.limb([0, hipY + 0.12 * h, lean * 0.3], [0, shY - 0.0, lean], 0.108 * h * st, 0.132 * h * st, o.armor, RIGID, 6, mask);
  }
  // belt
  if (!o.lite) f.limb([0, hipY - 0.01, 0], [0, hipY + 0.05, 0.0], 0.108 * h * st, 0.108 * h * st, o.boots, RIGID, 6, mask);
  // shoulders
  if ((o.pads ?? 0) > 0 && o.armor !== undefined && !o.lite) {
    for (const side of [-1, 1]) f.ball([side * shW * 0.95, shY, lean], 0.07 * h, 0.04 * h, 0.07 * h, o.armor, RIGID, mask);
  }
  // neck and head
  const headC: Vec3 = [0, shY + 0.045 * h + hs * 0.9, lean * 1.2 + 0.02 * h];
  f.limb([0, shY - 0.02, lean], [0, shY + 0.05 * h, lean * 1.2], 0.04 * h, 0.035 * h, o.skin, RIGID, 5, mask);
  if (!o.noHead) f.ball(headC, hs, hs * 1.15, hs * 1.05, o.skin, RIGID, mask);

  const armW = (y: number) => clamp01((shY - y) / armLen);
  const handDown = (side: number): Vec3 => [side * (shW + 0.03), shY - armLen * 0.95, lean + 0.07];
  // weapon arm (+x): raised or relaxed
  const sx = 1;
  const elbowR: Vec3 = o.raised ? [sx * (shW + 0.1), shY - 0.12 * h, lean + 0.14] : [sx * (shW + 0.05), shY - armLen * 0.5, lean + 0.02];
  const handR: Vec3 = o.raised ? [sx * (shW + 0.08), shY - 0.02 * h + 0.06, lean + 0.34] : handDown(sx);
  const armAnR: AnimSpec = o.raised
    ? { k: K_PUMP, ph: 0, amp: 0.18 * (h / 1.8), w: (_x, y) => clamp01((shY - y + 0.2) / armLen) }
    : { k: K_ARM, ph: 0, amp: stride * 0.7, w: (_x, y) => armW(y) };
  f.limb([sx * shW, shY, lean], elbowR, 0.04 * h * st, 0.034 * h * st, o.cloth, armAnR, 4, mask);
  f.limb(elbowR, handR, 0.034 * h * st, 0.028 * h * st, o.skin, armAnR, 4, mask);
  // left arm (-x)
  const handL = handDown(-1);
  if (!o.leftHeld) {
    const armAnL: AnimSpec = { k: K_ARM, ph: Math.PI, amp: stride * 0.7, w: (_x, y) => armW(y) };
    const elbowL: Vec3 = [-(shW + 0.05), shY - armLen * 0.5, lean + 0.02];
    f.limb([-shW, shY, lean], elbowL, 0.04 * h * st, 0.034 * h * st, o.cloth, armAnL, 4, mask);
    f.limb(elbowL, handL, 0.034 * h * st, 0.028 * h * st, o.skin, armAnL, 4, mask);
  }
  return { hipY, shY, headC, headR: hs, handR, handL, shW, lean, armW };
}

/** weapon pieces move with the weapon hand (pumped arm) */
const pumpAn = (h: number): AnimSpec => ({ k: K_PUMP, ph: 0, amp: 0.18 * (h / 1.8), w: () => 1 });
const carryAn = (h: number): AnimSpec => ({ k: K_ARM, ph: 0, amp: 0.1 * (h / 1.8), w: () => 1 });

function spear(f: Fig, hand: Vec3, h: number, len: number, shaft: number, tip: number, an: AnimSpec, tilt = 0.08): void {
  const a: Vec3 = [hand[0], hand[1] - len * 0.28, hand[2] - tilt * 3];
  const b: Vec3 = [hand[0], hand[1] + len * 0.72, hand[2] + tilt * 4];
  f.limb(a, b, 0.022, 0.018, shaft, an, 4);
  f.cone(b, [b[0], b[1] + 0.34, b[2] + tilt * 0.8], 0.045, tip, an, 4);
}

function sword(f: Fig, hand: Vec3, h: number, blade: number, hilt: number, an: AnimSpec, length = 0.72): void {
  f.limb([hand[0], hand[1] - 0.09, hand[2]], [hand[0], hand[1] + 0.05, hand[2]], 0.014, 0.014, hilt, an, 4);
  f.box([hand[0], hand[1] + 0.06, hand[2]], 0.13, 0.025, 0.03, hilt, an);
  f.box([hand[0], hand[1] + 0.06 + length / 2, hand[2] + 0.01], 0.05, length, 0.014, blade, an, [0.18, 0, 0]);
}

function scimitar(f: Fig, hand: Vec3, blade: number, hilt: number, an: AnimSpec): void {
  f.limb([hand[0], hand[1] - 0.08, hand[2]], [hand[0], hand[1] + 0.05, hand[2]], 0.014, 0.014, hilt, an, 4);
  f.box([hand[0], hand[1] + 0.3, hand[2] + 0.03], 0.075, 0.45, 0.014, blade, an, [0.25, 0, 0]);
  f.box([hand[0], hand[1] + 0.6, hand[2] + 0.12], 0.09, 0.28, 0.014, blade, an, [0.75, 0, 0]);
}

function axe(f: Fig, hand: Vec3, head: number, haft: number, an: AnimSpec, length = 0.75): void {
  f.limb([hand[0], hand[1] - 0.22, hand[2]], [hand[0], hand[1] + length - 0.22, hand[2]], 0.02, 0.02, haft, an, 4);
  f.box([hand[0] + 0.05, hand[1] + length - 0.28, hand[2]], 0.17, 0.2, 0.025, head, an);
}

function torch(f: Fig, hand: Vec3, an: AnimSpec): void {
  f.limb([hand[0], hand[1] - 0.2, hand[2]], [hand[0], hand[1] + 0.55, hand[2] + 0.04], 0.022, 0.03, 0x3a2a1c, an, 4);
  f.ball([hand[0], hand[1] + 0.6, hand[2] + 0.04], 0.05, 0.06, 0.05, 0x1e1812, an, 1, 0, 5, 3);
  const fa: AnimSpec = { k: K_FLAME, ph: 0, amp: 0.2, w: () => 1 };
  const base = hand[1] + 0.62;
  // flame (emissive): body + brighter core
  f.limb([hand[0], base, hand[2] + 0.04], [hand[0], base + 0.5, hand[2] + 0.04], 0.085, 0.002, 0xff6a14, mergeAn(an, fa), 6, 0, 1.0);
  f.limb([hand[0], base, hand[2] + 0.04], [hand[0], base + 0.3, hand[2] + 0.04], 0.05, 0.002, 0xffd070, mergeAn(an, fa), 5, 0, 1.4);
}
/** flame vertices follow the pumping hand AND flicker: encode as K_FLAME (shader adds the pump) */
function mergeAn(_a: AnimSpec, b: AnimSpec): AnimSpec {
  return b;
}

function banner(f: Fig, base: Vec3, poleH: number, w: number, hgt: number, cloth: number, trim: number, emblem: number | null, an: AnimSpec): void {
  f.limb([base[0], base[1] - 0.6, base[2]], [base[0], base[1] + poleH, base[2]], 0.022, 0.018, 0x2a1e14, an, 4);
  f.ball([base[0], base[1] + poleH + 0.06, base[2]], 0.05, 0.07, 0.05, trim, an, 1, 0, 5, 3);
  const cy = base[1] + poleH - hgt / 2 - 0.12;
  const cloA: AnimSpec = { k: K_CLOTH, ph: 0, amp: 0.1, w: (x) => clamp01((x - base[0]) / w) };
  f.box([base[0] + w / 2, cy, base[2]], w, hgt, 0.012, cloth, cloA);
  f.box([base[0] + w / 2, base[1] + poleH - 0.14, base[2] + 0.005], w, 0.05, 0.016, trim, cloA);
  f.box([base[0] + w / 2, cy - hgt / 2 + 0.03, base[2] + 0.005], w, 0.05, 0.016, trim, cloA);
  if (emblem !== null) f.ball([base[0] + w * 0.5, cy, base[2] + 0.012], w * 0.2, hgt * 0.2, 0.01, emblem, cloA, 1, 0, 5, 3);
}

// ───────────────────────────────────────────────────────────────────────────────────────────
// Kinds and variants
// ───────────────────────────────────────────────────────────────────────────────────────────

type Kind = CrowdDef['kind'];
type Weapon = 'sword' | 'spear' | 'torch' | 'banner' | 'axe' | 'bow' | 'pike';
interface Variant {
  weapon: Weapon;
  shield: boolean;
  weight: number;
  /** only with def.props */
  propsOnly?: boolean;
}

const VARIANTS: Record<Kind, Variant[]> = {
  orc: [
    { weapon: 'sword', shield: true, weight: 0.4 },
    { weapon: 'axe', shield: false, weight: 0.25 },
    { weapon: 'spear', shield: false, weight: 0.22, propsOnly: true },
    { weapon: 'torch', shield: false, weight: 0.1, propsOnly: true },
    { weapon: 'banner', shield: false, weight: 0.025, propsOnly: true },
  ],
  goblin: [
    { weapon: 'sword', shield: false, weight: 0.5 },
    { weapon: 'spear', shield: false, weight: 0.25, propsOnly: true },
    { weapon: 'axe', shield: false, weight: 0.2 },
    { weapon: 'torch', shield: false, weight: 0.05, propsOnly: true },
  ],
  uruk: [
    { weapon: 'sword', shield: true, weight: 0.4 },
    { weapon: 'pike', shield: false, weight: 0.3, propsOnly: true },
    { weapon: 'axe', shield: true, weight: 0.2 },
    { weapon: 'torch', shield: false, weight: 0.07, propsOnly: true },
    { weapon: 'banner', shield: false, weight: 0.03, propsOnly: true },
  ],
  easterling: [
    { weapon: 'sword', shield: true, weight: 0.5 },
    { weapon: 'spear', shield: true, weight: 0.3, propsOnly: true },
    { weapon: 'axe', shield: false, weight: 0.15 },
    { weapon: 'banner', shield: false, weight: 0.03, propsOnly: true },
  ],
  gondor: [
    { weapon: 'sword', shield: true, weight: 0.45 },
    { weapon: 'spear', shield: true, weight: 0.45, propsOnly: true },
    { weapon: 'banner', shield: false, weight: 0.03, propsOnly: true },
  ],
  elf: [
    { weapon: 'bow', shield: false, weight: 0.6 },
    { weapon: 'sword', shield: false, weight: 0.3 },
    { weapon: 'banner', shield: false, weight: 0.03, propsOnly: true },
  ],
  dwarf: [
    { weapon: 'axe', shield: true, weight: 0.6 },
    { weapon: 'axe', shield: false, weight: 0.3 },
    { weapon: 'banner', shield: false, weight: 0.03, propsOnly: true },
  ],
  rohirrim: [
    { weapon: 'spear', shield: true, weight: 0.65 },
    { weapon: 'sword', shield: true, weight: 0.3 },
    { weapon: 'banner', shield: false, weight: 0.04, propsOnly: true },
  ],
};

function buildHead(f: Fig, kind: Kind, J: Joints, skin: number, h: number): void {
  const [cx, cy, cz] = J.headC;
  const r = J.headR;
  switch (kind) {
    case 'orc': {
      f.ball([cx, cy - r * 0.55, cz + r * 0.5], r * 0.75, r * 0.5, r * 0.65, 0x3c3a2a); // heavy jaw
      f.ball([cx, cy + r * 0.55, cz], r * 1.12, r * 0.62, r * 1.12, 0x4a3b30); // rusty skull cap
      f.cone([cx, cy + r * 1.05, cz], [cx, cy + r * 1.6, cz - r * 0.1], r * 0.14, 0x5c4a3a, RIGID, 4);
      for (const s of [-1, 1]) f.cone([cx + s * r * 0.9, cy + r * 0.05, cz - r * 0.2], [cx + s * r * 1.9, cy + r * 0.55, cz - r * 0.5], r * 0.3, skin, RIGID, 4);
      break;
    }
    case 'goblin': {
      for (const s of [-1, 1]) f.cone([cx + s * r * 0.7, cy + r * 0.1, cz - r * 0.1], [cx + s * r * 2.6, cy + r * 0.6, cz - r * 0.5], r * 0.55, skin, RIGID, 4);
      f.ball([cx, cy - r * 0.5, cz + r * 0.5], r * 0.8, r * 0.5, r * 0.7, skin);
      break;
    }
    case 'uruk': {
      f.ball([cx, cy + r * 0.35, cz - r * 0.05], r * 1.18, r * 0.95, r * 1.18, 0x1c1b1b); // helm
      f.box([cx, cy - r * 0.05, cz + r * 1.02], r * 0.2, r * 1.2, r * 0.12, 0x1c1b1b); // nasal bar
      f.cone([cx, cy + r * 1.1, cz - r * 0.1], [cx, cy + r * 1.9, cz - r * 0.4], r * 0.16, 0x303030, RIGID, 4); // crest spike
      f.ball([cx, cy - r * 0.7, cz + r * 0.45], r * 0.8, r * 0.5, r * 0.7, 0x2a2824);
      break;
    }
    case 'easterling': {
      f.ball([cx, cy + r * 0.3, cz], r * 1.15, r * 0.95, r * 1.15, 0x7a2a1a);
      f.cone([cx, cy + r * 1.1, cz], [cx, cy + r * 2.0, cz], r * 0.18, 0xc9a24a, RIGID, 4);
      f.box([cx, cy - r * 0.45, cz + r * 0.7], r * 1.5, r * 0.9, r * 0.5, 0x4a3224); // face veil
      f.box([cx, cy - r * 1.05, cz - r * 0.15], r * 1.6, r * 0.9, r * 1.6, 0x6a2418); // neck cloth
      break;
    }
    case 'gondor': {
      f.ball([cx, cy + r * 0.35, cz], r * 1.15, r * 0.9, r * 1.15, 0xaeb4ba);
      f.box([cx, cy - r * 0.1, cz + r * 1.0], r * 0.2, r * 1.0, r * 0.1, 0xaeb4ba);
      for (const s of [-1, 1]) {
        f.box([cx + s * r * 1.5, cy + r * 0.75, cz - r * 0.1], r * 1.1, r * 0.12, r * 0.45, 0xd8d8d2, RIGID, [0, 0, s * 0.45]); // wing
      }
      break;
    }
    case 'elf': {
      f.limb([cx, cy + r * 0.2, cz - r * 0.6], [cx, cy - r * 3.2, cz - r * 1.1], r * 1.0, r * 0.5, 0xc7ae78, RIGID, 5); // long hair
      f.ball([cx, cy + r * 0.45, cz - r * 0.15], r * 1.1, r * 0.75, r * 1.1, 0xc7ae78);
      for (const s of [-1, 1]) f.cone([cx + s * r * 0.95, cy + r * 0.1, cz - r * 0.1], [cx + s * r * 1.5, cy + r * 0.95, cz - r * 0.3], r * 0.2, skin, RIGID, 4);
      break;
    }
    case 'dwarf': {
      f.ball([cx, cy + r * 0.45, cz], r * 1.2, r * 0.85, r * 1.2, 0x74746e); // round helm
      f.box([cx, cy - r * 0.1, cz + r * 1.05], r * 0.22, r * 1.1, r * 0.1, 0x74746e);
      f.limb([cx, cy - r * 0.2, cz + r * 0.7], [cx, cy - r * 4.0, cz + r * 0.9], r * 1.15, r * 0.55, 0x6a4624, RIGID, 5); // beard
      break;
    }
    case 'rohirrim': {
      f.ball([cx, cy + r * 0.35, cz], r * 1.15, r * 0.9, r * 1.15, 0x8a8a84, RIGID, 0);
      f.limb([cx, cy + r * 0.9, cz], [cx, cy + r * 1.6, cz - r * 2.4], r * 0.16, r * 0.5, 0xd8cfae, { k: K_CLOTH, ph: 0, amp: 0.08, w: (_x, y) => clamp01((y - cy) / 0.5) }, 4, 0); // horsehair crest
      break;
    }
  }
}

interface KindStyle {
  h: number;
  b: Biped;
  shield?: { color: number; trim: number; r: number; round: boolean; emblem?: number };
  banner: { cloth: number; trim: number; emblem: number | null; w: number; hgt: number };
  blade: number;
  haft: number;
  tip: number;
}

function styleOf(kind: Kind): KindStyle {
  switch (kind) {
    case 'orc':
      return {
        h: 1.62,
        b: { h: 1.62, stocky: 1.12, lean: 0.12, skin: 0x4a4a36, cloth: 0x3a2e26, armor: 0x4c3a2e, armorCover: 0.6, legs: 0x2e2824, boots: 0x1e1814, headScale: 1.15, armLong: 1.12, stride: 0.9, pads: 0.01 },
        shield: { color: 0x4a3626, trim: 0x3a3a38, r: 0.3, round: true },
        banner: { cloth: 0x1c1a18, trim: 0x6a2a1a, emblem: 0xb02a1a, w: 0.9, hgt: 0.9 },
        blade: 0x7a7a74, haft: 0x3a2a1c, tip: 0x888880,
      };
    case 'goblin':
      return {
        h: 1.2,
        b: { h: 1.2, stocky: 0.95, lean: 0.14, skin: 0x5b5d46, cloth: 0x3a3228, legs: 0x4a4636, boots: 0x2a2218, headScale: 1.3, armLong: 1.25, stride: 1.0 },
        banner: { cloth: 0x2a2620, trim: 0x5a4a2a, emblem: 0xa0a090, w: 0.7, hgt: 0.7 },
        blade: 0x6a6a66, haft: 0x3a2a1c, tip: 0x777770,
      };
    case 'uruk':
      return {
        h: 1.98,
        b: { h: 1.98, stocky: 1.15, lean: 0.08, skin: 0x2e2c28, cloth: 0x1c1a1a, armor: 0x1e1e20, armorCover: 1, legs: 0x1a1816, boots: 0x121010, headScale: 1.05, stride: 0.85, pads: 0.03 },
        shield: { color: 0x1e1c1c, trim: 0x303030, r: 0.34, round: false, emblem: 0xe8e4dc },
        banner: { cloth: 0x161414, trim: 0x303030, emblem: 0xe8e4dc, w: 1.0, hgt: 1.1 },
        blade: 0x70747a, haft: 0x2a2018, tip: 0x80848a,
      };
    case 'easterling':
      return {
        h: 1.8,
        b: { h: 1.8, stocky: 1.02, skin: 0x8a5a3a, cloth: 0x8a2a1e, armor: 0x6e2418, armorCover: 0.7, legs: 0x4a2a1c, boots: 0x2a1c14, stride: 0.95, pads: 0.02 },
        shield: { color: 0x9a2a1c, trim: 0xc9a24a, r: 0.36, round: true, emblem: 0xc9a24a },
        banner: { cloth: 0x8a1c14, trim: 0xc9a24a, emblem: 0xe0c060, w: 1.0, hgt: 1.0 },
        blade: 0x9a9a94, haft: 0x3a2a1c, tip: 0xa0a09a,
      };
    case 'gondor':
      return {
        h: 1.8,
        b: { h: 1.8, stocky: 1.0, skin: 0xc0906e, cloth: 0xd8d8d2, armor: 0x9aa0a8, armorCover: 0.8, legs: 0x3a3c44, boots: 0x2a221a, stride: 0.95, pads: 0.02 },
        shield: { color: 0xb8bcc4, trim: 0x8a8e96, r: 0.38, round: false, emblem: 0xf2f2ee },
        banner: { cloth: 0x14141a, trim: 0xc8c8c4, emblem: 0xf0f0ec, w: 1.0, hgt: 1.2 },
        blade: 0xb0b4ba, haft: 0x4a3a2a, tip: 0xc0c4c8,
      };
    case 'elf':
      return {
        h: 1.95,
        b: { h: 1.95, stocky: 0.82, skin: 0xe2c4a8, cloth: 0x6a7a5c, armor: 0xa8b0a0, armorCover: 0.4, legs: 0x5c6650, boots: 0x4a3c2a, stride: 1.0 },
        banner: { cloth: 0x2e4a30, trim: 0xc9c9a0, emblem: 0xd8d0a0, w: 1.0, hgt: 1.3 },
        blade: 0xc4c8cc, haft: 0x6a5238, tip: 0xc0c8c0,
      };
    case 'dwarf':
      return {
        h: 1.35,
        b: { h: 1.35, stocky: 1.42, skin: 0xc4906e, cloth: 0x6a3a22, armor: 0x7a7a76, armorCover: 0.9, legs: 0x3a2e24, boots: 0x2a2018, stride: 0.8, pads: 0.02, headScale: 1.1 },
        shield: { color: 0x7a3a22, trim: 0x8a8a84, r: 0.3, round: true },
        banner: { cloth: 0x7a2a1a, trim: 0xb8a060, emblem: 0xd8c070, w: 0.8, hgt: 0.8 },
        blade: 0x8a8e92, haft: 0x4a3a2a, tip: 0x8a8e92,
      };
    case 'rohirrim':
      return {
        h: 1.8,
        b: { h: 1.8, stocky: 1.0, skin: 0xc79a78, cloth: 0x4a5a30, armor: 0x7c7c76, armorCover: 0.5, legs: 0x4a3a28, boots: 0x3a2a1c, mask: 0, seated: true, hipY: 1.28, stride: 0 },
        shield: { color: 0x3a6a3a, trim: 0xc9a24a, r: 0.34, round: true, emblem: 0xd8b84a },
        banner: { cloth: 0x2e5a2e, trim: 0xc9a24a, emblem: 0xe8e8e0, w: 1.1, hgt: 1.1 },
        blade: 0xa8acb0, haft: 0x6a5238, tip: 0xb0b4b8,
      };
  }
}

function buildHorse(f: Fig, rng: Rng): void {
  const coat = 0xe6e0d6;
  const dark = 0xb6aea0;
  // body: long barrel + chest + rump
  f.ball([0, 1.0, 0.0], 0.34, 0.36, 0.95, coat, RIGID, 1, 0, 7, 5);
  f.ball([0, 1.05, 0.62], 0.34, 0.36, 0.4, coat, RIGID, 1, 0, 6, 4);
  f.ball([0, 1.02, -0.62], 0.33, 0.36, 0.42, coat, RIGID, 1, 0, 6, 4);
  // neck + head
  f.limb([0, 1.18, 0.7], [0, 1.72, 1.12], 0.2, 0.12, coat, { k: K_TAIL, ph: 1.0, amp: 0.05, w: (_x, y) => clamp01((y - 1.1) / 0.6) }, 6, 1);
  f.limb([0, 1.72, 1.12], [0, 1.44, 1.52], 0.12, 0.075, coat, { k: K_TAIL, ph: 1.0, amp: 0.07, w: () => 1 }, 5, 1);
  f.box([0, 1.77, 1.04], 0.07, 0.3, 0.1, dark, { k: K_TAIL, ph: 1.0, amp: 0.05, w: () => 1 }, [0.4, 0, 0], 1); // mane
  for (const s of [-1, 1]) f.cone([s * 0.07, 1.84, 1.16], [s * 0.09, 2.0, 1.12], 0.03, dark, { k: K_TAIL, ph: 1.0, amp: 0.05, w: () => 1 }, 4, 1);
  // tail
  f.limb([0, 1.12, -0.95], [0, 0.55, -1.2], 0.05, 0.1, dark, { k: K_TAIL, ph: 0.4, amp: 0.2, w: (_x, y) => clamp01((1.12 - y) / 0.55) }, 5, 1);
  // legs: gallop, pairs
  const legs: [number, number, number][] = [
    [0.15, 0.78, 0], [-0.15, 0.78, 0.35], [0.15, -0.74, 1.6], [-0.15, -0.74, 1.95],
  ];
  for (const [lx, lz, ph] of legs) {
    const an: AnimSpec = { k: K_HORSE_LEG, ph, amp: 0.5, w: (_x, y) => clamp01(1 - y / 1.0) };
    f.limb([lx, 1.0, lz], [lx, 0.5, lz + (lz > 0 ? 0.04 : -0.06)], 0.1, 0.05, coat, an, 5, 1);
    f.limb([lx, 0.5, lz + (lz > 0 ? 0.04 : -0.06)], [lx, 0.07, lz], 0.045, 0.04, coat, an, 4, 1);
    f.box([lx, 0.035, lz + 0.01], 0.09, 0.07, 0.11, 0x2a2420, an, [0, 0, 0], 0);
  }
  // saddle blanket
  f.box([0, 1.34, 0.0], 0.55, 0.05, 0.62, 0x6a2a20, RIGID, [0, 0, 0], 0);
  void rng;
}

function buildFigure(kind: Kind, variant: Variant, seed: number, lite = false): THREE.BufferGeometry {
  const f = new Fig();
  const st = styleOf(kind);
  const rng = new Rng(seed);
  const raised = variant.weapon === 'spear' || variant.weapon === 'torch' || variant.weapon === 'banner' || variant.weapon === 'pike';
  const bipedOpts: Biped = { ...st.b, raised, leftHeld: variant.shield, lite };
  if (kind === 'rohirrim') {
    buildHorse(f, rng);
    bipedOpts.raised = variant.weapon === 'spear' || variant.weapon === 'banner';
  }
  const J = biped(f, bipedOpts);
  const h = st.h;
  buildHead(f, kind, J, st.b.skin, h);
  const hand = J.handR;
  const pump = pumpAn(h);
  const carry = carryAn(h);
  const an = raised || (kind === 'rohirrim' && bipedOpts.raised) ? pump : carry;

  switch (variant.weapon) {
    case 'sword':
      if (kind === 'easterling' || kind === 'goblin' || kind === 'orc') scimitar(f, hand, st.blade, st.haft, an);
      else sword(f, hand, h, st.blade, st.haft, an, kind === 'elf' ? 0.85 : 0.7);
      break;
    case 'axe':
      axe(f, hand, st.blade, st.haft, an, kind === 'dwarf' ? 0.7 : 0.8);
      break;
    case 'spear':
      spear(f, hand, h, kind === 'rohirrim' ? 3.0 : 2.4, st.haft, st.tip, an);
      if (kind === 'gondor' || kind === 'rohirrim') f.box([hand[0] + 0.05, hand[1] + 1.45, hand[2] + 0.02], 0.1, 0.18, 0.01, kind === 'gondor' ? 0xe8e8e4 : 0x3a6a3a, { k: K_CLOTH, ph: 0, amp: 0.06, w: () => 1 });
      break;
    case 'pike':
      spear(f, hand, h, 3.4, st.haft, st.tip, an, 0.1);
      break;
    case 'torch':
      torch(f, hand, an);
      break;
    case 'banner':
      banner(f, hand, kind === 'rohirrim' ? 2.6 : 2.4, st.banner.w, st.banner.hgt, st.banner.cloth, st.banner.trim, st.banner.emblem, an);
      break;
    case 'bow': {
      // elf archer, bow held low in the left hand, quiver on the back
      const L = J.handL;
      f.limb([L[0], L[1] - 0.45, L[2] + 0.05], [L[0] - 0.02, L[1] + 0.0, L[2] + 0.2], 0.012, 0.012, st.haft, RIGID, 4);
      f.limb([L[0] - 0.02, L[1], L[2] + 0.2], [L[0], L[1] + 0.45, L[2] + 0.05], 0.012, 0.012, st.haft, RIGID, 4);
      f.limb([J.handL[0] + 0.0, J.shY - 0.05, -0.16], [J.handL[0] + 0.3, J.shY + 0.28, -0.2], 0.05, 0.05, 0x5a4230, RIGID, 5);
      break;
    }
  }
  // shield on the left arm
  if (variant.shield && st.shield) {
    const s = st.shield;
    const L = J.handL;
    const an2: AnimSpec = { k: K_ARM, ph: Math.PI, amp: 0.1, w: () => 1 };
    if (s.round) {
      f.disc([L[0] - 0.08, L[1] + 0.25, L[2] + 0.2], s.r, 0.035, s.color, an2, [0, 0, 0]);
      f.ball([L[0] - 0.08, L[1] + 0.25, L[2] + 0.23], s.r * 0.22, s.r * 0.22, 0.05, s.trim, an2, 1, 0, 5, 3);
      if (s.emblem !== undefined) f.box([L[0] - 0.08, L[1] + 0.25, L[2] + 0.225], s.r * 1.2, 0.04, 0.012, s.emblem, an2);
    } else {
      f.box([L[0] - 0.1, L[1] + 0.2, L[2] + 0.2], s.r * 1.5, s.r * 2.5, 0.04, s.color, an2, [0, 0.1, 0]);
      f.box([L[0] - 0.1, L[1] + 0.2, L[2] + 0.225], s.r * 1.3, s.r * 2.3, 0.01, s.trim, an2, [0, 0.1, 0]);
      if (s.emblem !== undefined) f.box([L[0] - 0.1, L[1] + 0.25, L[2] + 0.235], s.r * 0.5, s.r * 0.9, 0.01, s.emblem, an2, [0, 0.1, 0]);
    }
    // left forearm into shield
    f.limb([L[0], L[1], L[2]], [L[0] - 0.05, L[1] + 0.18, L[2] + 0.13], 0.03, 0.03, st.b.skin, an2, 4, st.b.mask ?? 1);
  }
  if (kind === 'elf' || kind === 'gondor') {
    // cape
    const cape = kind === 'elf' ? 0x4e6a4a : 0x20202a;
    f.box([0, J.shY - 0.42, -0.14], J.shW * 2.1, 0.8, 0.02, cape, { k: K_CLOTH, ph: 0.5, amp: 0.12, w: (_x, y) => clamp01((J.shY - y) / 0.8) }, [0.08, 0, 0]);
  }
  if (kind === 'orc' || kind === 'goblin' || kind === 'uruk') {
    // ragged cloth hanging from the belt
    f.box([0, J.hipY - 0.18, 0.0], J.shW * 1.7, 0.4, 0.2, 0x2a2420, { k: K_CLOTH, ph: 1.7, amp: 0.05, w: (_x, y) => clamp01((J.hipY - y) / 0.4) });
  }
  return f.build();
}

// ───────────────────────────────────────────────────────────────────────────────────────────
// Material
// ───────────────────────────────────────────────────────────────────────────────────────────

interface CrowdUniforms {
  uTime: { value: number };
  uPhase: { value: number };
  uMove: { value: number };
  uRun: { value: number };
}

const VERT_HEAD = /* glsl */ `
attribute vec4 aAnim; attribute float aMask; attribute float aEmit; attribute vec4 aInst;
uniform float uTime; uniform float uPhase; uniform float uMove; uniform float uRun;
varying float vEmit;
`;

const VERT_ANIM = /* glsl */ `
{
  float sp = aInst.y;
  float ph = uPhase * 6.2831853 * sp + aInst.x * 6.2831853;
  float move = uMove;
  float k = aAnim.w;
  float wgt = aAnim.y;
  float amp = aAnim.z;
  float tf = aInst.z > -0.5 ? max(uTime - aInst.z, 0.0) : 0.0;
  float dead = aInst.z > -0.5 && uTime > aInst.z ? 1.0 : 0.0;
  move *= 1.0 - clamp(tf * 5.0, 0.0, 1.0);
  float run = uRun * (1.0 - clamp(tf * 5.0, 0.0, 1.0));
  vec3 p = transformed;
  float bob = abs(sin(ph)) * (0.035 + 0.03 * run) * move;
  float sway = sin(uTime * 0.8 + aInst.x * 17.0);
  float s = sin(ph + aAnim.x);
  float c = cos(ph + aAnim.x);
  float stride = 1.0 + 0.7 * run;
  if (k < 0.5) { /* rigid body */ }
  else if (k < 1.5) { p.z += s * amp * wgt * move * stride; p.y += max(c, 0.0) * amp * 0.5 * wgt * wgt * move; }
  else if (k < 2.5) { p.z += s * amp * wgt * move * stride; p.y += abs(s) * 0.02 * wgt * move; }
  else if (k < 3.5) {
    float pump = 0.5 + 0.5 * sin(uTime * (1.7 + sp) + aInst.x * 23.0);
    p.y += pump * amp * wgt * (1.0 - move) * (1.0 - 0.0);
    p.z += s * amp * 0.55 * wgt * move * stride;
    p.y += abs(s) * 0.03 * wgt * move;
  }
  else if (k < 4.5) { p.x += sin(uTime * 3.4 + p.y * 2.0 + aAnim.x + aInst.x * 9.0) * amp * wgt * (0.6 + move + run); p.z += sin(uTime * 2.7 + p.x * 3.0 + aAnim.x) * amp * wgt * 0.5; }
  else if (k < 5.5) {
    float g = ph * 1.35 + aAnim.x;
    p.z += sin(g) * amp * wgt * (0.15 + move * 1.2);
    p.y += max(cos(g), 0.0) * amp * 0.45 * wgt * wgt * (0.15 + move);
  }
  else if (k < 6.5) {
    float fl = sin(uTime * 14.0 + aInst.x * 31.0 + p.y * 6.0);
    p.y += (0.5 + 0.5 * sin(uTime * (1.7 + sp) + aInst.x * 23.0)) * 0.18 * (1.0 - move);
    p.xz += vec2(fl, sin(uTime * 11.0 + aInst.x * 7.0)) * 0.025;
  }
  else { p.z += sin(uTime * 2.2 + aAnim.x + ph * 0.5) * amp * wgt * (0.3 + move); p.x += sin(uTime * 1.7 + aAnim.x) * amp * 0.5 * wgt * (1.0 - move * 0.5); }
  float bodyW = (k < 0.5 || k > 1.5) ? 1.0 : 0.0;
  p.y += bob * bodyW;
  // lean into the run, idle sway
  p.z += p.y * 0.1 * run;
  p.x += sway * 0.012 * p.y * (1.0 - move);
  if (dead > 0.5) {
    float fa = smoothstep(0.0, 0.7, tf) * 1.45;
    float sg = aInst.w > 0.5 ? 1.0 : -1.0;
    float cs = cos(fa); float sn = sin(fa) * sg;
    float ny = p.y * cs - p.z * sn;
    float nz = p.y * sn + p.z * cs;
    p.y = ny; p.z = nz;
    p.x += (aInst.w - 0.5) * 0.4 * smoothstep(0.0, 0.7, tf);
    p.y -= smoothstep(20.0, 30.0, tf) * 1.6;
  }
  transformed = p;
  vEmit = aEmit;
}
`;

const FRAG_EMIT = /* glsl */ `
#include <emissivemap_fragment>
{
  vec3 flame = vec3(1.0, 0.42, 0.1) * (1.6 + 1.0 * sin(vEmit * 40.0));
  totalEmissiveRadiance += vColor.rgb * 0.0 + flame * clamp(vEmit, 0.0, 1.0) * 1.3 + vec3(1.0, 0.8, 0.45) * max(vEmit - 1.0, 0.0) * 1.2;
}
`;

function makeMaterial(shared: CrowdUniforms, maskedTint: boolean): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0.25, envMapIntensity: 0.9 });
  mat.name = 'crowd';
  patchShader(mat, 'crowd_v1', (shader) => {
    shader.uniforms.uTime = shared.uTime;
    shader.uniforms.uPhase = shared.uPhase;
    shader.uniforms.uMove = shared.uMove;
    shader.uniforms.uRun = shared.uRun;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n' + VERT_HEAD)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n' + VERT_ANIM)
      .replace(
        '#include <color_vertex>',
        `vColor = vec4(1.0);
        vColor.rgb *= color;
        #ifdef USE_INSTANCING_COLOR
          vColor.rgb *= mix(vec3(1.0), instanceColor.rgb, aMask);
        #endif`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vEmit;')
      .replace('#include <emissivemap_fragment>', FRAG_EMIT);
  });
  void maskedTint;
  return mat;
}

// ───────────────────────────────────────────────────────────────────────────────────────────
// createCrowd
// ───────────────────────────────────────────────────────────────────────────────────────────

interface VariantInst {
  mesh: THREE.InstancedMesh;
  n: number;
  bx: Float32Array;
  bz: Float32Array;
  yawScale: Float32Array;
  alive: Uint8Array;
  inst: THREE.InstancedBufferAttribute;
}

const geoCache = new Map<string, THREE.BufferGeometry>();

const COUNT_SCALE = { low: 0.4, medium: 0.7, high: 1, ultra: 1 } as const;
const HORSE_COATS = [0x6b4a30, 0x4a3020, 0x8a8a86, 0xd8d4c8, 0x2a2420, 0x8a6a40, 0x5a3a24];

export function createCrowd(def: CrowdDef, heightAt: (x: number, z: number) => number): CrowdHandle {
  const q = worldQuality();
  const total = Math.max(0, Math.floor(def.count * COUNT_SCALE[q]));
  const group = new THREE.Group();
  group.name = `crowd:${def.kind}`;
  const rng = new Rng(hashSeed('crowd', def.kind, def.count, def.center.x, def.center.z));
  const facing = def.facing ?? 0;
  const dirX = Math.sin(facing);
  const dirZ = Math.cos(facing);

  const uniforms: CrowdUniforms = { uTime: { value: 0 }, uPhase: { value: 0 }, uMove: { value: 0 }, uRun: { value: 0 } };
  const material = makeMaterial(uniforms, false);

  // choose variants
  const variants = VARIANTS[def.kind].filter((v) => !v.propsOnly || def.props);
  const wsum = variants.reduce((s, v) => s + v.weight, 0);
  const counts = variants.map((v) => Math.floor((total * v.weight) / wsum));
  let assigned = counts.reduce((a, b) => a + b, 0);
  for (let i = 0; assigned < total; i = (i + 1) % variants.length) {
    if (variants[i].weapon === 'banner' || variants[i].weapon === 'torch') continue;
    counts[i]++;
    assigned++;
  }
  // a handful of banners even for small crowds
  const bi = variants.findIndex((v) => v.weapon === 'banner');
  if (bi >= 0 && total >= 24 && counts[bi] === 0) counts[bi] = 1;

  // formation: jittered ranks inside the area
  const hx = def.halfSize[0];
  const hz = def.halfSize[1];
  const area = 4 * hx * hz;
  const spacing = Math.max(0.9, Math.sqrt(area / Math.max(1, total)));
  const cols = Math.max(1, Math.floor((2 * hx) / spacing));
  const slots: [number, number][] = [];
  const rows = Math.max(1, Math.ceil(total / cols));
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = -hx + (c + 0.5) * ((2 * hx) / cols) + (rng.float() - 0.5) * spacing * 0.55;
      const z = -hz + (r + 0.5) * ((2 * hz) / rows) + (rng.float() - 0.5) * spacing * 0.55;
      slots.push([x, z]);
    }
  }
  // shuffle slots
  for (let i = slots.length - 1; i > 0; i--) {
    const j = Math.floor(rng.float() * (i + 1));
    [slots[i], slots[j]] = [slots[j], slots[i]];
  }

  const insts: VariantInst[] = [];
  let slotI = 0;
  const m4 = new THREE.Matrix4();
  const e = new THREE.Euler();
  const qt = new THREE.Quaternion();
  const sc = new THREE.Vector3();
  const pv = new THREE.Vector3();
  const color = new THREE.Color();
  const castShadow = total <= 300;
  variants.forEach((v, vi) => {
    const n = counts[vi];
    if (n <= 0) return;
    const lite = total > 450;
    const key = `${def.kind}:${v.weapon}:${v.shield ? 's' : ''}:${lite ? 'l' : 'f'}`;
    let geo = geoCache.get(key);
    if (!geo) {
      geo = buildFigure(def.kind, v, hashSeed(key), lite);
      geo.userData.shared = true;
      geoCache.set(key, geo);
    }
    const mesh = new THREE.InstancedMesh(geo, material, n);
    mesh.name = `crowd:${def.kind}:${v.weapon}`;
    mesh.frustumCulled = false;
    mesh.castShadow = castShadow;
    mesh.receiveShadow = true;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const ia = new Float32Array(n * 4);
    const bx = new Float32Array(n);
    const bz = new Float32Array(n);
    const ys = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const [lx, lz] = slots[slotI++ % slots.length];
      // axis aligned area (as specified); facing only rotates the figures and the march direction
      bx[i] = def.center.x + lx;
      bz[i] = def.center.z + lz;
      const yaw = facing + (rng.float() - 0.5) * 0.4;
      const scl = 0.93 + rng.float() * 0.14;
      ys[i] = scl;
      e.set(0, yaw, 0);
      qt.setFromEuler(e);
      sc.set(scl, scl, scl);
      pv.set(bx[i], heightAt(bx[i], bz[i]), bz[i]);
      m4.compose(pv, qt, sc);
      mesh.setMatrixAt(i, m4);
      const br = 0.78 + rng.float() * 0.4;
      if (def.kind === 'rohirrim') color.setHex(HORSE_COATS[Math.floor(rng.float() * HORSE_COATS.length)]).multiplyScalar(1.6 * br);
      else color.setRGB(br * (0.95 + rng.float() * 0.1), br, br * (0.95 + rng.float() * 0.1));
      mesh.setColorAt(i, color);
      ia[i * 4] = rng.float(); // gait phase offset (cycles)
      ia[i * 4 + 1] = 0.88 + rng.float() * 0.26; // cadence scale
      ia[i * 4 + 2] = -1; // fall start (s), -1 alive
      ia[i * 4 + 3] = rng.float(); // random
    }
    const inst = new THREE.InstancedBufferAttribute(ia, 4);
    inst.setUsage(THREE.DynamicDrawUsage);
    // per-instance attribute must live on the instanced geometry; clone the shared geometry shell
    const g2 = geo.clone();
    g2.setAttribute('aInst', inst);
    mesh.geometry = g2;
    mesh.userData.ownGeo = true;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    group.add(mesh);
    insts.push({ mesh, n, bx, bz, yawScale: ys, alive: new Uint8Array(n).fill(1), inst });
  });

  // ── animation clock (real time; multiple render passes per frame just add their small dts) ──
  let speed = def.speed ?? 0;
  let dist = 0;
  let last = performance.now();
  let lastUpdate = 0;
  let aliveCount = insts.reduce((s, i) => s + i.n, 0);
  const t0 = last;
  const tick = (): void => {
    const now = performance.now();
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    uniforms.uTime.value = (now - t0) / 1000;
    const move = Math.max(0, Math.min(1, (speed - 0.2) / 2.3));
    const run = Math.max(0, Math.min(1, (speed - 3) / 5));
    uniforms.uMove.value += (move - uniforms.uMove.value) * Math.min(1, dt * 3);
    uniforms.uRun.value += (run - uniforms.uRun.value) * Math.min(1, dt * 3);
    const cadence = speed > 0.2 ? 1.1 + speed * 0.3 : 0.4;
    uniforms.uPhase.value += dt * cadence;
    if (speed > 0.05) {
      dist += speed * dt;
      if (now - lastUpdate > 20) {
        lastUpdate = now;
        for (const vi of insts) {
          const arr = vi.mesh.instanceMatrix.array as Float32Array;
          for (let i = 0; i < vi.n; i++) {
            if (!vi.alive[i]) continue;
            const x = vi.bx[i] + dirX * dist;
            const z = vi.bz[i] + dirZ * dist;
            const o = i * 16;
            arr[o + 12] = x;
            arr[o + 13] = heightAt(x, z);
            arr[o + 14] = z;
          }
          vi.mesh.instanceMatrix.needsUpdate = true;
        }
      }
    }
  };
  for (const vi of insts) vi.mesh.onBeforeRender = tick;
  if (insts.length) {
    // only the first mesh needs to tick; the others share the uniforms
    for (let i = 1; i < insts.length; i++) insts[i].mesh.onBeforeRender = () => {};
  }

  let disposed = false;
  const handle: CrowdHandle = {
    mesh: group,
    setSpeed(v: number) {
      speed = Math.max(0, v);
    },
    thin(frac: number) {
      const aliveList: [VariantInst, number][] = [];
      for (const vi of insts) for (let i = 0; i < vi.n; i++) if (vi.alive[i]) aliveList.push([vi, i]);
      const kill = Math.min(aliveList.length, Math.floor(aliveList.length * Math.max(0, Math.min(1, frac))));
      for (let k = 0; k < kill; k++) {
        const j = k + Math.floor(rng.float() * (aliveList.length - k));
        [aliveList[k], aliveList[j]] = [aliveList[j], aliveList[k]];
        const [vi, i] = aliveList[k];
        vi.alive[i] = 0;
        vi.inst.setZ(i, uniforms.uTime.value + rng.float() * 0.9);
        vi.inst.needsUpdate = true;
      }
      aliveCount -= kill;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const vi of insts) {
        vi.mesh.geometry.dispose();
        vi.mesh.dispose();
      }
      material.dispose();
      group.removeFromParent();
      void aliveCount;
    },
  };
  return handle;
}
