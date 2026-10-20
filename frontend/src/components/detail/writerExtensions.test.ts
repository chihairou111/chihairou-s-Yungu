import { afterEach, describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import { docToDelta } from '@/lib/quill-delta';
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
});
