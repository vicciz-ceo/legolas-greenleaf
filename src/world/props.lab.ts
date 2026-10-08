import * as THREE from 'three';
import type { LabSubject } from '../core/types';
import type { Built } from './colliders';
import { withDebug } from './labutil';
import {
  banner, barrel, batFlock, boat, boulderField, brazier, chain, crate, fallenLog, iceSheet, ladder, lantern, rock, skeleton, torch, weaponRack, well,
  type Emblem, type SkeletonPose,
} from './props';
import { setWindTime } from './shader';
import { setFlameTime } from './fire';

const flatH = () => 0;

function one(name: string, make: () => Built, height: number): LabSubject {
  return {
    name,
    category: 'prop',
    create() {
      setWindTime(1.0);
      setFlameTime(2.0);
      const b = withDebug(make());
      return { object: b.object, height };
    },
  };
}

function row(items: Built[], gap: number): THREE.Group {
  const g = new THREE.Group();
  items.forEach((b, i) => {
    withDebug(b);
    b.object.position.x = (i - (items.length - 1) / 2) * gap;
    g.add(b.object);
  });
  return g;
}

export const subjects: LabSubject[] = [
  one('rock', () => rock(1.2, 3, { moss: 0.8 }), 1.4),
  one('rock_cliff', () => rock(1.6, 7, { kind: 'cliff', flat: 1.1, stretch: 0.9 }), 2.4),
  {
    name: 'boulder_field',
    category: 'prop',
    create() {
      const b = boulderField({ center: new THREE.Vector3(0, 0, 0), halfSize: [12, 12] }, 40, [0.3, 1.6], flatH, { seed: 3, moss: 0.7 });
      return { object: b.object, height: 3 };
    },
  },
  one('barrel', () => barrel(), 1),
  {
    name: 'barrels_crates',
    category: 'prop',
    create() {
      const g = row([barrel({ seed: 1 }), barrel({ open: true, seed: 2 }), barrel({ lying: true, seed: 3 }), crate(0.9, { seed: 1 }), crate([1.2, 0.7, 0.8], { seed: 2 })], 1.5);
      return { object: g, height: 1.2 };
    },
  },
  one('torch', () => torch(), 1.4),
  one('torch_wall', () => torch({ wall: true }), 1.4),
  one('brazier', () => brazier(), 1.8),
  {
    name: 'banners',
    category: 'prop',
    create() {
      setWindTime(1.0);
      const defs: [number, Emblem][] = [[0x16120f, 'white_hand'], [0x3a0c0a, 'eye'], [0x141418, 'white_tree'], [0x2f5a2a, 'horse'], [0x7a2418, 'hammer'], [0x1c1c1c, 'wolf']];
      const g = row(defs.map(([c, e]) => banner(c, e)), 1.9);
      return { object: g, height: 4 };
    },
  },
  one('well', () => well(), 3),
  one('ladder', () => ladder(3.2, { hooks: true }), 3.4),
  one('chain', () => {
    const c = chain(5);
    c.object.position.y = 5;
    return c;
  }, 5),
  {
    name: 'skeletons',
    category: 'prop',
    create() {
      const poses: SkeletonPose[] = ['lying', 'sitting', 'slumped', 'sprawled'];
      const g = row(poses.map((p, i) => skeleton(p, i + 1)), 1.7);
      return { object: g, height: 1.5 };
    },
  },
  one('weapon_rack', () => weaponRack(), 2.5),
  one('ice_sheet', () => iceSheet(5, 4), 1),
  {
    name: 'bat_flock',
    category: 'prop',
    create() {
      const b = batFlock(40, new THREE.Vector3(0, 8, 0), 14, { size: 1.5 });
      return { object: b.object, height: 20 };
    },
  },
  one('fallen_log', () => fallenLog(7, 0.5, 2), 1.4),
  one('lantern', () => {
    const l = lantern();
    l.object.position.y = 1.2;
    return l;
  }, 1.4),
  one('boat', () => boat(), 1.2),
];
