/**
 * Weapon emblem atlas — one small canvas texture (drawn in code, no asset files) that holds the
 * painted faces of the shields: the Rohan horse, the white tree of Gondor and Saruman's white hand.
 *
 * Every weapon keeps ONE draw call: the weapon material samples this atlas, and every vertex that has
 * no `uv` attribute reads the white texel at uv (0,0), so only the shield faces see the paint. Regions
 * are painted lazily the first time a shield of that emblem is built.
 *
 * Layout (px, 1024²):  rohan 512,0,512,512 · gondor 0,400,256,584 · uruk 264,400,244,584 · orc 520,524,248,248 · easterling 776,524,244,480 · haradrim 524,780,240,240 · white 0,992,32,32 (uv (0,0) is the bottom-left
 * corner of the canvas, because the texture is flipped)
 */
import * as THREE from 'three';
import { Rng } from '../core/rng';

export type Emblem = 'rohan' | 'gondor' | 'uruk' | 'orc' | 'easterling' | 'haradrim';
export interface AtlasRect { x: number; y: number; w: number; h: number }

const SIZE = 1024;
export const ATLAS_RECTS: Record<Emblem, AtlasRect> = {
  rohan: { x: 512, y: 0, w: 512, h: 512 },
  gondor: { x: 0, y: 400, w: 256, h: 584 },
  uruk: { x: 264, y: 400, w: 244, h: 584 },
  orc: { x: 520, y: 524, w: 248, h: 248 },
  easterling: { x: 776, y: 524, w: 244, h: 480 },
  haradrim: { x: 524, y: 780, w: 240, h: 240 },
};

interface Atlas {
  canvas: HTMLCanvasElement | null;
  texture: THREE.CanvasTexture | null;
  painted: Set<Emblem>;
}
let atlas: Atlas | null = null;

function getAtlas(): Atlas {
  if (atlas) return atlas;
  atlas = { canvas: null, texture: null, painted: new Set() };
  if (typeof document === 'undefined') return atlas;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) return atlas;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, SIZE, SIZE);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.anisotropy = 4;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.userData.shared = true;
  atlas.canvas = canvas;
  atlas.texture = tex;
  return atlas;
}

/** the shared atlas texture (white everywhere until an emblem is painted) */
export function atlasTexture(): THREE.Texture | null {
  return getAtlas().texture;
}

/** uv of a point (0..1 across, 0..1 up) inside an emblem's region (v up, flipY canvas) */
export function emblemUV(e: Emblem, a: number, up: number): [number, number] {
  const r = ATLAS_RECTS[e];
  return [(r.x + Math.min(1, Math.max(0, a)) * r.w) / SIZE, 1 - (r.y + (1 - Math.min(1, Math.max(0, up))) * r.h) / SIZE];
}

/** paint (once) an emblem's region of the atlas */
export function ensureEmblem(e: Emblem): void {
  const A = getAtlas();
  if (!A.canvas || A.painted.has(e)) return;
  A.painted.add(e);
  const ctx = A.canvas.getContext('2d')!;
  const r = ATLAS_RECTS[e];
  ctx.save();
  ctx.beginPath();
  ctx.rect(r.x, r.y, r.w, r.h);
  ctx.clip();
  ctx.translate(r.x, r.y);
  if (e === 'rohan') paintRohan(ctx, r.w, r.h);
  else if (e === 'gondor') paintGondor(ctx, r.w, r.h);
  else if (e === 'uruk') paintUruk(ctx, r.w, r.h);
  else if (e === 'orc') paintOrc(ctx, r.w, r.h);
  else if (e === 'easterling') paintEasterling(ctx, r.w, r.h);
  else paintHaradrim(ctx, r.w, r.h);
  ctx.restore();
  A.texture!.needsUpdate = true;
}

type Ctx = CanvasRenderingContext2D;

