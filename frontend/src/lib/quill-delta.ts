/**
 * Yungu online documents are Quill 1.3.6 deltas. This converts them to and from the writer's TipTap JSON,
 * renders them as preview HTML and measures them the way Yungu stores them. Pure: no DOM, no editor.
 *
 * Quill's model: a document is a list of lines. Text inserts carry inline attributes (bold, italic,
 * underline, strike, link); each line ends with a "\n" whose attributes are the line's block format
 * (header 1|2, list ordered|bullet, blockquote, align). Yungu's image/video/file/audio are block embeds:
 * an object insert that is a line of its own, with no "\n" after it.
 *
 * Anything we don't edit (other attributes, other embeds) is carried through untouched: unknown line
 * attributes in the `quillBlock` attribute of the paragraph/heading, unknown inline attributes in a
 * `quillInline` mark, embeds as `yunguEmbed` atoms holding the original insert object.
 */
import type { JSONContent } from '@tiptap/core';

export type Attributes = Record<string, unknown>;
/** A document op: text, or an embed object such as `{ image: { url, uid } }`. */
export type DeltaOp = { insert: string | Record<string, unknown>; attributes?: Attributes };
export type Delta = { ops: DeltaOp[] };

export type EmbedKind = 'image' | 'video' | 'file' | 'audio' | 'other';

/** Node, mark and attribute names in the writer schema (see `writerExtensions.ts`). */
export const EMBED_NODE = 'yunguEmbed';
export const BLOCK_PASSTHROUGH = 'quillBlock';
export const INLINE_PASSTHROUGH = 'quillInline';

const EMBED_KINDS = ['image', 'video', 'file', 'audio'] as const;
const ALIGNMENTS = ['center', 'right', 'justify'];
/** Inline marks with a Quill attribute of the same name and the value `true`. */
const FLAG_MARKS = ['bold', 'italic', 'underline', 'strike'] as const;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isEmpty = (o: object) => Object.keys(o).length === 0;

function sameAttributes(a?: Attributes, b?: Attributes): boolean {
  return JSON.stringify(sortKeys(a ?? {})) === JSON.stringify(sortKeys(b ?? {}));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (!isObject(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((k) => [k, sortKeys(value[k])]));
}

/* ------------------------------------------------------------------------------------------------ */
/* Measuring and parsing                                                                             */
/* ------------------------------------------------------------------------------------------------ */

/** What Yungu stores and limits to 65 535: the UTF-8 length of the delta's JSON. */
export function deltaBytes(delta: Delta): number {
  return new TextEncoder().encode(JSON.stringify(delta)).length;
}

/** A stored delta JSON string, or null when it isn't a document delta (insert ops only). */
export function parseDelta(json: string): Delta | null {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    return null;
  }
  if (!isObject(value) || !Array.isArray(value.ops)) return null;
  for (const op of value.ops) {
    if (!isObject(op)) return null;
    if (op.attributes !== undefined && !isObject(op.attributes)) return null;
    const { insert } = op;
    // Quill 0.x embeds: `{ insert: 1, attributes: { image: url } }` (normalised later).
    const legacyEmbed = insert === 1 && isObject(op.attributes) && typeof op.attributes.image === 'string';
    if (typeof insert !== 'string' && !isObject(insert) && !legacyEmbed) return null;
  }
  return value as Delta;
}

/**
 * The canonical form two deltas are compared in: legacy forms made modern (`list: true` → ordered,
 * `bullet: true` → bullet, Quill 0.x `insert: 1` images → image embeds), empty inserts and non-insert ops
 * dropped, empty attribute objects removed, adjacent text inserts with equal attributes merged, and a
 * trailing empty line after a formatted last line dropped.
 */
export function normalizeDelta(delta: Delta): Delta {
  const ops: DeltaOp[] = [];
  for (const raw of delta.ops ?? []) {
    let op = raw as DeltaOp & { insert: unknown };
    if (!isObject(op)) continue;
    let attributes = isObject(op.attributes) ? { ...op.attributes } : undefined;
    let insert = op.insert as unknown;
    if (insert === 1 && attributes && typeof attributes.image === 'string') {
      insert = { image: { url: attributes.image } };
      delete attributes.image;
    }
    if (typeof insert !== 'string' && !isObject(insert)) continue;
    if (insert === '') continue;
    if (attributes) {
      if (attributes.bullet === true) {
        delete attributes.bullet;
        attributes.list = 'bullet';
      } else if (attributes.list === true) {
        attributes.list = 'ordered';
      }
      if (isEmpty(attributes)) attributes = undefined;
    }
    op = attributes ? { insert, attributes } : { insert };
    const last = ops[ops.length - 1];
    if (last && typeof last.insert === 'string' && typeof op.insert === 'string' && sameAttributes(last.attributes, op.attributes)) {
      ops[ops.length - 1] = { ...last, insert: last.insert + op.insert };
    } else {
      ops.push(op as DeltaOp);
    }
  }
  // A plain "\n" right after a formatted line's "\n" is the empty line an editor keeps after a list,
  // heading or quote at the end of a document (TipTap's trailing node; Quill doesn't need it): a no-op.
  const [prev, last] = ops.slice(-2);
  if (ops.length >= 2 && last.insert === '\n' && !last.attributes && prev.attributes && typeof prev.insert === 'string' && prev.insert.endsWith('\n')) {
    ops.pop();
  }
  return { ops };
}

