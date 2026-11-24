import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

const FILE = 'hand-in.json';

/**
 * The local account's hand-in record, kept on disk in `dir/hand-in.json`: per assignment, the file ids of
 * the last hand-in this app saw (a submit made here, or a Yungu read showing the hand-in: submitted, no
 * draft open). Yungu's achievement has one file list (the draft), so once the draft is edited after a
 * submit only this record can say which files the teacher has. Port of `SubmittedFiles` in
 * `api/service/state.py`, for one account. Written atomically (temp file + rename), mode 0600.
 */
export class LocalState {
  private kept: Record<string, string[]> | null = null;

  constructor(private readonly dir: string) {}

  private load(): Record<string, string[]> {
    if (this.kept) return this.kept;
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(readFileSync(join(this.dir, FILE), 'utf8'));
    } catch {
      parsed = null; // missing or unreadable: nothing kept yet
    }
    const out: Record<string, string[]> = {};
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      for (const [aid, ids] of Object.entries(parsed as Record<string, unknown>)) {
        if (Array.isArray(ids) && ids.every((i) => typeof i === 'string')) out[aid] = [...ids];
      }
    }
    this.kept = out;
    return out;
  }

  /** The file ids last handed in on `aid`, or null when this app never saw a hand-in there. */
  handIn(aid: number): string[] | null {
    const ids = this.load()[String(aid)];
    return ids ? [...ids] : null;
  }

  /**
   * Records a hand-in. Never throws: a disk error must not turn a successful submit (or a detail read)
   * into an error, so the record is kept in memory and the write error only warned (its class and code,
   * never a path or the record).
   */
  setHandIn(aid: number, ids: string[]): void {
    const next = { ...this.load(), [String(aid)]: [...ids] };
    this.kept = next;
    const path = join(this.dir, FILE);
    const temp = `${path}.${randomBytes(6).toString('hex')}.tmp`;
    try {
      mkdirSync(this.dir, { recursive: true, mode: 0o700 });
      writeFileSync(temp, JSON.stringify(next), { mode: 0o600 });
      renameSync(temp, path);
    } catch (error) {
      try {
        unlinkSync(temp);
      } catch {
        // never written
      }
      const code = (error as { code?: unknown } | null)?.code;
      console.warn(
        `LocalState: could not save the hand-in record (${error instanceof Error ? error.name : 'Error'}${typeof code === 'string' ? ` ${code}` : ''}); kept in memory only.`,
      );
    }
  }
}
