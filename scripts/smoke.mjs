#!/usr/bin/env node
// Smoke test: loads every chapter at every checkpoint in headless Chromium, lets the autopilot
// play 20 simulated seconds (god mode), takes 2 screenshots and fails on any page error.
//
//   npm run smoke                       all chapters, all checkpoints
//   npm run smoke -- --only arena       a single chapter
//   npm run smoke -- --only arena --cp 2   a single checkpoint
//   npm run smoke -- --seconds 40 --size 1280x720
//   npm run smoke -- --jobs 3           run 3 pages in parallel (software GL is CPU bound: little gain)
//   npm run smoke -- --reuse            keep ONE page and switch chapters with __game.startChapter
//                                       (skips the ~10 s engine boot per run, also exercises chapter unload)
//
// Per run URL:  /?chapter=<id>&cp=<n>&bot=1&god=1&quality=low&skipIntro=1&freeze=1
// (freeze=1: the simulation advances only through __game.advance*, and the page renders at a low
//  rate, so the software GPU is never flooded and the run is deterministic)
// Screenshots:  shots/smoke/<id>-cp<n>-0.png (halfway) and -1.png (end)
// Exit code 1 when any run reports a page error, console.error, failed request, __snapError or timeout.
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  if (i === -1) return def;
  const v = args[i + 1];
  return v === undefined || v.startsWith('--') ? true : v;
};
const only = opt('only', null);
const onlyCp = opt('cp', null);
const SECONDS = Number(opt('seconds', 20));
const CHUNK = Number(opt('chunk', 0.5));
const [W, H] = String(opt('size', '960x540')).split('x').map(Number);
const JOBS = Math.max(1, Number(opt('jobs', 1)));
const REUSE = args.includes('--reuse');
const READY_TIMEOUT = Number(opt('timeout', 120000));
const CHROME = process.env.SNAP_CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const shotDir = resolve(root, 'shots/smoke');
mkdirSync(shotDir, { recursive: true });

const pad = (s, n) => String(s).padEnd(n);
const rows = [];
let server;
let browser;

/** open a fresh page wired to collect errors; returns { page, errors } */
async function openPage(base, url, sinkOrArray) {
  // errors go to sink.errors (re-pointable for --reuse) or straight into an array
  const push = (e) => (Array.isArray(sinkOrArray) ? sinkOrArray : sinkOrArray.errors).push(e);
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  page.on('console', (m) => {
    const text = m.text();
    if (m.type() === 'error' && !text.startsWith('Failed to load resource')) push(`console.error: ${text}`);
  });
  page.on('pageerror', (e) => push(`pageerror: ${e.message}\n${(e.stack || '').split('\n').slice(0, 5).join('\n')}`));
  page.on('response', (r) => {
    if (r.status() >= 400 && !r.url().includes('favicon')) push(`http ${r.status()}: ${r.url()}`);
  });
  page.on('requestfailed', (r) => {
    if (!r.url().includes('favicon')) push(`requestfailed: ${r.url()} ${r.failure()?.errorText ?? ''}`);
  });
  await page.goto(base + url, { waitUntil: 'load', timeout: READY_TIMEOUT });
  return page;
}

async function waitReady(page, errors) {
  try {
    await page.waitForFunction(() => window.__snapReady === true || !!window.__snapError, null, { timeout: READY_TIMEOUT, polling: 100 });
  } catch {
    errors.push(`timeout: window.__snapReady not set within ${READY_TIMEOUT} ms`);
  }
  const snapError = await page.evaluate(() => window.__snapError ?? null);
  if (snapError) errors.push(`__snapError: ${snapError}`);
}

let shared = null; // { page, sink } for --reuse
async function runOne(base, info, cp) {
  const id = info.id;
  let errors = [];
  const row = { id, cp, ready: 0, errors, kills: 0, hp: 0, enemies: 0, mode: '?', objective: '', shots: [] };
  const t0 = Date.now();
  let page;
  try {
    if (REUSE) {
      if (!shared) {
        shared = { sink: { errors: [] } };
        shared.page = await openPage(base, `/?menu=0&bot=1&god=1&quality=low&skipIntro=1&freeze=1`, shared.sink);
        await waitReady(shared.page, shared.sink.errors);
      }
      page = shared.page;
      errors = shared.sink.errors = [];
      row.errors = errors;
      await page.evaluate(([i, c]) => window.__game.startChapter(i, c), [id, cp]).catch((e) => errors.push(`startChapter: ${e.message}`));
      await page.evaluate(() => window.__game.bot(true));
      const err = await page.evaluate(() => window.__snapError ?? null);
      if (err) errors.push(`__snapError: ${err}`);
    } else {
      page = await openPage(base, `/?chapter=${id}&cp=${cp}&bot=1&god=1&quality=low&skipIntro=1&freeze=1`, errors);
      await waitReady(page, errors);
    }
    row.ready = Date.now() - t0;
    if (!errors.length) {
      const half = Math.floor(SECONDS / CHUNK / 2);
      const total = Math.floor(SECONDS / CHUNK);
      for (let i = 0; i < total; i++) {
        // render only when a screenshot follows: simulation chunks do not need a frame
        const shoot = i + 1 === half || i + 1 === total;
        await page.evaluate(
          async ([s, render]) => {
            const g = window.__game;
            if (g.advanceAsync) await g.advanceAsync(s, undefined, render);
            else g.advance(s, undefined, render);
          },
          [CHUNK, shoot],
        );
        if (shoot) {
          await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(null)))));
          const file = resolve(shotDir, `${id}-cp${cp}-${i + 1 === half ? 0 : 1}.png`);
          await page.screenshot({ path: file });
          row.shots.push(file);
        }
        if (errors.length > 8) break;
      }
      const st = await page.evaluate(() => window.__game.state());
      row.kills = st.kills ?? 0;
      row.hp = Math.round(st.hp ?? 0);
      row.enemies = st.enemies ?? 0;
      row.mode = st.mode ?? '?';
      row.objective = st.objective ?? '';
      row.t = st.t;
    }
  } catch (e) {
    errors.push(`run crashed: ${e?.stack || e}`);
  } finally {
    if (!REUSE) await page?.close().catch(() => {});
  }
  return row;
}

