import { render, screen, waitFor, within } from '../test-render';
import userEvent from '@testing-library/user-event';
import { Editor } from '@tiptap/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AssignmentDetail, FileRef } from '@/lib/types';
import { HOUR, NOW, todo } from '../test-fixtures';
import { docTooLongMessage, ONLINE_DOC_MAX_BYTES } from '@/lib/limits';
import { ApiError } from './api';
import { shortcutLabel } from './EditorToolbar';
import WriteView from './WriteView';
import { WRITER_EXTENSIONS } from './writerExtensions';

const api = vi.hoisted(() => ({ createOnlineDoc: vi.fn(), updateOnlineDoc: vi.fn() }));
vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./api')>()),
  createOnlineDoc: api.createOnlineDoc,
  updateOnlineDoc: api.updateOnlineDoc,
}));

const work = vi.hoisted(() => ({
  add: vi.fn(),
  replace: vi.fn(),
  files: [] as FileRef[],
  submittedFileIds: [] as string[],
  submitting: false,
}));
vi.mock('./WorkContext', () => ({ useWorkContext: () => work }));

const delta = (...lines: string[]) => JSON.stringify({ ops: [{ insert: `${lines.join('\n')}\n` }] });

/** An online document as Yungu hands it back. */
function onlineDoc(id: string, name: string, content: string): FileRef {
  return { id, name, kind: 'other', mime: 'application/octet-stream', size: 0, url: `/api/files/${id}`, online: true, content, createdAt: NOW };
}

const SAVED = onlineDoc('doc-new', '观察记录', delta('Hello'));
const EXISTING = onlineDoc('doc-1', '课堂反思', delta('第一段'));

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

function open(docId: string | null = null) {
  return render(<WriteView detail={detail()} titleId="t" docId={docId} onBack={onBack} onDone={onDone} />);
}

