import { afterEach, describe, expect, it, vi } from 'vitest';
import { audioFileType, formatElapsed, mediaAvailable, photoName, recordingName, stopStream } from './media';

const T = Date.UTC(2026, 9, 19, 6, 3, 9); // Oct 19 14:03:09 China

afterEach(() => {
  vi.unstubAllGlobals();
});

function setSecure(secure: boolean) {
  vi.stubGlobal('isSecureContext', secure);
}

describe('mediaAvailable', () => {
  it('needs a secure context and getUserMedia', () => {
    const gum = vi.fn();
    vi.stubGlobal('navigator', { ...navigator, mediaDevices: { getUserMedia: gum } });
    setSecure(true);
    expect(mediaAvailable()).toBe(true);
    setSecure(false);
    expect(mediaAvailable()).toBe(false);
  });

  it('is false without navigator.mediaDevices', () => {
    vi.stubGlobal('navigator', { ...navigator, mediaDevices: undefined });
    setSecure(true);
    expect(mediaAvailable()).toBe(false);
  });
});

describe('file names', () => {
  it('names photos and recordings by China time', () => {
    expect(photoName(T)).toBe('Photo 2026-10-19 14.03.09.jpg');
    expect(recordingName(T, 'webm')).toBe('Recording 2026-10-19 14.03.09.webm');
  });
});

describe('audioFileType', () => {
  it('drops codec parameters and picks a matching extension', () => {
    expect(audioFileType('audio/webm;codecs=opus')).toEqual({ type: 'audio/webm', extension: 'webm' });
    expect(audioFileType('audio/ogg; codecs=opus')).toEqual({ type: 'audio/ogg', extension: 'ogg' });
    expect(audioFileType('audio/mp4')).toEqual({ type: 'audio/mp4', extension: 'm4a' });
    expect(audioFileType('')).toEqual({ type: 'audio/webm', extension: 'webm' });
  });
});

describe('formatElapsed', () => {
  it('reads mm:ss', () => {
    expect(formatElapsed(0)).toBe('00:00');
    expect(formatElapsed(65_900)).toBe('01:05');
    expect(formatElapsed(3_600_000 + 1000)).toBe('60:01');
  });
});

describe('stopStream', () => {
  it('stops every track', () => {
    const tracks = [{ stop: vi.fn() }, { stop: vi.fn() }];
    stopStream({ getTracks: () => tracks } as unknown as MediaStream);
    for (const t of tracks) expect(t.stop).toHaveBeenCalledOnce();
  });
});
