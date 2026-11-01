#!/usr/bin/env node
// Bundles and runs the Player feel tests in node. The player imports the humanoid registry, which
// uses Vite's import.meta.glob; this runner swaps it for explicit imports.
//   node src/actors/run-player-test.mjs
import { build } from 'esbuild';
import { mkdtempSync, rmSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
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
const dir = mkdtempSync(join(tmpdir(), 'gl-player-test-'));
try {
  const out = join(dir, 'player.test.mjs');
  await build({ entryPoints: [resolve(here, 'player.test.ts')], bundle: true, platform: 'node', format: 'esm', outfile: out, logLevel: 'error', plugins: [globPlugin] });
  process.exitCode = 0;
  await import(pathToFileURL(out).href);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
