/**
 * Input tests (node, no browser): drives the real createInput against a just-enough fake browser (events, a
 * canvas rectangle, stand-in elements for the touch layer) and a controllable clock.
 *
 * Edge turning is the mouse-only way to keep turning while the cursor is parked in the outer band of the canvas
 * (no pointer lock, no button held). It must run for keyboard + mouse only: the pointer stays unlocked for pad and
 * touch players too, where a 1-2 px nudge or a synthetic mousemove used to spin the view under a hidden cursor.
 * Run with: node src/physics/run-tests.mjs
 */
import { createInput } from './input';
import { getDevice, setDevice } from '../ui/bus';
import type { Input } from './types';

let failed = 0;
let passed = 0;
const ok = (c: boolean, m: string) => {
  if (c) passed++;
  else {
    failed++;
    console.log('  FAIL:', m);
  }
};
const near = (a: number, b: number, e: number, m: string) => ok(Math.abs(a - b) <= e, `${m} (got ${a.toFixed(5)}, want ${b.toFixed(5)} ±${e})`);
const test = (n: string, f: () => void) => {
  const b = failed;
  try {
    f();
  } catch (e) {
    failed++;
    console.log('  THROW', (e as Error).stack);
  }
  console.log(failed === b ? 'ok   ' + n : 'FAIL ' + n);
};

// ── a just-enough browser ─────────────────────────────────────────────────────
type Handler = (e: Record<string, unknown>) => void;
class Target {
  private on = new Map<string, Set<Handler>>();
  addEventListener(type: string, fn: Handler): void {
    let set = this.on.get(type);
    if (!set) this.on.set(type, (set = new Set()));
    set.add(fn);
  }
  removeEventListener(type: string, fn: Handler): void {
    this.on.get(type)?.delete(fn);
  }
  /** deliver an event the way the browser would (a plain object carries everything these handlers read) */
  fire(type: string, props: Record<string, unknown> = {}): void {
    const e: Record<string, unknown> = { type, defaultPrevented: false, preventDefault() { e.defaultPrevented = true; }, ...props };
    for (const fn of [...(this.on.get(type) ?? [])]) fn(e);
  }
}
const BUTTONS = ['pause', 'next', 'focus', 'dash', 'jump', 'melee', 'aim', 'draw', 'interact'];
/** enough of an element for the touch layer's constructor and the calls input.ts makes on it */
class El extends Target {
  className = '';
  id = '';
  hidden = false;
  innerHTML = '';
  textContent = '';
  clientWidth = 0;
  dataset: Record<string, string> = {};
  style: Record<string, string> = {};
  classList = { add() {}, remove() {}, toggle() {} };
  appendChild<T>(c: T): T { return c; }
  remove(): void {}
  setPointerCapture(): void {}
  querySelector(): El { return new El(); }
  querySelectorAll(): El[] { return BUTTONS.map((b) => Object.assign(new El(), { dataset: { b } })); }
}
const W = 1280;
const H = 720;
class Canvas extends El {
  getBoundingClientRect() { return { left: 0, top: 0, right: W, bottom: H, width: W, height: H }; }
  requestPointerLock(): void {}
}

const g = globalThis as unknown as Record<string, unknown>;
let clock = 1000;
const perf = performance as unknown as { now: () => number };
const realNow = perf.now;
const realNav = Object.getOwnPropertyDescriptor(globalThis, 'navigator');

/** a gamepad that reports one pressed button on demand (standard mapping) */
const pad = { connected: true, mapping: 'standard', axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })) };
let padPlugged = false;

