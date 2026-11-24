import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_STATE, loadWindowState, restoreState, saveWindowState } from './window-state';

const screen = [{ x: 0, y: 0, width: 1920, height: 1080 }];
const twoScreens = [...screen, { x: 1920, y: 0, width: 1440, height: 900 }];

describe('restoreState', () => {
  it('defaults to 1280x800 with no position', () => {
    expect(DEFAULT_STATE).toEqual({ width: 1280, height: 800, maximized: false });
    expect(restoreState(undefined, screen)).toEqual(DEFAULT_STATE);
    expect(restoreState('junk', screen)).toEqual(DEFAULT_STATE);
  });

  it('keeps saved bounds that are on a screen', () => {
    const saved = { x: 100, y: 50, width: 1000, height: 700, maximized: true };
    expect(restoreState(saved, screen)).toEqual(saved);
    const right = { x: 2000, y: 100, width: 1000, height: 700, maximized: false };
    expect(restoreState(right, twoScreens)).toEqual(right);
  });

  it('falls back to the defaults when the saved bounds are off-screen', () => {
    expect(restoreState({ x: 5000, y: 3000, width: 1000, height: 700 }, screen)).toEqual(DEFAULT_STATE);
    // A screen that is gone now.
    expect(restoreState({ x: 2000, y: 100, width: 1000, height: 700 }, screen)).toEqual(DEFAULT_STATE);
    // Only a sliver still showing.
    expect(restoreState({ x: 1910, y: 100, width: 1000, height: 700 }, screen)).toEqual(DEFAULT_STATE);
    expect(restoreState({ x: -995, y: 100, width: 1000, height: 700 }, screen)).toEqual(DEFAULT_STATE);
  });

  it('never goes below the minimum size and ignores bad numbers', () => {
    expect(restoreState({ x: 10, y: 10, width: 300, height: 200 }, screen)).toEqual({
      x: 10, y: 10, width: 900, height: 600, maximized: false,
    });
    expect(restoreState({ x: 'a', y: 10, width: 1000, height: 700 }, screen)).toEqual({
      width: 1000, height: 700, maximized: false,
    });
    expect(restoreState({ width: Number.NaN, height: 700 }, screen)).toEqual(DEFAULT_STATE);
  });
});

describe('load and save', () => {
  let dir: string;
  beforeEach(() => (dir = mkdtempSync(join(tmpdir(), 'yl-ws-'))));
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('round-trips through window-state.json', () => {
    const file = join(dir, 'window-state.json');
    const state = { x: 20, y: 30, width: 1100, height: 750, maximized: false };
    saveWindowState(file, state);
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual(state);
    expect(loadWindowState(file, screen)).toEqual(state);
  });

  it('reads a missing or corrupt file as the defaults', () => {
    const file = join(dir, 'window-state.json');
    expect(loadWindowState(file, screen)).toEqual(DEFAULT_STATE);
    writeFileSync(file, '{oops');
    expect(loadWindowState(file, screen)).toEqual(DEFAULT_STATE);
  });
});
