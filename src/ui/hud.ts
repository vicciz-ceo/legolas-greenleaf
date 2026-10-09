/**
 * Cinematic HUD. All DOM/CSS/SVG is generated here; the DOM is only touched when a value changes.
 */
import type { ArrowType, Hud, Speaker } from '../core/types';
import { esc, h, setText, toggleClass } from './dom';
import { padWide, promptGlyph, type PromptAction } from './glyphs';
import { ARROW_ICON, icon, ornament, type IconName } from './icons';
import { getDevice, onDevice, setArrow, type Device } from './bus';
import { injectStyles } from './styles';

/** Hud plus the small optional extras the shell may call. */
export interface HudImpl extends Hud {
  /** hide/show subtitles (Settings.subtitles). Default true. */
  setSubtitlesEnabled(v: boolean): void;
  clearSubtitles(): void;
  clearToasts(): void;
  subtitleBacklog(): number;
  /** subtle "Click to focus" hint while keyboard/mouse play runs without pointer lock */
  setPointerHint(v: boolean): void;
  /** show/hide only the gameplay widgets while keeping toasts, subtitles and title cards */
  readonly root: HTMLElement;
}

const SPEAKER_COLOR: Record<string, string> = {
  Legolas: '#c9b57b',
  Gimli: '#d8a775',
  Aragorn: '#9fc0e6',
  Tauriel: '#9fb88b',
  Thranduil: '#d6ddff',
  Gandalf: '#cfcfdc',
  Bard: '#a7cc9a',
  Thorin: '#e0bd72',
  Kili: '#d8b080',
  Bolg: '#d4604d',
  Lurtz: '#d4604d',
  Orc: '#c9694f',
  Uruk: '#c9694f',
  'Théoden': '#e8d69a',
  'Éomer': '#d9c28a',
  Haldir: '#c9e6ff',
  Boromir: '#c7b08a',
  Narrator: '#c9b57b',
};
const DEFAULT_SPEAKER_COLOR = '#e8d9a8';

const ARROW_ORDER: ArrowType[] = ['standard', 'piercing', 'triple'];
const ARROW_NAME: Record<ArrowType, string> = { standard: 'Standard', piercing: 'Piercing', triple: 'Triple shot' };
const DEFAULT_PROMPT: Record<PromptAction, string> = {
  interact: 'Interact',
  jump: 'Jump',
  melee: 'Strike',
  focus: 'Focus',
  draw: 'Draw',
};

const TOAST_ICON: Record<string, IconName> = { checkpoint: 'checkpoint', info: 'info', reward: 'star', warning: 'warn' };
const RING_C = 2 * Math.PI * 30;
const TITLE_CARD_SEC = 5.4;

let uidCounter = 0;

function veinPath(from: number, to: number, step: number, mid: number, amp: number): string {
  let d = `M${from} ${mid}H${to}`;
  for (let x = from + 14; x < to - 10; x += step) d += `M${x} ${mid}l8 -${amp}M${x} ${mid}l8 ${amp}`;
  return d;
}

interface ToastItem {
  el: HTMLElement;
  ttl: number;
  text: string;
  kind: string;
}

