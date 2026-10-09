/**
 * Loading helpers. create() builds a lot of geometry on the main thread while the loading screen is
 * up: yielding between the heavy steps lets the loading UI keep animating instead of freezing for the
 * whole build.
 */

/**
 * Gives the event loop a turn (a macrotask), so the browser can paint the loading screen and handle
 * input between two heavy build steps. Deliberately not requestAnimationFrame: under a slow renderer
 * a frame can take seconds, and the wait would be added to the load time. Loading only: game scripts
 * use level.wait.
 */
export function yieldFrame(): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, 0));
}

/** phase timings of create() (ms), readable as `window.__bgTimes` when the page runs with ?bgdebug=1 */
export function makeStamp(enabled: boolean): (name: string) => void {
  const times: Record<string, number> = {};
  let last = performance.now();
  if (enabled) (globalThis as unknown as { __bgTimes: unknown }).__bgTimes = times;
  return (name: string): void => {
    const now = performance.now();
    times[name] = Math.round(now - last);
    last = now;
  };
}
