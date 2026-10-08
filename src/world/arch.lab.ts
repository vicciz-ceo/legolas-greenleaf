import * as THREE from 'three';
import type { LabSubject } from '../core/types';
import type { Built } from './colliders';
import { withDebug } from './labutil';
import { bardsHouse, pier, woodenHouse } from './arch_laketown';
import { setWindTime } from './shader';
import { lake, setWaterTime } from './water';
import { barrel, boat, crate, torch, brazier, ladder } from './props';
import { Rng } from '../core/rng';
import { chamberOfMazarbul, dwarvenHall, pillar } from './arch_moria';
import { brokenBridge, frozenWaterfall, ruinedWatchtower } from './arch_ravenhill';
import { blackGate } from './arch_blackgate';
import { amonHenSummit, ruins, statue } from './arch_amonhen';
import { minasTirith } from './arch_minas';
import { bridge } from './arch_bridge';
import { gate, helmsDeep, stairs, stoneWall, tower } from './arch_helms';

function one(name: string, make: () => Built, height: number): LabSubject {
  return {
    name,
    category: 'environment',
    create() {
      setWindTime(1.0);
      const b = withDebug(make());
      return { object: b.object, height };
    },
  };
}

export const subjects: LabSubject[] = [
  one('house', () => woodenHouse({ lit: true, seed: 3 }), 9),
  one('bards_house', () => bardsHouse({ lit: true }), 12),
  one('pier', () => pier([[-8, 0], [0, 0], [4, 6], [12, 6], [16, 14]], 2.2, { lamps: 6 }), 4),
  {
    name: 'vignette_laketown',
    category: 'environment',
    create() {
      setWindTime(1.0);
      setWaterTime(4.0);
      const g = new THREE.Group();
      const rng = new Rng(77);
      const water = lake({ center: [0, 0], radius: 220, y: -1.2, color: 0x0c1a22, shallow: 0x1c2c30, depth: 6 });
      g.add(water.object);
      const houses: [number, number, number, number][] = [[-14, -10, 0.2, 1], [14, -12, -0.3, 2], [-26, 6, 1.4, 1], [28, 8, -1.3, 1], [0, -30, 0, 2], [-16, 30, 3.0, 1], [18, 32, 2.9, 1]];
      for (const [x, z, yaw, floors] of houses) {
        const h = withDebug(woodenHouse({ lit: rng.chance(0.7), seed: Math.floor(x * 7 + z), floors, w: 5.4 + rng.float() * 2, d: 4.4 + rng.float() * 1.5 }));
        h.object.position.set(x, 0, z);
        h.object.rotation.y = yaw;
        g.add(h.object);
      }
      const bh = withDebug(bardsHouse());
      bh.object.position.set(0, 0, 4);
      g.add(bh.object);
      const walk = withDebug(pier([[-34, 22], [-20, 20], [-8, 18], [0, 18], [10, 18], [24, 20], [34, 24]], 2.4, { lamps: 7 }));
      g.add(walk.object);
      const walk2 = withDebug(pier([[0, 18], [0, 10], [0, 4]], 2.0, { rails: true }));
      g.add(walk2.object);
      const b = boat();
      b.object.position.set(8, -1.0, 24);
      b.object.rotation.y = 0.4;
      g.add(b.object);
      for (let i = 0; i < 6; i++) {
        const br = i % 2 ? barrel({ seed: i }) : crate(0.8, { seed: i });
        br.object.position.set(-30 + i * 1.1, 0, 22.5 + (i % 3) * 0.2);
        g.add(br.object);
      }
      const br = brazier();
      br.object.position.set(6, 0, 19.5);
      g.add(br.object);
      return { object: g, height: 14 };
    },
  },
  one('tower', () => tower(4, 22, { slits: 3, door: true }), 24),
  one('tower_roofed', () => tower(3.6, 26, { roof: 8, slits: 4, door: true }), 36),
  one('gate', () => gate({ kind: 'wood', portcullis: false }), 10),
  one('stone_wall', () => stoneWall([[-12, 0, 0], [0, 0, 0], [10, 0, 6], [18, 0, 18]], 8, 3.2, { buttress: 6, outer: 'right' }), 12),
  one('stairs', () => stairs([0, 0, 0], [0, 5, 30], 6, { ramp: true }), 8),
  {
    name: 'vignette_deeping_wall',
    category: 'environment',
    create() {
      const h = withDebug(helmsDeep());
      return { object: h.object, height: 40 };
    },
  },
  one('dwarven_pillar', () => pillar('dwarven', 14, 2.6), 15),
  one('column_marble', () => pillar('ionic', 8, 1.2), 9),
  one('chamber_of_mazarbul', () => chamberOfMazarbul(), 11),
  {
    name: 'vignette_moria_hall',
    category: 'environment',
    create() {
      const hall = withDebug(dwarvenHall({ cols: 4, rows: 4, spacing: 13, height: 26 }));
      const g = new THREE.Group();
      g.add(hall.object);
      const ch = withDebug(chamberOfMazarbul());
      ch.object.position.set(-60, 0, 0);
      g.add(ch.object);
      return { object: g, height: 28 };
    },
  },
  one('ruined_watchtower', () => ruinedWatchtower(), 28),
  one('broken_bridge', () => brokenBridge(34, 6, { gap: [0.4, 0.62] }), 10),
  one('frozen_waterfall', () => frozenWaterfall(), 24),
  one('black_gate', () => blackGate({ scale: 0.5 }), 50),
  one('statue', () => statue('standing'), 8),
  one('statues', () => {
    const a = statue('standing');
    const b = statue('toppled', { seed: 2 });
    const c = statue('headless', { seed: 3 });
    b.object.position.x = 9;
    c.object.position.x = 18;
    a.object.add(b.object, c.object);
    return { object: a.object, colliders: [...a.colliders] };
  }, 8),
  one('amon_hen_summit', () => amonHenSummit(), 12),
  {
    name: 'ruins',
    category: 'environment',
    create() {
      const r = withDebug(ruins({ center: new THREE.Vector3(0, 0, 0), halfSize: [18, 18] }, 22, () => 0, { grandeur: 0.7 }));
      return { object: r.object, height: 6 };
    },
  },
  one('minas_tirith', () => minasTirith({ scale: 0.35 }), 220),
  one('bridge_wood', () => bridge([[-14, 0, 0], [0, 0, 0], [14, 0, 6]], 3, { kind: 'wood' }), 4),
  one('bridge_rope', () => bridge([[-16, 0, 0], [16, 0, 0]], 2, { kind: 'rope', sag: 2.0 }), 4),
];
