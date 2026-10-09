/**
 * Inline SVG icon set, all drawn in code.
 *  - REF_PATHS: the 33 hand-written 24x24 filled glyphs from the art pass (docs/refs/ui/icons), currentColor.
 *  - ICON_PATHS: the older 32x32 stroked glyphs, kept for anything the reference set does not cover.
 * icon(name) prefers the reference glyph when both exist.
 */

/** reference glyphs: 24x24, fill-rule evenodd, filled with currentColor */
export const REF_PATHS = {
  agility: 'M6 4h2l2 8 5-1 5-7 2 1-4 9-8 2-4 6-2-1 4-7L6 4Zm9 15 6 2-1 2-6-2 1-2Z',
  arrow_damage: 'M11 2 4 12h6l-3 10 13-14h-7l3-6h-5Z',
  arrow_piercing: 'M12 2 6 10h5v7l-3 3 2 1 2-2 2 2 2-1-3-3v-7h5L12 2Z M11 11h2v3h-2Z',
  arrow_standard: 'M11 3 7 8h4v9l-3 3 2 1 2-2 2 2 2-1-3-3V8h4l-4-5Z',
  arrow_triple: 'M5 3 2 8h2v12h2V8h2L5 3Zm7-1-3 5h2v14h2V7h2l-3-5Zm7 1-3 5h2v12h2V8h2l-3-5Z',
  chapters: 'M2 4c4-1 7 0 10 2 3-2 6-3 10-2v15c-4-1-7 0-10 2-3-2-6-3-10-2V4Zm2 2v11c3 0 5 1 7 2V8C9 6 6 6 4 6Zm9 2v11c2-1 4-2 7-2V6c-2 0-5 0-7 2Z',
  checkpoint: 'M4 2h2v20H4V2Zm3 1h13l-4 5 4 5H7V3Z',
  controls: 'M6 6h12c4 0 7 13 3 15-2 1-4-4-6-4H9c-2 0-4 5-6 4C-1 19 2 6 6 6Zm0 3v3H3v2h3v3h2v-3h3v-2H8V9H6Zm11 1h2v2h-2v-2Zm-3 3h2v2h-2v-2Zm6 0h2v2h-2v-2Zm-3 3h2v2h-2v-2Z',
  credits: 'M12 2a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM5 22v-4c0-8 14-8 14 0v4H5Z',
  draw_speed: 'M3 3c12 1 12 17 0 18v-2c9-1 9-13 0-14V3Zm1 2 7 7-7 7 1 1 8-8L5 4 4 5Zm9 5h6V7l4 5-4 5v-3h-6v-4Z',
  focus: 'M1 12C6 3 18 3 23 12c-5 9-17 9-22 0Zm3 0c4 6 12 6 16 0-4-6-12-6-16 0Zm12 0a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z',
  gamepad_a: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm0 2a8 8 0 1 1 0 16 8 8 0 0 1 0-16ZM11 6h2l4 12h-2l-1-3h-4l-1 3H7l4-12Zm1 3-1 4h2l-1-4Z',
  gamepad_b: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm0 2a8 8 0 1 1 0 16 8 8 0 0 1 0-16ZM8 6h5c5 0 5 5 2 6 4 2 2 6-2 6H8V6Zm2 2v3h3c2 0 2-3 0-3h-3Zm0 5v3h3c2 0 2-3 0-3h-3Z',
  gamepad_lb: 'M2 3h20v18H2V3Zm2 2v14h16V5H4ZM6 7h2v8h4v2H6V7ZM13 7h4c4 0 4 4 2 5 3 1 2 5-2 5h-4V7Zm2 2v2h2c1 0 1-2 0-2h-2Zm0 4v2h2c1 0 1-2 0-2h-2Z',
  gamepad_lt: 'M2 3h20v18H2V3Zm2 2v14h16V5H4ZM6 7h2v8h4v2H6V7ZM13 7h9v2h-3v8h-3V9h-3V7Z',
  gamepad_rb: 'M2 3h20v18H2V3Zm2 2v14h16V5H4ZM5 7h4c5 0 5 5 1 6l3 4h-3l-3-4v4H5V7Zm2 2v2h2c2 0 2-2 0-2H7ZM13 7h4c4 0 4 4 2 5 3 1 2 5-2 5h-4V7Zm2 2v2h2c1 0 1-2 0-2h-2Zm0 4v2h2c1 0 1-2 0-2h-2Z',
  gamepad_rt: 'M2 3h20v18H2V3Zm2 2v14h16V5H4ZM5 7h4c5 0 5 5 1 6l3 4h-3l-3-4v4H5V7Zm2 2v2h2c2 0 2-2 0-2H7ZM13 7h9v2h-3v8h-3V9h-3V7Z',
  gamepad_stick_left: 'M12 2a8 8 0 1 0 0 16 8 8 0 0 0 0-16Zm0 2a6 6 0 1 1 0 12 6 6 0 0 1 0-12ZM7 8h2v4h4v2H7V8Zm3 11h4l3 3H7l3-3Z',
  gamepad_stick_right: 'M12 2a8 8 0 1 0 0 16 8 8 0 0 0 0-16Zm0 2a6 6 0 1 1 0 12 6 6 0 0 1 0-12ZM8 7h5c4 0 4 5 1 5l3 3h-3l-3-3h-1v3H8V7Zm2 2v1h3c1 0 1-1 0-1h-3ZM10 19h4l3 3H7l3-3Z',
  gamepad_x: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm0 2a8 8 0 1 1 0 16 8 8 0 0 1 0-16ZM7 7h3l2 3 2-3h3l-4 5 4 5h-3l-2-3-2 3H7l4-5-4-5Z',
  gamepad_y: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm0 2a8 8 0 1 1 0 16 8 8 0 0 1 0-16ZM7 7h3l2 4 2-4h3l-4 7v4h-2v-4L7 7Z',
  gimli_axe: 'M10 2h3v20h-3V2ZM5 4l5 2v7L3 10 2 6 5 4Zm11 0 6 2-1 4-8 3V6l3-2Z',
  health: 'M20 2C7 1 2 7 4 16l-2 5 2 1 3-6c10 2 16-6 13-14ZM6 14 17 5 8 16l-2-2Z',
  key_cap: 'M3 4h18a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Zm0 2v13h18V6H3Zm3 10h12v1H6v-1Z',
  knife_mastery: 'M4 2c6 4 8 7 7 11l-3 1-6-9 2-3Zm7 11 2-2 8 8-3 3-7-9ZM7 16l2-2 8 8-2 1-8-7Z',
  knives: 'M3 2 11 10 9 12 2 4 3 2Zm18 0 1 2-7 8-2-2 8-8ZM7 11l6 6-2 2-6-6 2-2Zm10 0 2 2-6 6-2-2 6-6ZM10 18l2 2-3 3-2-2 3-3Zm4 0 3 3-2 2-3-3 2-2Z',
  legolas_arrow: 'M11 2 7 7h4v10l-4 4 2 1 3-3 3 3 2-1-4-4V7h4l-5-5Z',
  lock: 'M5 10V8C5-1 19-1 19 8v2h2v12H3V10h2Zm3 0h8V8C16 3 8 3 8 8v2Zm3 4v4h2v-4h-2Z',
  piercing_arrows: 'M12 1 7 8h4v14h2V8h4l-5-7ZM2 10h6v2H2v-2Zm14 0h6v2h-6v-2ZM2 15h6v2H2v-2Zm14 0h6v2h-6v-2Z',
  rank_laurel: 'M3 4c-3 8 0 15 7 18l1-2C5 18 3 12 5 5L3 4Zm18 0-2 1c2 7 0 13-6 15l1 2c7-3 10-10 7-18ZM1 8l5 1-3 4-2-5Zm1 7 6-1-1 5-5-4ZM23 8l-5 1 3 4 2-5Zm-1 7-6-1 1 5 5-4Z',
  settings: 'M10 2h4l1 3 3-1 3 3-1 3 3 1v4l-3 1 1 3-3 3-3-1-1 3h-4l-1-3-3 1-3-3 1-3-3-1v-4l3-1-1-3 3-3 3 1 1-3Zm2 5a5 5 0 1 0 0 10 5 5 0 0 0 0-10Z',
  triple_shot: 'M5 2 2 7h2v15h2V7h2L5 2Zm7 0L9 7h2v15h2V7h2l-3-5Zm7 0-3 5h2v15h2V7h2l-3-5Z',
  vitality: 'M12 3c6-5 14 4 6 11l-6 8-6-8C-2 7 6-2 12 3Zm-1 4v4H7v2h4v4h2v-4h4v-2h-4V7h-2Z',
} as const;

