'use client';
import { useEffect } from 'react';
import { SITE_NAME } from '@/lib/site';

const PREFIX = /^\(\d+\+?\) /;

function titled(count: number): string {
  return count > 0 ? `(${count > 99 ? '99+' : count}) ${SITE_NAME}` : SITE_NAME;
}

/**
 * Keeps "(N) chihairou's Yungu" in the browser tab while N notifications are unread. Next writes the
 * page's own title back on navigation, so the head is watched and the count put back in front of it.
 */
export function useTitleCount(count: number): void {
  useEffect(() => {
    const apply = () => {
      const want = titled(count);
      if (document.title !== want) document.title = want;
    };
    apply();
    const observer = new MutationObserver(apply);
    observer.observe(document.head, { subtree: true, childList: true, characterData: true });
    return () => {
      observer.disconnect();
      document.title = document.title.replace(PREFIX, '');
    };
  }, [count]);
}
