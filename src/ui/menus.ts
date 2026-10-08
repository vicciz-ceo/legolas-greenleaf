/**
 * Menus: title, chapter select, upgrades, settings, controls, pause, loading, chapter complete,
 * defeat and credits. Keyboard (arrows/WASD + Enter/Esc), gamepad (d-pad/stick + A/B) and
 * touch/mouse navigation. UI sounds go through deps.audio.
 */
import type {
  AudioSys, ChapterDef, ChapterResult, Difficulty, Input, MenuActions, Menus, Progression, Quality, Settings,
  SfxName, UpgradeDef, UpgradeId,
} from '../core/types';
import { BINDINGS, MENU_HINTS } from './glyphs';
import { emblem, icon, ornament, type IconName } from './icons';
import { esc, fmtTime, h } from './dom';
import { getDevice, onDevice, setDevice } from './bus';
import { NAV_SELECTOR, PadNav, spatialNext, navItems, type Dir } from './nav';
import { injectStyles } from './styles';

export interface MenuDeps {
  actions: MenuActions;
  progression: Progression;
  chapters: () => ChapterDef[];
  audio: AudioSys;
  input: Input;
  /** true when a chapter is running (pause menu shows Resume) */
  inChapter: () => boolean;
}

export const DISCLAIMER =
  'Non-commercial fan project. Not affiliated with or endorsed by the Tolkien Estate, Middle-earth Enterprises, New Line Cinema or Warner Bros.';

const BANNER: Record<string, string> = {
  mirkwood: 'linear-gradient(135deg,#0d2a1d 0%,#1d4a30 55%,#0a1a12 100%)',
  forest_river: 'linear-gradient(135deg,#17391f 0%,#2a6a52 55%,#0d2b2d 100%)',
  laketown_night: 'linear-gradient(135deg,#0b1430 0%,#233a63 55%,#5a3a1a 100%)',
  ravenhill_winter: 'linear-gradient(135deg,#27384a 0%,#6d8aa6 55%,#d7e3ee 100%)',
  moria: 'linear-gradient(135deg,#1a110b 0%,#4a2a14 55%,#a2561f 100%)',
  amon_hen: 'linear-gradient(135deg,#2a3a16 0%,#6a7a2a 55%,#b98a2c 100%)',
  helms_deep_storm: 'linear-gradient(135deg,#171c26 0%,#2f3a52 55%,#5b4a6e 100%)',
  pelennor: 'linear-gradient(135deg,#40281a 0%,#a2622b 55%,#e1b062 100%)',
  black_gate: 'linear-gradient(135deg,#150d0c 0%,#3a1a14 55%,#8c2a18 100%)',
  arena: 'linear-gradient(135deg,#1c2124 0%,#37424a 100%)',
  menu: 'linear-gradient(135deg,#1c2a20 0%,#0b100d 100%)',
};

const LORE = [
  'A bowstring sings before the arrow does.',
  'The old paths of the wood remember every footfall.',
  'Even in the deepest shadow, a single leaf still finds the light.',
  'Elves do not count the leagues. They count the friends beside them.',
  'The hour is late, but the bow is strung.',
  'Count your arrows, Master Dwarf, and I shall count mine.',
  'Where the wood grows dark, the stars still keep their watch.',
  'Swift feet, a steady hand, and a quiet heart.',
  'Some roads are walked alone, and none of them are short.',
];

const UPGRADE_ICON: Record<UpgradeId, IconName> = {
  draw_speed: 'draw',
  arrow_damage: 'arrow_standard',
  knife_mastery: 'knives',
  agility: 'dash',
  focus: 'focus',
  vitality: 'leaf',
  piercing_arrows: 'arrow_piercing',
  triple_shot: 'arrow_triple',
};

const CREDITS: [string, string[]][] = [
  ['', ['<h1>GREENLEAF</h1>', '<p class="sm">A tale of Legolas Thranduilion</p>']],
  ['A fan tribute to', ['<p>The Lord of the Rings</p><p>The Hobbit</p>', '<p class="sm">Characters and world created by J.R.R. Tolkien.<br>Films directed by Peter Jackson.</p>']],
  ['Built entirely in code', ['<p>Every mesh, texture and sound</p><p>is generated at runtime</p>', '<p class="sm">No image, model, audio or font files were harmed.</p>']],
  ['Craft', ['<p>Game design and engineering</p><p>Rendering and post-processing</p><p>Procedural creatures and worlds</p><p>Procedural audio and music</p><p>Interface and controls</p>']],
  ['Technology', ['<p>three.js</p><p>TypeScript</p><p>Vite</p><p>Web Audio</p>']],
  ['The Fellowship of the Ring', ['<p>Legolas &mdash; Gimli &mdash; Aragorn</p><p>Boromir &mdash; Gandalf &mdash; Frodo</p><p>Sam &mdash; Merry &mdash; Pippin</p>']],
  ['', ['<p>That still only counts as one.</p>']],
  ['Thank you for playing', ['<p class="sm">' + DISCLAIMER + '</p>']],
];