/** old names that now resolve to a reference glyph */
const ALIAS = { leaf: 'health', axe: 'gimli_axe', up_vit: 'vitality', up_agi: 'agility', up_draw: 'draw_speed' } as const;


const A = (len = 24) => `M${28 - len} 16H27M27 16l-5-3.6M27 16l-5 3.6`;

const fletch = 'M4 16l-2.4-3M4 16l-2.4 3M8 16l-2.4-3M8 16l-2.4 3';

export const ICON_PATHS = {
  // arrow types
  arrow_standard: `<g transform="rotate(-38 16 16)"><path d="M5 16H28"/><path d="M28 16l-6-4.2v8.4z" fill="currentColor"/><path d="M5 16l-3-3.4M5 16l-3 3.4M9.5 16l-3-3.4M9.5 16l-3 3.4"/></g>`,
  arrow_piercing: `<g transform="rotate(-38 16 16)"><path d="M3 16H30"/><path d="M30 16l-8-2.6v5.2z" fill="currentColor"/><path d="M3 16l-1.6-3M3 16l-1.6 3M7 16l-1.6-3M7 16l-1.6 3"/><ellipse cx="15" cy="16" rx="2.6" ry="7.4" stroke-width="1.3"/></g>`,
  arrow_triple: `<g><g transform="rotate(-62 16 16)"><path d="M7 16H27"/><path d="M27 16l-5-3.2v6.4z" fill="currentColor"/></g><g transform="rotate(-38 16 16)"><path d="M5 16H29"/><path d="M29 16l-5.4-3.4v6.8z" fill="currentColor"/><path d="M5 16l-2.6-3M5 16l-2.6 3"/></g><g transform="rotate(-14 16 16)"><path d="M7 16H27"/><path d="M27 16l-5-3.2v6.4z" fill="currentColor"/></g></g>`,
  // touch / prompt icons
  draw: `<path d="M13 4C26 9 26 23 13 28"/><path d="M13 4L8.5 16 13 28"/><path d="M8.5 16H28"/><path d="M28 16l-4.6-3.2v6.4z" fill="currentColor"/>`,
  aim: `<circle cx="16" cy="16" r="8.2"/><path d="M16 3v6.5M16 22.5V29M3 16h6.5M22.5 16H29"/><circle cx="16" cy="16" r="1.2" fill="currentColor"/>`,
  knives: `<path d="M26 6L13.4 18.6" stroke-width="2.4"/><path d="M10.6 15.6l5.8 5.8"/><path d="M13.6 19.4L7 26"/><path d="M6 6l12.6 12.6" stroke-width="2.4"/><path d="M21.4 15.6l-5.8 5.8"/><path d="M18.4 19.4L25 26"/>`,
  jump: `<path d="M8 17l8-8 8 8"/><path d="M8 25l8-8 8 8"/>`,
  dash: `<path d="M3 11h8M1.5 16h9M3 21h8"/><path d="M15 8.5l12 7.5-12 7.5z" fill="currentColor" fill-opacity=".25"/>`,
  focus: `<path d="M2.5 16Q16 4.5 29.5 16 16 27.5 2.5 16z"/><circle cx="16" cy="16" r="4.4"/><circle cx="16" cy="16" r="1.3" fill="currentColor"/>`,
  interact: `<circle cx="16" cy="16" r="12"/><path d="M16 8.5l1.9 5.6 5.6 1.9-5.6 1.9-1.9 5.6-1.9-5.6-5.6-1.9 5.6-1.9z" fill="currentColor" fill-opacity=".3"/>`,
  next: `<path d="M6.5 12.5A10 10 0 0 1 24 9"/><path d="M24.5 4v5.5H19"/><path d="M25.5 19.5A10 10 0 0 1 8 23"/><path d="M7.5 28v-5.5H13"/>`,
  pause: `<path d="M11.5 8v16M20.5 8v16" stroke-width="2.6"/>`,
  // hud
  leaf: `<path d="M5 27C5 13 13 5 27 5c0 14-8 22-22 22z" fill="currentColor" fill-opacity=".22"/><path d="M5 27L20 12"/>`,
  axe: `<path d="M8 27L21 9"/><path d="M17 6.5C21.5 3 27.5 5 28.5 11.5 24 11.5 19 10.5 17 6.5z" fill="currentColor" fill-opacity=".45"/><path d="M17 6.5c1 4 6 5 11.500 5"/>`,
  rune: `<path d="M16 3l11 13-11 13L5 16z"/><path d="M16 10v12M11.5 14.5L16 10l4.5 4.5"/>`,
  diamond: `<path d="M16 4l10 12-10 12L6 16z" fill="currentColor" fill-opacity=".3"/>`,
  star: `<path d="M16 3l3.4 9.6L29 16l-9.600 3.400L16 29l-3.400-9.600L3 16l9.600-3.400z" fill="currentColor" fill-opacity=".3"/>`,
  warn: `<path d="M16 4L29 27H3z"/><path d="M16 13v7M16 23.400v.6" stroke-width="2"/>`,
  info: `<circle cx="16" cy="16" r="12"/><path d="M16 14.500V23M16 9.500v.5" stroke-width="2"/>`,
  lock: `<rect x="7.500" y="14" width="17" height="13" rx="2.500"/><path d="M11 14v-3.500a5 5 0 0 1 10 0V14"/><circle cx="16" cy="20.500" r="1.400" fill="currentColor"/>`,
  check: `<path d="M6 17l7 7L26 8" stroke-width="2.4"/>`,
  gem: `<path d="M9 5h14l6 7-13 16L3 12z"/><path d="M3 12h26M12.500 5L10 12l6 16 6-16-2.500-7"/>`,
  mouse: `<rect x="9" y="3.500" width="14" height="25" rx="7"/><path d="M9 14h14M16 3.500V14"/>`,
  mouse_l: `<rect x="9" y="3.500" width="14" height="25" rx="7"/><path d="M9 14h14M16 3.500V14"/><path d="M16 3.500A7 7 0 0 0 9 10.500V14h7z" fill="currentColor"/>`,
  mouse_r: `<rect x="9" y="3.500" width="14" height="25" rx="7"/><path d="M9 14h14M16 3.500V14"/><path d="M16 3.500A7 7 0 0 1 23 10.500V14h-7z" fill="currentColor"/>`,
  mouse_w: `<rect x="9" y="3.500" width="14" height="25" rx="7"/><path d="M9 14h14M16 3.500V14"/><rect x="14.600" y="6.500" width="2.800" height="5" rx="1.400" fill="currentColor"/>`,
  stick: `<circle cx="16" cy="16" r="11"/><circle cx="16" cy="16" r="4.500" fill="currentColor" fill-opacity=".35"/>`,
  dpad: `<path d="M12 4h8v8h8v8h-8v8h-8v-8H4v-8h8z"/>`,
  touch: `<circle cx="16" cy="12" r="5"/><path d="M16 17v10M10 22l6 5 6-5"/>`,
  back: `<path d="M20 6L10 16l10 10"/>`,
  close: `<path d="M8 8l16 16M24 8L8 24"/>`,
  // upgrades
  up_draw: `<path d="M13 4C26 9 26 23 13 28"/><path d="M13 4L8.500 16 13 28"/><path d="M8.500 16H28"/><path d="M28 16l-4.600-3.200v6.400z" fill="currentColor"/>`,
  up_vit: `<path d="M5 27C5 13 13 5 27 5c0 14-8 22-22 22z" fill="currentColor" fill-opacity=".22"/><path d="M5 27L20 12"/>`,
  up_agi: `<path d="M3 20c6-1 9-5 11-12 1 5 4 8 9 9-4 1-7 3-9 8-1-4-5-6-11-5z" fill="currentColor" fill-opacity=".25"/><path d="M20 24l8-4"/>`,
} as const;

