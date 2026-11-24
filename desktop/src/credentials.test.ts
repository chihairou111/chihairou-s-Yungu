import { mkdtempSync, existsSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CredentialStore } from './credentials';

/** A stand-in for Electron's safeStorage: reversible, and visibly not plain text. */
function fakeCrypto(available = true) {
  return {
    isEncryptionAvailable: () => available,
    encryptString: (s: string) => Buffer.from(Buffer.from(s, 'utf8').toString('base64').split('').reverse().join(''), 'utf8'),
    decryptString: (b: Buffer) => Buffer.from(b.toString('utf8').split('').reverse().join(''), 'base64').toString('utf8'),
  };
}

let dir: string;
let file: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'yl-creds-'));
  file = join(dir, 'credentials.bin');
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const sample = { loginId: '100000001', password: 'p@ss word' };

describe('CredentialStore', () => {
  it('starts empty', () => {
    expect(new CredentialStore(file, fakeCrypto()).load()).toBeNull();
  });

  it('round-trips save and load across instances, encrypted and owner-only', () => {
    new CredentialStore(file, fakeCrypto()).save(sample);
    expect(new CredentialStore(file, fakeCrypto()).load()).toEqual(sample);
    expect(readFileSync(file).toString('utf8')).not.toContain(sample.password);
    if (process.platform !== 'win32') expect(statSync(file).mode & 0o777).toBe(0o600);
  });

  it('forget deletes the file', () => {
    const store = new CredentialStore(file, fakeCrypto());
    store.save(sample);
    store.forget();
    expect(existsSync(file)).toBe(false);
    expect(store.load()).toBeNull();
    expect(new CredentialStore(file, fakeCrypto()).load()).toBeNull();
    store.forget(); // nothing left to delete: still fine
  });

  it('keeps nothing on disk when encryption is unavailable, only for this launch', () => {
    const store = new CredentialStore(file, fakeCrypto(false));
    store.save(sample);
    expect(existsSync(file)).toBe(false);
    expect(store.load()).toEqual(sample);
    expect(new CredentialStore(file, fakeCrypto(false)).load()).toBeNull();
  });

  it('removes an older file when encryption is unavailable now', () => {
    new CredentialStore(file, fakeCrypto()).save(sample);
    new CredentialStore(file, fakeCrypto(false)).save({ loginId: '2', password: 'q' });
    expect(existsSync(file)).toBe(false);
  });

  it('reads a corrupt file as nothing', () => {
    writeFileSync(file, 'not encrypted at all');
    expect(new CredentialStore(file, fakeCrypto()).load()).toBeNull();
    writeFileSync(file, fakeCrypto().encryptString('{"loginId":1}'));
    expect(new CredentialStore(file, fakeCrypto()).load()).toBeNull();
    const throwing = { ...fakeCrypto(), decryptString: () => { throw new Error('bad'); } };
    new CredentialStore(file, fakeCrypto()).save(sample);
    expect(new CredentialStore(file, throwing).load()).toBeNull();
  });

  it('a Keychain that refuses to encrypt still leaves this launch signed in (the in-memory copy)', () => {
    const refusing = { ...fakeCrypto(), encryptString: (): Buffer => { throw new Error('denied'); } };
    const store = new CredentialStore(file, refusing);
    expect(() => store.save(sample)).toThrow(); // main.ts catches and logs this
    expect(store.load()).toEqual(sample);
    expect(existsSync(file)).toBe(false);
  });
});
