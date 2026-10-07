// Lane 2 — real browser spin-up (headless Chromium via Playwright).
// Direct coverage for renderer-info.ts's two exported functions — they
// previously had no dedicated test file of their own: getRendererMemorySummary
// (Unit 1) was only covered indirectly through capture_test.ts's tests of
// captureScenario, and getRendererPerfSummary (Unit 2) has no natural home
// there at all, since Unit 2 doesn't touch capture.ts's behavior.
import { assertEquals } from "@std/assert";
import { chromium, type Page } from "playwright";
import {
  getRendererMemorySummary,
  getRendererPerfSummary,
} from "./renderer-info.ts";

async function withPage<T>(
  html: string,
  fn: (page: Page) => Promise<T>,
): Promise<T> {
  const server = Deno.serve(
    { port: 0, onListen: () => {} },
    () => new Response(html, { headers: { "content-type": "text/html" } }),
  );
  const port = (server.addr as Deno.NetAddr).port;
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(`http://localhost:${port}`);
    return await fn(page);
  } finally {
    await browser.close();
    await server.shutdown();
  }
}

const NO_RENDERER_HTML =
  `<!doctype html><html><body>no renderer here</body></html>`;

// Includes `frame` in `render` — real WebGLRenderer.info.render always
// does, even though RendererPerf deliberately omits it (see
// renderer-info.ts). The point of including it here is to prove
// getRendererPerfSummary actually excludes it from what it returns,
// rather than the test only ever exercising an idealized shape that
// happens to already match RendererPerf exactly.
const RENDERER_HTML = `<!doctype html>
<html><body>
<script>
  window.__renderer__ = {
    info: {
      memory: { geometries: 6, textures: 10 },
      render: { calls: 42, triangles: 1200, points: 0, lines: 3, frame: 9001 },
    },
  };
</script>
</body></html>`;

Deno.test("getRendererMemorySummary returns null when window.__renderer__ isn't exposed", async () => {
  await withPage(NO_RENDERER_HTML, async (page) => {
    assertEquals(await getRendererMemorySummary(page), null);
  });
});

Deno.test("getRendererMemorySummary reads geometries/textures when exposed", async () => {
  await withPage(RENDERER_HTML, async (page) => {
    assertEquals(await getRendererMemorySummary(page), {
      geometries: 6,
      textures: 10,
    });
  });
});

Deno.test("getRendererPerfSummary returns null when window.__renderer__ isn't exposed", async () => {
  await withPage(NO_RENDERER_HTML, async (page) => {
    assertEquals(await getRendererPerfSummary(page), null);
  });
});

Deno.test("getRendererPerfSummary reads calls/triangles/points/lines when exposed", async () => {
  await withPage(RENDERER_HTML, async (page) => {
    assertEquals(await getRendererPerfSummary(page), {
      calls: 42,
      triangles: 1200,
      points: 0,
      lines: 3,
    });
  });
});
