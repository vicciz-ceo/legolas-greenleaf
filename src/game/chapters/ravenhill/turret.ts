/**
 * A plain ruined round turret: a ring of dressed blocks with a broken crown, arrow slits and a snow cap.
 * (The world's ruinedWatchtower is a six-metre-radius tower with timber floors and a spiral stair: at the
 * scale of a turret its joists and steps poke through the wall, so the wings use this instead.)
 */
import * as THREE from 'three';
import { Rng } from '../../../core/rng';
import { mat } from '../../../world';
import { MeshKit } from '../../../world/util';

export interface TurretOpts {
  radius: number;
  height: number;
  seed: number;
  /** angle (radians, 0 = +x) where the wall stays tallest */
  tall?: number;
  thickness?: number;
}

export function ruinedTurret(o: TurretOpts): THREE.Object3D {
  const rng = new Rng(o.seed * 7919 + 17);
  const R = o.radius;
  const H = o.height;
  const T = o.thickness ?? 1.2;
  const tall = o.tall ?? 0;
  const kit = new MeshKit();
  // the same dressed grey masonry and snow as the watchtower (cached shared materials)
  const stone = mat('stone_blocks', { key: 'dark', rgb: [0.62, 0.62, 0.64], macro: { scale: 0.08, strength: 0.28, tint: 0.06, streaks: 0.55 } });
  const snow = mat('snow', { key: 'ruinsnow' });
  const N = Math.max(12, Math.round((2 * Math.PI * R) / 1.9));
  const chord = (2 * Math.PI * R) / N;
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    const k = 0.5 + 0.5 * Math.cos(a - tall);
    const h = Math.max(H * 0.34, H * (0.4 + 0.6 * Math.pow(k, 0.9)) + (rng.float() - 0.5) * 1.6);
    const nb = Math.max(1, Math.ceil(h / 1.9));
    const bh = h / nb;
    const slit = i % 4 === 2;
    for (let b = 0; b < nb; b++) {
      // arrow slits: a block left out at one height
      if (slit && b === Math.min(nb - 2, Math.round(nb * 0.55)) && nb > 3) continue;
      const rr = R + (rng.float() - 0.5) * 0.1;
      kit.box(stone, [T + (rng.float() - 0.5) * 0.1, bh + 0.02, chord * 1.04], [Math.cos(a) * rr, b * bh + bh / 2, Math.sin(a) * rr], -a, { tile: 3 }, [0, (rng.float() - 0.5) * 0.02]);
    }
    // a loose block on the broken crown
    if (h < H - 1 && rng.chance(0.55)) {
      const s = 0.45 + rng.float() * 0.6;
      kit.box(stone, [T * 0.8, s, chord * 0.6], [Math.cos(a) * R, h + s / 2 - 0.1, Math.sin(a) * R], -a + (rng.float() - 0.5) * 0.4, { tile: 2 }, [0, (rng.float() - 0.5) * 0.4]);
    }
    kit.box(snow, [T + 0.25, 0.28 + rng.float() * 0.25, chord * 1.1], [Math.cos(a) * R, h + 0.1, Math.sin(a) * R], -a, { tile: 2 });
    // base plinth
    kit.box(stone, [T + 0.5, 0.7, chord * 1.05], [Math.cos(a) * R, 0.35, Math.sin(a) * R], -a, { tile: 2 });
  }
  // rubble heaped round the foot
  for (let i = 0; i < 9; i++) {
    const a = rng.float() * Math.PI * 2;
    const d = R + 1.2 + rng.float() * 2.6;
    const s = 0.4 + rng.float() * 0.8;
    kit.box(stone, [s, s * 0.7, s * 0.9], [Math.cos(a) * d, s * 0.3, Math.sin(a) * d], rng.float() * 3, { tile: 2 }, [rng.float() * 0.5, rng.float() * 0.5]);
  }
  return kit.build({ name: 'ruined_turret' });
}
