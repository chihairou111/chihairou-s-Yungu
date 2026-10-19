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
 * Draws the first page of the PDF at `url` into `canvas`, `width` CSS pixels wide (sharp on high-density
 * screens). Rejects when the file cannot be fetched or parsed, so the caller can show a fallback.
 */
export async function renderFirstPage(url: string, canvas: HTMLCanvasElement, width: number): Promise<void> {
  const { lib, worker } = await loadPdfJs();
  const task = lib.getDocument({ url, worker });
  try {
    const doc = await task.promise;
    const page = await doc.getPage(1);
    const scale = (width / page.getViewport({ scale: 1 }).width) * Math.min(window.devicePixelRatio || 1, 2);
    const viewport = page.getViewport({ scale });
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    await page.render({ canvas, viewport }).promise;
  } finally {
    await task.destroy();
  }
}
