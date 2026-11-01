/**
 * Lab subjects for weapons: 'weapons' (every WeaponKind), 'weapons_blades' and 'weapons_ranged'
 * (close-ups). Weapons stand upright, grip (red marker) at the base, tip up; polearms lie on rests.
 */
import * as THREE from 'three';
import type { LabInstance, LabSubject, WeaponKind } from '../core/types';
import { createWeapon, WEAPON_KINDS, type WeaponStyle } from './weapons';

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


// ─────────────────────────────────────────────────────────────────────────────
// Sheet lineup (docs/refs/weapons): the 14 items, laid out like the sheet (row 1 = 1.60 m, row 2 =
// 3.00 m), each standing on y = 0 in the sheet's orientation (blades and the mace head hang down).
// Camera: view=turn&yaws=0 (front, true scale) or view=single (3/4).
// ─────────────────────────────────────────────────────────────────────────────

interface SheetItem {
  name: string;
  kind: WeaponKind;
  style?: WeaponStyle;
  /** hilt at the top in the sheet: turn the weapon upside down */
  flip?: boolean;
  /** face the +X shields to the camera */
  shield?: boolean;
  bow?: boolean;
  count?: number;
  /** sheet extent (m) as held (the troll weapons are held through a 2.5x scaled hand socket) */
  extent: number;
  /** scale of the hand socket that holds it in the game */
  held?: number;
}

const ROW1: SheetItem[] = [
  { name: 'galadhrim_bow', kind: 'elven_bow', bow: true, extent: 1.6 },
  { name: 'elven_knives', kind: 'elven_knives', flip: true, count: 2, extent: 0.65 },
  { name: 'gimli_axe', kind: 'dwarf_axe', style: 'dwarf', extent: 1.15 },
  { name: 'uruk_falchion', kind: 'sword', style: 'uruk', flip: true, extent: 0.85 },
  { name: 'orc_cleaver', kind: 'cleaver', style: 'orc', flip: true, extent: 0.85 },
  { name: 'orc_scimitar', kind: 'scimitar', style: 'orc', flip: true, extent: 0.95 },
  { name: 'bolg_mace', kind: 'mace', style: 'orc', flip: true, extent: 1.5, held: 1.55 },
];
const ROW2: SheetItem[] = [
  { name: 'cave_troll_club', kind: 'club', extent: 2.7, held: 2.5 },
  { name: 'war_hammer', kind: 'warhammer', extent: 2.5, held: 2.5 },
  { name: 'pike', kind: 'pike', extent: 3 },
  { name: 'rohan_shield', kind: 'shield', style: 'rohan', shield: true, extent: 0.9 },
  { name: 'gondor_shield', kind: 'shield', style: 'gondor', shield: true, extent: 1.15 },
  { name: 'uruk_shield', kind: 'shield', style: 'uruk', shield: true, extent: 1 },
  { name: 'torch', kind: 'torch', extent: 0.75 },
];

function sheetItem(it: SheetItem, scaled: boolean): THREE.Object3D {
  const holder = new THREE.Group();
  holder.name = it.name;
  const n = it.count ?? 1;
  for (let i = 0; i < n; i++) {
    const w = createWeapon(it.kind, 1 + i, it.style ?? 'default');
    const pivot = new THREE.Group();
    pivot.add(w);
    if (it.flip) pivot.rotation.z = Math.PI;
    if (it.shield) pivot.rotation.y = -Math.PI / 2;
    if (it.bow) pivot.rotation.y = Math.PI / 2;
    if (scaled && it.held) pivot.scale.setScalar(it.held);
    const b = w.userData.bow as BowApi | undefined;
    if (b) {
      b.setDraw(0);
      b.setNock(null);
    }
    pivot.position.x = (i - (n - 1) / 2) * 0.17;
    holder.add(pivot);
  }
  return holder;
}

function sheetRow(items: SheetItem[], pitch: number): LabInstance {
  const g = new THREE.Group();
  items.forEach((it, i) => {
    const h = sheetItem(it, true);
    const box = new THREE.Box3().setFromObject(h);
    h.position.set((i - (items.length - 1) / 2) * pitch - (box.min.x + box.max.x) / 2, -box.min.y, 0);
    g.add(h);
  });
  return { object: g, height: 1.6, animations: ['idle'], pose() {} };
}

