/**
 * UI Lab: mounts the HUD, menus and touch controls with fake data so each screen renders standalone.
 *
 *   /lab/ui.html?screen=hud|titlecard|title|chapters|upgrades|settings|pause|complete|defeat|loading|controls|credits|touch
 *   extra params: device=kbm|gamepad|touch   bg=bright|dark   rank=S|A|B|C|D   rival=0   hp=<0..100>   live=1
 *
 * Test hooks: window.__snapReady, window.__ui = { hud, menus, input, audio, sfx }.
 */
import type {
  AudioSys, ChapterDef, ChapterResult, Progression, SaveData, Settings, UpgradeDef, UpgradeId,
} from '../src/core/types';
import { createInput } from '../src/core/input';
import { createHud } from '../src/ui/hud';
import { createMenus } from '../src/ui/menus';
import { BANNER_ENVIRONMENTS, chapterBanner } from '../src/ui/banners';
import { icon, REF_PATHS, wordmark, type IconName } from '../src/ui/icons';
import { setDevice, type Device } from '../src/ui/bus';

declare global {
  interface Window {
    __snapReady?: boolean;
    __snapError?: string;
    __ui?: unknown;
  }
}

const params = new URLSearchParams(location.search);
const screen = params.get('screen') ?? 'hud';
const bgMode = params.get('bg') ?? 'dark';

// ── fake scene backdrop ──────────────────────────────────────────────────────
const scene = document.getElementById('scene')!;
const trees = (() => {
  let d = '';
  for (let i = 0; i < 26; i++) {
    const x = (i * 97) % 1000;
    const hgt = 260 + ((i * 53) % 220);
    const w = 18 + ((i * 29) % 26);
    d += `<path d="M${x} 600 L${x + w / 2} ${600 - hgt} L${x + w} 600Z" fill="rgba(6,12,9,${0.55 + ((i * 7) % 4) / 10})"/>`;
  }
  return d;
})();
const sky =
  bgMode === 'bright'
    ? 'radial-gradient(ellipse at 72% 22%,#fffbe8 0%,rgba(255,244,200,.6) 18%,transparent 52%),linear-gradient(180deg,#9ec8e4 0%,#d9e8ee 48%,#7d9a68 49%,#556b44 100%)'
    : 'radial-gradient(ellipse at 74% 26%,rgba(255,226,160,.38) 0%,rgba(255,226,160,.08) 30%,transparent 55%),linear-gradient(180deg,#31503f 0%,#243b30 38%,#17261f 62%,#0b130f 100%)';
scene.style.background = sky;
scene.innerHTML = `<svg viewBox="0 0 1000 600" preserveAspectRatio="xMidYMax slice" style="position:absolute;inset:0;width:100%;height:100%">${trees}</svg>`;

// ── fake game data ───────────────────────────────────────────────────────────
const mk = (n: number, id: string, title: string, film: string, env: ChapterDef['environment'], cps: string[], blurb: string, rivalry = false): ChapterDef => ({
  id, number: n, title, film, blurb, environment: env, checkpoints: cps, parTime: 600, rivalry,
  create: () => ({ start() {}, update() {} }),
});
const CHAPTERS: ChapterDef[] = [
  mk(1, 'mirkwood', 'Spiders of Mirkwood', 'The Desolation of Smaug', 'mirkwood', ['Start', 'The webs', 'Brood mother'], 'Through the dark wood, giant spiders hunt the lost dwarves. Cut them down and free the captives before the brood mother descends.'),
  mk(2, 'barrels', 'The Barrel Escape', 'The Desolation of Smaug', 'forest_river', ['Start', 'The rapids'], 'Orcs line both banks of the Forest River. Leap from barrel to barrel and keep the company alive.'),
  mk(3, 'laketown', 'Lake-town by Night', 'The Desolation of Smaug', 'laketown_night', ['Start', 'The rooftops', 'Bolg'], 'Bolg raids Bard’s house across the rooftops of Lake-town. End the duel before the Master’s men scatter.'),
  mk(4, 'ravenhill', 'Ravenhill', 'The Battle of the Five Armies', 'ravenhill_winter', ['Start', 'Bat ride', 'Falling stones', 'Final duel'], 'On the frozen ruins, ride the bats to the tower, climb the crumbling stones and finish what Bolg began.'),
  mk(5, 'balins_tomb', 'Balin’s Tomb', 'The Fellowship of the Ring', 'moria', ['Start', 'The chain', 'The troll'], 'Goblins pour into the chamber of Mazarbul, and a cave troll follows them down the dark.', true),
  mk(6, 'amon_hen', 'Amon Hen', 'The Fellowship of the Ring', 'amon_hen', ['Start', 'The hill', 'Lurtz'], 'Uruk-hai pour through the woods around Amon Hen. Hold them back, and face Lurtz.', true),
  mk(7, 'helms_deep', 'Helm’s Deep', 'The Two Towers', 'helms_deep_storm', ['Start', 'The ladders', 'The stairs'], 'Storm, ladders and torchlight along the Deeping Wall. Ride a shield down the stair.', true),
  mk(8, 'pelennor', 'Pelennor Fields', 'The Return of the King', 'pelennor', ['Start', 'The mumakil'], 'Haradrim ride beneath the great mumakil. Climb one, and bring it down.', true),
  mk(9, 'black_gate', 'The Black Gate', 'The Return of the King', 'black_gate', ['Start', 'Trolls', 'The Eagles'], 'The last stand before the gates of Mordor. Hold on until the Ring is unmade.', true),
];

