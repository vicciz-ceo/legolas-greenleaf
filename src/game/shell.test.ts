/**
 * Shell unit tests: progression (save robustness, upgrades, ranks, unlocks) and time control.
 * Run with esbuild, no browser needed:
 *   node -e "require('esbuild').build({entryPoints:['src/game/shell.test.ts'],bundle:true,platform:'node',format:'esm',outfile:'/tmp/shell.test.mjs',logLevel:'error'}).then(()=>import('/tmp/shell.test.mjs'))"
 */
import { createProgression, sanitizeSave, scoreOf, rankOf, SAVE_KEY, UPGRADES } from './progression';
import { createTime } from './time';

let failed = 0, passed = 0;
const ok = (c: boolean, m: string) => { if (c) passed++; else { failed++; console.log('  FAIL:', m); } };
const near = (a: number, b: number, e: number, m: string) => ok(Math.abs(a - b) <= e, `${m} got ${a} want ${b}`);
const test = (n: string, f: () => void) => { const b = failed; try { f(); } catch (e) { failed++; console.log('  THROW', (e as Error).stack); } console.log(failed === b ? 'ok   ' + n : 'FAIL ' + n); };

class MemStore implements Storage {
  m = new Map<string, string>();
  get length() { return this.m.size; }
  clear() { this.m.clear(); }
  getItem(k: string) { return this.m.get(k) ?? null; }
  key(i: number) { return [...this.m.keys()][i] ?? null; }
  removeItem(k: string) { this.m.delete(k); }
  setItem(k: string, v: string) { this.m.set(k, v); }
}

