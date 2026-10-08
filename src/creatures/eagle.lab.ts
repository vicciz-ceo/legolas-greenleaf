/**
 * Lab subjects for the Great Eagle: 'great_eagle' (golden-brown) with every animation, and
 * 'great_eagle_windlord' (the grey-white variant, scale 1.2). Try anim=fly|glide|soar|dive|flare|grab|screech|perch|hit|death.
 */
import type { LabSubject } from '../core/types';
import { createEagle } from './eagle';

export const subjects: LabSubject[] = [
  {
    name: 'great_eagle',
    category: 'creature',
    create() {
      const e = createEagle(0, 1);
      console.info(`[lab] great_eagle ${e.creature.triangles} tris, ${e.creature.buildMs.toFixed(0)} ms`);
      return { object: e.object, height: 6, animations: e.animations, pose: e.pose, dispose: () => e.dispose() };
    },
  },
  {
    name: 'great_eagle_windlord',
    category: 'creature',
    create() {
      const e = createEagle(1, 1.2);
      return { object: e.object, height: 7, animations: e.animations, pose: e.pose, dispose: () => e.dispose() };
    },
  },
];
