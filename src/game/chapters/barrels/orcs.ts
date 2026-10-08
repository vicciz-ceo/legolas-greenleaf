/**
 * The orcs of the Forest River: bank archers, bank melee orcs, and the LEAPERS that jump down from
 * the banks onto the barrels and fight there. Plus the housekeeping a river needs: an orc that
 * wades in is swept away, and anything far behind the convoy is dropped.
 *
 * Leapers are ordinary enemies (so arrows, knives and the rivalry-free tally all just work) driven
 * by a small state machine:
 *   wait  standing on the bank, AI off, until a free barrel is about to pass
 *   air   a ballistic leap aimed at where the barrel WILL be
 *   ride  standing on the barrel's platform (the motor carries him), AI off; scripted telegraphed
 *         attacks against the rider next to him, and a hop to a barrel beside Legolas when he is out of reach
 */
import * as THREE from 'three';
import type { Combatant, Enemy, EnemyArchetype, EnemySpec, LevelAPI } from '../../../core/types';
import { clamp } from '../../../core/math';
import type { Gorge } from './world';
import type { Barrel, BarrelTrain } from './train';
import { riverPath, riverPos, waterY, widthAt, shelfRight, shelfLeft, bankPos } from './layout';

const GRAV = 22;
const _p = new THREE.Vector3();
const _q = new THREE.Vector3();

type LState = 'wait' | 'air' | 'ride' | 'done';

interface Leaper {
  e: Enemy;
  state: LState;
  barrel: Barrel | null;
  target: Barrel | null;
  t: number;
  T: number;
  hold: THREE.Vector3;
  cd: number;
  hopCd: number;
  /** give up waiting after the convoy head is this far past */
  patienceS: number;
  s: number;
  bank: 'L' | 'R' | 'log';
  /** do not leap before the convoy head has reached this s */
  minLeadS: number;
  /** keep the AI on (archers shoot) while waiting */
  waitAi: boolean;
  /** the horizontal distance window for a leap */
  reach: [number, number];
}

export interface LeaperOpts extends Partial<EnemySpec> {
  /** the leaper stands on something other than a bank (the log bridge) at world position `at` */
  at?: THREE.Vector3;
  minLeadS?: number;
  waitAi?: boolean;
}

export class RiverFoes {
  private readonly leapers: Leaper[] = [];
  private readonly routes: { e: Enemy; pts: THREE.Vector3[]; i: number }[] = [];
  private readonly immune = new Set<Combatant>();
  private sweepT = 0;
  private rng: () => number;

  constructor(private readonly level: LevelAPI, private readonly gorge: Gorge, private readonly train: BarrelTrain) {
    this.rng = () => level.rng();
  }

  // ── placement ──────────────────────────────────────────────────────────────

  /** a spot on a bank: side 'L' (the walkable shelf) or 'R' (cliffs and ledges), `e` metres from the water's edge */
  bankPoint(side: 'L' | 'R', s: number, e: number, out = new THREE.Vector3()): THREE.Vector3 {
    if (side === 'L') bankPos(s, e, out);
    else riverPos(s, widthAt(s) / 2 + e, 0, out);
    out.y = this.gorge.heightAt(out.x, out.z);
    return out;
  }

  /** usable width of a bank at s */
  bankWidth(side: 'L' | 'R', s: number): number {
    return side === 'L' ? shelfLeft(s) : shelfRight(s);
  }

  /** facing a bank spot toward the river */
  private faceRiver(side: 'L' | 'R', s: number): number {
    riverPos(s, 0, 0, _q);
    const p = this.bankPoint(side, s, 1);
    return Math.atan2(_q.x - p.x, _q.z - p.z);
  }

  /** an archer holding a ledge */
  archer(side: 'L' | 'R', s: number, e: number, o: Partial<EnemySpec> = {}): Enemy {
    const p = this.bankPoint(side, s, e);
    return this.level.spawnEnemy({ archetype: 'orc_archer', behavior: 'hold', ...o }, p, this.faceRiver(side, s));
  }

  /** a melee orc on a bank (charges the player: wades in and is swept away, or waits at the water) */
  bankOrc(side: 'L' | 'R', s: number, e: number, archetype: EnemyArchetype = 'orc', o: Partial<EnemySpec> = {}): Enemy {
    const p = this.bankPoint(side, s, e);
    return this.level.spawnEnemy({ archetype, ...o }, p, this.faceRiver(side, s));
  }

  /** an orc that leaps onto the convoy as it passes */
  leaper(side: 'L' | 'R' | 'log', s: number, e: number, o: LeaperOpts = {}): Enemy {
    const { at, minLeadS, waitAi, ...spec } = o;
    const p = at ? at.clone() : this.bankPoint(side === 'log' ? 'L' : side, s, e);
    const en = this.level.spawnEnemy({ archetype: 'orc', ...spec }, p, at ? this.faceRiver('L', s) : this.faceRiver(side as 'L' | 'R', s));
    const ai = waitAi ?? false;
    en.aiEnabled = ai;
    this.leapers.push({
      e: en, state: 'wait', barrel: null, target: null, t: 0, T: 0.7, hold: new THREE.Vector3(), cd: 1 + this.rng(), hopCd: 2 + this.rng() * 2,
      patienceS: s + 14, s, bank: side, minLeadS: minLeadS ?? 0, waitAi: ai, reach: side === 'log' ? [0.5, 11.5] : [2.5, 9.8],
    });
    return en;
  }

