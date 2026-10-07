// Lane 2 — real browser spin-up (headless Chromium via Playwright).
// Deno.serve() hosts the fixture in-process for the duration of the
// test, so this needs no separate server, no fixture files on disk for
// this one, and no network beyond localhost.
import { assertEquals, assertRejects } from "@std/assert";
import { captureScenario } from "./capture.ts";
import type { Scenario } from "./types.ts";

const FIXTURE_HTML = `<!doctype html>
<html><body>
<canvas id="c" width="200" height="200"></canvas>
<button id="btn" onclick="document.title = 'clicked'">Click me</button>
<div id="target">hello</div>
</body></html>`;

async function withFixtureServer<T>(
  fn: (baseUrl: string) => Promise<T>,
): Promise<T> {
  const server = Deno.serve(
    { port: 0, onListen: () => {} },
    () =>
      new Response(FIXTURE_HTML, { headers: { "content-type": "text/html" } }),
  );
  const port = (server.addr as Deno.NetAddr).port;
  try {
    return await fn(`http://localhost:${port}`);
  } finally {
    await server.shutdown();
  }
}

Deno.test("captureScenario drives waitForSelector, click, evaluate, and keyframe steps", async () => {
  await withFixtureServer(async (baseUrl) => {
    const scenario: Scenario = {
      name: "fixture-test",
      path: "/",
      steps: [
        { action: "waitForSelector", selector: "canvas" },
        { action: "keyframe", name: "initial" },
        { action: "click", selector: "#btn" },
        {
          action: "evaluate",
          script: "window.__clicked = document.title === 'clicked'",
        },
        { action: "keyframe", name: "after-click" },
      ],
    };

    const { shots } = await captureScenario(baseUrl, scenario);
    assertEquals(Object.keys(shots).sort(), ["after-click", "initial"]);
    assertEquals(shots.initial.length > 0, true);
    assertEquals(shots["after-click"].length > 0, true);
  });
});

Deno.test("captureScenario's wait step actually delays execution", async () => {
  await withFixtureServer(async (baseUrl) => {
    const scenario: Scenario = {
      name: "fixture-test",
      path: "/",
      steps: [
        { action: "wait", ms: 100 },
        { action: "keyframe", name: "after-wait" },
      ],
    };
    const start = performance.now();
    const { shots } = await captureScenario(baseUrl, scenario);
    const elapsed = performance.now() - start;
    assertEquals("after-wait" in shots, true);
    assertEquals(elapsed >= 100, true);
  });
});

Deno.test("captureScenario's waitForFirstRender step blocks until window.__renderer__ reports a real frame", async () => {
  // Simulates the exact gap this step exists to close: a scene whose
  // renderer only starts reporting rendered frames after some delay
  // (standing in for real-world CDN/asset load time), confirming the
  // step genuinely blocks on that condition rather than resolving
  // immediately regardless of it.
  const html = `<!doctype html>
<html><body>
<canvas id="c" width="200" height="200"></canvas>
<script>
  setTimeout(() => {
    window.__renderer__ = { info: { render: { frame: 1 } } };
  }, 150);
</script>
</body></html>`;
  const server = Deno.serve(
    { port: 0, onListen: () => {} },
    () => new Response(html, { headers: { "content-type": "text/html" } }),
  );
  const port = (server.addr as Deno.NetAddr).port;
  try {
    const scenario: Scenario = {
      name: "fixture-test",
      path: "/",
      steps: [
        { action: "waitForFirstRender" },
        { action: "keyframe", name: "after-render" },
      ],
    };
    const start = performance.now();
    const { shots } = await captureScenario(
      `http://localhost:${port}`,
      scenario,
    );
    const elapsed = performance.now() - start;
    assertEquals("after-render" in shots, true);
    // Genuinely blocked on the 150ms delay, not a coincidental pass —
    // page.waitForFunction() polls, so some slack above the raw delay
    // is expected and fine; what matters is it didn't return near-0ms.
    assertEquals(elapsed >= 150, true);
  } finally {
    await server.shutdown();
  }
});

Deno.test("captureScenario returns memory: null when window.__renderer__ isn't exposed", async () => {
  await withFixtureServer(async (baseUrl) => {
    const scenario: Scenario = {
      name: "fixture-test",
      path: "/",
      steps: [{ action: "keyframe", name: "shot" }],
    };
    const { memory } = await captureScenario(baseUrl, scenario);
    assertEquals(memory, null);
  });
});

