'use client';
import { useCallback, useEffect, useRef, useState, type ReactNode, type RefObject, type SyntheticEvent } from 'react';
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import Skeleton from '@mui/material/Skeleton';
import Typography from '@mui/material/Typography';
import useMediaQuery from '@mui/material/useMediaQuery';
import { alpha, type Theme } from '@mui/material/styles';
import type { SvgIconProps } from '@mui/material/SvgIcon';
import AudioFileOutlined from '@mui/icons-material/AudioFileOutlined';
import DescriptionOutlined from '@mui/icons-material/DescriptionOutlined';
import ImageOutlined from '@mui/icons-material/ImageOutlined';
import InsertDriveFileOutlined from '@mui/icons-material/InsertDriveFileOutlined';
import MovieOutlined from '@mui/icons-material/MovieOutlined';
import PictureAsPdfOutlined from '@mui/icons-material/PictureAsPdfOutlined';
import PlayArrowRounded from '@mui/icons-material/PlayArrowRounded';
import SlideshowOutlined from '@mui/icons-material/SlideshowOutlined';
import TableChartOutlined from '@mui/icons-material/TableChartOutlined';
import type { FileRef } from '@/lib/types';
import { EASE_OUT, FADE_MS } from './motion';
import { cachedPreview, isAbort, loadPreview, type PdfPreview } from './pdfThumb';

const UNITS = ['KB', 'MB', 'GB'];

/** "900 B", "17 KB", "4.3 MB", "75 MB": one decimal below 10, whole numbers above. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${Math.max(0, Math.round(bytes))} B`;
  let value = bytes / 1024;
  let unit = 0;
  while (unit < UNITS.length - 1 && Math.round(value) >= 1024) {
    value /= 1024;
    unit += 1;
  }
  const shown = unit > 0 && value < 10 ? value.toFixed(1).replace(/\.0$/, '') : String(Math.round(value));
  return `${shown} ${UNITS[unit]}`;
}

function extension(name: string): string {
  const match = /\.([a-z0-9]{1,8})$/i.exec(name);
  return match ? match[1].toLowerCase() : '';
}

const OFFICE_LABELS: Record<string, string> = {
  doc: 'Word',
  docx: 'Word',
  xls: 'Excel',
  xlsx: 'Excel',
  ppt: 'PowerPoint',
  pptx: 'PowerPoint',
  numbers: 'Numbers',
  pages: 'Pages',
  key: 'Keynote',
};

/** What kind of file this is, in words: "PDF", "Video", "Word", "Numbers", "ZIP", "File". */
export function fileTypeLabel(file: FileRef): string {
  switch (file.kind) {
    case 'pdf':
      return 'PDF';
    case 'image':
      return 'Image';
    case 'video':
      return 'Video';
    case 'audio':
      return 'Audio';
    case 'office':
      return OFFICE_LABELS[extension(file.name)] ?? 'Document';
    default:
      return extension(file.name).toUpperCase() || 'File';
  }
}

/** "PDF · 75 MB", or with the page count once known: "PDF · 3 pages · 17 KB", "Word · 1 page · 47 KB". */
export function fileCaption(file: FileRef, pages?: number): string {
  const count = pages === undefined ? '' : ` · ${pages} ${pages === 1 ? 'page' : 'pages'}`;
  return `${fileTypeLabel(file)}${count} · ${formatBytes(file.size)}`;
}

/** The icon for a file's type; spreadsheets and slides get their own among Office files. */
export function FileKindIcon({ file, ...props }: { file: FileRef } & SvgIconProps) {
  const ext = extension(file.name);
  const Icon =
    file.kind === 'pdf'
      ? PictureAsPdfOutlined
      : file.kind === 'image'
        ? ImageOutlined
        : file.kind === 'video'
          ? MovieOutlined
          : file.kind === 'audio'
            ? AudioFileOutlined
            : file.kind === 'office'
              ? ['xls', 'xlsx', 'numbers'].includes(ext)
                ? TableChartOutlined
                : ['ppt', 'pptx', 'key'].includes(ext)
                  ? SlideshowOutlined
                  : DescriptionOutlined
              : InsertDriveFileOutlined;
  return <Icon {...props} />;
}

/** The PDF whose first page previews this file: the file itself, or an Office file's PDF rendition. */
export function previewPdf(file: FileRef): string | null {
  if (file.kind === 'pdf') return file.url;
  if (file.kind === 'office') return file.previewPdfUrl ?? null;
  return null;
}

