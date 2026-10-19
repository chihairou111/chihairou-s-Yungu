// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const page = { setContent: vi.fn(), pdf: vi.fn(async () => Buffer.from([37, 80, 68, 70])) };
const browser = { newPage: vi.fn(async () => page), close: vi.fn(async () => {}) };
const launch = vi.fn(async () => browser);
vi.mock('playwright-core', () => ({ chromium: { launch: (...a: unknown[]) => launch(...(a as [])) } }));

import { buildDocument, renderPdf } from './pdf';

beforeEach(() => vi.clearAllMocks());

describe('buildDocument', () => {
  it('wraps the body with charset, A4 margins and the CJK font stack', () => {
    const doc = buildDocument('T', '<p>x</p>');
    expect(doc).toContain('<meta charset="utf-8">');
    expect(doc).toContain('"Noto Sans CJK SC","PingFang SC","Microsoft YaHei",sans-serif');
    expect(doc).toContain('size: A4');
    expect(doc).toContain('20mm');
    expect(doc).toContain('<p>x</p>');
  });
  it('escapes the title', () => {
    expect(buildDocument('<b>&', '')).toContain('<title>&lt;b&gt;&amp;</title>');
  });
});

describe('renderPdf', () => {
  it('prints A4 and closes the browser', async () => {
    const out = await renderPdf('T', '<p>x</p>');
    expect(out).toBeInstanceOf(Uint8Array);
    expect(launch).toHaveBeenCalledWith(expect.objectContaining({ args: ['--no-sandbox'] }));
    expect(page.pdf).toHaveBeenCalledWith(expect.objectContaining({ format: 'A4', printBackground: true }));
    expect(browser.close).toHaveBeenCalledOnce();
  });
  it('closes the browser when rendering fails', async () => {
    page.pdf.mockRejectedValueOnce(new Error('x'));
    await expect(renderPdf('T', '<p>x</p>')).rejects.toThrow('x');
    expect(browser.close).toHaveBeenCalledOnce();
  });
});
