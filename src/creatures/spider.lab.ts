/**
 * Lab subjects: 'spider' (Mirkwood spider, ~2.6 m leg span), 'spider_b' (second variation),
 * 'brood_mother' (~6 m span, scarred, pale markings) and 'spider_lineup' (both next to Legolas'
 * 1.85 m reference pole). Animations: see SPIDER_ANIMS in spider.ts.
 */
import * as THREE from 'three';
import type { LabSubject } from '../core/types';
import { createSpiderModel, SPIDER_ANIMS, type SpiderVariant } from './spider';

function subject(name: string, variant: SpiderVariant, seed: number, height: number): LabSubject {
  return {
    name,
    category: 'creature',
    create() {
      const m = createSpiderModel(variant, seed);
      console.info(`[lab] ${name} ${m.creature.triangles} tris, ${m.creature.buildMs.toFixed(0)} ms`);
      return { object: m.object, height, animations: SPIDER_ANIMS, pose: m.pose, dispose: () => m.dispose() };
    },
  };
}

export const subjects: LabSubject[] = [
  subject('spider', 'spider', 0, 1.3),
  subject('spider_b', 'spider', 1, 1.3),
  subject('brood_mother', 'brood', 0, 3.1),
  {
    name: 'spider_lineup',
    category: 'creature',
    create() {
      const g = new THREE.Group();
      const a = createSpiderModel('spider', 0);
      const b = createSpiderModel('brood', 0);
      a.object.position.set(-2.6, 0, 0);
      b.object.position.set(2.4, 0, 0);
      g.add(a.object, b.object);
      return {
        object: g,
        height: 3.1,
        animations: SPIDER_ANIMS,
        pose: (anim: string, t: number) => {
          a.pose(anim, t);
          b.pose(anim, t);
        },
        dispose: () => {
          a.dispose();
          b.dispose();
        },
      };
    },
  },
];
