/**
 * The app window's preload (the main window only, never windows its pages open): `window.yunguLocal`,
 * Suspension Mode's small API for the page and the gear's Appearance choice, and nothing else. Sandboxed: only `electron` is required.
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { contextBridge, ipcRenderer } = require('electron') as typeof import('electron');

/** What the page sees; the same shape as `LocalState` in main.ts. */
interface PageLocalState {
  suspension: boolean;
  allowedWifi: string[];
  suspended: boolean;
  reason?: string;
  ssid?: string;
}

contextBridge.exposeInMainWorld('yunguLocal', {
  getState: (): Promise<PageLocalState> => ipcRenderer.invoke('yungu-local:get-state'),
  setSuspension: (on: boolean): Promise<void> => ipcRenderer.invoke('yungu-local:set-suspension', on === true),
  readWifi: (): Promise<void> => ipcRenderer.invoke('yungu-local:read-wifi'),
  setAllowedWifi: (names: string[]): Promise<void> =>
    ipcRenderer.invoke('yungu-local:set-allowed-wifi', Array.isArray(names) ? names.map(String) : []),
  setAppearance: (appearance: string): Promise<void> => ipcRenderer.invoke('yungu-local:set-appearance', String(appearance)),
  onState: (cb: (s: PageLocalState) => void): (() => void) => {
    const listener = (_e: unknown, s: PageLocalState) => cb(s);
    ipcRenderer.on('yungu-local:state', listener);
    return () => {
      ipcRenderer.removeListener('yungu-local:state', listener);
    };
  },
});
