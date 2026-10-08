/**
 * Lab subjects for the Barrel Escape: a dwarf waist-deep in his barrel (the four dwarf looks), and a
 * short convoy of them. Animations: 'float' (the barrel pose, bobbing and rolling), 'jolt' (a rock bump).
 */
import * as THREE from 'three';
import type { LabInstance, LabSubject } from '../../../core/types';
import { createHumanoid } from '../../../creatures/humanoid';
import { barrel } from '../../../world';

const BARREL_H = 1.2;

function barrelDwarf(seed: number): { group: THREE.Group; pose(anim: string, t: number): void; dispose(): void } {
  const group = new THREE.Group();
  const b = barrel({ height: BARREL_H, open: true, seed: 5 });
  const dwarf = createHumanoid({ kind: 'dwarf', seed, weapon: 'none', offhand: 'none' });
  dwarf.root.position.set(0, BARREL_H - 0.12 - dwarf.height * 0.5, 0);
  group.add(b.object, dwarf.root);
  return {
    group,
    pose(anim, t) {
      const bob = Math.sin(t * 1.7) * 0.09;
      const jolt = anim === 'jolt' ? Math.max(0, 1 - t) : 0;
      group.position.y = bob + jolt * 0.12;
      group.rotation.x = Math.sin(t * 1.4) * 0.05 + jolt * 0.28 * Math.sin(t * 22);
      group.rotation.z = Math.sin(t * 1.1 + 1) * 0.06;
      group.rotation.y = t * 0.3;
      dwarf.animate(1 / 60, { speed: 0, grounded: true, special: 'barrel', specialT: t * 0.22 });
    },
    dispose() {
      dwarf.dispose();
    },
  };
}

function subject(name: string, seed: number): LabSubject {
  return {
    name,
    category: 'prop',
    create(): LabInstance {
      const bd = barrelDwarf(seed);
      return { object: bd.group, height: 1.9, animations: ['float', 'jolt'], pose: (a, t) => bd.pose(a, t), dispose: () => bd.dispose() };
    },
  };
}

export const subjects: LabSubject[] = [
  subject('barrel_dwarf_a', 0),
  subject('barrel_dwarf_b', 7),
  subject('barrel_dwarf_c', 14),
  subject('barrel_dwarf_d', 21),
  {
    name: 'barrel_train',
    category: 'prop',
    create(): LabInstance {
      const g = new THREE.Group();
      const items = [0, 1, 2, 3, 4].map((i) => {
        const bd = barrelDwarf(i * 7);
        bd.group.position.set((i % 3 - 1) * 2.4, 0, -i * 2.2);
        g.add(bd.group);
        return bd;
      });
      return {
        object: g,
        height: 2.4,
        animations: ['float'],
        pose(anim, t) {
          items.forEach((bd, i) => {
            const y = bd.group.position.y;
            bd.pose(anim, t + i * 0.7);
            void y;
          });
        },
        dispose: () => items.forEach((b) => b.dispose()),
      };
    },
  },
];
