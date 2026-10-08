/**
 * The shield-surf down the broad stair (a PlayerMover, pose 'surf').
 *
 *   slide   speed builds down the 59 m ramp (4 -> 15 m/s), left/right steers inside the cheeks,
 *           the bow stays live, and any Uruk in the lane is bowled over by the shield
 *   launch  off the foot of the stair, a slow-motion leap onto the Uruk waiting there (the
 *           landing kill), then a short skid to a stop
 */
import * as THREE from 'three';
import type { Combatant, Enemy, LevelAPI, PlayerAPI, PlayerMover } from '../../../core/types';
import { clamp, lerp, smoothstep } from '../../../core/math';
import { L, stairY } from './layout';

const HALF_W = 3.5;
const LAUNCH_Z = L.stairBottom.z + 3.5;

export interface SurfMover extends PlayerMover {
  elapsed: number;
  phase: 'slide' | 'leap' | 'skid' | 'done';
  /** kills made while surfing (shield bowls + arrows); the script adds the bonus */
  readonly bowled: Combatant[];
}

export function makeShieldSurf(level: LevelAPI, landing: Enemy | null, onDone: () => void): SurfMover {
  const { ctx } = level;
  const physics = ctx.physics;
  let speed = 3;
  let lateral = 0;
  let leapT = 0;
  let skidT = 0;
  const from = new THREE.Vector3();
  const to = new THREE.Vector3();
  const dir = new THREE.Vector3(0, 0.3, -1).normalize();
  const tmp = new THREE.Vector3();
  let finished = false;
  let killedLanding = false;
  let slowed = false;
  let sfxT = 0;

  const finish = () => {
    if (finished) return;
    finished = true;
    m.phase = 'done';
    if (slowed) ctx.time.setScale(1, 0.4);
    onDone();
  };

  const bowl = (player: PlayerAPI) => {
    for (const c of ctx.combatants.byTeam('enemy')) {
      if (!c.alive || c === landing) continue;
      const dx = c.position.x - player.position.x;
      const dz = c.position.z - player.position.z;
      if (dx * dx + dz * dz > 1.35 * 1.35 || Math.abs(c.position.y - player.position.y) > 1.6) continue;
      tmp.set(dx * 0.4, 0.6, -1).normalize();
      c.takeDamage({ amount: 1e5, type: 'melee', source: player, dir: tmp, knockback: 11, point: c.position.clone().setY(c.position.y + 1.2) });
      ctx.audio.play('sword_clash', { pos: c.position, volume: 0.9, pitch: 0.7 });
      ctx.fx.sparks(c.position.clone().setY(c.position.y + 1), tmp, 10);
      player.camera.shake(0.18, 0.2);
      m.bowled.push(c);
    }
  };

  const m: SurfMover = {
    elapsed: 0,
    phase: 'slide',
    bowled: [],
    pose: 'surf',
    poseT: () => clamp(m.elapsed / 6, 0, 1),
    allowShoot: true,
    allowMelee: false,
    allowJump: false,
    allowDash: false,
    lockCameraYaw: true,
    camera: { distance: 5.0, height: 2.0, fov: 74 },
    update(dt, player, input) {
      m.elapsed += dt;
      const p = player.position;
      if (m.phase === 'slide') {
        // gravity down the slope, a little drag; the stone rasps louder as it speeds up
        speed = clamp(speed + (2.3 - speed * speed * 0.004) * dt, 3, 13.5);
        lateral = clamp(lateral + input.moveX * 5.5 * dt, -HALF_W, HALF_W);
        const nz = p.z - speed * dt;
        const nx = L.stairBottom.x + lateral;
        const gy = physics.ground(nx, nz, p.y + 1.2)?.y ?? stairY(nz);
        player.velocity.set((nx - p.x) / Math.max(dt, 1e-4), (gy - p.y) / Math.max(dt, 1e-4), -speed);
        p.set(nx, gy, nz);
        player.facing = Math.PI - input.moveX * 0.25;
        sfxT -= dt;
        if (sfxT <= 0) {
          sfxT = 0.9;
          ctx.audio.play('shield_slide', { volume: 0.35 + speed * 0.035, pitch: 0.85 + speed * 0.02 });
        }
        if (level.rng() < dt * speed * 1.4) ctx.fx.sparks(tmp.set(p.x, p.y + 0.05, p.z + 0.4), dir, 2);
        bowl(player);
        if (p.z <= LAUNCH_Z) {
          m.phase = 'leap';
          leapT = 0;
          from.copy(p);
          if (landing && landing.alive) to.copy(landing.position).setZ(landing.position.z + 0.9);
          else to.set(L.stairBottom.x + lateral * 0.5, 0, L.landingUruk.z);
          ctx.time.setScale(0.3, 0.12);
          slowed = true;
          ctx.audio.play('jump', { volume: 0.8 });
        }
        return;
      }
      if (m.phase === 'leap') {
        // a 0.85 s (game time) arc onto the Uruk at the foot of the stair, in slow motion
        leapT += dt;
        const k = clamp(leapT / 0.85, 0, 1);
        const y = lerp(from.y, to.y, k) + Math.sin(k * Math.PI) * 2.4;
        const nx = lerp(from.x, to.x, smoothstep(0, 1, k));
        const nz = lerp(from.z, to.z, k);
        player.velocity.set((nx - p.x) / Math.max(dt, 1e-4), (y - p.y) / Math.max(dt, 1e-4), (nz - p.z) / Math.max(dt, 1e-4));
        p.set(nx, y, nz);
        player.facing = Math.PI;
        if (k >= 0.92 && !killedLanding) {
          killedLanding = true;
          if (landing && landing.alive) {
            tmp.set(0, -0.4, -1).normalize();
            landing.takeDamage({ amount: 1e5, type: 'melee', source: player, dir: tmp, knockback: 12, point: landing.position.clone().setY(1.2) });
            m.bowled.push(landing);
          }
          ctx.fx.dust(tmp.set(p.x, 0.1, p.z), 24, 0x6a6460);
          ctx.fx.splash(tmp, 12);
          ctx.audio.play('land', { volume: 1, pitch: 0.8 });
          ctx.audio.play('sword_clash', { volume: 1, pitch: 0.55 });
          player.camera.shake(0.5, 0.45);
          ctx.time.setScale(1, 0.5);
          slowed = false;
        }
        if (k >= 1) {
          m.phase = 'skid';
          skidT = 0;
          speed = 7;
        }
        return;
      }
      if (m.phase === 'skid') {
        skidT += dt;
        speed = Math.max(0, speed - 14 * dt);
        const nz = p.z - speed * dt;
        const gy = physics.heightAt(p.x, nz);
        player.velocity.set(0, 0, -speed);
        p.set(p.x, gy, nz);
        bowl(player);
        if (speed <= 0.05 || skidT > 1.2) finish();
      }
    },
  };
  return m;
}
