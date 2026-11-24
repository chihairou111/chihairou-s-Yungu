/* eslint-disable @typescript-eslint/no-explicit-any */
// Cross-check: replays every call scripts/crosscheck-mapping.py makes against api/mapping.py (the hosted
// implementation) through the TypeScript port and compares the results. Off by default (it needs python3):
//
//   CROSSCHECK=1 npx vitest run src/lib/yungu/mapping.crosscheck.test.ts
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as mapping from './mapping';

const FN: Record<string, (...a: any[]) => unknown> = {
  china_ms: mapping.chinaMs,
  month_window: mapping.monthWindow,
  assignment: mapping.assignment,
  is_revision: mapping.isRevision,
  class_event: mapping.classEvent,
  courses: mapping.courses,
  file_ref: mapping.fileRef,
  comment: mapping.comment,
  notification: mapping.notification,
  achievement_status: mapping.achievementStatus,
  is_submitted: mapping.isSubmitted,
  hand_in_on_yungu: mapping.handInOnYungu,
  needs_files: mapping.needsFiles,
  feedback: mapping.feedback,
  detail: mapping.detail,
  behaviour: mapping.behaviour,
};

describe.skipIf(!process.env.CROSSCHECK)('mapping.ts agrees with api/mapping.py', () => {
  const out = execFileSync('python3', [join(__dirname, '../../../scripts/crosscheck-mapping.py')], { maxBuffer: 1 << 28 });
  const cases: Record<string, { fn: string; args: unknown[]; out: { value?: unknown; error?: string } }> = JSON.parse(out.toString('utf8'));
  const byFn = new Map<string, string[]>();
  for (const [name, c] of Object.entries(cases)) byFn.set(c.fn, [...(byFn.get(c.fn) ?? []), name]);

  for (const [fn, names] of byFn) {
    it(`${fn}: ${names.length} cases identical`, () => {
      let errors = 0;
      for (const name of names) {
        const c = cases[name];
        if (c.out.error) {
          errors++;
          expect(() => FN[fn](...structuredClone(c.args)), name).toThrow();
        } else {
          const expected: any = c.out.value;
          // Known difference: Python's mime table (from the host's /etc/mime.types) says .key is a PGP key; we say Keynote.
          if (fn === 'file_ref' && expected.name.endsWith('.key')) expected.mime = 'application/vnd.apple.keynote';
          expect(JSON.parse(JSON.stringify(FN[fn](...structuredClone(c.args)) ?? null)), name).toEqual(expected);
        }
      }
      console.log(`${fn}: ${names.length} cases (${errors} raise) identical`);
    });
  }
});
