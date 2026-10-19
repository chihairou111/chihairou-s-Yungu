import 'server-only';
import { redirect } from 'next/navigation';
import { ServiceError, SessionEnded, YunguUnavailable } from './data/errors';
import { endedSessionPath } from './session-cookie';

/**
 * Runs a page's (or the layout's) data loading. When the service ends the session (401) the browser is
 * sent to clear it and sign in again, with the service's reason; any other service failure comes back
 * as a `YunguUnavailable` for the page to show in place of its content, so a page never crashes on it.
 */
export async function loadPageData<T>(load: () => Promise<T>): Promise<T | YunguUnavailable> {
  let ended: SessionEnded;
  try {
    return await load();
  } catch (error) {
    if (error instanceof SessionEnded) ended = error;
    else if (error instanceof YunguUnavailable) return error;
    else if (error instanceof ServiceError) return new YunguUnavailable();
    else throw error;
  }
  // Outside the try: redirect() works by throwing.
  redirect(endedSessionPath(ended.message));
}