/** smooth closed curve through points (midpoint quadratic splines) */
function blob(ctx: Ctx, pts: [number, number][], sx: number, sy: number) {
  const n = pts.length;
  const P = (i: number) => pts[(i + n) % n];
  ctx.beginPath();
  ctx.moveTo(((P(0)[0] + P(1)[0]) / 2) * sx, ((P(0)[1] + P(1)[1]) / 2) * sy);
  for (let i = 1; i <= n; i++) {
    const a = P(i), b = P(i + 1);
    ctx.quadraticCurveTo(a[0] * sx, a[1] * sy, ((a[0] + b[0]) / 2) * sx, ((a[1] + b[1]) / 2) * sy);
  }
  ctx.closePath();
}

/** worn paint: scratches, chips and grime over a painted face */
function weather(ctx: Ctx, w: number, h: number, seed: number, chip: string, scratch: string, amount: number) {
  const rnd = new Rng(seed);
  // large faded patches
  for (let i = 0; i < 16 * amount; i++) {
    const x = rnd.range(0, w), y = rnd.range(0, h), r = rnd.range(8, 46);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, chip.replace('A', String(rnd.range(0.1, 0.38))));
    g.addColorStop(1, chip.replace('A', '0'));
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  // chips: small ragged flecks
  ctx.fillStyle = chip.replace('A', '0.62');
  for (let i = 0; i < 260 * amount; i++) {
    const x = rnd.range(0, w), y = rnd.range(0, h), r = rnd.range(1, 4.5);
    ctx.beginPath();
    ctx.ellipse(x, y, r * rnd.range(0.6, 1.6), r, rnd.range(0, 3), 0, Math.PI * 2);
    ctx.fill();
  }
  // scratches
  ctx.strokeStyle = scratch;
  for (let i = 0; i < 90 * amount; i++) {
    const x = rnd.range(0, w), y = rnd.range(0, h);
    const a = rnd.range(-0.5, 0.5) + (rnd.chance(0.5) ? 0 : Math.PI / 2);
    const l = rnd.range(10, 60);
    ctx.lineWidth = rnd.range(0.6, 1.6);
    ctx.globalAlpha = rnd.range(0.15, 0.5);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

// ─────────────────────────────────────────────────────────────────────────────
// Rohan: green planks, a rearing cream horse, an iron-brown rim
// ─────────────────────────────────────────────────────────────────────────────
function paintRohan(ctx: Ctx, w: number, h: number) {
  const rnd = new Rng(11);
  ctx.fillStyle = '#4a3a28';
  ctx.fillRect(0, 0, w, h);
  // planks
  const planks = 7;
  for (let i = 0; i < planks; i++) {
    const x0 = (i / planks) * w, x1 = ((i + 1) / planks) * w;
    const k = rnd.range(0.85, 1.12);
    ctx.fillStyle = `rgb(${Math.round(42 * k)},${Math.round(70 * k)},${Math.round(40 * k)})`;
    ctx.fillRect(x0, 0, x1 - x0, h);
    // grain
    ctx.strokeStyle = 'rgba(15,28,14,0.35)';
    for (let g = 0; g < 14; g++) {
      ctx.lineWidth = rnd.range(0.6, 1.6);
      const gx = rnd.range(x0 + 3, x1 - 3);
      ctx.beginPath();
      ctx.moveTo(gx, 0);
      ctx.lineTo(gx + rnd.range(-4, 4), h);
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(8,14,8,0.65)';
    ctx.fillRect(x0 - 1, 0, 2.4, h);
  }
  // the rearing horse (facing left), cream paint: built from thick round-capped strokes and ellipses.
  // Drawn at its natural aspect (uniform scale) and centred, fully inside the rim, with the boss on its barrel.
  ctx.save();
  ctx.translate(w * 0.06, h * 0.084);
  ctx.scale(0.8, 0.8);
  const cream = '#d2c294';
  ctx.fillStyle = cream;
  ctx.strokeStyle = cream;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const S = (x: number) => x * w;
  const limb = (pts: [number, number][], w0: number, w1: number) => {
    for (let i = 0; i + 1 < pts.length; i++) {
      const t = i / (pts.length - 1);
      ctx.lineWidth = S(w0 + (w1 - w0) * t);
      ctx.beginPath();
      ctx.moveTo(S(pts[i][0]), S(pts[i][1]));
      ctx.lineTo(S(pts[i + 1][0]), S(pts[i + 1][1]));
      ctx.stroke();
    }
  };
  const ell = (x: number, y: number, rx: number, ry: number, rot: number) => {
    ctx.beginPath();
    ctx.ellipse(S(x), S(y), S(rx), S(ry), rot, 0, Math.PI * 2);
    ctx.fill();
  };
  ell(0.57, 0.52, 0.2, 0.105, -0.75); // barrel, chest up, rump down
  ell(0.68, 0.6, 0.1, 0.1, 0); // haunch
  limb([[0.47, 0.44], [0.41, 0.34], [0.375, 0.24]], 0.115, 0.08); // neck
  ell(0.35, 0.215, 0.085, 0.043, 0.95); // head, muzzle down and left
  ell(0.315, 0.255, 0.03, 0.026, 0.5); // muzzle
  blob(ctx, [[0.385, 0.18], [0.395, 0.115], [0.418, 0.105], [0.425, 0.18]], w, w); // ear
  ctx.fill();
  // forelegs: one folded high, one reaching down
  limb([[0.5, 0.5], [0.4, 0.5], [0.3, 0.44], [0.26, 0.5]], 0.05, 0.03);
  limb([[0.5, 0.58], [0.42, 0.65], [0.34, 0.69], [0.31, 0.77]], 0.05, 0.03);
  // hind legs: planted
  limb([[0.7, 0.66], [0.68, 0.78], [0.62, 0.86], [0.6, 0.93]], 0.075, 0.032);
  limb([[0.62, 0.66], [0.56, 0.78], [0.5, 0.86], [0.47, 0.92]], 0.065, 0.03);
  for (const [hx, hy] of [[0.6, 0.935], [0.47, 0.925], [0.31, 0.775], [0.26, 0.505]] as [number, number][]) ell(hx, hy, 0.022, 0.014, 0.4);
  // mane and tail: long sweeping strands
  const strands = (x0: number, y0: number, dx: number, dy: number, n: number, l: number, wave: number) => {
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      const sx = x0 + dx * t, sy = y0 + dy * t;
      ctx.lineWidth = S(rnd.range(0.008, 0.016));
      ctx.beginPath();
      ctx.moveTo(S(sx), S(sy));
      const ll = l * rnd.range(0.7, 1.15);
      ctx.bezierCurveTo(S(sx + ll * 0.35), S(sy - wave), S(sx + ll * 0.65), S(sy + wave * 1.4), S(sx + ll), S(sy + wave * 0.5 + rnd.range(0, 0.06)));
      ctx.stroke();
    }
  };
  strands(0.41, 0.2, 0.08, 0.17, 12, 0.3, 0.05);
  for (let i = 0; i < 9; i++) {
    const sx = 0.76 + i * 0.004, sy = 0.5 + i * 0.012;
    ctx.lineWidth = S(rnd.range(0.011, 0.018));
    ctx.beginPath();
    ctx.moveTo(S(sx), S(sy));
    ctx.bezierCurveTo(S(sx + 0.12), S(sy + 0.04), S(sx + 0.14), S(sy + 0.2), S(sx + 0.05 + i * 0.006), S(sy + 0.33 + rnd.range(0, 0.06)));
    ctx.stroke();
  }
  // dark line work: eye, nostril, muscle lines
  ctx.strokeStyle = '#2a2418';
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  ctx.arc(S(0.36), S(0.2), S(0.006), 0, 7);
  ctx.moveTo(S(0.5), S(0.43));
  ctx.quadraticCurveTo(S(0.6), S(0.5), S(0.66), S(0.55));
  ctx.stroke();
  ctx.restore();
  // iron rim ring (the mesh rim covers the outer edge; the paint under it is dark iron)
  const rr = ctx.createRadialGradient(w / 2, h / 2, w * 0.455, w / 2, h / 2, w * 0.5);
  rr.addColorStop(0, 'rgba(40,34,28,0)');
  rr.addColorStop(0.3, 'rgba(56,48,40,1)');
  rr.addColorStop(1, 'rgba(56,48,40,1)');
  ctx.fillStyle = rr;
  ctx.fillRect(0, 0, w, h);
  // worn paint showing wood
  weather(ctx, w, h, 5, 'rgba(92,74,50,A)', 'rgba(200,190,150,1)', 1);
  // studs along the rim
  for (let i = 0; i < 30; i++) {
    const a = (i / 30) * Math.PI * 2;
    const x = w / 2 + Math.cos(a) * w * 0.475, y = h / 2 + Math.sin(a) * h * 0.475;
    ctx.fillStyle = 'rgba(20,16,12,0.8)';
    ctx.beginPath();
    ctx.arc(x + 1, y + 1.5, 4.6, 0, 7);
    ctx.fill();
    ctx.fillStyle = '#8a7a64';
    ctx.beginPath();
    ctx.arc(x, y, 4, 0, 7);
    ctx.fill();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Gondor: black field, silver tree (trunk, roots, branching crown, leaves)
// ─────────────────────────────────────────────────────────────────────────────
function paintGondor(ctx: Ctx, w: number, h: number) {
  const rnd = new Rng(21);
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, '#2e2f32');
  g.addColorStop(0.5, '#222325');
  g.addColorStop(1, '#2a2b2d');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  // hammered plate: soft dents
  for (let i = 0; i < 160; i++) {
    const x = rnd.range(0, w), y = rnd.range(0, h), r = rnd.range(6, 22);
    const d = ctx.createRadialGradient(x, y, 0, x, y, r);
    d.addColorStop(0, rnd.chance(0.5) ? 'rgba(70,72,78,0.22)' : 'rgba(0,0,0,0.28)');
    d.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = d;
    ctx.fillRect(x - r, y - r, 2 * r, 2 * r);
  }
  // the White Tree
  const silver = '#d4d8dc';
  ctx.strokeStyle = silver;
  ctx.fillStyle = silver;
  ctx.lineCap = 'round';
  const cx = w * 0.5;
  const base = h * 0.76, crownY = h * 0.34;
  const leaves: [number, number][] = [];
  const branch = (x: number, y: number, ang: number, len: number, wd: number, depth: number) => {
    const x2 = x + Math.cos(ang) * len, y2 = y - Math.sin(ang) * len;
    ctx.lineWidth = Math.max(1.1, wd);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo((x + x2) / 2 + rnd.range(-3, 3), (y + y2) / 2, x2, y2);
    ctx.stroke();
    if (depth <= 0 || len < 9) {
      leaves.push([x2, y2]);
      return;
    }
    const n = depth > 3 ? 2 : rnd.chance(0.5) ? 3 : 2;
    for (let i = 0; i < n; i++) {
      const a = ang + (i - (n - 1) / 2) * rnd.range(0.55, 0.85) + rnd.range(-0.15, 0.15);
      branch(x2, y2, a, len * rnd.range(0.62, 0.78), wd * 0.66, depth - 1);
    }
  };
  // trunk: slightly flared, two main limbs
  ctx.lineWidth = w * 0.07;
  ctx.beginPath();
  ctx.moveTo(cx, base);
  ctx.quadraticCurveTo(cx + 3, (base + crownY) / 2 + 20, cx, crownY + 30);
  ctx.stroke();
  for (const a of [Math.PI / 2 + 0.5, Math.PI / 2 - 0.5, Math.PI / 2 + 0.15, Math.PI / 2 - 0.15, Math.PI / 2 + 1.0, Math.PI / 2 - 1.0]) branch(cx, crownY + 36, a, w * 0.22, w * 0.034, 4);
  // roots
  for (let i = 0; i < 7; i++) {
    const a = Math.PI + (i / 6) * Math.PI; // spread below
    const x2 = cx + Math.cos(a) * w * (0.15 + 0.06 * rnd.float()), y2 = base + Math.sin(-a) * h * 0.07 + h * 0.015;
    ctx.lineWidth = w * (0.03 - i % 2 * 0.01);
    ctx.beginPath();
    ctx.moveTo(cx, base - 8);
    ctx.quadraticCurveTo(cx + (x2 - cx) * 0.4, base + 6, x2, Math.min(h * 0.93, y2));
    ctx.stroke();
  }
  for (const [x, y] of leaves) {
    ctx.beginPath();
    ctx.ellipse(x, y, 3.6, 2.2, rnd.range(0, 3), 0, 7);
    ctx.fill();
  }
  // plate rim line and rivets
  ctx.strokeStyle = 'rgba(150,154,160,0.55)';
  ctx.lineWidth = 2;
  ctx.strokeRect(10, 10, w - 20, h - 20);
  weather(ctx, w, h, 8, 'rgba(120,124,130,A)', 'rgba(190,194,200,1)', 0.5);
}

// ─────────────────────────────────────────────────────────────────────────────
// Haradrim: concentric red, black and gold rings (their coat colours) round a gold boss
// ─────────────────────────────────────────────────────────────────────────────
function paintHaradrim(ctx: Ctx, w: number, h: number) {
  const cx = w / 2, cy = h / 2, R = w / 2;
  const ring = (r0: number, r1: number, col: string) => {
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.arc(cx, cy, r1 * R, 0, Math.PI * 2);
    ctx.arc(cx, cy, r0 * R, 0, Math.PI * 2, true);
    ctx.fill();
  };
  ctx.fillStyle = '#852d2a';
  ctx.fillRect(0, 0, w, h);
  ring(0.0, 0.5, '#8d302a');
  ring(0.5, 0.56, '#b58d3d');
  ring(0.56, 0.74, '#1e1b19');
  ring(0.74, 0.8, '#b58d3d');
  ring(0.8, 0.9, '#852d2a');
  ring(0.9, 1.01, '#24211f');
  // black spokes between the gold rings
  ctx.fillStyle = '#1e1b19';
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(a);
    ctx.fillRect(R * 0.18, -w * 0.012, R * 0.3, w * 0.024);
    ctx.restore();
  }
  weather(ctx, w, h, 23, 'rgba(60,40,28,A)', 'rgba(190,160,110,1)', 0.5);
}

// ─────────────────────────────────────────────────────────────────────────────
// Easterlings: a dark kite with a bronze edge line and a golden sunburst round a boss
// ─────────────────────────────────────────────────────────────────────────────
function paintEasterling(ctx: Ctx, w: number, h: number) {
  const rnd = new Rng(51);
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, '#2a2420');
  g.addColorStop(1, '#1a1614');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < 90; i++) {
    const x = rnd.range(0, w), y = rnd.range(0, h), r = rnd.range(6, 20);
    const d = ctx.createRadialGradient(x, y, 0, x, y, r);
    d.addColorStop(0, rnd.chance(0.5) ? 'rgba(90,70,44,0.2)' : 'rgba(0,0,0,0.3)');
    d.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = d;
    ctx.fillRect(x - r, y - r, 2 * r, 2 * r);
  }
  // sunburst: long and short rays fanning from the boss, low on the face
  const cx = w * 0.5, cy = h * 0.5;
  const gold = '#b8923a';
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2 + 0.07;
    const long = i % 2 === 0;
    const len = (long ? 0.46 : 0.3) * w * (0.85 + 0.2 * rnd.float()) * (Math.sin(a) < 0 ? 1.25 : 1.1);
    const hw = (long ? 0.06 : 0.045) * w;
    ctx.fillStyle = long ? gold : '#8a6a2a';
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a - 0.1) * w * 0.1, cy + Math.sin(a - 0.1) * w * 0.1);
    ctx.lineTo(cx + Math.cos(a) * len, cy + Math.sin(a) * len);
    ctx.lineTo(cx + Math.cos(a + 0.1) * w * 0.1, cy + Math.sin(a + 0.1) * w * 0.1);
    ctx.closePath();
    ctx.fill();
    void hw;
  }
  ctx.fillStyle = '#6a4e1c';
  ctx.beginPath();
  ctx.arc(cx, cy, w * 0.1, 0, 7);
  ctx.fill();
  ctx.fillStyle = '#c8a24a';
  ctx.beginPath();
  ctx.arc(cx - 2, cy - 2, w * 0.075, 0, 7);
  ctx.fill();
  // bronze edge line
  ctx.strokeStyle = 'rgba(176,140,60,0.7)';
  ctx.lineWidth = 3;
  ctx.strokeRect(9, 9, w - 18, h - 18);
  weather(ctx, w, h, 17, 'rgba(24,20,16,A)', 'rgba(170,140,90,1)', 0.8);
}

