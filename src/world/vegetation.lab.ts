import * as THREE from 'three';
import type { LabSubject } from '../core/types';
import { fbm2 } from '../core/rng';
import { getLeafAtlas } from './leafAtlas';
import { buildTerrain } from './terrain';
import { cocoon, ferns, forest, grassField, mushrooms, tree, TREE_KINDS, webCluster, webSheet } from './vegetation';
import { setWindTime } from './shader';

const flat = () => 0;

function atlasPlane(): THREE.Object3D {
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(4, 2),
    new THREE.MeshBasicMaterial({ map: getLeafAtlas(), alphaTest: 0.46, side: THREE.DoubleSide }),
  );
  m.position.y = 1;
  const bg = new THREE.Mesh(new THREE.PlaneGeometry(4.1, 2.1), new THREE.MeshBasicMaterial({ color: 0x8a8f96 }));
  bg.position.set(0, 1, -0.01);
  const g = new THREE.Group();
  g.add(bg, m);
  return g;
}

export const subjects: LabSubject[] = [
  ...TREE_KINDS.map((kind) => ({
    name: `tree_${kind}`,
    category: 'environment' as const,
    create() {
      setWindTime(1.3);
      const t = tree(kind, 0);
      return { object: t.object, height: t.height };
    },
  })),
  {
    name: 'leaf_atlas',
    category: 'environment',
    create: () => ({ object: atlasPlane(), height: 2 }),
  },
  {
    name: 'grass_patch',
    category: 'environment',
    create() {
      setWindTime(0.5);
      const g = new THREE.Group();
      g.add(grassField({ center: new THREE.Vector3(0, 0, 0), halfSize: [8, 8] }, 40, flat));
      g.add(ferns({ center: new THREE.Vector3(0, 0, 0), halfSize: [8, 8] }, 8, flat, { seed: 3 }));
      g.add(mushrooms({ center: new THREE.Vector3(0, 0, 0), halfSize: [6, 6] }, 14, flat, { seed: 5 }));
      return { object: g, height: 1 };
    },
  },
  {
    name: 'cocoon',
    category: 'environment',
    create() {
      const c = cocoon();
      c.position.y = 3.8;
      return { object: c, height: 4 };
    },
  },
  {
    name: 'web_sheet',
    category: 'environment',
    create() {
      const g = new THREE.Group();
      g.add(webSheet([[-1.5, 2.5, 0], [1.5, 2.5, 0], [1.2, 0.2, 0.3], [-1.2, 0.2, 0.3]], { sag: 0.5 }));
      return { object: g, height: 3 };
    },
  },
  {
    name: 'web_cluster',
    category: 'environment',
    create() {
      const g = new THREE.Group();
      g.add(webCluster([0, 2.5, 0], [4, 2.5, 4], 30, 2));
      return { object: g, height: 6 };
    },
  },
  {
    name: 'vignette_mirkwood',
    category: 'environment',
    create() {
      setWindTime(2.1);
      const g = new THREE.Group();
      const h = (x: number, z: number) => fbm2(x * 0.03, z * 0.03, 3, 11) * 2.2 + Math.sin(x * 0.11) * 0.25;
      const terr = buildTerrain({ size: 260, segments: 200, height: h, style: 'forest', theme: 'mirkwood' });
      g.add(terr.mesh);
      const area = { center: new THREE.Vector3(0, 0, 0), halfSize: [110, 110] as [number, number] };
      const clear = [{ x: 0, z: 8, r: 9 }];
      const nTrees = Number(new URLSearchParams(location.search).get('trees') ?? 70);
      const f = forest(area, nTrees, [{ kind: 'mirkwood_oak', weight: 3 }, { kind: 'dead', weight: 0.6 }], terr.heightAt, { seed: 4, clearings: clear, scale: [0.9, 1.2], leafTint: [0.9, 1, 0.9] });
      g.add(f.object);
      const open = (x: number, z: number) => Math.hypot(x, z - 8) < 6 && false;
      g.add(ferns(area, Number(new URLSearchParams(location.search).get('ferns') ?? 700), terr.heightAt, { seed: 2, exclude: open, tint: [0.55, 0.8, 0.5] }));
      g.add(mushrooms(area, 260, terr.heightAt, { seed: 7, glow: true, capTint: [0.8, 1.1, 1.1] }));
      g.add(grassField({ center: new THREE.Vector3(0, 0, 0), halfSize: [60, 60] }, 1.2, terr.heightAt, { color: 0x2a3a1c, tipColor: 0x607038, dry: 0.15 }));
      // a few cocoons hanging at the clearing's edge
      for (let i = 0; i < 4; i++) {
        const a = i * 1.7 + 0.4;
        const c = cocoon({ seed: i });
        c.position.set(Math.cos(a) * 10, 7 + terr.heightAt(Math.cos(a) * 10, 8 + Math.sin(a) * 10), 8 + Math.sin(a) * 10);
        g.add(c);
      }
      g.userData.forest = f;
      return { object: g, height: 40 };
    },
  },
  {
    name: 'vignette_woods',
    category: 'environment',
    create() {
      setWindTime(2.1);
      const g = new THREE.Group();
      const h = (x: number, z: number) => fbm2(x * 0.03, z * 0.03, 3, 21) * 3 + Math.sin(x * 0.07) * 0.4;
      const terr = buildTerrain({ size: 260, segments: 200, height: h, style: 'plains', patchiness: 0.5 });
      g.add(terr.mesh);
      const area = { center: new THREE.Vector3(0, 0, 0), halfSize: [90, 90] as [number, number] };
      const nTrees = Number(new URLSearchParams(location.search).get('trees') ?? 120);
      const f = forest(area, nTrees, [{ kind: 'beech', weight: 3 }, { kind: 'pine', weight: 2 }, { kind: 'birch', weight: 2 }, { kind: 'dead', weight: 0.4 }], terr.heightAt, { seed: 9, clearings: [{ x: 0, z: 8, r: 7 }] });
      g.add(f.object);
      g.add(grassField({ center: new THREE.Vector3(0, 0, 0), halfSize: [60, 60] }, 4, terr.heightAt, { dry: 0.2 }));
      g.add(ferns(area, Number(new URLSearchParams(location.search).get('ferns') ?? 500), terr.heightAt, { seed: 2 }));
      return { object: g, height: 30 };
    },
  },
];
