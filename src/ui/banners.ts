/**
 * Chapter card art, drawn in code: one SVG composition per location (gradients, silhouettes, lights).
 * Each is a 2:1 banner (viewBox 400x200) whose subject sits in the right 60%, because the card keeps
 * the left 40% for its label. Colours and composition follow the art-pass references
 * (docs/refs/ui/chapter_cards, docs/refs/scenes/<id>/palette.png); no image is imported or shipped.
 *
 *   chapterBanner(environmentName) -> '<svg class="gl-banner" ...>'
 */
import { mulberry32 } from '../core/rng';

type Rnd = () => number;
type Stop = [number, string, number?];
type Pt = [number, number];

const r1 = (n: number): string => (Math.round(n * 10) / 10).toString();

let uidCounter = 0;

/** tiny SVG scene builder: gradients are registered with unique ids so many banners can share a page */
class Scene {
  defs = '';
  body = '';
  private n = 0;
  readonly id: string;
  readonly r: Rnd;
  constructor(seed: number) {
    this.id = `gb${++uidCounter}`;
    this.r = mulberry32(seed);
  }
  private stops(stops: Stop[]): string {
    return stops.map((s) => `<stop offset="${s[0]}" stop-color="${s[1]}"${s[2] !== undefined ? ` stop-opacity="${s[2]}"` : ''}/>`).join('');
  }
  /** linear gradient in bounding-box units; returns a fill reference */
  lin(stops: Stop[], x1 = 0, y1 = 0, x2 = 0, y2 = 1): string {
    const k = `${this.id}-${this.n++}`;
    this.defs += `<linearGradient id="${k}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}">${this.stops(stops)}</linearGradient>`;
    return `url(#${k})`;
  }
  /** radial gradient in user space */
  rad(cx: number, cy: number, r: number, stops: Stop[], sy = 1): string {
    const k = `${this.id}-${this.n++}`;
    const t = sy !== 1 ? ` gradientTransform="translate(${cx} ${cy}) scale(1 ${sy}) translate(${-cx} ${-cy})"` : '';
    this.defs += `<radialGradient id="${k}" gradientUnits="userSpaceOnUse" cx="${cx}" cy="${cy}" r="${r}"${t}>${this.stops(stops)}</radialGradient>`;
    return `url(#${k})`;
  }
  add(s: string): this {
    this.body += s;
    return this;
  }
  rect(x: number, y: number, w: number, h: number, fill: string, op = 1): this {
    return this.add(`<rect x="${r1(x)}" y="${r1(y)}" width="${r1(w)}" height="${r1(h)}" fill="${fill}"${op < 1 ? ` opacity="${op}"` : ''}/>`);
  }
  path(d: string, fill: string, op = 1, extra = ''): this {
    return this.add(`<path d="${d}" fill="${fill}"${op < 1 ? ` opacity="${op}"` : ''} ${extra}/>`);
  }
  line(d: string, stroke: string, w = 1, op = 1, extra = ''): this {
    return this.add(`<path d="${d}" fill="none" stroke="${stroke}" stroke-width="${w}"${op < 1 ? ` stroke-opacity="${op}"` : ''} stroke-linecap="round" ${extra}/>`);
  }
  ell(cx: number, cy: number, rx: number, ry: number, fill: string, op = 1): this {
    return this.add(`<ellipse cx="${r1(cx)}" cy="${r1(cy)}" rx="${r1(rx)}" ry="${r1(ry)}" fill="${fill}"${op < 1 ? ` opacity="${op}"` : ''}/>`);
  }
  circ(cx: number, cy: number, r: number, fill: string, op = 1): this {
    return this.add(`<circle cx="${r1(cx)}" cy="${r1(cy)}" r="${r1(r)}" fill="${fill}"${op < 1 ? ` opacity="${op}"` : ''}/>`);
  }
  poly(pts: Pt[], fill: string, op = 1): this {
    return this.path(`M${pts.map((p) => `${r1(p[0])} ${r1(p[1])}`).join('L')}Z`, fill, op);
  }
  /** soft glow */
  glow(cx: number, cy: number, r: number, color: string, op = 1, sy = 1): this {
    const g = this.rad(cx, cy, r, [[0, color, op], [0.4, color, op * 0.4], [1, color, 0]], sy);
    return this.ell(cx, cy, r, r * sy, g);
  }
  /** jagged ridge silhouette closed down to the bottom edge */
  ridge(y: number, amp: number, step: number, fill: string, op = 1, x0 = -10, x1 = 410): this {
    const r = this.r;
    const pts: Pt[] = [];
    let ph = r() * 6;
    for (let x = x0; x <= x1; x += step) {
      ph += 0.5 + r();
      pts.push([x, y + (Math.sin(ph) * 0.5 + (r() - 0.5)) * amp]);
    }
    return this.path(`M${x0} 205L${pts.map((p) => `${r1(p[0])} ${r1(p[1])}`).join('L')}L${x1} 205Z`, fill, op);
  }
  /** a conifer made of stacked tiers */
  pine(x: number, base: number, h: number, w: number, fill: string, op = 1): this {
    let d = '';
    const tiers = 4;
    for (let k = 0; k < tiers; k++) {
      const t0 = base - (h * k) / (tiers + 0.6);
      const t1 = base - (h * (k + 1.7)) / (tiers + 0.6);
      const ww = w * (1 - k * 0.2) * 0.5;
      d += `M${r1(x - ww)} ${r1(t0)}L${r1(x)} ${r1(t1)}L${r1(x + ww)} ${r1(t0)}Z`;
    }
    d += `M${r1(x - 0.7)} ${r1(base)}h1.4v3h-1.4z`;
    return this.path(d, fill, op);
  }
  /** a row of conifers between x0 and x1 */
  pines(x0: number, x1: number, base: number, hMin: number, hMax: number, fill: string, op = 1, gap = 9): this {
    const r = this.r;
    for (let x = x0; x < x1; x += gap * (0.6 + r() * 0.8)) {
      const h = hMin + r() * (hMax - hMin);
      this.pine(x, base + (r() - 0.5) * 4, h, h * 0.42, fill, op);
    }
    return this;
  }
  /** scattered points of light */
  lights(n: number, x0: number, x1: number, y0: number, y1: number, color: string, rMin = 0.5, rMax = 1.1, op = 0.9): this {
    const r = this.r;
    let s = '';
    for (let i = 0; i < n; i++) {
      s += `<circle cx="${r1(x0 + r() * (x1 - x0))}" cy="${r1(y0 + r() * (y1 - y0))}" r="${r1(rMin + r() * (rMax - rMin))}"/>`;
    }
    return this.add(`<g fill="${color}" opacity="${op}">${s}</g>`);
  }
  svg(cls: string): string {
    return `<svg class="gl-banner ${cls}" viewBox="0 0 400 200" preserveAspectRatio="xMaxYMid slice" aria-hidden="true" focusable="false"><defs>${this.defs}</defs>${this.body}</svg>`;
  }
}

