import { describe, expect, it } from 'vitest';
import { Editor, type JSONContent } from '@tiptap/core';
import { WRITER_EXTENSIONS } from '@/components/detail/writerExtensions';
import { deltaBytes, deltaToDoc, deltaToHtml, docToDelta, normalizeDelta, parseDelta, type Delta } from './quill-delta';

/** The delta Yungu's own editor produced through every toolbar button (research §2, captured live). */
const YUNGU_EXAMPLE: Delta = {
  ops: [
    { insert: 'Heading One 一级标题' },
    { attributes: { header: 1 }, insert: '\n' },
    { insert: 'Heading Two 二级标题' },
    { attributes: { header: 2 }, insert: '\n' },
    { insert: 'Plain start, ' },
    { attributes: { bold: true }, insert: 'bold' },
    { insert: ', ' },
    { attributes: { italic: true }, insert: 'italic' },
    { insert: ', ' },
    { attributes: { underline: true }, insert: 'underline' },
    { insert: ', ' },
    { attributes: { strike: true }, insert: 'strike' },
    { insert: ', ' },
    { attributes: { italic: true, bold: true }, insert: 'bold+italic' },
    { insert: ' end.\nBullet one' },
    { attributes: { list: 'bullet' }, insert: '\n' },
    { insert: 'Bullet two 第二项' },
    { attributes: { list: 'bullet' }, insert: '\n' },
    { insert: 'Numbered one' },
    { attributes: { list: 'ordered' }, insert: '\n' },
    { insert: 'Numbered two' },
    { attributes: { list: 'ordered' }, insert: '\n' },
    { insert: 'A quoted line' },
    { attributes: { blockquote: true }, insert: '\n' },
    { insert: '\nCentered line' },
    { attributes: { align: 'center' }, insert: '\n' },
    { insert: '这是第一段中文。\n这是第二段中文，包含标点！\nLink here: ' },
    { attributes: { link: 'https://example.com/' }, insert: 'Example site' },
    { insert: '\nEdited line 编辑后 ' },
    { attributes: { underline: true }, insert: 'added' },
    { insert: '\n' },
  ],
};

const OSS_IMAGE = { image: { url: 'https://yungu-task.oss-cn-hangzhou.aliyuncs.com/a/b.png', uid: 'rc-1' } };

/** Opens the delta in our editor exactly as the writer will, then saves it without any edit. */
function throughEditor(delta: Delta): { delta: Delta; flattened: boolean } {
  const editor = new Editor({ extensions: WRITER_EXTENSIONS, content: deltaToDoc(delta) });
  try {
    return docToDelta(editor.getJSON());
  } finally {
    editor.destroy();
  }
}

function expectEquivalent(saved: Delta, original: Delta) {
  expect(normalizeDelta(saved)).toEqual(normalizeDelta(original));
}

