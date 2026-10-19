'use client';
import { useCallback, useEffect, useRef, useState } from 'react';

/** How long typing has to pause before the draft is written. */
export const DRAFT_DELAY_MS = 500;

export const draftKey = (taskId: number) => `yl_write_draft_${taskId}`;
/** The writer's title, kept beside the text when it differs from the assignment's. */
export const draftTitleKey = (taskId: number) => `yl_write_draft_${taskId}_title`;

/**
 * `saving`: a change is waiting for the pause; `saved`: the text on screen is the stored draft;
 * `unavailable`: the browser refused storage (private mode, blocked, full), so nothing is kept.
 */
export type DraftStatus = 'idle' | 'saving' | 'saved' | 'unavailable';

export interface Draft {
  /** The stored text when the writer opened ('' for none). Not updated while typing. */
  html: string;
  /** The stored title when the writer opened, or null when none was kept. */
  title: string | null;
  status: DraftStatus;
  /**
   * Records a change. Pass a function to defer the work of serialising the document until the
   * pause (it is called once, when the draft is written).
   */
  setHtml(html: string | (() => string)): void;
  /** Keeps the title with the draft; null forgets it (back to the assignment's own title). */
  setTitle(title: string | null): void;
  clear(): void;
}

function read(key: string): { value: string | null; ok: boolean } {
  try {
    return { value: window.localStorage.getItem(key), ok: true };
  } catch {
    return { value: null, ok: false };
  }
}

/** Writes (or, for empty/null, removes) a value; false when the browser refuses. */
function write(key: string, value: string | null): boolean {
  try {
    if (value) window.localStorage.setItem(key, value);
    else window.localStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

/**
 * The writer's text (and title) for one assignment, kept in this browser's localStorage
 * (`yl_write_draft_<taskId>`, `…_title`) so closing the writer or the pop-up never loses it. Saves 500 ms
 * after typing pauses; a change still waiting when the writer closes is written at once. Typing only
 * re-renders when the status changes. Without storage it keeps working, just unsaved.
 */
export function useDraft(taskId: number): Draft {
  const key = draftKey(taskId);
  const titleKey = draftTitleKey(taskId);
  const [initial] = useState(() => {
    const html = read(key);
    const title = read(titleKey);
    return { html: html.value ?? '', title: title.value, ok: html.ok && title.ok };
  });
  const [status, setStatus] = useState<DraftStatus>(!initial.ok ? 'unavailable' : initial.html ? 'saved' : 'idle');
  const pending = useRef<{ key: string; html: string | (() => string); timer: ReturnType<typeof setTimeout> } | null>(null);

  /** Writes a waiting change now; returns what was written (null when nothing waited) and whether it stuck. */
  const flush = useCallback((): { html: string; ok: boolean } | null => {
    const job = pending.current;
    if (!job) return null;
    clearTimeout(job.timer);
    pending.current = null;
    const html = typeof job.html === 'function' ? job.html() : job.html;
    return { html, ok: write(job.key, html) };
  }, []);

  const setHtml = useCallback(
    (next: string | (() => string)) => {
      setStatus((s) => (s === 'unavailable' ? s : 'saving'));
      if (pending.current) clearTimeout(pending.current.timer);
      const timer = setTimeout(() => {
        const result = flush();
        if (result) setStatus(!result.ok ? 'unavailable' : result.html ? 'saved' : 'idle');
      }, DRAFT_DELAY_MS);
      pending.current = { key, html: next, timer };
    },
    [key, flush],
  );

  const setTitle = useCallback(
    (title: string | null) => {
      if (!write(titleKey, title)) setStatus('unavailable');
    },
    [titleKey],
  );

  const clear = useCallback(() => {
    if (pending.current) clearTimeout(pending.current.timer);
    pending.current = null;
    write(key, null);
    write(titleKey, null);
    setStatus((s) => (s === 'unavailable' ? s : 'idle'));
  }, [key, titleKey]);

  // Leaving the writer (or the page) must not drop the last half-second of typing.
  useEffect(() => {
    const onHide = () => void flush();
    window.addEventListener('pagehide', onHide);
    return () => {
      window.removeEventListener('pagehide', onHide);
      flush();
    };
  }, [flush]);

  return { html: initial.html, title: initial.title, status, setHtml, setTitle, clear };
}