/* ------------------------------------------------------------------------------------------------ */
/* Delta → lines (shared by the editor and the preview)                                              */
/* ------------------------------------------------------------------------------------------------ */

type Segment = { text: string; attributes?: Attributes };
type BlockKind =
  | { type: 'paragraph' }
  | { type: 'heading'; level: 1 | 2 }
  | { type: 'list'; list: 'ordered' | 'bullet' }
  | { type: 'quote'; level?: 1 | 2 };
type TextLine = { kind: 'text'; segments: Segment[]; block: BlockKind; align: string | null; rest: Attributes | null };
type EmbedLine = { kind: 'embed'; value: Record<string, unknown>; attributes: Attributes | null };
type Line = TextLine | EmbedLine;

/** A line's "\n" attributes → what we edit (block kind, align) and what we only carry (`rest`). */
function classify(attrs: Attributes): Pick<TextLine, 'block' | 'align' | 'rest'> {
  const rest = { ...attrs };
  let block: BlockKind = { type: 'paragraph' };
  const header = attrs.header === 1 || attrs.header === 2 ? attrs.header : undefined;
  if (attrs.list === 'ordered' || attrs.list === 'bullet') {
    block = { type: 'list', list: attrs.list };
    delete rest.list;
  } else if (attrs.blockquote === true) {
    block = { type: 'quote', level: header };
    delete rest.blockquote;
    if (header) delete rest.header;
  } else if (header) {
    block = { type: 'heading', level: header };
    delete rest.header;
  }
  let align: string | null = null;
  if (typeof attrs.align === 'string' && ALIGNMENTS.includes(attrs.align)) {
    align = attrs.align;
    delete rest.align;
  }
  return { block, align, rest: isEmpty(rest) ? null : rest };
}

function toLines(delta: Delta): Line[] {
  const lines: Line[] = [];
  let segments: Segment[] = [];
  const endLine = (attrs: Attributes) => {
    lines.push({ kind: 'text', segments, ...classify(attrs) });
    segments = [];
  };
  for (const op of normalizeDelta(delta).ops) {
    if (typeof op.insert === 'string') {
      const parts = op.insert.split('\n');
      parts.forEach((part, i) => {
        if (part) segments.push(op.attributes ? { text: part, attributes: op.attributes } : { text: part });
        if (i < parts.length - 1) endLine(op.attributes ?? {});
      });
    } else {
      // A block embed is a line of its own; text before it without a "\n" (not valid Quill) ends a line.
      if (segments.length) endLine({});
      lines.push({ kind: 'embed', value: op.insert, attributes: op.attributes ?? null });
    }
  }
  if (segments.length) endLine({});
  return lines;
}

export function embedKind(value: unknown): EmbedKind {
  const key = isObject(value) ? Object.keys(value)[0] : undefined;
  return (EMBED_KINDS as readonly string[]).includes(key ?? '') ? (key as EmbedKind) : 'other';
}

/** How an embed is named where it can't be shown: "Image", "Video", "File: 报告.pdf", "Audio". */
export function embedLabel(value: unknown): string {
  const kind = embedKind(value);
  if (kind === 'file') {
    const file = (value as Record<string, unknown>).file;
    const name = isObject(file) && typeof file.name === 'string' ? file.name.trim() : '';
    return name ? `File: ${name}` : 'File';
  }
  return { image: 'Image', video: 'Video', audio: 'Audio', other: 'Embedded content' }[kind];
}

/* ------------------------------------------------------------------------------------------------ */
/* Delta → TipTap                                                                                    */
/* ------------------------------------------------------------------------------------------------ */

function marksOf(attributes?: Attributes): JSONContent['marks'] {
  if (!attributes) return undefined;
  const rest = { ...attributes };
  const marks: NonNullable<JSONContent['marks']> = [];
  for (const name of FLAG_MARKS) {
    if (rest[name] === true) {
      marks.push({ type: name });
      delete rest[name];
    }
  }
  if (typeof rest.link === 'string') {
    marks.push({ type: 'link', attrs: { href: rest.link } });
    delete rest.link;
  }
  if (!isEmpty(rest)) marks.push({ type: INLINE_PASSTHROUGH, attrs: { attributes: rest } });
  return marks.length ? marks : undefined;
}