// ── Mirkwood: webbed cocoons in a shaft of green-gold light ─────────────────────
function mirkwood(): Scene {
  const s = new Scene(11);
  s.rect(0, 0, 400, 200, s.lin([[0, '#1b2b1c'], [0.55, '#0f1b11'], [1, '#050a06']]));
  s.glow(300, 38, 120, '#d9d58a', 0.55, 0.9);
  // distant trunks, fogged
  for (const [x, w, o] of [[176, 9, 0.5], [212, 14, 0.55], [262, 7, 0.4], [330, 10, 0.4], [380, 16, 0.55]] as const) {
    s.rect(x, 0, w, 150, s.lin([[0, '#26372a'], [1, '#0e170f']], 0, 0, 1, 0), o);
  }
  // the shaft of light
  s.poly([[262, 0], [352, 0], [392, 200], [236, 200]], s.lin([[0, '#f2e7a0', 0.6], [0.6, '#bcc680', 0.2], [1, '#9fb070', 0]]), 0.85);
  // webs between the trunks
  const r = s.r;
  let webs = '';
  for (let i = 0; i < 16; i++) {
    const x0 = 170 + r() * 220;
    const y0 = r() * 120;
    const x1 = x0 + 30 + r() * 80;
    const y1 = y0 + (r() - 0.3) * 50;
    webs += `M${r1(x0)} ${r1(y0)}Q${r1((x0 + x1) / 2)} ${r1(Math.max(y0, y1) + 14 + r() * 14)} ${r1(x1)} ${r1(y1)}`;
  }
  s.line(webs, '#e6e0c4', 0.5, 0.3);
  // cocoons: strand, swaying body with a dark core
  for (const [x, len, sz] of [[228, 52, 15], [268, 68, 18], [312, 46, 13], [352, 78, 19], [392, 40, 12]] as const) {
    s.line(`M${x} 0V${len}`, '#d9d2b4', 0.8, 0.55);
    s.ell(x, len + sz * 1.25, sz * 0.62, sz * 1.35, s.lin([[0, '#d7ceb0'], [0.55, '#8d8668'], [1, '#403d2e']], 0, 0, 1, 1));
    s.ell(x - sz * 0.12, len + sz * 1.3, sz * 0.22, sz * 0.55, '#2a281d', 0.55);
    let wrap = '';
    for (let k = 0; k < 4; k++) wrap += `M${r1(x - sz * 0.6)} ${r1(len + sz * (0.4 + k * 0.55))}q${r1(sz * 0.6)} ${r1(sz * 0.3)} ${r1(sz * 1.2)} 0`;
    s.line(wrap, '#f1ecd2', 0.5, 0.45);
  }
  // a warm opening deep in the roots
  s.glow(340, 160, 44, '#e9a64c', 0.8, 0.6);
  s.path('M300 172Q300 142 340 140Q382 142 384 172Z', s.rad(342, 158, 38, [[0, '#f4c36a'], [0.6, '#a8602a'], [1, '#27140a']]), 0.95);
  // big gnarled foreground trunks and roots
  s.path('M-8 0H82Q96 60 74 110Q96 150 128 200H-8Z', '#070b07');
  s.path('M70 100Q100 130 118 168Q146 186 176 200H100Q70 170 50 150Z', '#0a100a');
  s.path('M120 0H168Q176 80 160 130Q184 170 214 200H132Q150 130 120 90Z', '#0b120c', 0.92);
  s.path('M190 168Q240 156 290 182Q330 190 400 176V200H196Z', '#0a0f0a');
  s.line('M214 186Q252 168 296 192M300 190Q340 176 392 188', '#2b3a22', 1.2, 0.5);
  s.lights(26, 190, 400, 8, 150, '#f4efc8', 0.4, 1, 0.55); // drifting spores
  return s;
}

