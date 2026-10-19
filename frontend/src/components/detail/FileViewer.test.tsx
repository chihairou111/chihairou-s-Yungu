import { useState } from 'react';
import { render, screen, within } from '../test-render';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
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
    expect(viewer().querySelector('iframe')).toHaveAttribute('src', '/api/files/a');
    expect(within(viewer()).getByRole('link', { name: 'Download' })).toHaveAttribute('href', '/api/files/a?download=1');
    const open = within(viewer()).getByRole('link', { name: 'Open in new tab' });
    expect(open).toHaveAttribute('href', '/api/files/a');
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
    expect(viewer().querySelector('iframe')).toHaveAttribute('src', '/api/files/d-pdf');
    expect(within(viewer()).getByRole('link', { name: 'Download' })).toHaveAttribute('href', '/api/files/d?download=1');
  });

  it('plays audio with controls, and offers a download for files it cannot show', async () => {
    render(<Harness start={4} />);
    expect(viewer().querySelector('audio')).toHaveAttribute('controls');
    await userEvent.keyboard('{ArrowRight}');
    expect(within(viewer()).getByText('No preview for this file type.')).toBeInTheDocument();
  });

  it('closes with Escape and the close button', async () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    await userEvent.keyboard('{Escape}');
    await userEvent.click(within(viewer()).getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
