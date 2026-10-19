import { describe, expect, it } from 'vitest';
import { sanitizeInstructions } from './sanitize';

describe('sanitizeInstructions', () => {
  it('strips scripts, event handlers and javascript: links but keeps safe markup', () => {
    const out = sanitizeInstructions(
      '<p onclick="x">Hi<script>bad()</script></p><a href="javascript:alert(1)">x</a><a href="https://a.b">ok</a>',
    );
    expect(out).toContain('<p>Hi</p>');
    expect(out).not.toContain('script');
    expect(out).not.toContain('bad()');
    expect(out).not.toContain('onclick');
    expect(out).not.toContain('javascript:');
    expect(out).toMatch(/<a [^>]*href="https:\/\/a\.b"[^>]*>ok<\/a>/);
    expect(out).toContain('target="_blank"');
    expect(out).toContain('rel="noopener noreferrer"');
  });

  it('overrides a link target the author supplied', () => {
    const out = sanitizeInstructions('<a href="https://a.b" target="_self" rel="opener">x</a>');
    expect(out).toContain('target="_blank"');
    expect(out).toContain('rel="noopener noreferrer"');
    expect(out).not.toContain('_self');
  });

  it('keeps the allowed formatting tags and drops the rest', () => {
    const out = sanitizeInstructions(
      '<h2>T</h2><ul><li><strong>a</strong> <em>b</em> <u>c</u></li></ul><blockquote>q</blockquote><div style="color:red">d</div><img src="https://a.b/i.png" alt="pic" onerror="x()">',
    );
    expect(out).toContain('<h2>T</h2>');
    expect(out).toContain('<ul><li><strong>a</strong> <em>b</em> <u>c</u></li></ul>');
    expect(out).toContain('<blockquote>q</blockquote>');
    expect(out).not.toContain('<div');
    expect(out).not.toContain('style');
    expect(out).toContain('<img src="https://a.b/i.png" alt="pic" />');
    expect(out).not.toContain('onerror');
  });
});
