// Owns a persistent, dedicated Chromium tab for Parallax's interactive
// commands (checkpoint/sweep/replay/diff-checkpoints) — launched once,
// left running across invocations, and reused by every subsequent call.
// That persistence *is* the "shared sight" this plugin is built around:
// the human watches this one window; every command drives the same tab
// instead of a fresh, isolated browser per invocation.
//
// Why this isn't "attach to whatever tab is already open" (UAT finding
// #9 — the original design, confirmed broken two independent ways):
//   - threejs-devtools-mcp's bridge proxy (BRIDGE_PORT, historically also
//     defaulted to 9222) is a custom WebSocket bridge for its own MCP
//     tools, not a CDP endpoint — curling its /json/version proxies
//     straight through to the dev server and returns ordinary page HTML,
//     not a CDP version manifest.
//   - In its default (non-Puppeteer) mode, threejs-devtools-mcp opens the
//     browser via a plain OS `open`/`xdg-open` call — no debug port of
//     any kind. chrome-devtools-mcp launches its own Chrome via
//     --remote-debugging-pipe — a stdio pipe, not a TCP port either.
//     Neither is reachable via connectOverCDP, regardless of port number.
// Parallax's own BRIDGE_PORT now defaults to 9223, not 9222 — deliberately
// distinct from threejs-devtools-mcp's bridge default so the two can run
// at the same time without one refusing to bind the other's port.
//
// Other real prerequisites — this does not work unconditionally:
//   - The page must expose `window.scene` pointing at the live THREE.Scene.
//     This is a widely-used three.js debugging convention (several
//     existing three.js devtools extensions document this same
//     expectation) — not something invented here, but also not automatic.
//     If your prototype doesn't do `window.scene = scene` somewhere, the
//     object-resolution functions below have nothing to resolve against.
//   - Object lookup is by `.name` via `scene.getObjectByName()` — a real,
//     documented Object3D method — so objects you want to script against
//     need a `.name` set. This is the same "name your objects" convention
//     threejs-devtools-mcp's own README already recommends.
//
// Headed by default so a human can actually watch it — that's the point.
// Set PARALLAX_HEADLESS=true to run headless instead (CI, no display).
//
// Console capture limitation: a listener attached here only sees messages
// emitted AFTER attachment — no historical scrollback. For full console
// history, chrome-devtools-mcp's own console tool remains the more
// complete source; treat this as a lightweight supplement, not a
// replacement.

import { chromium, type Page } from "playwright";

const DEFAULT_BRIDGE_PORT = "9223";
const DEFAULT_DEV_PORT = "3000";

// Exported for direct unit testing of the collision guard below — the
// real-world case this exists for (threejs-devtools-mcp's bridge, or any
// other non-CDP server, answering 200 on this exact path) can't be
// exercised through attachToLiveScene() itself without also fighting
// over the same port for the fallback launch, so it's tested in
// isolation instead.
export async function isCdpReachable(port: string): Promise<boolean> {
  try {
    // Bounded per-request, not just the caller's overall retry budget —
    // a connection that hangs instead of failing outright would otherwise
    // make waitForCdpReady's own timeout meaningless.
    const res = await fetch(`http://localhost:${port}/json/version`, {
      signal: AbortSignal.timeout(1000),
    });
    if (!res.ok) return false;
    // Guard against a non-CDP HTTP server answering 200 on this path too
    // (e.g. an SPA dev server's catch-all route, or threejs-devtools-mcp's
    // bridge proxying the request straight through) — only trust it if
    // the body actually looks like a CDP version manifest.
    const body = await res.json().catch(() => null);
    return typeof body?.webSocketDebuggerUrl === "string";
  } catch {
    return false;
  }
}

// 30s, not 15s — observed real Chromium cold-start variance under load
// during testing (one run took 6s, well above the typical ~1s), and this
// plugin's named deployment target (Raspberry Pi) is slower than a dev
// machine. The crash-detection race above means a genuine early failure
// still surfaces fast regardless of this ceiling — this only affects how
// long a slow-but-healthy startup gets before being treated as stuck.
async function waitForCdpReady(port: string, timeoutMs = 30000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await isCdpReachable(port)) return;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(
    `Timed out after ${timeoutMs}ms waiting for Parallax's Chromium to ` +
      `open a CDP port at :${port}. Check for a stray Chrome process ` +
      `already holding that port, or set BRIDGE_PORT to an unused one.`,
  );
}

