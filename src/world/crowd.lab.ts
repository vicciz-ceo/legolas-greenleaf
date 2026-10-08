import * as THREE from 'three';
import type { CrowdDef, LabSubject } from '../core/types';
import { createCrowd } from './crowd';

const KINDS: CrowdDef['kind'][] = ['orc', 'uruk', 'goblin', 'rohirrim', 'gondor', 'easterling', 'elf', 'dwarf'];

function make(kind: CrowdDef['kind'], count: number, half: [number, number], speed: number, props: boolean, thin = 0): THREE.Group {
  const g = new THREE.Group();
  const c = createCrowd(
    { center: new THREE.Vector3(0, 0, 0), halfSize: half, count, kind, facing: Math.PI, speed, props },
    () => 0,
  );
  if (thin > 0) c.thin(thin);
  g.add(c.mesh);
  g.userData.crowd = c;
  return g;
}

export const subjects: LabSubject[] = [
  ...KINDS.map((kind) => ({
    name: `crowd_${kind}`,
    category: 'environment' as const,
    create() {
      const n = kind === 'rohirrim' ? 6 : 12;
      return { object: make(kind, n, kind === 'rohirrim' ? [3, 3] : [2.4, 2.4], 0, true), height: 3.2 };
    },
  })),
  {
    name: 'crowd_army_orc',
    category: 'environment',
    create() {
      return { object: make('orc', 900, [40, 25], 0, true), height: 10 };
    },
  },
  {
    name: 'crowd_army_uruk_marching',
    category: 'environment',
    create() {
      return { object: make('uruk', 600, [30, 20], 3.5, true), height: 10 };
    },
  },
  {
    name: 'crowd_thin',
    category: 'environment',
    create() {
      const g = make('gondor', 120, [10, 6], 0, true, 0.5);
      return { object: g, height: 4 };
    },
  },
];
