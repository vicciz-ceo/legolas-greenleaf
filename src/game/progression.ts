/**
 * Progression, upgrades, ranks and the save file (owner: shell).
 *
 * - Save lives in localStorage under 'greenleaf.save.v1'. It is versioned and sanitised field by
 *   field on load, so a corrupted / hand-edited / older file can never crash the game: bad
 *   fields fall back to defaults, good ones are kept.
 * - `stats()` folds the purchased upgrades and the difficulty into the PlayerStats the player uses.
 * - `computeRank()` turns a finished chapter into score / rank / upgrade points.
 */
import type {
  ArrowType, ChapterResult, Difficulty, PlayerStats, Progression, Quality, Rank, SaveData, Settings,
  UpgradeDef, UpgradeId,
} from '../core/types';

export const SAVE_KEY = 'greenleaf.save.v1';

/** Story order, used when the caller does not pass the real chapter list. */
export const DEFAULT_CHAPTER_ORDER: readonly string[] = [
  'mirkwood', 'barrels', 'laketown', 'ravenhill', 'moria', 'amon_hen', 'helms_deep', 'pelennor', 'black_gate',
];

// ── upgrades ─────────────────────────────────────────────────────────────────

export const UPGRADES: readonly UpgradeDef[] = [
  { id: 'draw_speed', name: 'Swift Draw', description: 'Reach full draw 10% faster per level.', maxLevel: 3, cost: [2, 3, 4] },
  { id: 'arrow_damage', name: 'Keen Arrowheads', description: 'Arrows deal 15% more damage per level.', maxLevel: 3, cost: [2, 3, 5] },
  { id: 'knife_mastery', name: 'Knife Mastery', description: 'Knives deal 20% more damage per level and the combo flows faster.', maxLevel: 3, cost: [2, 3, 4] },
  { id: 'agility', name: 'Elven Agility', description: 'Run faster and dash again sooner.', maxLevel: 3, cost: [2, 3, 4] },
  { id: 'focus', name: 'Focus', description: 'A deeper Focus meter and one more mark per volley per level.', maxLevel: 3, cost: [3, 4, 5] },
  { id: 'vitality', name: 'Vitality', description: '+20 maximum health per level.', maxLevel: 3, cost: [2, 3, 4] },
  { id: 'piercing_arrows', name: 'Galadhrim Arrows', description: 'Unlocks piercing arrows that pass through enemies. Press 2 to equip.', maxLevel: 1, cost: [5] },
  { id: 'triple_shot', name: 'Triple Shot', description: 'Unlocks a spread of three arrows per draw. Press 3 to equip.', maxLevel: 1, cost: [6] },
];

const UPGRADE_IDS = UPGRADES.map((u) => u.id);

/** base stats at normal difficulty with no upgrades (mirrors the player's defaults) */
const BASE = {
  maxHp: 100,
  drawTime: 0.55,
  arrowDamage: 34,
  knifeDamage: 22,
  moveSpeed: 6.5,
  dashCooldown: 0.7,
  focusMax: 100,
  focusTargets: 4,
};

export const DIFFICULTY_TUNING: Record<Difficulty, { damageTakenMul: number; regen: number }> = {
  easy: { damageTakenMul: 0.6, regen: 6 },
  normal: { damageTakenMul: 1.0, regen: 3 },
  hard: { damageTakenMul: 1.5, regen: 1 },
};

// ── ranks ────────────────────────────────────────────────────────────────────

const RANK_POINTS: Record<Rank, number> = { S: 5, A: 4, B: 3, C: 2, D: 1 };
export const RANK_THRESHOLDS: { rank: Rank; min: number }[] = [
  { rank: 'S', min: 880 },
  { rank: 'A', min: 740 },
  { rank: 'B', min: 580 },
  { rank: 'C', min: 400 },
  { rank: 'D', min: 0 },
];

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/** pure scoring: 0..1000 from time vs par, accuracy, headshot ratio and damage taken */
export function scoreOf(
  r: Pick<ChapterResult, 'timeSec' | 'shots' | 'hits' | 'headshots' | 'damageTaken'>,
  parTimeSec: number,
): number {
  const par = Math.max(1, parTimeSec);
  // on par or faster = full marks, twice the par time = nothing
  const time = r.timeSec <= par ? 1 : clamp01(1 - (r.timeSec - par) / par);
  const accuracy = r.shots > 0 ? clamp01(r.hits / r.shots / 0.6) : 0.4;
  const head = r.hits > 0 ? clamp01(r.headshots / r.hits / 0.35) : 0;
  const damage = clamp01(1 - r.damageTaken / 300);
  return Math.round(1000 * (0.3 * time + 0.25 * accuracy + 0.15 * head + 0.3 * damage));
}