const UPGRADES: UpgradeDef[] = [
  { id: 'draw_speed', name: 'Swift Draw', description: 'Reach a full draw faster.', maxLevel: 4, cost: [2, 3, 4, 6] },
  { id: 'arrow_damage', name: 'Keen Arrows', description: 'Arrows strike harder.', maxLevel: 4, cost: [2, 3, 5, 7] },
  { id: 'knife_mastery', name: 'Knife Mastery', description: 'Faster combos and a harder finisher.', maxLevel: 3, cost: [2, 4, 6] },
  { id: 'agility', name: 'Elven Grace', description: 'A longer dash and a lower cooldown.', maxLevel: 3, cost: [2, 4, 6] },
  { id: 'focus', name: 'Deep Focus', description: 'More Focus, more marked targets.', maxLevel: 4, cost: [3, 4, 6, 8] },
  { id: 'vitality', name: 'Vitality', description: 'More health and faster recovery.', maxLevel: 4, cost: [2, 3, 4, 6] },
  { id: 'piercing_arrows', name: 'Galadhrim Arrows', description: 'Unlocks piercing arrows that pass through foes.', maxLevel: 1, cost: [6] },
  { id: 'triple_shot', name: 'Triple Shot', description: 'Unlocks a fan of three arrows.', maxLevel: 1, cost: [8] },
];

const settings: Settings = {
  difficulty: 'normal', quality: 'high', sensitivity: 1, invertY: false, master: 0.8, music: 0.6, sfx: 0.9,
  subtitles: true, aimAssist: true, showFps: false,
};
const save: SaveData = {
  version: 1,
  unlocked: params.get('locked') === '1' ? ['mirkwood'] : CHAPTERS.slice(0, 5).map((c) => c.id),
  best: { mirkwood: { rank: 'A', score: 8200 }, barrels: { rank: 'S', score: 12100 }, laketown: { rank: 'B', score: 6400 } },
  points: 7,
  upgrades: { draw_speed: 2, vitality: 1, focus: 3, arrow_damage: 4 },
  settings,
  rivalryTotals: { legolas: 41, gimli: 36 },
  last: { chapterId: 'laketown', checkpoint: 1 },
};
const progression: Progression = {
  data: save,
  save() {},
  reset() {},
  level: (id: UpgradeId) => save.upgrades[id] ?? 0,
  canBuy(id) {
    const u = UPGRADES.find((x) => x.id === id)!;
    const l = this.level(id);
    return l < u.maxLevel && save.points >= u.cost[l];
  },
  buy(id) {
    if (!this.canBuy(id)) return false;
    const u = UPGRADES.find((x) => x.id === id)!;
    const l = this.level(id);
    save.points -= u.cost[l];
    save.upgrades[id] = l + 1;
    return true;
  },
  upgrades: UPGRADES,
  unlockedArrows: () => ['standard', 'piercing', 'triple'],
  stats: () => ({ maxHp: 100, drawTime: 0.55, arrowDamage: 20, knifeDamage: 12, moveSpeed: 6.5, dashCooldown: 1, focusMax: 100, focusTargets: 5, damageTakenMul: 1, regen: 1 }),
  recordResult() {},
  computeRank: () => ({ score: 0, rank: 'B', points: 0 }),
};

