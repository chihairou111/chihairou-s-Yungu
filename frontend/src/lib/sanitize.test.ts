import { describe, expect, it } from 'vitest';
import { sanitizeEditorHtml, sanitizeInstructions } from './sanitize';

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

describe('sanitizeEditorHtml', () => {
  it('keeps the toolbar output and strips style, script and img', () => {
    const out = sanitizeEditorHtml(
      '<h1 style="color:red">T</h1><p><strong>b</strong><em>i</em><u>u</u><br></p><ul><li>x</li></ul><ol><li>y</li></ol><h2>h</h2><a href="https://a.b" onclick="x">l</a><script>bad()</script><img src="x.png"><style>p{}</style>',
    );
    expect(out).toContain('<h1>T</h1>');
    expect(out).toContain('<strong>b</strong>');
    expect(out).toContain('<ul><li>x</li></ul>');
    expect(out).toContain('<a href="https://a.b">l</a>');
    for (const bad of ['style', 'script', 'img', 'onclick', 'bad()']) expect(out).not.toContain(bad);
  });
});