export function rankOf(score: number): Rank {
  for (const t of RANK_THRESHOLDS) if (score >= t.min) return t.rank;
  return 'D';
}

const RANK_VALUE: Record<Rank, number> = { D: 0, C: 1, B: 2, A: 3, S: 4 };

// ── settings & save ──────────────────────────────────────────────────────────

/** touch / mobile devices default to the Low preset */
function isMobile(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    if (typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches) return true;
    if ('ontouchstart' in window && (navigator.maxTouchPoints ?? 0) > 0) return true;
    if (typeof navigator !== 'undefined' && /Android|iPhone|iPad|iPod|Mobi/i.test(navigator.userAgent)) return true;
  } catch {
    /* ignore */
  }
  return false;
}

export function defaultSettings(): Settings {
  return {
    difficulty: 'normal',
    quality: isMobile() ? 'low' : 'high',
    sensitivity: 1,
    invertY: false,
    master: 0.8,
    music: 0.7,
    sfx: 0.9,
    subtitles: true,
    aimAssist: false,
    showFps: false,
  };
}

const num = (v: unknown, def: number, min: number, max: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.max(min, Math.min(max, v)) : def;
const bool = (v: unknown, def: boolean): boolean => (typeof v === 'boolean' ? v : def);
const oneOf = <T extends string>(v: unknown, list: readonly T[], def: T): T =>
  typeof v === 'string' && (list as readonly string[]).includes(v) ? (v as T) : def;

export function sanitizeSettings(raw: unknown, base: Settings = defaultSettings()): Settings {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    difficulty: oneOf<Difficulty>(o.difficulty, ['easy', 'normal', 'hard'], base.difficulty),
    quality: oneOf<Quality>(o.quality, ['low', 'medium', 'high', 'ultra'], base.quality),
    sensitivity: num(o.sensitivity, base.sensitivity, 0.1, 5),
    invertY: bool(o.invertY, base.invertY),
    master: num(o.master, base.master, 0, 1),
    music: num(o.music, base.music, 0, 1),
    sfx: num(o.sfx, base.sfx, 0, 1),
    subtitles: bool(o.subtitles, base.subtitles),
    aimAssist: bool(o.aimAssist, base.aimAssist),
    showFps: bool(o.showFps, base.showFps),
  };
}

/** a chapter id usable as a record key (never an Object.prototype member name) */
function safeKey(id: string): boolean {
  return id.length > 0 && id.length < 64 && !(id in Object.prototype);
}

/** opening balance of a save written before per-chapter rivalry shares existed */
const RIVALRY_LEGACY = '_before';

function freshSave(first: string | undefined): SaveData {
  return {
    version: 1,
    unlocked: first ? [first] : [],
    best: {},
    points: 0,
    upgrades: {},
    settings: defaultSettings(),
    rivalryTotals: { legolas: 0, gimli: 0 },
  };
}

