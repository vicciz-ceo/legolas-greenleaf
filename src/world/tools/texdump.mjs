#!/usr/bin/env node
// Dev tool (world module): generate texture sets in Node (no GPU) and dump a contact-sheet PNG.
//   node src/world/tools/texdump.mjs bark,rock [--tiles 2] [--size 512] [--mode albedo|normal|rough|all] [--cols 4] [--out shots/world/tex.png]
// Each cell shows the albedo tiled NxN (to judge seams); mode=all adds normal + roughness next to it.
import { createServer } from 'vite';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync, crc32 } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const args = process.argv.slice(2);
const names = args[0] && !args[0].startsWith('--') ? args.shift().split(',') : null;
const opt = (n, d) => {
  const i = args.indexOf('--' + n);
  return i === -1 ? d : args[i + 1];
};
const tiles = Number(opt('tiles', 2));
const size = Number(opt('size', 512));
const mode = opt('mode', 'albedo');
const cols = Number(opt('cols', 4));
const cell = Number(opt('cell', 384));
const out = resolve(root, opt('out', 'shots/world/tex.png'));

function png(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1);
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const server = await createServer({ root, logLevel: 'silent', server: { middlewareMode: true }, appType: 'custom' });
try {
  const mod = await server.ssrLoadModule('/src/world/textures.ts');
  const list = names ?? mod.ALL_TEXTURE_SETS;
  const panels = mode === 'all' ? 3 : 1;
  const rows = Math.ceil(list.length / cols);
  const W = cols * cell * panels;
  const H = rows * cell;
  const img = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < img.length; i += 4) {
    img[i] = 24;
    img[i + 1] = 24;
    img[i + 2] = 26;
    img[i + 3] = 255;
  }
  list.forEach((name, idx) => {
    const t0 = performance.now();
    const set = mod.getTextureSet(name, { size });
    const ms = performance.now() - t0;
    console.log(`${name}: ${ms.toFixed(0)} ms`);
    const maps = mode === 'all' ? [set.map, set.normalMap, set.roughnessMap] : [mode === 'normal' ? set.normalMap : mode === 'rough' ? set.roughnessMap : set.map];
    maps.forEach((tex, p) => {
      const data = tex.image.data;
      const n = tex.image.width;
      const ox = ((idx % cols) * panels + p) * cell;
      const oy = Math.floor(idx / cols) * cell;
      for (let y = 0; y < cell; y++) {
        for (let x = 0; x < cell; x++) {
          const sx = Math.floor(((x / cell) * tiles * n) % n);
          const sy = Math.floor(((y / cell) * tiles * n) % n);
          const si = (sy * n + sx) * 4;
          const di = ((oy + y) * W + ox + x) * 4;
          let r = data[si], g = data[si + 1], b = data[si + 2], a = 255;
          if (mode === 'rough' || (mode === 'all' && p === 2)) { r = g; b = g; } // show roughness (G)
          if (name === 'web' && p === 0) { a = data[si + 3]; const bg = 40; r = (r * a + bg * (255 - a)) / 255; g = (g * a + bg * (255 - a)) / 255; b = (b * a + bg * (255 - a)) / 255; a = 255; }
          img[di] = r; img[di + 1] = g; img[di + 2] = b; img[di + 3] = a;
        }
      }
    });
  });
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, png(W, H, img));
  console.log('wrote', out, W + 'x' + H);
} finally {
  await server.close();
}
