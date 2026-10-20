'use client';
import { useEffect, useRef, useState, type Ref } from 'react';
import Link from 'next/link';
import { generateJSON } from '@tiptap/core';
import { EditorContent, useEditor } from '@tiptap/react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import InputBase from '@mui/material/InputBase';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import type { Theme } from '@mui/material/styles';
import ArrowBack from '@mui/icons-material/ArrowBack';
import CheckRounded from '@mui/icons-material/CheckRounded';
import CloudDoneOutlined from '@mui/icons-material/CloudDoneOutlined';
import CloudOffOutlined from '@mui/icons-material/CloudOffOutlined';
import CloudSyncOutlined from '@mui/icons-material/CloudSyncOutlined';
import { docTooLongMessage, ONLINE_DOC_MAX_BYTES } from '@/lib/limits';
import { deltaBytes, deltaToDoc, docToDelta, normalizeDelta, parseDelta, type Delta } from '@/lib/quill-delta';
import type { AssignmentDetail, FileRef } from '@/lib/types';
import { VISUALLY_HIDDEN } from '../visually-hidden';
import { embedSx, quoteSx, strikeSx } from './docStyles';
import { WRITER_EXTENSIONS } from './writerExtensions';
import { ApiError, createOnlineDoc, isSessionEnded, updateOnlineDoc } from './api';
import EditorToolbar from './EditorToolbar';
import { EASE_OUT, FADE_MS } from './motion';
import { docBase, useDraft, type Draft, type DraftStatus } from './useDraft';
import { SESSION_ENDED } from './useWork';
import { useWorkContext } from './WorkContext';

/** Width of the writing column. */
const COLUMN_PX = 760;

export const FLATTENED =
  "Nested lists, line breaks inside a paragraph, small headings and checklists will be saved as plain lines.";
const NOT_LISTED = 'Saved on Yungu, but not added to Your work. Try again.';

/**
 * The text as it reads on Yungu: comfortable measure, clear heading steps, themed caret and selection.
 * Formats only a Yungu-written document brings (strike, quotes, alignment, media) are shown as they are kept.
 */
const documentSx = (theme: Theme) => ({
  cursor: 'auto',
  '& .tiptap': {
    ...theme.typography.body1,
    fontSize: '1.0625rem',
    lineHeight: 1.75,
    color: theme.palette.text.primary,
    overflowWrap: 'anywhere',
    outline: 'none',
    minHeight: '12em',
    caretColor: theme.palette.primary.main,
    '& ::selection': { backgroundColor: theme.yungu.color.primaryContainer, color: theme.yungu.color.onPrimaryContainer },
    '& > :first-child': { marginTop: 0 },
    '& p': { margin: '0 0 0.85em' },
    '& h1': { fontSize: '1.75rem', fontWeight: 700, lineHeight: 1.3, letterSpacing: '-0.01em', margin: '1.4em 0 0.5em' },
    '& h2': { fontSize: '1.3rem', fontWeight: 650, lineHeight: 1.35, margin: '1.3em 0 0.45em' },
    '& ul, & ol': { margin: '0 0 0.85em', paddingLeft: '1.6em' },
    '& li > p': { margin: 0 },
    '& li + li': { marginTop: '0.25em' },
    '& li::marker': { color: theme.palette.text.secondary },
    '& a': { color: theme.palette.primary.main, textDecoration: 'underline', textUnderlineOffset: '0.18em', cursor: 'text' },
    '& s': strikeSx,
    '& blockquote': quoteSx(theme),
    '& .yungu-embed': embedSx(theme),
    '& .yungu-embed.ProseMirror-selectednode': { outline: `2px solid ${theme.palette.primary.main}`, outlineOffset: 2 },
    '& p.is-editor-empty:first-child::before': {
      content: 'attr(data-placeholder)',
      float: 'left',
      height: 0,
      pointerEvents: 'none',
      color: theme.palette.text.secondary,
    },
  },
});

/** Hoisted so the editor's options stay the same object from render to render. */
const EDITOR_PROPS = {
  attributes: { role: 'textbox', 'aria-multiline': 'true', 'aria-label': 'Your writing', spellcheck: 'true' },
};

/** Opening the writer puts the caret in the text on laptops; on phones that would throw up the keyboard. */
function caretOnOpen(): 'end' | false {
  return typeof window !== 'undefined' && window.matchMedia?.('(min-width: 600px)').matches ? 'end' : false;
}

type Failure = { message: string; tone: 'info' | 'warning' | 'error'; session?: boolean; saveAnyway?: boolean };