describe('round trip of Yungu-written documents (Review Focus 3)', () => {
  it('keeps the research example exactly, op for op', () => {
    const { delta, flattened } = throughEditor(YUNGU_EXAMPLE);
    expect(flattened).toBe(false);
    expect(delta).toEqual(YUNGU_EXAMPLE);
  });

  it('normalises legacy list:true / bullet:true to ordered / bullet and keeps them as lists', () => {
    const legacy: Delta = {
      ops: [
        { insert: '第一' },
        { attributes: { list: true }, insert: '\n' },
        { insert: '第二' },
        { attributes: { list: true }, insert: '\n' },
        { insert: 'dot' },
        { attributes: { bullet: true }, insert: '\n' },
      ],
    };
    const doc = deltaToDoc(legacy);
    expect(doc.content?.map((n) => n.type)).toEqual(['orderedList', 'bulletList']);
    const { delta } = throughEditor(legacy);
    expect(delta).toEqual({
      ops: [
        { insert: '第一' },
        { attributes: { list: 'ordered' }, insert: '\n' },
        { insert: '第二' },
        { attributes: { list: 'ordered' }, insert: '\n' },
        { insert: 'dot' },
        { attributes: { list: 'bullet' }, insert: '\n' },
      ],
    });
    expectEquivalent(delta, legacy);
  });

  it('keeps image, video, file and audio embeds as yunguEmbed atoms holding the original object', () => {
    const video = { video: { url: 'https://x.aliyuncs.com/v.mp4', uid: 'v', previewImage: 'https://x.aliyuncs.com/p.png' } };
    const file = { file: { url: 'https://x.aliyuncs.com/f.pdf', name: '报告.pdf', uid: 'f' } };
    const audio = { audio: { url: 'https://x.aliyuncs.com/a.mp3', uid: 'a' } };
    const delta: Delta = {
      ops: [
        { insert: 'Before 前\n' },
        { insert: OSS_IMAGE },
        { insert: video },
        { insert: 'Between\n' },
        { insert: file },
        { insert: audio },
        { insert: '\n' },
      ],
    };
    const doc = deltaToDoc(delta);
    const embeds = doc.content?.filter((n) => n.type === 'yunguEmbed') ?? [];
    expect(embeds.map((n) => n.attrs)).toEqual([
      expect.objectContaining({ kind: 'image', value: OSS_IMAGE }),
      expect.objectContaining({ kind: 'video', value: video }),
      expect.objectContaining({ kind: 'file', value: file }),
      expect.objectContaining({ kind: 'audio', value: audio }),
    ]);
    const saved = throughEditor(delta);
    expect(saved.flattened).toBe(false);
    expect(saved.delta).toEqual(delta);
  });

  it('carries unknown block and inline attributes through untouched', () => {
    const delta: Delta = {
      ops: [
        { attributes: { color: '#e60000', bold: true }, insert: '红色' },
        { insert: ' plain ' },
        { attributes: { script: 'sub' }, insert: 'x' },
        { attributes: { indent: 1, list: 'bullet' }, insert: '\n' },
        { insert: 'code' },
        { attributes: { 'code-block': true }, insert: '\n' },
        { insert: 'Quoted heading' },
        { attributes: { blockquote: true, header: 2, align: 'right' }, insert: '\n' },
        { insert: { formula: 'e=mc^2' } },
        { insert: 'Justified' },
        { attributes: { align: 'justify', direction: 'rtl' }, insert: '\n' },
      ],
    };
    expectEquivalent(throughEditor(delta).delta, delta);
  });

  it('saves formats it owns as the writer shows them, even with values it can’t show', () => {
    const delta: Delta = {
      ops: [
        { attributes: { bold: false, link: 42, italic: 'yes', color: 'red' }, insert: 'odd' },
        { attributes: { header: 3 }, insert: '\n' },
        { insert: 'checked' },
        { attributes: { list: 'checked' }, insert: '\n' },
        { insert: 'both' },
        { attributes: { list: 'bullet', blockquote: true, header: 1 }, insert: '\n' },
        { insert: 'left' },
        { attributes: { align: 'left', indent: 1 }, insert: '\n' },
      ],
    };
    const saved = throughEditor(delta);
    // A smaller heading and a checklist become plain lines: the writer says so before saving.
    expect(saved.flattened).toBe(true);
    expect(saved.delta).toEqual({
      ops: [
        { attributes: { color: 'red' }, insert: 'odd' },
        { insert: '\nchecked\nboth' },
        { attributes: { list: 'bullet' }, insert: '\n' },
        { insert: 'left' },
        { attributes: { indent: 1 }, insert: '\n' },
      ],
    });
  });

  it('says so when a heading level or list kind it can’t show would become a plain line', () => {
    for (const attributes of [{ header: 3 }, { header: 6 }, { list: 'checked' }, { list: 'unchecked' }, { header: 4, blockquote: true }]) {
      const delta: Delta = { ops: [{ insert: 'kept' }, { insert: '\n' }, { insert: 'line' }, { attributes, insert: '\n' }] };
      const saved = throughEditor(delta);
      expect(saved.flattened, JSON.stringify(attributes)).toBe(true);
      // Also when the writer reopens from its local draft (editor HTML).
      const first = new Editor({ extensions: WRITER_EXTENSIONS, content: deltaToDoc(delta) });
      const second = new Editor({ extensions: WRITER_EXTENSIONS, content: first.getHTML() });
      first.destroy();
      expect(docToDelta(second.getJSON()).flattened, JSON.stringify(attributes)).toBe(true);
      // Gone once that line is deleted.
      second.commands.setContent(second.getJSON().content!.slice(0, 1));
      expect(docToDelta(second.getJSON())).toEqual({ delta: { ops: [{ insert: 'kept\n' }] }, flattened: false });
      // A new line typed after it is a plain line of the writer's own.
      second.destroy();
    }
  });

  it('does not warn for what it keeps: the Yungu example, headings 1–2, both lists, legacy lists', () => {
    expect(throughEditor(YUNGU_EXAMPLE).flattened).toBe(false);
    const legacy: Delta = { ops: [{ insert: 'a' }, { attributes: { list: true }, insert: '\n' }, { insert: 'b' }, { attributes: { bullet: true }, insert: '\n' }] };
    expect(throughEditor(legacy).flattened).toBe(false);
  });

  it('a line split from a demoted heading is the writer’s own plain line', () => {
    const editor = new Editor({ extensions: WRITER_EXTENSIONS, content: deltaToDoc({ ops: [{ insert: 'h3' }, { attributes: { header: 3 }, insert: '\n' }] }) });
    editor.commands.focus('end');
    editor.commands.splitBlock();
    editor.commands.insertContent('new');
    const [, second] = editor.getJSON().content!;
    editor.destroy();
    expect(second.attrs?.quillDropped ?? null).toBeNull();
  });

  it('treats a delta with only text after the last newline as a final line', () => {
    expect(throughEditor({ ops: [{ insert: 'no newline' }] }).delta).toEqual({ ops: [{ insert: 'no newline\n' }] });
  });

  it('opens an empty delta as an empty document and saves Quill’s empty document', () => {
    expect(throughEditor({ ops: [] }).delta).toEqual({ ops: [{ insert: '\n' }] });
    expect(throughEditor({ ops: [{ insert: '\n' }] }).delta).toEqual({ ops: [{ insert: '\n' }] });
  });
});

