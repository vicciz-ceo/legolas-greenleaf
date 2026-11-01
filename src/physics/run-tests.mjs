#!/usr/bin/env node
// Bundles the gameplay unit tests with esbuild and runs them in node.
//   node src/physics/run-tests.mjs
import { build } from 'esbuild';
import { mkdtempSync, rmSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const tests = [resolve(here, 'physics.test.ts'), resolve(here, '../combat/combat.test.ts'), resolve(here, '../game/shell.test.ts'), resolve(here, '../game/finishing.test.ts'), resolve(here, '../actors/player.test.ts'), resolve(here, '../creatures/weapons.test.ts')];
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
  },
};
const dir = mkdtempSync(join(tmpdir(), 'gl-tests-'));
let code = 0;
try {
  for (const entry of tests) {
    const out = join(dir, entry.split('/').pop().replace(/\.ts$/, '.mjs'));
    if (!existsSync(entry)) continue;
    await build({ entryPoints: [entry], bundle: true, platform: 'node', format: 'esm', outfile: out, logLevel: 'error', plugins: [globPlugin] });
    console.log(`\n# ${entry.replace(resolve(here, '../..') + '/', '')}`);
    process.exitCode = 0;
    await import(pathToFileURL(out).href);
    if (process.exitCode) code = 1;
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}
process.exitCode = code;
