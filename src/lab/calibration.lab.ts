import * as THREE from 'three';
import type { LabSubject } from '../core/types';

/** Calibration subject: PBR spheres (roughness/metalness ramp) + a 1.85 m capsule. Verifies lab lighting. */
export const subjects: LabSubject[] = [
  {
    name: 'calibration',
    category: 'prop',
    create() {
      const g = new THREE.Group();
      const body = new THREE.Mesh(
        new THREE.CapsuleGeometry(0.22, 1.85 - 0.44, 8, 24),
        new THREE.MeshStandardMaterial({ color: 0x6b7a4f, roughness: 0.7 }),
      );
      body.position.y = 1.85 / 2;
      body.castShadow = true;
      g.add(body);
      for (let i = 0; i < 5; i++) {
        const s = new THREE.Mesh(
          new THREE.SphereGeometry(0.15, 32, 16),
          new THREE.MeshStandardMaterial({ color: 0xb08d57, roughness: i / 4, metalness: i % 2 }),
        );
        s.position.set(0.5 + i * 0.35, 0.15, 0);
        s.castShadow = true;
        g.add(s);
      }
      return {
        object: g,
        height: 1.85,
        animations: ['idle', 'bob'],
        pose(anim, t) {
          body.position.y = 1.85 / 2 + (anim === 'bob' ? Math.abs(Math.sin(t * 4)) * 0.3 : 0);
        },
      };
    },
  },
];
