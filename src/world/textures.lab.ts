import * as THREE from 'three';
import type { LabSubject } from '../core/types';
import { ALL_TEXTURE_SETS, makeMaterial, textureTimings, type TextureSetName } from './textures';

/** Lab: every texture set as a tiled panel (2x2 tiles, to judge seams) plus a sphere. `?sw=bark,rock` filters. */
function swatches(): THREE.Group {
  const g = new THREE.Group();
  const q = new URLSearchParams(location.search).get('sw');
  const names = (q ? (q.split(',') as TextureSetName[]) : [...ALL_TEXTURE_SETS]).filter((n) => ALL_TEXTURE_SETS.includes(n));
  const cols = Math.min(names.length, q ? 4 : 6);
  names.forEach((name, i) => {
    const cx = (i % cols) * 1.25;
    const cy = Math.floor(i / cols) * 1.75;
    const mat = makeMaterial(name, { repeat: [2, 2] });
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 1.1), mat);
    panel.position.set(cx, 1.15 + (names.length > cols ? 0 : 0), -cy * 0.0 - 0.3);
    panel.position.y = 1.05 + 1.75 * Math.floor((names.length - 1) / cols) - cy;
    g.add(panel);
    const sphere = new THREE.Mesh(new THREE.SphereGeometry(0.4, 48, 32), makeMaterial(name, { repeat: [1, 1] }));
    sphere.position.set(cx, panel.position.y - 0.95, 0.15);
    sphere.castShadow = sphere.receiveShadow = true;
    g.add(sphere);
    if (name === 'web') (mat as THREE.MeshStandardMaterial).alphaTest = 0.02;
  });
  const info = textureTimings();
  g.userData.timings = info;
  return g;
}

export const subjects: LabSubject[] = [
  {
    name: 'texture_swatches',
    category: 'environment',
    create() {
      const object = swatches();
      return { object, height: 8 };
    },
  },
];