describe('the writer’s HTML draft and the clipboard keep what we don’t edit', () => {
  const KEPT: Delta = {
    ops: [
      { attributes: { color: '#e60000' }, insert: 'red 红' },
      { attributes: { indent: 1, list: 'bullet' }, insert: '\n' },
      { insert: 'quoted item' },
      { attributes: { list: 'ordered', direction: 'rtl' }, insert: '\n' },
      { insert: OSS_IMAGE },
      { insert: { file: { url: 'https://x.aliyuncs.com/f.pdf', name: '报告 "a".pdf', uid: 'f' } }, attributes: { width: '50%' } },
      { insert: 'end' },
      { attributes: { align: 'center', indent: 2 }, insert: '\n' },
    ],
  };

  it('survives getHTML → a new editor (the local draft path)', () => {
    for (const delta of [KEPT, YUNGU_EXAMPLE]) {
      const first = new Editor({ extensions: WRITER_EXTENSIONS, content: deltaToDoc(delta) });
      const html = first.getHTML();
      first.destroy();
      const second = new Editor({ extensions: WRITER_EXTENSIONS, content: html });
      const saved = docToDelta(second.getJSON()).delta;
      second.destroy();
      expectEquivalent(saved, delta);
    }
  });

  it('survives cut and paste inside the editor', () => {
    const editor = new Editor({ extensions: WRITER_EXTENSIONS, content: deltaToDoc(KEPT) });
    editor.commands.selectAll();
    const { dom } = editor.view.serializeForClipboard(editor.state.selection.content());
    editor.commands.clearContent();
    editor.view.pasteHTML(dom.innerHTML, new Event('paste') as ClipboardEvent);
    const saved = docToDelta(editor.getJSON()).delta;
    editor.destroy();
    expectEquivalent(saved, KEPT);
  });

  it('ignores data attributes that don’t hold a JSON object', () => {
    const editor = new Editor({
      extensions: WRITER_EXTENSIONS,
      content: '<div data-yungu-embed="not json">x</div><div data-yungu-embed="[1]">y</div><p data-quill-block="{bad"><span data-quill-inline="&quot;s&quot;">z</span></p>',
    });
    const saved = docToDelta(editor.getJSON()).delta;
    editor.destroy();
    expect(saved).toEqual({ ops: [{ insert: 'x\ny\nz\n' }] });
  });
});