/** Each refusal is a new alert (it fades in again), so pressing Save twice never looks like nothing happened. */
let failureSeq = 0;

function failureOf(error: unknown): Failure {
  if (isSessionEnded(error)) return { message: SESSION_ENDED, tone: 'error', session: true };
  if (error instanceof ApiError) return { message: error.message, tone: 'error' };
  return { message: "Couldn't save the document. Try again.", tone: 'error' };
}

/** Nothing but blank lines: there is nothing to save. */
function isBlank(delta: Delta): boolean {
  return delta.ops.every((op) => typeof op.insert === 'string' && op.insert.trim() === '');
}

/** The local draft (editor HTML) says the same as Yungu's delta. */
function sameText(html: string, delta: Delta): boolean {
  if (!html) return true;
  if (typeof window === 'undefined') return false;
  const local = docToDelta(generateJSON(html, WRITER_EXTENSIONS)).delta;
  return JSON.stringify(normalizeDelta(local)) === JSON.stringify(normalizeDelta(delta));
}

/** An online document open in the writer: the FileRef as it was when the writer opened, and its text. */
interface OpenDoc {
  file: FileRef;
  delta: Delta;
}

interface Opening {
  content: string | ReturnType<typeof deltaToDoc>;
  title: string;
  /** A local draft from an older Yungu version waits to be chosen or let go. */
  conflict: boolean;
}

/**
 * What the writer opens with. A new document: its local draft. An online document: its local draft when
 * that continues the version on Yungu now; Yungu's version otherwise — and when the draft says
 * something else, the choice between them (neither is overwritten silently).
 */
function openingOf(draft: Draft, doc: OpenDoc | null, fallbackTitle: string): Opening {
  if (!doc) return { content: draft.html, title: draft.title ?? fallbackTitle, conflict: false };
  const yungu = { content: deltaToDoc(doc.delta), title: doc.file.name, conflict: false };
  if (draft.html === '' && draft.title === null) return yungu;
  if (draft.base === docBase(doc.file)) return { content: draft.html || yungu.content, title: draft.title ?? doc.file.name, conflict: false };
  const same = sameText(draft.html, doc.delta) && (draft.title ?? doc.file.name) === doc.file.name;
  return { ...yungu, conflict: !same };
}

interface WriteViewProps {
  detail: AssignmentDetail;
  /** The dialog's accessible name goes on this view's (hidden) heading. */
  titleId: string;
  /** The online document in Your work to edit (`&doc=`); none for a new document. */
  docId?: string | null;
  onBack: () => void;
  /** The document is saved and in Your work; the dialog confirms it and returns to the assignment. */
  onDone: (file: FileRef) => void;
}

/**
 * The pop-up's writing view: ← back, the document's title, the draft indicator and "Save to Your work"
 * over a ten-control toolbar and a 760px writing column. The text is kept as a draft in this browser while
 * typing. Saving sends it to Yungu as an online document (a new one, the same one again, or — for one
 * already handed in — a new one that takes its place) and puts it in Your work; only then is the draft
 * forgotten. If anything fails the text stays exactly as it was.
 */
export default function WriteView({ detail, titleId, docId = null, onBack, onDone }: WriteViewProps) {
  const work = useWorkContext();
  // Fixed when the writer opens: saving swaps the document in Your work, but this view stays on what it opened.
  const [doc] = useState<OpenDoc | null | 'missing' | 'unreadable'>(() => {
    if (!docId) return null;
    const file = work.files.find((f) => f.id === docId && f.online);
    if (!file) return 'missing';
    const delta = parseDelta(file.content ?? '');
    return delta ? { file, delta } : 'unreadable';
  });
  if (doc === 'missing' || doc === 'unreadable') {
    return (
      <Unavailable
        detail={detail}
        titleId={titleId}
        onBack={onBack}
        message={doc === 'missing' ? 'This document is no longer in Your work.' : "This document can't be edited here. Open it on Yungu."}
      />
    );
  }
  return <Writer detail={detail} titleId={titleId} doc={doc} onBack={onBack} onDone={onDone} />;
}

