import { useState } from 'react';
import { render, screen, waitFor, within, fireEvent } from '../test-render';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FileRef } from '@/lib/types';
import FileViewer from './FileViewer';

const file = (id: string, name: string, kind: FileRef['kind'], extra: Partial<FileRef> = {}): FileRef => ({
  id,
  name,
  kind,
  mime: 'application/octet-stream',
  size: 2048,
  url: `/api/files/${id}`,
  createdAt: 0,
  ...extra,
});

const FILES: FileRef[] = [
  file('a', 'Slides.pdf', 'pdf'),
  file('b', 'Clip.mp4', 'video'),
  file('c', 'Plan.png', 'image'),
  file('d', 'Sheet.docx', 'office', { previewPdfUrl: '/api/files/d-pdf' }),
  file('e', 'Voice.webm', 'audio'),
  file('f', 'Data.zip', 'other'),
];

function Harness({ start = 0, onClose = () => {} }: { start?: number; onClose?: () => void }) {
  const [index, setIndex] = useState(start);
  return <FileViewer files={FILES} index={index} onIndexChange={setIndex} onClose={onClose} />;
}

const viewer = () => screen.getByRole('dialog');
const title = () => within(viewer()).getByRole('heading', { level: 2 });

describe('FileViewer', () => {
  it('shows a PDF in the browser viewer, with Download and Open in new tab', () => {
    render(<Harness />);
    expect(title()).toHaveTextContent('Slides.pdf');
    // ?view=pdf: the file route hands the bytes back as an inline PDF (Yungu's store mislabels every file).
    expect(viewer().querySelector('iframe')).toHaveAttribute('src', '/api/files/a?view=pdf');
    expect(within(viewer()).getByRole('link', { name: 'Download' })).toHaveAttribute('href', '/api/files/a?download=1');
    const open = within(viewer()).getByRole('link', { name: 'Open in new tab' });
    expect(open).toHaveAttribute('href', '/api/files/a?view=pdf');
    expect(open).toHaveAttribute('target', '_blank');
  });

  it('switches files from the list', async () => {
    render(<Harness />);
    const list = within(viewer()).getByRole('list', { name: 'Files' });
    await userEvent.click(within(list).getByRole('button', { name: /Plan\.png/ }));
    expect(title()).toHaveTextContent('Plan.png');
    expect(within(list).getByRole('button', { name: /Plan\.png/ })).toHaveAttribute('aria-current', 'true');
    expect(within(viewer()).getByRole('img', { name: 'Plan.png' })).toHaveAttribute('src', '/api/files/c');
    expect(within(viewer()).getByText('File 3 of 6')).toBeInTheDocument();
  });

  it('steps through files with the arrow keys and buttons', async () => {
    render(<Harness start={1} />);
    expect(viewer().querySelector('video')).toHaveAttribute('src', '/api/files/b');
    await userEvent.keyboard('{ArrowRight}');
    expect(title()).toHaveTextContent('Plan.png');
    await userEvent.keyboard('{ArrowLeft}{ArrowLeft}');
    expect(title()).toHaveTextContent('Slides.pdf');
    expect(within(viewer()).getByRole('button', { name: 'Previous file' })).toBeDisabled();
    await userEvent.click(within(viewer()).getByRole('button', { name: 'Next file' }));
    expect(title()).toHaveTextContent('Clip.mp4');
  });

  it("shows an Office file's PDF rendition, and downloads the original", () => {
    render(<Harness start={3} />);
    expect(viewer().querySelector('iframe')).toHaveAttribute('src', '/api/files/d-pdf?view=pdf');
    expect(within(viewer()).getByRole('link', { name: 'Download' })).toHaveAttribute('href', '/api/files/d?download=1');
    expect(within(viewer()).getByRole('link', { name: 'Open in new tab' })).toHaveAttribute('href', '/api/files/d-pdf?view=pdf');
  });


  it('plays audio with controls, and offers a download for files it cannot show', async () => {
    render(<Harness start={4} />);
    expect(viewer().querySelector('audio')).toHaveAttribute('controls');
    await userEvent.keyboard('{ArrowRight}');
    expect(within(viewer()).getByText('No preview for this file type.')).toBeInTheDocument();
  });

  describe('a Yungu online document', () => {
    const DOC = JSON.stringify({
      ops: [
        { insert: '课堂反思' },
        { insert: '\n', attributes: { header: 1 } },
        { insert: 'gone', attributes: { strike: true } },
        { insert: '\n', attributes: { align: 'center' } },
        { insert: '引用' },
        { insert: '\n', attributes: { blockquote: true } },
        { insert: { video: { url: 'https://evil.example/v.mp4' } } },
        { insert: 'click', attributes: { link: 'javascript:alert(1)' } },
        { insert: '\n' },
      ],
    });
    const doc = (extra: Partial<FileRef> = {}) => file('g', 'my favorite department', 'other', { online: true, size: 0, content: DOC, ...extra });

    it('previews its text from the document itself, never fetching a file', () => {
      render(<FileViewer files={[doc()]} index={0} onIndexChange={() => {}} onClose={() => {}} />);
      expect(title()).toHaveTextContent('my favorite department');
      const page = within(viewer()).getByRole('article', { name: 'my favorite department' });
      // Its headings nest under the viewer's own (h2).
      expect(within(page).getByRole('heading', { level: 3, name: '课堂反思' })).toBeInTheDocument();
      expect(page.querySelector('s')).toHaveTextContent('gone');
      expect(page.querySelector('p[style*="text-align: center"]')).not.toBeNull();
      expect(page.querySelector('blockquote')).toHaveTextContent('引用');
      expect(within(page).getByText('[Video]')).toBeInTheDocument();
      expect(within(page).queryByRole('link')).toBeNull();
      expect(viewer().querySelector('iframe, img, video, audio')).toBeNull();
      expect(viewer().innerHTML).not.toContain('/api/files/g');
      expect(within(viewer()).queryByText('Open this online document on Yungu.')).toBeNull();
      expect(within(viewer()).queryByRole('link', { name: 'Download' })).toBeNull();
      expect(within(viewer()).getByText('Online document')).toBeInTheDocument();
    });

    it('offers Edit when the viewer allows it', async () => {
      const onEdit = vi.fn();
      const { rerender } = render(<FileViewer files={[doc()]} index={0} onIndexChange={() => {}} onClose={() => {}} />);
      expect(within(viewer()).queryByRole('button', { name: 'Edit' })).toBeNull();
      rerender(<FileViewer files={[doc()]} index={0} onIndexChange={() => {}} onClose={() => {}} onEdit={onEdit} />);
      await userEvent.click(within(viewer()).getByRole('button', { name: 'Edit' }));
      expect(onEdit).toHaveBeenCalledWith(expect.objectContaining({ id: 'g' }));
    });

    it('falls back to Yungu when its content is missing or unreadable, with nothing to edit', () => {
      for (const content of [undefined, 'not json']) {
        const { unmount } = render(
          <FileViewer files={[doc({ content })]} index={0} onIndexChange={() => {}} onClose={() => {}} onEdit={() => {}} />,
        );
        expect(within(viewer()).getByText('Open this online document on Yungu.')).toBeInTheDocument();
        expect(within(viewer()).queryByRole('button', { name: 'Edit' })).toBeNull();
        expect(within(viewer()).queryByRole('link', { name: 'Open in new tab' })).toBeNull();
        unmount();
      }
    });
  });

  it('closes with Escape and the close button', async () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    await userEvent.keyboard('{Escape}');
    await userEvent.click(within(viewer()).getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});

describe("FileViewer when Yungu's file storage is blocked", () => {
  const SENTENCE = "Can't reach Yungu's file storage from this network.";
  const blocked = () =>
    vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ error: SENTENCE }), { status: 502, headers: { 'content-type': 'application/json' } }));
  afterEach(() => vi.unstubAllGlobals());

  it('says so instead of an empty PDF frame', async () => {
    vi.stubGlobal('fetch', blocked());
    render(<Harness />);
    expect(await within(viewer()).findByText(SENTENCE)).toBeInTheDocument();
    expect(viewer().querySelector('iframe')).toBeNull();
  });

  it('says so when an image fails to load', async () => {
    vi.stubGlobal('fetch', blocked());
    render(<Harness start={2} />);
    fireEvent.error(within(viewer()).getByRole('img', { name: 'Plan.png' }));
    expect(await within(viewer()).findByText(SENTENCE)).toBeInTheDocument();
  });

  it('keeps the frame when the probe finds nothing wrong', async () => {
    const ok = vi.fn<typeof fetch>(async () => new Response('%PDF', { status: 206 }));
    vi.stubGlobal('fetch', ok);
    render(<Harness />);
    await waitFor(() => expect(ok).toHaveBeenCalled());
    expect(viewer().querySelector('iframe')).not.toBeNull();
    expect(within(viewer()).queryByText(SENTENCE)).toBeNull();
  });
});
