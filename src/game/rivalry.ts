/**
 * Gimli kill-count rivalry: HUD counter, kill_count sfx, milestone banter (paraphrased, in the
 * films' spirit) and the autoGimli rubber band that keeps Gimli within ±3 of the player and
 * slightly ahead on average while enemies are alive.
 *
 * Counting: the player calls addLegolas() for its own kills, a rivalry ally (Gimli) calls
 * addGimli() for his. This module also watches the registry for big creatures felled by the
 * player ("That still only counts as one!").
 */
import type { Combatant, GameContext, Rivalry, Speaker } from '../core/types';
import { clamp } from '../core/math';

const BANTER_GAP = 6;
const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

/** 42 → "Forty-two" (falls back to digits ≥ 100) */
export function numberWord(n: number): string {
  let s: string;
  if (n < 0 || n >= 100 || !Number.isInteger(n)) s = String(n);
  else if (n < 20) s = ONES[n];
  else s = TENS[Math.floor(n / 10)] + (n % 10 ? '-' + ONES[n % 10] : '');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

interface Line {
  speaker: Speaker;
  text: string;
  prio: number;
}

/** pure rubber-band target for Gimli's count given the player's, with a slow lead oscillation */
export function gimliTarget(legolas: number, t: number): number {
  const bias = 1 + Math.sin((t * Math.PI * 2) / 45) * 1.5; // −0.5 … 2.5, ≈ +1 on average
  return clamp(Math.round(legolas + bias), legolas - 3, legolas + 3);
}

export function createRivalry(ctx: GameContext): Rivalry {
  let active = false;
  let legolas = 0;
  let gimli = 0;
  let clock = 0;
  let sinceBanter = BANTER_GAP;
  let pending: Line | null = null;
  let pendingDelay = 0;
  let sfxT = 0;
  let autoT = 3;
  let paceEma = 6;
  let lastLegolasKillT = -1;
  let leader: 'legolas' | 'gimli' | 'tie' = 'tie';
  let warnedGap = false;

  const hud = () => ctx.hud;

  function say(speaker: Speaker, text: string, prio = 1, delay = 0.35) {
    if (!active && prio < 5) return;
    if (pending && pending.prio > prio) return;
    if (prio < 3 && sinceBanter < BANTER_GAP) return;
    pending = { speaker, text, prio };
    pendingDelay = delay;
  }

  function tick(who: 'legolas' | 'gimli') {
    if (sfxT <= 0) {
      ctx.audio.play('kill_count', { volume: 0.55, pitch: who === 'legolas' ? 1.12 : 0.86 });
      sfxT = 0.12;
    }
    hud().setRivalry(legolas, gimli);
  }

  function afterCount(who: 'legolas' | 'gimli', n: number) {
    const now: typeof leader = legolas > gimli ? 'legolas' : gimli > legolas ? 'gimli' : 'tie';
    const L = numberWord(legolas);
    const G = numberWord(gimli);
    if (who === 'legolas') {
      if (legolas % 10 === 0 && legolas > 0) {
        say('Legolas', `${L}, Master Dwarf.`, 2);
      } else if (now === 'legolas' && leader !== 'legolas') {
        say('Gimli', gimli === 0 ? `Hold on — I've not even started!` : `${L}?! I'll not be outdone by an elf!`, 1);
      } else if (legolas - gimli >= 3 && !warnedGap) {
        warnedGap = true;
        say('Gimli', `Stop showing off and leave some for me!`, 2);
      } else if (legolas === 2 && gimli < 2) {
        say('Legolas', `Two already, Gimli.`, 1);
      } else if (now === 'tie' && legolas > 2) {
        say('Gimli', `${L} apiece! It's not over yet.`, 1);
      }
    } else {
      if (now === 'gimli' && leader !== 'gimli') {
        say('Gimli', `${G}! Ha! Keep up, laddie!`, 1);
      } else if (gimli - legolas >= 3 && !warnedGap) {
        warnedGap = true;
        say('Gimli', `I'm on ${G}! Are you even trying, elf?`, 2);
      } else if (gimli % 10 === 0 && gimli > 0) {
        say('Gimli', `${G}! Count them, elf — ${G}!`, 2);
      } else if (gimli === 1 && legolas === 0) {
        say('Gimli', `That's one!`, 1);
      }
    }
    if (Math.abs(legolas - gimli) < 2) warnedGap = false;
    leader = now;
    void n;
  }

  const r: Rivalry = {
    get active() {
      return active;
    },
    get legolas() {
      return legolas;
    },
    set legolas(v: number) {
      legolas = Math.max(0, Math.floor(v));
      if (active) hud().setRivalry(legolas, gimli);
    },
    get gimli() {
      return gimli;
    },
    set gimli(v: number) {
      gimli = Math.max(0, Math.floor(v));
      if (active) hud().setRivalry(legolas, gimli);
    },
    autoGimli: false,
    start(from) {
      active = true;
      legolas = Math.max(0, from?.legolas ?? 0);
      gimli = Math.max(0, from?.gimli ?? 0);
      leader = legolas > gimli ? 'legolas' : gimli > legolas ? 'gimli' : 'tie';
      clock = 0;
      autoT = 3;
      warnedGap = false;
      lastLegolasKillT = -1;
      sinceBanter = BANTER_GAP;
      hud().setRivalry(legolas, gimli);
      if (legolas + gimli === 0) say('Gimli', `A friendly wager, laddie? Let's see who fells the most.`, 2, 1.2);
      else say('Gimli', `I'm on ${numberWord(gimli)}. Keep counting, elf.`, 2, 1.2);
    },
    stop() {
      if (!active) return;
      const L = numberWord(legolas);
      const G = numberWord(gimli);
      if (legolas > gimli) say('Gimli', `${G}... It's not over, elf. Not by a long way.`, 4, 0.2);
      else if (gimli > legolas) say('Gimli', `${G}! Final count — the dwarf takes the field!`, 4, 0.2);
      else say('Legolas', `${L} each, Gimli. A fair contest.`, 4, 0.2);
      active = false;
      hud().setRivalry(null);
    },
    addLegolas(n = 1) {
      if (!active || n <= 0) return;
      legolas += n;
      if (lastLegolasKillT >= 0) paceEma = paceEma * 0.7 + clamp(clock - lastLegolasKillT, 0.8, 20) * 0.3;
      lastLegolasKillT = clock;
      tick('legolas');
      afterCount('legolas', n);
    },
    addGimli(n = 1) {
      if (!active || n <= 0) return;
      gimli += n;
      tick('gimli');
      afterCount('gimli', n);
    },
    update(dt) {
      sfxT -= dt;
      sinceBanter += dt;
      if (pending) {
        pendingDelay -= dt;
        if (pendingDelay <= 0) {
          hud().subtitle(pending.speaker, pending.text, 2.8);
          pending = null;
          sinceBanter = 0;
        }
      }
      if (!active) return;
      clock += dt;
      if (!r.autoGimli) return;
      let enemiesAlive = false;
      for (const c of ctx.combatants.all()) {
        if (c.alive && c.team === 'enemy') {
          enemiesAlive = true;
          break;
        }
      }
      if (!enemiesAlive) return;
      autoT -= dt;
      if (autoT > 0) return;
      const target = gimliTarget(legolas, clock);
      if (gimli < legolas - 3) {
        r.addGimli(1);
        autoT = 0.45;
      } else if (gimli < target) {
        r.addGimli(1);
        const pace = clamp(paceEma, 1.5, 12);
        autoT = target - gimli >= 2 ? pace * 0.35 : pace * (0.6 + Math.random() * 0.5);
      } else {
        autoT = clamp(paceEma, 1.5, 12) * 0.5;
      }
    },
  };

  // big creatures felled by Legolas
  ctx.combatants.onKill((victim: Combatant, killer: Combatant | null, info) => {
    if (!active) return;
    const byPlayer = killer?.team === 'player' || info.source?.team === 'player';
    if (!byPlayer || victim.team !== 'enemy') return;
    const big = victim.isBoss || victim.maxHp >= 400 || victim.height >= 3.4;
    if (big) say('Gimli', 'That still only counts as one!', 3, 0.9);
  });

  return r;
}
