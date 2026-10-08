/**
 * On-screen touch controls: dynamic-origin movement stick, look-drag area and action buttons.
 * Pure DOM + Pointer Events (multitouch via pointer ids). input.ts owns one instance and polls
 * `st` once per frame.
 */
import { getArrow, onArrow } from './bus';
import { ARROW_ICON, icon, type IconName } from './icons';
import { injectStyles } from './styles';

export interface TouchState {
  moveX: number;
  moveY: number;
  sprint: boolean;
  /** accumulated look drag in CSS px since the last consume() */
  lookDX: number;
  lookDY: number;
  drawHeld: boolean;
  /** a draw press happened since last consume (tap latch) */
  drawTap: boolean;
  aimOn: boolean;
  focusHeld: boolean;
  focusTap: boolean;
  melee: boolean;
  jump: boolean;
  dash: boolean;
  interact: boolean;
  next: boolean;
  pause: boolean;
}

type BtnId = 'draw' | 'aim' | 'melee' | 'jump' | 'dash' | 'focus' | 'interact' | 'next' | 'pause';

const STICK_R = 56;
const STICK_SPRINT = 1.5;
const DEAD = 0.14;

export class TouchControls {
  readonly st: TouchState = {
    moveX: 0, moveY: 0, sprint: false, lookDX: 0, lookDY: 0, drawHeld: false, drawTap: false, aimOn: false,
    focusHeld: false, focusTap: false, melee: false, jump: false, dash: false, interact: false, next: false, pause: false,
  };
  readonly el: HTMLElement;
  /** called on any touch pointerdown (device detection) */
  onFirstTouch: (() => void) | null = null;

  private zone: HTMLElement;
  private stick: HTMLElement;
  private knob: HTMLElement;
  private buttons = new Map<BtnId, HTMLElement>();
  private nextIcon: HTMLElement;
  private interactLabel: HTMLElement;
  private stickId = -1;
  private stickOX = 0;
  private stickOY = 0;
  private lookId = -1;
  private lookX = 0;
  private lookY = 0;
  private drawId = -1;
  private drawX = 0;
  private drawY = 0;
  private offArrow: () => void;
  private visible = false;
  private active = true;

  constructor(parent: HTMLElement) {
    injectStyles();
    const el = (this.el = document.createElement('div'));
    el.className = 'gl-touch';
    el.hidden = true;
    el.innerHTML = `
      <div class="gl-t-zone"></div>
      <div class="gl-t-stick idle"><div class="gl-t-ring"><div class="gl-t-sprint"></div></div><div class="gl-t-knob"></div></div>
      <button class="gl-tbtn gl-t-pause" data-b="pause" aria-label="Pause">${icon('pause')}</button>
      <button class="gl-tbtn gl-t-next" data-b="next" aria-label="Switch arrow">${icon('arrow_standard')}</button>
      <button class="gl-tbtn gl-t-focus" data-b="focus" aria-label="Focus">${icon('focus')}</button>
      <button class="gl-tbtn gl-t-dash" data-b="dash" aria-label="Dash">${icon('dash')}</button>
      <button class="gl-tbtn gl-t-jump" data-b="jump" aria-label="Jump">${icon('jump')}</button>
      <button class="gl-tbtn gl-t-melee" data-b="melee" aria-label="Knives">${icon('knives')}</button>
      <button class="gl-tbtn gl-t-aim" data-b="aim" aria-label="Aim">${icon('aim')}</button>
      <button class="gl-tbtn gl-t-draw" data-b="draw" aria-label="Draw bow">${icon('draw')}<span class="gl-t-cap">DRAW</span></button>
      <button class="gl-tbtn gl-t-interact" data-b="interact" aria-label="Interact" hidden>${icon('interact')}<span class="gl-t-label"></span></button>`;
    parent.appendChild(el);

    this.zone = el.querySelector('.gl-t-zone')!;
    this.stick = el.querySelector('.gl-t-stick')!;
    this.knob = el.querySelector('.gl-t-knob')!;
    this.nextIcon = el.querySelector('.gl-t-next')!;
    this.interactLabel = el.querySelector('.gl-t-label')!;
    el.querySelectorAll<HTMLElement>('[data-b]').forEach((b) => this.buttons.set(b.dataset.b as BtnId, b));

    this.zone.addEventListener('pointerdown', this.onZoneDown);
    this.zone.addEventListener('pointermove', this.onZoneMove);
    this.zone.addEventListener('pointerup', this.onZoneUp);
    this.zone.addEventListener('pointercancel', this.onZoneUp);
    for (const [id, b] of this.buttons) {
      b.addEventListener('pointerdown', (e) => this.onBtnDown(id, b, e));
      b.addEventListener('pointermove', (e) => this.onBtnMove(id, e));
      b.addEventListener('pointerup', (e) => this.onBtnUp(id, b, e));
      b.addEventListener('pointercancel', (e) => this.onBtnUp(id, b, e));
      b.addEventListener('contextmenu', (e) => e.preventDefault());
    }
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    this.offArrow = onArrow(() => this.refreshArrowIcon());
    this.refreshArrowIcon();
  }

  private refreshArrowIcon(): void {
    this.nextIcon.innerHTML = icon(ARROW_ICON[getArrow()] as IconName);
  }

  setLayoutVisible(v: boolean): void {
    if (this.visible === v) return;
    this.visible = v;
    this.el.hidden = !v;
    if (!v) this.releaseAll();
  }

  /** enabled=false greys the controls and ignores touches */
  setActive(a: boolean): void {
    if (this.active === a) return;
    this.active = a;
    this.el.classList.toggle('off', !a);
    if (!a) this.releaseAll();
  }

