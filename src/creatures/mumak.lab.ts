/**
 * Lab subjects for the Mûmak (Chapter 8):
 *   mumak       hero mesh with the howdah, rope ladder and every animation
 *   mumak_far   the distant-herd LOD
 *   howdah      the war tower on its own
 */
import * as THREE from 'three';
import type { LabSubject } from '../core/types';
import { buildHowdah, createMumak, premeshMumak } from './mumak';

const ANIMS = ['idle', 'walk', 'walk_slow', 'trumpet', 'sweep', 'gore', 'stomp', 'thrash', 'kneel', 'collapse'];

export const subjects: LabSubject[] = [
  {
    name: 'mumak',
    category: 'creature',
    async create() {
      const t0 = performance.now();
      await premeshMumak('hero');
      const m = createMumak({ lod: 'hero' });
      console.info(`[lab] mumak ${m.creature.triangles} tris, ${(performance.now() - t0).toFixed(0)} ms`);
      return {
        object: m.object,
        height: 20,
        animations: ANIMS,
        pose: (anim, t) => m.animator.pose(anim, t),
        dispose: () => m.dispose(),
      };
    },
  },
  {
    name: 'mumak_bare',
    category: 'creature',
    async create() {
      await premeshMumak('hero');
      const m = createMumak({ lod: 'hero', howdah: false });
      return { object: m.object, height: 15, animations: ANIMS, pose: (anim, t) => m.animator.pose(anim, t), dispose: () => m.dispose() };
    },
  },
  {
    name: 'mumak_far',
    category: 'creature',
    async create() {
      await premeshMumak('far');
      const m = createMumak({ lod: 'far' });
      console.info(`[lab] mumak_far ${m.creature.triangles} tris`);
      return { object: m.object, height: 20, animations: ANIMS, pose: (anim, t) => m.animator.pose(anim, t), dispose: () => m.dispose() };
    },
  },
  {
    name: 'howdah',
    category: 'prop',
    create() {
      const h = buildHowdah();
      const g = new THREE.Group();
      g.add(h.object);
      return { object: g, height: 10 };
    },
  },
];
