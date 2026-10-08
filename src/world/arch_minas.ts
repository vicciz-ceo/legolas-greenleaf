/** Minas Tirith: the White City on its spur, seven tiers rising to the Citadel. A far-horizon landmark. */
import * as THREE from 'three';
import { Rng, hashSeed } from '../core/rng';
import { mat, plain } from './mats';
import { cliffGeometry, limbGeo, xf } from './geom';
import { MeshKit } from './util';
import { applyFogCap } from './shader';
import type { Built } from './colliders';

/**
 * The city is built facing +z. Its outer wall sits about 420 m wide; the Citadel tower tops out ~480 m
 * above the gate. `scale` shrinks it for a convincing distance (the Pelennor horizon uses ~0.6).
 * No colliders (it is scenery). Origin at the centre of the outermost wall's base.
 */
export function minasTirith(o: { scale?: number; tiers?: number; fires?: boolean; seed?: number } = {}): Built {
  const S = o.scale ?? 1;
  const tiers = o.tiers ?? 7;
  const rng = new Rng(hashSeed('minas', o.seed ?? 1));
  const kit = new MeshKit();
  const white = mat('marble', { key: 'minasWhite', rgb: [1.1, 1.08, 1.02], macro: { scale: 0.01, strength: 0.15, tint: 0.04 } });
  const roofs = mat('shingles', { key: 'minasRoof', rgb: [0.55, 0.62, 0.7] });
  const tint2 = mat('marble', { key: 'minasWarm', rgb: [1.0, 0.95, 0.86] });
  const R0 = 210 * S;
  const dR = 24 * S;
  const dY = 48 * S;
  const wallH = dY;
  const cz = -R0 * 0.2;
  const emissive = plain(0xffa040, { roughness: 0.6, emissive: 0xff7a20, emissiveIntensity: 1.8, key: 'minasFire' });
  const fireBoxes: [number, number, number][] = [];
  for (let t = 0; t < tiers; t++) {
    const R = R0 - t * dR * 2.1;
    const y = t * dY;
    const half = Math.PI * (0.62 - t * 0.02);
    const n = Math.max(18, Math.round((R * half * 2) / (7 * S)));
    const chord = (R * half * 2) / n;
    // curved wall
    for (let i = 0; i < n; i++) {
      const a = -half + ((i + 0.5) / n) * half * 2;
      const x = Math.sin(a) * R;
      const z = cz + Math.cos(a) * R;
      kit.box(i % 3 ? white : tint2, [chord * 1.06, wallH + 3 * S, 5 * S], [x, y + wallH / 2 - 1.5 * S, z], a, { tile: 14 * S });
      // parapet
      kit.box(white, [chord * 1.06, 1.6 * S, 2.2 * S], [Math.sin(a) * (R - 1.4 * S), y + wallH + 0.8 * S, cz + Math.cos(a) * (R - 1.4 * S)], a, { tile: 8 * S });
      if (i % 9 === 4) {
        // bastion towers on the wall
        kit.box(white, [8 * S, wallH + 12 * S, 8 * S], [Math.sin(a) * (R + 2 * S), y + (wallH + 12 * S) / 2 - 1.5 * S, cz + Math.cos(a) * (R + 2 * S)], a, { tile: 12 * S });
        kit.add(roofs, new THREE.ConeGeometry(6.2 * S, 11 * S, 4), xf(Math.sin(a) * (R + 2 * S), y + wallH + 12 * S + 5 * S - 1.5 * S, cz + Math.cos(a) * (R + 2 * S), a + Math.PI / 4));
        if (o.fires !== false && rng.chance(0.5)) fireBoxes.push([Math.sin(a) * (R + 2 * S), y + wallH + 11 * S, cz + Math.cos(a) * (R + 2 * S) + 4.2 * S]);
      }
    }
    // terrace slab behind the wall, and houses
    const Rin = R - dR * 1.9;
    for (let i = 0; i < n; i++) {
      const a = -half + ((i + 0.5) / n) * half * 2;
      const rm = (R + Rin) / 2;
      kit.box(tint2, [chord * 1.04, 8 * S, R - Rin + dR * 0.4], [Math.sin(a) * (rm - dR * 0.1), y + wallH - 4 * S, cz + Math.cos(a) * (rm - dR * 0.1)], a, { tile: 14 * S });
    }
    const houses = Math.round(n * 0.9);
    for (let i = 0; i < houses; i++) {
      const a = -half * 0.97 + rng.float() * half * 1.94;
      const r = Rin + (R - Rin) * (0.25 + rng.float() * 0.6) - 4 * S;
      const hw = (7 + rng.float() * 10) * S;
      const hd = (7 + rng.float() * 8) * S;
      const hh = (9 + rng.float() * 18) * S;
      const x = Math.sin(a) * r;
      const z = cz + Math.cos(a) * r;
      const gy = y + wallH;
      const m = rng.chance(0.35) ? tint2 : white;
      kit.box(m, [hw, hh, hd], [x, gy + hh / 2 - 1 * S, z], a + (rng.float() - 0.5) * 0.3, { tile: 12 * S });
      if (rng.chance(0.55)) kit.box(roofs, [hw * 1.08, 1.4 * S, hd * 1.08], [x, gy + hh - 0.3 * S, z], a, { tile: 8 * S });
      else kit.add(roofs, new THREE.ConeGeometry(Math.max(hw, hd) * 0.74, 7 * S, 4), xf(x, gy + hh + 2.6 * S, z, a + Math.PI / 4));
    }
  }
  // Citadel at the top: court, Ecthelion's Tower, hall
  const topY = (tiers - 1) * dY + wallH;
  kit.box(white, [60 * S, 10 * S, 54 * S], [0, topY + 3 * S, cz + 4 * S], 0, { tile: 14 * S });
  kit.box(white, [30 * S, 40 * S, 28 * S], [-10 * S, topY + 22 * S, cz], 0, { tile: 14 * S });
  kit.add(roofs, new THREE.ConeGeometry(21 * S, 20 * S, 4), xf(-10 * S, topY + 52 * S, cz, Math.PI / 4));
  // the tower: slender, tapering, with a pinnacle
  const tx = 8 * S;
  const twrH = 160 * S;
  const g = new THREE.CylinderGeometry(6 * S, 12 * S, twrH, 12, 4);
  kit.add(white, g, xf(tx, topY + twrH / 2, cz), { tile: 12 * S });
  kit.add(tint2, new THREE.CylinderGeometry(9 * S, 8 * S, 6 * S, 12), xf(tx, topY + twrH - 8 * S, cz), { tile: 6 * S });
  kit.add(white, new THREE.CylinderGeometry(7 * S, 7.6 * S, 14 * S, 12), xf(tx, topY + twrH + 6 * S, cz), { tile: 8 * S });
  kit.add(roofs, new THREE.ConeGeometry(8 * S, 34 * S, 12), xf(tx, topY + twrH + 30 * S, cz));
  kit.add(white, limbGeo([tx, topY + twrH + 46 * S, cz], [tx, topY + twrH + 70 * S, cz], 0.8 * S, 0.1 * S, 5, 3 * S));
  // a banner of the stewards (white tree on black) near the top
  kit.box(plain(0x111114, { roughness: 0.8, key: 'minasBanner' }), [2.2 * S, 18 * S, 0.3 * S], [tx + 1.5 * S, topY + twrH + 52 * S, cz + 7 * S], 0.2, undefined);
  // the great rock behind: Mindolluin, a craggy snow-capped mass rising behind the city
  const rg = cliffGeometry(820 * S, 1000 * S, 600 * S, 7, { rough: 1.3, taper: 0.8, strata: 0.2, cell: 30 * S, tile: 90 * S });
  const rpos = rg.getAttribute('position') as THREE.BufferAttribute;
  const rnor = rg.getAttribute('normal') as THREE.BufferAttribute;
  const col = new Float32Array(rpos.count * 3);
  for (let i = 0; i < rpos.count; i++) {
    const h = (rpos.getY(i) + 500 * S) / (1000 * S);
    const flat = Math.max(0, rnor.getY(i));
    const snow = Math.max(0, Math.min(1, (h - 0.5) * 3.5 + (flat - 0.6) * 1.2));
    const base = 0.55 + 0.25 * h;
    col[i * 3] = base * (1 - snow) + 0.92 * snow;
    col[i * 3 + 1] = (base * 0.98) * (1 - snow) + 0.93 * snow;
    col[i * 3 + 2] = (base * 1.04) * (1 - snow) + 0.97 * snow;
  }
  rg.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const rockMat = mat('cliff', { key: 'mindolluin', vertexColors: true, rgb: [0.5, 0.52, 0.6] });
  const rockMesh = new THREE.Mesh(rg, rockMat);
  rockMesh.position.set(60 * S, 500 * S - 40 * S, cz - 470 * S);
  rockMesh.castShadow = false;
  rockMesh.receiveShadow = true;
  const root = kit.build({ name: 'minas_tirith' });
  root.add(rockMesh);
  // fires (emissive)
  const fk = new MeshKit();
  for (const [x, y, z] of fireBoxes) fk.box(emissive, [2.4 * S, 3 * S, 2.4 * S], [x, y, z], 0, undefined);
  if (fireBoxes.length) root.add(fk.build({ name: 'minas_fires', castShadow: false, receiveShadow: false }));
  // a landmark seen from 1 km+: keep some of its own shading through the haze (see applyFogCap)
  for (const m of [white, roofs, tint2, rockMat]) applyFogCap(m, 0.72);
  root.traverse((c) => {
    const m = c as THREE.Mesh;
    if (m.isMesh) m.userData.noAO = true;
  });
  return { object: root, colliders: [] };
}
