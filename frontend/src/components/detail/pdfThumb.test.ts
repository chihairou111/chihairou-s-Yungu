import { beforeEach, describe, expect, it, vi } from 'vitest';

const render = vi.fn();
const destroy = vi.fn(() => Promise.resolve());
const getDocument = vi.fn();

vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: { workerSrc: '' },
  PDFWorker: class {},
  getDocument: (...args: unknown[]) => getDocument(...args),
}));

import { PREVIEW_CACHE_SIZE, PREVIEW_ZOOM, cachedPreview, isAbort, loadPreview, renderFirstPage } from './pdfThumb';

const page = { getViewport: ({ scale }: { scale: number }) => ({ width: 600 * scale, height: 800 * scale, scale }), render };
const dpr = () => Math.min(window.devicePixelRatio || 1, 2);

beforeEach(() => {
  render.mockReset();
  destroy.mockClear();
  getDocument.mockReset();
  getDocument.mockImplementation(() => ({ promise: Promise.resolve({ numPages: 3, getPage: async () => page }), destroy }));
  render.mockReturnValue({ promise: Promise.resolve(), cancel: vi.fn() });
});

describe('renderFirstPage', () => {
  it('draws page 1 at the asked width and asks pdf.js for CJK CMaps and standard fonts from the app', async () => {
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
    expect(canvas.width).toBe(240 * dpr());
    expect(destroy).toHaveBeenCalled();
  });

  it('reports the page count', async () => {
    await expect(renderFirstPage('/a.pdf', document.createElement('canvas'), 240)).resolves.toEqual({ pages: 3 });
  });

  it('crops to the top of page 1, zoomed so its text is legible, in the tile\'s 4:3 shape', async () => {
    const canvas = document.createElement('canvas');
    await renderFirstPage('/a.pdf', canvas, 240);
    expect(canvas.width).toBe(240 * dpr());
    expect(canvas.height).toBe(180 * dpr());
    const { viewport } = render.mock.calls[0][0] as { viewport: { width: number; height: number } };
    // The page is drawn wider than the canvas (so only its top-left part shows), from its top edge.
    expect(viewport.width).toBeCloseTo(240 * dpr() * PREVIEW_ZOOM);
    expect(PREVIEW_ZOOM).toBe(1.6);
  });

  it('cancels the drawing and frees the document on abort, rejecting with an AbortError', async () => {
    const cancel = vi.fn();
    let fail!: (e: unknown) => void;
    render.mockReturnValue({ promise: new Promise((_, reject) => (fail = reject)), cancel });
    cancel.mockImplementation(() => fail(new Error('Rendering cancelled, page 1')));
    const controller = new AbortController();
    const result = renderFirstPage('/a.pdf', document.createElement('canvas'), 240, { signal: controller.signal });
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
    const error = await renderFirstPage('/a.pdf', document.createElement('canvas'), 240, { signal: controller.signal }).catch((e: unknown) => e);
    expect(isAbort(error)).toBe(true);
    expect(getDocument).not.toHaveBeenCalled();
  });

  it('passes real failures through', async () => {
    getDocument.mockImplementation(() => ({ promise: Promise.reject(new Error('Invalid PDF')), destroy }));
    await expect(renderFirstPage('/bad.pdf', document.createElement('canvas'), 240)).rejects.toThrow('Invalid PDF');
  });
});

describe('loadPreview', () => {
  let n = 0;
  beforeEach(() => {
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockImplementation(() => `data:image/png;base64,${(n += 1)}`);
  });

  it('keeps the rendered page as an image per file, so a remount shows it without drawing again', async () => {
    const first = await loadPreview('f1:/a.pdf', '/a.pdf', 240);
    expect(first).toEqual({ src: expect.stringMatching(/^data:image\/png/), pages: 3 });
    expect(cachedPreview('f1:/a.pdf')).toEqual(first);
    await expect(loadPreview('f1:/a.pdf', '/a.pdf', 240)).resolves.toEqual(first);
    expect(getDocument).toHaveBeenCalledTimes(1);
    // Another file with the same PDF (an Office file's rendition) has its own entry.
    expect(cachedPreview('f2:/a.pdf')).toBeUndefined();
  });

  it('caches nothing for a failed or cancelled render', async () => {
    getDocument.mockImplementation(() => ({ promise: Promise.reject(new Error('Invalid PDF')), destroy }));
    await expect(loadPreview('bad:/bad.pdf', '/bad.pdf', 240)).rejects.toThrow('Invalid PDF');
    expect(cachedPreview('bad:/bad.pdf')).toBeUndefined();
    const controller = new AbortController();
    controller.abort();
    const error = await loadPreview('gone:/a.pdf', '/a.pdf', 240, { signal: controller.signal }).catch((e: unknown) => e);
    expect(isAbort(error)).toBe(true);
    expect(cachedPreview('gone:/a.pdf')).toBeUndefined();
  });

  it(`holds at most ${PREVIEW_CACHE_SIZE} previews, dropping the least recently used`, async () => {
    for (let i = 0; i <= PREVIEW_CACHE_SIZE; i += 1) {
      await loadPreview(`lru${i}:/a.pdf`, '/a.pdf', 240);
      if (i === 1) cachedPreview('lru0:/a.pdf'); // seen again: now the most recent
    }
    expect(cachedPreview('lru0:/a.pdf')).toBeDefined();
    expect(cachedPreview('lru1:/a.pdf')).toBeUndefined();
    expect(cachedPreview(`lru${PREVIEW_CACHE_SIZE}:/a.pdf`)).toBeDefined();
  });
});