  setInteractLabel(label: string | null): void {
    const b = this.buttons.get('interact')!;
    if (label === null) {
      b.hidden = true;
      return;
    }
    if (this.interactLabel.textContent !== label) this.interactLabel.textContent = label;
    b.hidden = false;
  }

  /** read & clear the accumulated look delta (px) */
  consumeLook(out: { x: number; y: number }): void {
    out.x = this.st.lookDX;
    out.y = this.st.lookDY;
    this.st.lookDX = 0;
    this.st.lookDY = 0;
  }

  releaseAll(): void {
    const s = this.st;
    s.moveX = s.moveY = 0;
    s.sprint = false;
    s.drawHeld = false;
    s.drawTap = false;
    s.aimOn = false;
    s.focusHeld = false;
    s.focusTap = false;
    s.melee = s.jump = s.dash = s.interact = s.next = s.pause = false;
    s.lookDX = s.lookDY = 0;
    this.stickId = this.lookId = this.drawId = -1;
    this.stick.classList.add('idle');
    this.stick.style.transform = '';
    this.knob.style.transform = '';
    for (const b of this.buttons.values()) b.classList.remove('down');
    this.buttons.get('aim')?.classList.remove('on');
  }

  dispose(): void {
    this.offArrow();
    this.el.remove();
  }

  // ── stick / look zone ─────────────────────────────────────────────────────
  private onZoneDown = (e: PointerEvent): void => {
    if (e.pointerType === 'mouse' || !this.active) return;
    e.preventDefault();
    this.onFirstTouch?.();
    const w = this.el.clientWidth || window.innerWidth;
    try {
      this.zone.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    if (e.clientX < w * 0.5 && this.stickId < 0) {
      this.stickId = e.pointerId;
      this.stickOX = e.clientX;
      this.stickOY = e.clientY;
      this.stick.classList.remove('idle');
      this.stick.style.transform = `translate3d(${e.clientX}px,${e.clientY}px,0)`;
      this.knob.style.transform = 'translate3d(0,0,0)';
    } else if (this.lookId < 0) {
      this.lookId = e.pointerId;
      this.lookX = e.clientX;
      this.lookY = e.clientY;
    }
  };

  private onZoneMove = (e: PointerEvent): void => {
    if (e.pointerId === this.stickId) {
      const dx = e.clientX - this.stickOX;
      const dy = e.clientY - this.stickOY;
      const d = Math.hypot(dx, dy);
      const k = d > STICK_R ? STICK_R / d : 1;
      this.knob.style.transform = `translate3d(${dx * k}px,${dy * k}px,0)`;
      const n = d / STICK_R;
      const s = this.st;
      if (n < DEAD) {
        s.moveX = s.moveY = 0;
        s.sprint = false;
      } else {
        const m = Math.min(1, (n - DEAD) / (1 - DEAD));
        s.moveX = (dx / d) * m;
        s.moveY = (-dy / d) * m;
        const sp = n >= STICK_SPRINT;
        if (sp !== s.sprint) {
          s.sprint = sp;
          this.stick.classList.toggle('sprint', sp);
        }
      }
    } else if (e.pointerId === this.lookId) {
      this.st.lookDX += e.clientX - this.lookX;
      this.st.lookDY += e.clientY - this.lookY;
      this.lookX = e.clientX;
      this.lookY = e.clientY;
    }
  };

  private onZoneUp = (e: PointerEvent): void => {
    if (e.pointerId === this.stickId) {
      this.stickId = -1;
      const s = this.st;
      s.moveX = s.moveY = 0;
      s.sprint = false;
      this.stick.classList.add('idle');
      this.stick.classList.remove('sprint');
      this.stick.style.transform = '';
      this.knob.style.transform = '';
    } else if (e.pointerId === this.lookId) {
      this.lookId = -1;
    }
  };

  // ── buttons ───────────────────────────────────────────────────────────────
  private onBtnDown(id: BtnId, b: HTMLElement, e: PointerEvent): void {
    if (e.pointerType === 'mouse' || !this.active) return;
    e.preventDefault();
    e.stopPropagation();
    this.onFirstTouch?.();
    try {
      b.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    b.classList.add('down');
    const s = this.st;
    switch (id) {
      case 'draw':
        s.drawHeld = true;
        s.drawTap = true;
        this.drawId = e.pointerId;
        this.drawX = e.clientX;
        this.drawY = e.clientY;
        break;
      case 'aim':
        s.aimOn = !s.aimOn;
        b.classList.toggle('on', s.aimOn);
        break;
      case 'focus':
        s.focusHeld = true;
        s.focusTap = true;
        break;
      case 'melee': s.melee = true; break;
      case 'jump': s.jump = true; break;
      case 'dash': s.dash = true; break;
      case 'interact': s.interact = true; break;
      case 'next': s.next = true; break;
      case 'pause': s.pause = true; break;
    }
  }

  private onBtnMove(id: BtnId, e: PointerEvent): void {
    if (id === 'draw' && e.pointerId === this.drawId) {
      this.st.lookDX += e.clientX - this.drawX;
      this.st.lookDY += e.clientY - this.drawY;
      this.drawX = e.clientX;
      this.drawY = e.clientY;
    }
  }

  private onBtnUp(id: BtnId, b: HTMLElement, e: PointerEvent): void {
    if (e.pointerType === 'mouse') return;
    b.classList.remove('down');
    if (id === 'draw' && e.pointerId === this.drawId) {
      this.st.drawHeld = false;
      this.drawId = -1;
    } else if (id === 'focus') {
      this.st.focusHeld = false;
    }
  }
}