// Empirically captured from Playwright's own chromium.launch() (inspected
// the resulting process's actual command line) rather than guessed —
// launching the raw binary directly means Playwright's substantial
// internal default-args list is skipped unless reproduced here. Excludes
// anything headless-only, security-relevant (e.g. --no-sandbox), or that
// would hide the window (e.g. --no-startup-window) — those stay Chrome's
// own OS-appropriate default since this tab is meant to be headed and
// visible. --disable-dev-shm-usage is the single biggest win of this
// list on constrained/containerized targets (Raspberry Pi, Docker):
// Chrome's default /dev/shm size assumption crashes it otherwise.
const STABILITY_ARGS = [
  "--disable-field-trial-config",
  "--disable-background-networking",
  "--disable-background-timer-throttling",
  "--disable-backgrounding-occluded-windows",
  "--disable-back-forward-cache",
  "--disable-breakpad",
  "--disable-client-side-phishing-detection",
  "--disable-component-extensions-with-background-pages",
  "--disable-component-update",
  "--disable-default-apps",
  "--disable-dev-shm-usage",
  "--disable-extensions",
  "--disable-hang-monitor",
  "--disable-ipc-flooding-protection",
  "--disable-popup-blocking",
  "--disable-prompt-on-repost",
  "--disable-renderer-backgrounding",
  "--disable-updater-scheduler",
  "--force-color-profile=srgb",
  "--metrics-recording-only",
  "--password-store=basic",
  "--use-mock-keychain",
  "--no-service-autorun",
  "--disable-search-engine-choice-screen",
  "--disable-infobars",
  "--disable-sync",
];

// Longer than waitForCdpReady's own 30s budget — if a lock is still
// there after this long, whatever created it plausibly crashed instead
// of finishing, so it's treated as stale rather than blocked on forever.
const LOCK_STALE_MS = 45000;

// Guards against two interactive commands invoked in close succession
// both observing isCdpReachable() === false and both trying to spawn
// Chrome onto the same port/profile dir. A real, atomic, cross-process
// mutex — Deno processes don't share memory, so this has to be a
// filesystem lock, not an in-process one.
async function acquireLaunchLock(lockPath: string): Promise<boolean> {
  try {
    const file = await Deno.open(lockPath, { createNew: true, write: true });
    file.close();
    return true;
  } catch (err) {
    if (!(err instanceof Deno.errors.AlreadyExists)) throw err;
  }
  try {
    const info = await Deno.stat(lockPath);
    if (info.mtime && Date.now() - info.mtime.getTime() > LOCK_STALE_MS) {
      await Deno.remove(lockPath).catch(() => {});
      return await acquireLaunchLock(lockPath);
    }
  } catch {
    // Lock disappeared between our check and now — fine, treat as not ours.
  }
  return false;
}

// Spawned as a raw OS process (not via chromium.launch()) and explicitly
// detached — Playwright's own launch() keeps a handle open that blocks
// the calling Deno process from exiting, and kills the browser on that
// exit, which would defeat the whole point of a persistent shared tab.
async function launchPersistentChromium(
  port: string,
  devPort: string,
): Promise<void> {
  const executablePath = chromium.executablePath();
  try {
    await Deno.stat(executablePath);
  } catch {
    throw new Error(
      `Playwright's Chromium isn't installed (expected at ` +
        `${executablePath}). Run \`deno run -A npm:playwright install ` +
        `chromium\` once, then retry.`,
    );
  }

  const parallaxDir = `${Deno.cwd()}/.parallax`;
  await Deno.mkdir(parallaxDir, { recursive: true });
  const lockPath = `${parallaxDir}/chrome-launch.lock`;

  if (!(await acquireLaunchLock(lockPath))) {
    // Someone else is already launching — wait for them rather than
    // racing a second Chrome onto the same port/profile dir.
    await waitForCdpReady(port);
    return;
  }

  try {
    // Re-check now that the lock is ours: another invocation may have
    // finished launching between attachToLiveScene()'s first check and
    // this one.
    if (await isCdpReachable(port)) return;

    const userDataDir = `${Deno.cwd()}/.parallax/chrome-profile`;
    const headless = Deno.env.get("PARALLAX_HEADLESS") === "true";

    let result = await spawnAndAwaitReady(
      executablePath,
      port,
      devPort,
      userDataDir,
      headless,
      [],
    );

    // Sandboxed containers without unprivileged user namespaces (GitHub
    // Actions' ubuntu-latest runners, many Docker setups, some locked-down
    // Pi configs) can't start Chrome's own sandbox at all — confirmed by
    // matching the exact failure Chrome itself reports, not guessed.
    // Retrying once with --no-sandbox (Chrome's own crash message suggests
    // this exact workaround) is acceptable here specifically because this
    // browser only ever loads the user's own local dev server — trusted
    // first-party content, not arbitrary web pages — a materially smaller
    // threat model than a general-purpose browser, so it isn't the default,
    // only a fallback for environments that have already proven they need it.
    if (
      result.outcome === "exited" && /No usable sandbox/.test(result.stderrText)
    ) {
      result = await spawnAndAwaitReady(
        executablePath,
        port,
        devPort,
        userDataDir,
        headless,
        ["--no-sandbox"],
      );
    }

    if (result.outcome === "exited") {
      throw new Error(
        `Parallax's Chromium exited immediately (code ${result.code}) ` +
          `instead of opening a CDP port at :${port}.` +
          (result.stderrText.trim()
            ? ` stderr: ${result.stderrText.trim()}`
            : ""),
      );
    }
  } finally {
    await Deno.remove(lockPath).catch(() => {});
  }
}

