/**
 * Kit demo subjects: 'kit_demo_spider', 'kit_demo_quadruped', 'kit_demo_bat'.
 * Chapter authors: start from src/creatures/kit/examples/*.ts (see README.md).
 */
import type { LabSubject } from '../../core/types';
import { createSpider } from './examples/spider';

export const subjects: LabSubject[] = [
  {
    name: 'kit_demo_spider',
    category: 'creature',
    create() {
      const d = createSpider(0, 1);
      console.info(`[lab] kit_demo_spider ${d.creature.triangles} tris, ${d.creature.buildMs.toFixed(0)} ms`);
      return { object: d.object, height: 1.1, animations: d.animations, pose: d.pose, dispose: () => d.creature.dispose() };
    },
  },
];
import { createWarg } from './examples/quadruped';
subjects.push({
  name: 'kit_demo_quadruped',
  category: 'creature',
  create() {
    const d = createWarg(0, 1);
    console.info(`[lab] kit_demo_quadruped ${d.creature.triangles} tris, ${d.creature.buildMs.toFixed(0)} ms`);
    return { object: d.object, height: 1.5, animations: d.animations, pose: d.pose, dispose: () => d.creature.dispose() };
  },
});
import { createBat } from './examples/bat';
subjects.push({
  name: 'kit_demo_bat',
  category: 'creature',
  create() {
    const d = createBat(0, 1);
    console.info(`[lab] kit_demo_bat ${d.creature.triangles} tris, ${d.creature.buildMs.toFixed(0)} ms`);
    return { object: d.object, height: 1.5, animations: d.animations, pose: d.pose, dispose: () => d.creature.dispose() };
  },
});
