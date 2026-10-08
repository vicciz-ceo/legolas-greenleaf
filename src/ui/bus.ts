/**
 * Tiny shared state between input.ts, the HUD, the touch controls and the menus.
 * (The Hud contract has no access to the Input object, so the active device and a few
 * display hints travel through this module instead.)
 */
import type { ArrowType } from '../core/types';

export type Device = 'kbm' | 'gamepad' | 'touch';

let device: Device = 'kbm';
const deviceListeners = new Set<(d: Device) => void>();

export function getDevice(): Device {
  return device;
}

export function setDevice(d: Device): void {
  if (d === device) return;
  device = d;
  for (const cb of deviceListeners) cb(d);
}

export function onDevice(cb: (d: Device) => void): () => void {
  deviceListeners.add(cb);
  return () => deviceListeners.delete(cb);
}

let arrow: ArrowType = 'standard';
const arrowListeners = new Set<(a: ArrowType) => void>();

export function getArrow(): ArrowType {
  return arrow;
}

export function setArrow(a: ArrowType): void {
  if (a === arrow) return;
  arrow = a;
  for (const cb of arrowListeners) cb(a);
}

export function onArrow(cb: (a: ArrowType) => void): () => void {
  arrowListeners.add(cb);
  return () => arrowListeners.delete(cb);
}
