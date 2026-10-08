#!/usr/bin/env node
// Bundles the gameplay unit tests with esbuild and runs them in node.
//   node src/physics/run-tests.mjs
import { build } from 'esbuild';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const tests = [resolve(here, 'physics.test.ts'), resolve(here, '../combat/combat.test.ts'), resolve(here, '../game/shell.test.ts')];
const dir = mkdtempSync(join(tmpdir(), 'gl-tests-'));
let code = 0;
try {
  for (const entry of tests) {
    const out = join(dir, entry.split('/').pop().replace(/\.ts$/, '.mjs'));
    if (!existsSync(entry)) continue;
    await build({ entryPoints: [entry], bundle: true, platform: 'node', format: 'esm', outfile: out, logLevel: 'error' });
    console.log(`\n# ${entry.replace(resolve(here, '../..') + '/', '')}`);
    process.exitCode = 0;
    await import(pathToFileURL(out).href);
    if (process.exitCode) code = 1;
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}
process.exitCode = code;