type SpawnResult =
  | { outcome: "ready" }
  | { outcome: "exited"; code: number; stderrText: string };

// Exported for direct unit testing of the sandbox-failure retry mechanism
// in launchPersistentChromium — same reasoning as isCdpReachable above:
// the real case (a genuinely sandbox-restricted environment) isn't
// reproducible in every test environment, but the mechanism itself
// (spawn, detect exit vs. ready, report stderr) is testable directly
// against a fake executable.
export async function spawnAndAwaitReady(
  executablePath: string,
  port: string,
  devPort: string,
  userDataDir: string,
  headless: boolean,
  extraArgs: string[],
): Promise<SpawnResult> {
  const command = new Deno.Command(executablePath, {
    args: [
      `--remote-debugging-port=${port}`,
      ...(headless ? ["--headless=new"] : []),
      ...STABILITY_ARGS,
      ...extraArgs,
      "--no-first-run",
      "--no-default-browser-check",
      `--user-data-dir=${userDataDir}`,
      `http://localhost:${devPort}`,
    ],
    stdin: "null",
    stdout: "null",
    // Piped, not "null" — read to diagnose an early crash (missing shared
    // libs, sandbox failure, no display with PARALLAX_HEADLESS unset,
    // etc.), which is otherwise invisible: the caller just burns the full
    // waitForCdpReady timeout with no indication anything died. Verified
    // separately that a piped-then-canceled stderr doesn't harm this
    // process once it's confirmed healthy and detached (child.unref()
    // below) — only the "exited" branch actually reads it to completion,
    // which is safe precisely because the process is already gone by then.
    stderr: "piped",
  });
  const child = command.spawn();
  child.unref();

  const exited = child.status.then((status) => ({
    outcome: "exited" as const,
    status,
  }));
  const ready = waitForCdpReady(port).then(() => ({
    outcome: "ready" as const,
  }));
  const result = await Promise.race([ready, exited]);

  if (result.outcome === "exited") {
    const stderrText = await new Response(child.stderr).text().catch(() => "");
    return { outcome: "exited", code: result.status.code, stderrText };
  }

  // Still running — stop holding the pipe open rather than leaving it
  // dangling for a process meant to outlive this script.
  await child.stderr.cancel().catch(() => {});
  return { outcome: "ready" };
}

export async function attachToLiveScene(): Promise<
  { browser: Awaited<ReturnType<typeof chromium.connectOverCDP>>; page: Page }
