#!/usr/bin/env node
// Headless snapshot tool. Starts its own Vite dev server on a free port, opens a page in
// system Chromium (SwiftShader WebGL2), waits for `window.__snapReady`, optionally advances
// game time, and writes PNG screenshots. Safe to run from several agents at once: every
// invocation owns its own server and browser.
//
// Usage:
//   node scripts/snap.mjs "<path?query>" [options]
//
// Examples:
//   node scripts/snap.mjs "/lab/?subject=spider&view=quad&anim=walk&t=0.4" --out shots/spider.png
//   node scripts/snap.mjs "/lab/?view=sheet" --out shots/sheet.png --size 1600x1000
//   node scripts/snap.mjs "/?chapter=mirkwood&cp=0&quality=low" --advance 6 --frames 3 --interval 2 --out shots/mirkwood.png
//   node scripts/snap.mjs "/?chapter=helms_deep&bot=1" --advance 20 --eval "JSON.stringify(window.__game.state())"
//
// Options:
//   --out <file.png>       output path (default shots/snap.png). With --frames N>1, files get -0,-1.. suffixes.
//   --size WxH             viewport (default 1280x720)
//   --timeout <ms>         max wait for window.__snapReady (default 60000)
//   --delay <ms>           extra real-time wait after ready (default 300)
//   --advance <sec>        before the first shot, call window.__game.advance(sec) (fixed-step sim, no input)
//   --frames <n>           number of shots (default 1)
//   --interval <sec>       game seconds advanced between shots (uses __game.advance) (default 1)
//   --eval "<js>"          evaluate an expression after the shots and print its result
//   --keys "<k1,k2>"       press keys after ready (e.g. "Escape" or "KeyW:500" to hold 500ms)
//   --no-fail              exit 0 even if page errors occurred
//
// Output: one JSON line on stdout: {ok, shots, readyMs, errors, warnings, evalResult}
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const target = args[0] && !args[0].startsWith('--') ? args.shift() : '/';
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  if (i === -1) return def;
  const v = args[i + 1];
  return v === undefined || v.startsWith('--') ? true : v;
};
const out = resolve(root, opt('out', 'shots/snap.png'));
const [W, H] = String(opt('size', '1280x720')).split('x').map(Number);
const timeout = Number(opt('timeout', 60000));
const delay = Number(opt('delay', 300));
const advance = Number(opt('advance', 0));
const frames = Number(opt('frames', 1));
const interval = Number(opt('interval', 1));
const evalExpr = opt('eval', null);
const keys = opt('keys', null);
const noFail = args.includes('--no-fail');

const CHROME =
  process.env.SNAP_CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

const errors = [];
const warnings = [];
let server;
let browser;
const result = { ok: false, shots: [], readyMs: null, errors, warnings, evalResult: undefined };

try {
  server = await createServer({
    root,
    logLevel: 'silent',
    server: { port: 0, host: '127.0.0.1', strictPort: false, hmr: false },
  });
  await server.listen();
  const addr = server.httpServer.address();
  const base = `http://127.0.0.1:${addr.port}`;

  browser = await chromium.launch({
    executablePath: CHROME,
    args: [
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--ignore-gpu-blocklist',
      '--autoplay-policy=no-user-gesture-required',
    ],
  });
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  page.on('console', (m) => {
    const t = m.type();
    const text = m.text();
    if (t === 'error' && !text.startsWith('Failed to load resource')) errors.push(`console.error: ${text}`);
    else if (t === 'warning' && warnings.length < 30) warnings.push(text);
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}\n${(e.stack || '').split('\n').slice(0, 6).join('\n')}`));
  page.on('response', (r) => {
    if (r.status() >= 400 && !r.url().includes('favicon')) errors.push(`http ${r.status()}: ${r.url()}`);
  });
  page.on('requestfailed', (r) => {
    const u = r.url();
    if (!u.includes('favicon')) errors.push(`requestfailed: ${u} ${r.failure()?.errorText ?? ''}`);
  });

  const t0 = Date.now();
  await page.goto(base + target, { waitUntil: 'load', timeout });
  try {
    await page.waitForFunction(() => window.__snapReady === true || window.__snapError, null, {
      timeout,
      polling: 100,
    });
  } catch {
    errors.push(`timeout: window.__snapReady not set within ${timeout}ms`);
  }
  const snapError = await page.evaluate(() => window.__snapError ?? null);
  if (snapError) errors.push(`__snapError: ${snapError}`);
  result.readyMs = Date.now() - t0;
  await page.waitForTimeout(delay);

  if (keys) {
    for (const k of String(keys).split(',')) {
      const [key, hold] = k.split(':');
      if (hold) {
        await page.keyboard.down(key);
        await page.waitForTimeout(Number(hold));
        await page.keyboard.up(key);
      } else await page.keyboard.press(key);
    }
  }

  const canAdvance = await page.evaluate(() => typeof window.__game?.advance === 'function');
  if (advance > 0) {
    if (canAdvance) await page.evaluate((s) => window.__game.advance(s), advance);
    else await page.waitForTimeout(advance * 1000);
  }
  mkdirSync(dirname(out), { recursive: true });
  for (let i = 0; i < frames; i++) {
    if (i > 0) {
      if (canAdvance) await page.evaluate((s) => window.__game.advance(s), interval);
      else await page.waitForTimeout(interval * 1000);
    }
    // let at least two real frames render after any simulated advance
    await page.evaluate(
      () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(null)))),
    );
    const file = frames > 1 ? out.replace(/\.png$/, `-${i}.png`) : out;
    await page.screenshot({ path: file });
    result.shots.push(file);
  }
  if (evalExpr) {
    try {
      result.evalResult = await page.evaluate((src) => {
        // eslint-disable-next-line no-eval
        const v = (0, eval)(src);
        return v instanceof Promise ? v.then((x) => x) : v;
      }, String(evalExpr));
    } catch (e) {
      errors.push(`eval failed: ${e.message}`);
    }
  }
  result.ok = errors.length === 0;
} catch (e) {
  errors.push(`snap crashed: ${e?.stack || e}`);
} finally {
  await browser?.close().catch(() => {});
  await server?.close().catch(() => {});
}
console.log(JSON.stringify(result, null, 1));
process.exit(result.ok || noFail ? 0 : 1);
