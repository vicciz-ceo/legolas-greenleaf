/** Device-aware prompt glyphs (key caps, gamepad buttons, touch icons) and the binding tables. */
import type { Device } from './bus';
import { icon, type IconName } from './icons';

export type PromptAction = 'interact' | 'jump' | 'melee' | 'focus' | 'draw';

export const key = (label: string) => `<span class="gl-key">${label}</span>`;
export const pad = (label: string, color?: 'a' | 'b' | 'x' | 'y') =>
  `<span class="gl-pad${color ? ' gl-pad-' + color : ''}">${label}</span>`;
export const padWide = (label: string) => `<span class="gl-pad gl-pad-wide">${label}</span>`;
export const mouse = (kind: 'mouse' | 'mouse_l' | 'mouse_r' | 'mouse_w') => icon(kind, 'gl-mouse');

const TOUCH_ICON: Record<PromptAction, IconName> = {
  interact: 'interact',
  jump: 'jump',
  melee: 'knives',
  focus: 'focus',
  draw: 'draw',
};

export function promptGlyph(action: PromptAction, device: Device): string {
  if (device === 'gamepad') {
    switch (action) {
      case 'interact': return pad('Y', 'y');
      case 'jump': return pad('A', 'a');
      case 'melee': return pad('X', 'x');
      case 'focus': return padWide('LB');
      case 'draw': return padWide('RT');
    }
  }
  if (device === 'touch') return `<span class="gl-tglyph">${icon(TOUCH_ICON[action])}</span>`;
  switch (action) {
    case 'interact': return key('F');
    case 'jump': return key('Space');
    case 'melee': return key('E');
    case 'focus': return key('Q');
    case 'draw': return mouse('mouse_l');
  }
}

export interface BindingRow {
  action: string;
  kbm: string;
  pad: string;
  touch: string;
}

const sep = '<span class="gl-sep">/</span>';
const plus = '<span class="gl-sep">+</span>';

export const BINDINGS: BindingRow[] = [
  { action: 'Move', kbm: `${key('W')}${key('A')}${key('S')}${key('D')}`, pad: `${padWide('LS')}`, touch: 'Left stick' },
  { action: 'Look', kbm: `${mouse('mouse')} Mouse`, pad: `${padWide('RS')}`, touch: 'Drag right side' },
  { action: 'Draw / loose bow', kbm: `${mouse('mouse_l')} Hold, release`, pad: `${padWide('RT')} Hold, release`, touch: 'Draw button' },
  { action: 'Aim', kbm: `${mouse('mouse_r')} Hold`, pad: `${padWide('LT')} Hold`, touch: 'Aim button' },
  { action: 'Twin knives', kbm: `${key('E')}${sep}${key('V')}`, pad: pad('X', 'x'), touch: 'Knives button' },
  { action: 'Jump (double jump)', kbm: key('Space'), pad: pad('A', 'a'), touch: 'Jump button' },
  { action: 'Dash', kbm: `${key('Ctrl')}${sep}${key('C')}`, pad: pad('B', 'b'), touch: 'Dash button' },
  { action: 'Sprint', kbm: `${key('Shift')} Hold`, pad: `${padWide('L3')}`, touch: 'Pull stick far' },
  { action: 'Focus', kbm: `${key('Q')} Hold`, pad: `${padWide('LB')} Hold`, touch: 'Focus button' },
  { action: 'Interact', kbm: key('F'), pad: pad('Y', 'y'), touch: 'Interact button' },
  { action: 'Arrow type', kbm: `${key('1')}${key('2')}${key('3')}${sep}${key('Tab')}${sep}${mouse('mouse_w')}`, pad: `${padWide('RB')}`, touch: 'Arrow button' },
  { action: 'Pause', kbm: `${key('Esc')}${sep}${key('P')}`, pad: padWide('Start'), touch: 'Pause button' },
];

export const MENU_HINTS: Record<Device, string> = {
  kbm: `${key('↑')}${key('↓')}${key('←')}${key('→')}<em>Navigate</em>${key('Enter')}<em>Select</em>${key('Esc')}<em>Back</em>`,
  gamepad: `${padWide('D-Pad')}<em>Navigate</em>${pad('A', 'a')}<em>Select</em>${pad('B', 'b')}<em>Back</em>`,
  touch: '',
};

void plus;
