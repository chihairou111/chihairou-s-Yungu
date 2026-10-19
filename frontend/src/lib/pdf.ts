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

/** Renders sanitised html to an A4 PDF. A fresh Chromium per call, always closed. */
export async function renderPdf(title: string, html: string): Promise<Uint8Array> {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? CHROMIUM_DEFAULT, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage();
    await page.setContent(buildDocument(title, html), { waitUntil: 'load' });
    const pdf = await page.pdf({ format: 'A4', margin: { top: '20mm', right: '20mm', bottom: '20mm', left: '20mm' }, printBackground: true });
    return new Uint8Array(pdf);
  } finally {
    await browser.close();
  }
}
