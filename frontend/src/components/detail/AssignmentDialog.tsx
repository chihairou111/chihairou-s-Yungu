'use client';
import { useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import Link from 'next/link';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import IconButton from '@mui/material/IconButton';
import Paper from '@mui/material/Paper';
import Skeleton from '@mui/material/Skeleton';
import Snackbar from '@mui/material/Snackbar';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import useMediaQuery from '@mui/material/useMediaQuery';
import Close from '@mui/icons-material/Close';
import CloudOffOutlined from '@mui/icons-material/CloudOffOutlined';
import LockClockOutlined from '@mui/icons-material/LockClockOutlined';
import SearchOffOutlined from '@mui/icons-material/SearchOffOutlined';
import type { AssignmentDetail } from '@/lib/types';
import { VISUALLY_HIDDEN } from '../visually-hidden';
import { ApiError, fetchDetail, isSessionEnded } from './api';
import AttachmentsSection from './AttachmentsSection';
import CommentsSection from './CommentsSection';
import { DetailContext, type DetailActions } from './DetailContext';
import DetailHeader from './DetailHeader';
import Instructions from './Instructions';
import { EASE_OUT, FADE_MS, popIn } from './motion';
import { useTaskParam } from './useTaskParam';
import { useRegisterDetailRefresh } from '../RefreshContext';
import { WorkProvider } from './WorkContext';
import WriteView from './WriteView';
import YourWork, { type WorkFocus } from './YourWork';

/** Width of the Your work column beside the content (from 900px). */
const WORK_PX = 320;

type Loaded =
  | { kind: 'ready'; detail: AssignmentDetail }
  | { kind: 'not-found' }
  | { kind: 'session-ended' }
  | { kind: 'error'; message: string };

function fromError(error: unknown): Loaded {
  if (error instanceof ApiError) {
    if (error.status === 401) return { kind: 'session-ended' };
    if (error.status === 404 || error.status === 400) return { kind: 'not-found' };
    return { kind: 'error', message: error.message };
  }
  return { kind: 'error', message: 'Something went wrong. Try again.' };
}

/**
 * The assignment pop-up, driven by `?task=ID` (writer `&write=1`, for an online document `&doc=FILEID`). About 90% of the window, up to
 * 1200px wide; full-screen on phones. A fixed header (course · teacher, title, due facts, ✕) over one
 * scrolling body: content on the left (Instructions, Attachments, Comments) and Your work in a 320px
 * column that stays in view, stacked below 900px (Your work after the attachments, comments last).
 */
export default function AssignmentDialog({ now }: { now: number }) {
  const { taskId, isOpen, writing, docId, close, openWriter, closeWriter } = useTaskParam();
  const titleId = useId();
  const reduceMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  // A short confirmation after the writer's document lands in Your work.
  const [notice, setNotice] = useState<string | null>(null);
  // Where focus returns when the writer closes: the saved document's row, the edited one's, else Write.
  const [workFocus, setWorkFocus] = useState<WorkFocus | null>(null);
  if (!isOpen && (notice !== null || workFocus !== null)) {
    setNotice(null);
    setWorkFocus(null);
  }
  const [result, setResult] = useState<{ key: string; loaded: Loaded } | null>(null);

  // While the dialog fades out the URL no longer names the task; keep showing what was open.
  const [shown, setShown] = useState({ taskId, writing, docId });
  if (isOpen && (shown.taskId !== taskId || shown.writing !== writing || shown.docId !== docId)) {
    // Leaving the writer by any route (←, Esc, browser Back) returns focus to Your work.
    if (shown.writing && !writing && shown.taskId === taskId && workFocus === null) {
      setWorkFocus(shown.docId ? { kind: 'file', id: shown.docId } : { kind: 'write' });
    }
    setShown({ taskId, writing, docId });
  }
  const view = isOpen ? { taskId, writing, docId } : shown;

  // Each opening (and each retry) is a new generation, so a result cached from an earlier opening is
  // never shown again: reopening loads afresh behind the skeleton instead of flashing old state.
  const [generation, setGeneration] = useState(0);
  const openKey = isOpen ? String(taskId) : null;
  const [lastOpenKey, setLastOpenKey] = useState(openKey);
  if (openKey !== lastOpenKey) {
    setLastOpenKey(openKey);
    if (openKey !== null) setGeneration((n) => n + 1);
  }

  const key = `${view.taskId}:${generation}`;
  useEffect(() => {
    if (!isOpen || taskId === null) return;
    const controller = new AbortController();
    const requestKey = `${taskId}:${generation}`;
    fetchDetail(taskId, controller.signal).then(
      (detail) => setResult({ key: requestKey, loaded: { kind: 'ready', detail } }),
      (error: unknown) => {
        if (!controller.signal.aborted) setResult({ key: requestKey, loaded: fromError(error) });
      },
    );
    return () => controller.abort();
  }, [isOpen, taskId, generation]);

  const actions = useMemo<DetailActions>(
    () => ({
      async refresh() {
        if (taskId === null) return;
        const requestKey = `${taskId}:${generation}`;
        try {
          const detail = await fetchDetail(taskId);
          setResult((current) => (current?.key === requestKey ? { key: requestKey, loaded: { kind: 'ready', detail } } : current));
        } catch (error) {
          if (isSessionEnded(error)) setResult({ key: requestKey, loaded: { kind: 'session-ended' } });
          throw error;
        }
      },
    }),
    [taskId, generation],
  );

  // The app bar's Refresh (behind the backdrop, but reachable by its action) reloads this one too.
  useRegisterDetailRefresh(isOpen && taskId !== null ? actions.refresh : null);

  // A non-numeric id is never sent to the server.
  const loaded: Loaded | null = view.taskId === null ? { kind: 'not-found' } : result?.key === key ? result.loaded : null;
  // Messages (not found, signed out, failed) take a small dialog; the detail and its skeleton the large one.
  const compact = loaded !== null && loaded.kind !== 'ready';

  return (
    <Dialog
      open={isOpen}
      onClose={(_, reason) => (reason === 'escapeKeyDown' && view.writing ? closeWriter() : close())}
      maxWidth={false}
      aria-labelledby={titleId}
      slotProps={{
        transition: popIn(reduceMotion),
        paper: {
          'aria-busy': loaded === null ? true : undefined,
          sx: (theme) => ({
            bgcolor: theme.yungu.color.surfaceContainerLowest,
            backgroundImage: 'none',
            overflow: 'hidden',
            borderRadius: `${theme.yungu.shape.extraLarge}px`,
            // The skeleton opens large; a message (not found, signed out) then shrinks the same dialog
            // to fit it instead of snapping. `interpolate-size` lets the height animate to `auto`.
            interpolateSize: 'allow-keywords',
            transition: theme.transitions.create(['width', 'max-width', 'height', 'max-height', 'margin', 'border-radius'], {
              duration: theme.transitions.duration.enteringScreen,
              easing: theme.transitions.easing.easeInOut,
            }),
            '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
            ...(compact
              ? { m: 2, width: 'calc(100% - 32px)', maxWidth: 440, height: 'auto', maxHeight: 'calc(100% - 32px)' }
              : {
                  m: { xs: 0, sm: 4 },
                  width: { xs: '100%', sm: 'calc(100% - 64px)' },
                  maxWidth: { xs: '100%', sm: 1200 },
                  height: { xs: '100%', sm: 'calc(100% - 64px)' },
                  maxHeight: { xs: '100%', sm: 'calc(100% - 64px)' },
                  borderRadius: { xs: 0, sm: `${theme.yungu.shape.extraLarge}px` },
                }),
          }),
        },
      }}
    >
      {/* Each view (loading, the assignment, a message) fades in as it replaces the last. */}
      <ViewFade key={loaded === null ? 'loading' : loaded.kind}>
        {loaded === null ? (
          <LoadingView titleId={titleId} onClose={close} />
        ) : loaded.kind === 'ready' ? (
          <DetailContext.Provider value={actions}>
            {/* Above the view switch, so the work (and anything still uploading) outlives a trip to the writer. */}
            <WorkProvider key={loaded.detail.id} detail={loaded.detail}>
              {/* The writer and the assignment fade into each other, the work staying put above them. */}
              <ViewSwitchFade view={view.writing ? `write:${view.docId ?? ''}` : 'detail'}>
                {view.writing ? (
                  <WriteView
                    detail={loaded.detail}
                    titleId={titleId}
                    docId={view.docId}
                    onBack={closeWriter}
                    onDone={(file) => {
                      setNotice(`Saved ${file.name} to Your work`);
                      setWorkFocus({ kind: 'file', id: file.id });
                      closeWriter();
                    }}
                  />
                ) : (
                  <DetailView
                    detail={loaded.detail}
                    now={now}
                    titleId={titleId}
                    onClose={close}
                    onWrite={(doc) => {
                      setWorkFocus(null);
                      openWriter(doc);
                    }}
                    workFocus={workFocus}
                  />
                )}
              </ViewSwitchFade>
            </WorkProvider>
          </DetailContext.Provider>
        ) : loaded.kind === 'not-found' ? (
          <StatusView
            titleId={titleId}
            icon={<SearchOffOutlined />}
            title="Assignment not found"
            text="It may have been removed, or the link is incomplete."
            actions={<Button variant="contained" onClick={close}>Close</Button>}
          />
        ) : loaded.kind === 'session-ended' ? (
          <StatusView
            titleId={titleId}
            icon={<LockClockOutlined />}
            title="Signed out"
            text="Your session ended — sign in again."
            actions={
              <>
                <Button onClick={close}>Close</Button>
                <Button variant="contained" component={Link} href="/login">
                  Sign in
                </Button>
              </>
            }
          />
        ) : (
          <StatusView
            titleId={titleId}
            icon={<CloudOffOutlined />}
            title="Couldn’t load this assignment"
            text={loaded.message}
            actions={
              <>
                <Button onClick={close}>Close</Button>
                <Button variant="contained" onClick={() => setGeneration((n) => n + 1)}>
                  Try again
                </Button>
              </>
            }
          />
        )}
      </ViewFade>
      <Snackbar
        open={notice !== null}
        message={notice}
        autoHideDuration={4000}
        onClose={(_, reason) => reason !== 'clickaway' && setNotice(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
        slotProps={{ transition: reduceMotion ? { timeout: 0 } : undefined }}
      />
    </Dialog>
  );
}

/**
 * Fills the paper like the view it holds and fades that view in: opacity only, so it reads the same with
 * reduced motion, and nothing waits for it (focus and typing work from the first frame). `still` holds
 * a view that is already fading in with its parent, so the two do not multiply.
 */
function ViewFade({ children, still = false }: { children: ReactNode; still?: boolean }) {
  return (
    <Box
      data-view-fade={still ? 'still' : 'in'}
      sx={{
        flex: 1,
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        ...(!still && { animation: `yl-view-in ${FADE_MS}ms ${EASE_OUT}`, '@keyframes yl-view-in': { from: { opacity: 0 } } }),
      }}
    >
      {children}
    </Box>
  );
}

/**
 * The writer and the assignment fading into each other. The first view shown arrives with the loaded
 * detail's own fade; only a switch after that fades on its own.
 */
function ViewSwitchFade({ view, children }: { view: string; children: ReactNode }) {
  const [first] = useState(view);
  const [switched, setSwitched] = useState(false);
  if (!switched && view !== first) setSwitched(true);
  return (
    <ViewFade key={view} still={!switched && view === first}>
      {children}
    </ViewFade>
  );
}

/** The fixed top of the dialog: header content and the ✕, closed off from the scrolling body by a hairline. */
function TopBar({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  return (
    <Stack
      direction="row"
      sx={{
        alignItems: 'flex-start',
        gap: 2,
        flexShrink: 0,
        pl: { xs: 2, sm: 3 },
        pr: { xs: 1, sm: 2 },
        pt: { xs: 2, sm: 2.5 },
        pb: 2,
        borderBottom: 1,
        borderColor: 'divider',
      }}
    >
      <Box sx={{ flex: 1, minWidth: 0 }}>{children}</Box>
      <IconButton onClick={onClose} aria-label="Close" sx={{ mt: -0.5 }}>
        <Close />
      </IconButton>
    </Stack>
  );
}

/** The scrolling body with its two areas: content (and comments) on the left, Your work on the right. */
function Body({ content, work, comments }: { content: ReactNode; work: ReactNode; comments?: ReactNode }) {
  return (
    <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto', overscrollBehavior: 'contain' }}>
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: 'minmax(0, 1fr)', md: `minmax(0, 1fr) ${WORK_PX}px` },
          gridTemplateAreas: { xs: '"content" "work" "comments"', md: '"content work" "comments work"' },
          gridTemplateRows: { md: 'auto 1fr' },
          columnGap: 5,
          rowGap: 4,
          p: { xs: 2, sm: 3 },
          pb: { xs: 4, sm: 5 },
        }}
      >
        <Stack sx={{ gridArea: 'content', gap: 4, minWidth: 0 }}>{content}</Stack>
        <Paper
          variant="outlined"
          component="section"
          aria-label="Your work"
          sx={(theme) => ({
            gridArea: 'work',
            alignSelf: 'start',
            position: { md: 'sticky' },
            top: { md: theme.spacing(3) },
            p: 2.5,
            borderRadius: `${theme.yungu.shape.large}px`,
          })}
        >
          {work}
        </Paper>
        {comments && <Box sx={{ gridArea: 'comments', minWidth: 0 }}>{comments}</Box>}
      </Box>
    </Box>
  );
}

interface DetailViewProps {
  detail: AssignmentDetail;
  now: number;
  titleId: string;
  onClose: () => void;
  onWrite: (docId?: string) => void;
  workFocus: WorkFocus | null;
}

function DetailView({ detail, now, titleId, onClose, onWrite, workFocus }: DetailViewProps) {
  return (
    <>
      <TopBar onClose={onClose}>
        <DetailHeader detail={detail} now={now} titleId={titleId} />
      </TopBar>
      <Body
        content={
          <>
            <Instructions html={detail.instructionsHtml} title={detail.title} />
            <AttachmentsSection files={detail.attachments} />
          </>
        }
        work={<YourWork onWrite={onWrite} focusOnMount={workFocus} />}
        comments={<CommentsSection taskId={detail.id} comments={detail.comments} />}
      />
    </>
  );
}

/** The detail's shape in grey while it loads, so nothing jumps when it arrives. */
function LoadingView({ titleId, onClose }: { titleId: string; onClose: () => void }) {
  return (
    <>
      <TopBar onClose={onClose}>
        <Typography id={titleId} component="h2" sx={VISUALLY_HIDDEN}>
          Loading assignment
        </Typography>
        <Skeleton width={180} />
        <Skeleton variant="text" sx={{ fontSize: '1.5rem', maxWidth: 420 }} />
        <Skeleton width={260} sx={{ mt: 1 }} />
      </TopBar>
      <Body
        content={
          <Box>
            <Skeleton width={120} sx={{ fontSize: '1rem', mb: 1 }} />
            {[100, 96, 98, 72].map((w, i) => (
              <Skeleton key={i} sx={{ maxWidth: `${w}%` }} />
            ))}
          </Box>
        }
        work={
          <>
            <Skeleton width={100} sx={{ fontSize: '1rem' }} />
            <Skeleton width={140} />
            <Skeleton variant="rounded" height={36} sx={{ mt: 2 }} />
          </>
        }
      />
    </>
  );
}

interface StatusViewProps {
  titleId: string;
  icon: ReactNode;
  title: string;
  text: string;
  actions: ReactNode;
}

/** Not found, signed out, failed: one calm message in a small dialog, with what to do next. */
function StatusView({ titleId, icon, title, text, actions }: StatusViewProps) {
  return (
    <Stack sx={{ alignItems: 'center', textAlign: 'center', px: 3, pt: 4, pb: 3 }}>
      <Box sx={{ color: 'text.secondary', mb: 1.5, '& svg': { fontSize: 40 } }}>{icon}</Box>
      <Typography id={titleId} variant="h2" component="h2">
        {title}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mt: 1, maxWidth: 360 }}>
        {text}
      </Typography>
      <Stack direction="row" sx={{ mt: 3, gap: 1, flexWrap: 'wrap', justifyContent: 'center' }}>
        {actions}
      </Stack>
    </Stack>
  );
}
