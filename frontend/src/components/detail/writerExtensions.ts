import { Extension, Mark, Node } from '@tiptap/core';
import { Fragment, Slice, type Node as PMNode } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import LinkMark from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import TextAlign from '@tiptap/extension-text-align';
import {
  BLOCK_PASSTHROUGH,
  DROPPED_FORMAT,
  EMBED_NODE,
  INLINE_PASSTHROUGH,
  OWNED_INLINE_ATTRIBUTES,
  OWNED_LINE_ATTRIBUTES,
  embedKind,
  embedLabel,
  passthroughOf,
  pastedEmbed,
} from '@/lib/quill-delta';

/** A JSON object stored in a data attribute, or null if it is missing or isn't one. */
function jsonObject(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const jsonAttribute = (value: unknown) => (value == null ? null : JSON.stringify(value));

/**
 * A Yungu image, video, file or audio embed, kept exactly as Yungu stored it (`value` is the original
 * insert object, e.g. `{ image: { url, uid } }`). Shown as a non-editable labelled block that can be moved
 * or deleted but not edited. Its data rides in `data-*` attributes, so it survives the writer's HTML draft
 * and copy/paste; HTML without a valid `data-yungu-embed` value is never turned into one, and a pasted (or
 * dropped) one is kept only when `pastedEmbed` accepts it — Yungu's viewer shows it to the teacher.
 */
const YunguEmbed = Node.create({
  name: EMBED_NODE,
  group: 'block',
  atom: true,
  selectable: true,
  draggable: false,
  addAttributes() {
    return {
      kind: { default: 'other', rendered: false, parseHTML: (el) => embedKind(jsonObject(el.getAttribute('data-yungu-embed'))) },
      value: {
        default: null,
        parseHTML: (el) => jsonObject(el.getAttribute('data-yungu-embed')),
        renderHTML: (attrs) => ({ 'data-yungu-embed': jsonAttribute(attrs.value) }),
      },
      /** The embed op's own attributes, if it had any. */
      attributes: {
        default: null,
        parseHTML: (el) => jsonObject(el.getAttribute('data-quill-attributes')),
        renderHTML: (attrs) => ({ 'data-quill-attributes': jsonAttribute(attrs.attributes) }),
      },
    };
  },
  parseHTML() {
    return [{ tag: 'div[data-yungu-embed]', getAttrs: (el) => (jsonObject(el.getAttribute('data-yungu-embed')) ? null : false) }];
  },
  renderHTML({ node, HTMLAttributes }) {
    return ['div', { ...HTMLAttributes, class: 'yungu-embed', contenteditable: 'false' }, `[${embedLabel(node.attrs.value)}]`];
  },
  addProseMirrorPlugins() {
    return [new Plugin({ key: new PluginKey('yunguEmbedPaste'), props: { transformPasted: (slice) => checkedSlice(slice) } })];
  },
});

/** The pasted content with every embed `pastedEmbed` refuses left out, and the others' attributes checked. */
function checkedFragment(fragment: Fragment): Fragment {
  const nodes: PMNode[] = [];
  fragment.forEach((node) => {
    if (node.type.name === EMBED_NODE) {
      const kept = pastedEmbed(node.attrs.value, node.attrs.attributes);
      if (kept) nodes.push(node.type.create({ ...node.attrs, value: kept.value, attributes: kept.attributes }));
    } else {
      nodes.push(node.isLeaf ? node : node.copy(checkedFragment(node.content)));
    }
  });
  return Fragment.fromArray(nodes);
}

const checkedSlice = (slice: Slice) => new Slice(checkedFragment(slice.content), slice.openStart, slice.openEnd);

/** Quill line attributes the writer doesn't edit (indent, other header levels, …), carried on the line. */
const QuillBlockPassthrough = Extension.create({
  name: 'quillBlockPassthrough',
  addGlobalAttributes() {
    return [
      {
        types: ['paragraph', 'heading'],
        attributes: {
          [BLOCK_PASSTHROUGH]: {
            default: null,
            // Pasted HTML can't make a line a list, heading, quote or aligned behind the writer's back.
            parseHTML: (el) => passthroughOf(jsonObject(el.getAttribute('data-quill-block')), OWNED_LINE_ATTRIBUTES),
            renderHTML: (attrs) => ({ 'data-quill-block': jsonAttribute(attrs[BLOCK_PASSTHROUGH]) }),
          },
          // A Yungu heading level or list kind shown as a plain line (see DROPPED_FORMAT). Pasted, it can
          // only bring the warning; a line split off it is a new plain line.
          [DROPPED_FORMAT]: {
            default: null,
            keepOnSplit: false,
            parseHTML: (el) => (el.getAttribute('data-quill-dropped') === 'true' ? true : null),
            renderHTML: (attrs) => (attrs[DROPPED_FORMAT] ? { 'data-quill-dropped': 'true' } : {}),
          },
        },
      },
    ];
  },
});

/** Pasted HTML can't set bold, italic, underline, strike or a link (which would skip the address check). */
const inlinePassthrough = (el: HTMLElement) => passthroughOf(jsonObject(el.getAttribute('data-quill-inline')), OWNED_INLINE_ATTRIBUTES);

/** Quill inline attributes the writer doesn't edit (color, script, …), carried on the text. */
const QuillInlinePassthrough = Mark.create({
  name: INLINE_PASSTHROUGH,
  addAttributes() {
    return {
      attributes: {
        default: null,
        parseHTML: (el) => inlinePassthrough(el),
        renderHTML: (attrs) => ({ 'data-quill-inline': jsonAttribute(attrs.attributes) }),
      },
    };
  },
  parseHTML() {
    return [{ tag: 'span[data-quill-inline]', getAttrs: (el) => (inlinePassthrough(el) ? null : false) }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['span', HTMLAttributes, 0];
  },
});

/**
 * Strike-through and quotes as Yungu's editor makes them: kept when opened or pasted, but with no input
 * rules (`~~x~~`, `> `) or shortcuts, since the toolbar doesn't offer them.
 */
const Strike = Mark.create({
  name: 'strike',
  parseHTML() {
    return [
      { tag: 's' },
      { tag: 'del' },
      { tag: 'strike' },
      { style: 'text-decoration', consuming: false, getAttrs: (style) => (style.includes('line-through') ? {} : false) },
    ];
  },
  renderHTML({ HTMLAttributes }) {
    return ['s', HTMLAttributes, 0];
  },
});

const Blockquote = Node.create({
  name: 'blockquote',
  content: 'block+',
  group: 'block',
  defining: true,
  parseHTML() {
    return [{ tag: 'blockquote' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['blockquote', HTMLAttributes, 0];
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
    blockquote: false,
    strike: false,
    code: false,
    codeBlock: false,
    horizontalRule: false,
    underline: false,
    link: false,
  }),
  Underline,
  Strike,
  Blockquote,
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
