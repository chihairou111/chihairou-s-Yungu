'use client';
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import ButtonBase from '@mui/material/ButtonBase';
import Dialog from '@mui/material/Dialog';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import useMediaQuery from '@mui/material/useMediaQuery';
import ChevronLeft from '@mui/icons-material/ChevronLeft';
import ChevronRight from '@mui/icons-material/ChevronRight';
import Close from '@mui/icons-material/Close';
import DownloadOutlined from '@mui/icons-material/DownloadOutlined';
import EditOutlined from '@mui/icons-material/EditOutlined';
import OpenInNew from '@mui/icons-material/OpenInNew';
import type { Theme } from '@mui/material/styles';
import { FILE_STORAGE_UNREACHABLE } from '@/lib/data/errors';
import { deltaToHtml, parseDelta, type Delta } from '@/lib/quill-delta';
import type { FileRef } from '@/lib/types';
import { embedSx, quoteSx, strikeSx } from './docStyles';
import { FileKindIcon, fileCaption, previewPdf } from './FileThumb';
import { proseSx } from './Instructions';
import { pdfViewUrl } from './pdfThumb';

/**
 * The viewer is a dark room, so the file is the brightest thing on screen. Text and
 * icons on `BG` stay above 7:1 (`TEXT`) and 4.5:1 (`MUTED`); the focus ring is the M3 dark primary.
 */
const V = {
  bg: '#141519',
  panel: '#1b1c21',
  line: 'rgba(255, 255, 255, 0.10)',
  text: '#e4e2e6',
  muted: '#a5a7b0',
  selected: '#2c3447',
  hover: 'rgba(255, 255, 255, 0.06)',
  focus: '#a8c7fa',
} as const;

/** `url` with `download=1`, which the file route answers as an attachment. */
export function downloadUrl(url: string): string {
  return `${url}${url.includes('?') ? '&' : '?'}download=1`;
}

/** The PDF the stage and "Open in new tab" show (an Office file's PDF rendition), or null. */
function viewPdf(file: FileRef): string | null {
  const pdf = previewPdf(file);
  return pdf === null ? null : pdfViewUrl(pdf);
}

/** An online document's text, when it came with the document and reads as a Quill delta; else null. */
export function docDelta(file: FileRef): Delta | null {
  return file.online && file.content ? parseDelta(file.content) : null;
}

/** What "Open in new tab" opens: the browser can show a PDF rendition of an Office file, not the file. */
function viewUrl(file: FileRef): string {
  return viewPdf(file) ?? file.url;
}

interface FileViewerProps {
  files: FileRef[];
  index: number;
  onClose: () => void;
  onIndexChange: (index: number) => void;
  /** Lets the parent keep the viewer mounted while it fades out; open by default. */
  open?: boolean;
  /** Offers Edit on an online document whose text came with it (the student's own work). */
  onEdit?: (file: FileRef) => void;
  /** The viewer has finished fading out. */
  onExited?: () => void;
}

/**
 * A full-screen viewer for a set of files: the current file large in the middle (PDFs and Office
 * renditions in the browser's own PDF viewer, images fitted, video and audio with controls), the list
 * of files beside it from 900px and as a strip underneath below that. ←/→ step through the files, Esc
 * closes, and focus goes back to whatever opened it.
 */
