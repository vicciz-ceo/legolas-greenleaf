import * as THREE from 'three';
import type { LabSubject, TerrainOpts } from '../core/types';
import { fbm2 } from '../core/rng';
import { buildTerrain } from './terrain';

const STYLES: TerrainOpts['style'][] = ['forest', 'riverbank', 'snow', 'rock', 'plains', 'ash', 'cave', 'mud'];

function hills(x: number, z: number): number {
  const base = fbm2(x * 0.02, z * 0.02, 4, 5) * 9;
  const ridge = Math.max(0, 1 - Math.abs(x * 0.03 + Math.sin(z * 0.03) * 0.5)) * 12;
  const bowl = Math.max(0, Math.hypot(x, z) - 40) * 0.6;
  return base + ridge + bowl;
}

export const subjects: LabSubject[] = STYLES.map((style) => ({
  name: `terrain_${style}`,
  category: 'environment' as const,
  create() {
    const t = buildTerrain({ size: 120, segments: 160, height: hills, style });
    const g = new THREE.Group();
    g.add(t.mesh);
    // 1.85 m markers to judge scale / detail
    for (const [x, z] of [[0, 0], [6, 4], [-8, 10]]) {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.85, 8), new THREE.MeshStandardMaterial({ color: 0xc0392b }));
      m.position.set(x, t.heightAt(x, z) + 0.925, z);
      g.add(m);
    }
    return { object: g, height: 20 };
  },
}));
