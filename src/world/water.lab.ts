import * as THREE from 'three';
import type { LabSubject } from '../core/types';
import { fbm2 } from '../core/rng';
import { smoothstep } from '../core/math';
import { Path } from './path';
import { buildTerrain } from './terrain';
import { lake, river, setWaterTime } from './water';

function riverScene(rapids: boolean): THREE.Group {
  setWaterTime(3.0);
  const g = new THREE.Group();
  const pts: [number, number][] = [[-70, -40], [-30, -22], [0, 8], [30, 30], [70, 40], [110, 70]];
  const path = new Path(pts, { y: -0.2 });
  const widthAt = (s: number) => 9 + Math.sin(s * 0.05) * 2.5;
  const h = (x: number, z: number) => {
    const base = fbm2(x * 0.02, z * 0.02, 4, 5) * 3.5 + 1.2;
    const n = path.nearest(x, z);
    const w = widthAt(n.s) * 0.5;
    // carve a channel: bed at -1.8, banks ease out to the base over 7 m
    const bank = smoothstep(w * 0.8, w + 7, n.dist);
    return base * bank + -1.8 * (1 - bank) + (bank > 0 ? 0 : 0);
  };
  const terr = buildTerrain({ size: 260, segments: 260, height: h, style: 'riverbank', center: [20, 20] });
  g.add(terr.mesh);
  const rocks = rapids
    ? Array.from({ length: 10 }, (_, i) => {
        const s = 25 + i * 14;
        const p = path.at(s);
        const t = path.tangent(s);
        const off = Math.sin(i * 2.3) * 2.5;
        return { x: p.x - t.z * off, z: p.z + t.x * off, r: 0.8 + (i % 3) * 0.35 };
      })
    : [];
  for (const r of rocks) {
    const m = new THREE.Mesh(new THREE.IcosahedronGeometry(r.r, 1), new THREE.MeshStandardMaterial({ color: 0x5a5852, roughness: 0.9 }));
    m.position.set(r.x, -0.3 + r.r * 0.2, r.z);
    m.scale.y = 0.8;
    m.castShadow = true;
    g.add(m);
  }
  const w = river(pts, widthAt, { y: -0.2, terrain: terr.heightAt, rapids, rocks, depth: 1.6 });
  g.add(w.object);
  return g;
}

export const subjects: LabSubject[] = [
  { name: 'river_calm', category: 'environment', create: () => ({ object: riverScene(false), height: 8 }) },
  { name: 'river_rapids', category: 'environment', create: () => ({ object: riverScene(true), height: 8 }) },
  {
    name: 'lake',
    category: 'environment',
    create() {
      setWaterTime(2.0);
      const g = new THREE.Group();
      const w = lake({ center: [0, 0], radius: 120, y: 0 });
      g.add(w.object);
      return { object: g, height: 6 };
    },
  },
];
