/**
 * Lab subjects for the Gundabad war bat (Ravenhill): 'gundabad_bat' with every animation, plus
 * 'gundabad_bat_rider' (the 'carry' pose with a 1.85 m Legolas-sized marker hanging from the talons).
 */
import * as THREE from 'three';
import type { LabSubject } from '../core/types';
import { createGundabadBat } from './bat';

export const subjects: LabSubject[] = [
  {
    name: 'gundabad_bat',
    category: 'creature',
    create() {
      const b = createGundabadBat(0, 1);
      console.info(`[lab] gundabad_bat ${b.creature.triangles} tris (+membranes), ${b.creature.buildMs.toFixed(0)} ms`);
      return { object: b.object, height: 2.2, animations: b.animations, pose: b.pose, dispose: () => b.dispose() };
    },
  },
  {
    name: 'gundabad_bat_rider',
    category: 'creature',
    create() {
      const g = new THREE.Group();
      const b = createGundabadBat(1, 1);
      b.object.position.y = 2.1;
      g.add(b.object);
      // a rider stand-in: 1.85 m capsule whose top (raised hands) hangs at the grip point
      const rider = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 1.45, 4, 10), new THREE.MeshStandardMaterial({ color: 0x5d6b48, roughness: 0.8 }));
      g.add(rider);
      const grip = new THREE.Vector3();
      const pose = (anim: string, t: number) => {
        b.pose(anim === 'idle' ? 'carry' : anim, t);
        g.updateMatrixWorld(true);
        b.gripPoint(grip);
        g.worldToLocal(grip);
        rider.position.set(grip.x, grip.y - 0.95, grip.z);
      };
      pose('carry', 0);
      return { object: g, height: 4.2, animations: ['carry', 'fly', 'swoop'], pose, dispose: () => b.dispose() };
    },
  },
];