function textblock(line: TextLine, type: 'paragraph' | 'heading', level?: 1 | 2): JSONContent {
  const attrs: Record<string, unknown> = {};
  if (type === 'heading') attrs.level = level;
  if (line.align) attrs.textAlign = line.align;
  if (line.rest) attrs[BLOCK_PASSTHROUGH] = line.rest;
  const content = line.segments.map((s): JSONContent => {
    const marks = marksOf(s.attributes);
    return marks ? { type: 'text', text: s.text, marks } : { type: 'text', text: s.text };
  });
  return { type, ...(isEmpty(attrs) ? {} : { attrs }), ...(content.length ? { content } : {}) };
}

/** A Yungu delta as the writer's TipTap document. Consecutive list (or quote) lines share one list (quote). */
export function deltaToDoc(delta: Delta): JSONContent {
  const content: JSONContent[] = [];
  for (const line of toLines(delta)) {
    const last = content[content.length - 1];
    if (line.kind === 'embed') {
      content.push({ type: EMBED_NODE, attrs: { kind: embedKind(line.value), value: line.value, attributes: line.attributes } });
      continue;
    }
    const { block } = line;
    if (block.type === 'list') {
      const type = block.list === 'ordered' ? 'orderedList' : 'bulletList';
      const item: JSONContent = { type: 'listItem', content: [textblock(line, 'paragraph')] };
      if (last?.type === type) last.content!.push(item);
      else content.push({ type, content: [item] });
    } else if (block.type === 'quote') {
      const inner = block.level ? textblock(line, 'heading', block.level) : textblock(line, 'paragraph');
      if (last?.type === 'blockquote') last.content!.push(inner);
      else content.push({ type: 'blockquote', content: [inner] });
    } else if (block.type === 'heading') {
      content.push(textblock(line, 'heading', block.level));
    } else {
      content.push(textblock(line, 'paragraph'));
    }
  }
  if (!content.length) content.push({ type: 'paragraph' });
  return { type: 'doc', content };
}

/* ------------------------------------------------------------------------------------------------ */
/* TipTap → delta                                                                                    */
/* ------------------------------------------------------------------------------------------------ */

type Context = { list?: 'ordered' | 'bullet'; quote?: boolean; depth: number };

/**
 * The writer's TipTap document as a Yungu delta. `flattened` is true when something Quill can't hold had
 * to be flattened: a line break inside a block (each becomes a new line of the same block), a list inside
 * a list item (its items become lines of their own list, one level up), a list item's second block, or a
 * list inside a quote (the list wins).
 */
export function docToDelta(doc: JSONContent): { delta: Delta; flattened: boolean } {
  const ops: DeltaOp[] = [];
  let flattened = false;
  const push = (insert: DeltaOp['insert'], attributes?: Attributes | null) =>
    ops.push(attributes && !isEmpty(attributes) ? { insert, attributes } : { insert });

  function lineAttributes(node: JSONContent, ctx: Context): Attributes {
    const passthrough = node.attrs?.[BLOCK_PASSTHROUGH];
    const attrs: Attributes = isObject(passthrough) ? { ...passthrough } : {};
    if (node.type === 'heading' && (node.attrs?.level === 1 || node.attrs?.level === 2)) attrs.header = node.attrs.level;
    if (ctx.list) attrs.list = ctx.list;
    else if (ctx.quote) attrs.blockquote = true;
    const align = node.attrs?.textAlign;
    if (typeof align === 'string' && ALIGNMENTS.includes(align)) attrs.align = align;
    return attrs;
  }

  function inlineAttributes(marks: JSONContent['marks']): Attributes | undefined {
    const attrs: Attributes = {};
    for (const mark of marks ?? []) {
      if (mark.type === INLINE_PASSTHROUGH && isObject(mark.attrs?.attributes)) Object.assign(attrs, mark.attrs.attributes);
    }
    for (const mark of marks ?? []) {
      if ((FLAG_MARKS as readonly string[]).includes(mark.type)) attrs[mark.type] = true;
      else if (mark.type === 'link' && typeof mark.attrs?.href === 'string') attrs.link = mark.attrs.href;
    }
    return attrs;
  }

  function line(node: JSONContent, ctx: Context) {
    const attrs = lineAttributes(node, ctx);
    for (const child of node.content ?? []) {
      if (child.type === 'text' && child.text) push(child.text, inlineAttributes(child.marks));
      else if (child.type === 'hardBreak') {
        flattened = true;
        push('\n', attrs);
      }
    }
    push('\n', attrs);
  }

  function blocks(nodes: JSONContent[] | undefined, ctx: Context) {
    for (const node of nodes ?? []) {
      switch (node.type) {
        case 'paragraph':
        case 'heading':
          line(node, ctx);
          break;
        case 'bulletList':
        case 'orderedList': {
          if (ctx.depth > 0 || ctx.quote) flattened = true;
          const list = node.type === 'orderedList' ? 'ordered' : 'bullet';
          for (const item of node.content ?? []) {
            (item.content ?? []).forEach((child, i) => {
              const isList = child.type === 'bulletList' || child.type === 'orderedList';
              if (i > 0 && !isList) flattened = true;
              blocks([child], { list: isList ? undefined : list, depth: ctx.depth + 1 });
            });
          }
          break;
        }
        case 'blockquote':
          if (ctx.list) flattened = true;
          blocks(node.content, { ...ctx, quote: !ctx.list });
          break;
        case EMBED_NODE:
          if (isObject(node.attrs?.value)) push(node.attrs.value, isObject(node.attrs?.attributes) ? node.attrs.attributes : null);
          break;
        default:
          blocks(node.content, ctx);
      }
    }
  }

  // The empty paragraph the editor keeps after a final list, heading, quote or embed isn't the writer's.
  const top = doc.content ?? [];
  const end = top[top.length - 1];
  const trailing =
    top.length > 1 && end.type === 'paragraph' && !end.content?.length && !end.attrs?.textAlign && !end.attrs?.[BLOCK_PASSTHROUGH] && top[top.length - 2].type !== 'paragraph';
  blocks(trailing ? top.slice(0, -1) : top, { depth: 0 });
  // Quill documents always end with a newline.
  const last = ops[ops.length - 1];
  if (!last || typeof last.insert !== 'string' || !last.insert.endsWith('\n')) push('\n');
  return { delta: normalizeDelta({ ops }), flattened };
}