/** "0:42", "12:05", "1:02:03". */
export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

type Load = 'loading' | 'ready' | 'error';

/** True once the element has come near the viewport (at once where that cannot be observed). */
function useNearViewport<T extends Element>(): [RefObject<T | null>, boolean] {
  const ref = useRef<T>(null);
  const [near, setNear] = useState(() => typeof IntersectionObserver === 'undefined');
  useEffect(() => {
    const el = ref.current;
    if (!el || near) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        setNear(true);
        observer.disconnect();
      }
    }, { rootMargin: '200px' });
    observer.observe(el);
    return () => observer.disconnect();
  }, [near]);
  return [ref, near];
}

/**
 * The top of a PDF's first page, filling the preview. Rendered once near the viewport and then kept as an
 * image (see `loadPreview`), so scrolling, remounting or a lost GPU context never leaves it blank. Reports
 * ready only once the image has decoded, so the fade-in never plays over an empty box.
 */
function PdfPage({
  cacheKey,
  url,
  preview,
  onPreview,
  onLoad,
}: {
  cacheKey: string;
  url: string;
  preview: PdfPreview | undefined;
  onPreview: (preview: PdfPreview) => void;
  onLoad: (load: Load) => void;
}) {
  const [boxRef, near] = useNearViewport<HTMLSpanElement>();

  useEffect(() => {
    const box = boxRef.current;
    if (!near || preview || !box) return;
    // Unmounting (or StrictMode's rehearsal) cancels the render; a cancelled render is not a failure.
    const controller = new AbortController();
    loadPreview(cacheKey, url, box.clientWidth || 240, { signal: controller.signal }).then(onPreview, (error: unknown) => {
      if (!isAbort(error) && !controller.signal.aborted) onLoad('error');
    });
    return () => controller.abort();
  }, [boxRef, near, preview, cacheKey, url, onPreview, onLoad]);

  return (
    <Box component="span" ref={boxRef} sx={{ position: 'absolute', inset: 0, display: 'block', bgcolor: '#fff' }}>
      {preview && (
        <Box
          component="img"
          src={preview.src}
          alt=""
          onLoad={(e: SyntheticEvent<HTMLImageElement>) => {
            const img = e.currentTarget;
            // decode() settles once the pixels are ready to paint (not every browser or test DOM has it).
            const decoded = typeof img.decode === 'function' ? img.decode() : Promise.resolve();
            decoded.then(
              () => onLoad('ready'),
              () => onLoad('ready'),
            );
          }}
          onError={() => onLoad('error')}
          sx={{ ...FILL_SX, objectPosition: 'left top' }}
        />
      )}
    </Box>
  );
}

const FILL_SX = { position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', display: 'block' } as const;

function AudioPreview({ file, onLoad }: { file: FileRef; onLoad: (load: Load) => void }) {
  const [duration, setDuration] = useState<number | null>(null);
  return (
    <Centered>
      <AudioFileOutlined sx={{ fontSize: 36 }} />
      <Typography component="span" variant="body2" sx={{ fontVariantNumeric: 'tabular-nums', fontWeight: 500 }}>
        {duration === null ? 'Audio' : formatDuration(duration)}
      </Typography>
      <audio
        preload="metadata"
        src={file.url}
        hidden
        onLoadedMetadata={(e) => {
          const d = e.currentTarget.duration;
          // A fresh recording (WebM) reports Infinity until played through; leave the label as "Audio".
          if (Number.isFinite(d)) setDuration(d);
          onLoad('ready');
        }}
        onError={() => onLoad('ready')}
      />
    </Centered>
  );
}

function Centered({ children }: { children: ReactNode }) {
  return (
    <Box
      component="span"
      sx={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 0.5,
        color: 'text.secondary',
      }}
    >
      {children}
    </Box>
  );
}

/** The type icon and extension, for files with no rendered preview (or one that failed). */
function TypeTile({ file }: { file: FileRef }) {
  const ext = extension(file.name);
  return (
    <Centered>
      <FileKindIcon file={file} sx={{ fontSize: 40 }} />
      {ext && (
        <Typography component="span" variant="caption" sx={{ fontWeight: 600, letterSpacing: '0.04em' }}>
          .{ext.toUpperCase()}
        </Typography>
      )}
    </Centered>
  );
}