describe('the editor’s trailing empty paragraph', () => {
  const cases: Delta[] = [
    { ops: [{ insert: 'a' }, { attributes: { list: 'bullet' }, insert: '\n' }] },
    { ops: [{ insert: '标题' }, { attributes: { header: 1 }, insert: '\n' }] },
    { ops: [{ insert: 'q' }, { attributes: { blockquote: true }, insert: '\n' }] },
    { ops: [{ insert: 'x\n' }, { insert: OSS_IMAGE }, { insert: '\n' }] },
  ];

  it('is not saved as an extra blank line after the first transaction', () => {
    for (const delta of cases) {
      const editor = new Editor({ extensions: WRITER_EXTENSIONS, content: deltaToDoc(delta) });
      editor.commands.setTextSelection(1);
      expect(editor.state.doc.lastChild?.type.name).toBe('paragraph');
      const saved = docToDelta(editor.getJSON()).delta;
      editor.destroy();
      expect(saved).toEqual(delta);
    }
  });

  it('a Yungu blank last line after a formatted line normalises away', () => {
    const withBlank: Delta = { ops: [{ insert: 'a' }, { attributes: { list: 'bullet' }, insert: '\n' }, { insert: '\n' }] };
    expect(normalizeDelta(withBlank)).toEqual(cases[0]);
    expectEquivalent(throughEditor(withBlank).delta, withBlank);
    expect(normalizeDelta({ ops: [{ insert: 'p\n' }, { insert: '\n' }] })).toEqual({ ops: [{ insert: 'p\n\n' }] });
  });
});