// ── The Barrel Escape: a weir, waterfall and the river below ────────────────────
function barrels(): Scene {
  const s = new Scene(22);
  s.rect(0, 0, 400, 200, s.lin([[0, '#6d8590'], [0.45, '#b7c4c6'], [1, '#6f8a85']]));
  // far mountain with a snow cap
  s.path('M230 100L300 22L318 38L332 20L392 100Z', '#7f929c');
  s.path('M300 22L318 38L332 20L352 52L338 48L322 62L306 46L292 52Z', '#eef2f2');
  s.path('M230 100L300 22L292 52L270 74L255 90Z', '#566b78', 0.55);
  s.rect(0, 70, 400, 60, s.lin([[0, '#c9d5d7', 0], [1, '#c9d5d7', 0.55]]));
  s.ridge(96, 10, 14, '#4e6657', 0.7, 150, 410);
  // the weir: two stone piers, gate arches, a wooden bridge
  s.rect(270, 76, 18, 56, '#3a3f38');
  s.rect(318, 70, 22, 62, '#343a33');
  s.rect(288, 92, 30, 40, '#1e2420');
  s.path('M290 132V106Q303 92 316 106V132Z', '#0d110f');
  s.rect(262, 74, 84, 4, '#474c43');
  s.line('M200 84H262M346 78H400', '#4a3a28', 2, 0.9);
  s.line('M200 84V96M216 84V96M232 84V96M248 84V96', '#33291c', 1, 0.8);
  s.line('M296 70V60M326 64V54M296 60h-6M326 54h-6', '#2a2a22', 1.4, 0.9);
  // trees clinging to the banks
  s.pines(170, 262, 118, 22, 40, '#1c2f1f', 0.95, 11);
  s.pines(346, 410, 116, 24, 44, '#203723', 0.95, 12);
  // waterfall
  const wf = s.lin([[0, '#f4f8f6'], [1, '#b5d0cf']]);
  s.poly([[288, 98], [316, 98], [326, 150], [276, 150]], wf, 0.92);
  s.line('M294 100L288 148M303 100V150M311 100L316 150', '#ffffff', 0.9, 0.7);
  s.poly([[326, 112], [352, 118], [372, 168], [338, 162]], wf, 0.75);
  s.ell(302, 152, 40, 7, '#ffffff', 0.7);
  // the river and its foam
  s.path('M250 140Q300 150 330 150Q370 160 372 200H196Q230 170 250 140Z', s.lin([[0, '#6e9d9a'], [1, '#243f40']], 0, 0, 0.3, 1));
  s.path('M330 150Q380 160 400 150V200H372Q372 164 330 150Z', s.lin([[0, '#5f8e8b'], [1, '#1f3636']]));
  s.line('M230 176Q270 168 320 178M260 190Q300 182 350 190', '#d6ece8', 1, 0.35);
  for (const [x, y, w] of [[286, 158, 18], [318, 170, 14], [262, 178, 12], [342, 186, 16]] as const) s.ell(x, y, w, 3.2, '#f2fbf8', 0.65);
  // barrels
  for (const [x, y] of [[300, 176], [332, 184], [270, 188]] as const) {
    s.ell(x, y, 8, 6, '#5d3f22');
    s.line(`M${x - 7} ${y - 2}Q${x} ${y + 2} ${x + 7} ${y - 2}M${x - 7} ${y + 2}Q${x} ${y + 6} ${x + 7} ${y + 2}`, '#b8a07a', 0.9, 0.7);
  }
  // mossy dark foreground slope
  s.path('M-10 60Q60 70 120 112Q170 150 214 205H-10Z', '#0b140d');
  s.path('M60 90Q120 100 150 140L176 200H110Z', '#122016');
  s.ell(184, 188, 30, 11, '#18231b');
  s.ell(230, 196, 24, 8, '#1c2a1f');
  s.pines(-6, 150, 112, 46, 86, '#0d170f', 1, 9);
  s.pines(40, 190, 140, 34, 60, '#122017', 1, 10);
  return s;
}

// ── Lake-town by Night: stilt houses, lamplight and a moon on the water ─────────
function laketown(): Scene {
  const s = new Scene(33);
  s.rect(0, 0, 400, 200, s.lin([[0, '#050914'], [0.5, '#12203f'], [0.58, '#101a33'], [1, '#02040a']]));
  // clouds + moon
  s.glow(292, 34, 56, '#9db6e6', 0.45);
  s.circ(292, 34, 10.5, '#f3f6ff');
  s.ell(250, 28, 60, 6, '#27375e', 0.8);
  s.ell(340, 48, 70, 5, '#1f2c4f', 0.8);
  s.ell(210, 54, 80, 4, '#2b3b66', 0.6);
  // far shore
  s.ridge(112, 16, 12, '#0a1226', 1, 0, 260);
  s.rect(0, 112, 400, 90, s.lin([[0, '#0f1a35'], [1, '#02040a']]));
  s.rect(0, 108, 400, 12, s.lin([[0, '#c3cde8', 0], [1, '#c3cde8', 0.14]]));
  // moon road and lamp reflections
  s.rect(284, 114, 16, 70, s.lin([[0, '#bcd0ff', 0.55], [1, '#bcd0ff', 0]]), 0.9);
  const warm = s.lin([[0, '#ffb04a', 0.7], [1, '#ffb04a', 0]]);
  for (const [x, w, l] of [[330, 7, 80], [350, 5, 66], [364, 8, 84], [384, 5, 60], [296, 4, 50], [268, 4, 44], [252, 3, 38]] as const) s.rect(x, 118, w, l, warm, 0.8);
  s.line('M170 140H400M150 158H400M180 176H400', '#7da0ff', 0.6, 0.12);
  // distant houses on stilts
  for (const [x, w, h] of [[214, 22, 12], [244, 26, 14], [270, 20, 11]] as const) {
    s.rect(x, 106 - h, w, h, '#17120f');
    s.poly([[x - 3, 106 - h], [x + w / 2, 106 - h - 9], [x + w + 3, 106 - h]], '#0b0d14');
    s.rect(x + 4, 106 - h + 3, 4, 4, '#ffb760');
    s.rect(x + w - 8, 106 - h + 3, 4, 4, '#ffb760');
    s.rect(x + 2, 106, 1.4, 12, '#0d0c0b');
    s.rect(x + w - 3, 106, 1.4, 12, '#0d0c0b');
  }
  // the great house, right
  s.rect(316, 70, 84, 52, '#241810');
  s.poly([[304, 70], [358, 28], [412, 70], [412, 76], [304, 76]], '#0e1018');
  s.line('M304 72L358 29L412 72', '#4b5878', 1, 0.7);
  s.poly([[326, 40], [346, 22], [366, 40]], '#0c0e16');
  for (const [x, y, w, h] of [[326, 84, 14, 12], [348, 84, 14, 12], [370, 84, 14, 12], [326, 104, 14, 10], [374, 104, 16, 10]] as const) {
    s.glow(x + w / 2, y + h / 2, 16, '#ff9a3a', 0.55);
    s.rect(x, y, w, h, s.lin([[0, '#ffd88a'], [1, '#e67e22']]));
    s.line(`M${x + w / 2} ${y}V${y + h}`, '#4a2a10', 0.7, 0.8);
  }
  s.rect(310, 118, 90, 5, '#2a1c12');
  for (const x of [314, 332, 350, 368, 386]) s.rect(x, 123, 3, 40, '#120d09');
  s.line('M310 123V160M312 140H400', '#1a120c', 1, 0.6);
  // a lantern on the pier and a moored boat
  s.glow(300, 120, 14, '#ffbf66', 0.9);
  s.circ(300, 120, 2.2, '#ffe8b0');
  s.path('M196 134Q226 144 262 134L254 142Q226 148 204 142Z', '#0c0a09');
  s.line('M228 134V94M228 100L248 128H228Z', '#0c0a09', 1.3);
  s.poly([[229, 98], [247, 126], [229, 126]], '#d7cfb4', 0.35);
  s.lights(14, 150, 400, 120, 195, '#ffffff', 0.4, 0.8, 0.12);
  return s;
}