export type IconName = keyof typeof ICON_PATHS | keyof typeof REF_PATHS;

const stroked = (name: keyof typeof ICON_PATHS, cls: string, sw: number): string =>
  `<svg class="gl-ic ${cls}" viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${ICON_PATHS[name]}</svg>`;

export function icon(name: IconName, cls = '', sw = 1.6): string {
  const ref = (name in ALIAS ? ALIAS[name as keyof typeof ALIAS] : name) as keyof typeof REF_PATHS;
  if (ref in REF_PATHS) {
    return `<svg class="gl-ic gl-ic-ref ${cls}" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false"><path fill-rule="evenodd" d="${REF_PATHS[ref]}"/></svg>`;
  }
  return stroked(name as keyof typeof ICON_PATHS, cls, sw);
}

export const ARROW_ICON = {
  standard: 'arrow_standard',
  piercing: 'arrow_piercing',
  triple: 'triple_shot',
} as const;

/** a small ornamental divider: line - diamond - line */
export function ornament(cls = ''): string {
  return `<svg class="gl-orn ${cls}" viewBox="0 0 240 14" preserveAspectRatio="xMidYMid meet" fill="none" stroke="currentColor" stroke-width="1" aria-hidden="true"><path d="M0 7H100" opacity=".7"/><path d="M140 7H240" opacity=".7"/><path d="M120 1.500L126.500 7 120 12.500 113.500 7z" fill="currentColor" fill-opacity=".85"/><path d="M104 7l5-3.200M104 7l5 3.200M136 7l-5-3.200M136 7l-5 3.200" opacity=".8"/></svg>`;
}

