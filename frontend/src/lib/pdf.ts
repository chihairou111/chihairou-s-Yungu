import { chromium } from 'playwright-core';

const CHROMIUM_DEFAULT = '/root/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome';
const FONT_STACK = '"Noto Sans CJK SC","PingFang SC","Microsoft YaHei",sans-serif';

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The printable document around already-sanitised body html. */
export function buildDocument(title: string, bodyHtml: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>
@page { size: A4; margin: 20mm; }
body { font-family: ${FONT_STACK}; font-size: 11pt; line-height: 1.6; color: #000; margin: 0; }
h1 { font-size: 20pt; }
h2 { font-size: 15pt; }
</style></head><body>${bodyHtml}</body></html>`;
}

/** How long loading the document, and then printing it, may each take. */
const STEP_TIMEOUT_MS = 20_000;

/** The render running now (or the last one); each new render waits for it, so only one Chromium runs at a time. */
let queue: Promise<unknown> = Promise.resolve();

/** Renders sanitised html to an A4 PDF. A fresh Chromium per call, always closed; calls run one after another. */
export function renderPdf(title: string, html: string): Promise<Uint8Array> {
  const run = queue.then(() => renderNow(title, html));
  queue = run.catch(() => {});
  return run;
}

function withTimeout<T>(work: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

async function renderNow(title: string, html: string): Promise<Uint8Array> {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? CHROMIUM_DEFAULT, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage();
    await page.setContent(buildDocument(title, html), { waitUntil: 'load', timeout: STEP_TIMEOUT_MS });
    // page.pdf takes no timeout of its own; closing the browser (below) abandons a print that ran out of time.
    const pdf = await withTimeout(
      page.pdf({ format: 'A4', margin: { top: '20mm', right: '20mm', bottom: '20mm', left: '20mm' }, printBackground: true }),
      STEP_TIMEOUT_MS,
      'Printing the PDF timed out',
    );
    return new Uint8Array(pdf);
  } finally {
    await browser.close();
  }
}
