/**
 * The Mirkwood guard's glaive. WeaponKind has no glaive, so the guard carries the kit's `spear`
 * and this curved leaf-shaped blade is added over its head as a separate object parented to the
 * right-hand socket. It only shows while the right hand holds a spear (it checks the sockets'
 * children every frame), so a guard that carries a bow instead is unaffected.
 */
import * as THREE from 'three';
import { paintGeometry, mergeKitGeometries } from '../../../kit/geometry';
import { createCreatureMaterial } from '../../../kit/material';
import { surface } from '../../../kit/surfaces';
import type { KindContext } from '../../types';
import { leaf, ring } from './geo';

let mat: THREE.MeshPhysicalMaterial | null = null;
const geoCache = new Map<string, THREE.BufferGeometry>();

function material(): THREE.MeshPhysicalMaterial {
  if (!mat) {
    mat = createCreatureMaterial({ detailScale: 0.8, detailStrength: 1.0, side: THREE.DoubleSide });
    mat.userData.shared = true;
  }
  return mat;
}

function glaiveGeometry(blade: number, trim: number): THREE.BufferGeometry {
  const key = `${blade}|${trim}`;
  let g = geoCache.get(key);
  if (g) return g;
  const parts: THREE.BufferGeometry[] = [];
  // the blade: a long leaf, single-edged, swept back toward its tip
  const len = 0.66;
  const l = leaf(len, 0.052, { droop: 0.0, cup: 0.12, rib: 0.5, rows: 9, pointy: 0.9 });
  const p = l.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const t = p.getY(i) / len;
    // curve the blade, and make one edge straight (the back) by flattening the -x half toward the spine
    p.setX(i, p.getX(i) * (p.getX(i) < 0 ? 0.35 : 1) + 0.09 * t * t);
  }
  l.computeVertexNormals();
  l.translate(0, 1.36, 0);
  parts.push(
    paintGeometry(l, {
      color: blade,
      mat: surface('metal', { rough: 0.3, pat: { scratches: 0.8 } }),
      bone: 0,
      colorFn: (pt, _n, c) => {
        // a darker fuller down the middle and a bright edge
        const x = Math.abs(pt.x - 0.0);
        if (x < 0.008) c.multiplyScalar(0.8);
      },
    }),
  );
  // socket collar with gold rings where the blade meets the haft
  parts.push(paintGeometry(new THREE.CylinderGeometry(0.02, 0.024, 0.1, 8).translate(0, 1.37, 0), { color: trim, mat: 'gold', bone: 0 }));
  parts.push(paintGeometry(ring([0, 1.31, 0], [0, 1, 0], 0.021, 0.0045, 8, 3), { color: trim, mat: 'gold', bone: 0 }));
  g = mergeKitGeometries(parts);
  for (const x of parts) x.dispose();
  g.userData.shared = true;
  geoCache.set(key, g);
  return g;
}

/** add the glaive head over a held spear (right-hand socket); visible only while a spear is held there */
export function addGlaiveHead(ctx: KindContext, o: { blade: number; trim: number }) {
  ctx.object(
    () => {
      const holder = new THREE.Group();
      holder.name = 'glaive-head';
      const mesh = new THREE.Mesh(glaiveGeometry(o.blade, o.trim), material());
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      holder.add(mesh);
      const base = holder.updateMatrixWorld;
      holder.updateMatrixWorld = function (this: THREE.Group, force?: boolean) {
        const parent = this.parent;
        if (parent) {
          let holds = false;
          for (const c of parent.children) if (c !== this && (c.userData as { kind?: string }).kind === 'spear') holds = true;
          this.visible = holds;
        }
        base.call(this, force);
      };
      holder.visible = false;
      return holder;
    },
    { socket: 'hand_r', small: true },
  );
}