// ── Ravenhill: a ruined tower in snow above a frozen fall ───────────────────────
function ravenhill(): Scene {
  const s = new Scene(44);
  s.rect(0, 0, 400, 200, s.lin([[0, '#1a212d'], [0.5, '#55657a'], [1, '#aab6c4']], 0, 0, 1, 1));
  s.ell(250, 30, 120, 16, '#c7d0da', 0.35);
  s.ell(340, 12, 90, 10, '#e0e6ec', 0.4);
  // snow peaks behind
  s.path('M250 118L318 28L334 46L350 20L400 96V130H250Z', '#cfd9e3');
  s.path('M318 28L334 46L350 20L376 62L362 70L346 52L330 76L316 54L306 62Z', '#f3f7fa');
  s.path('M250 118L318 28L306 62L290 90L276 108Z', '#7a8da3', 0.7);
  s.path('M350 20L400 96V130H362L360 80Z', '#8fa0b5', 0.6);
  s.ridge(112, 14, 16, '#6d7f95', 0.8, 200, 410);
  s.rect(0, 90, 400, 40, s.lin([[0, '#d9e1ea', 0], [1, '#d9e1ea', 0.45]]));
  // rocky spire on the left-centre with the ruined tower
  s.path('M150 200L168 120L186 96L200 60L222 56L238 90L246 132L262 160L284 200Z', '#1f2630');
  s.path('M200 60L222 56L238 90L230 100L214 86L204 100Z', '#8d9bad', 0.55);
  s.rect(196, 20, 26, 42, '#262d38');
  s.path('M194 20h4v-6h4v6h5v-8h4v8h4v-5h5v5h4v34h-30z', '#262d38');
  s.path('M202 40V30Q209 24 216 30V40Z', '#0b0f15');
  s.line('M196 24L222 20', '#c9d3de', 1.4, 0.7);
  // arched bridge from the tower to the far side
  s.path('M222 92H330V98H222Z', '#2a323d');
  s.line('M232 98Q248 78 264 98M268 98Q284 78 300 98M304 98Q318 80 330 98', '#2a323d', 3, 0.95);
  // icy waterfall
  s.path('M258 108L276 106L282 168L254 176Z', s.lin([[0, '#f5fbff'], [1, '#9cc3da']]), 0.95);
  s.line('M262 110L260 172M270 108L270 170', '#ffffff', 0.8, 0.8);
  s.ell(270, 176, 34, 8, '#ffffff', 0.6);
  // frozen river and far cliffs
  s.path('M262 176Q320 160 400 150V200H240Z', s.lin([[0, '#a9cfe3'], [1, '#4f7d98']]), 0.9);
  s.path('M340 134Q372 120 400 128V150Q370 146 340 156Z', '#2c3644');
  s.line('M330 96V134M366 96V128', '#28313c', 3, 0.9);
  // dark snowy foreground rocks
  s.path('M-10 200V130Q30 110 74 140Q120 150 150 200Z', '#0b0e13');
  s.path('M-10 134Q30 112 74 142L60 146Q30 128 -10 142Z', '#e8eef5', 0.95);
  s.path('M70 168Q130 150 190 200H60Z', '#10141a');
  s.path('M70 168Q110 156 150 174L130 176Q104 166 80 176Z', '#dfe7ef', 0.9);
  // smoke and snowfall
  s.path('M380 100Q372 76 386 56Q380 40 394 24', 'none', 1, 'stroke="#2b2f36" stroke-width="7" stroke-linecap="round" opacity=".55"');
  s.lights(60, 0, 400, 0, 200, '#ffffff', 0.5, 1.4, 0.7);
  return s;
}

