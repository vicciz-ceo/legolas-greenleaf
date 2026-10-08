/**
 * Lab subjects for weapons: 'weapons' (every WeaponKind), 'weapons_blades' and 'weapons_ranged'
 * (close-ups). Weapons stand upright, grip (red marker) at the base, tip up; polearms lie on rests.
 */
import * as THREE from 'three';
import type { LabInstance, LabSubject, WeaponKind } from '../core/types';
import { createWeapon, WEAPON_KINDS } from './weapons';

type BowApi = { setDraw(v: number): void; setNock(p: THREE.Vector3 | null): void; showArrow(v: boolean): void };

function layout(rows: WeaponKind[][], lying: WeaponKind[] = []): LabInstance {
  const g = new THREE.Group();
  const bows: BowApi[] = [];
  const marker = new THREE.MeshStandardMaterial({ color: 0x8a2a20, roughness: 0.6 });
  let z = 0;
  let maxW = 0;
  const rowGroups: THREE.Group[] = [];
  for (const row of rows) {
    const rg = new THREE.Group();
    let x = 0;
    for (const kind of row) {
      const w = createWeapon(kind, 1);
      const holder = new THREE.Group();
      holder.add(w);
      if (lying.includes(kind)) {
        w.rotation.z = -Math.PI / 2;
        w.position.y = 0.06;
      }
      const box = new THREE.Box3().setFromObject(holder);
      const width = Math.max(0.16, box.max.x - box.min.x);
      x += width / 2 + 0.08;
      holder.position.set(x - (box.min.x + box.max.x) / 2, -box.min.y + 0.01, 0);
      x += width / 2;
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.01, 8, 6), marker);
      w.add(m);
      holder.name = kind;
      rg.add(holder);
      if (w.userData.bow) bows.push(w.userData.bow);
    }
    rg.children.forEach((c) => (c.position.x -= x / 2));
    rg.position.z = z;
    z -= 0.7;
    maxW = Math.max(maxW, x);
    rowGroups.push(rg);
    g.add(rg);
  }
  void maxW;
  return {
    object: g,
    height: 1.6,
    animations: ['idle', 'draw'],
    pose(anim, t) {
      const v = anim === 'draw' ? 0.5 - 0.5 * Math.cos(t * 2) : 0;
      for (const b of bows) {
        b.setDraw(v);
        b.setNock(null);
        b.showArrow(anim === 'draw');
      }
    },
  };
}

export const subjects: LabSubject[] = [
  {
    name: 'weapons',
    category: 'prop',
    create: () =>
      layout(
        [
          ['elven_knives', 'elven_sword', 'sword', 'scimitar', 'cleaver', 'axe', 'dwarf_axe', 'mace', 'warhammer', 'torch', 'club'],
          ['elven_bow', 'orc_bow', 'uruk_bow', 'crossbow', 'shield'],
          ['spear', 'pike'],
        ],
        ['spear', 'pike'],
      ),
  },
  {
    name: 'weapons_blades',
    category: 'prop',
    create: () => layout([['elven_knives', 'elven_sword', 'sword', 'scimitar', 'cleaver', 'axe', 'dwarf_axe']]),
  },
  {
    name: 'weapons_ranged',
    category: 'prop',
    create: () => layout([['elven_bow', 'orc_bow', 'uruk_bow', 'crossbow', 'shield']]),
  },
];

void WEAPON_KINDS;
