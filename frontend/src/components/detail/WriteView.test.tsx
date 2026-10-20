import { render, screen, waitFor, within } from '../test-render';
import userEvent from '@testing-library/user-event';
import { Editor } from '@tiptap/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AssignmentDetail, FileRef } from '@/lib/types';
import { HOUR, NOW, todo } from '../test-fixtures';
import { ApiError } from './api';
import { shortcutLabel } from './EditorToolbar';
import WriteView from './WriteView';
import { WRITER_EXTENSIONS } from './writerExtensions';

const api = vi.hoisted(() => ({ renderPdf: vi.fn() }));
vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./api')>()),
  renderPdf: api.renderPdf,
}));

const work = vi.hoisted(() => ({ add: vi.fn() }));
vi.mock('./WorkContext', () => ({ useWorkContext: () => work }));

const PDF: FileRef = {
  id: 'f1',
  name: '观察记录.pdf',
  kind: 'pdf',
  mime: 'application/pdf',
  size: 30_000,
  url: '/api/files/f1',
  createdAt: NOW,
};

function detail(): AssignmentDetail {
  return {
    ...todo('Task 3：开始第一次观察', 5 * HOUR, { id: 94616 }),
    teacher: 'Daniel Moore',
    instructionsHtml: '',
    attachments: [],
    myFiles: [],
    submittedFileIds: [],
    submitted: false,
    needsFiles: true,
    comments: [],
  };
}

const onBack = vi.fn();
const onDone = vi.fn();

function open() {
  return render(<WriteView detail={detail()} titleId="t" onBack={onBack} onDone={onDone} />);
}

/** The Tiptap document, once the client-only editor has mounted. */
async function editor(): Promise<HTMLElement> {
  return screen.findByRole('textbox', { name: 'Your writing' });
}

const DRAFT = 'yl_write_draft_94616';

// ProseMirror measures the caret to scroll it into view; jsdom has no layout, so give it empty boxes.
beforeAll(() => {
  const rect = () => new DOMRect(0, 0, 0, 0);
  const rects = () => Object.assign([], { item: () => null }) as unknown as DOMRectList;
  for (const proto of [Range.prototype, Element.prototype]) {
    Object.assign(proto, { getClientRects: rects, getBoundingClientRect: rect });
  }
  document.elementFromPoint = () => null;
});

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  work.add.mockResolvedValue(true);
});

