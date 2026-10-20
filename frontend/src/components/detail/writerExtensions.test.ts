import { afterEach, describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import { deltaToDoc, docToDelta } from '@/lib/quill-delta';
import { WRITER_EXTENSIONS } from './writerExtensions';

let editor: Editor;
afterEach(() => editor?.destroy());

/** Types as the browser does: each character goes through the editor's text-input handlers (input rules). */
function type(text: string) {
  for (const ch of text) {
    const { view } = editor;
    const { from, to } = view.state.selection;
    const handled = view.someProp('handleTextInput', (f) => f(view, from, to, ch, () => view.state.tr.insertText(ch, from, to)));
    if (!handled) view.dispatch(view.state.tr.insertText(ch, from, to));
  }
}

function press(init: KeyboardEventInit) {
  const { view } = editor;
  return !!view.someProp('handleKeyDown', (f) => f(view, new KeyboardEvent('keydown', init)));
}

const saved = () => docToDelta(editor.getJSON()).delta;

describe('writer schema: kept but not offered', () => {
  it('typing "> " and "~~x~~" stays plain text (bold’s "**b**" still works)', () => {
    editor = new Editor({ extensions: WRITER_EXTENSIONS });
    editor.commands.focus('end');
    type('> quote');
    expect(saved()).toEqual({ ops: [{ insert: '> quote\n' }] });
    editor.commands.clearContent();
    type('~~x~~ and **b**');
    expect(saved()).toEqual({ ops: [{ insert: '~~x~~ and ' }, { attributes: { bold: true }, insert: 'b' }, { insert: '\n' }] });
  });

  it('no strike, quote or align shortcuts (Mod-B still bolds)', () => {
    editor = new Editor({ extensions: WRITER_EXTENSIONS });
    // Ctrl-Shift-B reaches bold's own "Mod-B" binding (StarterKit, unchanged), so look at what it made.
    for (const key of ['b', 'B', 's', 'S', 'x', 'X', 'e', 'E', 'r', 'R', 'j', 'J', 'l', 'L']) {
      editor.commands.setContent('<p>text</p>');
      editor.commands.selectAll();
      press({ key, ctrlKey: true, shiftKey: true });
      const attributes = saved().ops.flatMap((op) => Object.keys(op.attributes ?? {}));
      expect([key, attributes.filter((a) => a !== 'bold')]).toEqual([key, []]);
    }
    editor.commands.setContent('<p>text</p>');
    editor.commands.selectAll();
    expect(press({ key: 'b', ctrlKey: true })).toBe(true);
    expect(saved()).toEqual({ ops: [{ attributes: { bold: true }, insert: 'text' }, { insert: '\n' }] });
  });

  it('pasted strike-through, quotes and alignment are kept', () => {
    editor = new Editor({ extensions: WRITER_EXTENSIONS });
    editor.view.pasteHTML('<blockquote><p>q</p></blockquote><p style="text-align: center"><s>x</s><del>y</del><span style="text-decoration: line-through">z</span></p>', new Event('paste') as ClipboardEvent);
    expect(saved()).toEqual({
      ops: [
        { insert: 'q' },
        { attributes: { blockquote: true }, insert: '\n' },
        { attributes: { strike: true }, insert: 'xyz' },
        { attributes: { align: 'center' }, insert: '\n' },
      ],
    });
  });

  it('pasted data-quill-* attributes can’t write formats the writer owns', () => {
    editor = new Editor({ extensions: WRITER_EXTENSIONS });
    editor.view.pasteHTML(
      `<p><span data-quill-inline='{"link":"javascript:alert(1)","bold":false,"color":"\\"><script>alert(1)</script>"}'>click</span>` +
        `<span data-quill-inline='{"link":"https://evil.example","italic":true}'>only owned</span></p>` +
        `<p data-quill-block='{"list":"bullet","indent":1}'>para</p>` +
        `<p data-quill-block='{"header":1,"blockquote":true,"align":"center"}'>two</p>`,
      new Event('paste') as ClipboardEvent,
    );
    const { ops } = saved();
    expect(ops).toEqual([
      { attributes: { color: '"><script>alert(1)</script>' }, insert: 'click' },
      { insert: 'only owned\npara' },
      { attributes: { indent: 1 }, insert: '\n' },
      { insert: 'two\n' },
    ]);
    expect(editor.getJSON().content?.map((n) => n.type)).toEqual(['paragraph', 'paragraph', 'paragraph']);
  });

  it('a pasted embed is kept only as one of Yungu’s four kinds with an https address', () => {
    editor = new Editor({ extensions: WRITER_EXTENSIONS });
    const embed = (value: unknown, attributes?: unknown) =>
      `<div data-yungu-embed='${JSON.stringify(value)}'${attributes ? ` data-quill-attributes='${JSON.stringify(attributes)}'` : ''}>[x]</div>`;
    editor.view.pasteHTML(
      embed({ file: { url: 'javascript:alert(1)', name: 'a.pdf' } }) +
        embed({ image: { url: 'http://x.aliyuncs.com/i.png' } }) +
        embed({ image: 'data:image/svg+xml,<svg onload=alert(1)>' }) +
        embed({ video: { url: 'https://x.aliyuncs.com/v.mp4', previewImage: 'javascript:alert(1)' } }) +
        embed({ audio: { url: 'not a url' } }) +
        embed({ iframe: 'https://evil.example' }) +
        embed({ formula: 'e=mc^2' }) +
        embed({ image: { url: 'https://x.aliyuncs.com/i.png', uid: 'u' } }, { link: 'javascript:alert(1)', width: '50%' }) +
        embed({ file: { url: 'https://x.aliyuncs.com/f.pdf', name: 'f.pdf', uid: 'f' } }) +
        '<p>after</p>',
      new Event('paste') as ClipboardEvent,
    );
    expect(saved()).toEqual({
      ops: [
        { insert: { image: { url: 'https://x.aliyuncs.com/i.png', uid: 'u' } }, attributes: { width: '50%' } },
        { insert: { file: { url: 'https://x.aliyuncs.com/f.pdf', name: 'f.pdf', uid: 'f' } } },
        { insert: 'after\n' },
      ],
    });
  });

  it('embeds from an opened Yungu document are kept whatever they hold, also through the local draft', () => {
    const delta = {
      ops: [
        { insert: { formula: 'e=mc^2' } },
        { insert: { image: { url: 'http://old.example/i.png' } } },
        { insert: { file: { url: '/relative/f.pdf', name: 'f.pdf' } } },
        { insert: 'end\n' },
      ],
    };
    const first = new Editor({ extensions: WRITER_EXTENSIONS, content: deltaToDoc(delta) });
    expect(docToDelta(first.getJSON()).delta).toEqual(delta);
    editor = new Editor({ extensions: WRITER_EXTENSIONS, content: first.getHTML() });
    first.destroy();
    expect(saved()).toEqual(delta);
  });
});
