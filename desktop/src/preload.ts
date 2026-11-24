/**
 * The app window's preload (the main window only, never windows its pages open): `window.yunguLocal`,
 * Suspension Mode's small API for the page and the gear's Appearance choice, and nothing else. Sandboxed: only `electron` is required.
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { contextBridge, ipcRenderer } = require('electron') as typeof import('electron');

/** What the page sees; the same shape as `LocalState` in main.ts. */
interface PageLocalState {
  suspension: boolean;
  allowedNetworks: { label: string; mac: string }[];
  suspended: boolean;
  reason?: string;
  mac?: string;
}

contextBridge.exposeInMainWorld('yunguLocal', {
  getState: (): Promise<PageLocalState> => ipcRenderer.invoke('yungu-local:get-state'),
  setSuspension: (on: boolean): Promise<void> => ipcRenderer.invoke('yungu-local:set-suspension', on === true),
  readNetwork: (): Promise<{ mac: string | null }> => ipcRenderer.invoke('yungu-local:read-network'),
  setAllowedNetworks: (list: { label: string; mac: string }[]): Promise<void> =>
    ipcRenderer.invoke(
      'yungu-local:set-allowed-networks',
      Array.isArray(list) ? list.map((n) => ({ label: String(n?.label ?? ''), mac: String(n?.mac ?? '') })) : [],
    ),
  setAppearance: (appearance: string): Promise<void> => ipcRenderer.invoke('yungu-local:set-appearance', String(appearance)),
  onState: (cb: (s: PageLocalState) => void): (() => void) => {
    const listener = (_e: unknown, s: PageLocalState) => cb(s);
    ipcRenderer.on('yungu-local:state', listener);
    return () => {
      ipcRenderer.removeListener('yungu-local:state', listener);
    };
  },
});