const sfx: string[] = [];
const audio: AudioSys = {
  unlock() {}, play(name) { sfx.push(name); }, loop() {}, stopAllLoops() {}, music() {}, setListener() {}, setSlowmo() {},
  master: 1, musicVolume: 1, sfxVolume: 1, update() {},
};

// ── build ─────────────────────────────────────────────────────────────────────
const uiRoot = document.getElementById('ui')!;
const dev = (params.get('device') ?? (screen === 'touch' ? 'touch' : 'kbm')) as Device;
setDevice(dev);
const input = createInput(scene, uiRoot, { forceTouch: dev === 'touch' });
const hud = createHud(uiRoot);
const menus = createMenus(uiRoot, {
  actions: {
    startChapter: (id, cp) => console.log('startChapter', id, cp),
    resume: () => console.log('resume'),
    restartCheckpoint() {}, restartChapter() {}, quitToTitle() {},
    applySettings: (s) => Object.assign(settings, s),
    buyUpgrade: (id) => progression.buy(id),
  },
  progression,
  chapters: () => CHAPTERS,
  audio,
  input,
  inChapter: () => screen === 'pause',
});
// the real shell pauses the pointer-events of the HUD layer; menus re-enable them per screen
(window as unknown as { __ui: unknown }).__ui = { hud, menus, input, audio, sfx, settings, save, CHAPTERS };

function freezeAnimations(): void {
  for (const a of document.getAnimations()) {
    if (typeof CSSAnimation !== 'undefined' && a instanceof CSSAnimation) continue;
    const t = (a.effect as KeyframeEffect | null)?.target as HTMLElement | null;
    const timing = a.effect?.getTiming();
    if (!t || !timing || timing.iterations === Infinity) continue;
    const cls = t.closest?.('.gl-hm, .gl-dmgw, .gl-tc') ? (t.closest('.gl-hm, .gl-dmgw, .gl-tc') as HTMLElement).className : '';
    const total = Number(timing.duration) + Number(timing.delay ?? 0);
    if (cls.includes('gl-hm')) {
      a.pause();
      a.currentTime = total * 0.24;
    } else if (cls.includes('gl-dmgw')) {
      a.pause();
      a.currentTime = total * 0.3;
    } else if (cls.includes('gl-tc')) {
      a.pause();
      a.currentTime = Math.min(total, 3000);
    } else {
      a.finish();
    }
  }
}

function setupHud(): void {
  const hp = Number(params.get('hp') ?? 68);
  hud.setHealth(hp, 100);
  hud.setFocus(78, 100, params.get('focus') === '1');
  hud.setArrowType('piercing', ['standard', 'piercing', 'triple']);
  hud.setCrosshair(Number(params.get('charge') ?? 0.72), params.get('aim') !== '0', true);
  hud.setObjective('Hold the wall until the horns of Rohan sound');
  if (params.get('rival') !== '0') hud.setRivalry(14, 11);
  if (params.get('boss') !== '0') hud.setBoss('Bolg, Scourge of Gundabad', 0.62);
  hud.setProgress('Hold the wall', 0.55);
  hud.toast('Quiver restocked', 'reward');
  hud.toast('Reinforcements arrive', 'info');
  hud.toast('Checkpoint reached', 'checkpoint'); // third toast: the oldest is replaced (max 2)
  hud.subtitle('Legolas', 'They come from the north, Gimli. Count them well.', 600);
  hud.setPrompt('interact', 'Grab the shield');
  hud.setFps(60);
  const w = innerWidth;
  const hgt = innerHeight;
  hud.setFocusMarks([
    { x: w * 0.36, y: hgt * 0.4, locked: true },
    { x: w * 0.62, y: hgt * 0.46, locked: true },
    { x: w * 0.54, y: hgt * 0.3, locked: false },
  ]);
  hud.update(2.6);
  hud.hitMarker('head');
  hud.damage(Math.PI * 0.62);
  if (params.get('live') !== '1') requestAnimationFrame(() => requestAnimationFrame(freezeAnimations));
}