// ── Balin's Tomb: dwarven pillars, a shaft of light on the stone tomb ───────────
function moria(): Scene {
  const s = new Scene(55);
  s.rect(0, 0, 400, 200, '#040507');
  // the far burning hall, left of the first pillar
  s.glow(128, 118, 70, '#ff6a24', 0.5, 0.7);
  for (const x of [96, 118, 140]) {
    s.path(`M${x - 8} 140V96Q${x} 80 ${x + 8} 96V140Z`, s.lin([[0, '#ff8a3a'], [1, '#6a2410']]), 0.8);
  }
  s.lights(22, 80, 170, 120, 150, '#ffb25a', 0.5, 1.1, 0.7);
  s.rect(84, 60, 100, 10, '#0b0a0c');
  // the right wall: carved stone and a broken door
  s.rect(334, 0, 66, 200, s.lin([[0, '#1a1b1f'], [1, '#2a2b2f']], 0, 0, 1, 0));
  for (const y of [18, 44, 70, 96]) s.line(`M340 ${y}H394M346 ${y + 8}H388`, '#4a4c52', 0.9, 0.55);
  s.path('M352 200V86L376 76L396 90V200Z', '#2a1c12');
  s.line('M358 90V200M368 84V200M380 82V200', '#120c07', 1.4, 0.8);
  s.path('M352 200L394 120L398 140L372 200Z', '#3a2a1a', 0.8);
  // the shaft of light from a high shaft
  s.poly([[270, 0], [318, 0], [356, 162], [236, 162]], s.lin([[0, '#bfd8f5', 0.65], [0.7, '#7e9dc2', 0.22], [1, '#6f8bb0', 0]]), 0.9);
  s.lights(20, 250, 340, 10, 150, '#e8f1ff', 0.4, 0.9, 0.6);
  // the tomb and its stair
  s.rect(268, 96, 62, 20, s.lin([[0, '#c8ccd0'], [1, '#6b6f75']]));
  s.rect(262, 92, 74, 6, '#9da2a8');
  s.rect(284, 84, 30, 12, '#aeb3b8');
  s.poly([[268, 116], [330, 116], [346, 126], [254, 126]], '#5b5f65');
  for (let k = 0; k < 5; k++) {
    s.rect(250 - k * 7, 126 + k * 7, 100 + k * 14, 7, s.lin([[0, '#6e7278'], [1, '#2a2c30']]), 0.95 - k * 0.08);
  }
  // pillars (nearest first drawn last)
  const pillar = (x: number, w: number, top: number, shade: number): void => {
    s.rect(x, top, w, 200 - top, s.lin([[0, '#0d0e11'], [0.7, `rgba(${shade},${shade + 2},${shade + 6},1)`], [1, '#5b5e64']], 0, 0, 1, 0));
    s.rect(x - w * 0.14, top, w * 1.28, w * 0.22, '#2a2b30');
    s.rect(x - w * 0.1, 196 - w * 0.22, w * 1.2, w * 0.22, '#1c1d21');
    for (let k = 1; k < 5; k++) s.line(`M${r1(x)} ${r1(top + (k * (190 - top)) / 5)}h${r1(w)}`, '#000', 0.8, 0.35);
  };
  pillar(244, 14, 26, 38);
  pillar(172, 40, -4, 40);
  // floor: wet stone and rubble
  s.path('M120 200L190 150Q260 140 400 150V200Z', s.lin([[0, '#15161a'], [1, '#050506']]));
  s.rect(236, 150, 120, 50, s.lin([[0, '#9fb8d8', 0.35], [1, '#9fb8d8', 0]]), 0.7);
  s.line('M130 186L300 160M170 196L360 166', '#20222a', 1, 0.8);
  s.poly([[196, 176], [214, 168], [226, 178], [208, 186]], '#2a2b31');
  s.poly([[292, 170], [302, 164], [310, 172], [298, 176]], '#26272c');
  s.circ(256, 168, 3.2, '#b9b5a4', 0.8);
  // left darkness
  s.rect(0, 0, 150, 200, s.lin([[0, '#000', 1], [1, '#000', 0]], 0, 0, 1, 0), 0.8);
  return s;
}

// ── Amon Hen: ruins on a wooded hill in golden light ────────────────────────────
function amonHen(): Scene {
  const s = new Scene(66);
  s.rect(0, 0, 400, 200, s.lin([[0, '#3f566e'], [0.38, '#97a7ad'], [0.55, '#efc47e'], [1, '#6b4a1e']]));
  s.glow(338, 82, 120, '#ffd47a', 0.85, 0.8);
  s.ell(260, 40, 90, 8, '#d8c0a0', 0.4);
  // far mountains
  s.path('M250 112L296 70L318 48L338 74L360 56L400 96V130H250Z', '#7f8ea4', 0.85);
  s.path('M318 48L328 62L338 74L324 70L312 62Z', '#f1f4f6');
  s.ridge(112, 12, 14, '#5c6a5a', 0.75, 200, 410);
  s.rect(0, 96, 400, 40, s.lin([[0, '#f0d49a', 0], [1, '#f0d49a', 0.5]]));
  // the hill
  s.path('M200 200Q214 136 262 112Q320 84 400 92V200Z', s.lin([[0, '#8a7230'], [1, '#2a2312']], 0, 0, 0.2, 1));
  s.path('M262 112Q320 84 400 92V100Q330 94 276 124Z', '#f2cd7a', 0.5);
  // ruined colonnade and arches
  const col = (x: number, y: number, h: number, w: number): void => {
    s.path(`M${x} ${y + h}V${y + 3}L${x + w * 0.3} ${y - 2}L${x + w * 0.6} ${y + 2}L${x + w} ${y - 1}V${y + h}Z`, '#a58b5a');
    s.rect(x + w * 0.6, y, w * 0.4, h, '#4b3b20', 0.55);
  };
  for (const [x, y, h] of [[286, 70, 34], [302, 62, 42], [318, 66, 36], [350, 58, 44], [366, 68, 34]] as const) col(x, y, h, 6);
  s.line('M290 74Q310 50 330 72M354 62Q372 40 392 66', '#a58b5a', 4, 0.95);
  s.rect(280, 100, 120, 5, '#8a7348');
  // a tall statue, right
  s.path('M384 96V60Q386 48 392 46Q398 48 400 60V96Z', '#7d6a48');
  // staircase zigzagging up the hill
  s.line('M246 160L288 140L262 134L304 118L284 112L322 100', '#caa56a', 3, 0.75);
  // stream with a bright run
  s.path('M300 200Q330 168 352 152L372 150Q356 176 346 200Z', s.lin([[0, '#fbe6b0'], [1, '#6d5a30']]), 0.9);
  s.line('M330 196Q346 176 360 158', '#fff6dc', 1, 0.8);
  // autumn trees on the left
  for (const [x, w] of [[24, 22], [92, 14], [132, 10]] as const) {
    s.path(`M${x - w / 2} 200Q${x - w * 0.2} 100 ${x - w * 0.3} -4H${x + w * 0.5}Q${x + w * 0.2} 100 ${x + w * 0.6} 200Z`, '#140e08');
  }
  for (let i = 0; i < 30; i++) {
    const x = s.r() * 190 + 10;
    const y = s.r() * 70;
    s.circ(x, y, 6 + s.r() * 12, s.r() > 0.5 ? '#c9781e' : '#e6a73a', 0.55);
  }
  s.path('M-10 200V150Q60 140 150 176L200 200Z', '#0e0a05');
  s.lights(70, 0, 260, 120, 200, '#e0902a', 0.8, 2, 0.6);
  s.lights(26, 100, 400, 30, 120, '#ffe0a0', 0.5, 1, 0.5);
  return s;
}