function Writer({ detail, titleId, doc, onBack, onDone }: Omit<WriteViewProps, 'docId'> & { doc: OpenDoc | null }) {
  const work = useWorkContext();
  const [base] = useState(() => (doc ? docBase(doc.file) : ''));
  const draft = useDraft(detail.id, doc ? { id: doc.file.id, base } : undefined);
  const defaultTitle = doc?.file.name ?? detail.title;
  const [opening] = useState(() => openingOf(draft, doc, detail.title));
  const [title, setTitle] = useState(opening.title);
  const [conflict, setConflict] = useState(opening.conflict);
  const [autofocus] = useState(() => (opening.conflict ? false : caretOnOpen()));
  // On phones the caret waits for a tap; focus starts on ← instead of falling out of the dialog.
  const backButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!autofocus && !opening.conflict) backButton.current?.focus();
  }, [autofocus, opening.conflict]);
  const [saving, setSaving] = useState(false);
  const [failure, setFailureState] = useState<(Failure & { seq: number }) | null>(null);
  const setFailure = (next: Failure | null | ((f: Failure | null) => Failure | null)) =>
    setFailureState((current) => {
      const value = typeof next === 'function' ? next(current) : next;
      return value === null ? null : value === current ? current : { ...value, seq: ++failureSeq };
    });
  // A save that made a document on Yungu but could not put it in Your work: the retry saves that one again.
  const created = useRef<FileRef | null>(null);
  // Leaving mid-save lets it finish (the document lands in Your work), but nothing is reported to a closed view.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const editor = useEditor({
    extensions: WRITER_EXTENSIONS,
    content: opening.content,
    editable: !opening.conflict,
    immediatelyRender: false,
    autofocus,
    editorProps: EDITOR_PROPS,
    onUpdate: ({ editor: e }) => {
      // Serialised once typing pauses, not on every keystroke. An emptied document is still a change to it.
      draft.setHtml(() => (doc ? e.getHTML() : e.isEmpty ? '' : e.getHTML()));
      setFailure((f) => (f?.tone === 'info' || f?.tone === 'warning' ? null : f));
    },
  });

  /** The conflict, settled: write on from the local draft, or from Yungu's version (forgetting the draft). */
  function settle(useLocal: boolean) {
    if (!editor) return;
    if (useLocal) {
      if (draft.html) {
        editor.commands.setContent(draft.html, { emitUpdate: false });
        draft.setHtml(draft.html);
      }
      if (draft.title !== null) {
        setTitle(draft.title);
        draft.setTitle(draft.title);
      }
    } else {
      draft.clear();
    }
    setConflict(false);
    editor.setEditable(true, false);
    editor.commands.focus('end');
  }

  /** Sends the text to Yungu: a new document, or this one again (a handed-in one is never saved over). */
  async function send(name: string, content: string): Promise<FileRef> {
    const id = detail.id;
    if (created.current) return updateOnlineDoc(id, created.current.id, name, content);
    // While a hand-in is on its way, treat the document as handed in.
    if (!doc || work.submitting || work.submittedFileIds.includes(doc.file.id)) return createOnlineDoc(id, name, content);
    try {
      return await updateOnlineDoc(id, doc.file.id, name, content);
    } catch (error) {
      // Handed in after all (on Yungu, or since the list was read): save it as a new one, as Yungu asks.
      if (error instanceof ApiError && error.status === 409) return createOnlineDoc(id, name, content);
      throw error;
    }
  }

  async function save(anyway = false) {
    if (!editor || saving || conflict) return;
    const { delta, flattened } = docToDelta(editor.getJSON());
    if (isBlank(delta)) {
      setFailure({ message: 'Nothing to save yet.', tone: 'info' });
      editor.commands.focus();
      return;
    }
    const content = JSON.stringify(delta);
    if (deltaBytes(delta) > ONLINE_DOC_MAX_BYTES) {
      setFailure({ message: docTooLongMessage(content) ?? 'Too long for Yungu.', tone: 'error' });
      return;
    }
    if (flattened && !anyway) {
      setFailure({ message: FLATTENED, tone: 'warning', saveAnyway: true });
      return;
    }
    setFailure(null);
    setSaving(true);
    editor.setEditable(false, false);
    // What the stored draft holds for this text (see useDraft's setHtml / setTitle above).
    const draftHtml = doc || !editor.isEmpty ? editor.getHTML() : '';
    const draftTitle = title === defaultTitle ? null : title;
    try {
      const saved = await send(title.trim() || defaultTitle, content);
      const listed = doc ? await work.replace(doc.file.id, saved) : await work.add(saved);
      if (!listed) {
        created.current = saved;
        if (mounted.current) setFailure({ message: NOT_LISTED, tone: 'error' });
        return;
      }
      created.current = null;
      // Left mid-save: the writer may be open again on this draft, so only forget it if it is still this text.
      if (mounted.current) draft.clear();
      else draft.clearIfUnchanged(draftHtml, draftTitle);
      if (mounted.current) onDone(saved);
    } catch (error) {
      if (mounted.current) setFailure(failureOf(error));
    } finally {
      if (mounted.current) {
        setSaving(false);
        if (!editor.isDestroyed) editor.setEditable(true, false);
      }
    }
  }

  const locked = saving || conflict;

  return (
    <Stack sx={{ flex: 1, minHeight: 0 }}>
      <Typography id={titleId} component="h2" sx={VISUALLY_HIDDEN}>
        Write: {detail.title}
      </Typography>

      <Stack direction="row" sx={headerSx}>
        <BackButton ref={backButton} onBack={onBack} />
        <InputBase
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
            draft.setTitle(e.target.value === defaultTitle ? null : e.target.value);
          }}
          readOnly={conflict}
          placeholder="Title"
          inputProps={{ 'aria-label': 'Title', maxLength: 100, spellCheck: false }}
          sx={(theme) => ({
            flex: 1,
            minWidth: 0,
            ...theme.typography.h3,
            borderRadius: `${theme.yungu.shape.small}px`,
            '& input': { px: 1, py: 0.75, textOverflow: 'ellipsis' },
            transition: theme.transitions.create(['background-color', 'box-shadow'], { duration: theme.transitions.duration.shortest }),
            '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
            '&:hover': { bgcolor: 'action.hover' },
            '&.Mui-focused': { bgcolor: 'action.hover', boxShadow: `inset 0 -2px 0 ${theme.palette.primary.main}` },
          })}
        />
        {/* While the choice is open nothing is being written; the stored draft is the one on offer. */}
        <DraftIndicator status={conflict ? 'idle' : draft.status} />
        <Tooltip title="Saves it on Yungu as an online document" describeChild>
          <Button
            variant="contained"
            aria-label="Save to Your work"
            onClick={() => void save()}
            loading={saving}
            loadingPosition="start"
            disabled={conflict}
            startIcon={<CheckRounded />}
            sx={{ flexShrink: 0 }}
          >
            {/* On phones the button reads "Save"; its name stays whole. One inline run, so the space survives the flex button. */}
            <span>
              Save
              <Box component="span" sx={{ '@media (max-width: 599.95px)': VISUALLY_HIDDEN }}>
                {' to Your work'}
              </Box>
            </span>
          </Button>
        </Tooltip>
      </Stack>

      <Box sx={{ flexShrink: 0, borderBottom: 1, borderColor: 'divider', py: 0.75 }}>
        {/* Same column as the text, the first glyph lined up with its left edge (buttons inset their icons by 8px). */}
        <Box sx={{ maxWidth: COLUMN_PX, mx: 'auto', px: { xs: 1, sm: 2 } }}>
          {editor ? <EditorToolbar editor={editor} disabled={locked} /> : <Skeleton variant="rounded" height={40} sx={{ maxWidth: 480 }} />}
        </Box>
      </Box>

      <Box
        sx={{ flex: 1, minHeight: 0, overflowY: 'auto', overscrollBehavior: 'contain', cursor: 'text' }}
        // A click in a side margin puts the caret on that line (its start or end); below the text, at the end.
        onMouseDown={(e) => {
          const target = e.target as HTMLElement;
          if (!editor || !editor.isEditable || (target !== e.currentTarget && !target.dataset.column)) return;
          e.preventDefault();
          const box = editor.view.dom.getBoundingClientRect();
          if (e.clientY >= box.bottom) {
            editor.commands.focus('end');
            return;
          }
          const left = e.clientX < box.left ? box.left + 1 : box.right - 1;
          const hit = editor.view.posAtCoords({ left, top: Math.max(e.clientY, box.top + 1) });
          if (hit) editor.chain().focus().setTextSelection(hit.pos).run();
          else editor.commands.focus('end');
        }}
      >
        <Box data-column="1" sx={{ maxWidth: COLUMN_PX, minHeight: '100%', mx: 'auto', px: { xs: 2, sm: 3 }, pt: { xs: 2, sm: 4 }, pb: 10 }}>
          {conflict && <ConflictNotice onUseLocal={() => settle(true)} onKeepYungu={() => settle(false)} />}
          {failure && (
            <Alert
              key={failure.seq}
              severity={failure.tone}
              role={failure.tone === 'error' ? 'alert' : 'status'}
              onClose={failure.session ? undefined : () => setFailure(null)}
              action={
                failure.session ? (
                  <Button color="inherit" size="small" component={Link} href="/login">
                    Sign in
                  </Button>
                ) : failure.saveAnyway ? (
                  <Button color="inherit" size="small" onClick={() => void save(true)} sx={{ whiteSpace: 'nowrap' }}>
                    Save anyway
                  </Button>
                ) : undefined
              }
              sx={{ mb: 3, cursor: 'auto', '& .MuiAlert-action': { alignItems: 'center', pt: 0 }, ...alertIn }}
            >
              {failure.message}
            </Alert>
          )}
          <Box sx={documentSx}>
            <EditorContent editor={editor} />
          </Box>
        </Box>
      </Box>
    </Stack>
  );
}

