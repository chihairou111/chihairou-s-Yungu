'use client';
import { useEffect, useState } from 'react';
import { chinaFileStamp } from '@/lib/time';

/** What the camera and recorder say when the browser will not give them a device (plain HTTP, no API, refused). */
export const MEDIA_UNAVAILABLE = 'Camera and microphone need HTTPS — available once the app is served securely.';

/** Camera and microphone exist only in a secure context (HTTPS or localhost) with `getUserMedia`. */
export function mediaAvailable(): boolean {
  return typeof window !== 'undefined' && window.isSecureContext && !!navigator.mediaDevices?.getUserMedia;
}

export function stopStream(stream: MediaStream): void {
  for (const track of stream.getTracks()) track.stop();
}

/** "Photo 2026-10-19 14.03.09.jpg" (China time). */
export function photoName(ms: number): string {
  return `Photo ${chinaFileStamp(ms)}.jpg`;
}

/** "Recording 2026-10-19 14.03.09.webm" (China time); the extension follows the recorded format. */
export function recordingName(ms: number, extension: string): string {
  return `Recording ${chinaFileStamp(ms)}.${extension}`;
}

const AUDIO_EXTENSIONS: Record<string, string> = {
  'audio/webm': 'webm',
  'audio/ogg': 'ogg',
  'audio/mp4': 'm4a',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
};

/** The bare type (codecs dropped) a recorder produced, and the file extension that matches it. */
export function audioFileType(mime: string): { type: string; extension: string } {
  const type = mime.split(';')[0].trim().toLowerCase() || 'audio/webm';
  return { type, extension: AUDIO_EXTENSIONS[type] ?? type.split('/')[1] ?? 'webm' };
}

/** Elapsed time as mm:ss (minutes keep counting past 59). */
export function formatElapsed(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

export type MediaDevice = 'camera' | 'microphone';

export type MediaAccess =
  | { status: 'off' }
  | { status: 'starting' }
  | { status: 'ready'; stream: MediaStream }
  /** Insecure context, no API, or permission refused: the HTTPS message. */
  | { status: 'unavailable' }
  /** The device is missing or busy. */
  | { status: 'failed'; message: string };

const CONSTRAINTS: Record<MediaDevice, MediaStreamConstraints> = {
  // The rear camera on phones (it photographs the page); laptops have only the one.
  camera: { video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false },
  microphone: { audio: true, video: false },
};

function accessFailure(error: unknown, device: MediaDevice): MediaAccess {
  const name = error instanceof DOMException || error instanceof Error ? error.name : '';
  const noun = device === 'camera' ? 'camera' : 'microphone';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return { status: 'failed', message: `No ${noun} found on this device.` };
  if (name === 'NotReadableError' || name === 'AbortError') {
    return { status: 'failed', message: `Couldn’t start the ${noun}. Another app may be using it — close it and try again.` };
  }
  return { status: 'unavailable' };
}

/**
 * Asks for the camera or microphone while `active`, and stops every track as soon as it is not (the
 * dialog closed, or unmounted) — also a stream the browser grants only after that.
 */
export function useMediaStream(device: MediaDevice, active: boolean): MediaAccess {
  const [result, setResult] = useState<{ request: object; access: MediaAccess } | null>(null);
  const [request, setRequest] = useState<object | null>(null);
  // Each activation is a new request, so a result from an earlier opening is never shown again.
  if (active && request === null) setRequest({});
  if (!active && request !== null) setRequest(null);

  useEffect(() => {
    if (!request || !mediaAvailable()) return;
    let cancelled = false;
    let granted: MediaStream | null = null;
    navigator.mediaDevices.getUserMedia(CONSTRAINTS[device]).then(
      (stream) => {
        if (cancelled) return stopStream(stream);
        granted = stream;
        setResult({ request, access: { status: 'ready', stream } });
      },
      (error: unknown) => {
        if (!cancelled) setResult({ request, access: accessFailure(error, device) });
      },
    );
    return () => {
      cancelled = true;
      if (granted) stopStream(granted);
    };
  }, [device, request]);

  if (!active) return { status: 'off' };
  if (!mediaAvailable()) return { status: 'unavailable' };
  return result && result.request === request ? result.access : { status: 'starting' };
}