/* ------------------------------------------------------------------------------------------------ */
/* Delta → preview HTML                                                                              */
/* ------------------------------------------------------------------------------------------------ */

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/** Only absolute http(s) addresses become links. */
function safeHref(href: unknown): string | null {
  if (typeof href !== 'string' || !/^https?:\/\//i.test(href)) return null;
  try {
    const url = new URL(href);
    return url.protocol === 'http:' || url.protocol === 'https:' ? href : null;
  } catch {
    return null;
  }
}

/** Media load directly only from Yungu's OSS storage over https. */
function ossUrl(url: unknown): string | null {
  if (typeof url !== 'string') return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && parsed.hostname.endsWith('.aliyuncs.com') ? url : null;
  } catch {
    return null;
  }
}

function inlineHtml(segment: Segment): string {
  const a = segment.attributes ?? {};
  let html = escapeHtml(segment.text);
  if (a.underline === true) html = `<u>${html}</u>`;
  if (a.strike === true) html = `<s>${html}</s>`;
  if (a.italic === true) html = `<em>${html}</em>`;
  if (a.bold === true) html = `<strong>${html}</strong>`;
  const href = safeHref(a.link);
  if (href) html = `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${html}</a>`;
  return html;
}

function embedHtml(value: Record<string, unknown>): string {
  if (embedKind(value) === 'image') {
    const image = value.image;
    const src = ossUrl(isObject(image) ? image.url : image);
    if (src) return `<p><img src="${escapeHtml(src)}" alt="Image" referrerpolicy="no-referrer"></p>`;
  }
  return `<p class="yungu-embed">[${escapeHtml(embedLabel(value))}]</p>`;
}

/**
 * Preview HTML in the structure of Yungu's own viewer: h1/h2/p, strong/em/u/s, ul/ol>li, blockquote,
 * alignment as an inline `text-align`. All text is escaped; links are http(s) only and open in a new tab;
 * images show only from Yungu's OSS host (no referrer sent), every other embed is a labelled placeholder. Safe to inject.
 */
export function deltaToHtml(delta: Delta): string {
  let html = '';
  let openList: 'ol' | 'ul' | null = null;
  const closeList = () => {
    if (openList) html += `</${openList}>`;
    openList = null;
  };
  for (const line of toLines(delta)) {
    if (line.kind === 'embed') {
      closeList();
      html += embedHtml(line.value);
      continue;
    }
    const inner = line.segments.map(inlineHtml).join('') || '<br>';
    const style = line.align ? ` style="text-align: ${line.align}"` : '';
    const { block } = line;
    if (block.type === 'list') {
      const tag = block.list === 'ordered' ? 'ol' : 'ul';
      if (openList !== tag) {
        closeList();
        html += `<${tag}>`;
        openList = tag;
      }
      html += `<li${style}>${inner}</li>`;
      continue;
    }
    closeList();
    if (block.type === 'heading') html += `<h${block.level}${style}>${inner}</h${block.level}>`;
    else if (block.type === 'quote') html += `<blockquote${style}>${block.level ? `<h${block.level}>${inner}</h${block.level}>` : inner}</blockquote>`;
    else html += `<p${style}>${inner}</p>`;
  }
  closeList();
  return html;
}
