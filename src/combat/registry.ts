/**
 * Combatant registry: every fighter in the level (player, enemies, allies, custom creatures).
 *
 * - `update(dt)` updates every registered combatant EXCEPT team 'player' (the game loop
 *   updates the player itself), reports deaths, and removes + disposes expired corpses.
 * - Deaths are reported once through `onKill` (via each combatant's `onDeath` hook, with a
 *   polling fallback for combatants whose `onDeath` was overwritten after registration).
 * - `clear()` disposes everything except team 'player' (the player persists across levels).
 *
 * Player-kill bookkeeping (tally, Focus refill, rivalry.addLegolas) lives in the player,
 * which subscribes to `onKill` — the registry itself has no GameContext.
 */
import * as THREE from 'three';
import type { CombatRayHit, Combatant, CombatantRegistry, DamageInfo, Team } from '../core/types';

type KillCb = (victim: Combatant, killer: Combatant | null, info: DamageInfo) => void;

interface Extra {
  lastDamage?: DamageInfo | null;
  expired?: boolean;
}

export interface RegistryExt extends CombatantRegistry {
  /** alive combatants of a team (allocation-free view, valid until the next registry call) */
  aliveOf(team: Team): readonly Combatant[];
}

export function createRegistry(): RegistryExt {
  const list: Combatant[] = [];
  const teams: Record<Team, Combatant[]> = { player: [], ally: [], enemy: [], neutral: [] };
  const aliveTeams: Record<Team, Combatant[]> = { player: [], ally: [], enemy: [], neutral: [] };
  let teamsDirty = true;
  const subs: KillCb[] = [];
  const reported = new WeakSet<Combatant>();
  const wrapped = new WeakMap<Combatant, (self: Combatant, killer: Combatant | null) => void>();
  const updating: Combatant[] = [];

  const TEAMS: Team[] = ['player', 'ally', 'enemy', 'neutral'];
  function rebuildTeams() {
    if (!teamsDirty) return;
    teamsDirty = false;
    for (const k of TEAMS) {
      teams[k].length = 0;
      aliveTeams[k].length = 0;
    }
    for (const c of list) {
      (teams[c.team] ?? teams.neutral).push(c);
      if (c.alive) (aliveTeams[c.team] ?? aliveTeams.neutral).push(c);
    }
  }

  function report(victim: Combatant, killer: Combatant | null) {
    if (reported.has(victim)) return;
    reported.add(victim);
    teamsDirty = true;
    const info: DamageInfo = (victim as Combatant & Extra).lastDamage ?? { amount: victim.maxHp, type: 'scripted', source: killer };
    for (const cb of subs.slice()) {
      try {
        cb(victim, killer, info);
      } catch (e) {
        console.warn('[registry] onKill listener failed', e);
      }
    }
  }

  function hook(c: Combatant) {
    const prev = c.onDeath ?? null;
    const fn = (self: Combatant, killer: Combatant | null) => {
      if (prev) prev(self, killer);
      report(self, killer);
    };
    wrapped.set(c, fn);
    c.onDeath = fn;
  }

  const reg: RegistryExt = {
    add(c) {
      if (list.includes(c)) return;
      list.push(c);
      teamsDirty = true;
      hook(c);
      if (!c.alive) reported.add(c);
    },
    remove(c) {
      const i = list.indexOf(c);
      if (i < 0) return;
      list.splice(i, 1);
      teamsDirty = true;
      if (c.onDeath === wrapped.get(c)) c.onDeath = null;
    },
    all: () => list,
    byTeam(team) {
      rebuildTeams();
      return teams[team];
    },
    aliveOf(team) {
      rebuildTeams();
      return aliveTeams[team];
    },
    nearest(team, pos, maxDist = Infinity, filter) {
      let best: Combatant | null = null;
      let bd = maxDist * maxDist;
      for (const c of list) {
        if (!c.alive || c.team !== team) continue;
        const dx = c.position.x - pos.x;
        const dy = (c.position.y - pos.y) * 0.5;
        const dz = c.position.z - pos.z;
        const d = dx * dx + dy * dy + dz * dz;
        if (d < bd && (!filter || filter(c))) {
          bd = d;
          best = c;
        }
      }
      return best;
    },
    query(pos, radius, team) {
      const out: Combatant[] = [];
      for (const c of list) {
        if (!c.alive || (team && c.team !== team)) continue;
        const r = radius + c.radius;
        const dx = c.position.x - pos.x;
        const dz = c.position.z - pos.z;
        if (dx * dx + dz * dz > r * r) continue;
        if (pos.y < c.position.y - radius || pos.y > c.position.y + c.height + radius) continue;
        out.push(c);
      }
      return out;
    },
    raycast(origin, dir, maxDist, ignoreTeam, ignore) {
      let best: { combatant: Combatant; hit: CombatRayHit } | null = null;
      let bt = maxDist;
      for (const c of list) {
        if (!c.alive || c === ignore || (ignoreTeam && c.team === ignoreTeam)) continue;
        const h = c.raycast(origin, dir, bt);
        if (h && h.t < bt) {
          bt = h.t;
          best = { combatant: c, hit: h };
        }
      }
      return best;
    },
    onKill(cb) {
      subs.push(cb);
      return () => {
        const i = subs.indexOf(cb);
        if (i >= 0) subs.splice(i, 1);
      };
    },
    update(dt) {
      updating.length = 0;
      for (const c of list) updating.push(c);
      for (const c of updating) {
        if (c.team !== 'player') {
          try {
            c.update(dt);
          } catch (e) {
            console.warn(`[registry] ${c.name} update failed`, e);
          }
        }
        if (!c.alive && !reported.has(c)) report(c, (c as Combatant & Extra).lastDamage?.source ?? null);
        else if (c.alive && reported.has(c)) {
          reported.delete(c); // revived
          teamsDirty = true;
        }
        if ((c as Combatant & Extra).expired) {
          reg.remove(c);
          c.dispose();
        }
      }
      teamsDirty = true;
    },
    clear() {
      for (const c of list.slice()) {
        if (c.team === 'player') continue;
        reg.remove(c);
        c.dispose();
      }
      teamsDirty = true;
    },
  };
  return reg;
}

/** distance from a point to a combatant's vertical body axis (for melee / AoE) */
export function distToBody(c: Combatant, p: THREE.Vector3): number {
  const y = Math.max(c.position.y, Math.min(c.position.y + c.height, p.y));
  const dx = p.x - c.position.x;
  const dy = p.y - y;
  const dz = p.z - c.position.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}