/** the Greenleaf emblem: a leaf crossed by a drawn bow */
export function emblem(cls = ''): string {
  return `<svg class="gl-emblem ${cls}" viewBox="0 0 120 120" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <circle cx="60" cy="60" r="55" stroke-width="1" opacity=".55"/>
  <circle cx="60" cy="60" r="50" stroke-width=".6" opacity=".35" stroke-dasharray="1 4.200"/>
  <path d="M60 18C84 34 90 62 60 102 30 62 36 34 60 18z" stroke-width="1.6" fill="currentColor" fill-opacity=".12"/>
  <path d="M60 24V98" stroke-width="1.2"/>
  <path d="M60 44L48 36M60 44l12-8M60 58L45 48M60 58l15-10M60 72L46 62M60 72l14-10M60 86L50 77M60 86l10-9" stroke-width=".8" opacity=".75"/>
  <path d="M24 38C10 54 10 70 24 86" stroke-width="1.4" opacity=".9"/>
  <path d="M96 38c14 16 14 32 0 48" stroke-width="1.4" opacity=".9"/>
  <path d="M24 38L60 62 96 38" stroke-width=".7" opacity=".55"/>
  <path d="M60 10l3 4.500-3 4.500-3-4.500z" fill="currentColor" stroke-width=".8"/>
</svg>`;
}

