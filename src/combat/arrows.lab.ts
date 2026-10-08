import * as THREE from 'three';
import type { LabSubject } from '../core/types';
import { buildArrowMesh, type ArrowStyle } from './projectiles';
import { disposeObject } from '../core/math';

/** The four pooled arrow styles (elven, orc, uruk, crossbow bolt), standing on their tips, plus one lying flat. */
export const subjects: LabSubject[] = [
  {
    name: 'arrows',
    category: 'prop',
    create() {
      const g = new THREE.Group();
      const styles: ArrowStyle[] = ['elven', 'orc', 'uruk', 'bolt'];
      styles.forEach((st, i) => {
        const a = buildArrowMesh(st);
        // stand on the tip, fletching up, slight lean
        a.rotation.x = Math.PI / 2;
        a.rotation.z = 0.05 * (i - 1.5);
        a.position.set((i - 1.5) * 0.14, 0, 0);
        g.add(a);
      });
      const flat = buildArrowMesh('elven');
      flat.rotation.y = Math.PI / 2;
      flat.position.set(-0.35, 0.02, 0.22);
      g.add(flat);
      return {
        object: g,
        height: 0.9,
        animations: ['idle', 'spin'],
        pose(anim, t) {
          g.rotation.y = anim === 'spin' ? t * 1.2 : 0;
        },
        dispose: () => disposeObject(g),
      };
    },
  },
];