> {
  // Read per-call, not at module scope — this must reflect the env vars
  // at call time (tests set them right before calling), not whatever they
  // were when this module first loaded.
  const bridgePort = Deno.env.get("BRIDGE_PORT") ?? DEFAULT_BRIDGE_PORT;
  const devPort = Deno.env.get("DEV_PORT") ?? DEFAULT_DEV_PORT;

  if (!(await isCdpReachable(bridgePort))) {
    await launchPersistentChromium(bridgePort, devPort);
  }

  const browser = await chromium.connectOverCDP(
    `http://localhost:${bridgePort}`,
  );
  const contexts = browser.contexts();
  if (contexts.length === 0) {
    throw new Error(
      `No browser context found at :${bridgePort} even after launching ` +
        `Parallax's own Chromium there — this shouldn't happen; please ` +
        `report it.`,
    );
  }
  const pages = contexts[0].pages();
  if (pages.length === 0) {
    throw new Error(`Browser is open at :${bridgePort} but has no pages.`);
  }
  // Assumes the first page is the one being debugged. If multiple tabs are
  // open this could attach to the wrong one — worth adding a URL filter if
  // that becomes a real problem in practice, not assumed away here.
  const page = pages[0];

  // CDP-reachable only means Chrome's debugger port is open — it says
  // nothing about whether the page it launched (module scripts fetching
  // three.js from a CDN, then running the prototype's own setup code)
  // has actually finished running yet. Without this wait, a cold launch
  // can return a page whose `window.scene` assignment hasn't executed
  // yet, making the very first command after a fresh launch fail with
  // "window.scene is not defined" even on a correctly wired-up
  // prototype — confirmed via a real UAT run against
  // examples/teapot-demo/ (first checkpoint after a cold launch failed;
  // the immediate retry succeeded once the page had finished loading).
  // A no-op if the page already finished loading (the common case: an
  // already-running, reused Chromium).
  await page.waitForLoadState("load");

  return { browser, page };
}

// Minimal shape of a three.js Object3D as seen from the browser side —
// just the fields getSceneSummary actually reads. Not the real THREE
// types since this callback is serialized and run in-page, without
// three.js's own type declarations available to Deno's checker.
interface Object3DLike {
  name: string;
  type: string;
  position?: { x: number; y: number; z: number };
  visible: boolean;
  material?: { type: string };
  traverse(callback: (obj: Object3DLike) => void): void;
  getObjectByName(name: string): Object3DLike | undefined;
  [key: string]: unknown;
}

export async function getSceneSummary(page: Page) {
  return await page.evaluate(() => {
    // @ts-ignore - browser global
    const scene = globalThis.scene as Object3DLike | undefined;
    if (!scene) {
      throw new Error(
        "window.scene is not defined on this page. This script requires " +
          "the prototype to expose window.scene = scene somewhere — see " +
          "the prerequisites note in scripts/lib/live-scene.ts.",
      );
    }
    const objects: Array<Record<string, unknown>> = [];
    scene.traverse((obj) => {
      objects.push({
        name: obj.name || "(unnamed)",
        type: obj.type,
        position: obj.position
          ? [obj.position.x, obj.position.y, obj.position.z]
          : undefined,
        visible: obj.visible,
        materialType: obj.material?.type,
      });
    });
    return objects;
  });
}

export async function getProperty(
  page: Page,
  objectName: string,
  path: string,
) {
  return await page.evaluate(
    ({ objectName, path }) => {
      // @ts-ignore - browser global
      const scene = globalThis.scene as Object3DLike | undefined;
      if (!scene) throw new Error("window.scene is not defined on this page.");
      const target = scene.getObjectByName(objectName);
      if (!target) {
        throw new Error(`No object named "${objectName}" found in the scene.`);
      }
      let obj: unknown = target;
      for (const part of path.split(".")) {
        obj = (obj as Record<string, unknown> | undefined)?.[part];
      }
      return obj;
    },
    { objectName, path },
  );
}

export async function setProperty(
  page: Page,
  objectName: string,
  path: string,
  value: unknown,
) {
  await page.evaluate(
    ({ objectName, path, value }) => {
      // @ts-ignore - browser global
      const scene = globalThis.scene as Object3DLike | undefined;
      if (!scene) throw new Error("window.scene is not defined on this page.");
      const target = scene.getObjectByName(objectName);
      if (!target) {
        throw new Error(`No object named "${objectName}" found in the scene.`);
      }
      const parts = path.split(".");
      let obj = target as Record<string, unknown>;
      for (let i = 0; i < parts.length - 1; i++) {
        obj = obj[parts[i]] as Record<string, unknown>;
      }
      obj[parts[parts.length - 1]] = value;
    },
    { objectName, path, value },
  );
}

// RendererMemory/RendererPerf and their getters moved to scaffold/lib/
// renderer-info.ts — this file's helpers are scripts/-only concerns
// (checkpoint/sweep/replay live-tab attachment), but the renderer-info
// reads are shared with test/visual/lib/capture.ts too, per PR #30
// review finding #4.

export function collectConsoleMessages(page: Page): string[] {
  const messages: string[] = [];
  page.on("console", (msg) => messages.push(`[${msg.type()}] ${msg.text()}`));
  return messages; // caller reads this array after the relevant window closes
}