// ─────────────────────────────────────────────────────────────────────────────
// Orcs: crude dark planks, an iron band, a smeared red claw mark
// ─────────────────────────────────────────────────────────────────────────────
function paintOrc(ctx: Ctx, w: number, h: number) {
  const rnd = new Rng(41);
  ctx.fillStyle = '#1c1612';
  ctx.fillRect(0, 0, w, h);
  const planks = 5;
  for (let i = 0; i < planks; i++) {
    const x0 = (i / planks) * w, x1 = ((i + 1) / planks) * w;
    const k = rnd.range(0.7, 1.25);
    ctx.fillStyle = `rgb(${Math.round(44 * k)},${Math.round(34 * k)},${Math.round(26 * k)})`;
    ctx.fillRect(x0 + 1, 0, x1 - x0 - 2, h);
    ctx.strokeStyle = 'rgba(10,8,6,0.5)';
    for (let g = 0; g < 9; g++) {
      ctx.lineWidth = rnd.range(0.6, 1.8);
      const gx = rnd.range(x0 + 2, x1 - 2);
      ctx.beginPath();
      ctx.moveTo(gx, 0);
      ctx.lineTo(gx + rnd.range(-3, 3), h);
      ctx.stroke();
    }
  }
  // crude iron cross-bands
  for (const y of [0.3, 0.72]) {
    ctx.fillStyle = '#2e2b28';
    ctx.fillRect(0, y * h - 7, w, 14);
    ctx.fillStyle = '#5a554e';
    for (let i = 0; i < 6; i++) {
      ctx.beginPath();
      ctx.arc((i + 0.5) * (w / 6) + rnd.range(-3, 3), y * h, 2.6, 0, 7);
      ctx.fill();
    }
  }
  // a smeared red claw mark
  ctx.strokeStyle = '#7a1c12';
  ctx.lineCap = 'round';
  for (let i = 0; i < 3; i++) {
    ctx.lineWidth = rnd.range(9, 14);
    ctx.beginPath();
    ctx.moveTo(w * (0.34 + i * 0.14), h * 0.22);
    ctx.quadraticCurveTo(w * (0.38 + i * 0.14), h * 0.5, w * (0.3 + i * 0.16), h * 0.8);
    ctx.stroke();
  }
  // iron rim ring under the mesh rim
  const rr = ctx.createRadialGradient(w / 2, h / 2, w * 0.44, w / 2, h / 2, w * 0.5);
  rr.addColorStop(0, 'rgba(30,28,26,0)');
  rr.addColorStop(0.4, 'rgba(30,28,26,1)');
  rr.addColorStop(1, 'rgba(30,28,26,1)');
  ctx.fillStyle = rr;
  ctx.fillRect(0, 0, w, h);
  weather(ctx, w, h, 14, 'rgba(14,10,8,A)', 'rgba(150,130,100,1)', 0.7);
}

