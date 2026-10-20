import { describe, expect, it } from 'vitest';
import { ONLINE_DOC_MAX_BYTES, docTooLongMessage } from './limits';

describe('docTooLongMessage (the same rule and words as the service)', () => {
  it('the limit is 65 535 UTF-8 bytes', () => {
    expect(ONLINE_DOC_MAX_BYTES).toBe(65_535);
  });

  it('accepts content up to the limit', () => {
    expect(docTooLongMessage('')).toBeNull();
    expect(docTooLongMessage('a'.repeat(65_535))).toBeNull();
    expect(docTooLongMessage('研'.repeat(21_845))).toBeNull(); // 65 535 bytes
  });

  it('one byte over asks to cut about 1 character (singular)', () => {
    expect(docTooLongMessage('a'.repeat(65_536))).toBe('Too long for Yungu — cut about 1 character.');
  });

  it('N = max(1, ceil(excess × code points / bytes)) over the content string', () => {
    // 66 000 bytes, 22 000 code points: excess 465 → 465 × 22000 / 66000 = 155.
    expect(docTooLongMessage('研'.repeat(22_000))).toBe('Too long for Yungu — cut about 155 characters.');
    // 65 538 bytes: excess 3 → exactly 1.
    expect(docTooLongMessage('研'.repeat(21_846))).toBe('Too long for Yungu — cut about 1 character.');
    // 65 541 bytes: excess 6 → exactly 2, plural.
    expect(docTooLongMessage('研'.repeat(21_847))).toBe('Too long for Yungu — cut about 2 characters.');
    // Astral characters count once (4 bytes, 1 code point): 16 384 × 4 = 65 536 → excess 1 → ceil(0.25) = 1.
    expect(docTooLongMessage('😀'.repeat(16_384))).toBe('Too long for Yungu — cut about 1 character.');
    // Mixed: 65 535 ASCII + 10 × 研 (30 bytes, 65 545 code points, 65 565 bytes): excess 30 → ceil(30 × 65545 / 65565) = 30.
    expect(docTooLongMessage('a'.repeat(65_535) + '研'.repeat(10))).toBe('Too long for Yungu — cut about 30 characters.');
  });
});
