'use client';
import { createContext } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';

export interface TaskParam {
  /** The assignment in `?task=`, or null when there is none or it is not a number. */
  taskId: number | null;
  /** True whenever `?task=` is present, even when it is not a valid id (the pop-up then says "not found"). */
  isOpen: boolean;
  /** `&write=1`: the pop-up shows the writing view. */
  writing: boolean;
  open(id: number): void;
  close(): void;
  openWriter(): void;
  closeWriter(): void;
}

/**
 * Marks left on history entries this app pushed, so closing knows whether Back returns to where the
 * user came from (an entry we pushed) or would leave the app (a direct link, which is replaced instead).
 * Next keeps its own fields beside these when the native History API is used.
 */
interface EntryMarks {
  ylTask?: boolean;
  ylWrite?: boolean;
}

function currentMarks(): EntryMarks {
  const state: unknown = window.history.state;
  return state && typeof state === 'object' ? (state as EntryMarks) : {};
}

/** Opens an assignment's pop-up; cards read it from context so they work without the router in tests. */
export const OpenTaskContext = createContext<(id: number) => void>(() => {});

/**
 * The open assignment lives in the URL (`?task=ID`, writer `&write=1`) so refresh, Back and links work.
 * Opening pushes a history entry; closing goes back over the entries we pushed, or, for a direct link,
 * replaces the URL without the params. Other params (`?tab=`) are kept. Like the tab switch, this uses
 * the native History API, which Next syncs with `useSearchParams` without a server round trip.
 */
export function useTaskParam(): TaskParam {
  const pathname = usePathname();
  const params = useSearchParams();
  const raw = params.get('task');
  const taskId = raw !== null && /^\d{1,15}$/.test(raw) ? Number(raw) : null;

  function url(edit: (next: URLSearchParams) => void): string {
    const next = new URLSearchParams(params.toString());
    edit(next);
    const query = next.toString();
    return query ? `${pathname}?${query}` : pathname;
  }

  return {
    taskId,
    isOpen: raw !== null,
    writing: raw !== null && params.get('write') === '1',
    open(id) {
      const marks: EntryMarks = { ylTask: true };
      window.history.pushState(marks, '', url((next) => {
        next.delete('write');
        next.set('task', String(id));
      }));
    },
    close() {
      const { ylTask, ylWrite } = currentMarks();
      if (ylTask) {
        window.history.go(ylWrite ? -2 : -1);
        return;
      }
      window.history.replaceState(null, '', url((next) => {
        next.delete('task');
        next.delete('write');
      }));
    },
    openWriter() {
      const marks: EntryMarks = { ...(currentMarks().ylTask ? { ylTask: true } : {}), ylWrite: true };
      window.history.pushState(marks, '', url((next) => next.set('write', '1')));
    },
    closeWriter() {
      if (currentMarks().ylWrite) {
        window.history.go(-1);
        return;
      }
      window.history.replaceState(null, '', url((next) => next.delete('write')));
    },
  };
}
