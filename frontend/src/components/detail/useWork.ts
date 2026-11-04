'use client';
import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { AssignmentDetail, FileRef } from '@/lib/types';
import { ApiError, isSessionEnded, saveDraft, submit as submitWork, uploadFile } from './api';
import { useDetailActions } from './DetailContext';

/** The server's own limits, checked first so an obviously bad file is never sent. */
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
/** The server's own wording, for the checks it shares with the browser. */
const SERVER_EMPTY = 'That file is empty.';
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
  /** Not submitted because the teacher returned it for revision. */
  returned: boolean;
  /** When the work was last handed in (undefined before the first submit). */
  submittedAt: number | undefined;
  /** After a submit: the draft differs from what was handed in, so Update has something to hand in. */
  changed: boolean;
  /** The files as last handed in: an online document among them is never saved over, only replaced. */
  submittedFileIds: string[];
  /**
   * "Mark as submitted": the assignment takes no files, is not handed in, and Your work is empty — so
   * `submit()` hands in an empty list (the server decides again and answers 400/502 when it disagrees).
   */
  canMarkSubmitted: boolean;
  /** Anything on its way to the server: an upload, a draft save, or the submit itself. */
  busy: boolean;
  submitting: boolean;
  /** Every failure since the last action started (one per file in a multi-file upload). */
  errors: string[];
  /** The first of `errors`, or null. */
  error: string | null;
  /** The last failure was a 401: the error says so and the panel offers a way to sign in. */
  sessionEnded: boolean;
  /** Adds a file made elsewhere (the writer's document); resolves false when the draft save failed and it was taken back out. */
  add(file: FileRef): Promise<boolean>;
  /**
   * Puts `file` where `oldId` is (at the end when it has gone): a handed-in online document's new version.
   * The same id (a document saved in place) only takes its new title and text, with no draft save.
   * Resolves false when the draft save failed and the old file was put back.
   */
  replace(oldId: string, file: FileRef): Promise<boolean>;
  addLocal(file: File): Promise<void>;
  /** Uploads several local files at once; failures are collected, each naming its file. */
  addFiles(files: File[]): Promise<void>;
  remove(id: string): Promise<void>;
  submit(): Promise<void>;
  dismissError(): void;
}

function messageOf(error: unknown): string {
  if (isSessionEnded(error)) return SESSION_ENDED;
  if (error instanceof ApiError) return error.message;
  return 'Something went wrong. Try again.';
}

/** "blank.txt is empty.", "huge.mov: files up to 50 MB.", "notes.pdf: No connection. Try again." */
function uploadMessage(name: string, error: unknown): string {
  if (isSessionEnded(error)) return SESSION_ENDED;
  if (error instanceof ApiError && error.status === 413) return `${name}: files up to 50 MB.`;
  if (error instanceof ApiError && error.message === SERVER_EMPTY) return `${name} is empty.`;
  return `${name}: ${messageOf(error)}`;
}

/** The same files, in any order: order is not something the student can change or hand in. */
function sameIds(files: FileRef[], ids: string[]): boolean {
  const set = new Set(ids);
  return files.length === set.size && files.every((f) => set.has(f.id));
}

let uploadSeq = 0;

/**
 * The student's work on one assignment, with task.yungu.org's draft model: the file list is the draft,
 * and every add or remove saves the whole list (`saveDraft`) so it survives closing the pop-up.
 * Submit hands the list in; afterwards the same list can be changed (only the draft changes) and handed
 * in again (Update). `changed` says when the draft and the handed-in list (`submittedFileIds`) differ.
 * A newer detail (after `refresh()`) replaces the list. After a submit the status changes at once and
 * stays changed while the pop-up and the list behind it refetch, so it never flashes "Not submitted".
 */
