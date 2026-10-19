import 'server-only';
import { sanitizeInstructions } from '../sanitize';
import type { Assignment, AssignmentDetail, Comment, FileKind, FileRef } from '../types';
import { buildDetailSeed, buildSubmitted, buildTodo } from './fixtures';
import type { DetailSeed } from './fixtures';

const ME = 'Bruce Zheng';

const OFFICE_EXTENSIONS = new Set(['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'odt', 'ods', 'odp', 'rtf']);
const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'heic']);
const VIDEO_EXTENSIONS = new Set(['mp4', 'mov', 'm4v', 'webm', 'avi', 'mkv']);
const AUDIO_EXTENSIONS = new Set(['mp3', 'm4a', 'wav', 'ogg', 'aac', 'flac']);

/** Classifies a file for the viewer. The mime type wins; the extension covers generic or missing types. */
export function fileKind(mime: string, name: string): FileKind {
  const type = mime.toLowerCase();
  if (type === 'application/pdf') return 'pdf';
  if (type.startsWith('image/')) return 'image';
  if (type.startsWith('video/')) return 'video';
  if (type.startsWith('audio/')) return 'audio';
  if (/officedocument|msword|ms-excel|ms-powerpoint|opendocument/.test(type)) return 'office';
  const ext = name.includes('.') ? name.split('.').pop()!.toLowerCase() : '';
  if (ext === 'pdf') return 'pdf';
  if (IMAGE_EXTENSIONS.has(ext)) return 'image';
  if (VIDEO_EXTENSIONS.has(ext)) return 'video';
  if (AUDIO_EXTENSIONS.has(ext)) return 'audio';
  if (OFFICE_EXTENSIONS.has(ext)) return 'office';
  return 'other';
}

interface AssignmentState {
  seed: DetailSeed;
  /** The draft: what the student's file list holds now. */
  myFileIds: string[];
  /** What was handed in at the last submit; draft saves leave it alone. */
  submittedFileIds: string[];
  comments: Comment[];
  /** Set once the student hands in (or re-submits); overrides the fixture's own submission time. */
  submittedAt?: number;
}

interface MockStore {
  /** Every file reference the store knows, uploaded or fixture, by id. */
  refs: Map<string, FileRef>;
  /** Bytes of uploaded files only; fixture files are served from public/mock/. */
  blobs: Map<string, Uint8Array>;
  assignments: Map<number, AssignmentState>;
}

const createStore = (): MockStore => ({ refs: new Map(), blobs: new Map(), assignments: new Map() });

// Module state would be lost when Next dev reloads this module, so the store hangs off globalThis.
const globalStore = globalThis as typeof globalThis & { __yunguMockStore?: MockStore };
const store = (): MockStore => (globalStore.__yunguMockStore ??= createStore());

/** Forgets every upload, draft, comment and submission. Tests call this; the app never does. */
export function resetMockStore(): void {
  globalStore.__yunguMockStore = createStore();
}

function findAssignment(id: number, now: number): Assignment | undefined {
  return [...buildTodo(now), ...buildSubmitted(now)].find((a) => a.id === id);
}

/** Lazily seeds an assignment's mutable state from its fixture; undefined for unknown ids. */
function stateFor(id: number, now: number): AssignmentState | undefined {
  const s = store();
  const existing = s.assignments.get(id);
  if (existing) return existing;
  const seed = buildDetailSeed(id, now);
  if (!seed) return undefined;
  for (const ref of [...seed.attachments, ...seed.myFiles]) s.refs.set(ref.id, ref);
  const fixtureIds = seed.myFiles.map((f) => f.id);
  // Fixture files exist only on submitted fixtures, where they are what was handed in.
  const state: AssignmentState = { seed, myFileIds: fixtureIds, submittedFileIds: [...fixtureIds], comments: [...seed.comments] };
  s.assignments.set(id, state);
  return state;
}

/** The fixture row with any submission made in this process applied on top. */
function withSubmission(a: Assignment): Assignment {
  const submittedAt = store().assignments.get(a.id)?.submittedAt;
  if (submittedAt === undefined) return a;
  return { ...a, status: 'Submitted', submittedAt, schoolGroup: null };
}

export function listTodo(now: number): Assignment[] {
  return buildTodo(now)
    .map((a) => withSubmission(a))
    .filter((a) => a.status === 'To submit');
}

export function listSubmitted(now: number): Assignment[] {
  const fresh = buildTodo(now)
    .map((a) => withSubmission(a))
    .filter((a) => a.status === 'Submitted');
  const handedIn = buildSubmitted(now).map((a) => withSubmission(a));
  return [...fresh, ...handedIn].sort((a, b) => b.submittedAt! - a.submittedAt!);
}

export function getDetail(id: number, now: number): AssignmentDetail | null {
  const base = findAssignment(id, now);
  const state = stateFor(id, now);
  if (!base || !state) return null;
  const a = withSubmission(base);
  const { refs } = store();
  return {
    ...a,
    teacher: state.seed.teacher,
    instructionsHtml: sanitizeInstructions(state.seed.instructionsHtml),
    attachments: state.seed.attachments,
    myFiles: state.myFileIds.flatMap((fid) => refs.get(fid) ?? []),
    submittedFileIds: [...state.submittedFileIds],
    submitted: a.status === 'Submitted',
    comments: [...state.comments].sort((x, y) => x.createdAt - y.createdAt),
  };
}

export function storeFile(name: string, mime: string, bytes: Uint8Array, now: number): FileRef {
  const id = crypto.randomUUID();
  const ref: FileRef = { id, name, kind: fileKind(mime, name), mime, size: bytes.length, url: `/api/files/${id}`, createdAt: now };
  store().refs.set(id, ref);
  store().blobs.set(id, bytes);
  return ref;
}

export function loadFile(id: string): { ref: FileRef; bytes: Uint8Array } | null {
  const ref = store().refs.get(id);
  const bytes = store().blobs.get(id);
  return ref && bytes ? { ref, bytes } : null;
}

/** Replaces the draft file list, keeping only ids the store knows. Returns false for an unknown assignment. */
export function setFiles(id: number, fileIds: string[], now: number): boolean {
  const state = stateFor(id, now);
  if (!state) return false;
  const { refs } = store();
  state.myFileIds = [...new Set(fileIds)].filter((fid) => refs.has(fid));
  return true;
}

/** Hands in the current draft: it becomes the submitted list, stamped with `now`. */
export function markSubmitted(id: number, now: number): void {
  const state = stateFor(id, now);
  if (!state) return;
  state.submittedAt = now;
  state.submittedFileIds = [...state.myFileIds];
}

export function putComment(id: number, text: string, now: number): Comment | null {
  const state = stateFor(id, now);
  if (!state) return null;
  const c: Comment = { id: crypto.randomUUID(), author: ME, mine: true, createdAt: now, text };
  state.comments.push(c);
  return c;
}

export function removeComment(id: number, commentId: string, now: number): void {
  const state = stateFor(id, now);
  if (state) state.comments = state.comments.filter((c) => !(c.id === commentId && c.mine));
}
