'use client';
import type { PDFWorker } from 'pdfjs-dist';

type PdfJs = typeof import('pdfjs-dist');

let pdfjs: Promise<{ lib: PdfJs; worker: PDFWorker }> | null = null;

/**
 * pdf.js, loaded on first use in the browser only, with one worker shared by every thumbnail (a page of
 * twenty PDFs would otherwise start twenty workers). The worker file is bundled as a static asset by
 * Turbopack/webpack from the `new URL(…, import.meta.url)` reference and served from the app's origin.
 */
function loadPdfJs() {
  pdfjs ??= import('pdfjs-dist').then((lib) => {
    lib.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();
    return { lib, worker: new lib.PDFWorker() };
  });
  pdfjs.catch(() => {
    pdfjs = null; // let a later thumbnail try again
  });
  return pdfjs;
}

/**
 * Fetched on demand by pdf.js from public/pdfjs/ (copied from the installed pdfjs-dist by
 * scripts/copy-pdfjs-assets.mjs): CMaps for CJK text in fonts that are not embedded, the standard 14
 * fonts, decoders for JPEG 2000 / JBIG2 images and ICC colour profiles.
 */
const ASSETS = {
  cMapUrl: '/pdfjs/cmaps/',
  cMapPacked: true,
  standardFontDataUrl: '/pdfjs/standard_fonts/',
  wasmUrl: '/pdfjs/wasm/',
  iccUrl: '/pdfjs/iccs/',
};

function abortError(): DOMException {
  return new DOMException('The thumbnail render was cancelled.', 'AbortError');
}

/** True for the rejection `renderFirstPage` gives when its signal aborts: neither a result nor a failure. */
export function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

/** How much wider than the tile page 1 is drawn: the tile shows its top-left part, large enough to read. */
export const PREVIEW_ZOOM = 1.6;

/** The preview tile's shape (width / height); the drawing is cut to it. */
export const PREVIEW_ASPECT = 4 / 3;

/**
 * Draws the top of the first page of the PDF at `url` into `canvas`, cut to a `width` × ¾`width` CSS-pixel
 * tile (sharp on high-density screens): the page is `PREVIEW_ZOOM` times the tile's width, anchored at its
 * top-left corner, so a title and the first lines read. Resolves with the document's page count. Rejects
 * when the file cannot be fetched or parsed, so the caller can show a fallback. Aborting `signal` stops the
 * download or the drawing and rejects with an `AbortError` (see `isAbort`).
 */
export async function renderFirstPage(
  url: string,
  canvas: HTMLCanvasElement,
  width: number,
  { signal }: { signal?: AbortSignal } = {},
): Promise<{ pages: number }> {
  if (signal?.aborted) throw abortError();
  const { lib, worker } = await loadPdfJs();
  if (signal?.aborted) throw abortError();
  const task = lib.getDocument({ url, worker, ...ASSETS });
  let renderTask: { cancel(): void } | null = null;
  const onAbort = () => {
    renderTask?.cancel();
    void task.destroy();
  };
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    const doc = await task.promise;
    const page = await doc.getPage(1);
    if (signal?.aborted) throw abortError();
    const pixels = width * Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(pixels);
    canvas.height = Math.floor(pixels / PREVIEW_ASPECT);
    // Only the part of the page inside the canvas is drawn; the viewport's origin is the page's top-left.
    const viewport = page.getViewport({ scale: (pixels * PREVIEW_ZOOM) / page.getViewport({ scale: 1 }).width });
    const rendering = page.render({ canvas, viewport });
    renderTask = rendering;
    await rendering.promise;
    return { pages: doc.numPages };
  } catch (error) {
    // pdf.js rejects a cancelled render or a destroyed task with its own errors; report them as the abort.
    if (signal?.aborted) throw abortError();
    throw error;
  } finally {
    signal?.removeEventListener('abort', onAbort);
    await task.destroy();
  }
}

/** A PDF's rendered first page as an image URL, and how many pages the PDF has. */
export interface PdfPreview {
  src: string;
  pages: number;
}

/** How many rendered previews are kept (least recently used dropped first). */
export const PREVIEW_CACHE_SIZE = 30;

/** Rendered previews by file id and PDF URL, oldest first (a Map keeps insertion order). */
const previews = new Map<string, PdfPreview>();

/** The preview already rendered under `key`, if still kept; marks it as recently used. */
export function cachedPreview(key: string): PdfPreview | undefined {
  const preview = previews.get(key);
  if (preview) {
    previews.delete(key);
    previews.set(key, preview);
  }
  return preview;
}

/**
 * The preview for `key` (a file id and its PDF's URL): from the cache, or rendered once by
 * `renderFirstPage` and kept as an image. An image, unlike a canvas, keeps its pixels when the tile
 * remounts or the browser drops the GPU context, so a tile never goes blank. Failures and aborts are not
 * cached.
 */
export async function loadPreview(key: string, url: string, width: number, options: { signal?: AbortSignal } = {}): Promise<PdfPreview> {
  const cached = cachedPreview(key);
  if (cached) return cached;
  const canvas = document.createElement('canvas');
  try {
    const { pages } = await renderFirstPage(url, canvas, width, options);
    const preview = { src: canvas.toDataURL('image/png'), pages };
    previews.set(key, preview);
    for (const oldest of previews.keys()) {
      if (previews.size <= PREVIEW_CACHE_SIZE) break;
      previews.delete(oldest);
    }
    return preview;
  } finally {
    // Free the bitmap now rather than whenever the canvas is collected.
    canvas.width = 0;
    canvas.height = 0;
  }
}