/** An alert arriving in the writer: the pop-up's own fade (opacity only, so it reads the same with reduced motion). */
const alertIn = { animation: `yl-alert-in ${FADE_MS}ms ${EASE_OUT}`, '@keyframes yl-alert-in': { from: { opacity: 0 } } } as const;

const headerSx = {
  alignItems: 'center',
  gap: { xs: 0.5, sm: 1.5 },
  flexShrink: 0,
  pl: { xs: 0.5, sm: 1.5 },
  pr: { xs: 1.5, sm: 2.5 },
  py: 1.25,
  borderBottom: 1,
  borderColor: 'divider',
} as const;

function BackButton({ ref, onBack }: { ref?: Ref<HTMLButtonElement>; onBack: () => void }) {
  return (
    <Tooltip title="Back to assignment (keeps your draft)" describeChild>
      <IconButton ref={ref} onClick={onBack} aria-label="Back to assignment">
        <ArrowBack />
      </IconButton>
    </Tooltip>
  );
}

/** A local draft from before Yungu's version changed: shown beside Yungu's text until one is chosen. */
function ConflictNotice({ onUseLocal, onKeepYungu }: { onUseLocal: () => void; onKeepYungu: () => void }) {
  const first = useRef<HTMLButtonElement>(null);
  useEffect(() => first.current?.focus(), []);
  return (
    // The message box scrolls by default, which would clip the buttons' focus rings.
    <Alert severity="info" role="status" sx={{ mb: 3, cursor: 'auto', '& .MuiAlert-message': { overflow: 'visible' }, ...alertIn }}>
      This browser has an unsaved draft of this document, written before it changed on Yungu. Yungu’s version is shown.
      {/* Under the words, not beside them: two choices need the room on a phone. */}
      <Stack direction="row" sx={{ gap: 1, flexWrap: 'wrap', mt: 1 }}>
        <Button ref={first} color="inherit" size="small" onClick={onUseLocal}>
          Use my unsaved draft
        </Button>
        <Button color="inherit" size="small" onClick={onKeepYungu}>
          Keep the Yungu version
        </Button>
      </Stack>
    </Alert>
  );
}

