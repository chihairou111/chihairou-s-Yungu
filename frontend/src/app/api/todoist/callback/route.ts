import { ServiceError, SessionEnded, data } from '@/lib/data';
import { TODOIST_DOWN, TODOIST_NOT_ACCEPTED, todoistReturn, type TodoistWhy } from '@/lib/todoist';
import { goTo, sessionEnded, signedOut } from '../navigate';

/** Why a refused callback failed, from the service's answer. */
function whyOf(error: ServiceError): TodoistWhy {
  if (error.status === 400) return 'expired';
  if (error.status === 503) return 'setup';
  if (error.message === TODOIST_NOT_ACCEPTED) return 'refused';
  if (error.message === TODOIST_DOWN) return 'unreachable';
  return 'failed';
}

/**
 * Connected, and not waiting to be connected again: a used-up link was this browser's own, reloaded after the
 * connect worked (its first sync may since have failed for another reason, which the menu shows).
 */
async function alreadyConnected(): Promise<boolean> {
  try {
    const status = await data.getTodoist();
    return status.connected && status.error?.code !== 'reauth';
  } catch {
    return false;
  }
}

/**
 * The redirect URI registered with Todoist (`https://yungu.chihairou.dev/api/todoist/callback`): Todoist
 * sends the browser here with `?code&state` (or `?error=access_denied` when the student cancels). The
 * service checks the state against this account and exchanges the code itself; the browser is sent on
 * to Assignments, where the Todoist menu opens on the result. The code and state are never logged
 * (nginx keeps no access log for this path) and never passed on in a URL.
 *
 * The service is always asked first, so a fresh code is never skipped (Reconnect while connected). A link
 * it no longer knows (400) while this account is connected (and not asking to connect again) is a reload of
 * this page after the connect worked: that lands as connected, not as an expired link.
 */
export async function GET(request: Request): Promise<Response> {
  const out = await signedOut();
  if (out) return out;
  const query = new URL(request.url).searchParams;
  if (query.has('error') && !query.has('code')) return goTo(todoistReturn('denied'));
  try {
    await data.finishTodoist(query.get('code') ?? '', query.get('state') ?? '');
    return goTo(todoistReturn());
  } catch (error) {
    if (error instanceof SessionEnded) return sessionEnded(error, request);
    if (!(error instanceof ServiceError)) throw error;
    if (error.status === 400 && (await alreadyConnected())) return goTo(todoistReturn());
    return goTo(todoistReturn(whyOf(error)));
  }
}
