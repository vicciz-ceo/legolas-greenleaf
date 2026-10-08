/**
 * World-side quality knob. Builders that scale density (grass, crowds, foliage cards) call
 * `worldQuality()`. It defaults to ?quality=… from the URL, then the saved settings, then 'high', and
 * can be forced with `setWorldQuality()` (the lab and tools do).
 */
import type { Quality } from '../core/types';

const ORDER: Quality[] = ['low', 'medium', 'high', 'ultra'];
let forced: Quality | null = null;
let detected: Quality | null = null;

export function setWorldQuality(q: Quality | null): void {
  forced = q;
}

export function worldQuality(): Quality {
  if (forced) return forced;
  if (detected) return detected;
  let q: Quality = 'high';
  try {
    const url = new URLSearchParams(typeof location !== 'undefined' ? location.search : '').get('quality');
    if (url && ORDER.includes(url as Quality)) q = url as Quality;
    else if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem('greenleaf.save.v1');
      const s = raw ? (JSON.parse(raw) as { settings?: { quality?: Quality } }).settings?.quality : undefined;
      if (s && ORDER.includes(s)) q = s;
    }
  } catch {
    /* storage unavailable */
  }
  detected = q;
  return q;
}

/** density multiplier: low 0.35, medium 0.65, high 1, ultra 1.3 */
export function densityScale(q: Quality = worldQuality()): number {
  return q === 'low' ? 0.35 : q === 'medium' ? 0.65 : q === 'high' ? 1 : 1.3;
}
