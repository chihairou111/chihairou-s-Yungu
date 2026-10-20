import { act, fireEvent, render, screen } from '../test-render';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FileRef } from '@/lib/types';
import FileThumb, { VIDEO_TIMEOUT_MS } from './FileThumb';
import { cachedPreview, loadPreview, type PdfPreview } from './pdfThumb';

vi.mock('./pdfThumb', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./pdfThumb')>()),
  loadPreview: vi.fn(),
  cachedPreview: vi.fn(),
}));

const file = (kind: FileRef['kind'], name: string): FileRef => ({
  id: 'x',
  name,
  kind,
  mime: 'application/octet-stream',
  size: 2048,
  url: '/api/files/x',
  createdAt: 0,
});

const PDF = file('pdf', 'Slides.pdf');
const skeleton = () => screen.queryByTestId('thumb-skeleton');
const abortError = () => new DOMException('cancelled', 'AbortError');

const PREVIEW: PdfPreview = { src: 'data:image/png;base64,page1', pages: 3 };

/** A promise with its settle functions exposed. */
function deferred() {
  let resolve!: (value?: PdfPreview) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<PdfPreview>((res, rej) => {
    resolve = (value = PREVIEW) => res(value);
    reject = rej;
  });
  return { promise, resolve, reject };
}

// A function returned from beforeEach would run as its teardown, so return nothing.
beforeEach(() => {
  vi.mocked(loadPreview).mockReset();
  vi.mocked(cachedPreview).mockReset();
});
afterEach(() => vi.useRealTimers());

