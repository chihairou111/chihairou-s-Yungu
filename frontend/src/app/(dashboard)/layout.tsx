import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import AppShell from '@/components/AppShell';
import PillNav from '@/components/PillNav';

// The session gate reads the request cookie, so this segment renders per
// request and may block navigation into it (reading a cookie is instant).
export const instant = false;

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const session = await getSession();
  if (!session) redirect('/login');

  return (
    <>
      {/* Nav first in DOM order so keyboard users reach it before the page content. */}
      <PillNav />
      <AppShell userName={session.name}>{children}</AppShell>
    </>
  );
}
