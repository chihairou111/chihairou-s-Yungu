'use client';
import { useCallback, useEffect, useRef, useState } from 'react';

/** How long typing has to pause before the draft is written. */
export const DRAFT_DELAY_MS = 500;

export const draftKey = (taskId: number) => `yl_write_draft_${taskId}`;

/**
 * `saving`: a change is waiting for the pause; `saved`: the text on screen is the stored draft;
 * `unavailable`: the browser refused storage (private mode, blocked, full), so nothing is kept.
 */
export type DraftStatus = 'idle' | 'saving' | 'saved' | 'unavailable';

export interface Draft {
  html: string;
  status: DraftStatus;
  setHtml(html: string): void;
  clear(): void;
}

function read(key: string): { html: string; ok: boolean } {
  try {
    return { html: window.localStorage.getItem(key) ?? '', ok: true };
  } catch {
    return { html: '', ok: false };
  }
}

/** Writes (or, for empty text, removes) the draft; false when the browser refuses. */
function write(key: string, html: string): boolean {
  try {
    if (html) window.localStorage.setItem(key, html);
    else window.localStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

/**
 * The writer's text for one assignment, kept in this browser's localStorage (`yl_write_draft_<taskId>`)
 * so closing the writer or the pop-up never loses it. Saves 500 ms after typing pauses; a change still
 * waiting when the writer closes is written at once. Without storage it keeps working, just unsaved.
 */
export function useDraft(taskId: number): Draft {
  const key = draftKey(taskId);
  const [initial] = useState(() => read(key));
  const [html, setState] = useState(initial.html);
  const [status, setStatus] = useState<DraftStatus>(!initial.ok ? 'unavailable' : initial.html ? 'saved' : 'idle');
  const pending = useRef<{ key: string; html: string; timer: ReturnType<typeof setTimeout> } | null>(null);

  const flush = useCallback(() => {
    const job = pending.current;
    if (!job) return true;
    clearTimeout(job.timer);
    pending.current = null;
    return write(job.key, job.html);
  }, []);

  const setHtml = useCallback(
    (next: string) => {
      setState(next);
      setStatus((s) => (s === 'unavailable' ? s : 'saving'));
      if (pending.current) clearTimeout(pending.current.timer);
      const timer = setTimeout(() => setStatus(flush() ? (next ? 'saved' : 'idle') : 'unavailable'), DRAFT_DELAY_MS);
      pending.current = { key, html: next, timer };
    },
    [key, flush],
  );

  const clear = useCallback(() => {
    if (pending.current) clearTimeout(pending.current.timer);
    pending.current = null;
    write(key, '');
    setState('');
    setStatus((s) => (s === 'unavailable' ? s : 'idle'));
  }, [key]);

  // Leaving the writer (or the page) must not drop the last half-second of typing.
  useEffect(() => {
    const onHide = () => void flush();
    window.addEventListener('pagehide', onHide);
    return () => {
      window.removeEventListener('pagehide', onHide);
      flush();
    };
  }, [flush]);

  return { html, status, setHtml, clear };
}
