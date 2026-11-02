import { requireSession, withServiceErrors } from '@/lib/api-auth';
import { data } from '@/lib/data';

/** The menu's "Try again": starts a Todoist sync and answers at once (the menu then polls the status). */
export const POST = withServiceErrors(async () => {
  const denied = await requireSession();
  if (denied) return denied;
  await data.syncTodoist();
  return new Response(null, { status: 202 });
});