try {
  server = await createServer({ root, logLevel: 'silent', server: { port: 0, host: '127.0.0.1', strictPort: false, hmr: false } });
  await server.listen();
  const base = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = await chromium.launch({
    executablePath: CHROME,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
  });

  // chapter list from the game itself
  const listErrors = [];
  const lp = await openPage(base, '/?menu=0&quality=low&dev=1', listErrors);
  await waitReady(lp, listErrors);
  let chapters = [];
  if (!listErrors.length) {
    chapters = await lp.evaluate(() => {
      const g = window.__game;
      if (g.chapterInfo) return g.chapterInfo();
      return g.chapters().map((id) => ({ id, checkpoints: 1 }));
    });
  }
  await lp.close().catch(() => {});
  if (listErrors.length) {
    rows.push({ id: '(boot)', cp: '-', ready: 0, errors: listErrors, kills: 0, hp: 0, enemies: 0, mode: '?', objective: '', shots: [] });
  }
  if (only) chapters = chapters.filter((c) => c.id === only);
  if (!listErrors.length && !chapters.length) {
    rows.push({ id: only || '(none)', cp: '-', ready: 0, errors: [only ? `unknown chapter "${only}"` : 'no chapters registered'], kills: 0, hp: 0, enemies: 0, mode: '?', objective: '', shots: [] });
  }

  // every (chapter, checkpoint) pair, run by a small pool of workers (one fresh page per run)
  const jobs = [];
  for (const c of chapters) {
    const cps = Math.max(1, c.checkpoints ?? 1);
    for (let cp = 0; cp < cps; cp++) {
      if (onlyCp !== null && Number(onlyCp) !== cp) continue;
      jobs.push({ c, cp });
    }
  }
  const results = new Array(jobs.length);
  let next = 0;
  const worker = async () => {
    while (next < jobs.length) {
      const i = next++;
      const { c, cp } = jobs[i];
      const row = await runOne(base, c, cp);
      process.stderr.write(`smoke ${c.id} cp${cp} ... ${row.errors.length ? `FAIL (${row.errors.length})` : 'ok'}\n`);
      results[i] = row;
    }
  };
  await Promise.all(Array.from({ length: Math.min(JOBS, jobs.length) }, worker));
  rows.push(...results.filter(Boolean));
} catch (e) {
  rows.push({ id: '(smoke)', cp: '-', ready: 0, errors: [`smoke crashed: ${e?.stack || e}`], kills: 0, hp: 0, enemies: 0, mode: '?', objective: '', shots: [] });
} finally {
  await browser?.close().catch(() => {});
  await server?.close().catch(() => {});
}

// ── summary ───────────────────────────────────────────────────────────────
console.log('');
console.log(`${pad('chapter', 14)}${pad('cp', 4)}${pad('ready', 9)}${pad('mode', 10)}${pad('kills', 7)}${pad('hp', 6)}${pad('foes', 6)}${pad('errors', 8)}objective`);
console.log('-'.repeat(86));
let failed = 0;
for (const r of rows) {
  if (r.errors.length) failed++;
  console.log(
    `${pad(r.id, 14)}${pad(r.cp, 4)}${pad(`${(r.ready / 1000).toFixed(1)}s`, 9)}${pad(r.mode, 10)}${pad(r.kills, 7)}${pad(r.hp, 6)}${pad(r.enemies, 6)}${pad(r.errors.length, 8)}${r.objective ?? ''}`,
  );
}
for (const r of rows) {
  if (!r.errors.length) continue;
  console.log(`\n--- ${r.id} cp${r.cp}: ${r.errors.length} error(s)`);
  const seen = new Set();
  for (const e of r.errors) {
    const k = e.slice(0, 300);
    if (seen.has(k)) continue;
    seen.add(k);
    console.log(`  ${e.split('\n').join('\n  ')}`);
  }
}
console.log(`\n${rows.length} run(s), ${failed} failed. Screenshots: ${shotDir}`);
process.exit(failed ? 1 : 0);
