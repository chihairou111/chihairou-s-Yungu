import { requireSession, withServiceErrors } from '@/lib/api-auth';
import { data } from '@/lib/data';

/** The refresh button: drops the service's cached reads so the page and pop-up reload fresh from Yungu. */
export const POST = withServiceErrors(async () => {
  const denied = await requireSession();
  if (denied) return denied;
  await data.refresh();
  return new Response(null, { status: 204 });
});