export function createHud(root: HTMLElement): HudImpl {
  injectStyles();
  const uid = ++uidCounter;
  const dev0 = getDevice();

  const el = h('div', `gl-hud gl-dev-${dev0}`);
  el.innerHTML = `
  <svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>
    <linearGradient id="gl-hp-${uid}" gradientUnits="userSpaceOnUse" x1="0" x2="320" y1="0" y2="0"><stop offset="0" stop-color="#44663d"/><stop offset=".55" stop-color="#739064"/><stop offset="1" stop-color="#b9d6a4"/></linearGradient>
    <linearGradient id="gl-hp-low-${uid}" gradientUnits="userSpaceOnUse" x1="0" x2="320" y1="0" y2="0"><stop offset="0" stop-color="#6e1812"/><stop offset=".6" stop-color="#b8402f"/><stop offset="1" stop-color="#e8785a"/></linearGradient>
    <linearGradient id="gl-fc-${uid}" gradientUnits="userSpaceOnUse" x1="0" x2="240" y1="0" y2="0"><stop offset="0" stop-color="#3a746f"/><stop offset=".6" stop-color="#85bcb7"/><stop offset="1" stop-color="#d9f1ee"/></linearGradient>
    <linearGradient id="gl-boss-${uid}" gradientUnits="userSpaceOnUse" x1="0" x2="600" y1="0" y2="0"><stop offset="0" stop-color="#5d140f"/><stop offset=".6" stop-color="#b0362a"/><stop offset="1" stop-color="#ee8a5c"/></linearGradient>
    <clipPath id="gl-hpc-${uid}"><path d="M4 11C4 6 12 3 24 3H270C296 3 312 8 318 11C312 14 296 19 270 19H24C12 19 4 16 4 11Z"/></clipPath>
    <clipPath id="gl-fcc-${uid}"><path d="M3 6C3 3.4 8 2 14 2H200C222 2 234 4.4 238 6C234 7.6 222 10 200 10H14C8 10 3 8.6 3 6Z"/></clipPath>
    <clipPath id="gl-bsc-${uid}"><path d="M18 9L28 2H572L582 9L572 16H28Z"/></clipPath>
  </defs></svg>

  <div class="gl-vitals gl-g">
    <div class="gl-bar-row hp">
      ${icon('leaf', 'gl-bar-ic')}
      <svg class="gl-bar hp" viewBox="0 0 320 22" aria-hidden="true">
        <path class="track" d="M4 11C4 6 12 3 24 3H270C296 3 312 8 318 11C312 14 296 19 270 19H24C12 19 4 16 4 11Z"/>
        <g clip-path="url(#gl-hpc-${uid})">
          <rect class="lag" x="0" y="0" width="320" height="22"/>
          <rect class="hp-fill" x="0" y="0" width="320" height="22" fill="url(#gl-hp-${uid})"/>
          <path class="veins" d="${veinPath(26, 300, 24, 11, 5)}"/>
        </g>
        <path class="frame" d="M4 11C4 6 12 3 24 3H270C296 3 312 8 318 11C312 14 296 19 270 19H24C12 19 4 16 4 11Z"/>
      </svg>
    </div>
    <div class="gl-bar-row focus">
      ${icon('focus', 'gl-bar-ic')}
      <svg class="gl-bar small fc" viewBox="0 0 240 12" aria-hidden="true">
        <path class="track" d="M3 6C3 3.4 8 2 14 2H200C222 2 234 4.4 238 6C234 7.6 222 10 200 10H14C8 10 3 8.6 3 6Z"/>
        <g clip-path="url(#gl-fcc-${uid})"><rect class="fc-fill" x="0" y="0" width="240" height="12" fill="url(#gl-fc-${uid})"/></g>
        <path class="frame" d="M3 6C3 3.4 8 2 14 2H200C222 2 234 4.4 238 6C234 7.6 222 10 200 10H14C8 10 3 8.6 3 6Z"/>
      </svg>
    </div>
    <div class="gl-readout"><span class="hpv"></span><i></i><span class="fcv"></span></div>
  </div>

  <div class="gl-arrows gl-g"></div>

  <div class="gl-cross gl-g off">
    <svg viewBox="-60 -60 120 120" aria-hidden="true">
      <g class="ring-w"><circle class="ring-track" r="30"/><circle class="ring" r="30" transform="rotate(-90)" stroke-dasharray="${RING_C.toFixed(2)}" stroke-dashoffset="${RING_C.toFixed(2)}"/></g>
      <g class="ticks"><path class="tk-sh" d="M0 -20V-10M0 10V20M-20 0H-10M10 0H20"/><path class="tk" d="M0 -20V-10M0 10V20M-20 0H-10M10 0H20"/></g>
      <circle class="dot" r="1.7"/>
    </svg>
  </div>
  <div class="gl-hm gl-g"><svg viewBox="-30 -30 60 60" aria-hidden="true"><path d="M-6 -6L-15 -15M6 -6L15 -15M-6 6L-15 15M6 6L15 15"/></svg></div>

  <div class="gl-dmg"></div>

  <div class="gl-top">
    <div class="gl-boss gl-g none">
      <div class="nm"></div>
      <svg viewBox="0 0 600 18" aria-hidden="true">
        <path class="track" d="M18 9L28 2H572L582 9L572 16H28Z"/>
        <g clip-path="url(#gl-bsc-${uid})"><rect class="lag" x="0" y="0" width="600" height="18"/><rect class="b-fill" x="0" y="0" width="600" height="18" fill="url(#gl-boss-${uid})"/></g>
        <path class="frame" d="M18 9L28 2H572L582 9L572 16H28Z"/>
        <path class="frame" d="M8 9l6 -6 6 6 -6 6z M592 9l-6 -6 -6 6 6 6z" fill="#d8b66a" fill-opacity=".6"/>
      </svg>
    </div>

  <div class="gl-obj gl-g none"><div class="hd">${icon('diamond')}<span>Objective</span></div><div class="tx"></div></div>

  <div class="gl-riv gl-g none">
    <div class="side you lead"><div class="row">${icon('arrow_standard')}<span class="num">0</span></div><div class="who">Legolas</div></div>
    <div class="vs"></div>
    <div class="side him"><div class="row"><span class="num">0</span>${icon('axe')}</div><div class="who">Gimli</div></div>
  </div>

  <div class="gl-topc">
    <div class="gl-prog gl-g none"><div class="lb"></div><div class="tr"><div class="fl"></div></div></div>
    <div class="gl-toasts" style="display:flex;flex-direction:column;align-items:center;gap:8px"></div>
  </div>
  </div>

  <div class="gl-marks gl-g"></div>
  <div class="gl-prompt gl-g"></div>
  <div class="gl-lock gl-g">${icon('mouse_l')}<span>Click to focus</span></div>
  <div class="gl-sub"><div class="sp"></div><div class="tx"></div></div>
  <div class="gl-fps"></div>
  <div class="gl-tc"><div class="film"></div><div class="ttl"></div>${ornament()}<div class="sub"></div></div>
  `;
  root.appendChild(el);

  const q = <T extends Element>(sel: string): T => el.querySelector(sel) as T;

  // ── health / focus ──────────────────────────────────────────────────────────
  const vitals = q<HTMLElement>('.gl-vitals');
  const hpFill = q<SVGRectElement>('.hp-fill');
  const hpLag = q<SVGRectElement>('.gl-bar.hp .lag');
  const fcFill = q<SVGRectElement>('.fc-fill');
  const focusRow = q<HTMLElement>('.gl-bar-row.focus');
  const hpVal = q<HTMLElement>('.gl-readout .hpv');
  const fcVal = q<HTMLElement>('.gl-readout .fcv');
  let hpFrac = 1;
  let hpLagFrac = 1;
  let hpLagDelay = 0;
  let hpW = -1;
  let hpLagW = -1;
  let fcW = -1;
  // low-health gradient swap through a class (the gradient id is per instance, so patch the rule per instance)
  const lowStyle = document.createElement('style');
  lowStyle.textContent = `.gl-hud[data-uid="${uid}"] .gl-vitals.low .hp-fill{fill:url(#gl-hp-low-${uid})}`;
  el.dataset.uid = String(uid);
  el.appendChild(lowStyle);

  function setHealth(cur: number, max: number): void {
    const f = max > 0 ? Math.max(0, Math.min(1, cur / max)) : 0;
    setText(hpVal, `${Math.max(0, Math.ceil(cur))} / ${Math.round(max)}`);
    const w = Math.round(f * 320 * 4) / 4;
    if (w !== hpW) {
      hpW = w;
      hpFill.setAttribute('width', String(w));
      if (f > hpFrac) {
        hpLagFrac = f;
        hpLagW = w;
        hpLag.setAttribute('width', String(w));
      } else if (f < hpFrac) hpLagDelay = 0.5;
      hpFrac = f;
      toggleClass(vitals, 'low', f <= 0.25 && f > 0);
    }
  }

  function setFocus(cur: number, max: number, active: boolean): void {
    const f = max > 0 ? Math.max(0, Math.min(1, cur / max)) : 0;
    setText(fcVal, `Focus ${Math.round(f * 100)}%`);
    const w = Math.round(f * 240 * 4) / 4;
    if (w !== fcW) {
      fcW = w;
      fcFill.setAttribute('width', String(w));
    }
    toggleClass(focusRow, 'active', active);
    toggleClass(focusRow, 'ready', f >= 0.999);
  }

  // ── arrow types ─────────────────────────────────────────────────────────────
  const arrowsEl = q<HTMLElement>('.gl-arrows');
  const slots: HTMLElement[] = ARROW_ORDER.map((t, i) => {
    const s = h('div', 'gl-aslot locked');
    s.innerHTML = `${icon(ARROW_ICON[t] as IconName)}<span class="k">${i + 1}</span>`;
    arrowsEl.appendChild(s);
    return s;
  });
  const arrowName = h('div', 'gl-aname');
  arrowsEl.appendChild(arrowName);
  const padHint = h('div', 'gl-padhint');
  padHint.innerHTML = padWide('RB');
  arrowsEl.appendChild(padHint);
  let arrowKey = '';

  function setArrowType(type: ArrowType, unlocked: readonly ArrowType[]): void {
    const key = type + '|' + ARROW_ORDER.map((t) => (unlocked.includes(t) ? '1' : '0')).join('');
    setArrow(type);
    if (key === arrowKey) return;
    arrowKey = key;
    ARROW_ORDER.forEach((t, i) => {
      toggleClass(slots[i], 'locked', !unlocked.includes(t));
      toggleClass(slots[i], 'sel', t === type);
    });
    setText(arrowName, ARROW_NAME[type]);
    // the name label floats above the selected slot: only meaningful when there is a choice
    arrowName.style.display = unlocked.length > 1 ? '' : 'none';
    padHint.style.display = unlocked.length > 1 ? '' : 'none';
  }

  // ── crosshair & hit markers ─────────────────────────────────────────────────
  const cross = q<HTMLElement>('.gl-cross');
  const ring = q<SVGCircleElement>('.gl-cross .ring');
  let chargeQ = -1;
  function setCrosshair(charge: number, aiming: boolean, visible: boolean): void {
    toggleClass(cross, 'off', !visible);
    toggleClass(cross, 'aim', aiming);
    const c = Math.round(Math.max(0, Math.min(1, charge)) * 100) / 100;
    if (c !== chargeQ) {
      chargeQ = c;
      ring.setAttribute('stroke-dashoffset', (RING_C * (1 - c)).toFixed(2));
      toggleClass(cross, 'charging', c > 0.01);
      toggleClass(cross, 'full', c >= 0.98);
    }
  }

  const hmEl = q<HTMLElement>('.gl-hm');
  const hmSvg = hmEl.querySelector('svg') as SVGElement;
  let hmAnim: Animation | null = null;
  function hitMarker(kind: 'hit' | 'head' | 'kill' | 'armor'): void {
    hmEl.className = `gl-hm gl-g ${kind}`;
    hmAnim?.cancel();
    const big = kind === 'kill' ? 1.55 : kind === 'head' ? 1.38 : 1.2;
    hmAnim = hmSvg.animate(
      [
        { opacity: 1, transform: 'scale(.6)' },
        { opacity: 1, transform: `scale(${big})`, offset: 0.22 },
        { opacity: 1, transform: 'scale(1.05)', offset: 0.6 },
        { opacity: 0, transform: 'scale(1.15)' },
      ],
      { duration: kind === 'kill' ? 520 : 320, easing: 'ease-out', fill: 'none' },
    );
  }

  // ── damage direction ────────────────────────────────────────────────────────
  const dmgEl = q<HTMLElement>('.gl-dmg');
  const wedges: HTMLElement[] = [];
  for (let i = 0; i < 6; i++) {
    const w = h('div', 'gl-dmgw');
    w.innerHTML =
      '<svg viewBox="-50 -50 100 100"><circle class="a1" r="47" transform="rotate(-115)" stroke-dasharray="41 254.4"/><circle class="a2" r="47" transform="rotate(-115)" stroke-dasharray="41 254.4"/></svg>';
    dmgEl.appendChild(w);
    wedges.push(w);
  }
  const dmgVig = h('div', 'gl-dmgv');
  dmgEl.appendChild(dmgVig);
  let wedgeI = 0;
  function damage(angle?: number): void {
    if (angle === undefined) {
      dmgVig.animate([{ opacity: 0 }, { opacity: 1, offset: 0.15 }, { opacity: 0 }], { duration: 700, easing: 'ease-out' });
      return;
    }
    const w = wedges[wedgeI++ % wedges.length];
    w.style.transform = `rotate(${angle.toFixed(3)}rad)`;
    w.animate([{ opacity: 0 }, { opacity: 1, offset: 0.12 }, { opacity: 0.85, offset: 0.45 }, { opacity: 0 }], {
      duration: 1250,
      easing: 'ease-out',
    });
  }

  // ── objective ───────────────────────────────────────────────────────────────
  const objEl = q<HTMLElement>('.gl-obj');
  const objTx = q<HTMLElement>('.gl-obj .tx');
  let objText: string | null = null;
  function setObjective(text: string | null): void {
    if (text === objText) return;
    objText = text;
    toggleClass(objEl, 'none', text === null);
    if (text !== null) {
      objTx.textContent = text;
      objEl.animate(
        [
          { opacity: 0, transform: 'translateX(-14px)' },
          { opacity: 1, transform: 'none' },
        ],
        { duration: 520, easing: 'cubic-bezier(.2,.8,.2,1)' },
      );
      objTx.animate([{ color: '#fff3c0', textShadow: '0 0 14px rgba(232,215,154,.9)' }, { color: 'inherit', textShadow: 'none' }], { duration: 1400, easing: 'ease-out' });
    }
  }

  // ── rivalry ─────────────────────────────────────────────────────────────────
  const rivEl = q<HTMLElement>('.gl-riv');
  const youSide = q<HTMLElement>('.gl-riv .you');
  const himSide = q<HTMLElement>('.gl-riv .him');
  const youNum = youSide.querySelector('.num') as HTMLElement;
  const himNum = himSide.querySelector('.num') as HTMLElement;
  let rivL = -1;
  let rivG = -1;
  function pulse(n: HTMLElement): void {
    n.animate(
      [
        { transform: 'scale(1)' },
        { transform: 'scale(1.5)', color: '#fff0b8', textShadow: '0 0 16px rgba(255,226,140,.95)', offset: 0.3 },
        { transform: 'scale(1)' },
      ],
      { duration: 520, easing: 'ease-out' },
    );
  }
  function setRivalry(legolas: number | null, gimli = 0): void {
    if (legolas === null) {
      toggleClass(rivEl, 'none', true);
      rivL = rivG = -1;
      return;
    }
    toggleClass(rivEl, 'none', false);
    const first = rivL < 0;
    if (legolas !== rivL) {
      rivL = legolas;
      youNum.textContent = String(legolas);
      if (!first) pulse(youNum);
    }
    if (gimli !== rivG) {
      rivG = gimli;
      himNum.textContent = String(gimli);
      if (!first) pulse(himNum);
    }
    toggleClass(youSide, 'lead', rivL > rivG);
    toggleClass(himSide, 'lead', rivG > rivL);
  }

  // ── boss bar ────────────────────────────────────────────────────────────────
  const bossEl = q<HTMLElement>('.gl-boss');
  const bossName = q<HTMLElement>('.gl-boss .nm');
  const bossFill = q<SVGRectElement>('.b-fill');
  const bossLag = q<SVGRectElement>('.gl-boss .lag');
  let bossFrac = 1;
  let bossLagFrac = 1;
  let bossLagDelay = 0;
  let bossW = -1;
  let bossLagW = -1;
  let bossActive = false;
  function setBoss(name: string | null, frac = 1): void {
    if (name === null) {
      if (bossActive) {
        bossActive = false;
        toggleClass(bossEl, 'none', true);
      }
      return;
    }
    if (!bossActive) {
      bossActive = true;
      toggleClass(bossEl, 'none', false);
      bossFrac = bossLagFrac = frac;
      bossLagW = -1;
    }
    setText(bossName, name);
    const f = Math.max(0, Math.min(1, frac));
    const w = Math.round(f * 600 * 4) / 4;
    if (w !== bossW) {
      bossW = w;
      bossFill.setAttribute('width', String(w));
      if (f > bossFrac) {
        bossLagFrac = f;
        bossLagW = -1;
      } else if (f < bossFrac) bossLagDelay = 0.55;
      bossFrac = f;
    }
    if (bossLagW < 0) {
      bossLagW = Math.round(bossLagFrac * 600 * 4) / 4;
      bossLag.setAttribute('width', String(bossLagW));
    }
  }

  // ── toasts ──────────────────────────────────────────────────────────────────
  const toastHost = q<HTMLElement>('.gl-toasts');
  const toasts: ToastItem[] = [];
  const MAX_TOASTS = 2;
  function toast(text: string, kind: 'checkpoint' | 'info' | 'reward' | 'warning' = 'info'): void {
    // the same message again just keeps the live toast alive
    const dup = toasts.find((x) => x.text === text && x.kind === kind);
    if (dup) {
      dup.ttl = Math.max(dup.ttl, kind === 'checkpoint' ? 3.4 : 3);
      return;
    }
    const t = h('div', `gl-toast ${kind}`);
    t.innerHTML = `${icon(TOAST_ICON[kind] ?? 'info')}<span>${esc(text)}</span>`;
    toastHost.appendChild(t);
    t.animate(
      [
        { opacity: 0, transform: 'translateY(-14px) scaleX(.9)' },
        { opacity: 1, transform: 'none' },
      ],
      { duration: 380, easing: 'cubic-bezier(.2,.8,.2,1)' },
    );
    toasts.push({ el: t, ttl: kind === 'checkpoint' ? 3.4 : 3, text, kind });
    // at most two at once: the oldest is replaced
    while (toasts.length > MAX_TOASTS) removeToast(toasts[0], true);
  }
  function removeToast(it: ToastItem, now = false): void {
    const i = toasts.indexOf(it);
    if (i >= 0) toasts.splice(i, 1);
    if (now) {
      it.el.remove();
      return;
    }
    const a = it.el.animate([{ opacity: 1 }, { opacity: 0, transform: 'translateY(-8px)' }], { duration: 320, easing: 'ease-in', fill: 'forwards' });
    a.onfinish = () => it.el.remove();
  }

  function clearToasts(): void {
    for (const t of toasts.splice(0)) t.el.remove();
    toastHost.textContent = '';
  }

  // ── subtitles ───────────────────────────────────────────────────────────────
  const subEl = q<HTMLElement>('.gl-sub');
  const subSp = q<HTMLElement>('.gl-sub .sp');
  const subTx = q<HTMLElement>('.gl-sub .tx');
  const subQueue: { speaker: string; text: string; dur: number }[] = [];
  let subTtl = 0;
  let subShowing = false;
  let subsEnabled = true;
  function showNextSub(): void {
    const it = subQueue.shift();
    if (!it) {
      subShowing = false;
      toggleClass(subEl, 'on', false);
      return;
    }
    subShowing = true;
    subSp.textContent = it.speaker;
    subSp.style.color = SPEAKER_COLOR[it.speaker] ?? DEFAULT_SPEAKER_COLOR;
    subSp.style.display = it.speaker ? '' : 'none';
    subTx.textContent = it.text;
    subTtl = it.dur;
    toggleClass(subEl, 'on', true);
    for (const e of [subSp, subTx]) e.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 220, easing: 'ease-out' });
  }
  function subtitle(speaker: Speaker, text: string, duration?: number): void {
    if (!subsEnabled) return;
    const dur = duration ?? Math.max(2.4, 1.3 + text.length * 0.052);
    // strictly sequential: a line waits for the one on screen (no cutting it short), so overlapping
    // sources (chapter script, rivalry banter) can never talk over each other
    subQueue.push({ speaker: speaker === 'Narrator' ? '' : String(speaker), text, dur });
    if (!subShowing) showNextSub();
  }
  /** seconds until a line queued right now would start showing */
  function subtitleBacklog(): number {
    if (!subsEnabled) return 0;
    let t = subShowing ? Math.max(0, subTtl) : 0;
    for (const q of subQueue) t += q.dur;
    return t;
  }
  /** drop the current line and everything queued (level dispose) */
  function clearSubtitles(): void {
    subQueue.length = 0;
    subShowing = false;
    subTtl = 0;
    toggleClass(subEl, 'on', false);
  }
  function setSubtitlesEnabled(v: boolean): void {
    subsEnabled = v;
    if (!v) clearSubtitles();
  }

  // ── title card ──────────────────────────────────────────────────────────────
  const tcEl = q<HTMLElement>('.gl-tc');
  const tcFilm = q<HTMLElement>('.gl-tc .film');
  const tcTtl = q<HTMLElement>('.gl-tc .ttl');
  const tcSub = q<HTMLElement>('.gl-tc .sub');
  const tcOrn = q<SVGElement>('.gl-tc .gl-orn');
  let tcAnims: Animation[] = [];
  let tcElapsed = 0;
  let tcResolve: (() => void) | null = null;
  let tcTimer = 0;
  function finishTitleCard(): void {
    for (const a of tcAnims) a.cancel();
    tcAnims = [];
    tcEl.style.display = 'none';
    tcElapsed = 0;
    window.clearTimeout(tcTimer);
    const r = tcResolve;
    tcResolve = null;
    r?.();
  }
  function titleCard(title: string, subtitleText: string, film?: string): Promise<void> {
    if (tcResolve) finishTitleCard();
    tcFilm.textContent = film ?? '';
    tcFilm.style.display = film ? '' : 'none';
    tcTtl.textContent = title;
    tcSub.textContent = subtitleText;
    tcSub.style.display = subtitleText ? '' : 'none';
    tcEl.style.display = 'flex';
    const dur = TITLE_CARD_SEC * 1000;
    tcAnims = [
      tcEl.animate([{ opacity: 0 }, { opacity: 1, offset: 0.16 }, { opacity: 1, offset: 0.78 }, { opacity: 0 }], { duration: dur, easing: 'linear', fill: 'both' }),
      tcTtl.animate([{ letterSpacing: '0.34em', filter: 'blur(8px)' }, { letterSpacing: '0.17em', filter: 'blur(0px)' }], { duration: dur * 0.9, easing: 'cubic-bezier(.2,.7,.2,1)', fill: 'both' }),
      tcOrn.animate([{ transform: 'scaleX(0)', opacity: 0 }, { transform: 'scaleX(1)', opacity: 1 }], { duration: 1500, delay: 500, easing: 'ease-out', fill: 'both' }),
      tcSub.animate([{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }], { duration: 1200, delay: 900, easing: 'ease-out', fill: 'both' }),
    ];
    tcElapsed = 0;
    return new Promise<void>((resolve) => {
      tcResolve = resolve;
      // wall-clock safety net in case update() is not driven (the dt based timer in update() usually fires first)
      tcTimer = window.setTimeout(finishTitleCard, dur + 100);
    });
  }

  // ── focus marks ─────────────────────────────────────────────────────────────
  const marksEl = q<HTMLElement>('.gl-marks');
  interface MarkEl { el: HTMLElement; x: number; y: number; locked: boolean; shown: boolean }
  const marks: MarkEl[] = [];
  function setFocusMarks(points: readonly { x: number; y: number; locked: boolean }[]): void {
    for (let i = 0; i < points.length; i++) {
      let m = marks[i];
      if (!m) {
        const e = h('div', 'gl-mark');
        e.innerHTML = `<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"><g class="ou"><path d="M16 2L30 16 16 30 2 16z"/><path d="M16 5.5v3.500M16 26.500v-3.500M5.500 16h3.500M26.500 16h-3.500" opacity=".75"/></g><path class="in" d="M16 9l7 7-7 7-7-7z"/><circle cx="16" cy="16" r="1.4" fill="currentColor" stroke="none"/></svg>`;
        marksEl.appendChild(e);
        m = { el: e, x: NaN, y: NaN, locked: false, shown: false };
        marks[i] = m;
      }
      const p = points[i];
      if (!(Math.abs(p.x - m.x) <= 0.3 && Math.abs(p.y - m.y) <= 0.3)) {
        m.x = p.x;
        m.y = p.y;
        m.el.style.transform = `translate3d(${p.x.toFixed(1)}px,${p.y.toFixed(1)}px,0)`;
      }
      if (p.locked !== m.locked) {
        m.locked = p.locked;
        m.el.classList.toggle('locked', p.locked);
      }
      if (!m.shown) {
        m.shown = true;
        m.el.style.display = 'block';
      }
    }
    for (let i = points.length; i < marks.length; i++) {
      const m = marks[i];
      if (m.shown) {
        m.shown = false;
        m.el.style.display = 'none';
        m.x = m.y = NaN;
      }
    }
  }

  // ── prompt ──────────────────────────────────────────────────────────────────
  const promptEl = q<HTMLElement>('.gl-prompt');
  let promptAction: PromptAction | null = null;
  let promptText = '';
  let promptKey = '';
  function renderPrompt(): void {
    const dev = getDevice();
    // on touch the contextual INTERACT button already carries the label
    if (!promptAction || (dev === 'touch' && promptAction === 'interact')) {
      toggleClass(promptEl, 'on', false);
      promptKey = '';
      return;
    }
    const k = `${promptAction}|${promptText}|${dev}`;
    if (k !== promptKey) {
      promptKey = k;
      promptEl.innerHTML = `${promptGlyph(promptAction, dev)}<span>${esc(promptText)}</span>`;
    }
    toggleClass(promptEl, 'on', true);
  }
  function setPrompt(action: PromptAction | null, text?: string): void {
    promptAction = action;
    promptText = text ?? (action ? DEFAULT_PROMPT[action] : '');
    renderPrompt();
  }

  // ── progress / fps ──────────────────────────────────────────────────────────
  const progEl = q<HTMLElement>('.gl-prog');
  const progLb = q<HTMLElement>('.gl-prog .lb');
  const progFl = q<HTMLElement>('.gl-prog .fl');
  let progQ = -1;
  function setProgress(label: string | null, frac = 0): void {
    if (label === null) {
      toggleClass(progEl, 'none', true);
      progQ = -1;
      return;
    }
    toggleClass(progEl, 'none', false);
    setText(progLb, label);
    const f = Math.round(Math.max(0, Math.min(1, frac)) * 500) / 500;
    if (f !== progQ) {
      progQ = f;
      progFl.style.transform = `scaleX(${f})`;
    }
  }

  const lockEl = q<HTMLElement>('.gl-lock');
  function setPointerHint(v: boolean): void {
    toggleClass(lockEl, 'on', v);
  }

  const fpsEl = q<HTMLElement>('.gl-fps');
  let fpsQ = -1;
  function setFps(fps: number | null): void {
    if (fps === null) {
      toggleClass(fpsEl, 'on', false);
      fpsQ = -1;
      return;
    }
    toggleClass(fpsEl, 'on', true);
    const f = Math.round(fps);
    if (f !== fpsQ) {
      fpsQ = f;
      fpsEl.textContent = `${f} FPS`;
    }
  }

  // ── show / device ───────────────────────────────────────────────────────────
  function show(v: boolean): void {
    toggleClass(el, 'hidden', !v);
  }

  let devCls = `gl-dev-${dev0}`;
  onDevice((d: Device) => {
    el.classList.replace(devCls, `gl-dev-${d}`);
    devCls = `gl-dev-${d}`;
    renderPrompt();
  });

  // ── per-frame ───────────────────────────────────────────────────────────────
  function update(dt: number): void {
    // lagging ghost bars
    if (hpLagFrac > hpFrac) {
      if (hpLagDelay > 0) hpLagDelay -= dt;
      else hpLagFrac = Math.max(hpFrac, hpLagFrac - dt * 0.4);
      const w = Math.round(hpLagFrac * 320 * 4) / 4;
      if (w !== hpLagW) {
        hpLagW = w;
        hpLag.setAttribute('width', String(w));
      }
    }
    if (bossActive && bossLagFrac > bossFrac) {
      if (bossLagDelay > 0) bossLagDelay -= dt;
      else bossLagFrac = Math.max(bossFrac, bossLagFrac - dt * 0.3);
      const w = Math.round(bossLagFrac * 600 * 4) / 4;
      if (w !== bossLagW) {
        bossLagW = w;
        bossLag.setAttribute('width', String(w));
      }
    }
    if (toasts.length) {
      for (let i = toasts.length - 1; i >= 0; i--) {
        const t = toasts[i];
        t.ttl -= dt;
        if (t.ttl <= 0) removeToast(t);
      }
    }
    if (subShowing) {
      subTtl -= dt;
      if (subTtl <= 0) showNextSub();
    }
    if (tcResolve) {
      tcElapsed += dt;
      if (tcElapsed >= TITLE_CARD_SEC) finishTitleCard();
    }
  }

  setHealth(100, 100);
  setFocus(0, 100, false);

  return {
    root: el,
    show,
    setHealth,
    setFocus,
    setArrowType,
    setCrosshair,
    hitMarker,
    damage,
    setObjective,
    setRivalry,
    setBoss,
    toast,
    subtitle,
    titleCard,
    setFocusMarks,
    setPrompt,
    setProgress,
    setFps,
    setSubtitlesEnabled,
    clearSubtitles,
    clearToasts,
    subtitleBacklog,
    setPointerHint,
    update,
  };
}
