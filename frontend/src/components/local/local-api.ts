'use client';
import { useEffect, useState } from 'react';

/** Suspension Mode's state, as the desktop shell's main process reports it. */
export interface LocalState {
  /** The switch. */
  suspension: boolean;
  allowedWifi: string[];
  /** Requests to Yungu are stopped right now. */
  suspended: boolean;
  reason?: 'not-allowed' | 'unknown' | string;
  /** The current Wi-Fi's name, when the Mac is on one whose name could be read. */
  ssid?: string;
}

/** `window.yunguLocal`: the desktop shell's preload API (`desktop/src/preload.ts`). Absent on the web. */
export interface YunguLocal {
  getState(): Promise<LocalState>;
  setSuspension(on: boolean): Promise<void>;
  setAllowedWifi(names: string[]): Promise<void>;
  /** One Wi-Fi reading now (the state then carries `ssid`); the shell reads nothing else with the switch off. */
  readWifi(): Promise<void>;
  onState(cb: (s: LocalState) => void): () => void;
}

export function localApi(): YunguLocal | null {
  if (typeof window === 'undefined') return null;
  return (window as { yunguLocal?: YunguLocal }).yunguLocal ?? null;
}

/**
 * The desktop shell's Suspension Mode state, kept up to date; null in the hosted web app and in tests
 * without the shell (and until the first answer arrives), so nothing of Suspension Mode shows there.
 */
export function useLocalState(): LocalState | null {
  const [state, setState] = useState<LocalState | null>(null);
  useEffect(() => {
    const api = localApi();
    if (!api) return;
    let live = true;
    let pushed = false;
    const off = api.onState((s) => {
      pushed = true;
      if (live) setState(s);
    });
    api.getState().then(
      (s) => {
        if (live && !pushed) setState(s); // a pushed state is newer than this answer
      },
      () => undefined,
    );
    return () => {
      live = false;
      off();
    };
  }, []);
  return state;
}
