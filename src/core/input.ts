/**
 * Unified input: keyboard + mouse (pointer lock with drag-look fallback), gamepad (standard
 * mapping) and touch (on-screen controls from src/ui/touch.ts).
 *
 * poll() is called exactly once per frame; it merges all devices, computes edges and look deltas
 * and writes them into the single reused `state` object (no per-frame allocations).
 */
import type { Input, InputState } from './types';
import { getDevice, setDevice } from '../ui/bus';
import { TouchControls } from '../ui/touch';

export interface InputOptions {
  /** behave as a touch device (shows the on-screen controls). Also enabled by ?touch=1 */
  forceTouch?: boolean;
}

const MOUSE_RAD_PER_PX = 0.002;
const TOUCH_RAD_PER_PX = 0.0052;
const PAD_LOOK_RATE = 3.1; // rad/s at full deflection, before sensitivity & acceleration
/** unlocked mouse: the cursor stops at the window edge, so an edge band keeps turning the view */
const EDGE_BAND_FRAC = 0.07;
const EDGE_BAND_MIN_PX = 28;
const EDGE_YAW_RATE = 2.4; // rad/s at the very edge, before sensitivity
const EDGE_PITCH_RATE = 1.4;
const LS_DEAD = 0.2;
const RS_DEAD = 0.16;

const KEY_MOVE: Record<string, [number, number]> = {
  KeyW: [0, 1], ArrowUp: [0, 1],
  KeyS: [0, -1], ArrowDown: [0, -1],
  KeyA: [-1, 0], ArrowLeft: [-1, 0],
  KeyD: [1, 0], ArrowRight: [1, 0],
};

/** wheel travel (px) that counts as one arrow-type step */
const WHEEL_STEP = 40;
/** a pause this long between wheel events ends a gesture (inertial trackpad tails never pause) */
const WHEEL_QUIET_MS = 150;
/** after a user-initiated pointer-lock exit (Esc) browsers refuse a re-lock for about this long */
const RELOCK_COOLDOWN_MS = 1300;

export interface WheelGesture {
  /** feed one wheel event; returns -1 (previous), +1 (next) or 0 (nothing yet / already switched this gesture) */
  push(deltaY: number, deltaMode: number, now: number): -1 | 0 | 1;
  reset(): void;
}

/**
 * Mouse-wheel to arrow-type stepping. Deltas are normalised (Firefox reports LINE units, a notch is
 * about 3 lines), summed until WHEEL_STEP, and one gesture gives exactly one step: after a switch,
 * further events are swallowed until the wheel has been quiet for WHEEL_QUIET_MS (this absorbs
 * trackpad / free-spin inertia) or the direction clearly reverses. Wheel up = previous, down = next.
 */
export function createWheelGesture(): WheelGesture {
  let acc = 0;
  let lastEvT = -1e9;
  let latched = 0; // direction of the step this gesture already produced (0 = armed)
  return {
    push(deltaY, deltaMode, now) {
      const dy = deltaY * (deltaMode === 1 ? 16 : deltaMode === 2 ? 100 : 1);
      if (now - lastEvT > WHEEL_QUIET_MS) {
        acc = 0;
        latched = 0;
      }
      lastEvT = now;
      if (dy === 0) return 0;
      const dir = dy < 0 ? -1 : 1;
      if (latched !== 0) {
        if (dir === latched || Math.abs(dy) < WHEEL_STEP) return 0; // inertial tail / jitter
        latched = 0; // a deliberate reversal starts a new gesture
        acc = 0;
      }
      if (acc !== 0 && (acc < 0) !== (dy < 0)) acc = 0;
      acc += dy;
      if (Math.abs(acc) >= WHEEL_STEP) {
        acc = 0;
        latched = dir;
        return dir;
      }
      return 0;
    },
    reset() {
      acc = 0;
      lastEvT = -1e9;
      latched = 0;
    },
  };
}

