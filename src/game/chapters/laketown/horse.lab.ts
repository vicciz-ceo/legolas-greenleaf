/** Lab subjects for the Lake-town horse: 'lt_horse' (all gaits) and 'lt_horse_bolg' (Bolg riding it). */
import * as THREE from 'three';
import type { LabSubject } from '../../../core/types';
import { createHumanoid } from '../../../creatures/humanoid';
import { createHorseCreature } from './horse';

export const subjects: LabSubject[] = [
  {
    name: 'lt_horse',
    category: 'creature',
    create() {
      const d = createHorseCreature(1, 1.2);
      console.info(`[lab] lt_horse ${d.creature.triangles} tris, ${d.creature.buildMs.toFixed(0)} ms`);
      return { object: d.object, height: 2.5, animations: d.animations, pose: d.pose, dispose: () => d.creature.dispose() };
    },
  },
  {
    name: 'lt_horse_bolg',
    category: 'creature',
    create() {
      const d = createHorseCreature(1, 1.2);
      const bolg = createHumanoid({ kind: 'bolg', seed: 3, weapon: 'mace' });
      d.object.add(bolg.root);
      bolg.root.position.copy(d.seat);
      bolg.root.position.y -= 0.42;
      const anim = { speed: 0, moveDir: { x: 0, z: 1 }, grounded: true, vy: 0, aim: 0, draw: 0, aimPitch: 0, attack: null, hit: 0, dead: 0, deathVariant: 0, special: 'ride', specialT: 0, lookAt: null } as Parameters<typeof bolg.animate>[1];
      const g = new THREE.Group();
      g.add(d.object);
      return {
        object: g,
        height: 3.4,
        animations: d.animations,
        pose(a: string, t: number) {
          d.pose(a, t);
          bolg.animate(0.016, anim);
        },
        dispose: () => d.creature.dispose(),
      };
    },
  },
];