Deno.test("captureScenario reads geometry/texture counts when window.__renderer__ is exposed", async () => {
  const html = `<!doctype html>
<html><body>
<canvas id="c" width="200" height="200"></canvas>
<script>
  window.__renderer__ = { info: { memory: { geometries: 3, textures: 2 } } };
</script>
</body></html>`;
  const server = Deno.serve(
    { port: 0, onListen: () => {} },
    () => new Response(html, { headers: { "content-type": "text/html" } }),
  );
  const port = (server.addr as Deno.NetAddr).port;
  try {
    const scenario: Scenario = {
      name: "fixture-test-with-renderer",
      path: "/",
      steps: [{ action: "keyframe", name: "shot" }],
    };
    const { memory } = await captureScenario(
      `http://localhost:${port}`,
      scenario,
    );
    assertEquals(memory, { geometries: 3, textures: 2 });
  } finally {
    await server.shutdown();
  }
});

Deno.test("captureScenario rejects a keyframe literally named 'memory'", async () => {
  const scenario: Scenario = {
    name: "fixture-test",
    path: "/",
    steps: [{ action: "keyframe", name: "memory" }],
  };
  // No fixture server needed — this is checked before navigation, so it
  // fails the same way regardless of what baseUrl points at.
  await assertRejects(
    () => captureScenario("http://localhost:1", scenario),
    Error,
    "reserved",
  );
});

// These three tests exploit getRendererMemorySummary's existing
// window.__renderer__.info.memory readback channel to smuggle real
// pass/fail signals out of the page — captureScenario() only returns
// {shots, memory}, so this is the one way to assert something actually
// fired inside the browser rather than just that a step didn't throw.
// Each fixture reports either a raw count (when one number is enough)
// or a boolean check computed in-page (1 = passed, 0 = failed, when the
// real condition needs more than the two available numeric fields can
// carry as raw values).

Deno.test("captureScenario's click step dispatches a real touch tap when scenario.device.hasTouch is set", async () => {
  const html = `<!doctype html>
<html><body>
<canvas id="c" width="200" height="200"></canvas>
<button id="btn" style="width:100px;height:40px">Click me</button>
<script>
  window.__touchstart = 0;
  window.__mousedown = 0;
  const btn = document.getElementById("btn");
  btn.addEventListener("touchstart", () => window.__touchstart++);
  btn.addEventListener("mousedown", () => window.__mousedown++);
</script>
</body></html>`;
  const server = Deno.serve(
    { port: 0, onListen: () => {} },
    () => new Response(html, { headers: { "content-type": "text/html" } }),
  );
  const port = (server.addr as Deno.NetAddr).port;
  try {
    const scenario: Scenario = {
      name: "touch-click",
      path: "/",
      device: {
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      },
      steps: [
        { action: "waitForSelector", selector: "#btn" },
        { action: "click", selector: "#btn" },
        {
          action: "evaluate",
          script: "window.__renderer__ = { info: { memory: { " +
            "geometries: window.__touchstart, textures: window.__mousedown } } }",
        },
        { action: "keyframe", name: "after-tap" },
      ],
    };
    const { memory } = await captureScenario(
      `http://localhost:${port}`,
      scenario,
    );
    // A real touch tap fired (touchstart). Confirmed empirically (not
    // assumed) that the browser also synthesizes a compatibility
    // mousedown afterward for an element that doesn't preventDefault on
    // touchstart — standard touch-to-mouse-event-synthesis behavior, not
    // a leftover mouse path in this implementation. Only asserting the
    // touch event actually happened, not that no mouse event ever
    // follows it.
    assertEquals(memory?.geometries, 1);
  } finally {
    await server.shutdown();
  }
});

