import { act, fireEvent, render, screen, waitFor } from '../test-render';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CameraDialog from './CameraDialog';
import { MEDIA_UNAVAILABLE } from './media';
import { denied, fakeStream, installCanvas, installMedia, installObjectUrls, removeMedia } from './test-media';

const PHOTO_NAME = /^Photo \d{4}-\d{2}-\d{2} \d{2}\.\d{2}\.\d{2}( \(\d+\))?\.jpg$/;

beforeEach(() => {
  installCanvas();
  installObjectUrls();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  removeMedia();
});

function renderCamera() {
  const onClose = vi.fn();
  const onAdd = vi.fn();
  const view = render(<CameraDialog open onClose={onClose} onAdd={onAdd} />);
  return {
    ...view,
    onClose,
    onAdd,
    setOpen: (open: boolean) => view.rerender(<CameraDialog open={open} onClose={onClose} onAdd={onAdd} />),
  };
}

/** Once the stream is on the preview, it reports a frame; only then does the shutter work. */
async function previewReady() {
  const video = await waitFor(() => {
    const el = document.querySelector('video');
    if (!el?.srcObject) throw new Error('no preview yet');
    return el;
  });
  fireEvent.loadedMetadata(video);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Take photo' })).toBeEnabled());
}

describe('CameraDialog', () => {
  it('on plain HTTP shows the HTTPS message and a Close button, without asking for the camera', async () => {
    const user = userEvent.setup();
    const gum = installMedia(() => Promise.resolve(fakeStream('video').stream), false);
    const { onClose } = renderCamera();
    expect(screen.getByText(MEDIA_UNAVAILABLE)).toBeInTheDocument();
    expect(gum).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('shows the HTTPS message when there is no mediaDevices at all', () => {
    vi.stubGlobal('isSecureContext', true);
    removeMedia();
    renderCamera();
    expect(screen.getByText(MEDIA_UNAVAILABLE)).toBeInTheDocument();
  });

  it('shows the HTTPS message when permission is refused', async () => {
    installMedia(denied);
    renderCamera();
    expect(await screen.findByText(MEDIA_UNAVAILABLE)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Take photo' })).not.toBeInTheDocument();
  });

  it('asks for the rear camera where there is one', async () => {
    const gum = installMedia(() => Promise.resolve(fakeStream('video').stream));
    renderCamera();
    await previewReady();
    const constraints = gum.mock.calls[0][0];
    expect(constraints.audio).toBeFalsy();
    expect(constraints.video).toMatchObject({ facingMode: { ideal: 'environment' } });
  });

  it('takes three photos and adds them as three JPEG files', async () => {
    const user = userEvent.setup();
    installMedia(() => Promise.resolve(fakeStream('video').stream));
    const { onAdd, onClose } = renderCamera();
    await previewReady();
    expect(screen.getByRole('button', { name: 'Add photos' })).toBeDisabled();

    const shutter = screen.getByRole('button', { name: 'Take photo' });
    await user.click(shutter);
    expect(await screen.findByRole('button', { name: 'Add 1 photo' })).toBeEnabled();
    await user.click(shutter);
    await user.click(shutter);
    await user.click(await screen.findByRole('button', { name: 'Add 3 photos' }));

    expect(onAdd).toHaveBeenCalledOnce();
    const files: File[] = onAdd.mock.calls[0][0];
    expect(files).toHaveLength(3);
    for (const file of files) {
      expect(file).toBeInstanceOf(File);
      expect(file.type).toBe('image/jpeg');
      expect(file.name).toMatch(PHOTO_NAME);
    }
    expect(new Set(files.map((f) => f.name)).size).toBe(3);
    expect(onClose).toHaveBeenCalled();
  });

  it('removes a photo from the strip', async () => {
    const user = userEvent.setup();
    installMedia(() => Promise.resolve(fakeStream('video').stream));
    const { onAdd } = renderCamera();
    await previewReady();
    const shutter = screen.getByRole('button', { name: 'Take photo' });
    await user.click(shutter);
    await user.click(shutter);
    await user.click(await screen.findByRole('button', { name: 'Remove photo 1' }));
    await user.click(screen.getByRole('button', { name: 'Add 1 photo' }));
    expect(onAdd.mock.calls[0][0]).toHaveLength(1);
  });

  it('asks before throwing photos away, and Keep goes back', async () => {
    const user = userEvent.setup();
    installMedia(() => Promise.resolve(fakeStream('video').stream));
    const { onClose } = renderCamera();
    await previewReady();
    const shutter = screen.getByRole('button', { name: 'Take photo' });
    await user.click(shutter);
    await user.click(shutter);
    await screen.findByRole('button', { name: 'Add 2 photos' });

    await user.click(screen.getByRole('button', { name: 'Close camera' }));
    expect(screen.getByText('Discard 2 photos?')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Keep' }));
    expect(screen.queryByText('Discard 2 photos?')).not.toBeInTheDocument();

    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('button', { name: 'Discard' }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('closes at once with no photos, and stops the camera on close', async () => {
    const user = userEvent.setup();
    const { stream, track } = fakeStream('video');
    installMedia(() => Promise.resolve(stream));
    const { onClose, setOpen } = renderCamera();
    await previewReady();
    await user.click(screen.getByRole('button', { name: 'Close camera' }));
    expect(onClose).toHaveBeenCalledOnce();
    expect(track.stop).not.toHaveBeenCalled();
    setOpen(false);
    expect(track.stop).toHaveBeenCalled();
  });

  it('stops a camera granted after the dialog already closed', async () => {
    const { stream, track } = fakeStream('video');
    let grant!: (s: MediaStream) => void;
    installMedia(() => new Promise((resolve) => (grant = resolve)));
    const { setOpen } = renderCamera();
    await waitFor(() => expect(grant).toBeDefined());
    setOpen(false);
    await act(async () => grant(stream));
    expect(track.stop).toHaveBeenCalled();
  });

  it('stops the camera when unmounted while open', async () => {
    const { stream, track } = fakeStream('video');
    installMedia(() => Promise.resolve(stream));
    const { unmount } = renderCamera();
    await previewReady();
    unmount();
    expect(track.stop).toHaveBeenCalled();
  });
});