describe('WriteView', () => {
  it('has exactly the ten formatting controls, in order', async () => {
    open();
    await editor();
    const toolbar = screen.getByRole('toolbar', { name: 'Formatting' });
    expect(within(toolbar).getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual([
      'Bold',
      'Italic',
      'Underline',
      'Heading 1',
      'Heading 2',
      'Bulleted list',
      'Numbered list',
      'Link',
      'Undo',
      'Redo',
    ]);
  });

  it('is one tab stop; arrow keys move along it and skip what is unavailable', async () => {
    open();
    await editor();
    const bold = screen.getByRole('button', { name: 'Bold' });
    expect(bold).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('button', { name: 'Italic' })).toHaveAttribute('tabindex', '-1');
    bold.focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(screen.getByRole('button', { name: 'Italic' })).toHaveFocus();
    // Nothing to undo or redo yet: End lands on Link.
    await userEvent.keyboard('{End}');
    expect(screen.getByRole('button', { name: 'Link' })).toHaveFocus();
    await userEvent.keyboard('{ArrowRight}');
    expect(bold).toHaveFocus();
  });

  it('shows the pressed state of a mark and writes it as <strong>', async () => {
    open();
    const doc = await editor();
    const bold = screen.getByRole('button', { name: 'Bold' });
    expect(bold).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(doc);
    await userEvent.click(bold);
    expect(bold).toHaveAttribute('aria-pressed', 'true');
    await userEvent.type(doc, 'loud');
    expect(doc.innerHTML).toContain('<strong>loud</strong>');
  });

  it('saves what is typed as the draft and restores it on reopen', async () => {
    const view = open();
    await userEvent.type(await editor(), '城中村 field notes');
    expect(await screen.findByText('Draft saved', {}, { timeout: 2000 })).toBeInTheDocument();
    expect(localStorage.getItem(DRAFT)).toContain('城中村 field notes');
    view.unmount();
    open();
    expect((await editor()).textContent).toBe('城中村 field notes');
  });

  it('keeps an edited title with the draft and restores it', async () => {
    const view = open();
    await editor();
    const title = screen.getByRole('textbox', { name: 'Title' });
    await userEvent.clear(title);
    await userEvent.type(title, '观察记录');
    view.unmount();
    open();
    expect(screen.getByRole('textbox', { name: 'Title' })).toHaveValue('观察记录');
  });

  it('shows the save state as words, announced politely', async () => {
    open();
    await userEvent.type(await editor(), 'x');
    expect(screen.getByRole('status')).toHaveTextContent('Saving…');
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Draft saved'));
  });

  it('writes shortcuts the way each platform does', () => {
    expect(shortcutLabel({ key: 'B' }, true)).toBe('⌘B');
    expect(shortcutLabel({ key: '1', alt: true }, true)).toBe('⌥⌘1');
    expect(shortcutLabel({ key: 'Z', shift: true }, true)).toBe('⇧⌘Z');
    expect(shortcutLabel({ key: 'B' }, false)).toBe('Ctrl+B');
    expect(shortcutLabel({ key: '1', alt: true }, false)).toBe('Ctrl+Alt+1');
    expect(shortcutLabel({ key: 'Z', shift: true }, false)).toBe('Ctrl+Shift+Z');
  });

  it('refuses to export an empty document without calling the server', async () => {
    open();
    await editor();
    await userEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(await screen.findByText('Nothing to export yet.')).toBeInTheDocument();
    expect(api.renderPdf).not.toHaveBeenCalled();
  });

  it('exports to PDF, adds it to Your work, clears the draft and reports back', async () => {
    api.renderPdf.mockResolvedValue(PDF);
    // The dialog swaps the writer out a moment later (a history step); nothing may write the draft back meanwhile.
    const view = open();
    let left = false;
    onDone.mockImplementation(() =>
      setTimeout(() => {
        view.unmount();
        left = true;
      }, 0),
    );
    const title = screen.getByRole('textbox', { name: 'Title' });
    expect(title).toHaveValue('Task 3：开始第一次观察');
    await userEvent.clear(title);
    await userEvent.type(title, '观察记录');
    await userEvent.type(await editor(), 'Hello');
    await userEvent.click(screen.getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(onDone).toHaveBeenCalledWith(PDF));
    expect(api.renderPdf).toHaveBeenCalledWith('观察记录', '<p>Hello</p>', expect.any(AbortSignal));
    expect(work.add).toHaveBeenCalledWith(PDF);
    await waitFor(() => expect(left).toBe(true));
    expect(localStorage.getItem(DRAFT)).toBeNull();
    expect(localStorage.getItem(`${DRAFT}_title`)).toBeNull();
  });

  it('keeps the draft and says why when the PDF fails', async () => {
    api.renderPdf.mockRejectedValue(new ApiError(500, 'Could not create the PDF. Try again.'));
    open();
    await userEvent.type(await editor(), 'Hello');
    await userEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(await screen.findByText('Could not create the PDF. Try again.')).toBeInTheDocument();
    expect(onDone).not.toHaveBeenCalled();
    expect((await editor()).textContent).toBe('Hello');
    await waitFor(() => expect(localStorage.getItem(DRAFT)).toBe('<p>Hello</p>'));
  });

  it('keeps the draft when going back, even right after typing', async () => {
    // The dialog swaps the writer out as soon as ← is pressed.
    const view = open();
    onBack.mockImplementation(() => view.unmount());
    await userEvent.type(await editor(), 'Half done');
    await userEvent.click(screen.getByRole('button', { name: 'Back to assignment' }));
    expect(onBack).toHaveBeenCalled();
    expect(localStorage.getItem(DRAFT)).toBe('<p>Half done</p>');
  });

  it('inserts a link at the caret and keeps what is typed next outside it', async () => {
    open();
    const doc = await editor();
    await userEvent.type(doc, 'See ');
    await userEvent.click(screen.getByRole('button', { name: 'Link' }));
    await userEvent.type(await screen.findByRole('textbox', { name: 'Link address' }), 'https://example.com{Enter}');
    await waitFor(() => expect(doc).toHaveFocus());
    await userEvent.keyboard(' more');
    expect(doc.innerHTML).toContain('<a href="https://example.com">https://example.com</a> more');
  });

  it('adds a link through the link dialog and refuses unsafe addresses', async () => {
    open();
    const doc = await editor();
    await userEvent.type(doc, 'site');
    await userEvent.click(screen.getByRole('button', { name: 'Link' }));
    const address = await screen.findByRole('textbox', { name: 'Link address' });
    await userEvent.type(address, 'javascript:alert(1){Enter}');
    expect(await screen.findByText(/Use a web address/)).toBeInTheDocument();
    await userEvent.clear(address);
    await userEvent.type(address, 'example.com{Enter}');
    await waitFor(() => expect(doc.innerHTML).toContain('<a href="https://example.com">https://example.com</a>'));
  });
});

describe('editor schema', () => {
  it('makes links non-inclusive, so typing at a link’s end never extends it', () => {
    const e = new Editor({ extensions: WRITER_EXTENSIONS });
    expect(e.schema.marks.link.spec.inclusive).toBe(false);
    e.destroy();
  });
});