/** The rendered preview inside a tile, by kind; reports when it has painted (or failed). */
function Preview({
  file,
  cacheKey,
  load,
  pdfPreview,
  onPdfPreview,
  onLoad,
}: {
  file: FileRef;
  cacheKey: string;
  load: Load;
  pdfPreview: PdfPreview | undefined;
  onPdfPreview: (preview: PdfPreview) => void;
  onLoad: (load: Load) => void;
}) {
  if (load === 'error') return <TypeTile file={file} />;
  const pdf = previewPdf(file);
  if (pdf) return <PdfPage cacheKey={cacheKey} url={pdf} preview={pdfPreview} onPreview={onPdfPreview} onLoad={onLoad} />;
  switch (file.kind) {
    case 'image':
      return (
        <Box
          component="img"
          src={file.url}
          alt=""
          loading="lazy"
          decoding="async"
          onLoad={() => onLoad('ready')}
          onError={() => onLoad('error')}
          sx={FILL_SX}
        />
      );
    case 'video':
      return <VideoFrame url={file.url} onLoad={onLoad} />;
    case 'audio':
      return <AudioPreview file={file} onLoad={onLoad} />;
    default:
      return <TypeTile file={file} />;
  }
}

/** Without metadata after this long, a video tile gives up and shows the type icon. */
export const VIDEO_TIMEOUT_MS = 8000;

/**
 * A frame of the video with a play badge. Loads only near the viewport; the skeleton clears once the
 * metadata arrives (the frame paints when its data follows), and the type icon replaces it after
 * `VIDEO_TIMEOUT_MS` with no metadata.
 */
