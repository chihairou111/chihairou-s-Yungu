import { beforeEach, describe, expect, it, vi } from 'vitest';

const render = vi.fn();
const destroy = vi.fn(() => Promise.resolve());
const getDocument = vi.fn();

vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: { workerSrc: '' },
  PDFWorker: class {},
  getDocument: (...args: unknown[]) => getDocument(...args),
}));

import { isAbort, renderFirstPage } from './pdfThumb';

const page = { getViewport: ({ scale }: { scale: number }) => ({ width: 600 * scale, height: 800 * scale }), render };

beforeEach(() => {
  render.mockReset();
  destroy.mockClear();
  getDocument.mockReset();
  getDocument.mockImplementation(() => ({ promise: Promise.resolve({ getPage: async () => page }), destroy }));
});

describe('renderFirstPage', () => {
  it('draws page 1 at the asked width and asks pdf.js for CJK CMaps and standard fonts from the app', async () => {
    render.mockReturnValue({ promise: Promise.resolve(), cancel: vi.fn() });
    const canvas = document.createElement('canvas');
    await renderFirstPage('/mock/sample.pdf', canvas, 240);
    expect(getDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        url: '/mock/sample.pdf',
        cMapUrl: '/pdfjs/cmaps/',
        cMapPacked: true,
        standardFontDataUrl: '/pdfjs/standard_fonts/',
      }),
    );
    expect(canvas.width).toBe(240 * Math.min(window.devicePixelRatio || 1, 2));
    expect(destroy).toHaveBeenCalled();
  });

  it('cancels the drawing and frees the document on abort, rejecting with an AbortError', async () => {
    const cancel = vi.fn();
    let fail!: (e: unknown) => void;
    render.mockReturnValue({ promise: new Promise((_, reject) => (fail = reject)), cancel });
    cancel.mockImplementation(() => fail(new Error('Rendering cancelled, page 1')));
    const controller = new AbortController();
    const result = renderFirstPage('/a.pdf', document.createElement('canvas'), 240, controller.signal);
    await vi.waitFor(() => expect(render).toHaveBeenCalled());
    controller.abort();
    const error = await result.catch((e: unknown) => e);
    expect(isAbort(error)).toBe(true);
    expect(cancel).toHaveBeenCalled();
    expect(destroy).toHaveBeenCalled();
  });

  it('does not start when already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const error = await renderFirstPage('/a.pdf', document.createElement('canvas'), 240, controller.signal).catch((e: unknown) => e);
    expect(isAbort(error)).toBe(true);
    expect(getDocument).not.toHaveBeenCalled();
  });

  it('passes real failures through', async () => {
    getDocument.mockImplementation(() => ({ promise: Promise.reject(new Error('Invalid PDF')), destroy }));
    await expect(renderFirstPage('/bad.pdf', document.createElement('canvas'), 240)).rejects.toThrow('Invalid PDF');
  });
});
