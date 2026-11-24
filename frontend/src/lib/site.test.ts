import { describe, expect, it } from 'vitest';
import { SITE_NAME } from './site';

describe('SITE_NAME', () => {
  it('names the local desktop app', () => {
    expect(SITE_NAME).toBe("chihairou's Yungu (local)");
  });
});