describe('our toolbar’s formats → Yungu delta', () => {
  const text = (t: string, marks?: JSONContent['marks']): JSONContent => ({ type: 'text', text: t, ...(marks ? { marks } : {}) });
  const para = (...content: JSONContent[]): JSONContent => ({ type: 'paragraph', content });

  it('maps headings, marks, links, both lists, strike, blockquote and align', () => {
    const doc: JSONContent = {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 1 }, content: [text('一级')] },
        { type: 'heading', attrs: { level: 2, textAlign: 'center' }, content: [text('二级')] },
        para(
          text('b', [{ type: 'bold' }]),
          text('i', [{ type: 'italic' }]),
          text('u', [{ type: 'underline' }]),
          text('s', [{ type: 'strike' }]),
          text('bi', [{ type: 'bold' }, { type: 'italic' }]),
          text('site', [{ type: 'link', attrs: { href: 'https://example.com', target: null, rel: null, class: null } }]),
        ),
        { type: 'bulletList', content: [{ type: 'listItem', content: [para(text('one'))] }, { type: 'listItem', content: [para(text('two'))] }] },
        { type: 'orderedList', attrs: { start: 1 }, content: [{ type: 'listItem', content: [para(text('first'))] }] },
        { type: 'blockquote', content: [para(text('quote'))] },
        { type: 'paragraph', attrs: { textAlign: 'right' }, content: [text('right')] },
        { type: 'paragraph', attrs: { textAlign: 'left' }, content: [text('left')] },
        { type: 'paragraph' },
      ],
    };
    const { delta, flattened } = docToDelta(doc);
    expect(flattened).toBe(false);
    expect(delta).toEqual({
      ops: [
        { insert: '一级' },
        { attributes: { header: 1 }, insert: '\n' },
        { insert: '二级' },
        { attributes: { header: 2, align: 'center' }, insert: '\n' },
        { attributes: { bold: true }, insert: 'b' },
        { attributes: { italic: true }, insert: 'i' },
        { attributes: { underline: true }, insert: 'u' },
        { attributes: { strike: true }, insert: 's' },
        { attributes: { bold: true, italic: true }, insert: 'bi' },
        { attributes: { link: 'https://example.com' }, insert: 'site' },
        { insert: '\none' },
        { attributes: { list: 'bullet' }, insert: '\n' },
        { insert: 'two' },
        { attributes: { list: 'bullet' }, insert: '\n' },
        { insert: 'first' },
        { attributes: { list: 'ordered' }, insert: '\n' },
        { insert: 'quote' },
        { attributes: { blockquote: true }, insert: '\n' },
        { insert: 'right' },
        { attributes: { align: 'right' }, insert: '\n' },
        { insert: 'left\n\n' },
      ],
    });
  });

  it('never lets a passthrough set a format the writer owns (Review Focus 5)', () => {
    const doc: JSONContent = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          attrs: { quillBlock: { list: 'bullet', bullet: true, header: 1, blockquote: true, align: 'center', indent: 2 } },
          content: [
            text('click', [{ type: 'quillInline', attrs: { attributes: { link: 'javascript:alert(1)', bold: true, italic: true, underline: true, strike: true, color: 'red' } } }]),
          ],
        },
      ],
    };
    expect(docToDelta(doc).delta).toEqual({
      ops: [
        { attributes: { color: 'red' }, insert: 'click' },
        { attributes: { indent: 2 }, insert: '\n' },
      ],
    });
  });

  it('flattens line breaks inside a block into new lines of the same block', () => {
    const doc: JSONContent = {
      type: 'doc',
      content: [{ type: 'heading', attrs: { level: 2 }, content: [text('a'), { type: 'hardBreak' }, text('b')] }],
    };
    expect(docToDelta(doc)).toEqual({
      delta: {
        ops: [
          { insert: 'a' },
          { attributes: { header: 2 }, insert: '\n' },
          { insert: 'b' },
          { attributes: { header: 2 }, insert: '\n' },
        ],
      },
      flattened: true,
    });
  });

  it('flattens nested lists one level and says so', () => {
    const doc: JSONContent = {
      type: 'doc',
      content: [
        {
          type: 'bulletList',
          content: [
            {
              type: 'listItem',
              content: [
                para(text('outer')),
                { type: 'orderedList', content: [{ type: 'listItem', content: [para(text('inner'))] }] },
              ],
            },
          ],
        },
      ],
    };
    expect(docToDelta(doc)).toEqual({
      delta: {
        ops: [
          { insert: 'outer' },
          { attributes: { list: 'bullet' }, insert: '\n' },
          { insert: 'inner' },
          { attributes: { list: 'ordered' }, insert: '\n' },
        ],
      },
      flattened: true,
    });
  });

  it('what the writer types round-trips through the editor too', () => {
    const editor = new Editor({ extensions: WRITER_EXTENSIONS, content: '<h1>标题</h1><p><strong>粗</strong> and <a href="https://e.org">link</a></p><ol><li><p>x</p></li></ol>' });
    const first = docToDelta(editor.getJSON()).delta;
    editor.destroy();
    expect(first).toEqual({
      ops: [
        { insert: '标题' },
        { attributes: { header: 1 }, insert: '\n' },
        { attributes: { bold: true }, insert: '粗' },
        { insert: ' and ' },
        { attributes: { link: 'https://e.org' }, insert: 'link' },
        { insert: '\nx' },
        { attributes: { list: 'ordered' }, insert: '\n' },
      ],
    });
    expect(throughEditor(first).delta).toEqual(first);
  });
});