export default function FileViewer({ files, index, onClose, onIndexChange, open = true, onEdit, onExited }: FileViewerProps) {
  const titleId = useId();
  const reduceMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  const at = Math.min(Math.max(index, 0), files.length - 1);
  const file = files[at];
  const many = files.length > 1;

  const go = (next: number) => {
    if (next >= 0 && next < files.length && next !== at) onIndexChange(next);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    // Arrow keys already mean something in a media timeline or a text field.
    const target = event.target as HTMLElement;
    if (target.closest('video, audio, input, textarea, [contenteditable="true"], [role="slider"]')) return;
    event.preventDefault();
    go(at + (event.key === 'ArrowRight' ? 1 : -1));
  };

  if (!file) return null;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullScreen
      aria-labelledby={titleId}
      onKeyDown={onKeyDown}
      transitionDuration={reduceMotion ? 0 : undefined}
      slotProps={{
        transition: { onExited },
        paper: {
          sx: {
            bgcolor: V.bg,
            backgroundImage: 'none',
            color: V.text,
            '& .Mui-focusVisible, & :focus-visible': { outline: `2px solid ${V.focus}`, outlineOffset: '2px' },
            '& ::selection': { bgcolor: V.selected, color: '#fff' },
          },
        },
      }}
    >
      <TopBar
        file={file}
        titleId={titleId}
        at={at}
        count={files.length}
        onClose={onClose}
        onStep={(d) => go(at + d)}
        onEdit={onEdit && docDelta(file) ? () => onEdit(file) : undefined}
      />
      <Box
        sx={{
          flex: 1,
          minHeight: 0,
          display: 'grid',
          gridTemplateColumns: many ? { xs: 'minmax(0, 1fr)', md: '260px minmax(0, 1fr)' } : 'minmax(0, 1fr)',
          gridTemplateRows: many ? { xs: 'minmax(0, 1fr) auto', md: 'minmax(0, 1fr)' } : 'minmax(0, 1fr)',
          gridTemplateAreas: many ? { xs: '"stage" "list"', md: '"list stage"' } : '"stage"',
        }}
      >
        {many && <FileList files={files} at={at} onPick={go} />}
        <Box sx={{ gridArea: 'stage', minWidth: 0, minHeight: 0, display: 'flex', p: { xs: 0, sm: 2, md: 3 } }}>
          <Stage key={file.id} file={file} />
        </Box>
      </Box>
    </Dialog>
  );
}

interface TopBarProps {
  file: FileRef;
  titleId: string;
  at: number;
  count: number;
  onClose: () => void;
  onStep: (delta: number) => void;
  onEdit?: () => void;
}

const darkOutlined = {
  color: V.text,
  borderColor: 'rgba(255, 255, 255, 0.32)',
  whiteSpace: 'nowrap',
  // Icon-only on phones: a full 48px touch target.
  minWidth: { xs: 48, sm: 64 },
  minHeight: { xs: 48, sm: 0 },
  px: { xs: 1, sm: 2 },
  '&:hover': { borderColor: V.text, bgcolor: V.hover },
  '& .MuiButton-startIcon': { m: { xs: 0, sm: '0 8px 0 -4px' } },
} as const;