function VideoFrame({ url, onLoad }: { url: string; onLoad: (load: Load) => void }) {
  const [boxRef, near] = useNearViewport<HTMLSpanElement>();
  const [hasMetadata, setHasMetadata] = useState(false);

  useEffect(() => {
    if (!near || hasMetadata) return;
    const timer = window.setTimeout(() => onLoad('error'), VIDEO_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [near, hasMetadata, onLoad]);

  return (
    <Box component="span" ref={boxRef} sx={{ position: 'absolute', inset: 0, display: 'block' }}>
      {near && (
        <Box
          component="video"
          // The frame at 0.1 s stands in for a poster; nothing plays here.
          src={`${url}#t=0.1`}
          preload="metadata"
          muted
          playsInline
          tabIndex={-1}
          onLoadedMetadata={() => {
            setHasMetadata(true);
            onLoad('ready');
          }}
          onError={() => onLoad('error')}
          sx={FILL_SX}
        />
      )}
      <Box
        component="span"
        sx={(theme) => ({
          position: 'absolute',
          left: '50%',
          top: '50%',
          width: 44,
          height: 44,
          m: '-22px 0 0 -22px',
          borderRadius: '50%',
          display: 'grid',
          placeItems: 'center',
          color: theme.palette.common.white,
          bgcolor: alpha(theme.palette.common.black, 0.55),
          boxShadow: `0 2px 8px ${alpha(theme.palette.common.black, 0.25)}`,
        })}
      >
        <PlayArrowRounded sx={{ fontSize: 28 }} />
      </Box>
    </Box>
  );
}

/** Kinds whose preview paints something that takes a moment to arrive (shown over a skeleton). */
function hasRenderedPreview(file: FileRef): boolean {
  return previewPdf(file) !== null || file.kind === 'image' || file.kind === 'video';
}

type TileState = { key: string; load: Load; pdf?: PdfPreview };

/** A tile's starting state: ready at once when its PDF page was rendered before. */
function initialState(file: FileRef, key: string): TileState {
  const pdf = previewPdf(file) ? cachedPreview(key) : undefined;
  return pdf ? { key, load: 'ready', pdf } : { key, load: 'loading' };
}

const tileSx = (theme: Theme) => ({
  width: '100%',
  height: '100%',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'stretch',
  // ButtonBase centres its content; a tile with a one-line name would drop its preview below its neighbours'.
  justifyContent: 'flex-start',
  textAlign: 'left',
  overflow: 'hidden',
  borderRadius: `${theme.yungu.shape.medium}px`,
  border: `1px solid ${theme.yungu.color.outlineVariant}`,
  bgcolor: theme.yungu.color.surfaceContainerLowest,
  transition: theme.transitions.create(['border-color', 'box-shadow'], { duration: theme.transitions.duration.shorter }),
  '& .thumb-media': {
    transition: [
      theme.transitions.create('transform', { duration: theme.transitions.duration.standard, easing: 'cubic-bezier(0.2, 0, 0, 1)' }),
      `opacity ${FADE_MS}ms ${EASE_OUT}`,
    ].join(', '),
  },
  '@media (hover: hover)': {
    '&:hover': {
      borderColor: theme.yungu.color.outline,
      boxShadow: `0 1px 2px ${alpha(theme.palette.common.black, 0.06)}, 0 4px 12px ${alpha(theme.palette.common.black, 0.06)}`,
      '& .thumb-media': { transform: 'scale(1.03)' },
    },
  },
  '&.Mui-focusVisible': { outline: `2px solid ${theme.palette.primary.main}`, outlineOffset: '2px' },
  '@media (prefers-reduced-motion: reduce)': {
    transition: 'none',
    // The preview still fades in (no movement), just without the hover zoom.
    '& .thumb-media': { transition: `opacity ${FADE_MS}ms ${EASE_OUT}` },
    '&:hover .thumb-media': { transform: 'none' },
  },
});

/**
 * One file as a tile: a rendered preview (a PDF's first page, the image, a frame of the video, an
 * audio icon with its length, or the type icon) over its name and "PDF · 3 pages · 75 MB". A skeleton
 * holds the space while the preview loads (a PDF page rendered before shows at once); the type icon takes
 * over if it fails. The whole tile opens the file.
 */
export default function FileThumb({ file, onOpen }: { file: FileRef; onOpen: () => void }) {
  // The size as well as the id: a cheap guard against a file replaced under the same id and URL.
  const key = `${file.id}:${file.size}:${previewPdf(file) ?? file.url}`;
  const [state, setState] = useState(() => initialState(file, key));
  // A different file (or PDF) in this tile: start over from its cached preview, if any.
  if (state.key !== key) setState(initialState(file, key));
  const { load, pdf: pdfPreview } = state;
  // Keeps the rendered PDF page (its image reports when it has decoded); ignores a tile's former file.
  const onLoad = useCallback((next: Load) => setState((s) => (s.key === key ? { ...s, load: next } : s)), [key]);
  // The page count shows at once; the image fades in once decoded (`onLoad`).
  const onPdfPreview = useCallback((pdf: PdfPreview) => setState((s) => (s.key === key ? { ...s, pdf } : s)), [key]);
  const reduceMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  const caption = fileCaption(file, pdfPreview?.pages);

  return (
    <ButtonBase onClick={onOpen} data-file-id={file.id} aria-label={`${file.name}, ${caption}`} sx={tileSx}>
      <Box
        component="span"
        // Decorative: the tile is named by the file name and caption alone.
        aria-hidden
        sx={{
          position: 'relative',
          display: 'block',
          aspectRatio: '4 / 3',
          overflow: 'hidden',
          bgcolor: (theme) => alpha(theme.palette.text.primary, 0.05),
          borderBottom: 1,
          borderColor: (theme) => theme.yungu.color.outlineVariant,
        }}
      >
        {/* Transparent until the preview has painted, then faded in over the placeholder. */}
        <Box
          component="span"
          className="thumb-media"
          sx={{ position: 'absolute', inset: 0, display: 'block', opacity: load === 'loading' && hasRenderedPreview(file) ? 0 : 1 }}
        >
          <Preview file={file} cacheKey={key} load={load} pdfPreview={pdfPreview} onPdfPreview={onPdfPreview} onLoad={onLoad} />
        </Box>
        {load === 'loading' && hasRenderedPreview(file) && (
          <Skeleton variant="rectangular" animation={reduceMotion ? false : 'wave'} data-testid="thumb-skeleton" sx={{ position: 'absolute', inset: 0, height: '100%', transform: 'none' }} />
        )}
      </Box>
      <Box component="span" sx={{ display: 'block', px: 1.5, pt: 1.25, pb: 1.5 }}>
        <Typography
          component="span"
          variant="body2"
          title={file.name}
          sx={{
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
            overflowWrap: 'anywhere',
            fontWeight: 500,
            lineHeight: 1.4,
          }}
        >
          {file.name}
        </Typography>
        {/* One line: the page count arriving later must not push the tile (and its row) taller. */}
        <Typography component="span" variant="caption" color="text.secondary" noWrap title={caption} sx={{ display: 'block', mt: 0.25 }}>
          {caption}
        </Typography>
      </Box>
    </ButtonBase>
  );
}
