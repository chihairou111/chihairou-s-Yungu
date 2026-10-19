import { act, render, screen, waitFor } from '../test-render';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MEDIA_UNAVAILABLE } from './media';
import RecorderDialog from './RecorderDialog';
import { denied, FakeMediaRecorder, fakeStream, installMedia, installObjectUrls, installRecorder, removeMedia } from './test-media';

const RECORDING_NAME = /^Recording \d{4}-\d{2}-\d{2} \d{2}\.\d{2}\.\d{2}\.webm$/;

beforeEach(() => {
  installRecorder();
  installObjectUrls();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  removeMedia();
});

function renderRecorder() {
  const onClose = vi.fn();
  const onAdd = vi.fn();
  const view = render(<RecorderDialog open onClose={onClose} onAdd={onAdd} />);
  return { ...view, onClose, onAdd, close: () => view.rerender(<RecorderDialog open={false} onClose={onClose} onAdd={onAdd} />) };
}

async function ready() {
  return waitFor(() => {
    const button = screen.getByRole('button', { name: 'Record' });
    expect(button).toBeEnabled();
    return button;
  });
}

describe('RecorderDialog', () => {
  it('on plain HTTP shows the HTTPS message and a Close button', async () => {
    const user = userEvent.setup();
    const gum = installMedia(() => Promise.resolve(fakeStream('audio').stream), false);
    const { onClose } = renderRecorder();
    expect(screen.getByText(MEDIA_UNAVAILABLE)).toBeInTheDocument();
    expect(gum).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('shows the HTTPS message when the microphone is refused', async () => {
    installMedia(denied);
    renderRecorder();
    expect(await screen.findByText(MEDIA_UNAVAILABLE)).toBeInTheDocument();
  });

  it('records, pauses, resumes, stops, plays back and adds one audio/webm file', async () => {
    const user = userEvent.setup();
    const gum = installMedia(() => Promise.resolve(fakeStream('audio').stream));
    const { onAdd, onClose } = renderRecorder();
    expect(gum.mock.calls[0]?.[0] ?? (await waitFor(() => gum.mock.calls[0][0]))).toMatchObject({ audio: true });
    expect(screen.getByText('00:00')).toBeInTheDocument();

    await user.click(await ready());
    const recorder = FakeMediaRecorder.instances[0];
    expect(recorder.mimeType).toBe('audio/webm');
    expect(recorder.state).toBe('recording');

    await user.click(screen.getByRole('button', { name: 'Pause' }));
    expect(recorder.state).toBe('paused');
    await user.click(screen.getByRole('button', { name: 'Resume' }));
    expect(recorder.state).toBe('recording');
    await user.click(screen.getByRole('button', { name: 'Stop' }));

    expect(document.querySelector('audio[controls]')).toHaveAttribute('src');
    await user.click(screen.getByRole('button', { name: 'Add recording' }));
    expect(onAdd).toHaveBeenCalledOnce();
    const file: File = onAdd.mock.calls[0][0];
    expect(file).toBeInstanceOf(File);
    expect(file.type).toBe('audio/webm');
    expect(file.name).toMatch(RECORDING_NAME);
    expect(onClose).toHaveBeenCalled();
  });

  it('counts the elapsed time while recording, not while paused', async () => {
    const user = userEvent.setup();
    let now = 1_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    installMedia(() => Promise.resolve(fakeStream('audio').stream));
    renderRecorder();
    await user.click(await ready());
    now += 65_000;
    expect(await screen.findByText('01:05', undefined, { timeout: 2000 })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Pause' }));
    now += 30_000;
    await act(() => new Promise((r) => setTimeout(r, 400)));
    expect(screen.getByText('01:05')).toBeInTheDocument();
  });

  it('falls back to the browser’s own format and names the file to match', async () => {
    const user = userEvent.setup();
    installMedia(() => Promise.resolve(fakeStream('audio').stream));
    FakeMediaRecorder.supported = false;
    const { onAdd } = renderRecorder();
    await user.click(await ready());
    await user.click(screen.getByRole('button', { name: 'Stop' }));
    await user.click(screen.getByRole('button', { name: 'Add recording' }));
    const file: File = onAdd.mock.calls[0][0];
    expect(file.type).toBe('audio/ogg');
    expect(file.name).toMatch(/\.ogg$/);
  });

  it('Record again throws the take away', async () => {
    const user = userEvent.setup();
    installMedia(() => Promise.resolve(fakeStream('audio').stream));
    renderRecorder();
    await user.click(await ready());
    await user.click(screen.getByRole('button', { name: 'Stop' }));
    await user.click(screen.getByRole('button', { name: 'Record again' }));
    expect(document.querySelector('audio')).toBeNull();
    expect(screen.getByRole('button', { name: 'Add recording' })).toBeDisabled();
    expect(await ready()).toBeInTheDocument();
  });

  it('asks before throwing a recording away', async () => {
    const user = userEvent.setup();
    installMedia(() => Promise.resolve(fakeStream('audio').stream));
    const { onClose } = renderRecorder();
    await user.click(await ready());
    await user.click(screen.getByRole('button', { name: 'Stop' }));
    await user.click(screen.getByRole('button', { name: 'Close recorder' }));
    expect(screen.getByText('Discard this recording?')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Discard' }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('stops the microphone (and the recorder) on close', async () => {
    const user = userEvent.setup();
    const { stream, track } = fakeStream('audio');
    installMedia(() => Promise.resolve(stream));
    const { close } = renderRecorder();
    await user.click(await ready());
    close();
    expect(track.stop).toHaveBeenCalled();
    expect(FakeMediaRecorder.instances[0].state).toBe('inactive');
  });

  it('stops a microphone granted after the dialog already closed', async () => {
    const { stream, track } = fakeStream('audio');
    let grant!: (s: MediaStream) => void;
    installMedia(() => new Promise((resolve) => (grant = resolve)));
    const { close } = renderRecorder();
    await waitFor(() => expect(grant).toBeDefined());
    close();
    await act(async () => grant(stream));
    expect(track.stop).toHaveBeenCalled();
  });
});
