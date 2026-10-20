'use client';
import { useCallback, useEffect, useRef, useState } from 'react';

/** How long typing has to pause before the draft is written. */
export const DRAFT_DELAY_MS = 500;

/** The text of a new document (`yl_write_draft_<taskId>`), or of the online document `docId` (`…_doc_<fileId>`). */
export const draftKey = (taskId: number, docId?: string) => `yl_write_draft_${taskId}${docId ? `_doc_${docId}` : ''}`;
/** The writer's title, kept beside the text when it differs from the assignment's (or the document's). */
export const draftTitleKey = (taskId: number, docId?: string) => `${draftKey(taskId, docId)}_title`;
/** For an online document: which version of it on Yungu the draft was written from (`docBase`). */
export const draftBaseKey = (taskId: number, docId: string) => `${draftKey(taskId, docId)}_base`;

/**
 * A short name for one version of an online document (its title and text as Yungu holds them): FNV-1a
 * over both. A draft written from this version continues it; a different one means Yungu changed since.
 */
export function docBase(doc: { name: string; content?: string }): string {
  const text = `${doc.name}\u0000${doc.content ?? ''}`;
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${hash.toString(16)}-${text.length}`;
}

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
  /** For an online document: the version the stored draft was written from (null when none was kept). */
  base: string | null;
  status: DraftStatus;
  /**
   * Records a change. Pass a function to defer the work of serialising the document until the
   * pause (it is called once, when the draft is written).
   */
  setHtml(html: string | (() => string)): void;
  /** Keeps the title with the draft; null forgets it (back to the assignment's own title). */
  setTitle(title: string | null): void;
  clear(): void;
  /**
   * Forgets the stored draft only while it still holds exactly this text and title (null: the default
   * title): for a save that finishes after the writer closed, when another writer may have written since.
   */
  clearIfUnchanged(html: string, title: string | null): void;
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
 * The writer's text (and title) for one assignment's new document, or for one of its online documents
 * (`doc`), kept in this browser's localStorage (`yl_write_draft_<taskId>[_doc_<fileId>]`, `…_title`, and
 * for a document `…_base`, the Yungu version it was written from) so closing the writer or the pop-up
 * never loses it. Saves 500 ms after typing pauses; a change still waiting when the writer closes is
 * written at once. Typing only re-renders when the status changes. Without storage it keeps working, just unsaved.
 */
export function useDraft(taskId: number, doc?: { id: string; base: string }): Draft {
  const key = draftKey(taskId, doc?.id);
  const titleKey = draftTitleKey(taskId, doc?.id);
  const baseKey = doc ? draftBaseKey(taskId, doc.id) : null;
  const base = doc?.base ?? null;
  const [initial] = useState(() => {
    const html = read(key);
    const title = read(titleKey);
    const stored = baseKey ? read(baseKey).value : null;
    return { html: html.value ?? '', title: title.value, base: stored, ok: html.ok && title.ok };
  });
  const [status, setStatus] = useState<DraftStatus>(!initial.ok ? 'unavailable' : initial.html ? 'saved' : 'idle');
  const pending = useRef<{ key: string; html: string | (() => string); timer: ReturnType<typeof setTimeout> } | null>(null);

  /** Notes which Yungu version a document's draft continues, beside anything written for it. */
  const markBase = useCallback(() => (baseKey && base ? write(baseKey, base) : true), [baseKey, base]);

  /** Writes a waiting change now; returns what was written (null when nothing waited) and whether it stuck. */
  const flush = useCallback((): { html: string; ok: boolean } | null => {
    const job = pending.current;
    if (!job) return null;
    clearTimeout(job.timer);
    pending.current = null;
    const html = typeof job.html === 'function' ? job.html() : job.html;
    const ok = write(job.key, html);
    return { html, ok: ok && (!html || markBase()) };
  }, [markBase]);

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
      if (!write(titleKey, title) || (title !== null && !markBase())) setStatus('unavailable');
    },
    [titleKey, markBase],
  );

  const clear = useCallback(() => {
    if (pending.current) clearTimeout(pending.current.timer);
    pending.current = null;
    write(key, null);
    write(titleKey, null);
    if (baseKey) write(baseKey, null);
    setStatus((s) => (s === 'unavailable' ? s : 'idle'));
  }, [key, titleKey, baseKey]);

  const clearIfUnchanged = useCallback(
    (html: string, title: string | null) => {
      flush();
      if ((read(key).value ?? '') === html && read(titleKey).value === title) clear();
    },
    [key, titleKey, flush, clear],
  );

  // Leaving the writer (or the page) must not drop the last half-second of typing.
  useEffect(() => {
    const onHide = () => void flush();
    window.addEventListener('pagehide', onHide);
    return () => {
      window.removeEventListener('pagehide', onHide);
      flush();
    };
  }, [flush]);

  return { html: initial.html, title: initial.title, base: initial.base, status, setHtml, setTitle, clear, clearIfUnchanged };
}