// ── Helm's Deep: the Deeping Wall in storm and torchlight ───────────────────────
function helmsDeep(): Scene {
  const s = new Scene(77);
  s.rect(0, 0, 400, 200, s.lin([[0, '#080c16'], [0.55, '#1b2638'], [1, '#2b3347']]));
  s.ell(200, 24, 150, 18, '#2a3550', 0.7);
  s.ell(80, 10, 90, 12, '#33405e', 0.6);
  // lightning
  s.glow(120, 40, 60, '#a8c4ff', 0.35);
  s.line('M126 0L112 34L124 36L104 82', '#e8f0ff', 1.6, 0.95);
  s.line('M112 34L98 50', '#cfe0ff', 0.9, 0.8);
  // the keep on its cliff
  s.path('M246 90L262 40L300 20L330 8L400 0V150H246Z', '#10151f');
  s.path('M262 40L300 20L330 8V70L300 80L270 70Z', '#1a2030');
  for (const [x, y, w, h] of [[286, 30, 14, 40], [326, 18, 18, 60], [362, 10, 22, 70]] as const) {
    s.rect(x, y, w, h, '#202738');
    s.path(`M${x} ${y}h${w * 0.2}v-4h${w * 0.2}v4h${w * 0.2}v-4h${w * 0.2}v4h${w * 0.2}z`, '#202738');
    s.rect(x + w * 0.4, y + h * 0.3, 2.4, 4, '#ffb455');
  }
  // lit stair climbing the cliff
  s.line('M356 150L336 134L358 118L334 104L352 92L330 80', '#c8a060', 1.4, 0.55);
  s.lights(18, 322, 372, 80, 148, '#ff9d3a', 0.7, 1.3, 0.95);
  // wet stone path (left) with torch reflections
  s.path('M-10 200V112L140 124L250 140L230 200Z', s.lin([[0, '#1a2130'], [1, '#0b0f17']], 0, 0, 1, 1));
  for (const [x, w] of [[40, 3], [86, 2.4], [130, 2.2], [176, 2]] as const) s.rect(x, 130, w, 66, s.lin([[0, '#ff9d3a', 0.45], [1, '#ff9d3a', 0]]));
  s.line('M10 150H150M40 172H210', '#6a7a9a', 0.8, 0.18);
  // the Deeping Wall: a crenellated run in perspective with ladders
  s.path('M-10 70L270 104L272 150L-10 112Z', s.lin([[0, '#2a3040'], [1, '#161b27']], 0, 0, 1, 0));
  let mer = '';
  for (let x = -6; x < 266; x += 15) {
    const y = 70 + ((x + 10) / 280) * 34;
    mer += `M${x} ${r1(y)}v-6h8v6z`;
  }
  s.path(mer, '#2a3040');
  s.line('M-10 70L270 104', '#58627a', 1.1, 0.7);
  for (let k = 1; k < 5; k++) s.line(`M-10 ${70 + k * 8.4}L270 ${104 + k * 11.2}`, '#0d111a', 0.8, 0.5);
  for (const x of [52, 118, 176, 228]) {
    const y0 = 70 + ((x + 10) / 280) * 34;
    s.line(`M${x - 8} ${r1(y0 + 44)}L${x + 2} ${r1(y0 - 8)}M${x - 1} ${r1(y0 + 46)}L${x + 9} ${r1(y0 - 6)}`, '#4a3220', 1.6, 0.95);
    s.line(`M${x - 5} ${r1(y0 + 26)}l9 -1M${x - 3} ${r1(y0 + 10)}l8 -1`, '#4a3220', 1, 0.9);
  }
  for (const [x, y] of [[26, 74], [92, 83], [150, 91], [206, 97], [258, 104]] as const) {
    s.glow(x, y - 4, 9, '#ff9a34', 0.85);
    s.circ(x, y - 4, 1.8, '#ffd896');
  }
  // the gate tower and the white water beneath it
  s.rect(256, 92, 34, 58, '#171c28');
  s.path('M256 92h5v-5h6v5h6v-5h6v5h6v-5h5v5z', '#171c28');
  s.path('M262 150V126Q272 112 284 126V150Z', '#05070b');
  s.path('M288 130L330 120L400 150V200H300Z', s.lin([[0, '#e9f1f7'], [1, '#6c7f93']], 0, 0, 0.3, 1), 0.9);
  s.line('M300 150L340 140M310 170L370 158M326 186L396 172', '#ffffff', 1.2, 0.6);
  // the host below the wall
  s.lights(90, 150, 400, 150, 200, '#ff8a2a', 0.5, 1.3, 0.85);
  s.rect(150, 168, 250, 32, s.lin([[0, '#05070b', 0], [1, '#05070b', 0.7]]));
  s.rect(0, 0, 150, 200, s.lin([[0, '#000', 0.55], [1, '#000', 0]], 0, 0, 1, 0));
  return s;
}