export function useWork(detail: AssignmentDetail): Work {
  const router = useRouter();
  const { refresh } = useDetailActions();
  const id = detail.id;

  const [uploads, setUploads] = useState<PendingUpload[]>([]);
  const [saving, setSaving] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [failure, setFailure] = useState<{ messages: string[]; session: boolean } | null>(null);

  const [source, setSource] = useState(detail);
  const [files, setFiles] = useState(detail.myFiles);
  const [handedIn, setHandedIn] = useState<number | undefined>(undefined);
  // A hand-in of work returned for revision: past its original deadline, but not late (Yungu does not count it).
  const [revisedHandIn, setRevisedHandIn] = useState(false);
  const returnedRef = useRef(false);
  const [handedInIds, setHandedInIds] = useState(detail.submittedFileIds);
  if (source !== detail) {
    setSource(detail);
    // While anything is on its way the local list is ahead of the server's; it wins (the queued save
    // writes it), so a refetch that started earlier never drops a file.
    const idle = saving === 0 && uploads.length === 0 && !submitting;
    if (idle) setFiles(detail.myFiles);
    if (idle || source.id !== detail.id) setHandedInIds(detail.submittedFileIds);
    if (source.id !== detail.id) {
      setHandedIn(undefined);
      setRevisedHandIn(false);
    }
  }

  // The list as the actions last left it: parallel uploads each append to the latest, not to a stale render.
  const filesRef = useRef(files);
  useLayoutEffect(() => {
    filesRef.current = files;
  }, [files]);
  // Draft saves go out one at a time, in order, so the last one the server sees is the latest list.
  const saves = useRef<Promise<unknown>>(Promise.resolve());

  /** Adds a failure to those shown (a repeat, such as several 401s in one batch, shows once). */
  const fail = useCallback((error: unknown, message = messageOf(error)) => {
    setFailure((current) => ({
      messages: current?.messages.includes(message) ? current.messages : [...(current?.messages ?? []), message],
      session: (current?.session ?? false) || isSessionEnded(error),
    }));
  }, []);

  const change = useCallback(
    async (next: FileRef[], undo: (current: FileRef[]) => FileRef[]): Promise<boolean> => {
      filesRef.current = next;
      setFiles(next);
      const ids = next.map((f) => f.id);
      setSaving((n) => n + 1);
      const save = saves.current.then(() => saveDraft(id, ids));
      saves.current = save.catch(() => {});
      try {
        await save;
        return true;
      } catch (error) {
        const reverted = undo(filesRef.current);
        filesRef.current = reverted;
        setFiles(reverted);
        fail(error);
        return false;
      } finally {
        setSaving((n) => n - 1);
      }
    },
    [id, fail],
  );

  const add = useCallback(
    async (file: FileRef) => {
      setFailure(null);
      return change([...filesRef.current, file], (current) => current.filter((f) => f.id !== file.id));
    },
    [change],
  );

  const replace = useCallback(
    async (oldId: string, file: FileRef) => {
      setFailure(null);
      const before = filesRef.current;
      const index = before.findIndex((f) => f.id === oldId);
      if (index < 0) return change([...before, file], (current) => current.filter((f) => f.id !== file.id));
      const old = before[index];
      const next = before.map((f, i) => (i === index ? file : f));
      if (oldId === file.id) {
        filesRef.current = next;
        setFiles(next);
        return true;
      }
      return change(next, (current) => current.map((f) => (f.id === file.id ? old : f)));
    },
    [change],
  );

  const uploadOne = useCallback(
    async (file: File) => {
      const refuse = (error: ApiError) => fail(error, uploadMessage(file.name, error));
      if (file.size === 0) return refuse(new ApiError(400, SERVER_EMPTY));
      if (file.size > MAX_UPLOAD_BYTES) return refuse(new ApiError(413, 'Files up to 50 MB.'));
      const key = `upload-${++uploadSeq}`;
      setUploads((list) => [...list, { key, name: file.name, size: file.size }]);
      let ref: FileRef;
      try {
        ref = await uploadFile(file);
      } catch (error) {
        fail(error, uploadMessage(file.name, error));
        return;
      } finally {
        setUploads((list) => list.filter((u) => u.key !== key));
      }
      await change([...filesRef.current, ref], (current) => current.filter((f) => f.id !== ref.id));
    },
    [change, fail],
  );

  const addFiles = useCallback(
    async (list: File[]) => {
      setFailure(null);
      await Promise.all(list.map(uploadOne));
    },
    [uploadOne],
  );

  const addLocal = useCallback((file: File) => addFiles([file]), [addFiles]);

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

  // True from the moment a submit starts until it ends: a second call in the same tick (a double click)
  // is dropped before the render that shows "Submitting…".
  const inFlight = useRef(false);
  const markable = useRef(false);

  const submit = useCallback(async () => {
    const ids = filesRef.current.map((f) => f.id);
    if (inFlight.current || (ids.length === 0 && !markable.current)) return;
    inFlight.current = true;
    setFailure(null);
    setSubmitting(true);
    try {
      await saves.current;
      const { submittedAt } = await submitWork(id, ids);
      setHandedIn(submittedAt);
      setRevisedHandIn(returnedRef.current);
      setHandedInIds(ids);
      router.refresh();
      // The status already reads "Submitted"; a failed refetch only leaves the older detail in place
      // (and a 401 turns the whole pop-up into its signed-out message).
      await refresh().catch(() => {});
    } catch (error) {
      fail(error);
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  }, [id, router, refresh, fail]);

  const dismissError = useCallback(() => setFailure(null), []);

  const fromDetail = detail.submitted ? (detail.submittedAt ?? 0) : undefined;
  const submittedAt =
    fromDetail === undefined ? handedIn : handedIn === undefined ? fromDetail : Math.max(fromDetail, handedIn);
  const status: WorkStatus =
    submittedAt === undefined ? 'not-submitted' : submittedAt > detail.dueAt && !revisedHandIn ? 'late' : 'submitted';
  const returned = status === 'not-submitted' && detail.revision === true;

  const changed = status !== 'not-submitted' && !sameIds(files, handedInIds);
  const canMarkSubmitted = status === 'not-submitted' && !detail.needsFiles && files.length === 0 && uploads.length === 0;
  useLayoutEffect(() => {
    markable.current = canMarkSubmitted;
    returnedRef.current = returned;
  }, [canMarkSubmitted, returned]);

  return {
    files,
    uploads,
    status,
    returned,
    submittedAt: submittedAt || undefined,
    changed,
    submittedFileIds: handedInIds,
    canMarkSubmitted,
    busy: submitting || saving > 0 || uploads.length > 0,
    submitting,
    errors: failure?.messages ?? [],
    error: failure?.messages[0] ?? null,
    sessionEnded: failure?.session ?? false,
    add,
    replace,
    addLocal,
    addFiles,
    remove,
    submit,
    dismissError,
  };
}
