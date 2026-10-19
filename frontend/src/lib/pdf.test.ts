// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const page = { setContent: vi.fn(), pdf: vi.fn(async () => Buffer.from([37, 80, 68, 70])) };
const browser = { newPage: vi.fn(async () => page), close: vi.fn(async () => {}) };
const launch = vi.fn(async () => browser);
vi.mock('playwright-core', () => ({ chromium: { launch: (...a: unknown[]) => launch(...(a as [])) } }));

import { buildDocument, renderPdf } from './pdf';

beforeEach(() => {
  vi.clearAllMocks();
  page.pdf.mockImplementation(async () => Buffer.from([37, 80, 68, 70]));
  launch.mockImplementation(async () => browser);
  browser.close.mockImplementation(async () => {});
});

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
  it('gives loading a 20 s timeout', async () => {
    await renderPdf('T', '<p>x</p>');
    expect(page.setContent).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ timeout: 20_000 }));
  });
  it('gives up on a print that takes over 20 s, closes the browser and frees the queue', async () => {
    vi.useFakeTimers();
    try {
      page.pdf.mockImplementationOnce(() => new Promise(() => {}));
      const stuck = renderPdf('T', '<p>x</p>');
      const settled = expect(stuck).rejects.toThrow('Printing the PDF timed out');
      await vi.advanceTimersByTimeAsync(19_999);
      expect(browser.close).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      await settled;
      expect(browser.close).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
    await expect(renderPdf('B', '<p>b</p>')).resolves.toBeInstanceOf(Uint8Array);
  });
  it('runs one render at a time: the next Chromium launches only after the last one closed', async () => {
    const events: string[] = [];
    let finishFirst!: () => void;
    let calls = 0;
    page.pdf.mockImplementation(async () => {
      const n = ++calls;
      events.push(`print ${n}`);
      if (n === 1) await new Promise<void>((r) => (finishFirst = r));
      return Buffer.from([37]);
    });
    launch.mockImplementation(async () => {
      events.push('launch');
      return browser;
    });
    browser.close.mockImplementation(async () => {
      events.push('close');
    });
    const first = renderPdf('A', '<p>a</p>');
    const second = renderPdf('B', '<p>b</p>');
    await vi.waitFor(() => expect(events).toContain('print 1'));
    await new Promise((r) => setTimeout(r, 10));
    expect(launch).toHaveBeenCalledTimes(1);
    finishFirst();
    await Promise.all([first, second]);
    expect(events).toEqual(['launch', 'print 1', 'close', 'launch', 'print 2', 'close']);
  });
  it('a failed render does not hold up the next one', async () => {
    launch.mockRejectedValueOnce(new Error('no chromium'));
    await expect(renderPdf('A', '<p>a</p>')).rejects.toThrow('no chromium');
    await expect(renderPdf('B', '<p>b</p>')).resolves.toBeInstanceOf(Uint8Array);
  });
  it('closes the browser when rendering fails', async () => {
    page.pdf.mockRejectedValueOnce(new Error('x'));
    await expect(renderPdf('T', '<p>x</p>')).rejects.toThrow('x');
    expect(browser.close).toHaveBeenCalledOnce();
  });
});