  /** put an enemy straight onto a barrel as a rider (the captain hauling himself out of the river) */
  adopt(e: Enemy, b: Barrel): void {
    for (let i = this.leapers.length - 1; i >= 0; i--) if (this.leapers[i].e === e) this.leapers.splice(i, 1);
    e.aiEnabled = false;
    e.position.copy(b.stand);
    e.velocity.set(0, 0, 0);
    b.rider = 'enemy';
    const hold = new THREE.Vector3().copy(b.stand);
    e.moveTarget = hold;
    this.leapers.push({
      e, state: 'ride', barrel: b, target: null, t: 0, T: 0.7, hold, cd: 1.2, hopCd: 2.5, patienceS: 1e9, s: b.s, bank: 'log', minLeadS: 0, waitAi: false, reach: [0.5, 9],
    });
    this.train.landOn(b, 1.2);
  }

  /** walk an enemy along waypoints (the stairs), then let its AI take over */
  route(e: Enemy, pts: THREE.Vector3[]): Enemy {
    this.routes.push({ e, pts: pts.map((p) => p.clone()), i: 0 });
    return e;
  }

  /** an enemy the water must not claim (the captain) */
  protect(c: Combatant): void {
    this.immune.add(c);
  }

  /** orcs currently riding barrels */
  riders(): Enemy[] {
    return this.leapers.filter((l) => l.state === 'ride' && l.e.alive).map((l) => l.e);
  }

  /** every barrel that carries an enemy gets released when its rider dies */
  private release(l: Leaper): void {
    if (l.barrel && l.barrel.rider === 'enemy') l.barrel.rider = null;
    l.barrel = null;
  }

  // ── per-frame ──────────────────────────────────────────────────────────────

  update(dt: number): void {
    const { player } = this.level.ctx;
    for (const l of this.leapers) this.step(l, dt);
    for (let i = this.routes.length - 1; i >= 0; i--) {
      const r = this.routes[i];
      if (!r.e.alive || r.i >= r.pts.length + 1) {
        this.routes.splice(i, 1);
        continue;
      }
      if (!r.e.moveTarget) {
        if (r.i < r.pts.length) r.e.moveTarget = r.pts[r.i].clone();
        r.i++;
      }
    }
    this.sweepT -= dt;
    if (this.sweepT > 0) return;
    this.sweepT = 0.25;
    const { fx, audio } = this.level.ctx;
    for (const c of this.level.ctx.combatants.byTeam('enemy')) {
      if (!c.alive || this.immune.has(c)) continue;
      const dx = c.position.x - player.position.x;
      const dz = c.position.z - player.position.z;
      if (dx * dx + dz * dz > 140 * 140 && !c.isBoss) {
        // far behind the convoy: gone
        const lp = this.leapers.find((x) => x.e === c);
        if (lp) {
          this.release(lp);
          lp.state = 'done';
        }
        for (let i = this.routes.length - 1; i >= 0; i--) if (this.routes[i].e === c) this.routes.splice(i, 1);
        this.level.removeCombatant(c);
        continue;
      }
      // wading in: swept away
      const nr = riverPath.nearest(c.position.x, c.position.z);
      const hw = widthAt(nr.s) / 2;
      if (nr.dist < hw + 0.2 && c.position.y < waterY(nr.s) - 0.5) {
        const lp = this.leapers.find((x) => x.e === c);
        if (lp && lp.state === 'air') continue;
        fx.splash(c.position, 1.6);
        audio.play('splash', { pos: c.position, volume: 0.7 });
        c.takeDamage({ amount: 1e5, type: 'fall', source: null });
      }
    }
  }

  private freeBarrel(b: Barrel): boolean {
    return !b.smashed && b.rider === null;
  }

  private launch(l: Leaper, b: Barrel): void {
    const e = l.e;
    // flight time from the horizontal distance to where the barrel will be
    let T = 0.7;
    for (let k = 0; k < 2; k++) {
      _p.copy(b.stand).addScaledVector(b.vel, T);
      const d = Math.hypot(_p.x - e.position.x, _p.z - e.position.z);
      T = clamp(d / 10.5, 0.5, 0.95);
    }
    _p.copy(b.stand).addScaledVector(b.vel, T);
    const dy = _p.y - e.position.y;
    // a drop needs an upward kick to leave the ground at all (the motor pins a grounded body that moves down)
    const tMin = (1.2 + Math.sqrt(1.44 - 2 * GRAV * Math.min(dy, 0))) / GRAV;
    if (dy < 0 && T < tMin) {
      T = tMin;
      _p.copy(b.stand).addScaledVector(b.vel, T);
    }
    const vy = (_p.y - e.position.y + 0.5 * GRAV * T * T) / T;
    e.aiEnabled = false;
    e.moveTarget = null;
    e.velocity.set((_p.x - e.position.x) / T, vy, (_p.z - e.position.z) / T);
    if (l.barrel) this.release(l);
    b.rider = 'enemy';
    l.target = b;
    l.T = T;
    l.t = 0;
    l.state = 'air';
    this.level.ctx.audio.play('orc_roar', { pos: e.position, volume: 0.6, pitch: 1.1 });
  }