// ── Pelennor Fields: smoke, the White City and a mûmak ──────────────────────────
function pelennor(): Scene {
  const s = new Scene(88);
  s.rect(0, 0, 400, 200, s.lin([[0, '#23201f'], [0.4, '#6a5d52'], [0.62, '#d9b988'], [1, '#2a1f17']]));
  s.glow(320, 62, 130, '#ffe2a4', 0.75, 0.8);
  // smoke columns
  s.path('M168 130Q150 100 172 72Q150 44 176 16L192 0H236Q214 30 232 60Q212 90 226 130Z', '#2a2523', 0.85);
  s.path('M300 120Q290 96 304 80Q296 60 310 42L320 20H340Q330 50 344 80Q330 96 336 120Z', '#3a3330', 0.6);
  // distant mountains
  s.ridge(112, 14, 16, '#6a6762', 0.7, 180, 410);
  // Minas Tirith: tiers on a mountain spur, topped by the white tower
  s.path('M262 130L286 84L322 56L350 70L400 52V132Z', '#8a826f', 0.9);
  const cx = 322;
  for (let k = 0; k < 6; k++) {
    const w = 104 - k * 15;
    const y = 124 - k * 13;
    s.rect(cx - w / 2, y - 13, w, 13, s.lin([[0, '#f6ecd2'], [1, '#c9bc9a']]));
    s.rect(cx - w / 2, y - 14, w, 2, '#fff8e4');
    s.rect(cx - w / 2 + w * 0.55, y - 13, w * 0.45, 13, '#8a7f66', 0.28);
    let win = '';
    for (let x = cx - w / 2 + 5; x < cx + w / 2 - 4; x += 8) win += `M${r1(x)} ${y - 8}v4h2v-4z`;
    s.path(win, '#6a6048', 0.7);
  }
  s.rect(cx - 5, 30, 10, 38, s.lin([[0, '#fbf3dc'], [1, '#c9bc9a']], 0, 0, 1, 0));
  s.path(`M${cx - 6} 30L${cx} 6L${cx + 6} 30Z`, '#f8f0d8');
  s.rect(cx - 12, 62, 24, 8, '#efe3c6');
  s.glow(302, 124, 30, '#ff7a2a', 0.6, 0.5);
  // siege tower
  s.rect(236, 82, 26, 52, '#3c1c14');
  s.rect(236, 82, 26, 6, '#5a2a1c');
  s.rect(240, 96, 18, 4, '#150a07');
  s.rect(240, 112, 18, 4, '#150a07');
  s.line('M249 82V62', '#241410', 1.4);
  s.poly([[249, 62], [261, 66], [249, 70]], '#8e2a1e');
  // the mûmak
  const mx = 366;
  s.ell(mx, 114, 46, 28, '#000', 0.18);
  s.path(`M${mx - 40} 134Q${mx - 44} 92 ${mx - 6} 88Q${mx + 30} 84 ${mx + 42} 104Q${mx + 48} 118 ${mx + 40} 136Z`, '#2d2824');
  s.ell(mx - 46, 106, 15, 16, '#2d2824');
  s.ell(mx - 28, 104, 13, 19, '#383029');
  s.line(`M${mx - 56} 112Q${mx - 70} 128 ${mx - 66} 146Q${mx - 64} 152 ${mx - 74} 148`, '#2d2824', 7);
  s.line(`M${mx - 52} 120Q${mx - 82} 120 ${mx - 86} 104`, '#e2d8b8', 2.2, 0.95);
  for (const dx of [-32, -12, 16, 34]) s.rect(mx + dx, 126, 10, 30, '#242019');
  s.line(`M${mx + 44} 108Q${mx + 54} 124 ${mx + 50} 140`, '#2d2824', 2);
  s.rect(mx - 26, 68, 56, 22, '#4a2a1a');
  s.rect(mx - 26, 68, 56, 4, '#7a3a24');
  s.line(`M${mx - 20} 68V44M${mx - 6} 68V38M${mx + 10} 68V42M${mx + 24} 68V48`, '#241410', 1.2);
  s.poly([[mx - 6, 38], [mx + 10, 44], [mx - 6, 50]], '#a22a1c');
  s.circ(mx - 50, 102, 1.5, '#e9cf9c', 0.9);
  // the muddy field with sky-lit puddles
  s.path('M-10 200V136Q120 128 410 134V200Z', s.lin([[0, '#4b3a2c'], [1, '#150f0b']]));
  for (const [x, y, w] of [[210, 168, 60], [320, 186, 74], [160, 190, 40]] as const) s.ell(x, y, w, 5, '#cdb48c', 0.38);
  // army line with spears and banners
  let fig = '';
  for (let x = 180; x < 400; x += 4 + s.r() * 3) fig += `M${r1(x)} 148v-9h2v9zM${r1(x + 1)} 139V${r1(128 - s.r() * 6)}`;
  s.path(fig, '#120d0a', 0.95, 'stroke="#120d0a" stroke-width=".7"');
  for (const x of [214, 262, 306]) {
    s.line(`M${x} 148V122`, '#120d0a', 0.9);
    s.poly([[x, 122], [x + 9, 125], [x, 129]], '#9a2a1c');
  }
  s.line('M170 172L186 190M186 170L172 192', '#2a1c12', 1.4);
  s.rect(0, 0, 130, 200, s.lin([[0, '#000', 0.4], [1, '#000', 0]], 0, 0, 1, 0));
  return s;
}

