import { describe, expect, it } from 'vitest';
import { permissionDecision } from './permissions';

const origin = 'http://127.0.0.1:51234';
const app = `${origin}/assignments/1`;

describe('permissionDecision', () => {
  it('lets app pages use the camera and microphone (after the OS check) and write the clipboard', () => {
    expect(permissionDecision('media', app, app, origin)).toBe('media');
    expect(permissionDecision('clipboard-sanitized-write', app, app, origin)).toBe('allow');
  });

  it('allows fullscreen in an app page, embedded players included', () => {
    expect(permissionDecision('fullscreen', app, app, origin)).toBe('allow');
    expect(permissionDecision('fullscreen', 'https://player.example.com/embed/1', app, origin)).toBe('allow');
  });

  it('refuses fullscreen when the window is not on the app', () => {
    expect(permissionDecision('fullscreen', 'https://evil.example.com/', 'https://evil.example.com/', origin)).toBe('deny');
    expect(permissionDecision('fullscreen', app, 'file:///x/splash.html', origin)).toBe('deny');
  });

  it('keeps media and clipboard to the app origin itself, not embedded frames', () => {
    expect(permissionDecision('media', 'https://player.example.com/', app, origin)).toBe('deny');
    expect(permissionDecision('clipboard-sanitized-write', 'https://player.example.com/', app, origin)).toBe('deny');
    expect(permissionDecision('media', 'http://127.0.0.1:1/', app, origin)).toBe('deny');
  });

  it('denies everything else', () => {
    for (const p of ['geolocation', 'notifications', 'midi', 'pointerLock', 'openExternal', 'display-capture', 'clipboard-read']) {
      expect(permissionDecision(p, app, app, origin), p).toBe('deny');
    }
  });
});