  private step(l: Leaper, dt: number): void {
    const e = l.e;
    const { player } = this.level.ctx;
    if (!e.alive) {
      if (l.state !== 'done') {
        if (l.target && l.target.rider === 'enemy' && l.state === 'air') l.target.rider = null;
        this.release(l);
        l.state = 'done';
      }
      return;
    }
    switch (l.state) {
      case 'wait': {
        if (!this.train.running || this.train.sLead < l.minLeadS) return;
        // a free barrel about to pass: prefer the ones near Legolas
        let best: Barrel | null = null;
        let bs = Infinity;
        for (const b of this.train.barrels) {
          if (!this.freeBarrel(b)) continue;
          _p.copy(b.stand).addScaledVector(b.vel, 0.7);
          const dx = _p.x - e.position.x;
          const dz = _p.z - e.position.z;
          const d = Math.hypot(dx, dz);
          if (d < l.reach[0] || d > l.reach[1]) continue;
          // approaching, not yet well past (a log crew drops onto the barrels beneath it)
          if (l.bank !== 'log' && b.s > l.s + 3.5) continue;
          const score = Math.hypot(b.stand.x - player.position.x, b.stand.z - player.position.z) + d * 0.2;
          if (score < bs) {
            bs = score;
            best = b;
          }
        }
        if (best) this.launch(l, best);
        else if (this.train.sLead > l.patienceS + 30) {
          // the convoy has gone by: fight like any other orc
          e.aiEnabled = true;
          l.state = 'done';
        }
        return;
      }
      case 'air': {
        l.t += dt;
        const b = l.target!;
        const rem = Math.max(0.2, l.T - l.t);
        _p.copy(b.stand).addScaledVector(b.vel, rem);
        e.velocity.x = clamp((_p.x - e.position.x) / rem, -16, 16);
        e.velocity.z = clamp((_p.z - e.position.z) / rem, -16, 16);
        const close = Math.hypot(e.position.x - b.stand.x, e.position.z - b.stand.z) < 1.2;
        if (l.t > 0.3 && close && e.position.y <= b.stand.y + 0.12) {
          l.state = 'ride';
          l.barrel = b;
          l.target = null;
          this.train.landOn(b, 0.8);
          l.cd = 0.8 + this.rng() * 0.7;
          l.hopCd = 2.5 + this.rng() * 2;
          e.moveTarget = l.hold.copy(b.stand);
        } else if (l.t > l.T + 0.5) {
          // missed the barrel: into the river
          if (b.rider === 'enemy') b.rider = null;
          l.state = 'done';
          e.aiEnabled = true;
        }
        return;
      }
      case 'ride': {
        const b = l.barrel!;
        l.hold.copy(b.stand);
        e.moveTarget = l.hold;
        // fell off?
        if (e.position.y < b.stand.y - 1.0) {
          this.release(l);
          l.state = 'done';
          return;
        }
        l.cd -= dt;
        l.hopCd -= dt;
        const dx = player.position.x - e.position.x;
        const dz = player.position.z - e.position.z;
        const d = Math.hypot(dx, dz);
        if (d < 3.1 && Math.abs(player.position.y - e.position.y) < 1.6) {
          if (l.cd <= 0 && e.attack) {
            const k = this.rng();
            if (e.attack(k < 0.4 ? 'slash' : k < 0.75 ? 'backslash' : 'overhead', { target: player })) l.cd = 1.5 + this.rng() * 1.1;
          }
        } else if (l.hopCd <= 0 && player.alive) {
          // too far to fight: hop to a free barrel beside Legolas
          let best: Barrel | null = null;
          let bs = Infinity;
          for (const nb of this.train.barrels) {
            if (nb === b || !this.freeBarrel(nb)) continue;
            const dp = Math.hypot(nb.stand.x - player.position.x, nb.stand.z - player.position.z);
            const dm = Math.hypot(nb.stand.x - e.position.x, nb.stand.z - e.position.z);
            if (dm > 6.4 || dp < 1.2 || dp > 4.2) continue;
            if (dp < bs) {
              bs = dp;
              best = nb;
            }
          }
          if (best) this.launch(l, best);
          l.hopCd = 1.6 + this.rng() * 1.5;
        }
        return;
      }
      default:
    }
  }

  /** number of orcs still on the rails (waiting, flying or riding) */
  active(): number {
    return this.leapers.filter((l) => l.state !== 'done' && l.e.alive).length;
  }
}
