'use client';
import { createContext, useEffect, useRef } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';

export interface TaskParam {
  /** The assignment in `?task=`, or null when there is none or it is not a number. */
  taskId: number | null;
  /** True whenever `?task=` is present, even when it is not a valid id (the pop-up then says "not found"). */
  isOpen: boolean;
  /** `&write=1`: the pop-up shows the writing view. */
  writing: boolean;
  /** `&doc=FILEID` beside `&write=1`: the writer edits that online document (null: a new one). */
  docId: string | null;
  open(id: number): void;
  close(): void;
  /** Opens the writer, for the online document `docId` or (without one) for a new document. */
  openWriter(docId?: string): void;
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

/** The URL that opens assignment `id` over `pathname?search` (any writer params dropped, the rest kept). */
export function taskUrl(pathname: string, search: string, id: number): string {
  const next = new URLSearchParams(search);
  next.delete('write');
  next.delete('doc');
  next.set('task', String(id));
  return `${pathname}?${next.toString()}`;
}

/**
 * Opens assignment `id` over the current page, exactly as `useTaskParam().open` does, for code outside
 * a page's search-param hooks (the app bar). Only where the page mounts the pop-up (Assignments).
 */
export function openTaskHere(id: number): void {
  const marks: EntryMarks = { ylTask: true };
  window.history.pushState(marks, '', taskUrl(window.location.pathname, window.location.search, id));
}

/** Opens an assignment's pop-up; cards read it from context so they work without the router in tests. */
export const OpenTaskContext = createContext<(id: number) => void>(() => {});

/**
 * The open assignment lives in the URL (`?task=ID`, writer `&write=1`, an online document in it
 * `&doc=FILEID`) so refresh, Back and links work.
 * Opening pushes a history entry; closing goes back over the entries we pushed, or, for a direct link,
 * replaces the URL without the params. Other params (`?tab=`) are kept. Like the tab switch, this uses
 * the native History API, which Next syncs with `useSearchParams` without a server round trip.
 * A close that is still on its way (Esc, then ✕ before the URL changes) swallows repeats, so a double
 * close never steps back past the list.
 */
export function useTaskParam(): TaskParam {
  const pathname = usePathname();
  const params = useSearchParams();
  const raw = params.get('task');
  const taskId = raw !== null && /^\d{1,15}$/.test(raw) ? Number(raw) : null;
  const query = params.toString();
  const writing = raw !== null && params.get('write') === '1';
  const doc = params.get('doc');
  // Set while a close is navigating; cleared once the URL has changed.
  const closing = useRef(false);
  useEffect(() => {
    closing.current = false;
  }, [query]);

  /** Runs one closing navigation per URL state; repeats before the URL changes are ignored. */
  function once(navigate: () => void) {
    if (closing.current) return;
    closing.current = true;
    navigate();
  }

  function url(edit: (next: URLSearchParams) => void): string {
    const next = new URLSearchParams(params.toString());
    edit(next);
    const query = next.toString();
    return query ? `${pathname}?${query}` : pathname;
  }

  return {
    taskId,
    isOpen: raw !== null,
    writing,
    docId: writing && doc ? doc : null,
    open(id) {
      const marks: EntryMarks = { ylTask: true };
      window.history.pushState(marks, '', taskUrl(pathname, params.toString(), id));
    },
    close() {
      once(() => {
        const { ylTask, ylWrite } = currentMarks();
        const list = url((next) => {
          next.delete('task');
          next.delete('write');
          next.delete('doc');
        });
        if (ylTask) {
          window.history.go(ylWrite ? -2 : -1);
        } else if (ylWrite) {
          // A directly linked task with a writer we pushed: step back off the writer, then replace the
          // task entry itself, so Back afterwards does not reopen the pop-up.
          window.addEventListener('popstate', () => window.history.replaceState(null, '', list), { once: true });
          window.history.go(-1);
        } else {
          window.history.replaceState(null, '', list);
        }
      });
    },
    openWriter(docId) {
      const marks: EntryMarks = { ...(currentMarks().ylTask ? { ylTask: true } : {}), ylWrite: true };
      window.history.pushState(marks, '', url((next) => {
        next.set('write', '1');
        if (docId) next.set('doc', docId);
        else next.delete('doc');
      }));
    },
    closeWriter() {
      once(() => {
        if (currentMarks().ylWrite) window.history.go(-1);
        else
          window.history.replaceState(null, '', url((next) => {
            next.delete('write');
            next.delete('doc');
          }));
      });
    },
  };
}