const saveButton = () => screen.getByRole('button', { name: 'Save to Your work' });

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
  work.replace.mockResolvedValue(true);
  work.files = [];
  work.submittedFileIds = [];
  work.submitting = false;
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

  it('has no PDF export left: the final action saves to Your work', async () => {
    open();
    await editor();
    expect(saveButton()).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Done' })).toBeNull();
    expect('renderPdf' in (await vi.importActual<typeof import('./api')>('./api'))).toBe(false);
  });

  it('refuses to save an empty document without calling the server', async () => {
    open();
    await editor();
    await userEvent.click(saveButton());
    expect(await screen.findByText('Nothing to save yet.')).toBeInTheDocument();
    expect(api.createOnlineDoc).not.toHaveBeenCalled();
  });

  it('saves a new document on Yungu, adds it to Your work, clears the draft and reports back', async () => {
    api.createOnlineDoc.mockResolvedValue(SAVED);
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
    await userEvent.click(saveButton());
    await waitFor(() => expect(onDone).toHaveBeenCalledWith(SAVED));
    expect(api.createOnlineDoc).toHaveBeenCalledWith(94616, '观察记录', delta('Hello'));
    expect(api.updateOnlineDoc).not.toHaveBeenCalled();
    expect(work.add).toHaveBeenCalledWith(SAVED);
    expect(work.replace).not.toHaveBeenCalled();
    await waitFor(() => expect(left).toBe(true));
    expect(localStorage.getItem(DRAFT)).toBeNull();
    expect(localStorage.getItem(`${DRAFT}_title`)).toBeNull();
  });

  it('falls back to the assignment title when the title is cleared', async () => {
    api.createOnlineDoc.mockResolvedValue(SAVED);
    open();
    await userEvent.clear(screen.getByRole('textbox', { name: 'Title' }));
    await userEvent.type(await editor(), 'Hello');
    await userEvent.click(saveButton());
    await waitFor(() => expect(api.createOnlineDoc).toHaveBeenCalledWith(94616, 'Task 3：开始第一次观察', delta('Hello')));
  });

  it('keeps the draft and says why when Yungu does not save it', async () => {
    api.createOnlineDoc.mockRejectedValue(new ApiError(502, "Yungu couldn't save the document. Try again."));
    open();
    await userEvent.type(await editor(), 'Hello');
    await userEvent.click(saveButton());
    expect(await screen.findByText("Yungu couldn't save the document. Try again.")).toBeInTheDocument();
    expect(onDone).not.toHaveBeenCalled();
    expect((await editor()).textContent).toBe('Hello');
    await waitFor(() => expect(localStorage.getItem(DRAFT)).toBe('<p>Hello</p>'));
  });

  it('keeps the draft when the document is saved but Your work is not, and retrying saves that same document', async () => {
    api.createOnlineDoc.mockResolvedValue(SAVED);
    api.updateOnlineDoc.mockResolvedValue(SAVED);
    work.add.mockResolvedValueOnce(false);
    open();
    await userEvent.type(await editor(), 'Hello');
    await userEvent.click(saveButton());
    expect(await screen.findByText('Saved on Yungu, but not added to Your work. Try again.')).toBeInTheDocument();
    expect(onDone).not.toHaveBeenCalled();
    await waitFor(() => expect(localStorage.getItem(DRAFT)).toBe('<p>Hello</p>'));
    // No second document on Yungu: the one just made is saved again and added.
    await userEvent.click(saveButton());
    await waitFor(() => expect(onDone).toHaveBeenCalledWith(SAVED));
    expect(api.createOnlineDoc).toHaveBeenCalledTimes(1);
    expect(api.updateOnlineDoc).toHaveBeenCalledWith(94616, 'doc-new', 'Task 3：开始第一次观察', delta('Hello'));
    expect(work.add).toHaveBeenCalledTimes(2);
  });

  it('refuses a document over Yungu\'s limit before sending anything, and keeps the text', async () => {
    // The local draft is written as typed; seed it so the editor opens with a long text.
    const long = '观'.repeat(21_840);
    localStorage.setItem(DRAFT, `<p>${long}</p>`);
    open();
    expect((await editor()).textContent).toBe(long);
    await userEvent.click(saveButton());
    const content = JSON.stringify({ ops: [{ insert: `${long}\n` }] });
    expect(new TextEncoder().encode(content).length).toBeGreaterThan(ONLINE_DOC_MAX_BYTES);
    expect(await screen.findByText(docTooLongMessage(content)!)).toBeInTheDocument();
    expect(screen.getByText('Too long for Yungu — cut about 4 characters.')).toBeInTheDocument();
    expect(api.createOnlineDoc).not.toHaveBeenCalled();
    expect(localStorage.getItem(DRAFT)).toBe(`<p>${long}</p>`);
  });

  it('saves a document of exactly 65 535 bytes', async () => {
    api.createOnlineDoc.mockResolvedValue(SAVED);
    // {"ops":[{"insert":"…\n"}]} is 25 bytes around the text; 21 836 CJK characters + 2 ASCII = 65 535.
    const text = `${'观'.repeat(21_836)}ab`;
    localStorage.setItem(DRAFT, `<p>${text}</p>`);
    open();
    await editor();
    await userEvent.click(saveButton());
    await waitFor(() => expect(api.createOnlineDoc).toHaveBeenCalled());
    expect(new TextEncoder().encode(api.createOnlineDoc.mock.calls[0][2]).length).toBe(ONLINE_DOC_MAX_BYTES);
  });

  it('warns before saving what Yungu cannot keep, and saves only on "Save anyway"', async () => {
    api.createOnlineDoc.mockResolvedValue(SAVED);
    localStorage.setItem(DRAFT, '<p>one<br>two</p>');
    open();
    await editor();
    await userEvent.click(saveButton());
    expect(
      await screen.findByText("Yungu can't keep nested lists or line breaks inside a paragraph — they'll be saved as separate lines."),
    ).toBeInTheDocument();
    expect(api.createOnlineDoc).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Save anyway' }));
    await waitFor(() => expect(api.createOnlineDoc).toHaveBeenCalledWith(94616, 'Task 3：开始第一次观察', delta('one', 'two')));
    await waitFor(() => expect(onDone).toHaveBeenCalledWith(SAVED));
  });

  describe('an existing online document', () => {
    it('opens with its Yungu text and title, and saves it in place when it is not handed in', async () => {
      const updated = onlineDoc('doc-1', '课堂反思', delta('更多第一段'));
      api.updateOnlineDoc.mockResolvedValue(updated);
      work.files = [EXISTING];
      open('doc-1');
      const doc = await editor();
      expect(doc.textContent).toBe('第一段');
      expect(screen.getByRole('textbox', { name: 'Title' })).toHaveValue('课堂反思');
      // jsdom puts the caret at the start of the existing text.
      await userEvent.type(doc, '更多');
      await userEvent.click(saveButton());
      await waitFor(() => expect(onDone).toHaveBeenCalledWith(updated));
      expect(api.updateOnlineDoc).toHaveBeenCalledWith(94616, 'doc-1', '课堂反思', delta('更多第一段'));
      expect(api.createOnlineDoc).not.toHaveBeenCalled();
      expect(work.replace).toHaveBeenCalledWith('doc-1', updated);
      expect(work.add).not.toHaveBeenCalled();
      expect(localStorage.getItem(`${DRAFT}_doc_doc-1`)).toBeNull();
    });

    it('saves a handed-in document as a new one that takes its place (Review Focus 2)', async () => {
      const fresh = onlineDoc('doc-2', '课堂反思', delta('更多第一段'));
      api.createOnlineDoc.mockResolvedValue(fresh);
      work.files = [EXISTING];
      work.submittedFileIds = ['doc-1'];
      open('doc-1');
      const doc = await editor();
      // jsdom puts the caret at the start of the existing text.
      await userEvent.type(doc, '更多');
      await userEvent.click(saveButton());
      await waitFor(() => expect(onDone).toHaveBeenCalledWith(fresh));
      expect(api.createOnlineDoc).toHaveBeenCalledWith(94616, '课堂反思', delta('更多第一段'));
      expect(api.updateOnlineDoc).not.toHaveBeenCalled();
      expect(work.replace).toHaveBeenCalledWith('doc-1', fresh);
      expect(work.submittedFileIds).toEqual(['doc-1']);
    });

    it('saves as a new one when Yungu says the document was handed in after all', async () => {
      const fresh = onlineDoc('doc-2', '课堂反思', delta('第一段'));
      api.updateOnlineDoc.mockRejectedValue(new ApiError(409, 'This document was handed in — save it as a new one.'));
      api.createOnlineDoc.mockResolvedValue(fresh);
      work.files = [EXISTING];
      open('doc-1');
      await editor();
      await userEvent.click(saveButton());
      await waitFor(() => expect(onDone).toHaveBeenCalledWith(fresh));
      expect(work.replace).toHaveBeenCalledWith('doc-1', fresh);
    });

    it('keeps its own local draft and reopens it while the Yungu version is unchanged', async () => {
      work.files = [EXISTING];
      const view = open('doc-1');
      const doc = await editor();
      await userEvent.type(doc, '，继续');
      await waitFor(() => expect(localStorage.getItem(`${DRAFT}_doc_doc-1`)).toBe('<p>，继续第一段</p>'));
      expect(localStorage.getItem(DRAFT)).toBeNull();
      view.unmount();
      open('doc-1');
      expect((await editor()).textContent).toBe('，继续第一段');
      expect(screen.queryByRole('button', { name: 'Use my unsaved draft' })).toBeNull();
    });

    it('opens the Yungu version when it changed since the local draft, and offers the draft', async () => {
      work.files = [EXISTING];
      localStorage.setItem(`${DRAFT}_doc_doc-1`, '<p>本地草稿</p>');
      localStorage.setItem(`${DRAFT}_doc_doc-1_base`, 'an-older-version');
      open('doc-1');
      const doc = await editor();
      expect(doc.textContent).toBe('第一段');
      expect(await screen.findByText(/unsaved draft of this document/)).toBeInTheDocument();
      // Neither is overwritten while the choice is open.
      expect(doc).toHaveAttribute('contenteditable', 'false');
      expect(localStorage.getItem(`${DRAFT}_doc_doc-1`)).toBe('<p>本地草稿</p>');
      await userEvent.click(screen.getByRole('button', { name: 'Use my unsaved draft' }));
      await waitFor(() => expect(doc.textContent).toBe('本地草稿'));
      expect(doc).toHaveAttribute('contenteditable', 'true');
      expect(screen.queryByRole('button', { name: 'Use my unsaved draft' })).toBeNull();
    });

    it('can keep the Yungu version instead, which forgets the local draft', async () => {
      work.files = [EXISTING];
      localStorage.setItem(`${DRAFT}_doc_doc-1`, '<p>本地草稿</p>');
      localStorage.setItem(`${DRAFT}_doc_doc-1_base`, 'an-older-version');
      open('doc-1');
      const doc = await editor();
      await userEvent.click(await screen.findByRole('button', { name: 'Keep the Yungu version' }));
      expect(doc.textContent).toBe('第一段');
      expect(doc).toHaveAttribute('contenteditable', 'true');
      expect(localStorage.getItem(`${DRAFT}_doc_doc-1`)).toBeNull();
    });

    it('says so when the document is no longer in Your work', async () => {
      open('doc-gone');
      expect(await screen.findByText('This document is no longer in Your work.')).toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: 'Back to assignment' }));
      expect(onBack).toHaveBeenCalled();
    });
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