test('fresh save: chapter 1 unlocked, defaults', () => {
  const s = new MemStore();
  const p = createProgression(undefined, s);
  ok(p.data.unlocked.length === 1 && p.data.unlocked[0] === 'mirkwood', 'mirkwood unlocked');
  ok(p.data.settings.quality === 'high', 'desktop default quality high (node: not mobile)');
  ok(p.data.points === 0, 'no points');
  ok(p.unlockedArrows().join() === 'standard', 'standard arrows only');
});
test('upgrade defs: 8, costs length matches, arrow unlocks 1 level', () => {
  ok(UPGRADES.length === 8, '8 upgrades');
  for (const u of UPGRADES) ok(u.cost.length === u.maxLevel, `${u.id} cost length`);
  ok(UPGRADES.find((u) => u.id === 'piercing_arrows')!.maxLevel === 1, 'piercing 1 level');
  ok(UPGRADES.find((u) => u.id === 'triple_shot')!.maxLevel === 1, 'triple 1 level');
});
test('buy / canBuy / persistence', () => {
  const s = new MemStore();
  const p = createProgression(undefined, s);
  ok(!p.buy('vitality'), 'cannot buy without points');
  p.data.points = 10;
  ok(p.canBuy('vitality'), 'can buy');
  ok(p.buy('vitality') && p.level('vitality') === 1, 'bought');
  ok(p.data.points === 8, 'cost 2 deducted');
  near(p.stats().maxHp, 120, 1e-9, 'maxHp 120');
  const p2 = createProgression(undefined, s);
  ok(p2.level('vitality') === 1 && p2.data.points === 8, 'persisted');
  while (p2.buy('piercing_arrows')) { p2.data.points = 10; if (p2.level('piercing_arrows') >= 1) break; }
  ok(p2.unlockedArrows().includes('piercing'), 'piercing unlocked');
  ok(!p2.canBuy('piercing_arrows'), 'maxed');
});
test('stats by difficulty', () => {
  const p = createProgression(undefined, new MemStore());
  p.data.settings.difficulty = 'easy'; near(p.stats().damageTakenMul, 0.6, 1e-9, 'easy mul'); near(p.stats().regen, 6, 1e-9, 'easy regen');
  p.data.settings.difficulty = 'normal'; near(p.stats().damageTakenMul, 1, 1e-9, 'normal mul'); near(p.stats().regen, 3, 1e-9, 'normal regen');
  p.data.settings.difficulty = 'hard'; near(p.stats().damageTakenMul, 1.5, 1e-9, 'hard mul'); near(p.stats().regen, 1, 1e-9, 'hard regen');
  near(p.stats().drawTime, 0.55, 1e-9, 'base draw');
  p.data.points = 99; p.buy('draw_speed'); p.buy('draw_speed'); p.buy('draw_speed');
  near(p.stats().drawTime, 0.55 * 0.7, 1e-9, 'draw speed x3');
});
test('corrupted saves never throw', () => {
  for (const txt of ['', '{', 'null', '[]', '"x"', '123', '{"version":2}', '{"version":1,"unlocked":"x","points":"lots","settings":5,"upgrades":{"vitality":99,"nope":3},"best":{"a":{"rank":"Z","score":1}}}']) {
    const s = new MemStore(); s.setItem(SAVE_KEY, txt);
    const p = createProgression(undefined, s);
    ok(p.data.version === 1 && p.data.unlocked.includes('mirkwood'), `survives ${txt.slice(0, 20)}`);
    ok(typeof p.data.points === 'number' && p.data.points >= 0, 'points sane');
    ok(p.level('vitality') <= 3, 'upgrade clamped');
    ok(p.data.settings.quality === 'high' || p.data.settings.quality === 'low', 'settings valid');
  }
  const d = sanitizeSave({ version: 1, unlocked: ['mirkwood', 'barrels', 5], points: 7, upgrades: { vitality: 99 }, best: { barrels: { rank: 'A', score: 800 } }, settings: { quality: 'ultra', sensitivity: 99 }, rivalryTotals: { legolas: 3, gimli: 4 } }, 'mirkwood');
  ok(d.unlocked.join() === 'mirkwood,barrels', 'unlocked filtered'); ok(d.upgrades.vitality === 3, 'clamped to max'); ok(d.settings.quality === 'ultra', 'quality kept'); ok(d.settings.sensitivity === 5, 'sens clamped');
  ok(d.best.barrels.rank === 'A' && d.rivalryTotals.gimli === 4, 'best/rivalry kept');
});
test('blocked localStorage (null store) still works', () => {
  const p = createProgression(undefined, null);
  p.data.points = 5; p.save(); ok(p.buy('agility'), 'works in memory');
});
test('rank scoring', () => {
  const perfect = scoreOf({ timeSec: 100, shots: 10, hits: 8, headshots: 4, damageTaken: 0 }, 120);
  ok(perfect >= 880 && rankOf(perfect) === 'S', `perfect -> S (${perfect})`);
  const bad = scoreOf({ timeSec: 400, shots: 40, hits: 2, headshots: 0, damageTaken: 400 }, 120);
  ok(rankOf(bad) === 'D', `bad -> D (${bad})`);
  const mid = scoreOf({ timeSec: 150, shots: 20, hits: 8, headshots: 1, damageTaken: 80 }, 120);
  ok(['B', 'C', 'A'].includes(rankOf(mid)), `mid rank ${rankOf(mid)} (${mid})`);
  const slowGood = scoreOf({ timeSec: 240, shots: 10, hits: 8, headshots: 4, damageTaken: 0 }, 120);
  ok(slowGood < perfect, 'slow is worse');
});
const RANKP = (r: string) => ({ S: 5, A: 4, B: 3, C: 2, D: 1 } as Record<string, number>)[r];
test('computeRank points: base + first clear + rivalry; recordResult unlocks next', () => {
  const p = createProgression(undefined, new MemStore());
  const base = { chapterId: 'mirkwood', title: 'x', timeSec: 100, kills: 10, headshots: 4, shots: 10, hits: 8, damageTaken: 0 };
  let r = p.computeRank({ ...base, rivalry: { legolas: 10, gimli: 8 } }, 120);
  ok(r.rank === 'S' && r.points === 5 + 2 + 1, `S first clear + rivalry win = 8 (got ${r.points})`);
  p.recordResult({ ...base, score: r.score, rank: r.rank, pointsEarned: r.points, firstClear: true, rivalry: { legolas: 10, gimli: 8 } });
  ok(p.data.points === 8, 'points added');
  ok(p.data.unlocked.includes('barrels'), 'next unlocked');
  ok(p.data.best.mirkwood.rank === 'S', 'best stored');
  ok(p.data.rivalryTotals.legolas === 10 && p.data.rivalryTotals.gimli === 8, 'rivalry totals stored');
  r = p.computeRank({ ...base, timeSec: 300 }, 120);
  ok(r.points === RANKP(r.rank), 'second clear: no first-clear bonus, no rivalry bonus');
  p.recordResult({ ...base, score: 10, rank: 'D', pointsEarned: r.points, firstClear: false });
  ok(p.data.best.mirkwood.rank === 'S', 'best not downgraded');
  const p2 = createProgression(['a', 'b', 'c'], new MemStore());
  ok(p2.data.unlocked.join() === 'a', 'custom order first unlocked');
  p2.recordResult({ ...base, chapterId: 'a', score: 500, rank: 'C', pointsEarned: 2, firstClear: true });
  ok(p2.data.unlocked.join() === 'a,b', 'custom next unlocked');
  p2.recordResult({ ...base, chapterId: 'c', score: 500, rank: 'C', pointsEarned: 2, firstClear: true });
  ok(p2.data.unlocked.join() === 'a,b', 'last chapter unlocks nothing');
});
test('time: scale easing, hitStop, clocks', () => {
  const t = createTime();
  near(t.step(0.016), 0.016, 1e-9, 'dt at scale 1');
  t.setScale(0.2, 0.25);
  let last = 1;
  for (let i = 0; i < 100; i++) { t.step(0.01); ok(t.scale <= last + 1e-9, 'monotonic'); last = t.scale; }
  near(t.scale, 0.2, 1e-9, 'reached target');
  const gt = t.t, rt = t.real;
  near(t.step(0.1), 0.02, 1e-9, 'slow dt');
  near(t.t - gt, 0.02, 1e-9, 'game clock slow'); near(t.real - rt, 0.1, 1e-9, 'real clock full');
  t.setScale(1, 0);
  t.hitStop(0.05);
  near(t.step(0.03), 0, 1e-9, 'frozen'); ok(t.frozen, 'frozen flag');
  near(t.step(0.03), 0, 1e-9, 'still frozen (0.06 > 0.05 after this?)');
  near(t.step(0.016), 0.016, 1e-9, 'thawed');
  near(t.step(5), 0.1, 1e-9, 'frame clamp 0.1');
  t.hitStop(100); const fr = [t.step(0.1), t.step(0.1), t.step(0.1), t.step(0.1), t.step(0.1)]; ok(fr[0] === 0 && fr[1] === 0 && fr[2] === 0 && fr[3] > 0, `hitStop capped at 0.25 s ${fr}`);
  t.resetGame(); near(t.t, 0, 1e-9, 'resetGame');
});
console.log(`\n${passed} passed, ${failed} failed`);
(globalThis as unknown as { process?: { exitCode?: number } }).process!.exitCode = failed ? 1 : 0;
