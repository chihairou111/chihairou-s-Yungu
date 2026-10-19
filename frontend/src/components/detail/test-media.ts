import { vi } from 'vitest';

/** Test doubles for camera and microphone access (jsdom has none). */

export interface FakeTrack {
  kind: 'audio' | 'video';
  stop: ReturnType<typeof vi.fn>;
  getSettings: () => MediaTrackSettings;
  addEventListener: (type: string, listener: () => void) => void;
  removeEventListener: (type: string, listener: () => void) => void;
  /** The device going away (fires 'ended'). */
  end: () => void;
}

export function fakeStream(kind: 'audio' | 'video', settings: MediaTrackSettings = {}) {
  const ended = new Set<() => void>();
  const track: FakeTrack = {
    kind,
    stop: vi.fn(),
    getSettings: () => settings,
    addEventListener: (type, listener) => type === 'ended' && ended.add(listener),
    removeEventListener: (type, listener) => ended.delete(listener),
    end: () => ended.forEach((listener) => listener()),
  };
  const stream = {
    getTracks: () => [track],
    getVideoTracks: () => (kind === 'video' ? [track] : []),
    getAudioTracks: () => (kind === 'audio' ? [track] : []),
  } as unknown as MediaStream;
  return { stream, track };
}

/** Puts `getUserMedia` on the navigator and sets the secure-context flag. Undo with `vi.unstubAllGlobals()`. */
export function installMedia(getUserMedia: (c: MediaStreamConstraints) => Promise<MediaStream>, secure = true) {
  vi.stubGlobal('isSecureContext', secure);
  const gum = vi.fn(getUserMedia);
  Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia: gum }, configurable: true });
  return gum;
}

export function removeMedia() {
  Object.defineProperty(navigator, 'mediaDevices', { value: undefined, configurable: true });
}

export function denied(): Promise<MediaStream> {
  return Promise.reject(new DOMException('Permission denied', 'NotAllowedError'));
}

/**
 * A MediaRecorder that hands back one chunk of its own type when stopped. Like a browser, it is
 * `inactive` at once but delivers the data and `stop` later: on the next task, or when the test calls
 * `finishStop()` if `holdStop` is set.
 */
export class FakeMediaRecorder {
  static supported = true;
  static holdStop = false;
  /** Make start() throw, as a browser that cannot record this stream does. */
  static failStart = false;
  /** Deliver no data on stop. */
  static empty = false;
  finishStop: (() => void) | null = null;
  static instances: FakeMediaRecorder[] = [];
  static isTypeSupported = (type: string) => FakeMediaRecorder.supported && type === 'audio/webm';
  /** What the browser picks when no type is asked for. */
  static defaultType = 'audio/ogg;codecs=opus';

  state: RecordingState = 'inactive';
  mimeType: string;
  ondataavailable: ((e: BlobEvent) => void) | null = null;
  onstop: (() => void) | null = null;

  constructor(
    public stream: MediaStream,
    options?: MediaRecorderOptions,
  ) {
    this.mimeType = options?.mimeType ?? FakeMediaRecorder.defaultType;
    FakeMediaRecorder.instances.push(this);
  }

  start() {
    if (FakeMediaRecorder.failStart) throw new DOMException('Not supported', 'NotSupportedError');
    this.state = 'recording';
  }
  pause() {
    this.state = 'paused';
  }
  resume() {
    this.state = 'recording';
  }
  stop() {
    if (this.state === 'inactive') return;
    this.state = 'inactive';
    this.finishStop = () => {
      this.finishStop = null;
      if (!FakeMediaRecorder.empty) this.ondataavailable?.({ data: new Blob(['audio-bytes'], { type: this.mimeType }) } as BlobEvent);
      this.onstop?.();
    };
    if (!FakeMediaRecorder.holdStop) setTimeout(() => this.finishStop?.(), 0);
  }
}

export function installRecorder() {
  FakeMediaRecorder.instances = [];
  FakeMediaRecorder.supported = true;
  FakeMediaRecorder.holdStop = false;
  FakeMediaRecorder.failStart = false;
  FakeMediaRecorder.empty = false;
  vi.stubGlobal('MediaRecorder', FakeMediaRecorder);
}

let urlSeq = 0;
/** jsdom has no object URLs. */
export function installObjectUrls() {
  const revoke = vi.fn();
  URL.createObjectURL = () => `blob:fake/${++urlSeq}`;
  URL.revokeObjectURL = revoke;
  return revoke;
}

/** A canvas that draws nothing and encodes to a small JPEG blob; a video that reports a frame size. */
export function installCanvas() {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    () => ({ drawImage: vi.fn(), translate: vi.fn(), scale: vi.fn() }) as unknown as CanvasRenderingContext2D,
  );
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (cb: BlobCallback, type?: string) {
    cb(new Blob(['jpeg-bytes'], { type: type ?? 'image/png' }));
  });
  Object.defineProperty(HTMLVideoElement.prototype, 'videoWidth', { get: () => 640, configurable: true });
  Object.defineProperty(HTMLVideoElement.prototype, 'videoHeight', { get: () => 480, configurable: true });
}
