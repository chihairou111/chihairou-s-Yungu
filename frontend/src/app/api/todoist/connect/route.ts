import { ServiceError, SessionEnded, data } from '@/lib/data';
import { todoistReturn } from '@/lib/todoist';
import { goTo, sessionEnded, signedOut } from '../navigate';

/**
 * "Connect Todoist" / "Reconnect" (a link): asks the service for Todoist's authorize page, with a one-use
 * state bound to this account, and sends the browser there. When it cannot, back to Assignments, where
 * the Todoist menu opens to say why.
 */
export async function GET(request: Request): Promise<Response> {
  const out = await signedOut();
  if (out) return out;
  try {
    return goTo(await data.connectTodoist());
  } catch (error) {
    if (error instanceof SessionEnded) return sessionEnded(error, request);
    if (error instanceof ServiceError) return goTo(todoistReturn(error.status === 503 ? 'setup' : 'failed'));
    throw error;
  }
}