function TopBar({ file, titleId, at, count, onClose, onStep, onEdit }: TopBarProps) {
  return (
    <Stack
      direction="row"
      sx={{
        alignItems: 'center',
        gap: { xs: 1, sm: 1.5 },
        flexShrink: 0,
        minHeight: 64,
        pl: { xs: 0.5, sm: 1.5 },
        pr: { xs: 1, sm: 2 },
        py: 1,
        bgcolor: V.panel,
        borderBottom: `1px solid ${V.line}`,
      }}
    >
      <IconButton onClick={onClose} aria-label="Close" sx={{ p: { xs: 1.5, sm: 1 }, color: V.text, '&:hover': { bgcolor: V.hover } }}>
        <Close />
      </IconButton>
      <Box aria-live="polite" sx={{ flex: 1, minWidth: 0 }}>
        <Typography
          id={titleId}
          component="h2"
          variant="subtitle1"
          title={file.name}
          sx={{ fontWeight: 500, lineHeight: 1.35, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
        >
          {file.name}
        </Typography>
        <Typography variant="caption" component="p" sx={{ color: V.muted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {fileCaption(file)}
        </Typography>
      </Box>
      {count > 1 && (
        <Stack direction="row" sx={{ alignItems: 'center', flexShrink: 0 }}>
          <IconButton
            onClick={() => onStep(-1)}
            disabled={at === 0}
            aria-label="Previous file"
            sx={{ display: { xs: 'none', sm: 'inline-flex' }, color: V.text, '&:hover': { bgcolor: V.hover }, '&.Mui-disabled': { color: 'rgba(255, 255, 255, 0.28)' } }}
          >
            <ChevronLeft />
          </IconButton>
          <Typography
            component="span"
            variant="body2"
            sx={{ color: V.muted, fontVariantNumeric: 'tabular-nums', minWidth: '3.5em', textAlign: 'center', whiteSpace: 'nowrap' }}
          >
            File {at + 1} of {count}
          </Typography>
          <IconButton
            onClick={() => onStep(1)}
            disabled={at === count - 1}
            aria-label="Next file"
            sx={{ display: { xs: 'none', sm: 'inline-flex' }, color: V.text, '&:hover': { bgcolor: V.hover }, '&.Mui-disabled': { color: 'rgba(255, 255, 255, 0.28)' } }}
          >
            <ChevronRight />
          </IconButton>
        </Stack>
      )}
      {onEdit && (
        <Button
          variant="contained"
          onClick={onEdit}
          startIcon={<EditOutlined />}
          sx={{
            flexShrink: 0,
            whiteSpace: 'nowrap',
            minHeight: { xs: 48, sm: 0 },
            color: V.bg,
            bgcolor: V.focus,
            boxShadow: 'none',
            '&:hover': { bgcolor: '#c2d7fb', boxShadow: 'none' },
          }}
        >
          Edit
        </Button>
      )}
      {/* An online document has no file behind it: both links would only meet an error. */}
      {!file.online && (
        <Stack direction="row" sx={{ gap: 1, flexShrink: 0 }}>
          <Button
            variant="outlined"
            href={downloadUrl(file.url)}
            download={file.name}
            aria-label="Download"
            startIcon={<DownloadOutlined />}
            sx={darkOutlined}
          >
            <Box component="span" sx={{ display: { xs: 'none', sm: 'inline' } }}>
              Download
            </Box>
          </Button>
          <Button
            variant="outlined"
            href={viewUrl(file)}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Open in new tab"
            startIcon={<OpenInNew />}
            sx={darkOutlined}
          >
            <Box component="span" sx={{ display: { xs: 'none', md: 'inline' } }}>
              Open in new tab
            </Box>
          </Button>
        </Stack>
      )}
    </Stack>
  );
}

/** Every file, the current one marked: a column at the side from 900px, a scrolling strip below. */
function FileList({ files, at, onPick }: { files: FileRef[]; at: number; onPick: (index: number) => void }) {
  const currentRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    currentRef.current?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [at]);

  return (
    <Box
      sx={{
        gridArea: 'list',
        minWidth: 0,
        minHeight: 0,
        bgcolor: V.panel,
        borderTop: { xs: `1px solid ${V.line}`, md: 'none' },
        borderRight: { md: `1px solid ${V.line}` },
        overflow: 'auto',
        overscrollBehavior: 'contain',
        scrollbarColor: `${V.line} transparent`,
      }}
    >
      <Box
        component="ul"
        aria-label="Files"
        sx={{
          listStyle: 'none',
          m: 0,
          p: 1,
          display: 'flex',
          flexDirection: { xs: 'row', md: 'column' },
          gap: 0.5,
        }}
      >
        {files.map((f, i) => {
          const current = i === at;
          return (
            <Box component="li" key={f.id} sx={{ flexShrink: 0, width: { xs: 200, md: 'auto' } }}>
              <ButtonBase
                ref={current ? currentRef : undefined}
                onClick={() => onPick(i)}
                aria-current={current ? 'true' : undefined}
                sx={(theme) => ({
                  width: '100%',
                  display: 'flex',
                  alignItems: 'flex-start',
                  justifyContent: 'flex-start',
                  gap: 1.25,
                  px: 1.25,
                  py: 1,
                  textAlign: 'left',
                  borderRadius: `${theme.yungu.shape.small}px`,
                  color: current ? '#fff' : V.text,
                  bgcolor: current ? V.selected : 'transparent',
                  transition: theme.transitions.create('background-color', { duration: theme.transitions.duration.shortest }),
                  '&:hover': { bgcolor: current ? V.selected : V.hover },
                  '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
                })}
              >
                <FileKindIcon file={f} sx={{ fontSize: 20, mt: '1px', flexShrink: 0, color: current ? '#fff' : V.muted }} />
                <Box component="span" sx={{ minWidth: 0, display: 'block' }}>
                  <Typography
                    component="span"
                    variant="body2"
                    sx={{
                      display: '-webkit-box',
                      WebkitLineClamp: { xs: 1, md: 2 },
                      WebkitBoxOrient: 'vertical',
                      overflow: 'hidden',
                      overflowWrap: 'anywhere',
                      fontWeight: current ? 500 : 400,
                      lineHeight: 1.4,
                    }}
                  >
                    {f.name}
                  </Typography>
                  <Typography component="span" variant="caption" sx={{ display: 'block', color: current ? '#cfd3dc' : V.muted }}>
                    {fileCaption(f)}
                  </Typography>
                </Box>
              </ButtonBase>
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}

/**
 * Asks the file route for one byte of `url` and says whether it answered that Yungu's file storage cannot
 * be reached (a frame or image cannot report an HTTP error body itself). Any other outcome is false.
 */
async function storageBlocked(url: string, signal: AbortSignal): Promise<boolean> {
  try {
    const res = await fetch(url, { headers: { range: 'bytes=0-0' }, cache: 'no-store', signal });
    if (res.ok || res.status !== 502) return false;
    return ((await res.json()) as { error?: string }).error === FILE_STORAGE_UNREACHABLE;
  } catch {
    return false;
  }
}

/** True once a request for `url` has been found to fail with the file-storage sentence. Probes at once when `now`. */
function useStorageBlocked(url: string | null, now: boolean): { blocked: boolean; probe: () => void } {
  const [blocked, setBlocked] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const probe = () => {
    if (!url) return;
    abort.current?.abort();
    const ctl = (abort.current = new AbortController());
    void storageBlocked(url, ctl.signal).then((b) => {
      if (b && !ctl.signal.aborted) setBlocked(true);
    });
  };
  useEffect(() => {
    if (now) probe();
    return () => abort.current?.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, now]);
  return { blocked, probe };
}

/** The viewer's own failure state for a file that cannot be fetched, in the same place and tone as "No preview". */
function StorageBlocked({ file }: { file: FileRef }) {
  return (
    <Stack sx={{ flex: 1, minWidth: 0, minHeight: 0, alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 1.5, px: 3, textAlign: 'center' }}>
      <FileKindIcon file={file} sx={{ fontSize: 64, color: V.muted }} />
      <Typography variant="body1" role="alert">
        {FILE_STORAGE_UNREACHABLE}
      </Typography>
    </Stack>
  );
}

/** The current file, as large as the stage allows. */
function Stage({ file }: { file: FileRef }) {
  const pdf = viewPdf(file);
  const { blocked, probe } = useStorageBlocked(pdf ?? file.url, pdf !== null);
  const fill = { flex: 1, minWidth: 0, minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' } as const;

  if (blocked) return <StorageBlocked file={file} />;
  if (pdf) {
    return (
      <Box
        component="iframe"
        src={pdf}
        title={file.name}
        sx={(theme) => ({
          flex: 1,
          width: '100%',
          height: '100%',
          border: 0,
          bgcolor: '#525659', // Chrome's PDF viewer backdrop, so the frame does not flash while it loads
          borderRadius: { xs: 0, sm: `${theme.yungu.shape.small}px` },
        })}
      />
    );
  }
  if (file.kind === 'image') {
    return (
      <Box sx={fill}>
        <Box component="img" src={file.url} alt={file.name} onError={probe} sx={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', display: 'block' }} />
      </Box>
    );
  }
  if (file.kind === 'video') {
    return (
      <Box sx={fill}>
        {/* Scaled up to the stage (letterboxed), so a small classroom clip is not a postage stamp. */}
        <Box component="video" src={file.url} controls playsInline sx={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }} />
      </Box>
    );
  }
  if (file.kind === 'audio') {
    return (
      <Stack sx={{ ...fill, flexDirection: 'column', gap: 2, px: 2 }}>
        <FileKindIcon file={file} sx={{ fontSize: 64, color: V.muted }} />
        <Box component="audio" src={file.url} controls sx={{ width: 'min(480px, 100%)' }} />
      </Stack>
    );
  }
  const delta = docDelta(file);
  if (delta) return <DocPage file={file} delta={delta} />;
  if (file.online) {
    return (
      <Stack sx={{ ...fill, flexDirection: 'column', gap: 1.5, px: 3, textAlign: 'center' }}>
        <FileKindIcon file={file} sx={{ fontSize: 64, color: V.muted }} />
        <Typography variant="body1">Open this online document on Yungu.</Typography>
        <Typography variant="body2" sx={{ color: V.muted, maxWidth: 360 }}>
          Its text is kept on Yungu, so there is no file to download here.
        </Typography>
      </Stack>
    );
  }
  return (
    <Stack sx={{ ...fill, flexDirection: 'column', gap: 1.5, px: 3, textAlign: 'center' }}>
      <FileKindIcon file={file} sx={{ fontSize: 64, color: V.muted }} />
      <Typography variant="body1">No preview for this file type.</Typography>
      <Typography variant="body2" sx={{ color: V.muted, maxWidth: 360 }}>
        Download it to open it in an app on your computer.
      </Typography>
      <Button variant="contained" href={downloadUrl(file.url)} download={file.name} startIcon={<DownloadOutlined />} sx={{ mt: 1 }}>
        Download
      </Button>
    </Stack>
  );
}

/** An online document's headings nest under the viewer's title (h2): h1 → h3, h2 → h4. */
function nestDocHeadings(html: string): string {
  return html.replace(/<(\/?)h([12])\b/g, (_, slash: string, level: string) => `<${slash}h${Number(level) + 2}`);
}

/**
 * An online document, read: its text as a page lit in the dark room, set like the assignment's
 * instructions. The page scrolls on its own; nothing is fetched (the text came with the document, and
 * only Yungu's storage serves its media, which load only when played — anything else is a labelled placeholder).
 */
function DocPage({ file, delta }: { file: FileRef; delta: Delta }) {
  const html = nestDocHeadings(deltaToHtml(delta));
  return (
    <Box sx={{ flex: 1, minWidth: 0, minHeight: 0, overflowY: 'auto', overscrollBehavior: 'contain', scrollbarColor: `${V.line} transparent` }}>
      <Box
        component="article"
        aria-label={file.name}
        sx={(theme) => ({
          boxSizing: 'border-box',
          maxWidth: 820,
          minHeight: { xs: '100%', sm: 'auto' },
          mx: 'auto',
          px: { xs: 2.5, sm: 6 },
          py: { xs: 3, sm: 5 },
          bgcolor: theme.yungu.color.surfaceContainerLowest,
          color: theme.palette.text.primary,
          borderRadius: { xs: 0, sm: `${theme.yungu.shape.medium}px` },
          boxShadow: { sm: '0 1px 2px rgba(0, 0, 0, 0.4), 0 8px 24px rgba(0, 0, 0, 0.32)' },
          '& ::selection': { bgcolor: theme.yungu.color.primaryContainer, color: theme.yungu.color.onPrimaryContainer },
          '& :focus-visible': { outlineColor: `${theme.palette.primary.main} !important` },
        })}
      >
        <Box
          // Built by deltaToHtml from escaped parts only: http(s)/mailto links, Yungu-hosted media and file links, placeholders.
          dangerouslySetInnerHTML={{ __html: html }}
          sx={[proseSx, docExtrasSx]}
        />
      </Box>
    </Box>
  );
}

/** What a Yungu document has beyond the instructions: two heading steps, strike, quotes, media chips. */
const docExtrasSx = (theme: Theme) => ({
  maxWidth: '72ch',
  mx: 'auto',
  '& h3': { fontSize: '1.5rem', fontWeight: 700, lineHeight: 1.3, letterSpacing: '-0.01em', mt: 3.5, mb: 1 },
  '& h4': { fontSize: '1.1875rem', fontWeight: 650, lineHeight: 1.4, letterSpacing: 0, color: 'text.primary', mt: 3, mb: 0.75 },
  '& s': strikeSx,
  '& blockquote': { ...quoteSx(theme), my: 1.25, mx: 0 },
  // Yungu writes a quote one line at a time; consecutive lines read as one quote.
  '& blockquote + blockquote': { mt: -1.25 },
  '& .yungu-embed': { ...embedSx(theme), my: 1.25 },
  // Yungu-hosted media, played only on request: as wide as the text at most, set like an image.
  // Nothing is preloaded, so the size can't come from the file: a 16:9 frame until it plays.
  '& video': {
    display: 'block',
    width: '100%',
    height: 'auto',
    aspectRatio: '16 / 9',
    maxHeight: '70vh',
    my: 1.5,
    borderRadius: `${theme.yungu.shape.small}px`,
    bgcolor: 'common.black',
  },
  '& audio': { display: 'block', width: '100%', maxWidth: 480, my: 1.25 },
});
