/**
 * Game clocks and time scale (owner: shell).
 *
 * - `scale` eases toward the target set by `setScale` (Focus slow-motion, cinematics).
 * - `hitStop(sec)` freezes GAME time for a few real milliseconds (impact feel). Real time keeps flowing.
 * - `t` is game time since the chapter started, `real` is real time since boot.
 *
 * The game loop calls `step(dtReal)` once per frame and simulates the returned GAME dt.
 */
import type { TimeControl } from '../core/types';

export interface TimeControlExt extends TimeControl {
  /** advance the clocks by one real frame; returns the game dt (0 while frozen or paused) */
  step(dtReal: number): number;
  /** zero the chapter clock `t` and cancel any slow-motion / hit-stop (new chapter) */
  resetGame(): void;
  /** target scale currently being eased toward */
  readonly target: number;
  /** true while a hit-stop freeze is active */
  readonly frozen: boolean;
}

/** longest hit-stop honoured (real seconds), so a bad caller can never freeze the game */
const MAX_HIT_STOP = 0.25;
/** largest real frame we simulate (tab switches, breakpoints) */
export const MAX_FRAME = 0.1;

export function createTime(): TimeControlExt {
  let scale = 1;
  let target = 1;
  let rate = Infinity;
  let stop = 0;
  let t = 0;
  let real = 0;

  return {
    get scale() {
      return scale;
    },
    get target() {
      return target;
    },
    get t() {
      return t;
    },
    get real() {
      return real;
    },
    get frozen() {
      return stop > 0;
    },
    setScale(tg, easeSec = 0.3) {
      target = Math.max(0, Math.min(4, tg));
      if (easeSec <= 0) {
        scale = target;
        rate = Infinity;
      } else rate = Math.abs(target - scale) / easeSec;
    },
    hitStop(sec) {
      if (sec > 0) stop = Math.max(stop, Math.min(MAX_HIT_STOP, sec));
    },
    step(dtReal) {
      const dr = Math.max(0, Math.min(MAX_FRAME, dtReal));
      real += dr;
      const d = target - scale;
      if (d !== 0) {
        const m = rate * dr;
        scale = Math.abs(d) <= m ? target : scale + Math.sign(d) * m;
      }
      if (stop > 0) {
        stop -= dr;
        return 0;
      }
      const dt = dr * scale;
      t += dt;
      return dt;
    },
    resetGame() {
      t = 0;
      stop = 0;
      scale = 1;
      target = 1;
      rate = Infinity;
    },
  };
}
