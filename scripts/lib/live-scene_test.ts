// Lane 2 — needs a real (headless, throwaway) browser spin-up, so this
// runs in the deferred extended-tests workflow, not on every PR.
//
// getSceneSummary/getProperty/setProperty only need a Page object — they
// don't care whether it came from connectOverCDP or a plain launch, so
// they're tested here against a normally-launched page pointed at the
// fixture. attachToLiveScene() itself (the CDP-connection mechanics) is
// tested separately below, since that's the part actually specific to
// "attach to an existing session."
import { assertEquals, assertRejects } from "@std/assert";
import { chromium } from "playwright";
import {
  attachToLiveScene,
  collectConsoleMessages,
  getProperty,
  getSceneSummary,
  isCdpReachable,
  setProperty,
  spawnAndAwaitReady,
} from "./live-scene.ts";

const FIXTURE_PATH =
  new URL("./fixtures/fake-scene.html", import.meta.url).pathname;

Deno.test("getSceneSummary reads objects from window.scene via traverse()", async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(`file://${FIXTURE_PATH}`);

  const summary = await getSceneSummary(page);
  const names = summary.map((o) => o.name);
  assertEquals(names.includes("TestLight"), true);
  assertEquals(names.includes("TestMesh"), true);

  const mesh = summary.find((o) => o.name === "TestMesh")!;
  assertEquals(mesh.materialType, "MeshStandardMaterial");

  await browser.close();
});

Deno.test("getProperty resolves a dotted path via getObjectByName", async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(`file://${FIXTURE_PATH}`);

  const intensity = await getProperty(page, "TestLight", "intensity");
  assertEquals(intensity, 0.5);

  const x = await getProperty(page, "TestMesh", "position.x");
  assertEquals(x, 0);

  await browser.close();
});

Deno.test("getProperty throws a clear error for an object that doesn't exist", async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(`file://${FIXTURE_PATH}`);

  await assertRejects(
    () => getProperty(page, "DoesNotExist", "x"),
    Error,
    "No object named",
  );

  await browser.close();
});

Deno.test("setProperty actually mutates the object, readable back via getProperty", async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(`file://${FIXTURE_PATH}`);

  await setProperty(page, "TestLight", "intensity", 2.0);
  assertEquals(await getProperty(page, "TestLight", "intensity"), 2.0);

  await browser.close();
});

Deno.test("collectConsoleMessages captures messages emitted after attachment", async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const messages = collectConsoleMessages(page);

  await page.goto(`file://${FIXTURE_PATH}`);
  await page.evaluate(() => console.log("hello from fixture"));
  await page.waitForTimeout(50); // let the console event actually fire

  assertEquals(messages.some((m) => m.includes("hello from fixture")), true);

  await browser.close();
});

// isCdpReachable's real job is distinguishing a genuine CDP endpoint from
// a non-CDP server that happens to answer 200 on the same path — exactly
// what threejs-devtools-mcp's bridge does (it proxies /json/version
// straight through to the dev server instead of erroring). Tested
// directly against plain HTTP servers rather than through
// attachToLiveScene(), since routing this case through the full function
// would mean the fake server and the fallback Chromium launch fighting
// over the same port.
Deno.test("isCdpReachable rejects a non-CDP server answering 200 on /json/version", async () => {
  const port = 19230;
  const server = Deno.serve(
    { port, onListen: () => {} },
    () =>
      new Response("<html>not CDP, e.g. a proxied dev server page</html>", {
        status: 200,
      }),
  );
  try {
    assertEquals(await isCdpReachable(String(port)), false);
  } finally {
    await server.shutdown();
  }
});

Deno.test("isCdpReachable accepts a real CDP version manifest", async () => {
  const port = 19231;
  const server = Deno.serve(
    { port, onListen: () => {} },
    () =>
      Response.json({
        Browser: "fake/1.0",
        webSocketDebuggerUrl: `ws://localhost:${port}/devtools/browser/fake`,
      }),
  );
  try {
    assertEquals(await isCdpReachable(String(port)), true);
  } finally {
    await server.shutdown();
  }
});

Deno.test("isCdpReachable returns false when nothing is listening", async () => {
  assertEquals(await isCdpReachable("19232"), false);
});

