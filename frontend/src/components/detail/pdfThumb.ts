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

/**
 * Draws the first page of the PDF at `url` into `canvas`, `width` CSS pixels wide (sharp on high-density
 * screens). Rejects when the file cannot be fetched or parsed, so the caller can show a fallback. Aborting
 * `signal` stops the download or the drawing and rejects with an `AbortError` (see `isAbort`).
 */
export async function renderFirstPage(url: string, canvas: HTMLCanvasElement, width: number, signal?: AbortSignal): Promise<void> {
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
    const scale = (width / page.getViewport({ scale: 1 }).width) * Math.min(window.devicePixelRatio || 1, 2);
    const viewport = page.getViewport({ scale });
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    const rendering = page.render({ canvas, viewport });
    renderTask = rendering;
    await rendering.promise;
  } catch (error) {
    // pdf.js rejects a cancelled render or a destroyed task with its own errors; report them as the abort.
    if (signal?.aborted) throw abortError();
    throw error;
  } finally {
    signal?.removeEventListener('abort', onAbort);
    await task.destroy();
  }
}