/** validate arbitrary parsed JSON into a SaveData; never throws */
export function sanitizeSave(raw: unknown, first: string | undefined): SaveData {
  const out = freshSave(first);
  if (!raw || typeof raw !== 'object') return out;
  const o = raw as Record<string, unknown>;
  if (o.version !== 1) return out; // unknown future / ancient format: start fresh rather than guess

  if (Array.isArray(o.unlocked)) {
    const ids = o.unlocked.filter((x): x is string => typeof x === 'string' && x.length > 0 && x.length < 64);
    out.unlocked = Array.from(new Set(ids));
  }
  if (first && !out.unlocked.includes(first)) out.unlocked.unshift(first);

  if (o.best && typeof o.best === 'object') {
    for (const [id, v] of Object.entries(o.best as Record<string, unknown>)) {
      if (!v || typeof v !== 'object' || !safeKey(id)) continue;
      const b = v as Record<string, unknown>;
      // own keys only: `in` also accepted inherited names such as 'constructor' or 'toString' as ranks
      if (typeof b.rank === 'string' && Object.prototype.hasOwnProperty.call(RANK_VALUE, b.rank) && typeof b.score === 'number' && Number.isFinite(b.score)) {
        out.best[id] = { rank: b.rank as Rank, score: Math.max(0, Math.round(b.score)) };
      }
    }
  }
  out.points = Math.floor(num(o.points, 0, 0, 1e6));

  if (o.upgrades && typeof o.upgrades === 'object') {
    const up = o.upgrades as Record<string, unknown>;
    for (const def of UPGRADES) {
      const lv = up[def.id];
      if (typeof lv === 'number' && Number.isFinite(lv) && lv > 0) out.upgrades[def.id] = Math.min(def.maxLevel, Math.floor(lv));
    }
  }
  out.settings = sanitizeSettings(o.settings);
  if (o.rivalryTotals && typeof o.rivalryTotals === 'object') {
    const r = o.rivalryTotals as Record<string, unknown>;
    out.rivalryTotals = { legolas: Math.floor(num(r.legolas, 0, 0, 1e6)), gimli: Math.floor(num(r.gimli, 0, 0, 1e6)) };
  }
  if (o.rivalryByChapter && typeof o.rivalryByChapter === 'object' && !Array.isArray(o.rivalryByChapter)) {
    const by: Record<string, { legolas: number; gimli: number }> = {};
    for (const [id, v] of Object.entries(o.rivalryByChapter as Record<string, unknown>)) {
      if (!v || typeof v !== 'object' || !safeKey(id)) continue;
      const r = v as Record<string, unknown>;
      by[id] = { legolas: Math.floor(num(r.legolas, 0, 0, 1e6)), gimli: Math.floor(num(r.gimli, 0, 0, 1e6)) };
    }
    out.rivalryByChapter = by;
  }
  if (o.last && typeof o.last === 'object') {
    const l = o.last as Record<string, unknown>;
    if (typeof l.chapterId === 'string' && l.chapterId) {
      out.last = { chapterId: l.chapterId, checkpoint: Math.floor(num(l.checkpoint, 0, 0, 99)) };
    }
  }
  return out;
}

// ── factory ──────────────────────────────────────────────────────────────────

export interface ProgressionExt extends Progression {
  /** ids of the story chapters in order (used for unlocking); may be replaced after construction */
  setChapterOrder(order: readonly string[]): void;
  /** total upgrade points ever spent (diagnostics) */
  readonly spent: number;
  /**
   * rivalry count a (non-respawn) run of this chapter starts from: the shares of the chapters before
   * it in story order. A replay therefore never starts from totals that already contain itself.
   */
  rivalryBaseline(chapterId: string): { legolas: number; gimli: number };
}

function storage(): Storage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null; // blocked (private mode, sandboxed iframe)
  }
}

