import { beforeEach, describe, expect, it, vi } from 'vitest';

const render = vi.fn();
const destroy = vi.fn(() => Promise.resolve());
const getDocument = vi.fn();

vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: { workerSrc: '' },
  PDFWorker: class {},
  getDocument: (...args: unknown[]) => getDocument(...args),
}));

import { PREVIEW_CACHE_SIZE, PREVIEW_MARGIN, PREVIEW_ZOOM, cachedPreview, isAbort, loadPreview, pdfViewUrl, renderFirstPage } from './pdfThumb';

/** Page 1's text: by default a title whose top-left sits 60pt from the left and 40pt from the top. */
const getTextContent = vi.fn();
const textAt = (x: number, top: number) => ({ str: 'Title', transform: [1, 0, 0, 1, x, 800 - top - 20], height: 20 });
const page = {
  // A 600×800pt page; the viewport flips y so its origin is the page's top-left.
  getViewport: ({ scale, offsetX = 0, offsetY = 0 }: { scale: number; offsetX?: number; offsetY?: number }) => ({
    width: 600 * scale,
    height: 800 * scale,
    scale,
    offsetX,
    offsetY,
    convertToViewportPoint: (x: number, y: number) => [x * scale, (800 - y) * scale],
  }),
  getTextContent,
  render,
};
const dpr = () => Math.min(window.devicePixelRatio || 1, 2);