/**
 * The GREENLEAF wordmark (restrained narrow capitals plus a leaf, hand-drawn paths from the art pass).
 * Fills with currentColor; the hairline under the letters is part of the mark.
 */
export function wordmark(cls = ''): string {
  return `<svg class="gl-wordmark ${cls}" viewBox="0 0 940 180" fill="currentColor" role="img" aria-label="Greenleaf"><path d="M105 8C54 2 9 36 20 91c42 5 89-27 85-83ZM28 84 94 17 37 89l-9-5Z" transform="translate(4 32)"/><path d="M60 9C30-8 2 8 2 50c0 40 28 58 61 40V48H35v7h20v30C30 96 10 81 10 50 10 18 31 3 57 16l3-7Z" transform="translate(150 40)"/><path d="M3 0h27c40 0 42 49 8 55l31 45H59L29 56H11v44H3V0Zm8 8v40h19c30 0 30-40 0-40H11Z" transform="translate(235 40)"/><path d="M3 0h58v8H11v38h42v8H11v38h50v8H3V0Z" transform="translate(320 40)"/><path d="M3 0h58v8H11v38h42v8H11v38h50v8H3V0Z" transform="translate(405 40)"/><path d="M3 0h9l46 83V0h8v100h-9L11 17v83H3V0Z" transform="translate(490 40)"/><path d="M3 0h8v92h50v8H3V0Z" transform="translate(575 40)"/><path d="M3 0h58v8H11v38h42v8H11v38h50v8H3V0Z" transform="translate(660 40)"/><path d="M29 0h10l31 100h-9l-9-29H16l-9 29H-2L29 0Zm5 13L19 63h30L34 13Z" transform="translate(745 40)"/><path d="M3 0h58v8H11v39h42v8H11v45H3V0Z" transform="translate(830 40)"/><path d="M155 158h674v1H155Z" opacity=".6"/></svg>`;
}

/** the leaf from the wordmark on its own */
export function leafMark(cls = ''): string {
  return `<svg class="gl-leafmark ${cls}" viewBox="8 0 100 96" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" d="M105 8C54 2 9 36 20 91c42 5 89-27 85-83ZM28 84 94 17 37 89l-9-5Z"/></svg>`;
}