// ─────────────────────────────────────────────────────────────────────────────
// Uruk-hai: black iron, a white hand daubed in paint with drips
// ─────────────────────────────────────────────────────────────────────────────
function paintUruk(ctx: Ctx, w: number, h: number) {
  const rnd = new Rng(31);
  ctx.fillStyle = '#19191a';
  ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < 200; i++) {
    const x = rnd.range(0, w), y = rnd.range(0, h), r = rnd.range(5, 28);
    const d = ctx.createRadialGradient(x, y, 0, x, y, r);
    d.addColorStop(0, rnd.chance(0.5) ? 'rgba(80,78,74,0.2)' : 'rgba(0,0,0,0.35)');
    d.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = d;
    ctx.fillRect(x - r, y - r, 2 * r, 2 * r);
  }
  // rust streaks
  for (let i = 0; i < 14; i++) {
    const x = rnd.range(0, w), y = rnd.range(0, h * 0.8);
    ctx.fillStyle = `rgba(90,52,28,${rnd.range(0.12, 0.3)})`;
    ctx.fillRect(x, y, rnd.range(2, 6), rnd.range(30, 120));
  }
  // the white hand: palm, four spread fingers, thumb out to the left, wrist, daubed in paint
  const paint = '#d7d5cb';
  ctx.strokeStyle = paint;
  ctx.fillStyle = paint;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.save();
  ctx.translate(w * 0.5, h * 0.45);
  ctx.rotate(-0.1);
  ctx.scale(0.72, 0.72);
  ctx.beginPath();
  ctx.ellipse(0, 0, w * 0.2, w * 0.19, 0, 0, Math.PI * 2);
  ctx.fill();
  const finger = (x0: number, y0: number, ang: number, len: number, wd: number) => {
    ctx.lineWidth = wd;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x0 + Math.sin(ang) * len, y0 - Math.cos(ang) * len);
    ctx.stroke();
  };
  finger(-w * 0.135, -w * 0.12, -0.3, w * 0.4, w * 0.095);
  finger(-w * 0.045, -w * 0.15, -0.09, w * 0.5, w * 0.095);
  finger(w * 0.05, -w * 0.15, 0.06, w * 0.52, w * 0.095);
  finger(w * 0.14, -w * 0.11, 0.24, w * 0.42, w * 0.088);
  finger(-w * 0.17, w * 0.04, -1.05, w * 0.3, w * 0.1); // thumb
  ctx.lineWidth = w * 0.2;
  ctx.beginPath();
  ctx.moveTo(w * 0.005, w * 0.1);
  ctx.lineTo(w * 0.02, w * 0.36);
  ctx.stroke();
  // drips running off the paint
  for (let i = 0; i < 9; i++) {
    const x = rnd.range(-0.2, 0.2) * w, y0 = rnd.range(0.05, 0.3) * w;
    ctx.lineWidth = rnd.range(2.5, 5.5);
    ctx.beginPath();
    ctx.moveTo(x, y0);
    ctx.lineTo(x + rnd.range(-2, 2), y0 + rnd.range(30, 120));
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x, y0 + 5, 3.6, 0, 7);
    ctx.fill();
  }
  // knuckle creases
  ctx.strokeStyle = 'rgba(40,40,38,0.55)';
  ctx.lineWidth = 1.6;
  for (let i = 0; i < 4; i++) {
    ctx.beginPath();
    ctx.moveTo(-0.13 * w + i * 0.09 * w, -0.14 * w);
    ctx.lineTo(-0.12 * w + i * 0.09 * w, -0.1 * w);
    ctx.stroke();
  }
  ctx.restore();
  weather(ctx, w, h, 9, 'rgba(25,25,26,A)', 'rgba(120,118,112,1)', 1.2);
  // rivets along the plate edge
  for (let i = 0; i < 14; i++) {
    const y = h * (0.1 + 0.06 * i);
    for (const x of [14, w - 14]) {
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.beginPath();
      ctx.arc(x + 1, y + 1, 3.2, 0, 7);
      ctx.fill();
      ctx.fillStyle = '#4c4a44';
      ctx.beginPath();
      ctx.arc(x, y, 2.8, 0, 7);
      ctx.fill();
    }
  }
}