beforeEach(() => {
  render.mockReset();
  destroy.mockClear();
  getDocument.mockReset();
  getDocument.mockImplementation(() => ({ promise: Promise.resolve({ numPages: 3, getPage: async () => page }), destroy }));
  render.mockReturnValue({ promise: Promise.resolve(), cancel: vi.fn() });
  getTextContent.mockReset();
  getTextContent.mockResolvedValue({ items: [textAt(60, 40), { str: '  ', transform: [1, 0, 0, 1, 0, 0], height: 0 }] });
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

  it('reads a file-route PDF same-origin, in ranges, fetching only what page 1 needs', async () => {
    // Yungu's store hides Accept-Ranges from cross-origin reads, so pdf.js would download a 93 MB file whole.
    await renderFirstPage('/api/files/9', document.createElement('canvas'), 240);
    expect(getDocument).toHaveBeenCalledWith(
      expect.objectContaining({ url: '/api/files/9?view=pdf', disableAutoFetch: true, disableStream: true }),
    );
    await renderFirstPage('/api/files/9?preview=1', document.createElement('canvas'), 240);
    expect(getDocument).toHaveBeenLastCalledWith(expect.objectContaining({ url: '/api/files/9?preview=1&view=pdf' }));
  });

  it('pdfViewUrl adds view=pdf to file-route links only', () => {
    expect(pdfViewUrl('/api/files/9')).toBe('/api/files/9?view=pdf');
    expect(pdfViewUrl('/api/files/9?preview=1')).toBe('/api/files/9?preview=1&view=pdf');
    expect(pdfViewUrl('/mock/sample.pdf')).toBe('/mock/sample.pdf');
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

  /** The crop's start on page 1, in points from its top-left. */
  async function cropStart() {
    render.mockClear();
    await renderFirstPage('/a.pdf', document.createElement('canvas'), 240);
    const { viewport } = render.mock.calls[0][0] as { viewport: { scale: number; offsetX: number; offsetY: number } };
    return { x: -viewport.offsetX / viewport.scale, y: -viewport.offsetY / viewport.scale };
  }

  it('starts the crop just above and left of the text, so less blank margin shows', async () => {
    const { x, y } = await cropStart();
    // 2% of the page's width and height clear of the title.
    expect(x).toBeCloseTo(60 - 600 * 0.02);
    expect(y).toBeCloseTo(40 - 800 * 0.02);
  });

  it(`never skips more than ${PREVIEW_MARGIN * 100}% of the page, and keeps the corner for a page without text`, async () => {
    getTextContent.mockResolvedValue({ items: [textAt(300, 400)] });
    expect(await cropStart()).toEqual({ x: 600 * PREVIEW_MARGIN, y: 800 * PREVIEW_MARGIN });
    getTextContent.mockResolvedValue({ items: [] });
    expect(await cropStart()).toEqual({ x: 0, y: 0 });
    getTextContent.mockRejectedValue(new Error('no text layer'));
    expect(await cropStart()).toEqual({ x: 0, y: 0 });
    // Text at the very edge: no negative crop.
    getTextContent.mockResolvedValue({ items: [textAt(4, 2)] });
    expect(await cropStart()).toEqual({ x: 0, y: 0 });
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
  let toDataURL: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    toDataURL = vi
      .spyOn(HTMLCanvasElement.prototype, 'toDataURL')
      .mockImplementation((type?: string) => `data:${type ?? 'image/png'};base64,${(n += 1)}`);
  });

  it('keeps the rendered page as a WebP image per file, so a remount shows it without drawing again', async () => {
    const first = await loadPreview('f1:/a.pdf', '/a.pdf', 240);
    expect(first).toEqual({ src: expect.stringMatching(/^data:image\/webp/), pages: 3 });
    expect(cachedPreview('f1:/a.pdf')).toEqual(first);
    await expect(loadPreview('f1:/a.pdf', '/a.pdf', 240)).resolves.toEqual(first);
    expect(getDocument).toHaveBeenCalledTimes(1);
    // Another file with the same PDF (an Office file's rendition) has its own entry.
    expect(cachedPreview('f2:/a.pdf')).toBeUndefined();
  });

  it('falls back to JPEG where the browser cannot encode WebP (it returns PNG instead)', async () => {
    toDataURL.mockImplementation((type?: string) => (type === 'image/jpeg' ? 'data:image/jpeg;base64,j' : 'data:image/png;base64,p'));
    await expect(loadPreview('jpeg:/a.pdf', '/a.pdf', 240)).resolves.toEqual({ src: 'data:image/jpeg;base64,j', pages: 3 });
  });

  it('renders a file once while several tiles ask for it at the same time', async () => {
    const [a, b] = await Promise.all([loadPreview('same:/a.pdf', '/a.pdf', 240), loadPreview('same:/a.pdf', '/a.pdf', 240)]);
    expect(a).toBe(b);
    expect(getDocument).toHaveBeenCalledTimes(1);
  });

  it('keeps a shared render going while another tile still waits for it', async () => {
    let finish!: () => void;
    const cancel = vi.fn();
    render.mockReturnValue({ promise: new Promise<void>((r) => (finish = r)), cancel });
    const leaving = new AbortController();
    const first = loadPreview('shared:/a.pdf', '/a.pdf', 240, { signal: leaving.signal });
    const second = loadPreview('shared:/a.pdf', '/a.pdf', 240);
    await vi.waitFor(() => expect(render).toHaveBeenCalled());
    leaving.abort();
    expect(isAbort(await first.catch((e: unknown) => e))).toBe(true);
    await Promise.resolve();
    expect(cancel).not.toHaveBeenCalled();
    finish();
    await expect(second).resolves.toEqual({ src: expect.stringMatching(/^data:image\/webp/), pages: 3 });
    expect(getDocument).toHaveBeenCalledTimes(1);
  });

  it('cancels the render once every tile waiting for it has gone', async () => {
    const cancel = vi.fn();
    render.mockReturnValue({ promise: new Promise(() => {}), cancel });
    const controller = new AbortController();
    const result = loadPreview('alone:/a.pdf', '/a.pdf', 240, { signal: controller.signal });
    await vi.waitFor(() => expect(render).toHaveBeenCalled());
    controller.abort();
    expect(isAbort(await result.catch((e: unknown) => e))).toBe(true);
    await vi.waitFor(() => expect(cancel).toHaveBeenCalled());
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
