import { render, screen, within } from '../test-render';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FileRef } from '@/lib/types';
import AttachmentsSection from './AttachmentsSection';
import { fileCaption, formatBytes } from './FileThumb';
import { loadPreview } from './pdfThumb';

vi.mock('./pdfThumb', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./pdfThumb')>()),
  loadPreview: vi.fn(() => Promise.resolve({ src: 'data:image/png;base64,x', pages: 1 })),
}));

const MB = 1024 * 1024;
const file = (id: string, name: string, kind: FileRef['kind'], size: number, extra: Partial<FileRef> = {}): FileRef => ({
  id,
  name,
  kind,
  mime: 'application/octet-stream',
  size,
  url: `/api/files/${id}`,
  createdAt: 0,
  ...extra,
});

const FOUR: FileRef[] = [
  file('a', '《城市发展》Lesson 02 Slides.pdf', 'pdf', 75 * MB),
  file('b', '贫民窟日常.mp4', 'video', 54 * MB),
  file('c', '观察计划表.png', 'image', 200 * 1024),
  file('d', '信息整理表.docx', 'office', 130 * 1024, { previewPdfUrl: '/api/files/d-preview' }),
];

beforeEach(() => {
  vi.mocked(loadPreview).mockClear();
});
afterEach(() => vi.restoreAllMocks());

describe('file captions', () => {
  it('formats sizes from bytes', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(900)).toBe('900 B');
    expect(formatBytes(17751)).toBe('17 KB');
    expect(formatBytes(4.25 * MB)).toBe('4.3 MB');
    expect(formatBytes(75 * MB)).toBe('75 MB');
  });

  it('names the type, then the size', () => {
    expect(fileCaption(FOUR[0])).toBe('PDF · 75 MB');
    expect(fileCaption(FOUR[1])).toBe('Video · 54 MB');
    expect(fileCaption(FOUR[2])).toBe('Image · 200 KB');
    expect(fileCaption(FOUR[3])).toBe('Word · 130 KB');
    expect(fileCaption(file('e', '表.numbers', 'office', 1024))).toBe('Numbers · 1 KB');
    expect(fileCaption(file('f', 'data.zip', 'other', 2048))).toBe('ZIP · 2 KB');
  });
});

describe('AttachmentsSection', () => {
  it('renders nothing when there are no attachments', () => {
    const { container } = render(<AttachmentsSection files={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows one previewable tile per file with its name and caption', () => {
    render(<AttachmentsSection files={FOUR} />);
    expect(screen.getByRole('heading', { name: 'Attachments (4)' })).toBeInTheDocument();
    const tiles = within(screen.getByRole('list')).getAllByRole('button');
    expect(tiles).toHaveLength(4);
    expect(tiles[0]).toHaveTextContent('《城市发展》Lesson 02 Slides.pdf');
    expect(tiles[0]).toHaveTextContent('PDF · 75 MB');
    expect(tiles[2]).toHaveTextContent('Image · 200 KB');
  });

  it('renders the first page of PDFs and of Office previews', () => {
    render(<AttachmentsSection files={FOUR} />);
    const urls = vi.mocked(loadPreview).mock.calls.map(([, url]) => url);
    expect(urls.sort()).toEqual(['/api/files/a', '/api/files/d-preview']);
  });

  it('opens the viewer on the clicked file and returns focus to it on close', async () => {
    render(<AttachmentsSection files={FOUR} />);
    const second = screen.getByRole('button', { name: /贫民窟日常\.mp4/ });
    await userEvent.click(second);
    const viewer = await screen.findByRole('dialog');
    expect(within(viewer).getByRole('heading', { name: '贫民窟日常.mp4' })).toBeInTheDocument();
    expect(within(viewer).getByText('File 2 of 4')).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(second).toHaveFocus();
  });

  it('wraps 20 attachments in a fluid grid instead of overflowing sideways', () => {
    const many = Array.from({ length: 20 }, (_, i) => file(`f${i}`, `Worksheet ${i + 1} with a rather long file name.pdf`, 'pdf', 1000));
    render(<AttachmentsSection files={many} />);
    const list = screen.getByRole('list');
    expect(within(list).getAllByRole('listitem')).toHaveLength(20);
    expect(list).toHaveStyle({ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))' });
    expect(within(list).getAllByRole('listitem')[0]).toHaveStyle({ minWidth: '0' });
  });
});
