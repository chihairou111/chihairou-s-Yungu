'use client';
import { useEffect, useId, useRef, useState, useSyncExternalStore, type KeyboardEvent } from 'react';
import Link from 'next/link';
import Alert from '@mui/material/Alert';
import Avatar from '@mui/material/Avatar';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import DeleteOutlined from '@mui/icons-material/DeleteOutlined';
import ExpandMore from '@mui/icons-material/ExpandMore';
import { alpha } from '@mui/material/styles';
import { MAX_COMMENT } from '@/lib/limits';
import type { Comment } from '@/lib/types';
import { chinaRelativeTime } from '@/lib/time';
import { VISUALLY_HIDDEN } from '../visually-hidden';
import { addComment, ApiError, deleteComment, isSessionEnded } from './api';
import { useDetailActions } from './DetailContext';

/** The character counter appears this close to the limit. */
const COUNTER_FROM = 1800;

/** "Maya Chen" -> "MC", "王小明" -> "王". */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  const first = Array.from(words[0])[0];
  const second = words.length > 1 ? Array.from(words[words.length - 1])[0] : '';
  return (first + second).toUpperCase();
}

interface Failure {
  message: string;
  sessionEnded: boolean;
}

function failure(error: unknown): Failure {
  if (isSessionEnded(error)) return { message: 'Your session ended — sign in again.', sessionEnded: true };
  if (error instanceof ApiError) return { message: error.message, sessionEnded: false };
  return { message: 'Something went wrong. Try again.', sessionEnded: false };
}

const noSubscribe = () => () => {};
/** The modifier named in the shortcut hint: ⌘ on Apple devices, Ctrl elsewhere (Ctrl always works too). */
function useModifierName(): string {
  return useSyncExternalStore(
    noSubscribe,
    () => (/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent) ? '⌘' : 'Ctrl'),
    () => 'Ctrl',
  );
}

type Focus = { kind: 'composer' } | { kind: 'delete'; id: string };

/**
 * The assignment's comments, oldest first, like task.yungu.org's, with a composer. Used rarely, so with
 * no comments it is one collapsed line ("Comments (0)") that never pushes the content down. Posting
 * and deleting wait for the server and change the list only on success. Text is shown as plain text.
 */
