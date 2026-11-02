/**
 * The Todoist connect flow's shared words: the service's own messages (`api/service/todoist_service.py`),
 * and the `?todoist=error&why=` codes the connect and callback routes send the browser back with, which
 * the app bar's Todoist menu turns into a sentence. The code and state never travel in that URL.
 */
export const TODOIST_LINK_EXPIRED = 'That Todoist link expired. Try connecting again.';
export const TODOIST_NOT_ACCEPTED = "Todoist didn't accept the connection. Try again.";
export const TODOIST_DOWN = "Can't reach Todoist right now. Try again.";

/** Where the browser goes to connect (or reconnect) Todoist: the route sends it on to Todoist's own page. */
export const TODOIST_CONNECT_PATH = '/api/todoist/connect';
/** Where it comes back to, with `?todoist=connected` or `?todoist=error&why=…`. */
export const TODOIST_RETURN_PATH = '/assignments';

export type TodoistWhy = 'expired' | 'refused' | 'unreachable' | 'setup' | 'denied' | 'failed';

const WHY: Record<TodoistWhy, string> = {
  expired: TODOIST_LINK_EXPIRED,
  refused: 'Todoist didn’t accept the connection. Try again.',
  unreachable: 'Can’t reach Todoist right now. Try again.',
  setup: 'Todoist isn’t set up on this server.',
  denied: 'Todoist wasn’t connected.',
  failed: 'Something went wrong. Try again.',
};

/** The sentence for a `why` code; anything unknown is the generic one. */
export function todoistWhyMessage(why: string | null): string {
  return why !== null && Object.hasOwn(WHY, why) ? WHY[why as TodoistWhy] : WHY.failed;
}

/** The return URL for a connect that worked, or one that did not and why. */
export function todoistReturn(why?: TodoistWhy): string {
  return why ? `${TODOIST_RETURN_PATH}?todoist=error&why=${why}` : `${TODOIST_RETURN_PATH}?todoist=connected`;
}
