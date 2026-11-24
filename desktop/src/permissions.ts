import { isAppUrl } from './navigation';

/**
 * What the session answers a permission request with. `requestingUrl` is the frame asking (an embedded
 * player's own URL for an iframe); `mainFrameUrl` is the page in the window.
 * - `media` (camera, microphone) and `clipboard-sanitized-write`: only the app's own frames. `media`
 *   then still needs the OS's answer (macOS asks once).
 * - `fullscreen`: any frame of a window showing the app, so a `<video controls>` or an embedded player
 *   in an assignment's instructions can go fullscreen.
 * - Everything else: denied.
 */
export function permissionDecision(
  permission: string,
  requestingUrl: string,
  mainFrameUrl: string,
  origin: string,
): 'allow' | 'deny' | 'media' {
  if (permission === 'fullscreen') return isAppUrl(mainFrameUrl, origin) ? 'allow' : 'deny';
  if (!isAppUrl(requestingUrl, origin) || !isAppUrl(mainFrameUrl, origin)) return 'deny';
  if (permission === 'clipboard-sanitized-write') return 'allow';
  if (permission === 'media') return 'media';
  return 'deny';
}