describe('deltaBytes (Review Focus 1)', () => {
  const encoded = (d: Delta) => new TextEncoder().encode(JSON.stringify(d)).length;
  const cjk = (n: number, tail = ''): Delta => ({ ops: [{ insert: '汉'.repeat(n) + tail + '\n' }] });

  it('counts exactly the UTF-8 bytes of the stored JSON', () => {
    for (const d of [YUNGU_EXAMPLE, cjk(10), { ops: [{ insert: OSS_IMAGE }, { insert: '"quoted" \\  \n' }] }]) {
      expect(deltaBytes(d)).toBe(encoded(d));
    }
  });

  it('a 21 845-character CJK paragraph is 65 535 bytes of text but over the limit once wrapped in JSON', () => {
    expect(new TextEncoder().encode('汉'.repeat(21845)).length).toBe(65535);
    expect(deltaBytes(cjk(21845))).toBe(encoded(cjk(21845)));
    expect(deltaBytes(cjk(21845))).toBeGreaterThan(65535);
    expect(deltaBytes(cjk(21846))).toBeGreaterThan(65535);
  });

  it('the largest CJK paragraph Yungu accepts is exactly 65 535 bytes; one more byte is 65 536', () => {
    const overhead = encoded({ ops: [{ insert: '\n' }] });
    const chars = Math.floor((65535 - overhead) / 3);
    const pad = 'a'.repeat(65535 - overhead - chars * 3);
    expect(deltaBytes(cjk(chars, pad))).toBe(65535);
    expect(deltaBytes(cjk(chars, pad))).toBe(encoded(cjk(chars, pad)));
    expect(deltaBytes(cjk(chars, pad + 'a'))).toBe(65536);
    expect(deltaBytes(cjk(chars + 1))).toBeGreaterThan(65535);
  });
});

