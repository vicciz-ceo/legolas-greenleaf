/** Menu navigation helpers: spatial focus movement and a small gamepad navigator. */
import { setDevice } from './bus';

export type Dir = 'up' | 'down' | 'left' | 'right';

export const NAV_SELECTOR = '[data-nav]';

function visible(e: HTMLElement): boolean {
  const r = e.getBoundingClientRect();
  return r.width > 0 && r.height > 0 && !e.hidden;
}

export function navItems(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(NAV_SELECTOR)).filter(
    (e) => !(e as HTMLButtonElement).disabled && visible(e),
  );
}

/** Pick the best focus candidate in direction `dir` from `from` (centre-based, axis weighted). */
export function spatialNext(container: HTMLElement, from: HTMLElement | null, dir: Dir): HTMLElement | null {
  const items = navItems(container);
  if (!items.length) return null;
  if (!from || !items.includes(from)) return items[0];
  const fr = from.getBoundingClientRect();
  const fx = fr.left + fr.width / 2;
  const fy = fr.top + fr.height / 2;
  let best: HTMLElement | null = null;
  let bestScore = Infinity;
  for (const c of items) {
    if (c === from) continue;
    const r = c.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    let prim: number;
    let sec: number;
    switch (dir) {
      case 'down':
        prim = cy - fy;
        sec = Math.abs(cx - fx);
        break;
      case 'up':
        prim = fy - cy;
        sec = Math.abs(cx - fx);
        break;
      case 'right':
        prim = cx - fx;
        sec = Math.abs(cy - fy);
        break;
      default:
        prim = fx - cx;
        sec = Math.abs(cy - fy);
    }
    if (prim < 3) continue;
    // elements on the same row/column are strongly preferred
    const score = prim + sec * 2.6;
    if (score < bestScore) {
      bestScore = score;
      best = c;
    }
  }
  return best;
}

/** Edge-detecting gamepad poller for menus (d-pad / left stick / A / B / Start). */
export class PadNav {
  private raf = 0;
  private prev: boolean[] = [];
  private dirHeld: Dir | null = null;
  private dirT = 0;
  private lastT = 0;
  private running = false;

  constructor(
    private h: {
      dir(d: Dir): void;
      confirm(): void;
      back(): void;
      start(): void;
    },
  ) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.prev = [];
    // swallow whatever is held right now (e.g. the Start press that opened the menu)
    const g = this.pad();
    if (g) for (let i = 0; i < g.buttons.length; i++) this.prev[i] = g.buttons[i].pressed;
    this.dirHeld = null;
    this.lastT = performance.now();
    this.raf = requestAnimationFrame(this.tick);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  private pad(): Gamepad | null {
    if (typeof navigator.getGamepads !== 'function') return null;
    const l = navigator.getGamepads();
    for (let i = 0; i < l.length; i++) if (l[i] && l[i]!.connected) return l[i];
    return null;
  }

  private tick = (): void => {
    if (!this.running) return;
    this.raf = requestAnimationFrame(this.tick);
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.lastT) / 1000);
    this.lastT = now;
    const g = this.pad();
    if (!g) return;
    const b = g.buttons;
    const down = (i: number): boolean => !!b[i]?.pressed;
    const edge = (i: number): boolean => down(i) && !this.prev[i];
    let d: Dir | null = null;
    const ax = g.axes[0] ?? 0;
    const ay = g.axes[1] ?? 0;
    if (down(12) || ay < -0.6) d = 'up';
    else if (down(13) || ay > 0.6) d = 'down';
    else if (down(14) || ax < -0.6) d = 'left';
    else if (down(15) || ax > 0.6) d = 'right';
    if (d) {
      if (d !== this.dirHeld) {
        this.dirHeld = d;
        this.dirT = 0.4;
        setDevice('gamepad');
        this.h.dir(d);
      } else {
        this.dirT -= dt;
        if (this.dirT <= 0) {
          this.dirT = 0.11;
          this.h.dir(d);
        }
      }
    } else this.dirHeld = null;
    if (edge(0)) {
      setDevice('gamepad');
      this.h.confirm();
    }
    if (edge(1)) {
      setDevice('gamepad');
      this.h.back();
    }
    if (edge(9)) {
      setDevice('gamepad');
      this.h.start();
    }
    for (let i = 0; i < b.length; i++) this.prev[i] = b[i].pressed;
  };
}