interface Rig {
  input: Input;
  /** a mouse move to (x, y) client px with a movement delta, as the browser reports it */
  move(x: number, y: number, dx?: number, dy?: number): void;
  /** a key press (device flips to keyboard + mouse) */
  key(code: string): void;
  /** one 16 ms frame; the look delta that frame handed to the game */
  frame(): { x: number; y: number };
}
function rig(device: 'kbm' | 'gamepad' | 'touch' = 'kbm'): Rig {
  const win = new Target();
  const doc = Object.assign(new Target(), { documentElement: new Target(), head: new El(), pointerLockElement: null, hidden: false, exitPointerLock() {}, createElement: () => new El(), getElementById: () => null });
  g.window = Object.assign(win, { innerWidth: W, innerHeight: H });
  g.document = doc;
  clock += 1000;
  setDevice('kbm');
  const input = createInput(new Canvas() as unknown as HTMLElement, new El() as unknown as HTMLElement);
  setDevice(device);
  return {
    input,
    move: (x, y, dx = 0, dy = 0) => win.fire('mousemove', { clientX: x, clientY: y, movementX: dx, movementY: dy }),
    key: (code) => win.fire('keydown', { code, repeat: false, target: { tagName: 'BODY' } }),
    frame: () => {
      clock += 16;
      input.poll();
      return { x: input.state.lookX, y: input.state.lookY };
    },
  };
}
function withRig(device: 'kbm' | 'gamepad' | 'touch', f: (r: Rig) => void): void {
  const r = rig(device);
  try {
    f(r);
  } finally {
    r.input.dispose();
  }
}

