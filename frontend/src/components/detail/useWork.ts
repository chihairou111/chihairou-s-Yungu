'use client';
import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { AssignmentDetail, FileRef } from '@/lib/types';
import { ApiError, isSessionEnded, saveDraft, submit as submitWork, uploadFile } from './api';
import { useDetailActions } from './DetailContext';

/** The server's own limits, checked first so an obviously bad file is never sent. */
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
export const EMPTY_FILE = 'That file is empty.';
export const TOO_LARGE = 'Files up to 50 MB.';
export const SESSION_ENDED = 'Your session ended — sign in again.';

export type WorkStatus = 'not-submitted' | 'submitted' | 'late';

/** A local file on its way to the server, shown as a busy row until it lands in `files`. */
export interface PendingUpload {
  key: string;
  name: string;
  size: number;
}

export interface Work {
  files: FileRef[];
  uploads: PendingUpload[];
  status: WorkStatus;
  /** When the work was last handed in (undefined before the first submit). */
  submittedAt: number | undefined;
  /** Anything on its way to the server: an upload, a draft save, or the submit itself. */
  busy: boolean;
  submitting: boolean;
  error: string | null;
  /** The last failure was a 401: the error says so and the panel offers a way to sign in. */
  sessionEnded: boolean;
  add(file: FileRef): Promise<void>;
  addLocal(file: File): Promise<void>;
  remove(id: string): Promise<void>;
  submit(): Promise<void>;
  dismissError(): void;
}

function messageOf(error: unknown): string {
  if (isSessionEnded(error)) return SESSION_ENDED;
  if (error instanceof ApiError) return error.message;
  return 'Something went wrong. Try again.';
}

let uploadSeq = 0;

/**
 * The student's work on one assignment, with task.yungu.org's draft model: the file list is the draft,
 * and every add or remove saves the whole list (`saveDraft`) so it survives closing the pop-up.
 * Submit hands the list in; afterwards the same list can be changed and handed in again (Update).
 * A newer detail (after `refresh()`) replaces the list. After a submit the status changes at once and
 * stays changed while the pop-up and the list behind it refetch, so it never flashes "Not submitted".
 */
export function useWork(detail: AssignmentDetail): Work {
  const router = useRouter();
  const { refresh } = useDetailActions();
  const id = detail.id;

  const [source, setSource] = useState(detail);
  const [files, setFiles] = useState(detail.myFiles);
  const [handedIn, setHandedIn] = useState<number | undefined>(undefined);
  if (source !== detail) {
    setSource(detail);
    setFiles(detail.myFiles);
    if (source.id !== detail.id) setHandedIn(undefined);
  }

  const [uploads, setUploads] = useState<PendingUpload[]>([]);
  const [saving, setSaving] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [failure, setFailure] = useState<{ message: string; session: boolean } | null>(null);

  // The list as the actions last left it: parallel uploads each append to the latest, not to a stale render.
  const filesRef = useRef(files);
  useLayoutEffect(() => {
    filesRef.current = files;
  }, [files]);
  // Draft saves go out one at a time, in order, so the last one the server sees is the latest list.
  const saves = useRef<Promise<unknown>>(Promise.resolve());

  const fail = useCallback((error: unknown) => {
    setFailure({ message: messageOf(error), session: isSessionEnded(error) });
  }, []);

  const change = useCallback(
    async (next: FileRef[], undo: (current: FileRef[]) => FileRef[]) => {
      filesRef.current = next;
      setFiles(next);
      const ids = next.map((f) => f.id);
      setSaving((n) => n + 1);
      const save = saves.current.then(() => saveDraft(id, ids));
      saves.current = save.catch(() => {});
      try {
        await save;
      } catch (error) {
        const reverted = undo(filesRef.current);
        filesRef.current = reverted;
        setFiles(reverted);
        fail(error);
      } finally {
        setSaving((n) => n - 1);
      }
    },
    [id, fail],
  );

  const add = useCallback(
    async (file: FileRef) => {
      setFailure(null);
      await change([...filesRef.current, file], (current) => current.filter((f) => f.id !== file.id));
    },
    [change],
  );

  const addLocal = useCallback(
    async (file: File) => {
      setFailure(null);
      if (file.size === 0) return fail(new ApiError(400, EMPTY_FILE));
      if (file.size > MAX_UPLOAD_BYTES) return fail(new ApiError(413, TOO_LARGE));
      const key = `upload-${++uploadSeq}`;
      setUploads((list) => [...list, { key, name: file.name, size: file.size }]);
      let ref: FileRef;
      try {
        ref = await uploadFile(file);
      } catch (error) {
        fail(error);
        return;
      } finally {
        setUploads((list) => list.filter((u) => u.key !== key));
      }
      await change([...filesRef.current, ref], (current) => current.filter((f) => f.id !== ref.id));
    },
    [change, fail],
  );

  const remove = useCallback(
    async (fileId: string) => {
      setFailure(null);
      const before = filesRef.current;
      const index = before.findIndex((f) => f.id === fileId);
      if (index < 0) return;
      const removed = before[index];
      await change(
        before.filter((f) => f.id !== fileId),
        (current) => [...current.slice(0, index), removed, ...current.slice(index)],
      );
    },
    [change],
  );

  const submit = useCallback(async () => {
    const ids = filesRef.current.map((f) => f.id);
    if (ids.length === 0) return;
    setFailure(null);
    setSubmitting(true);
    try {
      await saves.current;
      const { submittedAt } = await submitWork(id, ids);
      setHandedIn(submittedAt);
      router.refresh();
      // The status already reads "Submitted"; a failed refetch only leaves the older detail in place
      // (and a 401 turns the whole pop-up into its signed-out message).
      await refresh().catch(() => {});
    } catch (error) {
      fail(error);
    } finally {
      setSubmitting(false);
    }
  }, [id, router, refresh, fail]);

  const dismissError = useCallback(() => setFailure(null), []);

  const fromDetail = detail.submitted ? (detail.submittedAt ?? 0) : undefined;
  const submittedAt =
    fromDetail === undefined ? handedIn : handedIn === undefined ? fromDetail : Math.max(fromDetail, handedIn);
  const status: WorkStatus =
    submittedAt === undefined ? 'not-submitted' : submittedAt > detail.dueAt ? 'late' : 'submitted';

  return {
    files,
    uploads,
    status,
    submittedAt: submittedAt || undefined,
    busy: submitting || saving > 0 || uploads.length > 0,
    submitting,
    error: failure?.message ?? null,
    sessionEnded: failure?.session ?? false,
    add,
    addLocal,
    remove,
    submit,
    dismissError,
  };
}