/** The writer for a document it cannot open: why, and the way back. */
function Unavailable({ detail, titleId, onBack, message }: { detail: AssignmentDetail; titleId: string; onBack: () => void; message: string }) {
  const back = useRef<HTMLButtonElement>(null);
  useEffect(() => back.current?.focus(), []);
  return (
    <Stack sx={{ flex: 1, minHeight: 0 }}>
      <Typography id={titleId} component="h2" sx={VISUALLY_HIDDEN}>
        Write: {detail.title}
      </Typography>
      <Stack direction="row" sx={headerSx}>
        <BackButton ref={back} onBack={onBack} />
      </Stack>
      <Box sx={{ maxWidth: COLUMN_PX, width: '100%', mx: 'auto', px: { xs: 2, sm: 3 }, pt: { xs: 2, sm: 4 } }}>
        <Alert severity="info" role="status">
          {message}
        </Alert>
      </Box>
    </Stack>
  );
}

/**
 * "Saving…" while typing pauses, then "Draft saved"; says so when this browser keeps no drafts. On phones
 * the words give way to a cloud icon (the words stay for screen readers, announced politely).
 */
function DraftIndicator({ status }: { status: DraftStatus }) {
  const text = { idle: '', saving: 'Saving…', saved: 'Draft saved', unavailable: 'Drafts off in this browser' }[status];
  const Icon = { idle: null, saving: CloudSyncOutlined, saved: CloudDoneOutlined, unavailable: CloudOffOutlined }[status];
  return (
    <Stack
      role="status"
      direction="row"
      sx={{ flexShrink: 0, alignItems: 'center', justifyContent: 'flex-end', color: 'text.secondary', minWidth: { xs: 24, sm: '7.5em' }, mr: { xs: 0.5, sm: 0 } }}
    >
      {Icon && <Icon aria-hidden fontSize="small" sx={{ display: { sm: 'none' } }} />}
      <Typography
        variant="body2"
        color="inherit"
        noWrap
        sx={{ '@media (max-width: 599.95px)': VISUALLY_HIDDEN }}
      >
        {text}
      </Typography>
    </Stack>
  );
}
