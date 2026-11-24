import { act } from '@testing-library/react';
import { vi } from 'vitest';
import type { LocalState, YunguLocal } from './local-api';

/** A stand-in for the desktop shell's `window.yunguLocal`; `emit` plays a state pushed by the main process. */
export function installFakeLocal(initial: Partial<LocalState> = {}) {
  let state: LocalState = { suspension: false, allowedWifi: [], suspended: false, ...initial };
  const listeners = new Set<(s: LocalState) => void>();
  const api: YunguLocal = {
    getState: vi.fn(async () => state),
    setSuspension: vi.fn(async () => undefined),
    setAllowedWifi: vi.fn(async () => undefined),
    readWifi: vi.fn(async () => undefined),
    onState: vi.fn((cb: (s: LocalState) => void) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    }),
  };
  (window as { yunguLocal?: YunguLocal }).yunguLocal = api;
  return {
    api,
    emit(next: Partial<LocalState>) {
      state = { ...state, ...next };
      act(() => listeners.forEach((l) => l(state)));
    },
  };
}

export function removeFakeLocal() {
  delete (window as { yunguLocal?: YunguLocal }).yunguLocal;
}
