import { assertEquals, assertStringIncludes } from "@std/assert";
import { buildReportHtml, type DiffRecord, escapeHtml } from "./report.ts";

function baseRecord(overrides: Partial<DiffRecord> = {}): DiffRecord {
  return {
    timestamp: "2026-08-05T00:00:00Z",
    label: "before-after",
    compared: { prior: "prior-base", fresh: "fresh-base" },
    pixelDiffRatio: 0.0123,
    newConsoleMessages: [],
    sceneObjectCountPrior: 6,
    sceneObjectCountFresh: 6,
    memory: null,
    perf: null,
    priorScreenshotBase64: "AAA=",
    freshScreenshotBase64: "BBB=",
    diffOverlayBase64: "CCC=",
    ...overrides,
  };
}

Deno.test("escapeHtml escapes all five special characters", () => {
  assertEquals(
    escapeHtml(`<script>alert("x") & 'y'</script>`),
    "&lt;script&gt;alert(&quot;x&quot;) &amp; &#39;y&#39;&lt;/script&gt;",
  );
});

Deno.test("escapeHtml leaves ordinary text untouched", () => {
  assertEquals(escapeHtml("shader compiled OK"), "shader compiled OK");
});

Deno.test("buildReportHtml embeds all three images as base64 data URIs", () => {
  const html = buildReportHtml(baseRecord());
  assertStringIncludes(html, "data:image/png;base64,AAA=");
  assertStringIncludes(html, "data:image/png;base64,BBB=");
  assertStringIncludes(html, "data:image/png;base64,CCC=");
});

Deno.test("buildReportHtml includes the pixel diff percentage", () => {
  const html = buildReportHtml(baseRecord({ pixelDiffRatio: 0.05 }));
  assertStringIncludes(html, "5.00% pixels changed");
});

Deno.test("buildReportHtml includes scene object counts", () => {
  const html = buildReportHtml(
    baseRecord({ sceneObjectCountPrior: 6, sceneObjectCountFresh: 9 }),
  );
  assertStringIncludes(html, "<td>6</td>");
  assertStringIncludes(html, "<td>9</td>");
});

Deno.test("buildReportHtml omits the memory section when memory is null", () => {
  const html = buildReportHtml(baseRecord({ memory: null }));
  assertEquals(html.includes("<h2>Memory</h2>"), false);
});

Deno.test("buildReportHtml renders the memory section with signed deltas when present", () => {
  const html = buildReportHtml(
    baseRecord({ memory: { geometriesDelta: 3, texturesDelta: -1 } }),
  );
  assertStringIncludes(html, "<h2>Memory</h2>");
  assertStringIncludes(html, "<td>+3</td>");
  assertStringIncludes(html, "<td>-1</td>");
});

Deno.test("buildReportHtml omits the perf section when perf is null", () => {
  const html = buildReportHtml(baseRecord({ perf: null }));
  assertEquals(html.includes("<h2>Perf</h2>"), false);
});

Deno.test("buildReportHtml renders the perf section with signed deltas when present", () => {
  const html = buildReportHtml(
    baseRecord({
      perf: {
        callsDelta: 12,
        trianglesDelta: -400,
        pointsDelta: 0,
        linesDelta: 2,
      },
    }),
  );
  assertStringIncludes(html, "<h2>Perf</h2>");
  assertStringIncludes(html, "<td>+12</td>");
  assertStringIncludes(html, "<td>-400</td>");
  assertStringIncludes(html, "<td>+0</td>");
  assertStringIncludes(html, "<td>+2</td>");
});

Deno.test("buildReportHtml shows a no-new-messages note when console diff is empty", () => {
  const html = buildReportHtml(baseRecord({ newConsoleMessages: [] }));
  assertStringIncludes(html, "No new console messages.");
});

Deno.test("buildReportHtml lists new console messages, HTML-escaped", () => {
  const html = buildReportHtml(
    baseRecord({ newConsoleMessages: ["[error] <texture> failed & broke"] }),
  );
  assertStringIncludes(html, "&lt;texture&gt; failed &amp; broke");
  assertEquals(html.includes("<texture> failed & broke"), false);
});

Deno.test("buildReportHtml escapes a label containing HTML-special characters", () => {
  const html = buildReportHtml(baseRecord({ label: `<b>"evil"</b>` }));
  assertStringIncludes(html, "&lt;b&gt;&quot;evil&quot;&lt;/b&gt;");
  assertEquals(html.includes(`<b>"evil"</b>`), false);
});
