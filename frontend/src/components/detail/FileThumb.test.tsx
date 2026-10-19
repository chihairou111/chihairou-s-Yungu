import { act, fireEvent, render, screen } from '../test-render';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FileRef } from '@/lib/types';
import FileThumb, { VIDEO_TIMEOUT_MS } from './FileThumb';
import { renderFirstPage } from './pdfThumb';

vi.mock('./pdfThumb', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./pdfThumb')>()),
  renderFirstPage: vi.fn(),
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

/** A promise with its settle functions exposed. */
function deferred() {
  let resolve!: () => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

// A function returned from beforeEach would run as its teardown, so return nothing.
beforeEach(() => {
  vi.mocked(renderFirstPage).mockReset();
});
afterEach(() => vi.useRealTimers());

describe('FileThumb', () => {
  it('is named by the file name and caption only', () => {
    vi.mocked(renderFirstPage).mockReturnValue(new Promise(() => {}));
    render(<FileThumb file={file('video', 'Clip.mp4')} onOpen={() => {}} />);
    expect(screen.getByRole('button')).toHaveAccessibleName('Clip.mp4, Video · 2 KB');
  });

  it('shows a skeleton while the first page renders, then the page', async () => {
    const page = deferred();
    vi.mocked(renderFirstPage).mockReturnValue(page.promise);
    render(<FileThumb file={PDF} onOpen={() => {}} />);
    expect(skeleton()).toBeInTheDocument();
    const [url, canvas, , signal] = vi.mocked(renderFirstPage).mock.calls[0];
    expect(url).toBe('/api/files/x');
    expect(canvas).toBeInstanceOf(HTMLCanvasElement);
    expect(signal).toBeInstanceOf(AbortSignal);
    await act(async () => page.resolve());
    expect(skeleton()).not.toBeInTheDocument();
    expect(screen.queryByText('.PDF')).not.toBeInTheDocument();
  });

  it('falls back to the type icon when the PDF cannot be rendered', async () => {
    vi.mocked(renderFirstPage).mockRejectedValue(new Error('Invalid PDF structure'));
    render(<FileThumb file={PDF} onOpen={() => {}} />);
    expect(await screen.findByText('.PDF')).toBeInTheDocument();
    expect(skeleton()).not.toBeInTheDocument();
  });

  it('cancels a superseded render, and a cancelled render is not a failure', async () => {
    // A new file (or StrictMode's remount) restarts the effect: the first render is aborted and only
    // the second one decides what the tile shows.
    const first = deferred();
    const second = deferred();
    vi.mocked(renderFirstPage).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const { rerender, unmount } = render(<FileThumb file={PDF} onOpen={() => {}} />);
    rerender(<FileThumb file={{ ...PDF, url: '/api/files/y' }} onOpen={() => {}} />);
    const calls = vi.mocked(renderFirstPage).mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls[0][3]!.aborted).toBe(true);
    expect(calls[1][3]!.aborted).toBe(false);
    await act(async () => first.reject(abortError()));
    expect(screen.queryByText('.PDF')).not.toBeInTheDocument();
    expect(skeleton()).toBeInTheDocument();
    await act(async () => second.resolve());
    expect(skeleton()).not.toBeInTheDocument();
    expect(screen.queryByText('.PDF')).not.toBeInTheDocument();

    unmount();
    expect(calls[1][3]!.aborted).toBe(true);
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
    vi.mocked(renderFirstPage).mockReturnValue(new Promise(() => {}));
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
