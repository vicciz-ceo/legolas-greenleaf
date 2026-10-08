/**
 * Lab subjects for the Fell Beast: 'fell_beast' (with the Nazgul rider) and 'fell_beast_bare'
 * (no rider). Animations: fly, glide, swoop, screech, hit, death, perch.
 */
import type { LabSubject } from '../core/types';
import { createFellBeast } from './fellbeast';

export const subjects: LabSubject[] = [
  {
    name: 'fell_beast',
    category: 'creature',
    create() {
      const f = createFellBeast(0, 1, true);
      console.info(`[lab] fell_beast ${f.creature.triangles} tris (+membranes), ${f.creature.buildMs.toFixed(0)} ms`);
      return { object: f.object, height: 9, animations: f.animations, pose: f.pose, dispose: () => f.dispose() };
    },
  },
  {
    name: 'fell_beast_bare',
    category: 'creature',
    create() {
      const f = createFellBeast(1, 1, false);
      return { object: f.object, height: 9, animations: f.animations, pose: f.pose, dispose: () => f.dispose() };
    },
  },
];