type ScreenName = 'title' | 'chapters' | 'upgrades' | 'settings' | 'controls' | 'pause' | 'complete' | 'defeat' | 'credits';

interface Screen {
  name: ScreenName;
  el: HTMLElement;
  back?: () => void;
  cleanup?: () => void;
  hints?: HTMLElement;
  onKey?: (e: KeyboardEvent) => boolean;
}

export function createMenus(root: HTMLElement, deps: MenuDeps): Menus {
  injectStyles();
  const host = h('div', 'gl-menus');
  root.appendChild(host);

  let cur: Screen | null = null;
  let loadingEl: HTMLElement | null = null;
  let loadingText = '';
  let completeResolve: ((v: 'next' | 'select' | 'retry') => void) | null = null;
  let defeatResolve: ((v: 'checkpoint' | 'restart' | 'select') => void) | null = null;
  let creditsResolve: (() => void) | null = null;
  let lastHoverT = 0;
  let quiet = false; // suppress hover sound for programmatic focus

  const snd = (n: SfxName): void => {
    try {
      deps.audio.play(n);
    } catch {
      /* audio is optional in the lab */
    }
  };
  const unlock = (): void => {
    try {
      deps.audio.unlock();
    } catch {
      /* ignore */
    }
  };

  // ── generic focus / nav plumbing ─────────────────────────────────────────────
  function focusEl(e: HTMLElement | null | undefined, silent = true): void {
    if (!e) return;
    quiet = silent;
    e.focus({ preventScroll: true });
    quiet = false;
    e.scrollIntoView({ block: 'nearest' });
  }

  function focusDefault(): void {
    if (!cur) return;
    const d = cur.el.querySelector<HTMLElement>('[data-default]:not([aria-disabled=true])') ?? navItems(cur.el)[0];
    focusEl(d);
  }

  function move(d: Dir): void {
    if (!cur) return;
    const active = document.activeElement as HTMLElement | null;
    const from = active && cur.el.contains(active) && active.matches(NAV_SELECTOR) ? active : null;
    // sliders and segmented controls consume left/right
    if (from && (d === 'left' || d === 'right')) {
      if (from instanceof HTMLInputElement && from.type === 'range') {
        stepRange(from, d === 'right' ? 1 : -1);
        return;
      }
      const seg = from.closest('.gl-seg');
      if (seg) {
        const btns = Array.from(seg.querySelectorAll<HTMLElement>('button'));
        const i = btns.indexOf(from);
        const n = btns[i + (d === 'right' ? 1 : -1)];
        if (n) {
          focusEl(n);
          n.click();
        }
        return;
      }
    }
    let n = spatialNext(cur.el, from, d);
    if (!n && from) {
      // nothing in that direction (e.g. Down in a row of buttons): fall back to reading order
      const items = navItems(cur.el);
      const i = items.indexOf(from);
      n = items[i + (d === 'down' || d === 'right' ? 1 : -1)] ?? null;
    }
    if (n && n !== from) focusEl(n, false);
  }

  function stepRange(input: HTMLInputElement, dir: number): void {
    const step = Number(input.step) || 0.05;
    const v = Math.max(Number(input.min), Math.min(Number(input.max), Number(input.value) + dir * step));
    input.value = String(Math.round(v / step) * step);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function goBack(): void {
    if (!cur || !cur.back) return;
    snd('ui_back');
    cur.back();
  }

  const pad = new PadNav({
    dir: (d) => move(d),
    confirm: () => {
      const a = document.activeElement as HTMLElement | null;
      if (cur?.name === 'credits') return skipCredits();
      if (a && cur?.el.contains(a)) a.click();
    },
    back: () => (cur?.name === 'credits' ? skipCredits() : goBack()),
    start: () => {
      if (cur?.name === 'pause') {
        snd('ui_back');
        hideAll();
        deps.actions.resume();
      }
    },
  });

  const onKey = (e: KeyboardEvent): void => {
    if (!cur) return;
    unlock();
    if (e.repeat && e.code === 'Escape') return;
    setDevice('kbm');
    if (cur.onKey?.(e)) return;
    const t = e.target as HTMLElement | null;
    switch (e.code) {
      case 'ArrowUp':
      case 'KeyW':
        e.preventDefault();
        move('up');
        break;
      case 'ArrowDown':
      case 'KeyS':
        e.preventDefault();
        move('down');
        break;
      case 'ArrowLeft':
      case 'KeyA':
        e.preventDefault();
        move('left');
        break;
      case 'ArrowRight':
      case 'KeyD':
        e.preventDefault();
        move('right');
        break;
      case 'Escape':
      case 'Backspace':
        if (t && t.tagName === 'INPUT' && (t as HTMLInputElement).type === 'text') return;
        e.preventDefault();
        if (cur.name === 'pause') {
          snd('ui_back');
          hideAll();
          deps.actions.resume();
        } else goBack();
        break;
      case 'KeyP':
        if (cur.name === 'pause') {
          e.preventDefault();
          snd('ui_back');
          hideAll();
          deps.actions.resume();
        }
        break;
      case 'Enter':
      case 'Space':
        if (cur.name === 'credits') {
          e.preventDefault();
          skipCredits();
          break;
        }
        // buttons click natively; make sure non-button nav items work too
        if (t && t.matches(NAV_SELECTOR) && !(t instanceof HTMLButtonElement) && !(t instanceof HTMLInputElement)) {
          e.preventDefault();
          t.click();
        } else if (!t || !cur.el.contains(t)) {
          e.preventDefault();
          focusDefault();
        }
        break;
    }
  };

  host.addEventListener('focusin', (e) => {
    const t = e.target as HTMLElement;
    if (quiet || !t.matches?.(NAV_SELECTOR)) return;
    const now = performance.now();
    if (now - lastHoverT > 60) {
      lastHoverT = now;
      snd('ui_hover');
    }
  });
  host.addEventListener('pointerover', (e) => {
    if ((e as PointerEvent).pointerType !== 'mouse') return;
    const t = (e.target as HTMLElement).closest?.(NAV_SELECTOR) as HTMLElement | null;
    if (t && t !== document.activeElement && !(t instanceof HTMLInputElement)) {
      t.focus({ preventScroll: true });
    }
  });
  host.addEventListener('pointerdown', (e) => {
    unlock();
    const pt = (e as PointerEvent).pointerType;
    setDevice(pt === 'mouse' ? 'kbm' : 'touch');
  });

  let listening = false;
  function listen(on: boolean): void {
    if (on === listening) return;
    listening = on;
    if (on) {
      window.addEventListener('keydown', onKey, true);
      pad.start();
    } else {
      window.removeEventListener('keydown', onKey, true);
      pad.stop();
    }
  }

  onDevice(() => {
    if (cur?.hints) cur.hints.innerHTML = MENU_HINTS[getDevice()];
  });

  // ── screen lifecycle ─────────────────────────────────────────────────────────
  function mount(
    name: ScreenName,
    el: HTMLElement,
    opts: { back?: () => void; hints?: boolean; cleanup?: () => void; onKey?: (e: KeyboardEvent) => boolean; noFocus?: boolean } = {},
  ): Screen {
    teardown();
    el.classList.add('gl-screen', name);
    const s: Screen = { name, el, back: opts.back, cleanup: opts.cleanup, onKey: opts.onKey };
    if (opts.hints !== false) {
      el.classList.add('has-hints');
      const hints = h('div', 'gl-hints');
      hints.innerHTML = MENU_HINTS[getDevice()];
      el.appendChild(hints);
      s.hints = hints;
    }
    host.appendChild(el);
    cur = s;
    listen(true);
    if (!opts.noFocus) focusDefault();
    return s;
  }

  function teardown(): void {
    if (!cur) return;
    cur.cleanup?.();
    cur.el.remove();
    cur = null;
  }

  function hideAll(): void {
    teardown();
    listen(false);
  }

  /** run `fn` as a pointer-safe click handler with sound */
  function onAct(e: HTMLElement, fn: () => void, sound: SfxName = 'ui_click'): void {
    e.addEventListener('click', () => {
      if (e.getAttribute('aria-disabled') === 'true') {
        snd('ui_back');
        e.classList.remove('gl-shake');
        void e.offsetWidth;
        e.classList.add('gl-shake');
        return;
      }
      unlock();
      snd(sound);
      if (sound === 'ui_confirm' && getDevice() === 'gamepad') {
        try {
          deps.input.rumble(0.22, 55);
        } catch {
          /* ignore */
        }
      }
      fn();
    });
  }

  function btn(label: string, cls: string, fn: () => void, sound: SfxName = 'ui_click', iconName?: IconName): HTMLButtonElement {
    const b = h('button', `gl-btn ${cls}`.trim(), { type: 'button', 'data-nav': '' });
    b.innerHTML = (iconName ? icon(iconName) : '') + `<span>${esc(label)}</span>`;
    onAct(b, fn, sound);
    return b;
  }

  function setBtnLabel(b: HTMLElement, label: string): void {
    const sp = b.querySelector('span');
    if (sp) sp.textContent = label;
  }

  /** two-step confirm button */
  function confirmBtn(label: string, cls: string, fn: () => void, sound: SfxName = 'ui_click'): HTMLButtonElement {
    let timer = 0;
    const b = btn(label, cls, () => {
      if (b.classList.contains('confirm')) {
        window.clearTimeout(timer);
        fn();
        return;
      }
      b.classList.add('confirm');
      setBtnLabel(b, 'Press again to confirm');
      timer = window.setTimeout(() => {
        b.classList.remove('confirm');
        setBtnLabel(b, label);
      }, 3200);
    }, sound);
    b.addEventListener('blur', () => {
      window.clearTimeout(timer);
      b.classList.remove('confirm');
      setBtnLabel(b, label);
    });
    return b;
  }

  function panel(title: string, lede?: string): { p: HTMLElement; body: HTMLElement } {
    const p = h('div', 'gl-panel');
    p.append(h('h1', 'gl-h1', null, title));
    if (lede) p.append(h('p', 'gl-lede', null, lede));
    const orn = h('div');
    orn.innerHTML = ornament();
    p.append(orn.firstElementChild!);
    const body = h('div', 'gl-scroll');
    p.append(body);
    return { p, body };
  }

  function backButton(fn: () => void): HTMLButtonElement {
    return btn('Back', 'gl-back small', fn, 'ui_back', 'back');
  }

  const homeScreen = (): void => (deps.inChapter() ? showPause() : showTitle());

  // ── TITLE ────────────────────────────────────────────────────────────────────
  function showTitle(): void {
    const data = deps.progression.data;
    const chapters = deps.chapters();
    const story = chapters.filter((c) => !c.dev && c.number > 0);
    const first = story[0] ?? chapters[0];
    const last = data.last ? chapters.find((c) => c.id === data.last!.chapterId) : undefined;

    const el = h('div');
    const wrap = h('div', 'gl-title-wrap');
    wrap.innerHTML = `${emblem()}
      <h1 class="gl-logo">Greenleaf</h1>
      <div class="gl-tag">A tale of Legolas Thranduilion</div>
      ${ornament()}`;
    const menu = h('div', 'gl-tmenu');
    const item = (label: string, fn: () => void, sound: SfxName = 'ui_click', sub?: string, dflt = false): HTMLButtonElement => {
      const b = h('button', 'gl-tm', { type: 'button', 'data-nav': '' });
      if (dflt) b.setAttribute('data-default', '');
      b.innerHTML = esc(label) + (sub ? `<small>${esc(sub)}</small>` : '');
      onAct(b, fn, sound);
      return b;
    };
    const contSub = last
      ? `${last.title} · ${last.checkpoints[data.last!.checkpoint] ?? 'Start'}`
      : first
        ? `Begin: ${first.title}`
        : undefined;
    menu.append(
      item('Continue', () => {
        const target = last ?? first;
        if (!target) return;
        hideAll();
        deps.actions.startChapter(target.id, last ? data.last!.checkpoint : 0);
      }, 'ui_confirm', contSub, true),
      item('Chapters', () => showChapterSelect(showTitle)),
      item('Upgrades', () => showUpgrades(showTitle)),
      item('Settings', () => showSettings(showTitle)),
      item('Controls', () => showControls(showTitle)),
      item('Credits', () => {
        runCredits().then(() => {
          if (!cur || cur.name === 'credits') showTitle();
        });
      }),
    );
    wrap.append(menu);
    el.append(wrap, h('div', 'gl-foot', null, 'Non-commercial fan project'));
    mount('title', el);
  }

  // ── CHAPTER SELECT ───────────────────────────────────────────────────────────
  function isUnlocked(c: ChapterDef): boolean {
    return !!c.dev || deps.progression.data.unlocked.includes(c.id);
  }

  function showChapterSelect(back: () => void = showTitle): void {
    const chapters = deps.chapters().slice().sort((a, b) => a.number - b.number);
    const el = h('div');
    const { p, body } = panel('Chapters', 'Choose where the tale resumes');
    p.classList.add('gl-chapters');
    const grid = h('div', 'gl-chgrid');
    if (!chapters.length) body.append(h('p', 'gl-lede', null, 'No chapters are available yet.'));
    chapters.forEach((c, idx) => {
      const unlocked = isUnlocked(c);
      const best = deps.progression.data.best[c.id];
      const card = h('div', `gl-ch${unlocked ? '' : ' locked'}`);
      const roman = c.number > 0 ? String(c.number) : '0';
      const ban = h('div', 'ban');
      ban.style.setProperty('--ban', BANNER[c.environment] ?? BANNER.menu);
      ban.innerHTML = `<span class="num">${roman}</span>${c.dev ? '<span class="dev">DEV</span>' : ''}<div class="rank ${best ? best.rank : 'none'}">${best ? best.rank : '&ndash;'}</div>`;
      const bd = h('div', 'bd');
      bd.innerHTML = `<div class="ti">${esc(c.title)}</div><div class="fm">${esc(c.film)}</div><div class="bl">${esc(c.blurb)}</div>`;
      card.append(ban, bd);
      if (unlocked) {
        const ft = h('div', 'ft');
        const play = btn(best ? 'Replay' : 'Play', 'primary small', () => {
          hideAll();
          deps.actions.startChapter(c.id, 0);
        }, 'ui_confirm');
        if (idx === 0 || (!chapters.slice(0, idx).some(isUnlocked) && isUnlocked(c))) play.setAttribute('data-default', '');
        ft.append(play);
        c.checkpoints.forEach((label, i) => {
          if (i === 0) return;
          const chip = h('button', 'gl-chip', { type: 'button', 'data-nav': '', title: label });
          chip.textContent = `◆ ${label}`;
          onAct(chip, () => {
            hideAll();
            deps.actions.startChapter(c.id, i);
          }, 'ui_confirm');
          ft.append(chip);
        });
        card.append(ft);
      } else {
        const prev = chapters[idx - 1];
        const lk = h('button', 'gl-btn small locked wide', { type: 'button', 'data-nav': '', 'aria-disabled': 'true' });
        lk.innerHTML = `${icon('lock')}<span>${prev ? 'Complete ' + esc(prev.title) : 'Locked'}</span>`;
        onAct(lk, () => undefined);
        const w = h('div', 'ft');
        w.append(lk);
        card.append(w);
      }
      grid.append(card);
    });
    body.append(grid);
    p.append(backButton(back));
    el.append(p);
    mount('chapters', el, { back });
    // prefer the first playable card
    const dflt = el.querySelector<HTMLElement>('[data-default]');
    if (dflt) focusEl(dflt);
  }

  // ── UPGRADES ─────────────────────────────────────────────────────────────────
  function showUpgrades(back: () => void = showTitle): void {
    const el = h('div');
    const { p, body } = panel('Upgrades', 'Spend your points between chapters');
    p.classList.add('gl-upwrap');
    const pts = h('div', 'gl-points');
    const grid = h('div', 'gl-upgrid');
    body.append(pts, grid);

    const render = (focusKey?: string): void => {
      const data = deps.progression.data;
      pts.innerHTML = `${icon('gem')}<span>Points</span><b>${data.points}</b>`;
      grid.textContent = '';
      deps.progression.upgrades.forEach((u: UpgradeDef) => {
        const lvl = deps.progression.level(u.id);
        const maxed = lvl >= u.maxLevel;
        const cost = maxed ? 0 : u.cost[lvl];
        const can = !maxed && deps.progression.canBuy(u.id);
        const row = h('div', 'gl-up');
        const pips = Array.from({ length: u.maxLevel }, (_, i) => `<i class="gl-pip${i < lvl ? ' on' : ''}"></i>`).join('');
        row.innerHTML = `<div class="ic">${icon(UPGRADE_ICON[u.id] ?? 'diamond')}</div>
          <div class="nmrow"><div class="nm">${esc(u.name)}</div><div class="gl-pips">${pips}</div></div>
          <div class="ds">${esc(u.description)}</div>`;
        const buy = h('div', 'buy');
        const costEl = h('div', `cost${maxed ? ' max' : ''}`);
        costEl.innerHTML = maxed ? 'Mastered' : `${icon('gem')}${cost}`;
        const b = btn(maxed ? 'Max' : 'Learn', `small ${can ? 'primary' : ''}`, () => {
          if (!maxed && !can) return;
          const ok = deps.actions.buyUpgrade(u.id);
          if (ok) render(u.id);
          else snd('ui_back');
        }, 'ui_confirm');
        b.dataset.key = u.id;
        if (maxed || !can) b.setAttribute('aria-disabled', 'true');
        buy.append(costEl, b);
        row.append(buy);
        grid.append(row);
      });
      if (focusKey) {
        const t = grid.querySelector<HTMLElement>(`[data-key="${focusKey}"]`);
        focusEl(t);
      }
    };
    render();
    p.append(backButton(back));
    el.append(p);
    mount('upgrades', el, { back });
    const firstBuyable = grid.querySelector<HTMLElement>('.gl-btn.primary');
    focusEl(firstBuyable ?? navItems(el)[0]);
  }

  // ── SETTINGS ─────────────────────────────────────────────────────────────────
  function showSettings(back: () => void = homeScreen): void {
    const s: Settings = { ...deps.progression.data.settings };
    let raf = 0;
    const apply = (): void => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        deps.actions.applySettings({ ...s });
      });
    };
    const el = h('div');
    const { p, body } = panel('Settings');
    p.classList.add('gl-setwrap');

    const row = (label: string, control: HTMLElement): HTMLElement => {
      const r = h('div', 'gl-set');
      r.append(h('label', '', null, label), control);
      return r;
    };
    const seg = <K extends 'difficulty' | 'quality'>(key: K, opts: [Settings[K], string][]): HTMLElement => {
      const g = h('div', 'gl-seg', { role: 'radiogroup' });
      opts.forEach(([v, l]) => {
        const b = h('button', s[key] === v ? 'on' : '', { type: 'button', role: 'radio', 'aria-checked': String(s[key] === v), 'data-nav': '' });
        b.textContent = l;
        b.addEventListener('click', () => {
          unlock();
          if (s[key] !== v) snd('ui_click');
          s[key] = v;
          g.querySelectorAll('button').forEach((x) => {
            const on = x === b;
            x.classList.toggle('on', on);
            x.setAttribute('aria-checked', String(on));
          });
          apply();
        });
        g.append(b);
      });
      return g;
    };
    const toggle = (key: 'invertY' | 'subtitles' | 'aimAssist' | 'showFps'): HTMLElement => {
      const t = h('button', 'gl-toggle', { type: 'button', role: 'switch', 'aria-checked': String(s[key]), 'data-nav': '' });
      t.addEventListener('click', () => {
        unlock();
        s[key] = !s[key];
        t.setAttribute('aria-checked', String(s[key]));
        snd('ui_click');
        apply();
      });
      return t;
    };
    const range = (key: 'sensitivity' | 'master' | 'music' | 'sfx', min: number, max: number, step: number, fmt: (v: number) => string): HTMLElement => {
      const w = h('div', 'gl-slide');
      const inp = h('input', '', { type: 'range', min: String(min), max: String(max), step: String(step), 'data-nav': '', 'aria-label': key });
      inp.value = String(s[key]);
      const out = h('output');
      const sync = (): void => {
        const v = Number(inp.value);
        out.textContent = fmt(v);
        inp.style.setProperty('--v', `${((v - min) / (max - min)) * 100}%`);
      };
      sync();
      let lastTick = 0;
      inp.addEventListener('input', () => {
        s[key] = Number(inp.value);
        sync();
        apply();
        const now = performance.now();
        if (now - lastTick > 90) {
          lastTick = now;
          snd('ui_hover');
        }
      });
      w.append(inp, out);
      return w;
    };
    const pct = (v: number): string => `${Math.round(v * 100)}%`;
    const section = (title: string, rows: HTMLElement[]): HTMLElement => {
      const w = h('div');
      w.append(h('h2', 'gl-h2', null, title));
      w.firstElementChild!.setAttribute('style', 'margin:14px 0 4px');
      rows.forEach((r) => w.append(r));
      return w;
    };
    const grid = h('div', 'gl-setgrid');
    const c1 = h('div');
    const c2 = h('div');
    c1.append(
      section('Gameplay', [
        row('Difficulty', seg<'difficulty'>('difficulty', [['easy', 'Easy'], ['normal', 'Normal'], ['hard', 'Hard']] as [Difficulty, string][])),
        row('Aim assist', toggle('aimAssist')),
        row('Subtitles', toggle('subtitles')),
      ]),
      section('Display', [
        row('Quality', seg<'quality'>('quality', [['low', 'Low'], ['medium', 'Medium'], ['high', 'High'], ['ultra', 'Ultra']] as [Quality, string][])),
        row('Show FPS', toggle('showFps')),
      ]),
    );
    c2.append(
      section('Controls', [
        row('Look sensitivity', range('sensitivity', 0.2, 3, 0.05, (v) => `${v.toFixed(2)}×`)),
        row('Invert Y axis', toggle('invertY')),
      ]),
      section('Audio', [
        row('Master', range('master', 0, 1, 0.05, pct)),
        row('Music', range('music', 0, 1, 0.05, pct)),
        row('Effects', range('sfx', 0, 1, 0.05, pct)),
      ]),
    );
    grid.append(c1, c2);
    body.append(grid);
    p.append(backButton(back));
    el.append(p);
    mount('settings', el, { back, cleanup: () => cancelAnimationFrame(raf) });
  }

  // ── CONTROLS ─────────────────────────────────────────────────────────────────
  function showControls(back: () => void = homeScreen): void {
    const el = h('div');
    const { p, body } = panel('Controls', 'Three ways to take up the bow');
    p.classList.add('gl-ctlwrap');
    const dev0 = getDevice();
    const cols: { id: 'kbm' | 'gamepad' | 'touch'; title: string; ic: IconName; key: 'kbm' | 'pad' | 'touch' }[] = [
      { id: 'kbm', title: 'Keyboard & Mouse', ic: 'mouse', key: 'kbm' },
      { id: 'gamepad', title: 'Gamepad', ic: 'dpad', key: 'pad' },
      { id: 'touch', title: 'Touch', ic: 'touch', key: 'touch' },
    ];
    const tabs = h('div', 'gl-tabs gl-seg');
    const grid = h('div', 'gl-ctlgrid');
    const colEls: HTMLElement[] = [];
    const tabEls: HTMLElement[] = [];
    const select = (i: number): void => {
      colEls.forEach((c, k) => c.classList.toggle('active', k === i));
      tabEls.forEach((t, k) => t.classList.toggle('on', k === i));
    };
    cols.forEach((c, i) => {
      const col = h('div', 'gl-ctlcol');
      col.innerHTML = `<h3>${icon(c.ic)}${c.title}</h3>`;
      for (const b of BINDINGS) {
        const r = h('div', 'gl-bind');
        const val = b[c.key];
        r.innerHTML = `<span class="ac">${esc(b.action)}</span><span class="bd">${val}</span>`;
        col.append(r);
      }
      colEls.push(col);
      grid.append(col);
      const t = h('button', '', { type: 'button', 'data-nav': '' });
      t.textContent = c.id === 'kbm' ? 'Keys' : c.id === 'gamepad' ? 'Pad' : 'Touch';
      t.addEventListener('click', () => {
        snd('ui_click');
        select(i);
      });
      tabEls.push(t);
      tabs.append(t);
    });
    select(Math.max(0, cols.findIndex((c) => c.id === dev0)));
    body.append(tabs, grid);
    p.append(backButton(back));
    el.append(p);
    mount('controls', el, { back });
  }

  // ── PAUSE ────────────────────────────────────────────────────────────────────
  function showPause(): void {
    const el = h('div');
    const p = h('div', 'gl-panel gl-pausewrap');
    p.append(h('h1', 'gl-h1', null, 'Paused'), h('p', 'gl-sub-ch', null, 'The tale waits for you'));
    const orn = h('div');
    orn.innerHTML = ornament();
    p.append(orn.firstElementChild!);
    const pscroll = h('div', 'gl-scroll');
    const actions = h('div', 'gl-actions col');
    const resume = btn('Resume', 'primary', () => {
      hideAll();
      deps.actions.resume();
    }, 'ui_confirm');
    resume.setAttribute('data-default', '');
    actions.append(
      resume,
      btn('Restart Checkpoint', '', () => {
        hideAll();
        deps.actions.restartCheckpoint();
      }, 'ui_confirm'),
      confirmBtn('Restart Chapter', 'danger', () => {
        hideAll();
        deps.actions.restartChapter();
      }, 'ui_confirm'),
      btn('Settings', '', () => showSettings(showPause)),
      btn('Controls', '', () => showControls(showPause)),
      confirmBtn('Quit to Title', 'danger', () => {
        hideAll();
        deps.actions.quitToTitle();
      }, 'ui_back'),
    );
    pscroll.append(actions);
    p.append(pscroll);
    el.append(p);
    mount('pause', el, {
      back: () => {
        hideAll();
        deps.actions.resume();
      },
    });
  }

  // ── LOADING ──────────────────────────────────────────────────────────────────
  let loadFill: HTMLElement | null = null;
  let loadPct: HTMLElement | null = null;
  function showLoading(text: string, frac: number): void {
    if (!loadingEl) {
      loadingEl = h('div', 'gl-loading');
      loadingEl.innerHTML = `${emblem()}<div class="kk">Journeying to</div><div class="nm"></div>${ornament()}<div class="bar"><i></i></div><div class="pc"></div><div class="lore"></div>`;
      loadFill = loadingEl.querySelector('.bar i');
      loadPct = loadingEl.querySelector('.pc');
      host.appendChild(loadingEl);
      loadingText = '';
    }
    loadingEl.classList.remove('out');
    if (text !== loadingText) {
      loadingText = text;
      loadingEl.querySelector('.nm')!.textContent = text;
      let hash = 0;
      for (let i = 0; i < text.length; i++) hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
      loadingEl.querySelector('.lore')!.textContent = `“${LORE[hash % LORE.length]}”`;
    }
    const f = Math.max(0, Math.min(1, frac));
    loadFill!.style.transform = `scaleX(${f})`;
    loadPct!.textContent = `${Math.round(f * 100)}%`;
  }
  function hideLoading(): void {
    const e = loadingEl;
    if (!e) return;
    loadingEl = null;
    e.classList.add('out');
    window.setTimeout(() => e.remove(), 500);
  }

  // ── CHAPTER COMPLETE ─────────────────────────────────────────────────────────
  function countUp(e: HTMLElement, to: number, delay: number, fmt: (v: number) => string = (v) => String(Math.round(v))): void {
    e.textContent = fmt(0);
    const t0 = performance.now() + delay;
    const dur = 900;
    const tick = (): void => {
      if (!e.isConnected) return;
      const t = (performance.now() - t0) / dur;
      if (t < 0) return void requestAnimationFrame(tick);
      const k = Math.min(1, t);
      e.textContent = fmt(to * (1 - Math.pow(1 - k, 3)));
      if (k < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  function showChapterComplete(r: ChapterResult): Promise<'next' | 'select' | 'retry'> {
    return new Promise((resolve) => {
      completeResolve?.('select');
      completeResolve = resolve;
      const chapters = deps.chapters();
      const idx = chapters.findIndex((c) => c.id === r.chapterId);
      const next = idx >= 0 ? chapters[idx + 1] : undefined;
      const finish = (v: 'next' | 'select' | 'retry'): void => {
        completeResolve = null;
        hideAll();
        resolve(v);
      };
      const el = h('div');
      const p = h('div', 'gl-panel gl-donewrap');
      p.append(h('h1', 'gl-h1', null, 'Chapter Complete'), h('p', 'gl-lede', null, r.title));
      const orn = h('div');
      orn.innerHTML = ornament();
      p.append(orn.firstElementChild!);
      const acc = r.shots > 0 ? Math.round((r.hits / r.shots) * 100) : 0;
      const cscroll = h('div', 'gl-scroll');
      const top = h('div', 'gl-done-top');
      const stats = h('div', 'gl-stats');
      const stat = (label: string): HTMLElement => {
        const d = h('div', 'gl-stat');
        const b = h('b');
        d.append(h('span', '', null, label), b);
        stats.append(d);
        return b;
      };
      const tEl = stat('Time');
      tEl.textContent = fmtTime(r.timeSec);
      countUp(stat('Kills'), r.kills, 150);
      countUp(stat('Headshots'), r.headshots, 300);
      countUp(stat('Accuracy'), acc, 450, (v) => `${Math.round(v)}%`);
      countUp(stat('Damage taken'), r.damageTaken, 600);
      countUp(stat('Score'), r.score, 750);
      const rb = h('div', 'gl-rankbox');
      const rank = h('div', `gl-rank ${r.rank}`, null, r.rank);
      rb.append(rank, h('small', '', null, 'Rank'));
      window.setTimeout(() => {
        rank.classList.add('show');
        snd(r.rank === 'S' || r.rank === 'A' ? 'reward' : 'level_complete');
      }, 950);
      top.append(stats, rb);
      cscroll.append(top);

      const reward = h('div', 'gl-reward');
      reward.innerHTML = `${icon('gem')}<span>Points earned</span><b>+${r.pointsEarned}</b>${r.firstClear ? '<span class="tag">First clear</span>' : ''}`;
      cscroll.append(reward);

      if (r.rivalry) {
        const { legolas: l, gimli: g } = r.rivalry;
        const verdict = l > g ? `Legolas wins by ${l - g}` : g > l ? `Gimli wins by ${g - l}` : 'A tie, and neither will admit it';
        const rv = h('div', 'gl-rivres');
        rv.innerHTML = `<div class="s l${l > g ? ' win' : ''}">${icon('arrow_standard')}<span>${l}</span></div><div class="vd">${verdict}</div><div class="s g${g > l ? ' win' : ''}"><span>${g}</span>${icon('axe')}</div>`;
        cscroll.append(rv);
      }
      p.append(cscroll);

      const actions = h('div', 'gl-actions');
      const nextBtn = btn(next ? 'Next Chapter' : 'Continue', 'primary', () => finish('next'), 'ui_confirm');
      nextBtn.setAttribute('data-default', '');
      actions.append(nextBtn, btn('Chapter Select', '', () => finish('select')), btn('Retry', '', () => finish('retry')));
      p.append(actions);
      el.append(p);
      mount('complete', el);
    });
  }

  // ── DEFEAT ───────────────────────────────────────────────────────────────────
  function showDefeat(reason: string): Promise<'checkpoint' | 'restart' | 'select'> {
    return new Promise((resolve) => {
      defeatResolve?.('select');
      defeatResolve = resolve;
      const finish = (v: 'checkpoint' | 'restart' | 'select'): void => {
        defeatResolve = null;
        hideAll();
        resolve(v);
      };
      const el = h('div');
      const w = h('div', 'gl-defwrap');
      w.innerHTML = `<h1 class="gl-defeat-t">You have fallen…</h1><div class="why">${esc(reason)}</div>${ornament()}`;
      const actions = h('div', 'gl-actions');
      const cp = btn('Return to Checkpoint', 'primary', () => finish('checkpoint'), 'ui_confirm');
      cp.setAttribute('data-default', '');
      actions.append(cp, btn('Restart Chapter', '', () => finish('restart')), btn('Chapter Select', '', () => finish('select')));
      w.append(actions);
      el.append(w);
      mount('defeat', el);
    });
  }

  // ── CREDITS ──────────────────────────────────────────────────────────────────
  let creditsDone: (() => void) | null = null;
  function skipCredits(): void {
    creditsDone?.();
  }
  function runCredits(): Promise<void> {
    return new Promise((resolve) => {
      creditsResolve?.();
      creditsResolve = resolve;
      const el = h('div');
      const win = h('div', 'gl-creditswin');
      const c = h('div', 'gl-cred');
      c.innerHTML =
        emblem() +
        CREDITS.map(([head, lines]) => (head ? `<h2>${esc(head)}</h2>` : '<div style="height:24px"></div>') + lines.join('')).join('') +
        ornament();
      win.append(c);
      el.append(win, h('div', 'gl-skip', null, 'Esc · Skip'));
      let finished = false;
      const done = (): void => {
        if (finished) return;
        finished = true;
        creditsDone = null;
        creditsResolve = null;
        window.clearTimeout(endTimer);
        hideAll();
        resolve();
      };
      let endTimer = 0;
      creditsDone = done;
      el.addEventListener('pointerdown', done);
      mount('credits', el, { hints: false, back: done, noFocus: true, cleanup: () => { creditsDone = null; } });
      // scroll duration from the real content height
      const travel = c.scrollHeight + window.innerHeight;
      const dur = Math.max(20, travel / 52);
      c.style.setProperty('--dur', `${dur}s`);
      c.addEventListener('animationend', () => {
        endTimer = window.setTimeout(done, 1200);
      });
    });
  }

  function showCredits(): Promise<void> {
    return runCredits();
  }

  return {
    showTitle,
    showChapterSelect: () => showChapterSelect(showTitle),
    showUpgrades: () => showUpgrades(showTitle),
    showSettings: () => showSettings(homeScreen),
    showPause,
    showControls: () => showControls(homeScreen),
    hideAll,
    showLoading,
    hideLoading,
    showChapterComplete,
    showDefeat,
    showCredits,
    get open() {
      return cur !== null || loadingEl !== null;
    },
  };
}