describe('deltaToHtml (Review Focus 5)', () => {
  it('renders Yungu’s preview structure', () => {
    const html = deltaToHtml(YUNGU_EXAMPLE);
    expect(html).toContain('<h1>Heading One 一级标题</h1>');
    expect(html).toContain('<h2>Heading Two 二级标题</h2>');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<em>italic</em>');
    expect(html).toContain('<u>underline</u>');
    expect(html).toContain('<s>strike</s>');
    expect(html).toMatch(/<strong><em>bold\+italic<\/em><\/strong>|<em><strong>bold\+italic<\/strong><\/em>/);
    expect(html).toContain('<ul><li>Bullet one</li><li>Bullet two 第二项</li></ul>');
    expect(html).toContain('<ol><li>Numbered one</li><li>Numbered two</li></ol>');
    expect(html).toContain('<blockquote>A quoted line</blockquote>');
    expect(html).toContain('<p style="text-align: center">Centered line</p>');
    expect(html).toContain('<p><br></p>');
    expect(html).toContain('<a href="https://example.com/" target="_blank" rel="noopener noreferrer">Example site</a>');
    expect(html).toContain('<p>这是第二段中文，包含标点！</p>');
  });

  it('renders legacy lists like modern ones', () => {
    expect(deltaToHtml({ ops: [{ insert: 'a' }, { attributes: { list: true }, insert: '\n' }, { insert: 'b' }, { attributes: { bullet: true }, insert: '\n' }] })).toBe(
      '<ol><li>a</li></ol><ul><li>b</li></ul>',
    );
  });

  it('keeps hostile content inert', () => {
    const html = deltaToHtml({
      ops: [
        { attributes: { link: 'javascript:alert(1)' }, insert: 'click' },
        { attributes: { link: ' JaVaScRiPt:alert(1)' }, insert: 'again' },
        { attributes: { link: 'data:text/html,<script>alert(1)</script>' }, insert: 'data' },
        { attributes: { link: 'https://ok.example/"onmouseover="alert(1)' }, insert: 'quoted' },
        { insert: '<script>alert(1)</script><img src=x onerror="alert(1)">\n' },
        { attributes: { align: '"><script>alert(1)</script>' }, insert: '\n' },
        { insert: { image: { url: 'https://evil.example/x.png', uid: 'e' } } },
        { insert: { image: { url: 'http://bucket.aliyuncs.com/x.png' } } },
        { insert: { image: { url: 'https://aliyuncs.com.evil.example/x.png' } } },
        { insert: { image: { url: 'javascript:alert(1)//.aliyuncs.com' } } },
        { insert: { image: { url: 'https://task.yungu.org/api/file/preview?previewId=1' } } },
        { insert: { video: { url: 'https://evil.example/v.mp4', previewImage: 'https://evil.example/p.png' } } },
        { insert: { file: { url: 'https://evil.example/f', name: '<b onmouseover=alert(1)>x</b>.pdf' } } },
        { insert: { audio: { url: 'https://evil.example/a.mp3' } } },
        { insert: { iframe: 'https://evil.example' } },
        { insert: '\n' },
      ],
    });
    expect(html).not.toMatch(/javascript:/i);
    expect(html).not.toMatch(/data:text/i);
    // Parsed as a browser would: only formatting elements, no event handlers, every link http(s).
    const parsed = document.createElement('template');
    parsed.innerHTML = html;
    const elements = [...parsed.content.querySelectorAll('*')];
    expect(new Set(elements.map((el) => el.tagName.toLowerCase()))).toEqual(new Set(['p', 'a', 'br']));
    for (const el of elements) {
      for (const attr of el.attributes) expect(attr.name).not.toMatch(/^on/i);
    }
    expect(elements.filter((el) => el.tagName === 'A').map((a) => a.getAttribute('href'))).toEqual(['https://ok.example/"onmouseover="alert(1)']);
    expect(html).not.toContain('evil.example');
    expect(html).not.toContain('task.yungu.org');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
    expect(html).toContain('click');
    expect(html).toContain('<a href="https://ok.example/&quot;onmouseover=&quot;alert(1)" target="_blank" rel="noopener noreferrer">quoted</a>');
    expect(html.match(/\[Image\]/g)).toHaveLength(5);
    expect(html).toContain('[Video]');
    expect(html).toContain('[File: &lt;b onmouseover=alert(1)&gt;x&lt;/b&gt;.pdf]');
    expect(html).toContain('[Audio]');
    expect(html).toContain('[Embedded content]');
  });

  it('plays video and audio stored on Yungu’s OSS host on request only, and links its files safely', () => {
    const html = deltaToHtml({
      ops: [
        { insert: { video: { url: 'https://yungu-task.oss-cn-hangzhou.aliyuncs.com/v.mp4', uid: 'v', previewImage: 'https://evil.example/p.png' } } },
        { insert: { audio: { url: 'https://yungu-task.oss-cn-hangzhou.aliyuncs.com/a.mp3', uid: 'a' } } },
        { insert: { file: { url: 'https://yungu-task.oss-cn-hangzhou.aliyuncs.com/f.pdf?x=1&y="2"', name: '报告 <b>"a"</b>.pdf', uid: 'f' } } },
        { insert: { file: { url: 'https://yungu-task.oss-cn-hangzhou.aliyuncs.com/g.pdf' } } },
        { insert: '\n' },
      ],
    });
    expect(html).toContain('<p><video controls preload="none" src="https://yungu-task.oss-cn-hangzhou.aliyuncs.com/v.mp4"></video></p>');
    expect(html).toContain('<p><audio controls preload="none" src="https://yungu-task.oss-cn-hangzhou.aliyuncs.com/a.mp3"></audio></p>');
    expect(html).toContain(
      '<p><a href="https://yungu-task.oss-cn-hangzhou.aliyuncs.com/f.pdf?x=1&amp;y=&quot;2&quot;" target="_blank" rel="noopener noreferrer">File: 报告 &lt;b&gt;&quot;a&quot;&lt;/b&gt;.pdf</a></p>',
    );
    expect(html).toContain('<a href="https://yungu-task.oss-cn-hangzhou.aliyuncs.com/g.pdf" target="_blank" rel="noopener noreferrer">File</a>');
    expect(html).not.toMatch(/autoplay|poster|evil\.example/);
  });

  it('keeps media from anywhere else, or not over https, a placeholder', () => {
    const html = deltaToHtml({
      ops: [
        { insert: { video: { url: 'http://bucket.aliyuncs.com/v.mp4' } } },
        { insert: { video: { url: 'https://bucket.aliyuncs.com.evil.example/v.mp4' } } },
        { insert: { audio: { url: 'javascript:alert(1)//.aliyuncs.com' } } },
        { insert: { audio: 'https://bucket.aliyuncs.com/a.mp3"onplay="alert(1)' } },
        { insert: { file: { url: 'https://task.yungu.org/api/files/1', name: 'x.pdf' } } },
        { insert: { file: { url: 'javascript:alert(1)', name: 'y.pdf' } } },
        { insert: '\n' },
      ],
    });
    const parsed = document.createElement('template');
    parsed.innerHTML = html;
    const tags = [...parsed.content.querySelectorAll('*')].map((el) => el.tagName.toLowerCase());
    expect(tags.filter((t) => t !== 'p' && t !== 'br')).toEqual(['audio']);
    // A bare-string audio value keeps its quotes escaped: no attribute escapes the src.
    const audio = parsed.content.querySelector('audio')!;
    expect([...audio.attributes].map((a) => a.name)).toEqual(['controls', 'preload', 'src']);
    expect(html).not.toMatch(/javascript:|task\.yungu\.org|evil\.example/);
    expect(html).toContain('[Video]');
    expect(html).toContain('[File: x.pdf]');
    expect(html).toContain('[File: y.pdf]');
  });

  it('opens mailto: links like the writer allows, and nothing else but http(s)', () => {
    const html = deltaToHtml({
      ops: [
        { attributes: { link: 'mailto:teacher@yungu.org' }, insert: 'mail' },
        { attributes: { link: 'mailto:"><script>alert(1)</script>' }, insert: 'odd' },
        { attributes: { link: 'tel:123' }, insert: 'tel' },
        { attributes: { link: 'ftp://x.example/f' }, insert: 'ftp' },
        { insert: '\n' },
      ],
    });
    expect(html).toContain('<a href="mailto:teacher@yungu.org" target="_blank" rel="noopener noreferrer">mail</a>');
    expect(html).toContain('href="mailto:&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;"');
    expect(html).not.toContain('tel:');
    expect(html).not.toContain('ftp:');
  });

  it('shows images stored on Yungu’s OSS host', () => {
    const html = deltaToHtml({ ops: [{ insert: OSS_IMAGE }, { insert: '\n' }] });
    expect(html).toContain('<img src="https://yungu-task.oss-cn-hangzhou.aliyuncs.com/a/b.png" alt="Image" referrerpolicy="no-referrer">');
  });
});

describe('parseDelta', () => {
  it('parses stored delta JSON', () => {
    expect(parseDelta(JSON.stringify(YUNGU_EXAMPLE))).toEqual(YUNGU_EXAMPLE);
    expect(parseDelta('{"ops":[{"insert":{"image":{"url":"u"}}},{"insert":"\\n"}]}')).toEqual({ ops: [{ insert: { image: { url: 'u' } } }, { insert: '\n' }] });
  });

  it('returns null for anything that is not a document delta', () => {
    for (const bad of ['not json', '', 'null', '[]', '{}', '{"ops":{}}', '{"ops":[1]}', '{"ops":[{"retain":3}]}', '{"ops":[{"insert":"a","attributes":[]}]}', '{"ops":[{"insert":null}]}']) {
      expect(parseDelta(bad)).toBeNull();
    }
  });
});