perf.now = () => clock;
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { getGamepads: () => (padPlugged ? [pad] : []) } });
try {
  const MOUSE_RAD_PER_PX = 0.002;

  // ── the intended behaviour, unchanged ──────────────────────────────────────
  test('keyboard + mouse, no lock: moving the mouse with no button held turns the view', () => {
    withRig('kbm', (r) => {
      r.move(640, 360, 50, -20);
      const f = r.frame();
      near(f.x, 50 * MOUSE_RAD_PER_PX, 1e-9, 'yaw follows the mouse');
      near(f.y, 20 * MOUSE_RAD_PER_PX, 1e-9, 'pitch follows the mouse');
      ok(!r.input.state.drawHeld && !r.input.state.aimHeld, 'no button is held');
      const rest = r.frame();
      ok(rest.x === 0 && rest.y === 0, 'a cursor in the middle of the canvas adds nothing once the mouse stops');
    });
  });

  test('keyboard + mouse, no lock: a cursor parked in the edge band keeps turning the view', () => {
    withRig('kbm', (r) => {
      r.move(1275, 360, 3, 0); // right band
      r.frame(); // (the 3 px of mouse look land in this first frame)
      const a = r.frame();
      const b = r.frame();
      ok(a.x > 0.02 && a.y === 0, `parked right: yaw keeps turning right (${a.x.toFixed(4)})`);
      near(b.x, a.x, 1e-12, 'and at the same rate every frame');

      // (movement deltas stay small: the input drops anything over 600 px as the pointer-lock jump bug)
      r.move(1200, 360, -20, 0); // further in from the edge, still inside the band
      r.frame();
      const slower = r.frame();
      ok(slower.x > 0 && slower.x < a.x, `the further in from the edge, the slower (${slower.x.toFixed(4)} < ${a.x.toFixed(4)})`);

      r.move(5, 360, -20, 0); // left band
      r.frame();
      ok(r.frame().x < -0.02, 'parked left: yaw keeps turning left');
      r.move(640, 4, 0, -20); // top band
      r.frame();
      const top = r.frame();
      ok(top.y > 0.01 && top.x === 0, 'parked at the top: pitch keeps turning up');
      r.move(640, 716, 0, 20); // bottom band
      r.frame();
      ok(r.frame().y < -0.01, 'parked at the bottom: pitch keeps turning down');
      r.move(640, 360, 0, -20); // back to the middle
      r.frame();
      ok(r.frame().x === 0 && r.frame().y === 0, 'leaving the band stops it');
    });
  });

  test('keyboard + mouse: a mouse move that is a real one flips a pad / touch device back, and its parked cursor counts', () => {
    for (const dev of ['gamepad', 'touch'] as const) {
      withRig(dev, (r) => {
        r.move(1275, 360, 6, 0); // more than 2 px: the player picked up the mouse
        ok(getDevice() === 'kbm', `${dev}: a real mouse move switches to keyboard + mouse`);
        r.frame();
        ok(r.frame().x > 0.02, `${dev}: and the cursor parked in the band turns the view again`);
      });
    }
  });

  // ── the bug: edge turning on a pad or touch ────────────────────────────────
  test('gamepad: a mouse nudged (or synthetic-moved) into the edge band does not turn the view', () => {
    withRig('gamepad', (r) => {
      r.move(1275, 360, 1, 0); // 1 px nudge: the device stays 'gamepad'
      ok(getDevice() === 'gamepad', 'a 1 px nudge does not flip the device');
      const first = r.frame();
      near(first.x, 1 * MOUSE_RAD_PER_PX, 1e-9, 'the nudge itself is only its own pixel of mouse look');
      for (let i = 0; i < 5; i++) {
        const f = r.frame();
        ok(f.x === 0 && f.y === 0, `frame ${i + 2}: no edge turning on a pad (${f.x}, ${f.y})`);
      }
      r.move(640, 4, 0, 0); // the zero-movement mousemove Chrome sends after a layout change, at the top edge
      for (let i = 0; i < 3; i++) {
        const f = r.frame();
        ok(f.x === 0 && f.y === 0, 'a synthetic move in the band does not drift the pitch either');
      }
    });
  });

  test('touch: a compat mouse move in the band does not turn the view', () => {
    withRig('touch', (r) => {
      r.move(5, 360, 0, 0);
      for (let i = 0; i < 4; i++) {
        const f = r.frame();
        ok(f.x === 0 && f.y === 0, 'no edge turning under touch');
      }
    });
  });

  test('switching away from keyboard + mouse forgets the parked cursor, so it cannot resume later', () => {
    withRig('kbm', (r) => {
      r.move(1275, 360, 4, 0);
      r.frame();
      ok(r.frame().x > 0.02, 'turning while on keyboard + mouse');

      setDevice('gamepad'); // the player picks up the pad; the mouse stays parked where it was
      for (let i = 0; i < 3; i++) ok(r.frame().x === 0, 'stops at once on the pad');

      r.key('KeyW'); // a key press flips back to keyboard + mouse, the mouse has not moved
      ok(getDevice() === 'kbm', 'a key press is keyboard + mouse again');
      for (let i = 0; i < 3; i++) {
        const f = r.frame();
        ok(f.x === 0 && f.y === 0, 'the stale cursor position does not resume edge turning');
      }

      r.move(1275, 360, 2, 0); // moving the mouse again is what re-arms it
      r.frame();
      ok(r.frame().x > 0.02, 'a real mouse move arms it again');
    });
  });

  test('a pad press through the real poll path ends edge turning (device flips inside poll)', () => {
    withRig('kbm', (r) => {
      r.move(1275, 360, 4, 0);
      r.frame();
      ok(r.frame().x > 0.02, 'turning on keyboard + mouse');
      padPlugged = true;
      pad.buttons[0] = { pressed: true, value: 1 };
      r.frame(); // the frame the pad is first seen: the device flips to 'gamepad' inside this poll
      ok(getDevice() === 'gamepad', 'the pad press made the pad the active device');
      pad.buttons[0] = { pressed: false, value: 0 };
      for (let i = 0; i < 3; i++) ok(r.frame().x === 0, 'the next frames do not edge-turn');
      padPlugged = false;
    });
  });
} finally {
  perf.now = realNow;
  delete g.window;
  delete g.document;
  if (realNav) Object.defineProperty(globalThis, 'navigator', realNav);
  else delete g.navigator;
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) (globalThis as unknown as { process: { exitCode: number } }).process.exitCode = 1;
