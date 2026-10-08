/**
 * The Fellowship on Amon Hen: Aragorn and Gimli fight beside Legolas; Boromir, wounded, sits against
 * his tree in the last beat (a Gondor man, kneeling, arrows in his chest).
 */
import * as THREE from 'three';
import type { Ally, LevelAPI } from '../../../core/types';
import { yawOf } from '../../../core/math';
import type { BaseCombatant } from '../../../actors/combatant';
import type { Humanoid } from '../../../core/types';
import { createHumanoid } from '../../../creatures/humanoid';

export interface Cast {
  aragorn: Ally;
  gimli: Ally;
}

export function spawnCast(level: LevelAPI, near: THREE.Vector3, facing: number): Cast {
  const side = (a: number, d: number): THREE.Vector3 => new THREE.Vector3(near.x + Math.sin(facing + a) * d, near.y, near.z + Math.cos(facing + a) * d);
  // rivalry: Gimli's kills feed the counter, and the rubber band keeps the race close
  const gimli = level.spawnAlly({ kind: 'gimli', rivalry: true, anchor: 'player' }, side(1.9, 2.6), facing);
  const aragorn = level.spawnAlly({ kind: 'aragorn', anchor: 'player' }, side(-1.7, 3.0), facing);
  level.ctx.rivalry.autoGimli = true;
  return { aragorn, gimli };
}

type Swappable = BaseCombatant & { body: Humanoid; motor?: { height: number; radius: number }; facing: number; playSpecial(pose: string, seconds: number): void };

/** a helmetless Gondor man (not in the preload: build it behind the loading screen, hand it to spawnBoromir) */
export function makeBoromirBody(): Humanoid {
  return createHumanoid({ kind: 'gondor', seed: 11, weapon: 'sword', offhand: 'shield', helmet: false });
}

/**
 * Boromir kneels where he fell, bareheaded (a Gondor man; the stock soldier wears a helmet, so the body is
 * swapped for a helmetless one, the same trick Lurtz uses). Not targetable, never moves on his own.
 */
export function spawnBoromir(level: LevelAPI, at: THREE.Vector3, facing: number, body?: Humanoid): Ally {
  const b = level.spawnAlly({ kind: 'gondor', name: 'Boromir', anchor: at.clone() }, at, facing);
  b.aiEnabled = false;
  const sw = b as unknown as Swappable;
  try {
    const h = body ?? makeBoromirBody();
    const old = sw.body;
    old.root.removeFromParent();
    old.dispose();
    sw.body = h;
    sw.object.add(h.root);
    sw.clearZones();
    sw.buildHumanoidZones(h, { girth: 1 });
  } catch (err) {
    console.warn('[amon_hen] Boromir body swap failed, keeping the stock soldier', err);
  }
  sw.playSpecial('kneel', 1e9);
  return b;
}

/** a point that makes `who` face `target` (the allies turn toward their moveTarget / foe on their own) */
export function faceYaw(from: THREE.Vector3, to: THREE.Vector3): number {
  return yawOf(to.x - from.x, to.z - from.z);
}

/** walk an ally (AI off) to a point; null clears it. The Ally contract has no moveTarget, the actor does. */
export function walkAlly(a: Ally, to: THREE.Vector3 | null): void {
  (a as unknown as { moveTarget: THREE.Vector3 | null }).moveTarget = to;
}

/** hold a special pose ('kneel', 'cheer'...) on an ally for `seconds` */
export function poseAlly(a: Ally, pose: string, seconds: number): void {
  (a as unknown as Swappable).playSpecial(pose, seconds);
}

/** place an ally (AI off) at a point, facing a point */
export function setAlly(a: Ally, at: THREE.Vector3, facePoint: THREE.Vector3): void {
  a.object.position.copy(at);
  a.velocity.set(0, 0, 0);
  const sw = a as unknown as Swappable;
  sw.facing = yawOf(facePoint.x - at.x, facePoint.z - at.z);
  a.object.rotation.y = sw.facing;
}
