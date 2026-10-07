// Requires the Playwright browser binaries to be installed once:
//   deno run -A npm:playwright install chromium
import { chromium } from "playwright";
import type { Page } from "playwright";
import type { RendererMemory } from "../../../lib/renderer-info.ts";
import { getRendererMemorySummary } from "../../../lib/renderer-info.ts";
import type { Scenario, Step } from "./types.ts";

export interface CaptureResult {
  shots: Record<string, Uint8Array>;
  // Read once, after all steps complete — a whole-scene cumulative
  // count, not something meaningfully captured per-keyframe. null when
  // window.__renderer__ isn't exposed (optional prerequisite, same as
  // checkpoint.ts's use of the same helper).
  memory: RendererMemory | null;
}

// Real touch-drag simulation for `dragOrbit` on a `scenario.device.hasTouch`
// scenario. Playwright's own `Touchscreen` class only exposes `.tap()` —
// no drag/swipe primitive — so a genuine touch drag needs CDP's
// `Input.dispatchTouchEvent` directly (touchStart -> interpolated
// touchMove(s) -> touchEnd). Chromium-only, matching every other script
// in this pipeline's existing Chromium-only assumption.
//
// Sends the same 10-step interpolation dragOrbit's mouse path uses, but
// don't expect all 10 to land as distinct DOM touchmove events — confirmed
// empirically (capture_test.ts, and independently at 20ms and 100ms
// inter-dispatch delays, ruling out a timing fix) that Chromium's input
// pipeline coalesces intermediate touchmove samples down to a handful,
// the same way real rapid touch input does. This doesn't affect
// correctness: the coalesced events always retained the correct
// cumulative position, and the final touchmove/touchend before the
// gesture ends always lands at exactly (cx+dx, cy+dy) — a camera-orbit
// handler accumulating delta-since-last-move still ends up in the
// correct final rotation regardless of how many intermediate samples the
// browser chose to deliver. Sending all 10 dispatches (rather than fewer)
// costs nothing and gives Chromium the most chances to deliver a smooth
// gesture on setups where it doesn't coalesce as aggressively.
async function touchDragOrbit(
  page: Page,
  cx: number,
  cy: number,
  dx: number,
  dy: number,
): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  const STEPS = 10;
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: cx, y: cy }],
  });
  for (let i = 1; i <= STEPS; i++) {
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: cx + (dx * i) / STEPS, y: cy + (dy * i) / STEPS }],
    });
  }
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
}

// Drives a scenario's step array against an already-navigated page.
// Extracted from captureScenario() (cycle 2's demo-recording work) so
// dev tooling that needs the exact same interaction-driving logic --
// but not captureScenario()'s own browser lifecycle, viewport setup, or
// {shots, memory} return shape -- can reuse it directly instead of
// re-deriving the step vocabulary a second time. captureScenario()
// itself is unchanged in behavior; this is a pure extraction.
export async function runSteps(
  page: Page,
  steps: Step[],
  hasTouch: boolean,
): Promise<Record<string, Uint8Array>> {
  const shots: Record<string, Uint8Array> = {};

  for (const step of steps) {
    switch (step.action) {
      case "wait":
        await page.waitForTimeout(step.ms);
        break;
      case "waitForSelector":
        await page.waitForSelector(step.selector);
        break;
      case "waitForFirstRender":
        // window.__renderer__ is the same exposure every other Parallax
        // command already depends on -- reusing it here rather than
        // inventing a separate readiness signal.
        await page.waitForFunction(
          () =>
            // deno-lint-ignore no-explicit-any
            (globalThis as any).__renderer__?.info?.render?.frame > 0,
        );
        break;
      case "click":
        // page.tap() requires hasTouch: true on the context (enforced by
        // Playwright itself) and dispatches a real touch tap internally
        // — no manual event construction needed for the simple case.
        if (hasTouch) {
          await page.tap(step.selector);
        } else {
          await page.click(step.selector);
        }
        break;
      case "dragOrbit": {
        const box = await (await page.$("canvas"))?.boundingBox();
        if (!box) throw new Error("no canvas found for dragOrbit");
        const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
        if (hasTouch) {
          await touchDragOrbit(page, cx, cy, step.dx, step.dy);
        } else {
          await page.mouse.move(cx, cy);
          await page.mouse.down();
          await page.mouse.move(cx + step.dx, cy + step.dy, { steps: 10 });
          await page.mouse.up();
        }
        break;
      }
      case "evaluate":
        await page.evaluate(step.script);
        break;
      case "keyframe":
        shots[step.name] = await page.screenshot();
        break;
    }
  }

  return shots;
}

export async function captureScenario(
  baseUrl: string,
  scenario: Scenario,
): Promise<CaptureResult> {
  // "memory" is reserved for the scenario-level memory check
  // (types.ts's Manifest.memory) — enforced here, not just documented,
  // so a scenario author who picks it for an unrelated pixel keyframe
  // gets a loud error instead of `visual:accept <scenario> memory`
  // silently resolving to the memory check and never touching their
  // keyframe's own pending-review entry.
  for (const step of scenario.steps) {
    if (step.action === "keyframe" && step.name === "memory") {
      throw new Error(
        `scenario "${scenario.name}": keyframe name "memory" is reserved ` +
          `for the scenario-level memory check — rename this keyframe.`,
      );
    }
  }

  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: scenario.device?.viewport ?? { width: 1280, height: 800 },
    isMobile: scenario.device?.isMobile,
    hasTouch: scenario.device?.hasTouch,
    deviceScaleFactor: scenario.device?.deviceScaleFactor,
  });
  const hasTouch = scenario.device?.hasTouch ?? false;

  await page.goto(new URL(scenario.path, baseUrl).toString());

  const shots = await runSteps(page, scenario.steps, hasTouch);

  const memory = await getRendererMemorySummary(page);
  await browser.close();
  return { shots, memory };
}
