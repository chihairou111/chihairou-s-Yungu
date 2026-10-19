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

/**
 * The most the crop skips of the page (as a share of its width and of its height) to reach its text: about
 * a typical margin, so a page whose text starts lower or further in still previews its top-left part.
 */
export const PREVIEW_MARGIN = 0.08;

/** Paper left showing above and beside the text, as a share of the page's width and height. */
const TEXT_PAD = 0.02;

type PdfPage = Awaited<ReturnType<Awaited<ReturnType<PdfJs['getDocument']>['promise']>['getPage']>>;
type Viewport = ReturnType<PdfPage['getViewport']>;

/**
 * Where the crop starts, in points from the page's top-left: just above and left of its first text,
 * at most `PREVIEW_MARGIN` in. At the corner when the page has no text layer (a scan) or it cannot be read.
 */
async function cropStart(page: PdfPage, unscaled: Viewport): Promise<{ x: number; y: number }> {
  let left = Infinity;
  let top = Infinity;
  try {
    for (const item of (await page.getTextContent()).items) {
      if (!('str' in item) || !item.str.trim()) continue;
      // The glyphs' top-left: the baseline origin raised by the item's height (PDF space has y up).
      const [x, y] = unscaled.convertToViewportPoint(item.transform[4], item.transform[5] + item.height);
      left = Math.min(left, x);
      top = Math.min(top, y);
    }
  } catch {
    return { x: 0, y: 0 };
  }
  if (!Number.isFinite(left)) return { x: 0, y: 0 };
  const inset = (at: number, size: number) => Math.min(Math.max(at - size * TEXT_PAD, 0), size * PREVIEW_MARGIN);
  return { x: inset(left, unscaled.width), y: inset(top, unscaled.height) };
}

/** The preview tile's shape (width / height); the drawing is cut to it. */
export const PREVIEW_ASPECT = 4 / 3;

/**
 * A PDF link for the browser's viewer and for pdf.js: `?view=pdf` makes the file route stream the bytes
 * back same-origin as an inline PDF that answers byte ranges. Yungu's store labels every file
 * `multipart/form-data` (Chrome then downloads it instead of showing it) and hides `Accept-Ranges` from
 * cross-origin reads (pdf.js then downloads a file whole). Links outside the route stay as they are.
 */
export function pdfViewUrl(url: string): string {
  if (!url.startsWith('/api/files/')) return url;
  return `${url}${url.includes('?') ? '&' : '?'}view=pdf`;
}

/**
 * Draws the top of the first page of the PDF at `url` into `canvas`, cut to a `width` × ¾`width` CSS-pixel
 * tile (sharp on high-density screens): the page is `PREVIEW_ZOOM` times the tile's width, cut from just
 * above and left of its text (skipping at most `PREVIEW_MARGIN` of blank margin), so a title and the
 * first lines read. Resolves with the document's page count. Rejects
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
  // Ranges only, no background fetch of the rest: a thumbnail needs page 1, not the whole file.
  const task = lib.getDocument({ url: pdfViewUrl(url), worker, disableAutoFetch: true, disableStream: true, ...ASSETS });
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
    // Only the part of the page inside the canvas is drawn; the offsets move the page up and left so the
    // canvas starts at its text rather than its blank margin.
    const unscaled = page.getViewport({ scale: 1 });
    const start = await cropStart(page, unscaled);
    if (signal?.aborted) throw abortError();
    const scale = (pixels * PREVIEW_ZOOM) / unscaled.width;
    const viewport = page.getViewport({ scale, offsetX: -start.x * scale, offsetY: -start.y * scale });
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

/** WebP (several times smaller than PNG); JPEG where the browser cannot encode WebP (it hands back PNG). */
function encode(canvas: HTMLCanvasElement): string {
  const webp = canvas.toDataURL('image/webp', 0.85);
  return webp.startsWith('data:image/webp') ? webp : canvas.toDataURL('image/jpeg', 0.85);
}

/** Draws page 1 for `url` and keeps it as an image under `key`. */
async function renderPreview(key: string, url: string, width: number, signal: AbortSignal): Promise<PdfPreview> {
  const canvas = document.createElement('canvas');
  try {
    const { pages } = await renderFirstPage(url, canvas, width, { signal });
    const preview = { src: encode(canvas), pages };
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

/** A render in progress, shared by every tile that asks for the same key while it runs. */
interface Flight {
  promise: Promise<PdfPreview>;
  controller: AbortController;
  /** Callers still waiting; the render is cancelled when this drops to zero. */
  waiting: number;
}

const flights = new Map<string, Flight>();

/**
 * The preview for `key` (a file id, its size and its PDF's URL): from the cache, or rendered once by
 * `renderFirstPage` and kept as an image. An image, unlike a canvas, keeps its pixels when the tile
 * remounts or the browser drops the GPU context, so a tile never goes blank. Tiles asking for the same
 * key while it renders share that one render; aborting `signal` rejects this caller with an `AbortError`
 * and cancels the render only once no caller waits for it. Failures and aborts are not cached.
 */
export function loadPreview(key: string, url: string, width: number, { signal }: { signal?: AbortSignal } = {}): Promise<PdfPreview> {
  const cached = cachedPreview(key);
  if (cached) return Promise.resolve(cached);
  if (signal?.aborted) return Promise.reject(abortError());
  let flight = flights.get(key);
  if (!flight) {
    const controller = new AbortController();
    const started: Flight = { controller, waiting: 0, promise: renderPreview(key, url, width, controller.signal) };
    started.promise
      .finally(() => {
        if (flights.get(key) === started) flights.delete(key);
      })
      .catch(() => {}); // each caller handles the outcome
    flights.set(key, started);
    flight = started;
  }
  const joined = flight;
  joined.waiting += 1;
  return new Promise<PdfPreview>((resolve, reject) => {
    let settled = false;
    const leave = () => {
      settled = true;
      joined.waiting -= 1;
      signal?.removeEventListener('abort', onAbort);
    };
    const onAbort = () => {
      if (settled) return;
      leave();
      reject(abortError());
      // A remount (StrictMode's rehearsal, a re-render) asks again at once: let it join before cancelling.
      queueMicrotask(() => {
        if (joined.waiting > 0 || flights.get(key) !== joined) return;
        flights.delete(key);
        joined.controller.abort();
      });
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    joined.promise.then(
      (preview) => {
        if (settled) return;
        leave();
        resolve(preview);
      },
      (error: unknown) => {
        if (settled) return;
        leave();
        reject(error);
      },
    );
  });
}