/** radial deadzone with rescale; writes into out[0..1]; returns magnitude (0..1) */
function radial(x: number, y: number, dead: number, out: number[]): number {
  const m = Math.hypot(x, y);
  if (m <= dead) {
    out[0] = 0;
    out[1] = 0;
    return 0;
  }
  const s = Math.min(1, (m - dead) / (1 - dead)) / m;
  out[0] = x * s;
  out[1] = y * s;
  return Math.min(1, (m - dead) / (1 - dead));
}

function blankState(): InputState {
  return {
    moveX: 0, moveY: 0, lookX: 0, lookY: 0,
    aimHeld: false, drawHeld: false, drawReleased: false,
    melee: false, jump: false, dash: false, interact: false, nextArrow: false, pause: false,
    arrowSlot: 0, focusHeld: false, focusPressed: false, focusReleased: false, sprintHeld: false,
    device: 'kbm',
  };
}

export function createInput(canvas: HTMLElement, uiRoot: HTMLElement, opts: InputOptions = {}): Input {
  const state = blankState();
  const params = new URLSearchParams(typeof location !== 'undefined' ? location.search : '');
  const forced = !!opts.forceTouch || params.get('touch') === '1';
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

  let enabled = true;
  let touchSeen = forced || coarse;
  let touchVisible = true;
  let locked = false;
  let wantUnlock = false;
  let dragFallback = false;
  let lockAttempted = false;
  let lastLockFromGesture = false;
  let disposed = false;

  // ── raw keyboard / mouse state ────────────────────────────────────────────
  const keys = new Set<string>();
  let mouseL = false;
  let mouseR = false;
  let drawLatch = false; // LMB pressed since last poll
  let focusLatch = false;
  let mdx = 0;
  let mdy = 0;
  // last cursor position (client px) while unlocked; curValid=false means "unknown / outside the window"
  let curX = 0;
  let curY = 0;
  let curValid = false;
  let cursorHidden = false;
  const wheel = createWheelGesture();
  // time of the last pointer-lock loss the user caused (Esc); browsers refuse a re-lock right after it
  let lastUserUnlockT = -1e9;
  let lastKeyLockT = -1e9;
  const pend = { melee: false, jump: false, dash: false, interact: false, next: false, prev: false, pause: false, slot: 0 as 0 | 1 | 2 | 3 };

  // ── gamepad state ─────────────────────────────────────────────────────────
  let padPrev: boolean[] = new Array(17).fill(false);
  let padRT = false;
  let padLT = false;
  let padSprintLatch = false;
  let padLookHold = 0;
  const padOut = [0, 0];
  let lastT = performance.now();

  // previous merged values for edges
  let prevDraw = false;
  let prevFocus = false;

  const touch = new TouchControls(uiRoot);
  touch.onFirstTouch = () => {
    if (!touchSeen) {
      touchSeen = true;
      syncTouch();
    }
    setDevice('touch');
  };
  const lookTmp = { x: 0, y: 0 };

  function syncTouch(): void {
    touch.setLayoutVisible(touchSeen && touchVisible);
    touch.setActive(enabled);
  }
  if (touchSeen) {
    if (forced) setDevice('touch');
    else if (coarse) setDevice('touch');
  }
  syncTouch();

  // ── event handlers ────────────────────────────────────────────────────────
  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.repeat) {
      if (enabled && (e.code === 'Tab' || e.code === 'Space' || e.code.startsWith('Arrow'))) e.preventDefault();
      return;
    }
    setDevice('kbm');
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
    keys.add(e.code);
    // a UI layer (the menus' capture listener) already handled this key: e.g. Esc on the pause menu
    // resumes, which re-enables input before this bubble-phase listener runs, and must not re-pause
    if (!enabled || e.defaultPrevented) return;
    // pointer lost without a deliberate pause (an Esc, Esc round trip: Esc is not an activation key so
    // the resume could not re-lock). Any other key press is, so take the pointer back here. Not a
    // "gesture" request: a refusal must never switch on drag-look.
    if (!locked && !dragFallback && e.code !== 'Escape' && e.code !== 'KeyP' && !(touchSeen && getDevice() === 'touch')) {
      const t0 = performance.now();
      if (t0 - lastUserUnlockT > RELOCK_COOLDOWN_MS && t0 - lastKeyLockT > RELOCK_COOLDOWN_MS) {
        lastKeyLockT = t0;
        lockPointer(false);
      }
    }
    switch (e.code) {
      case 'Space': pend.jump = true; e.preventDefault(); break;
      case 'KeyC': pend.dash = true; break;
      case 'KeyE':
      case 'KeyV': pend.melee = true; break;
      case 'KeyF': pend.interact = true; break;
      case 'KeyQ': focusLatch = true; break;
      case 'Digit1': pend.slot = 1; break;
      case 'Digit2': pend.slot = 2; break;
      case 'Digit3': pend.slot = 3; break;
      case 'Tab': pend.next = true; e.preventDefault(); break;
      case 'Escape':
      case 'KeyP': pend.pause = true; break;
      default:
        if (e.code.startsWith('Arrow')) e.preventDefault();
    }
  };
  const onKeyUp = (e: KeyboardEvent): void => {
    keys.delete(e.code);
  };
  const resetCursor = (): void => {
    curValid = false;
    curX = curY = 0;
  };
  const onDocOut = (e: MouseEvent): void => {
    if (!e.relatedTarget) resetCursor(); // the cursor left the window
  };
  const onBlur = (): void => {
    resetCursor();
    keys.clear();
    mouseL = mouseR = false;
    drawLatch = focusLatch = false;
  };

  const onMouseMove = (e: MouseEvent): void => {
    if (e.movementX === undefined) return;
    const ax = Math.abs(e.movementX);
    const ay = Math.abs(e.movementY);
    if (ax > 600 || ay > 600) return; // pointer-lock jump bug guard
    if (ax + ay > 2) setDevice('kbm');
    if (!enabled) return;
    if (locked) {
      mdx += e.movementX;
      mdy += e.movementY;
      curValid = false;
      return;
    }
    // unlocked: judge by the canvas rect (HUD overlays the canvas, so the event target says nothing)
    const r = canvas.getBoundingClientRect();
    const inside = e.clientX >= r.left && e.clientX < r.right && e.clientY >= r.top && e.clientY < r.bottom;
    if (inside) {
      // only keyboard + mouse parks a cursor (edge turning): a sub-threshold nudge or a synthetic move
      // under a pad or touch is not "the mouse is in use" (a real move flipped the device just above)
      if (getDevice() === 'kbm') {
        curX = e.clientX;
        curY = e.clientY;
        curValid = true;
      } else resetCursor();
      mdx += e.movementX;
      mdy += e.movementY;
    } else curValid = false;
  };

  const onMouseDown = (e: MouseEvent): void => {
    setDevice('kbm');
    if (!enabled) return;
    if (!locked) {
      // a click acquires the pointer; it only shoots when pointer lock is unavailable (drag-look)
      const wasFallback = dragFallback;
      lockPointer(true);
      e.preventDefault();
      if (!wasFallback && !dragFallback) return;
    }
    if (e.button === 0) {
      mouseL = true;
      drawLatch = true;
    } else if (e.button === 2) {
      mouseR = true;
    }
    e.preventDefault();
  };
  const onMouseUp = (e: MouseEvent): void => {
    if (e.button === 0) mouseL = false;
    else if (e.button === 2) mouseR = false;
  };
  const onWheel = (e: WheelEvent): void => {
    if (!enabled) return;
    setDevice('kbm');
    e.preventDefault();
    const step = wheel.push(e.deltaY, e.deltaMode, performance.now());
    if (step > 0) pend.next = true;
    else if (step < 0) pend.prev = true;
  };
  const onContext = (e: Event): void => e.preventDefault();

  const onLockChange = (): void => {
    const was = locked;
    locked = document.pointerLockElement === canvas;
    if (locked) {
      dragFallback = false;
      if (!enabled) {
        // a lock that resolved after input was cut (pause / cinematic): give the cursor back at once
        wantUnlock = true;
        document.exitPointerLock();
      }
    }
    if (was && !locked) {
      // the browser takes the pointer back on Esc: treat it as a pause request
      if (!wantUnlock) lastUserUnlockT = performance.now();
      if (!wantUnlock && enabled) pend.pause = true;
      wantUnlock = false;
    }
  };
  const onLockError = (): void => {
    // a refusal of a request made outside a user gesture proves nothing (browsers require one),
    // only a failed click-initiated request switches to drag-look
    // (also not right after an Esc exit: the browser refuses even a click then, and the next one works)
    if (lastLockFromGesture && performance.now() - lastUserUnlockT > RELOCK_COOLDOWN_MS + 200) dragFallback = true;
  };

  const onTouchStartGlobal = (): void => {
    // a raw touch anywhere also flips the device (the controls layer reports it itself)
  };
  const onPointerDown = (e: PointerEvent): void => {
    if (e.pointerType === 'touch' || e.pointerType === 'pen') {
      if (!touchSeen) {
        touchSeen = true;
        syncTouch();
      }
      setDevice('touch');
    }
  };

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);
  document.addEventListener('mouseout', onDocOut);
  document.documentElement.addEventListener('mouseleave', resetCursor);
  window.addEventListener('mousemove', onMouseMove);
  canvas.addEventListener('mousedown', onMouseDown);
  window.addEventListener('mouseup', onMouseUp);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('contextmenu', onContext);
  document.addEventListener('pointerlockchange', onLockChange);
  document.addEventListener('pointerlockerror', onLockError);
  window.addEventListener('pointerdown', onPointerDown, { capture: true, passive: true });
  void onTouchStartGlobal;

  // ── pointer lock ──────────────────────────────────────────────────────────
  function lockPointer(fromGesture = false): void {
    if (touchSeen && getDevice() === 'touch') return;
    if (document.pointerLockElement === canvas) return;
    lockAttempted = true;
    lastLockFromGesture = fromGesture;
    try {
      const r = (canvas as HTMLElement).requestPointerLock() as unknown;
      if (r && typeof (r as Promise<void>).catch === 'function') {
        (r as Promise<void>).catch(() => {
          if (fromGesture && performance.now() - lastUserUnlockT > RELOCK_COOLDOWN_MS + 200) dragFallback = true;
        });
      }
    } catch {
      if (fromGesture && performance.now() - lastUserUnlockT > RELOCK_COOLDOWN_MS + 200) dragFallback = true;
    }
  }
  function unlockPointer(): void {
    if (document.pointerLockElement === canvas) {
      wantUnlock = true;
      document.exitPointerLock();
    }
  }

  // ── gamepad ───────────────────────────────────────────────────────────────
  function activePad(): Gamepad | null {
    const list = typeof navigator.getGamepads === 'function' ? navigator.getGamepads() : null;
    if (!list) return null;
    // poll() assumes the standard layout: prefer a pad that reports it (wheels, pedals, flight sticks and
    // other odd HID devices report '' and may rest off-centre), else take the first connected pad
    let first: Gamepad | null = null;
    for (let i = 0; i < list.length; i++) {
      const g = list[i];
      if (!g || !g.connected) continue;
      if (g.mapping === 'standard') return g;
      if (!first) first = g;
    }
    return first;
  }

  // ── poll ──────────────────────────────────────────────────────────────────
  function zero(): void {
    const s = state;
    s.moveX = s.moveY = s.lookX = s.lookY = 0;
    s.aimHeld = s.drawHeld = s.drawReleased = false;
    s.melee = s.jump = s.dash = s.interact = s.nextArrow = s.pause = false;
    s.prevArrow = false;
    s.arrowSlot = 0;
    s.focusHeld = s.focusPressed = s.focusReleased = s.sprintHeld = false;
    prevDraw = prevFocus = false;
    pend.melee = pend.jump = pend.dash = pend.interact = pend.next = pend.prev = pend.pause = false;
    pend.slot = 0;
    drawLatch = focusLatch = false;
    mdx = mdy = 0;
    curValid = false;
    wheel.reset();
    touch.consumeLook(lookTmp);
    touch.st.drawTap = touch.st.focusTap = false;
    touch.st.melee = touch.st.jump = touch.st.dash = touch.st.interact = touch.st.next = touch.st.pause = false;
    // keep gamepad "previous" in sync so held buttons do not fire when re-enabled
    const g = activePad();
    if (g) for (let i = 0; i < 17; i++) padPrev[i] = !!g.buttons[i]?.pressed;
    padRT = padLT = false;
    padLookHold = 0;
  }

  function poll(): void {
    const now = performance.now();
    const dt = Math.min(0.1, Math.max(0.001, (now - lastT) / 1000));
    lastT = now;
    state.device = getDevice();
    // the parked cursor only means something on keyboard + mouse. The pointer stays unlocked for a pad or
    // touch player too, so a 1-2 px nudge or a synthetic mousemove leaves a position behind: forget it for as
    // long as another device is active, so it cannot turn the view now or resume when the mouse comes back
    if (state.device !== 'kbm') resetCursor();
    const hide = enabled && !(touchSeen && state.device === 'touch');
    if (hide !== cursorHidden) {
      cursorHidden = hide;
      canvas.style.cursor = hide ? 'none' : '';
    }
    if (!enabled) {
      zero();
      return;
    }
    const s = state;
    const ts = touch.st;

    // movement ----------------------------------------------------------------
    let mx = 0;
    let my = 0;
    for (const k of keys) {
      const v = KEY_MOVE[k];
      if (v) {
        mx += v[0];
        my += v[1];
      }
    }
    const kl = Math.hypot(mx, my);
    if (kl > 1) {
      mx /= kl;
      my /= kl;
    }
    let sprint = keys.has('ShiftLeft') || keys.has('ShiftRight');
    let lookX = 0;
    let lookY = 0;
    let aim = mouseR;
    let draw = mouseL;
    let focus = keys.has('KeyQ');
    let melee = pend.melee;
    let jump = pend.jump;
    let dash = pend.dash;
    let interact = pend.interact;
    let next = pend.next;
    const prevWheel = pend.prev;
    let pause = pend.pause;
    let slot = pend.slot;
    let drawTap = drawLatch;
    let focusTap = focusLatch;

    // mouse look
    if (mdx !== 0 || mdy !== 0) {
      lookX += mdx * MOUSE_RAD_PER_PX;
      lookY += -mdy * MOUSE_RAD_PER_PX;
      mdx = mdy = 0;
    }
    // edge turning: unlocked, cursor parked in the outer band of the canvas (keyboard + mouse only)
    if (!locked && curValid && state.device === 'kbm') {
      const r = canvas.getBoundingClientRect();
      const w = r.width;
      const h = r.height;
      if (w > 0 && h > 0) {
        const bx = Math.max(EDGE_BAND_MIN_PX, w * EDGE_BAND_FRAC);
        const by = Math.max(EDGE_BAND_MIN_PX, h * EDGE_BAND_FRAC);
        const px = curX - r.left;
        const py = curY - r.top;
        const dl = Math.min(1, Math.max(0, (bx - px) / bx));
        const dr = Math.min(1, Math.max(0, (px - (w - bx)) / bx));
        const dtp = Math.min(1, Math.max(0, (by - py) / by));
        const db = Math.min(1, Math.max(0, (py - (h - by)) / by));
        lookX += (dr - dl) * EDGE_YAW_RATE * dt;
        lookY += (dtp - db) * EDGE_PITCH_RATE * dt;
      }
    }

    // gamepad -----------------------------------------------------------------
    const g = activePad();
    if (g) {
      const b = g.buttons;
      const down = (i: number): boolean => !!b[i]?.pressed;
      const edge = (i: number): boolean => down(i) && !padPrev[i];
      const ax = g.axes;
      const m = radial(ax[0] ?? 0, ax[1] ?? 0, LS_DEAD, padOut);
      let activity = m > 0;
      mx += padOut[0];
      my += -padOut[1];
      if (m > 0) {
        // keep the pad stick from being capped by the keyboard clamp below
      }
      const rm = radial(ax[2] ?? 0, ax[3] ?? 0, RS_DEAD, padOut);
      if (rm > 0) {
        activity = true;
        padLookHold = rm > 0.85 ? Math.min(1, padLookHold + dt / 0.45) : Math.max(0, padLookHold - dt * 2.5);
        // response curve: fine control near the centre, acceleration while held at the edge
        const curve = rm * rm * (0.35 + 0.65 * rm) / Math.max(rm, 1e-4);
        const accel = 1 + 0.55 * padLookHold;
        const rate = PAD_LOOK_RATE * accel * curve * dt;
        lookX += padOut[0] * rate;
        lookY += -padOut[1] * rate;
      } else padLookHold = Math.max(0, padLookHold - dt * 4);

      const ltV = b[6]?.value ?? 0;
      const rtV = b[7]?.value ?? 0;
      padLT = ltV > (padLT ? 0.2 : 0.35) || (!!b[6]?.pressed && ltV === 0);
      padRT = rtV > (padRT ? 0.2 : 0.35) || (!!b[7]?.pressed && rtV === 0);
      if (padLT) aim = true;
      if (padRT) {
        if (!draw && !prevDraw) drawTap = true;
        draw = true;
      }
      if (down(4)) {
        focus = true;
        if (edge(4)) focusTap = true;
      }
      if (edge(0)) jump = true;
      if (edge(1)) dash = true;
      if (edge(2)) melee = true;
      if (edge(3)) interact = true;
      if (edge(5)) next = true;
      if (edge(9)) pause = true;
      if (edge(14)) slot = 1; // d-pad left / up / right
      if (edge(12)) slot = 2;
      if (edge(15)) slot = 3;
      if (edge(10)) padSprintLatch = !padSprintLatch;
      if (m < 0.1 && padSprintLatch && !down(10)) padSprintLatch = false;
      if (padSprintLatch) sprint = true;

      let any = activity || padRT || padLT;
      for (let i = 0; i < 17; i++) {
        const d = down(i);
        if (d && !padPrev[i] && i !== 6 && i !== 7) any = true;
        padPrev[i] = d;
      }
      if (any) setDevice('gamepad');
    } else {
      padSprintLatch = false;
    }

    // touch -------------------------------------------------------------------
    if (touchSeen && touchVisible) {
      if (ts.moveX !== 0 || ts.moveY !== 0) {
        mx += ts.moveX;
        my += ts.moveY;
      }
      if (ts.sprint) sprint = true;
      touch.consumeLook(lookTmp);
      if (lookTmp.x !== 0 || lookTmp.y !== 0) {
        lookX += lookTmp.x * TOUCH_RAD_PER_PX;
        lookY += -lookTmp.y * TOUCH_RAD_PER_PX;
      }
      if (ts.drawHeld) draw = true;
      if (ts.drawTap) drawTap = true;
      if (ts.aimOn) aim = true;
      if (ts.focusHeld) focus = true;
      if (ts.focusTap) focusTap = true;
      if (ts.melee) melee = true;
      if (ts.jump) jump = true;
      if (ts.dash) dash = true;
      if (ts.interact) interact = true;
      if (ts.next) next = true;
      if (ts.pause) pause = true;
      ts.melee = ts.jump = ts.dash = ts.interact = ts.next = ts.pause = false;
      ts.drawTap = ts.focusTap = false;
    }

    // merge movement (clamp to unit circle)
    const ml = Math.hypot(mx, my);
    if (ml > 1) {
      mx /= ml;
      my /= ml;
    }
    s.moveX = mx;
    s.moveY = my;
    s.sprintHeld = sprint && ml > 0.05;

    const sens = api.sensitivity;
    s.lookX = lookX * sens;
    s.lookY = lookY * sens * (api.invertY ? -1 : 1);

    s.aimHeld = aim;

    // draw / loose: a press+release inside one frame still lasts one frame
    if (!draw && drawTap) draw = true;
    s.drawHeld = draw;
    s.drawReleased = prevDraw && !draw;
    prevDraw = draw;

    if (!focus && focusTap) focus = true;
    s.focusHeld = focus;
    s.focusPressed = focus && !prevFocus;
    s.focusReleased = !focus && prevFocus;
    prevFocus = focus;

    s.melee = melee;
    s.jump = jump;
    s.dash = dash;
    s.interact = interact;
    s.nextArrow = next;
    s.prevArrow = prevWheel && !next;
    s.pause = pause;
    s.arrowSlot = slot as 0 | 1 | 2 | 3;
    s.device = getDevice();

    // consume latches
    pend.melee = pend.jump = pend.dash = pend.interact = pend.next = pend.prev = pend.pause = false;
    pend.slot = 0;
    drawLatch = false;
    focusLatch = false;
  }

  function rumble(strength: number, ms: number): void {
    const str = Math.max(0, Math.min(1, strength));
    if (str <= 0 || ms <= 0) return;
    const dev = getDevice();
    if (dev === 'gamepad' || dev === 'kbm') {
      const g = activePad();
      const act = g && (g as unknown as { vibrationActuator?: { playEffect?: (t: string, p: object) => Promise<unknown> } }).vibrationActuator;
      if (act && typeof act.playEffect === 'function') {
        act.playEffect('dual-rumble', { startDelay: 0, duration: ms, weakMagnitude: str * 0.7, strongMagnitude: str }).catch(() => {});
        return;
      }
    }
    if (dev === 'touch' && typeof navigator.vibrate === 'function') {
      try {
        navigator.vibrate(Math.min(ms, 120));
      } catch {
        /* ignore */
      }
    }
  }

  const api = {
    state,
    poll,
    get enabled() {
      return enabled;
    },
    set enabled(v: boolean) {
      if (v === enabled) return;
      enabled = v;
      if (!v) {
        zero();
        cursorHidden = false;
        canvas.style.cursor = '';
      } else {
        // fresh start: ignore buttons that are still held from before (the gamepad Start / A press
        // that resumed from a menu must not fire pause / jump on the first poll)
        prevDraw = prevFocus = false;
        mouseL = false;
        const g = activePad();
        if (g) for (let i = 0; i < 17; i++) padPrev[i] = !!g.buttons[i]?.pressed;
      }
      syncTouch();
    },
    sensitivity: 1,
    invertY: false,
    lockPointer: () => lockPointer(false),
    unlockPointer,
    get pointerLocked() {
      return locked;
    },
    /** true when pointer lock was refused after a click and mouse look falls back to drag-look */
    get pointerFallback() {
      return dragFallback;
    },
    get isTouch() {
      return touchSeen;
    },
    setTouchVisible(v: boolean) {
      touchVisible = v;
      syncTouch();
    },
    setInteractLabel(label: string | null) {
      touch.setInteractLabel(label);
    },
    rumble,
    dispose() {
      if (disposed) return;
      disposed = true;
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      document.removeEventListener('mouseout', onDocOut);
      document.documentElement.removeEventListener('mouseleave', resetCursor);
      canvas.style.cursor = '';
      window.removeEventListener('mousemove', onMouseMove);
      canvas.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mouseup', onMouseUp);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('contextmenu', onContext);
      document.removeEventListener('pointerlockchange', onLockChange);
      document.removeEventListener('pointerlockerror', onLockError);
      window.removeEventListener('pointerdown', onPointerDown, { capture: true });
      if (document.pointerLockElement === canvas) document.exitPointerLock();
      touch.dispose();
    },
  };
  void lockAttempted;
  return api as Input;
}
