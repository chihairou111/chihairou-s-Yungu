import { requireSession, withServiceErrors } from '@/lib/api-auth';
import { data } from '@/lib/data';

/** Revokes a personal token: the next agent call with it is refused. 404 for an id this account doesn't have. */
export const DELETE = withServiceErrors(async (_request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const denied = await requireSession();
  if (denied) return denied;
  await data.revokeAgentToken((await params).id);
  return new Response(null, { status: 204 });
});
