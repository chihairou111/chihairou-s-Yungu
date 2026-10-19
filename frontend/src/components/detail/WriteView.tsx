'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import LinkMark from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import InputBase from '@mui/material/InputBase';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import ArrowBack from '@mui/icons-material/ArrowBack';
import CheckRounded from '@mui/icons-material/CheckRounded';
import type { Theme } from '@mui/material/styles';
import type { AssignmentDetail, FileRef } from '@/lib/types';
import { VISUALLY_HIDDEN } from '../visually-hidden';
import { ApiError, isSessionEnded, renderPdf } from './api';
import EditorToolbar from './EditorToolbar';
import { useDraft, type DraftStatus } from './useDraft';
import { SESSION_ENDED } from './useWork';
import { useWorkContext } from './WorkContext';

/** Width of the writing column. */
const COLUMN_PX = 760;

/**
 * Only what the toolbar offers (and the server's PDF sanitiser keeps): paragraphs, line breaks, bold,
 * italic, underline, two heading levels, both lists and links. Pasted code, quotes, rules, strike-through
 * or images fall back to plain text instead of producing markup the PDF would drop.
 */
const EXTENSIONS = [
  StarterKit.configure({
    heading: { levels: [1, 2] },
    blockquote: false,
    code: false,
    codeBlock: false,
    horizontalRule: false,
    strike: false,
    underline: false,
    link: false,
  }),
  Underline,
  LinkMark.configure({
    openOnClick: false,
    defaultProtocol: 'https',
    HTMLAttributes: { target: null, rel: null, class: null },
    isAllowedUri: (url, ctx) => ctx.defaultValidate(url) && /^(https?:|mailto:)/i.test(url),
  }),
  Placeholder.configure({ placeholder: 'Start writing…' }),
];

/** The text as it will read in the PDF: comfortable measure, clear heading steps, themed caret and selection. */
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
    '& p.is-editor-empty:first-child::before': {
      content: 'attr(data-placeholder)',
      float: 'left',
      height: 0,
      pointerEvents: 'none',
      color: theme.palette.text.secondary,
    },
  },
});

type Failure = { message: string; tone: 'info' | 'error'; session?: boolean };

function failureOf(error: unknown): Failure {
  if (isSessionEnded(error)) return { message: SESSION_ENDED, tone: 'error', session: true };
  if (error instanceof ApiError) return { message: error.message, tone: 'error' };
  return { message: 'Could not create the PDF. Try again.', tone: 'error' };
}

interface WriteViewProps {
  detail: AssignmentDetail;
  /** The dialog's accessible name goes on this view's (hidden) heading. */
  titleId: string;
  onBack: () => void;
  /** The PDF is in Your work; the dialog confirms it and returns to the assignment. */
  onDone: (file: FileRef) => void;
}

/**
 * The pop-up's writing view: ← back, the document's title, the draft indicator and Done over a ten-control
 * toolbar and a 760px writing column. The text is kept as a draft in this browser while typing. Done turns
 * it into a PDF on the server, adds that to Your work and forgets the draft; if anything fails the text
 * stays exactly as it was.
 */