export default function CommentsSection({ taskId, comments: incoming }: { taskId: number; comments: Comment[] }) {
  const headingId = useId();
  const { refresh } = useDetailActions();
  const modifier = useModifierName();

  // A fresh list from the server (after a refresh) replaces the local one.
  const [seen, setSeen] = useState(incoming);
  const [comments, setComments] = useState(incoming);
  if (seen !== incoming) {
    setSeen(incoming);
    setComments(incoming);
  }

  const [open, setOpen] = useState(incoming.length > 0);
  const [text, setText] = useState('');
  const [posting, setPosting] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [error, setError] = useState<Failure | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const composerRef = useRef<HTMLTextAreaElement>(null);
  const deleteRefs = useRef(new Map<string, HTMLButtonElement>());
  const cancelRef = useRef<HTMLButtonElement>(null);
  // Focus to apply once the next render has put the target in the page.
  const pendingFocus = useRef<Focus | null>(null);
  const [focusTick, setFocusTick] = useState(0);
  const setPendingFocus = (target: Focus) => {
    pendingFocus.current = target;
    setFocusTick((n) => n + 1);
  };

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const target = pendingFocus.current;
    pendingFocus.current = null;
    if (!target) return;
    if (target.kind === 'composer') composerRef.current?.focus();
    else deleteRefs.current.get(target.id)?.focus();
  }, [focusTick]);

  useEffect(() => {
    if (confirming) cancelRef.current?.focus();
  }, [confirming]);

  const blank = text.trim() === '';

  async function post() {
    if (blank || posting) return;
    setPosting(true);
    setError(null);
    try {
      const comment = await addComment(taskId, text.trim());
      setComments((list) => [...list, comment]);
      setText('');
      setPendingFocus({ kind: 'composer' });
    } catch (e) {
      setError(failure(e));
    } finally {
      setPosting(false);
    }
  }

  async function remove(id: string) {
    if (deleting !== null) return;
    setDeleting(id);
    setError(null);
    const index = comments.findIndex((c) => c.id === id);
    const next = comments.slice(index + 1).find((c) => c.mine);
    try {
      await deleteComment(taskId, id);
      setComments((list) => list.filter((c) => c.id !== id));
      setConfirming(null);
      setPendingFocus(next ? { kind: 'delete', id: next.id } : { kind: 'composer' });
    } catch (e) {
      const f = failure(e);
      setError(f);
      setConfirming(null);
      setPendingFocus({ kind: 'delete', id });
      // The comment is already gone on the server: show the real list.
      if (e instanceof ApiError && e.status === 404) refresh().catch(() => {});
    } finally {
      setDeleting(null);
    }
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      void post();
    }
  }

  const heading = `Comments (${comments.length})`;

  return (
    <Box component="section" aria-labelledby={headingId}>
      {open ? (
        <Typography id={headingId} variant="h3" component="h3" sx={{ mb: 1.5 }}>
          {heading}
        </Typography>
      ) : (
        <Typography id={headingId} variant="h3" component="h3">
          <Button
            onClick={() => {
              setOpen(true);
              setPendingFocus({ kind: 'composer' });
            }}
            aria-expanded={false}
            endIcon={<ExpandMore />}
            sx={{ font: 'inherit', color: 'inherit', ml: -1, px: 1 }}
          >
            {heading}
          </Button>
        </Typography>
      )}

      {open && (
        <Box>
          {comments.length > 0 && (
            <Stack component="ul" sx={{ listStyle: 'none', m: 0, p: 0, gap: 2.5, mb: 3 }}>
              {comments.map((c) => (
                <Stack component="li" key={c.id} direction="row" sx={{ gap: 1.5, alignItems: 'flex-start' }}>
                  <Avatar
                    aria-hidden
                    sx={(theme) => ({
                      width: 32,
                      height: 32,
                      fontSize: '0.8125rem',
                      fontWeight: 500,
                      bgcolor: c.mine ? theme.palette.primary.main : alpha(theme.palette.text.primary, 0.08),
                      color: c.mine ? theme.palette.primary.contrastText : theme.palette.text.primary,
                    })}
                  >
                    {initials(c.author)}
                  </Avatar>
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Stack direction="row" sx={{ alignItems: 'center', gap: 1, minHeight: 32, flexWrap: 'wrap' }}>
                      <Typography variant="body2" sx={{ fontWeight: 500, overflowWrap: 'anywhere' }}>
                        {c.author}
                      </Typography>
                      <Typography variant="caption" color="text.secondary" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                        {chinaRelativeTime(c.createdAt, now)}
                      </Typography>
                      {c.mine && (
                        <Box sx={{ ml: 'auto' }}>
                          {confirming === c.id ? (
                            <Stack
                              direction="row"
                              sx={{ alignItems: 'center', gap: 0.5 }}
                              onKeyDown={(event) => {
                                if (event.key !== 'Escape' || deleting === c.id) return;
                                // Cancels the question, not the pop-up.
                                event.stopPropagation();
                                setConfirming(null);
                                setPendingFocus({ kind: 'delete', id: c.id });
                              }}
                            >
                              <Typography variant="caption" color="text.secondary" sx={{ mr: 0.5 }}>
                                Delete comment?
                              </Typography>
                              <Button
                                ref={cancelRef}
                                size="small"
                                onClick={() => {
                                  if (deleting === c.id) return;
                                  setConfirming(null);
                                  setPendingFocus({ kind: 'delete', id: c.id });
                                }}
                              >
                                Cancel
                              </Button>
                              <Button
                                size="small"
                                color="error"
                                onClick={() => void remove(c.id)}
                                aria-busy={deleting === c.id || undefined}
                                startIcon={deleting === c.id ? <CircularProgress size={14} color="inherit" /> : undefined}
                              >
                                Delete
                              </Button>
                            </Stack>
                          ) : (
                            <IconButton
                              aria-label="Delete comment"
                              ref={(el: HTMLButtonElement | null) => {
                                if (el) deleteRefs.current.set(c.id, el);
                                else deleteRefs.current.delete(c.id);
                              }}
                              onClick={() => setConfirming(c.id)}
                              sx={{ color: 'text.secondary', my: -0.75, mr: -1 }}
                            >
                              <DeleteOutlined fontSize="small" />
                            </IconButton>
                          )}
                        </Box>
                      )}
                    </Stack>
                    <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxWidth: '70ch' }}>
                      {c.text}
                    </Typography>
                  </Box>
                </Stack>
              ))}
            </Stack>
          )}

          {error && (
            <Alert
              severity="error"
              onClose={error.sessionEnded ? undefined : () => setError(null)}
              action={
                error.sessionEnded ? (
                  <Button color="inherit" size="small" component={Link} href="/login">
                    Sign in
                  </Button>
                ) : undefined
              }
              sx={{ mb: 2 }}
            >
              {error.message}
            </Alert>
          )}

          <TextField
            multiline
            fullWidth
            minRows={2}
            maxRows={8}
            placeholder="Add a comment"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKeyDown}
            aria-busy={posting || undefined}
            inputRef={composerRef}
            slotProps={{ htmlInput: { 'aria-label': 'Add a comment', maxLength: MAX_COMMENT, readOnly: posting } }}
          />
          <Stack direction="row" sx={{ mt: 1, gap: 2, alignItems: 'center', justifyContent: 'flex-end' }}>
            {text.length >= COUNTER_FROM && (
              <Typography
                variant="caption"
                color={text.length >= MAX_COMMENT ? 'error' : 'text.secondary'}
                sx={{ fontVariantNumeric: 'tabular-nums' }}
              >
                {text.length} / {MAX_COMMENT}
              </Typography>
            )}
            <Box component="span" role="status" sx={VISUALLY_HIDDEN}>
              {text.length >= MAX_COMMENT ? 'Character limit reached' : ''}
            </Box>
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ display: { xs: 'none', sm: 'block' }, '@media (pointer: coarse)': { display: 'none' } }}
            >
              {modifier}+Enter to post
            </Typography>
            <Button
              variant="contained"
              onClick={() => void post()}
              disabled={blank}
              aria-busy={posting || undefined}
              startIcon={posting ? <CircularProgress size={16} color="inherit" /> : undefined}
              sx={{ minWidth: 104 }}
            >
              Post
            </Button>
          </Stack>
        </Box>
      )}
    </Box>
  );
}
