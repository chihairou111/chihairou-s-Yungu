import { requireSession, withServiceErrors } from '@/lib/api-auth';
import { data } from '@/lib/data';

/** Disconnects an agent connected through the consent page: its next call is refused. 404 for an unknown id. */
export const DELETE = withServiceErrors(async (_request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const denied = await requireSession();
  if (denied) return denied;
  await data.disconnectAgent((await params).id);
  return new Response(null, { status: 204 });
});