function triCount(o: THREE.Object3D): number {
  let t = 0;
  o.traverse((m) => {
    const me = m as THREE.Mesh;
    if (me.isMesh && me.visible) t += (me.geometry.index ? me.geometry.index.count : me.geometry.attributes.position.count) / 3;
  });
  return Math.round(t);
}

/** console / --eval helper: extent as the sheet measures it, size and triangles of every sheet item and crowd weapon */
(window as unknown as { __weaponStats?: () => unknown }).__weaponStats = () => {
  const out: Record<string, unknown> = {};
  const t0 = performance.now();
  for (const it of [...ROW1, ...ROW2]) {
    const h = sheetItem(it, true);
    const box = new THREE.Box3().setFromObject(h);
    const sz = box.getSize(new THREE.Vector3());
    out[it.name] = { tris: triCount(h), extent: +Math.max(sz.x, sz.y).toFixed(3), want: it.extent, size: sz.toArray().map((v) => +v.toFixed(3)) };
  }
  const extra: [WeaponKind, WeaponStyle][] = [['sword', 'default'], ['scimitar', 'default'], ['cleaver', 'default'], ['spear', 'default'], ['orc_bow', 'default'], ['uruk_bow', 'default'], ['elven_sword', 'default'], ['axe', 'dwarf'], ['mace', 'default'], ['crossbow', 'default'], ['shield', 'dwarf'], ['shield', 'easterling'], ['shield', 'default'], ['pike', 'default'], ['warhammer', 'default']];
  for (const [k, st] of extra) {
    const w = createWeapon(k, 1, st);
    const box = new THREE.Box3().setFromObject(w);
    out[`${k}/${st}`] = { tris: triCount(w), min: box.min.toArray().map((v) => +v.toFixed(3)), max: box.max.toArray().map((v) => +v.toFixed(3)) };
  }
  out.buildMs = +(performance.now() - t0).toFixed(1);
  return out;
};

/** both rows in one frame (row 2 above row 1) */
function sheetAll(): LabInstance {
  const a = sheetRow(ROW1, 1.0), b = sheetRow(ROW2, 1.25);
  b.object.position.y = 1.8;
  const g = new THREE.Group();
  g.add(a.object, b.object);
  return { object: g, height: 4.8, animations: ['idle'], pose() {} };
}

/** every shield style side by side (use view=quad for front / profile / back / 3/4) */
function shieldRow(): LabInstance {
  const items: SheetItem[] = [
    { name: 'rohan', kind: 'shield', style: 'rohan', shield: true, extent: 0.9 },
    { name: 'gondor', kind: 'shield', style: 'gondor', shield: true, extent: 1 },
    { name: 'uruk', kind: 'shield', style: 'uruk', shield: true, extent: 1 },
    { name: 'dwarf', kind: 'shield', style: 'dwarf', shield: true, extent: 0.7 },
    { name: 'easterling', kind: 'shield', style: 'easterling', shield: true, extent: 0.9 },
  ];
  return sheetRow(items, 1.0);
}

export const subjects: LabSubject[] = [
  { name: 'weapons_shields', category: 'prop', create: shieldRow },
  { name: 'weapons_knives', category: 'prop', create: () => sheetRow([{ name: 'k_default', kind: 'elven_knives', flip: true, count: 2, extent: 0.65 }, { name: 'k_elven', kind: 'elven_knives', style: 'elven', flip: true, count: 2, extent: 0.65 }], 0.5) },
  { name: 'weapons_lineup', category: 'prop', create: sheetAll },
  { name: 'weapons_row1', category: 'prop', create: () => sheetRow(ROW1, 1.0) },
  { name: 'weapons_row2', category: 'prop', create: () => sheetRow(ROW2, 1.25) },
  ...[...ROW1, ...ROW2].map((it): LabSubject => ({ name: `wp_${it.name}`, category: 'prop', create: () => sheetRow([it], 1) })),
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