// launchPersistentChromium's sandbox-failure retry (real-world trigger:
// GitHub Actions' ubuntu-latest runners restrict unprivileged user
// namespaces, so Chrome's own sandbox can't start at all — confirmed via
// an actual Extended Tests run, not hypothetical) depends entirely on
// spawnAndAwaitReady correctly reporting an early exit plus its stderr.
// That's exercised directly here against a fake "executable" — the
// currently-running `deno` binary itself, invoked with Chrome-shaped
// flags it doesn't understand — rather than a POSIX shell script, which
// doesn't run on Windows at all (no shebang interpretation, no exec
// bit). Deno.execPath() is guaranteed present and directly executable on
// every platform Deno itself runs on, and reliably fails fast with a
// nonzero exit and a real stderr message on an unrecognized flag —
// exactly the "process died immediately, capture why" shape this is
// testing, without depending on any specific error text (which would
// tie this to deno's own CLI wording, not what's actually under test).
Deno.test("spawnAndAwaitReady reports the exit code and stderr when the process dies immediately", async () => {
  const port = "19233";
  const tempDir = await Deno.makeTempDir();

  try {
    const result = await spawnAndAwaitReady(
      Deno.execPath(),
      port,
      "1",
      tempDir,
      false,
      [],
    );
    assertEquals(result.outcome, "exited");
    if (result.outcome === "exited") {
      assertEquals(result.code !== 0, true);
      assertEquals(result.stderrText.trim() !== "", true);
    }
  } finally {
    await Deno.remove(tempDir, { recursive: true }).catch(() => {});
  }
});

Deno.test("attachToLiveScene connects to a real running browser and returns its page", async () => {
  const port = 19222; // fixed test port, distinct from the real 9223 default
  const browser = await chromium.launch({
    args: [`--remote-debugging-port=${port}`],
  });
  const page = await browser.newPage();
  await page.goto(`file://${FIXTURE_PATH}`);

  Deno.env.set("BRIDGE_PORT", String(port));
  const attached = await attachToLiveScene();
  assertEquals(attached.page.url(), `file://${FIXTURE_PATH}`);

  await attached.browser.close();
  Deno.env.delete("BRIDGE_PORT");
});

Deno.test("attachToLiveScene launches its own persistent Chromium when nothing is listening on the port (UAT finding #9)", async () => {
  const port = 19224; // fixed test port, nothing running here beforehand
  const tempCwd = await Deno.makeTempDir();
  const originalCwd = Deno.cwd();

  Deno.env.set("BRIDGE_PORT", String(port));
  Deno.env.set("DEV_PORT", "1"); // nothing needs to actually be there for this test
  // This test is verifying the launch *mechanism* (port detection, spawn,
  // CDP attach, reuse), not visual rendering, so it shouldn't depend on
  // the environment actually having a display — CI runners (confirmed via
  // an actual Extended Tests run) don't. Real end users still get headed
  // by default; this only affects this test's own invocation.
  Deno.env.set("PARALLAX_HEADLESS", "true");
  Deno.chdir(tempCwd);

  try {
    const attached = await attachToLiveScene();
    // It's a real, separate Chromium process launched on demand, not
    // something the test set up itself — confirms the auto-launch path,
    // not just a lucky connection to a pre-existing browser.
    assertEquals(typeof attached.page, "object");

    // A second call within the same "session" should reuse the same
    // browser rather than launching a duplicate on the now-occupied port.
    const reattached = await attachToLiveScene();
    assertEquals(reattached.page.url(), attached.page.url());
    await reattached.browser.close();
  } finally {
    // Production code deliberately never exposes a way to kill the
    // persistent browser it launches (callers must never do that to a
    // shared window) — so the test reaches for the CDP protocol directly
    // to clean up whatever it caused to exist at this port, rather than
    // leaking a stray Chromium after `deno test` exits. Reconnects fresh
    // here (not reusing a browser handle from the try block above)
    // specifically so this still cleans up correctly if attachToLiveScene()
    // itself threw partway through — e.g. after successfully launching
    // Chrome but before the function returned — not just on the happy path.
    try {
      const cleanupBrowser = await chromium.connectOverCDP(
        `http://localhost:${port}`,
      );
      const session = await cleanupBrowser.newBrowserCDPSession();
      await session.send("Browser.close").catch(() => {});
    } catch {
      // Nothing was listening at the port — nothing to clean up.
    }
    Deno.chdir(originalCwd);
    await Deno.remove(tempCwd, { recursive: true }).catch(() => {});
    Deno.env.delete("BRIDGE_PORT");
    Deno.env.delete("DEV_PORT");
    Deno.env.delete("PARALLAX_HEADLESS");
  }
});
