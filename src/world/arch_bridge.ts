/** Generic bridges along a path: timber trestle, sagging rope-and-plank, and stone slab bridges. */
import * as THREE from 'three';
import { Rng, hashSeed } from '../core/rng';
import { mat, plain } from './mats';
import { limbGeo } from './geom';
import { MeshKit } from './util';
import type { PathPoint } from './util';
import { Path } from './path';
import type { Built, ColliderDesc } from './colliders';
import { stoneMat } from './arch_common';

export interface BridgeOpts {
  kind?: 'wood' | 'rope' | 'stone';
  rails?: boolean;
  /** rope bridges: sag in metres at the middle */
  sag?: number;
  /** depth of supports below the deck */
  depth?: number;
  seed?: number;
}

/** plank / rope / stone bridge along a path. World coordinates (object at the origin). Deck top follows the path's y. */
export function bridge(points: PathPoint[], width = 3, o: BridgeOpts = {}): Built & { path: Path } {
  const kind = o.kind ?? 'wood';
  const rope = kind === 'rope';
  const smooth = rope;
  const p = new Path(points, { smooth, step: rope ? 1.0 : 1e9 });
  const rng = new Rng(hashSeed('bridge', kind, o.seed ?? 1, width));
  const kit = new MeshKit();
  const planks = mat('wood_planks', { key: 'bridge', rgb: [0.78, 0.7, 0.58] });
  const dark = mat('old_wood', { key: 'bridge' });
  const stone = stoneMat('dark');
  const light = stoneMat('light');
  const ropeM = plain(0x6a5a3a, { roughness: 1, key: 'rope' });
  const colliders: ColliderDesc[] = [];
  const depth = o.depth ?? 6;
  const sag = o.sag ?? 0;
  const L = p.length;
  const yAt = (s: number, base: number) => base - (rope ? sag * Math.sin(Math.PI * Math.min(1, Math.max(0, s / L))) : 0);
  for (let i = 0; i < p.pts.length - 1; i++) {
    const a = p.pts[i].clone();
    const b = p.pts[i + 1].clone();
    const sa = rope ? (i / (p.pts.length - 1)) * L : 0;
    const sb = rope ? ((i + 1) / (p.pts.length - 1)) * L : 0;
    if (rope) {
      a.y = yAt(sa, a.y);
      b.y = yAt(sb, b.y);
    }
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const l = Math.hypot(dx, dz);
    if (l < 0.01) continue;
    const yaw = Math.atan2(-dz, dx);
    const cx = (a.x + b.x) / 2;
    const cz = (a.z + b.z) / 2;
    const cy = (a.y + b.y) / 2;
    const pitch = Math.atan2(b.y - a.y, l);
    const nx = -dz / l;
    const nz = dx / l;
    const deckT = kind === 'stone' ? 1.0 : 0.16;
    kit.box(kind === 'stone' ? stone : planks, [l + 0.1, deckT, width], [cx, cy - deckT / 2, cz], yaw, { tile: kind === 'stone' ? 3 : 1.2 }, [0, pitch]);
    if (Math.abs(pitch) < 0.2) colliders.push({ kind: 'box', center: [cx, cy - deckT / 2, cz], half: [l / 2 + 0.05, deckT / 2, width / 2], yaw, opts: { material: kind === 'stone' ? 'stone' : 'wood', tag: 'bridge' } });
    else colliders.push({ kind: 'box', center: [cx, cy - deckT / 2, cz], half: [l / 2 + 0.05, deckT / 2, width / 2], yaw, opts: { material: kind === 'stone' ? 'stone' : 'wood', tag: 'bridge' } });
    if (kind !== 'stone') {
      for (const side of [-1, 1]) kit.box(dark, [l + 0.1, 0.22, 0.2], [cx + nx * side * (width / 2 - 0.1), cy - 0.26, cz + nz * side * (width / 2 - 0.1)], yaw, { tile: 0.8 }, [0, pitch]);
      kit.box(dark, [0.18, 0.2, width + 0.2], [a.x, a.y - 0.26, a.z], yaw + Math.PI / 2, { tile: 0.8 });
    } else {
      for (const side of [-1, 1]) {
        kit.box(stone, [l + 0.1, 1.0, 0.55], [cx + nx * side * (width / 2 - 0.27), cy + 0.5, cz + nz * side * (width / 2 - 0.27)], yaw, { tile: 2 }, [0, pitch]);
        colliders.push({ kind: 'box', center: [cx + nx * side * (width / 2 - 0.27), cy + 0.5, cz + nz * side * (width / 2 - 0.27)], half: [l / 2 + 0.05, 0.5, 0.275], yaw, opts: { material: 'stone', walkable: false, tag: 'bridge_rail' } });
        kit.box(light, [l + 0.1, 0.14, 0.7], [cx + nx * side * (width / 2 - 0.27), cy + 1.05, cz + nz * side * (width / 2 - 0.27)], yaw, { tile: 2 }, [0, pitch]);
      }
    }
    // posts + ropes every 2.5 m
    if (o.rails !== false && kind !== 'stone') {
      const step = rope ? 3 : 2;
      if (i % step === 0) {
        for (const side of [-1, 1]) {
          const px = a.x + nx * side * (width / 2 - 0.1);
          const pz = a.z + nz * side * (width / 2 - 0.1);
          kit.add(dark, limbGeo([px, a.y - 0.2, pz], [px, a.y + 1.05, pz], 0.05, 0.045, 6, 0.6));
        }
      }
      for (const side of [-1, 1]) {
        const ox = nx * side * (width / 2 - 0.1);
        const oz = nz * side * (width / 2 - 0.1);
        kit.add(rope ? ropeM : dark, limbGeo([a.x + ox, a.y + 1.0, a.z + oz], [b.x + ox, b.y + 1.0, b.z + oz], 0.03, 0.03, 4, 0.5));
        kit.add(rope ? ropeM : dark, limbGeo([a.x + ox, a.y + 0.5, a.z + oz], [b.x + ox, b.y + 0.5, b.z + oz], 0.025, 0.025, 4, 0.5));
      }
    }
  }
  // supports
  if (kind === 'wood') {
    for (let s = 3; s < L - 1; s += 6) {
      const q = p.at(s);
      const tg = p.tangent(s);
      const nx = -tg.z;
      const nz = tg.x;
      for (const side of [-1, 1]) {
        const px = q.x + nx * side * (width / 2 - 0.1);
        const pz = q.z + nz * side * (width / 2 - 0.1);
        kit.add(dark, limbGeo([px, q.y - 0.3, pz], [px + nx * side * 0.9, q.y - depth, pz + nz * side * 0.9], 0.14, 0.18, 7, 0.8));
        colliders.push({ kind: 'cyl', x: px + nx * side * 0.45, z: pz + nz * side * 0.45, r: 0.2, y0: q.y - depth, y1: q.y - 0.4, opts: { walkable: false, material: 'wood', tag: 'support' } });
      }
      kit.add(dark, limbGeo([q.x - nx * (width / 2 + 0.6), q.y - depth * 0.55, q.z - nz * (width / 2 + 0.6)], [q.x + nx * (width / 2 + 0.6), q.y - depth * 0.55, q.z + nz * (width / 2 + 0.6)], 0.09, 0.09, 6, 0.8));
    }
  } else if (kind === 'stone') {
    for (let s = 0; s <= L; s += 9) {
      const q = p.at(s);
      kit.box(stone, [1.6, depth, width + 0.5], [q.x, q.y - 1.0 - depth / 2, q.z], Math.atan2(-p.tangent(s).z, p.tangent(s).x), { tile: 3 });
    }
  }
  void rng;
  return { object: kit.build({ name: `bridge_${kind}` }), colliders, path: p };
}
