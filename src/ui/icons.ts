/** Inline SVG icon set (all drawn in code, 32x32 grid, currentColor strokes). */

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

export type IconName = keyof typeof ICON_PATHS;

export function icon(name: IconName, cls = '', sw = 1.6): string {
  return `<svg class="gl-ic ${cls}" viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${ICON_PATHS[name]}</svg>`;
}

export const ARROW_ICON = {
  standard: 'arrow_standard',
  piercing: 'arrow_piercing',
  triple: 'arrow_triple',
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