const RESULT: ChapterResult = {
  chapterId: 'helms_deep', title: 'Helm’s Deep', timeSec: 512, kills: 63, headshots: 21, shots: 118, hits: 84,
  damageTaken: 340, rivalry: { legolas: 43, gimli: 40 }, score: 14820, rank: (params.get('rank') ?? 'A') as ChapterResult['rank'],
  pointsEarned: 6, firstClear: true,
};

if (screen !== 'hud' && screen !== 'touch') hud.show(false);
switch (screen) {
  case 'hud':
    setupHud();
    break;
  case 'touch':
    setupHud();
    input.setInteractLabel('Shield');
    if (params.get('boss') !== '1') hud.setBoss(null);
    break;
  case 'titlecard':
    hud.titleCard('Spiders of Mirkwood', 'Chapter One', 'The Desolation of Smaug');
    requestAnimationFrame(() => requestAnimationFrame(freezeAnimations));
    break;
  case 'title': menus.showTitle(); break;
  case 'chapters': menus.showChapterSelect(); break;
  case 'upgrades': menus.showUpgrades(); break;
  case 'settings': menus.showSettings(); break;
  case 'pause': menus.showPause(); break;
  case 'controls': menus.showControls(); break;
  case 'complete':
    if (params.get('rival') === '0') delete RESULT.rivalry;
    void menus.showChapterComplete(RESULT);
    break;
  case 'defeat': void menus.showDefeat('Bolg’s blade found you on the rooftops.'); break;
  case 'loading': menus.showLoading('Spiders of Mirkwood', 0.62); break;
  case 'credits':
    void menus.showCredits();
    {
      const c = document.querySelector<HTMLElement>('.gl-cred');
      if (c) c.style.animationDelay = `-${params.get('t') ?? 14}s`;
    }
    break;
  case 'banners': {
    // contact sheet of every code-drawn chapter banner (2:1), to compare against docs/refs/ui/chapter_cards
    const sheet = document.createElement('div');
    sheet.style.cssText = 'position:fixed;inset:0;display:grid;grid-template-columns:repeat(3,1fr);gap:6px;padding:6px;background:#0b0f0d;pointer-events:none;overflow:hidden';
    for (const env of BANNER_ENVIRONMENTS) {
      const c = document.createElement('div');
      c.style.cssText = 'position:relative;aspect-ratio:2/1;overflow:hidden';
      c.innerHTML = chapterBanner(env);
      const svg = c.firstElementChild as SVGElement;
      svg.style.cssText = 'position:absolute;inset:0;width:100%;height:100%';
      sheet.append(c);
    }
    uiRoot.append(sheet);
    break;
  }
  case 'icons': {
    // every reference glyph plus the wordmark
    const sheet = document.createElement('div');
    sheet.style.cssText = 'position:fixed;inset:0;padding:24px;background:#0e1514;color:#c9b57b;overflow:auto;pointer-events:none;font:12px Georgia,serif';
    sheet.innerHTML = `<div style="width:min(720px,90vw);margin-bottom:18px">${wordmark()}</div><div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(84px,1fr));gap:12px">${(Object.keys(REF_PATHS) as IconName[])
      .map((n) => `<div style="text-align:center"><div style="font-size:34px;display:flex;justify-content:center">${icon(n)}</div><div style="margin-top:4px;color:#aab6ae">${n}</div></div>`)
      .join('')}</div>`;
    uiRoot.append(sheet);
    break;
  }
  default:
    window.__snapError = `unknown screen ${screen}`;
}

if (params.get('live') === '1') {
  let last = performance.now();
  const loop = (): void => {
    const now = performance.now();
    hud.update((now - last) / 1000);
    last = now;
    input.poll();
    requestAnimationFrame(loop);
  };
  loop();
}

requestAnimationFrame(() => requestAnimationFrame(() => { window.__snapReady = true; }));