export function createProgression(chapterOrder?: readonly string[] | (() => readonly string[]), store: Storage | null = storage()): ProgressionExt {
  let order: readonly string[] = typeof chapterOrder === 'function' ? chapterOrder() : chapterOrder ?? DEFAULT_CHAPTER_ORDER;

  function load(): SaveData {
    let parsed: unknown = null;
    try {
      const txt = store?.getItem(SAVE_KEY);
      if (txt) parsed = JSON.parse(txt);
    } catch {
      parsed = null; // corrupted JSON
    }
    return sanitizeSave(parsed, order[0]);
  }

  let data = load();

  const p: ProgressionExt = {
    get data() {
      return data;
    },
    upgrades: UPGRADES,
    get spent() {
      let s = 0;
      for (const u of UPGRADES) for (let i = 0; i < (data.upgrades[u.id] ?? 0); i++) s += u.cost[i] ?? 0;
      return s;
    },
    setChapterOrder(o) {
      order = o;
      if (order[0] && !data.unlocked.includes(order[0])) data.unlocked.unshift(order[0]);
    },
    save() {
      try {
        store?.setItem(SAVE_KEY, JSON.stringify(data));
      } catch {
        /* quota / blocked: the game keeps working without persistence */
      }
    },
    reset() {
      const keep = data.settings;
      data = freshSave(order[0]);
      data.settings = keep;
      p.save();
    },
    level(id) {
      return data.upgrades[id] ?? 0;
    },
    canBuy(id) {
      const def = UPGRADES.find((u) => u.id === id);
      if (!def) return false;
      const lv = p.level(id);
      return lv < def.maxLevel && data.points >= def.cost[lv];
    },
    buy(id) {
      if (!p.canBuy(id)) return false;
      const def = UPGRADES.find((u) => u.id === id)!;
      const lv = p.level(id);
      data.points -= def.cost[lv];
      data.upgrades[id] = lv + 1;
      p.save();
      return true;
    },
    unlockedArrows() {
      const a: ArrowType[] = ['standard'];
      if (p.level('piercing_arrows') > 0) a.push('piercing');
      if (p.level('triple_shot') > 0) a.push('triple');
      return a;
    },
    stats(): PlayerStats {
      const L = (id: UpgradeId) => p.level(id);
      const diff = DIFFICULTY_TUNING[data.settings.difficulty] ?? DIFFICULTY_TUNING.normal;
      return {
        maxHp: BASE.maxHp + 20 * L('vitality'),
        drawTime: BASE.drawTime * (1 - 0.1 * L('draw_speed')),
        arrowDamage: BASE.arrowDamage * (1 + 0.15 * L('arrow_damage')),
        knifeDamage: BASE.knifeDamage * (1 + 0.2 * L('knife_mastery')),
        moveSpeed: BASE.moveSpeed + 0.3 * L('agility'),
        dashCooldown: BASE.dashCooldown - 0.1 * L('agility'),
        focusMax: BASE.focusMax + 25 * L('focus'),
        focusTargets: BASE.focusTargets + L('focus'),
        damageTakenMul: diff.damageTakenMul,
        regen: diff.regen,
      };
    },
    computeRank(r, parTimeSec) {
      const score = scoreOf(r, parTimeSec);
      const rank = rankOf(score);
      let points = RANK_POINTS[rank];
      if (!data.best[r.chapterId]) points += 2; // first clear
      if (r.rivalry && r.rivalry.legolas > r.rivalry.gimli) points += 1; // beat Gimli
      return { score, rank, points };
    },
    rivalryBaseline(chapterId) {
      const by = data.rivalryByChapter;
      if (!by) return { ...data.rivalryTotals }; // old save: everything so far
      const idx = order.indexOf(chapterId);
      let legolas = 0;
      let gimli = 0;
      for (const [id, v] of Object.entries(by)) {
        if (id === chapterId) continue;
        const i = order.indexOf(id);
        if (id !== RIVALRY_LEGACY && idx >= 0 && (i < 0 || i > idx)) continue; // later chapters
        legolas += v.legolas;
        gimli += v.gimli;
      }
      return { legolas, gimli };
    },
    recordResult(r) {
      const prev = data.best[r.chapterId];
      if (!prev || r.score > prev.score || RANK_VALUE[r.rank] > RANK_VALUE[prev.rank]) {
        data.best[r.chapterId] = {
          rank: !prev || RANK_VALUE[r.rank] >= RANK_VALUE[prev.rank] ? r.rank : prev.rank,
          score: Math.max(prev?.score ?? 0, r.score),
        };
      }
      data.points += Math.max(0, Math.floor(r.pointsEarned));
      if (r.rivalry) {
        if (!data.rivalryByChapter) {
          // first clear with shares: an older save's totals become a fixed opening balance
          data.rivalryByChapter = {};
          const t = data.rivalryTotals;
          if (t.legolas || t.gimli) data.rivalryByChapter[RIVALRY_LEGACY] = { ...t };
        }
        // this run started from the baseline (game.ts): its share replaces any earlier clear's
        const base = p.rivalryBaseline(r.chapterId);
        data.rivalryByChapter[r.chapterId] = {
          legolas: Math.max(0, r.rivalry.legolas - base.legolas),
          gimli: Math.max(0, r.rivalry.gimli - base.gimli),
        };
        let legolas = 0;
        let gimli = 0;
        for (const v of Object.values(data.rivalryByChapter)) {
          legolas += v.legolas;
          gimli += v.gimli;
        }
        data.rivalryTotals = { legolas, gimli };
      }
      const i = order.indexOf(r.chapterId);
      const next = i >= 0 ? order[i + 1] : undefined;
      if (next && !data.unlocked.includes(next)) data.unlocked.push(next);
      data.last = next ? { chapterId: next, checkpoint: 0 } : { chapterId: r.chapterId, checkpoint: 0 };
      p.save();
    },
  };
  return p;
}

export { UPGRADE_IDS };