Deno.test("captureScenario's dragOrbit step dispatches a real touch gesture landing at the correct final position when scenario.device.hasTouch is set", async () => {
  // Chromium's input pipeline coalesces intermediate touchmove samples
  // (confirmed empirically, see capture.ts's touchDragOrbit comment) —
  // asserting an exact intermediate move count would be asserting
  // browser-coalescing behavior, not this implementation's correctness.
  // What's actually guaranteed and worth testing: exactly one
  // touchstart, exactly one touchend, at least one touchmove landed
  // (real touch input happened, not a silent no-op), and the gesture's
  // final position matches the requested dx exactly.
  const html = `<!doctype html>
<html><body>
<canvas id="c" width="200" height="200" style="touch-action:none"></canvas>
<script>
  window.__touchstart = 0;
  window.__touchmove = 0;
  window.__touchend = 0;
  window.__startX = null;
  window.__endX = null;
  const canvas = document.getElementById("c");
  canvas.addEventListener("touchstart", (e) => {
    window.__touchstart++;
    window.__startX = e.touches[0].clientX;
  });
  canvas.addEventListener("touchmove", () => window.__touchmove++);
  canvas.addEventListener("touchend", (e) => {
    window.__touchend++;
    window.__endX = e.changedTouches[0].clientX;
  });
</script>
</body></html>`;
  const server = Deno.serve(
    { port: 0, onListen: () => {} },
    () => new Response(html, { headers: { "content-type": "text/html" } }),
  );
  const port = (server.addr as Deno.NetAddr).port;
  try {
    const dx = 50;
    const scenario: Scenario = {
      name: "touch-drag-orbit",
      path: "/",
      device: {
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      },
      steps: [
        { action: "waitForSelector", selector: "canvas" },
        { action: "dragOrbit", dx, dy: 0 },
        {
          action: "evaluate",
          script: "window.__renderer__ = { info: { memory: { " +
            "geometries: (window.__touchstart === 1 && window.__touchend === 1 " +
            "&& window.__touchmove >= 1) ? 1 : 0, " +
            `textures: (window.__endX - window.__startX === ${dx}) ? 1 : 0 } } }`,
        },
        { action: "keyframe", name: "after-drag" },
      ],
    };
    const { memory } = await captureScenario(
      `http://localhost:${port}`,
      scenario,
    );
    // { geometries: 1 } = exactly one touchstart/touchend, at least one
    // touchmove; { textures: 1 } = gesture ended exactly dx away from
    // where it started.
    assertEquals(memory, { geometries: 1, textures: 1 });
  } finally {
    await server.shutdown();
  }
});

Deno.test("captureScenario's dragOrbit step still uses mouse, not touch, when scenario.device is unset", async () => {
  const html = `<!doctype html>
<html><body>
<canvas id="c" width="200" height="200"></canvas>
<script>
  window.__mousedown = 0;
  window.__touchstart = 0;
  const canvas = document.getElementById("c");
  canvas.addEventListener("mousedown", () => window.__mousedown++);
  canvas.addEventListener("touchstart", () => window.__touchstart++);
</script>
</body></html>`;
  const server = Deno.serve(
    { port: 0, onListen: () => {} },
    () => new Response(html, { headers: { "content-type": "text/html" } }),
  );
  const port = (server.addr as Deno.NetAddr).port;
  try {
    const scenario: Scenario = {
      name: "desktop-drag-orbit",
      path: "/",
      steps: [
        { action: "waitForSelector", selector: "canvas" },
        { action: "dragOrbit", dx: 50, dy: 0 },
        {
          action: "evaluate",
          script: "window.__renderer__ = { info: { memory: { " +
            "geometries: window.__mousedown, textures: window.__touchstart } } }",
        },
        { action: "keyframe", name: "after-drag" },
      ],
    };
    const { memory } = await captureScenario(
      `http://localhost:${port}`,
      scenario,
    );
    // Existing behavior unchanged: mouse fired, touch didn't, for a
    // scenario with no device field — exactly as before this unit.
    assertEquals(memory, { geometries: 1, textures: 0 });
  } finally {
    await server.shutdown();
  }
});

Deno.test("captureScenario's dragOrbit step throws a clear error when no canvas exists", async () => {
  const server = Deno.serve(
    { port: 0, onListen: () => {} },
    () =>
      new Response("<!doctype html><html><body>no canvas here</body></html>", {
        headers: { "content-type": "text/html" },
      }),
  );
  const port = (server.addr as Deno.NetAddr).port;
  try {
    const scenario: Scenario = {
      name: "no-canvas",
      path: "/",
      steps: [{ action: "dragOrbit", dx: 10, dy: 10 }],
    };
    await assertRejects(
      () => captureScenario(`http://localhost:${port}`, scenario),
      Error,
      "no canvas found for dragOrbit",
    );
  } finally {
    await server.shutdown();
  }
});
