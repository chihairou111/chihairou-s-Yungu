import { Extension, Mark, Node } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import LinkMark from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import TextAlign from '@tiptap/extension-text-align';
import { BLOCK_PASSTHROUGH, EMBED_NODE, INLINE_PASSTHROUGH, embedLabel } from '@/lib/quill-delta';

/**
 * A Yungu image, video, file or audio embed, kept exactly as Yungu stored it (`value` is the original
 * insert object, e.g. `{ image: { url, uid } }`). Shown as a non-editable labelled block; it can be moved
 * or deleted but not edited, and is never created from pasted HTML.
 */
const YunguEmbed = Node.create({
  name: EMBED_NODE,
  group: 'block',
  atom: true,
  selectable: true,
  draggable: false,
  addAttributes() {
    return {
      kind: { default: 'other', rendered: false },
      value: { default: null, rendered: false },
      /** The embed op's own attributes, if it had any. */
      attributes: { default: null, rendered: false },
    };
  },
  parseHTML() {
    return [];
  },
  renderHTML({ node }) {
    return ['div', { class: 'yungu-embed', 'data-yungu-embed': node.attrs.kind, contenteditable: 'false' }, `[${embedLabel(node.attrs.value)}]`];
  },
});

/** Quill line attributes the writer doesn't edit (indent, other header levels, …), carried on the line. */
const QuillBlockPassthrough = Extension.create({
  name: 'quillBlockPassthrough',
  addGlobalAttributes() {
    return [{ types: ['paragraph', 'heading'], attributes: { [BLOCK_PASSTHROUGH]: { default: null, rendered: false } } }];
  },
});

/** Quill inline attributes the writer doesn't edit (color, script, …), carried on the text. */
const QuillInlinePassthrough = Mark.create({
  name: INLINE_PASSTHROUGH,
  addAttributes() {
    return { attributes: { default: null, rendered: false } };
  },
  parseHTML() {
    return [];
  },
  renderHTML() {
    return ['span', 0];
  },
});

/**
 * The toolbar offers paragraphs, line breaks, bold, italic, underline, two heading levels, both lists and
 * links. The schema also keeps what Yungu's own editor makes — strike-through, quotes, alignment and its
 * embeds — so a Yungu document opened here and saved comes back unchanged (see `lib/quill-delta.ts`).
 * Code, rules and other headings still fall back to plain text.
 */
export const WRITER_EXTENSIONS = [
  StarterKit.configure({
    heading: { levels: [1, 2] },
    code: false,
    codeBlock: false,
    horizontalRule: false,
    underline: false,
    link: false,
  }),
  Underline,
  // Not inclusive (Link makes it so whenever autolink is on): text typed at a link's end stays outside it.
  LinkMark.extend({ inclusive: () => false }).configure({
    openOnClick: false,
    defaultProtocol: 'https',
    HTMLAttributes: { target: null, rel: null, class: null },
    isAllowedUri: (url, ctx) => ctx.defaultValidate(url) && /^(https?:|mailto:)/i.test(url),
  }),
  // Kept, not offered: no shortcuts (Mod-Shift-L/E/R/J would also take browser shortcuts away).
  TextAlign.extend({ addKeyboardShortcuts: () => ({}) }).configure({
    types: ['heading', 'paragraph'],
    alignments: ['left', 'center', 'right', 'justify'],
  }),
  YunguEmbed,
  QuillBlockPassthrough,
  QuillInlinePassthrough,
  Placeholder.configure({ placeholder: 'Start writing…' }),
];