// ── The Black Gate: the Teeth of Mordor under a burning sky ─────────────────────
function blackGate(): Scene {
  const s = new Scene(99);
  s.rect(0, 0, 400, 200, s.lin([[0, '#0f0707'], [0.45, '#561a10'], [0.7, '#c4501e'], [1, '#2a0e08']]));
  s.glow(360, 70, 120, '#ff7a30', 0.7, 0.8);
  s.ell(190, 18, 130, 12, '#1b0c0a', 0.85);
  s.ell(300, 40, 90, 8, '#2a1210', 0.8);
  // Mount Doom with its plume
  s.path('M326 120L358 66L368 58L382 66L412 120Z', '#1c0e0c');
  s.path('M356 70Q348 40 372 20Q360 6 380 -6', 'none', 1, 'stroke="#2a1a18" stroke-width="12" stroke-linecap="round" opacity=".7"');
  s.glow(371, 62, 20, '#ff6a1a', 1, 0.7);
  s.line('M368 66L360 90L368 108M376 66L382 96', '#ff7a2a', 1.2, 0.9);
  // the two towers and the gate between them
  const tower = (x: number, w: number, top: number): void => {
    s.rect(x, top, w, 150 - top, s.lin([[0, '#120c0b'], [1, '#2a1a16']], 0, 0, 1, 0));
    let sp = '';
    for (let k = 0; k < 6; k++) sp += `M${r1(x + (w / 6) * k)} ${top}l${r1(w / 12)} -9l${r1(w / 12)} 9z`;
    s.path(sp, '#120c0b');
    s.rect(x - 4, top + 18, w + 8, 6, '#1a110f');
    s.rect(x + w * 0.4, top + 34, 3, 7, '#ff5a1a');
    s.rect(x + w * 0.4, top + 64, 3, 7, '#ff5a1a');
  };
  tower(222, 26, 28);
  tower(292, 26, 22);
  s.rect(248, 96, 44, 54, '#150e0c');
  s.path('M254 150V112Q270 98 286 112V150Z', '#050303');
  s.rect(248, 88, 44, 4, '#1a110f');
  let teeth = '';
  for (let x = 246; x < 292; x += 5) teeth += `M${x} 88l2.5 -8l2.5 8z`;
  s.path(teeth, '#150e0c');
  // flanking walls with spikes
  s.rect(150, 118, 72, 32, '#150e0c');
  s.rect(318, 112, 90, 38, '#150e0c');
  let sp2 = '';
  for (let x = 152; x < 222; x += 6) sp2 += `M${x} 118l3 -7l3 7z`;
  for (let x = 320; x < 406; x += 6) sp2 += `M${x} 112l3 -7l3 7z`;
  s.path(sp2, '#150e0c');
  // eagles
  const eagle = (x: number, y: number, k: number): Scene =>
    s.path(`M${x} ${y}Q${x - 8 * k} ${y - 7 * k} ${x - 18 * k} ${y - 2 * k}Q${x - 9 * k} ${y - 1 * k} ${x} ${y + 3 * k}Q${x + 9 * k} ${y - 1 * k} ${x + 18 * k} ${y - 2 * k}Q${x + 8 * k} ${y - 7 * k} ${x} ${y}Z`, '#0b0605');
  eagle(268, 50, 1.3);
  eagle(212, 34, 0.8);
  eagle(240, 70, 0.6);
  // the lava-lit plain and the host
  s.path('M-10 200V150Q100 142 410 148V200Z', s.lin([[0, '#1b0d0a'], [1, '#080303']]));
  s.line('M170 166L230 160L260 172L330 164L400 172M200 190L240 180L300 188', '#ff6a1a', 1.2, 0.85);
  s.glow(260, 170, 70, '#ff5a1a', 0.35, 0.3);
  s.lights(110, 150, 400, 148, 190, '#ff8a2a', 0.4, 1.2, 0.8);
  s.path('M180 200Q230 168 300 176L400 164V200Z', '#0a0504');
  s.rect(0, 0, 120, 200, s.lin([[0, '#000', 0.5], [1, '#000', 0]], 0, 0, 1, 0));
  return s;
}

// ── fallbacks: the dev arena and a generic forest ───────────────────────────────
function arena(): Scene {
  const s = new Scene(111);
  s.rect(0, 0, 400, 200, s.lin([[0, '#222a2e'], [1, '#0e1315']]));
  s.glow(300, 60, 110, '#8aa0aa', 0.35);
  s.path('M120 150L400 130V200H120Z', '#12181a');
  for (const x of [220, 260, 300, 340, 380]) s.rect(x, 90, 8, 50, '#1b2326');
  s.line('M150 150H400M170 164H400M190 180H400', '#34424a', 1, 0.6);
  return s;
}

function menu(): Scene {
  const s = new Scene(122);
  s.rect(0, 0, 400, 200, s.lin([[0, '#2b3c33'], [0.5, '#16231b'], [1, '#070b08']]));
  s.glow(300, 50, 110, '#d8c98c', 0.4);
  s.pines(150, 410, 160, 50, 110, '#0c150f', 0.9, 10);
  s.pines(120, 410, 180, 60, 130, '#070c08', 1, 14);
  return s;
}

const MAKERS: Record<string, () => Scene> = {
  mirkwood,
  forest_river: barrels,
  laketown_night: laketown,
  ravenhill_winter: ravenhill,
  moria,
  amon_hen: amonHen,
  helms_deep_storm: helmsDeep,
  pelennor,
  black_gate: blackGate,
  arena,
  menu,
};

const cache = new Map<string, string>();

/** SVG markup for a chapter card banner, keyed by the chapter's environment name (falls back to a forest) */
export function chapterBanner(environment: string, cls = ''): string {
  const key = environment in MAKERS ? environment : 'menu';
  let svg = cache.get(key);
  if (!svg) {
    svg = MAKERS[key]().svg('');
    cache.set(key, svg);
  }
  // gradient ids are per scene, so the same markup may be reused any number of times on a page
  return cls ? svg.replace('class="gl-banner ', `class="gl-banner ${cls} `) : svg;
}

export const BANNER_ENVIRONMENTS = Object.keys(MAKERS);