export default function WriteView({ detail, titleId, onBack, onDone }: WriteViewProps) {
  const work = useWorkContext();
  const draft = useDraft(detail.id);
  const [title, setTitle] = useState(detail.title);
  const [exporting, setExporting] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  // Leaving mid-export cancels it: the draft stays, and nothing is added behind the user's back.
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);

  const editor = useEditor({
    extensions: EXTENSIONS,
    content: draft.html,
    immediatelyRender: false,
    editorProps: {
      attributes: { role: 'textbox', 'aria-multiline': 'true', 'aria-label': 'Your writing', spellcheck: 'true' },
    },
    onUpdate: ({ editor: e }) => {
      draft.setHtml(e.isEmpty ? '' : e.getHTML());
      setFailure((f) => (f?.tone === 'info' ? null : f));
    },
  });

  async function done() {
    if (!editor || exporting) return;
    if (editor.getText().trim() === '') {
      setFailure({ message: 'Nothing to export yet.', tone: 'info' });
      editor.commands.focus();
      return;
    }
    setFailure(null);
    setExporting(true);
    editor.setEditable(false, false);
    const controller = new AbortController();
    abort.current = controller;
    try {
      const file = await renderPdf(title.trim() || detail.title, editor.getHTML(), controller.signal);
      if (controller.signal.aborted) return;
      if (!(await work.add(file))) {
        setFailure({ message: 'The PDF was made but could not be added to Your work. Try again.', tone: 'error' });
        return;
      }
      draft.clear();
      onDone(file);
    } catch (error) {
      if (!controller.signal.aborted) setFailure(failureOf(error));
    } finally {
      if (!controller.signal.aborted) {
        setExporting(false);
        if (!editor.isDestroyed) editor.setEditable(true, false);
      }
    }
  }

  return (
    <Stack sx={{ flex: 1, minHeight: 0 }}>
      <Typography id={titleId} component="h2" sx={VISUALLY_HIDDEN}>
        Write: {detail.title}
      </Typography>

      <Stack
        direction="row"
        sx={{
          alignItems: 'center',
          gap: { xs: 0.5, sm: 1.5 },
          flexShrink: 0,
          pl: { xs: 0.5, sm: 1.5 },
          pr: { xs: 1.5, sm: 2.5 },
          py: 1.25,
          borderBottom: 1,
          borderColor: 'divider',
        }}
      >
        <Tooltip title="Back to assignment (keeps your draft)" describeChild>
          <IconButton onClick={onBack} aria-label="Back to assignment">
            <ArrowBack />
          </IconButton>
        </Tooltip>
        <InputBase
          value={title}
          onChange={(e) => setTitle(e.target.value)}
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
        <DraftIndicator status={draft.status} />
        <Tooltip title="Save as a PDF in Your work" describeChild>
          <Button variant="contained" onClick={done} loading={exporting} loadingPosition="start" startIcon={<CheckRounded />} sx={{ flexShrink: 0 }}>
            Done
          </Button>
        </Tooltip>
      </Stack>

      <Box sx={{ flexShrink: 0, borderBottom: 1, borderColor: 'divider', py: 0.75 }}>
        {/* Same column as the text, the first glyph lined up with its left edge (buttons inset their icons by 8px). */}
        <Box sx={{ maxWidth: COLUMN_PX, mx: 'auto', px: { xs: 1, sm: 2 } }}>
          {editor ? <EditorToolbar editor={editor} disabled={exporting} /> : <Skeleton variant="rounded" height={40} sx={{ maxWidth: 480 }} />}
        </Box>
      </Box>

      <Box
        sx={{ flex: 1, minHeight: 0, overflowY: 'auto', overscrollBehavior: 'contain', cursor: 'text' }}
        // A click in the margins or below the last line puts the caret at the end, as on paper.
        onMouseDown={(e) => {
          if (!editor || e.target !== e.currentTarget && !(e.target as HTMLElement).dataset.column) return;
          e.preventDefault();
          editor.commands.focus('end');
        }}
      >
        <Box data-column="1" sx={{ maxWidth: COLUMN_PX, minHeight: '100%', mx: 'auto', px: { xs: 2, sm: 3 }, pt: { xs: 2, sm: 4 }, pb: 10 }}>
          {failure && (
            <Alert
              severity={failure.tone}
              role={failure.tone === 'error' ? 'alert' : 'status'}
              onClose={failure.session ? undefined : () => setFailure(null)}
              action={
                failure.session ? (
                  <Button color="inherit" size="small" component={Link} href="/login">
                    Sign in
                  </Button>
                ) : undefined
              }
              sx={{ mb: 3, cursor: 'auto' }}
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

/** "Saving…" while typing pauses, then "Draft saved"; says so when this browser keeps no drafts. */
function DraftIndicator({ status }: { status: DraftStatus }) {
  const text = { idle: '', saving: 'Saving…', saved: 'Draft saved', unavailable: 'Drafts off in this browser' }[status];
  return (
    <Typography
      variant="body2"
      color="text.secondary"
      noWrap
      sx={{ flexShrink: 0, display: { xs: status === 'unavailable' ? 'block' : 'none', sm: 'block' }, minWidth: { sm: '7.5em' }, textAlign: 'right' }}
    >
      {text}
    </Typography>
  );
}
