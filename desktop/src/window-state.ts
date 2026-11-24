import { readFileSync, writeFileSync } from 'node:fs';

export interface WindowState {
  x?: number;
  y?: number;
  width: number;
  height: number;
  maximized: boolean;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const MIN_WIDTH = 900;
export const MIN_HEIGHT = 600;
export const DEFAULT_STATE: WindowState = { width: 1280, height: 800, maximized: false };

/** How much of the window must still be on some screen (enough to grab the title bar). */
const MIN_VISIBLE_WIDTH = 100;
const MIN_VISIBLE_HEIGHT = 50;

const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function visibleOn(b: Rect, screens: Rect[]): boolean {
  return screens.some((s) => {
    const w = Math.min(b.x + b.width, s.x + s.width) - Math.max(b.x, s.x);
    const h = Math.min(b.y + b.height, s.y + s.height) - Math.max(b.y, s.y);
    return w >= MIN_VISIBLE_WIDTH && h >= MIN_VISIBLE_HEIGHT;
  });
}

/** The window to open: the saved state if it still fits on one of `screens` (work areas), else the defaults. */
export function restoreState(saved: unknown, screens: Rect[]): WindowState {
  if (!saved || typeof saved !== 'object') return { ...DEFAULT_STATE };
  const s = saved as Record<string, unknown>;
  if (!num(s.width) || !num(s.height)) return { ...DEFAULT_STATE };
  const width = Math.max(MIN_WIDTH, Math.round(s.width));
  const height = Math.max(MIN_HEIGHT, Math.round(s.height));
  const maximized = s.maximized === true;
  if (!num(s.x) || !num(s.y)) return { width, height, maximized };
  const x = Math.round(s.x);
  const y = Math.round(s.y);
  if (!visibleOn({ x, y, width, height }, screens)) return { ...DEFAULT_STATE };
  return { x, y, width, height, maximized };
}

export function loadWindowState(file: string, screens: Rect[]): WindowState {
  let saved: unknown;
  try {
    saved = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    saved = undefined;
  }
  return restoreState(saved, screens);
}

export function saveWindowState(file: string, state: WindowState): void {
  try {
    writeFileSync(file, JSON.stringify(state));
  } catch {
    // losing the window position is not worth an error
  }
}