describe('FileThumb', () => {
  it('is named by the file name and caption only', () => {
    vi.mocked(loadPreview).mockReturnValue(new Promise(() => {}));
    render(<FileThumb file={file('video', 'Clip.mp4')} onOpen={() => {}} />);
    expect(screen.getByRole('button')).toHaveAccessibleName('Clip.mp4, Video · 2 KB');
  });

  it('shows an online document as a document, captioned "Online document", without fetching anything', () => {
    const doc: FileRef = { ...file('other', '课堂反思'), size: 0, online: true, content: '{"ops":[{"insert":"x\\n"}]}' };
    const { container } = render(<FileThumb file={doc} onOpen={() => {}} />);
    expect(screen.getByRole('button')).toHaveAccessibleName('课堂反思, Online document');
    expect(container.querySelector('[data-testid="ArticleOutlinedIcon"]')).not.toBeNull();
    expect(container.querySelector('img, video, audio, iframe')).toBeNull();
    expect(loadPreview).not.toHaveBeenCalled();
  });

  it('shows a skeleton while the first page renders, then the page as an image', async () => {
    const page = deferred();
    vi.mocked(loadPreview).mockReturnValue(page.promise);
    const { container } = render(<FileThumb file={PDF} onOpen={() => {}} />);
    expect(skeleton()).toBeInTheDocument();
    const [key, url, width, options] = vi.mocked(loadPreview).mock.calls[0];
    // The size too: a file replaced under the same id and URL gets a fresh preview.
    expect(key).toBe('x:2048:/api/files/x');
    expect(url).toBe('/api/files/x');
    expect(width).toBeGreaterThan(0);
    expect(options!.signal).toBeInstanceOf(AbortSignal);
    await act(async () => page.resolve());
    const img = container.querySelector('img')!;
    expect(img).toHaveAttribute('src', PREVIEW.src);
    // Still behind the skeleton until the image has decoded, so the fade never plays over an empty box.
    expect(skeleton()).toBeInTheDocument();
    await act(async () => fireEvent.load(img));
    expect(skeleton()).not.toBeInTheDocument();
    expect(screen.queryByText('.PDF')).not.toBeInTheDocument();
  });

  it('adds the page count to the caption once the PDF has been read', async () => {
    const page = deferred();
    vi.mocked(loadPreview).mockReturnValue(page.promise);
    render(<FileThumb file={PDF} onOpen={() => {}} />);
    expect(screen.getByText('PDF · 2 KB')).toBeInTheDocument();
    await act(async () => page.resolve());
    expect(screen.getByText('PDF · 3 pages · 2 KB')).toBeInTheDocument();
    expect(screen.getByRole('button')).toHaveAccessibleName('Slides.pdf, PDF · 3 pages · 2 KB');
  });

  it('says "1 page", and an Office file keeps its own type beside its rendition\'s page count', async () => {
    vi.mocked(loadPreview).mockResolvedValue({ ...PREVIEW, pages: 1 });
    const doc = { ...file('office', 'Template.docx'), previewPdfUrl: '/api/files/x/preview.pdf' };
    render(<FileThumb file={doc} onOpen={() => {}} />);
    expect(await screen.findByText('Word · 1 page · 2 KB')).toBeInTheDocument();
    expect(vi.mocked(loadPreview).mock.calls[0][1]).toBe('/api/files/x/preview.pdf');
  });

  it('shows a cached page at once on remount, without rendering it again', () => {
    vi.mocked(cachedPreview).mockReturnValue(PREVIEW);
    const { container } = render(<FileThumb file={PDF} onOpen={() => {}} />);
    expect(skeleton()).not.toBeInTheDocument();
    expect(container.querySelector('.thumb-media')).toHaveStyle({ opacity: '1' });
    expect(container.querySelector('img')).toHaveAttribute('src', PREVIEW.src);
    expect(screen.getByText('PDF · 3 pages · 2 KB')).toBeInTheDocument();
    expect(loadPreview).not.toHaveBeenCalled();
    expect(cachedPreview).toHaveBeenCalledWith('x:2048:/api/files/x');
  });

  it('fades the preview in once it has painted, instead of popping it over the skeleton', async () => {
    const page = deferred();
    vi.mocked(loadPreview).mockReturnValue(page.promise);
    const { container } = render(<FileThumb file={PDF} onOpen={() => {}} />);
    const media = container.querySelector('.thumb-media')!;
    expect(media).toHaveStyle({ opacity: '0' });
    await act(async () => page.resolve());
    expect(media).toHaveStyle({ opacity: '0' });
    await act(async () => fireEvent.load(container.querySelector('img')!));
    expect(media).toHaveStyle({ opacity: '1' });
  });

  it('waits for the image to decode before showing it', async () => {
    let decoded!: () => void;
    const decode = vi.fn(() => new Promise<void>((r) => (decoded = r)));
    Object.defineProperty(HTMLImageElement.prototype, 'decode', { value: decode, configurable: true });
    try {
      vi.mocked(loadPreview).mockResolvedValue(PREVIEW);
      const { container } = render(<FileThumb file={PDF} onOpen={() => {}} />);
      const img = await vi.waitFor(() => {
        const found = container.querySelector('img');
        if (!found) throw new Error('no image yet');
        return found;
      });
      await act(async () => fireEvent.load(img));
      expect(decode).toHaveBeenCalled();
      expect(skeleton()).toBeInTheDocument();
      await act(async () => decoded());
      expect(skeleton()).not.toBeInTheDocument();
    } finally {
      delete (HTMLImageElement.prototype as { decode?: unknown }).decode;
    }
  });

  it("drops the page count when the tile moves from a cached PDF to one not yet rendered", () => {
    vi.mocked(cachedPreview).mockImplementation((key) => (key === 'x:2048:/api/files/x' ? PREVIEW : undefined));
    vi.mocked(loadPreview).mockReturnValue(new Promise(() => {}));
    const { rerender } = render(<FileThumb file={PDF} onOpen={() => {}} />);
    expect(screen.getByText('PDF · 3 pages · 2 KB')).toBeInTheDocument();
    rerender(<FileThumb file={{ ...PDF, id: 'y', url: '/api/files/y' }} onOpen={() => {}} />);
    expect(screen.getByText('PDF · 2 KB')).toBeInTheDocument();
    expect(screen.queryByText(/pages/)).not.toBeInTheDocument();
    expect(skeleton()).toBeInTheDocument();
  });

  it('keeps the caption on one line, so the page count arriving never shifts the grid', () => {
    vi.mocked(loadPreview).mockReturnValue(new Promise(() => {}));
    render(<FileThumb file={PDF} onOpen={() => {}} />);
    const caption = screen.getByText('PDF · 2 KB');
    expect(caption).toHaveStyle({ whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' });
  });

  it('keeps the preview at the top of the tile whatever the length of the name', () => {
    vi.mocked(loadPreview).mockReturnValue(new Promise(() => {}));
    render(<FileThumb file={PDF} onOpen={() => {}} />);
    expect(screen.getByRole('button')).toHaveStyle({ justifyContent: 'flex-start' });
  });

  it('falls back to the type icon when the PDF cannot be rendered', async () => {
    vi.mocked(loadPreview).mockRejectedValue(new Error('Invalid PDF structure'));
    render(<FileThumb file={PDF} onOpen={() => {}} />);
    expect(await screen.findByText('.PDF')).toBeInTheDocument();
    expect(skeleton()).not.toBeInTheDocument();
  });

  it('cancels a superseded render, and a cancelled render is not a failure', async () => {
    // A new file (or StrictMode's remount) restarts the effect: the first render is aborted and only
    // the second one decides what the tile shows.
    const first = deferred();
    const second = deferred();
    vi.mocked(loadPreview).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const { rerender, unmount } = render(<FileThumb file={PDF} onOpen={() => {}} />);
    rerender(<FileThumb file={{ ...PDF, url: '/api/files/y' }} onOpen={() => {}} />);
    const calls = vi.mocked(loadPreview).mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls[0][3]!.signal!.aborted).toBe(true);
    expect(calls[1][3]!.signal!.aborted).toBe(false);
    await act(async () => first.reject(abortError()));
    expect(screen.queryByText('.PDF')).not.toBeInTheDocument();
    expect(skeleton()).toBeInTheDocument();
    await act(async () => second.resolve());
    await act(async () => fireEvent.load(document.querySelector('img')!));
    expect(skeleton()).not.toBeInTheDocument();
    expect(screen.queryByText('.PDF')).not.toBeInTheDocument();

    unmount();
    expect(calls[1][3]!.signal!.aborted).toBe(true);
  });

  it('clears a video skeleton on metadata, and gives up after a timeout without it', () => {
    vi.useFakeTimers();
    const { unmount } = render(<FileThumb file={file('video', 'Clip.mp4')} onOpen={() => {}} />);
    expect(skeleton()).toBeInTheDocument();
    fireEvent.loadedMetadata(document.querySelector('video')!);
    expect(skeleton()).not.toBeInTheDocument();
    act(() => vi.advanceTimersByTime(VIDEO_TIMEOUT_MS + 1));
    expect(screen.queryByText('.MP4')).not.toBeInTheDocument();
    unmount();

    render(<FileThumb file={file('video', 'Stuck.mp4')} onOpen={() => {}} />);
    act(() => vi.advanceTimersByTime(VIDEO_TIMEOUT_MS + 1));
    expect(screen.getByText('.MP4')).toBeInTheDocument();
    expect(skeleton()).not.toBeInTheDocument();
  });

  it('keeps the skeleton still under reduced motion', () => {
    vi.mocked(loadPreview).mockReturnValue(new Promise(() => {}));
    vi.stubGlobal(
      'matchMedia',
      (query: string) =>
        ({
          matches: query.includes('prefers-reduced-motion'),
          media: query,
          addEventListener() {},
          removeEventListener() {},
          addListener() {},
          removeListener() {},
          onchange: null,
          dispatchEvent: () => false,
        }) as MediaQueryList,
    );
    render(<FileThumb file={PDF} onOpen={() => {}} />);
    expect(skeleton()!.className).not.toMatch(/MuiSkeleton-wave/);
    vi.unstubAllGlobals();
  });
});
