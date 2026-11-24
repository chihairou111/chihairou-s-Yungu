import { readFileSync, rmSync, writeFileSync, chmodSync } from 'node:fs';

export interface Credentials {
  loginId: string;
  password: string;
}

/** The part of Electron's `safeStorage` this needs (the OS keychain behind it). */
export interface StringCrypto {
  isEncryptionAvailable(): boolean;
  encryptString(s: string): Buffer;
  decryptString(b: Buffer): string;
}

/**
 * The one saved sign-in, encrypted with the OS keychain into `file` (`credentials.bin`, mode 0600).
 * When encryption is unavailable nothing is written: the credentials live in memory for this launch only.
 */
export class CredentialStore {
  private memory: Credentials | null = null;

  constructor(
    private readonly file: string,
    private readonly crypto: StringCrypto,
  ) {}

  load(): Credentials | null {
    if (this.memory) return { ...this.memory };
    if (!this.crypto.isEncryptionAvailable()) return null;
    let raw: Buffer;
    try {
      raw = readFileSync(this.file);
    } catch {
      return null;
    }
    try {
      const parsed: unknown = JSON.parse(this.crypto.decryptString(raw));
      if (
        parsed &&
        typeof parsed === 'object' &&
        'loginId' in parsed &&
        typeof parsed.loginId === 'string' &&
        'password' in parsed &&
        typeof parsed.password === 'string'
      ) {
        return { loginId: parsed.loginId, password: parsed.password };
      }
    } catch {
      // corrupt or written under another key: as good as nothing
    }
    return null;
  }

  save(c: Credentials): void {
    this.memory = { loginId: c.loginId, password: c.password };
    if (!this.crypto.isEncryptionAvailable()) {
      this.removeFile(); // never leave an older copy behind
      return;
    }
    const data = this.crypto.encryptString(JSON.stringify(this.memory));
    writeFileSync(this.file, data, { mode: 0o600 });
    chmodSync(this.file, 0o600); // `mode` applies only when the file is created
  }

  forget(): void {
    this.memory = null;
    this.removeFile();
  }

  private removeFile(): void {
    rmSync(this.file, { force: true });
  }
}
