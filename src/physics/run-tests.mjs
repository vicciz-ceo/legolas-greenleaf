#!/usr/bin/env node
// Bundles the gameplay unit tests with esbuild and runs them in node.
//   node src/physics/run-tests.mjs              every suite
//   node src/physics/run-tests.mjs victory      only the suites whose path contains the given text
import { build } from 'esbuild';
import { mkdtempSync, rmSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const tests = [resolve(here, 'physics.test.ts'), resolve(here, '../combat/combat.test.ts'), resolve(here, '../game/shell.test.ts'), resolve(here, '../game/finishing.test.ts'), resolve(here, '../actors/player.test.ts'), resolve(here, '../creatures/weapons.test.ts'), resolve(here, '../creatures/humanoid/stance.test.ts'), resolve(here, '../creatures/humanoid/carry.test.ts'), resolve(here, '../creatures/humanoid/attack.test.ts'), resolve(here, '../creatures/kit/mesher.test.ts')];
// the player imports the humanoid registry, which uses Vite's import.meta.glob: swap it for explicit imports
const globPlugin = {
  name: 'vite-glob-shim',
  setup(b) {
    b.onLoad({ filter: /humanoid[\\/]registry\.ts$/ }, (a) => {
      let src = readFileSync(a.path, 'utf8');
      const files = readdirSync(join(dirname(a.path), 'kinds')).filter((f) => f.endsWith('.ts'));
      const imports = files.map((f, i) => `import * as K${i} from './kinds/${f}';`).join('\n');
      const obj = '{' + files.map((f, i) => `'./kinds/${f}': K${i}`).join(',') + '}';
      src = src.replace(/import\.meta\.glob<[^>]*>\([^)]*\)/, obj);
      return { contents: imports + '\n' + src, loader: 'ts', resolveDir: dirname(a.path) };
    });
    // game/level.ts looks its optional world modules up with import.meta.glob when it loads (game.ts imports it):
    // with none found loadWorld() degrades to stand-ins, which is what the victory test wants
    b.onLoad({ filter: /game[\\/]level\.ts$/ }, (a) => ({ contents: readFileSync(a.path, 'utf8').replace(/import\.meta\.glob\([^)]*\)/g, '{}'), loader: 'ts', resolveDir: dirname(a.path) }));
  },
};
// game.ts preloads the humanoid kit on every chapter load (seconds of meshing in node): the victory test swaps that for a no-op
const noPreload = {
  name: 'no-humanoid-preload',
  setup(b) {
    b.onResolve({ filter: /creatures\/humanoid$/ }, (a) => (/game[\\/]game\.ts$/.test(a.importer) ? { path: 'preloadHumanoids', namespace: 'no-preload' } : undefined));
    b.onLoad({ filter: /.*/, namespace: 'no-preload' }, () => ({ contents: 'export const preloadHumanoids = async () => {};', loader: 'js' }));
  },
};
// the suites that drive the real input layer, game state machine and chapter casts (the shims above are for these)
tests.push(resolve(here, '../core/input.test.ts'), resolve(here, '../game/victory.test.ts'), resolve(here, '../game/chapters/boromir.test.ts'));
const only = process.argv.slice(2);
const dir = mkdtempSync(join(tmpdir(), 'gl-tests-'));
let code = 0;
let ran = 0;
try {
  for (const entry of tests) {
    const out = join(dir, entry.split('/').pop().replace(/\.ts$/, '.mjs'));
    if (!existsSync(entry)) continue;
    if (only.length && !only.some((o) => entry.includes(o))) continue;
    ran++;
    await build({ entryPoints: [entry], bundle: true, platform: 'node', format: 'esm', outfile: out, logLevel: 'error', plugins: entry.endsWith('victory.test.ts') ? [globPlugin, noPreload] : [globPlugin] });
    console.log(`\n# ${entry.replace(resolve(here, '../..') + '/', '')}`);
    process.exitCode = 0;
    await import(pathToFileURL(out).href);
    if (process.exitCode) code = 1;
  }
  if (only.length && !ran) {
    console.log(`no suite path contains: ${only.join(' ')}`);
    code = 1;
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}
process.exitCode = code;
