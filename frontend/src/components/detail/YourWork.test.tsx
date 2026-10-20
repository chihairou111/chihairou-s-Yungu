import { act, fireEvent, render, screen, waitFor, within } from '../test-render';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AssignmentDetail, FileRef } from '@/lib/types';
import { HOUR, NOW, todo } from '../test-fixtures';
import { ApiError } from './api';
import { MEDIA_UNAVAILABLE } from './media';
import { fakeStream, installCanvas, installMedia, installObjectUrls, removeMedia } from './test-media';
import { DetailContext } from './DetailContext';
import { useWorkContext, WorkProvider } from './WorkContext';
import YourWork from './YourWork';

const nav = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: nav.refresh }) }));

const api = vi.hoisted(() => ({ uploadFile: vi.fn(), saveDraft: vi.fn(), submit: vi.fn() }));
vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./api')>()),
  uploadFile: api.uploadFile,
  saveDraft: api.saveDraft,
  submit: api.submit,
}));

const refresh = vi.fn();

function ref(id: string, name: string): FileRef {
  return { id, name, kind: 'other', mime: 'text/plain', size: 2048, url: `/api/files/${id}`, createdAt: NOW };
}

function detail(extra: Partial<AssignmentDetail> = {}): AssignmentDetail {
  return {
    ...todo('Task 3', 5 * HOUR, { id: 94616 }),
    teacher: 'Daniel Moore',
    instructionsHtml: '',
    attachments: [],
    myFiles: [],
    submittedFileIds: [],
    submitted: false,
    needsFiles: true,
    comments: [],
    ...extra,
  };
}

const handlers = { onWrite: vi.fn() };
const NOT_HANDED_IN = 'Changes not handed in — press Update to hand them in.';

/** A stand-in for the writer: Your work is unmounted meanwhile; it adds its PDF through the context. */
function Writer() {
  const work = useWorkContext();
  return <button onClick={() => void work.add(ref('pdf', 'written.pdf'))}>Done</button>;
}

function Dialog({ d, writing }: { d: AssignmentDetail; writing: boolean }) {
  return (
    <DetailContext.Provider value={{ refresh }}>
      <WorkProvider detail={d}>{writing ? <Writer /> : <YourWork {...handlers} />}</WorkProvider>
    </DetailContext.Provider>
  );
}

function setup(d: AssignmentDetail) {
  const view = render(<Dialog d={d} writing={false} />);
  return { ...view, writing: (on: boolean) => view.rerender(<Dialog d={d} writing={on} />) };
}

function uploadInput(): HTMLInputElement {
  return document.querySelector('input[type="file"]') as HTMLInputElement;
}

beforeEach(() => {
  vi.clearAllMocks();
  api.saveDraft.mockResolvedValue(undefined);
  refresh.mockResolvedValue(undefined);
  api.uploadFile.mockImplementation(async (file: File) => ref(`id-${file.name}`, file.name));
});

describe('YourWork', () => {
  it('shows the status, the four add actions in order, and a disabled Submit with no files', () => {
    setup(detail());
    expect(screen.getByText('Not submitted')).toBeInTheDocument();
    const names = screen.getAllByRole('button').map((b) => b.textContent);
    expect(names).toEqual(['Record', 'Camera', 'Write', 'Upload', 'Submit']);
    expect(screen.getByRole('button', { name: 'Submit' })).toBeDisabled();
    expect(uploadInput()).toHaveAttribute('multiple');
  });

  it('takes focus when it returns from the writer: the new file row, else Write', () => {
    const d = detail({ myFiles: [ref('a', 'a.txt'), ref('pdf', 'notes.pdf')] });
    const wrap = (focus: Parameters<typeof YourWork>[0]['focusOnMount']) => (
      <DetailContext.Provider value={{ refresh }}>
        <WorkProvider detail={d}>
          <YourWork {...handlers} focusOnMount={focus} />
        </WorkProvider>
      </DetailContext.Provider>
    );
    const first = render(wrap({ kind: 'file', id: 'pdf' }));
    expect(screen.getByRole('button', { name: /^notes\.pdf/ })).toHaveFocus();
    first.unmount();
    render(wrap({ kind: 'write' }));
    expect(screen.getByRole('button', { name: 'Write' })).toHaveFocus();
  });

  it('Write calls its handler', async () => {
    const user = userEvent.setup();
    setup(detail());
    await user.click(screen.getByRole('button', { name: 'Write' }));
    expect(handlers.onWrite).toHaveBeenCalledOnce();
    // A new document: no document id (not the click event either).
    expect(handlers.onWrite).toHaveBeenCalledWith();
  });

  it('Record and Camera open their dialogs, which say so on plain HTTP and hand focus back on close', async () => {
    const user = userEvent.setup();
    setup(detail());
    for (const [button, title] of [
      ['Record', 'Record audio'],
      ['Camera', 'Camera'],
    ]) {
      await user.click(screen.getByRole('button', { name: button }));
      const dialog = await screen.findByRole('dialog', { name: title });
      expect(within(dialog).getByText(MEDIA_UNAVAILABLE)).toBeInTheDocument();
      await user.click(within(dialog).getByRole('button', { name: 'Close' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      expect(screen.getByRole('button', { name: button })).toHaveFocus();
    }
  });

  it('photos from the camera are uploaded as separate files', async () => {
    const user = userEvent.setup();
    installCanvas();
    installObjectUrls();
    installMedia(() => Promise.resolve(fakeStream('video').stream));
    api.uploadFile.mockImplementation(async (file: File) => ref(file.name, file.name));
    api.saveDraft.mockResolvedValue(undefined);
    try {
      setup(detail());
      await user.click(screen.getByRole('button', { name: 'Camera' }));
      const dialog = await screen.findByRole('dialog', { name: 'Camera' });
      const video = dialog.querySelector('video')!;
      await waitFor(() => expect(video.srcObject).toBeTruthy());
      fireEvent.loadedMetadata(video);
      const shutter = within(dialog).getByRole('button', { name: 'Take photo' });
      await waitFor(() => expect(shutter).toBeEnabled());
      await user.click(shutter);
      await user.click(shutter);
      await user.click(await within(dialog).findByRole('button', { name: 'Add 2 photos' }));
      await waitFor(() => expect(api.uploadFile).toHaveBeenCalledTimes(2));
      for (const [file] of api.uploadFile.mock.calls) expect((file as File).type).toBe('image/jpeg');
      expect(await screen.findAllByRole('button', { name: /^Photo .*\.jpg/ })).toHaveLength(2);
    } finally {
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
      removeMedia();
    }
  });

  it('uploads two files, lists both and saves both as the draft', async () => {
    const user = userEvent.setup();
    setup(detail());
    await user.upload(uploadInput(), [new File(['a'], 'notes.txt'), new File(['b'], 'sketch.txt')]);
    expect(await screen.findByRole('button', { name: /^notes\.txt/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^sketch\.txt/ })).toBeInTheDocument();
    await waitFor(() => expect(api.saveDraft).toHaveBeenLastCalledWith(94616, ['id-notes.txt', 'id-sketch.txt']));
    expect(screen.getByRole('button', { name: 'Submit' })).toBeEnabled();
  });

  it('files dropped on the panel are uploaded', async () => {
    setup(detail());
    const file = new File(['a'], 'dropped.txt');
    fireEvent.drop(screen.getByRole('heading', { name: 'Your work' }), { dataTransfer: { files: [file], types: ['Files'] } });
    expect(await screen.findByRole('button', { name: /^dropped\.txt/ })).toBeInTheDocument();
    expect(api.uploadFile).toHaveBeenCalledWith(file);
  });

  it('removing a file saves the others as the draft', async () => {
    const user = userEvent.setup();
    setup(detail({ myFiles: [ref('a', 'one.txt'), ref('b', 'two.txt')] }));
    await user.click(screen.getByRole('button', { name: 'Remove one.txt' }));
    expect(api.saveDraft).toHaveBeenLastCalledWith(94616, ['b']);
    await waitFor(() => expect(screen.queryByRole('button', { name: /^one\.txt/ })).not.toBeInTheDocument());
  });

  it('says so when a file is empty', async () => {
    const user = userEvent.setup();
    setup(detail());
    await user.upload(uploadInput(), new File([], 'blank.txt'));
    expect(await screen.findByRole('alert')).toHaveTextContent('blank.txt is empty.');
  });

  it('shows the size limit when the server refuses a large file', async () => {
    api.uploadFile.mockRejectedValue(new ApiError(413, 'Files up to 50 MB.'));
    const user = userEvent.setup();
    setup(detail());
    await user.upload(uploadInput(), new File(['x'], 'huge.mov'));
    expect(await screen.findByRole('alert')).toHaveTextContent('huge.mov: files up to 50 MB.');
  });

  it('in a multi-file pick, an empty first file keeps its message while the next one uploads', async () => {
    const user = userEvent.setup();
    setup(detail());
    await user.upload(uploadInput(), [new File([], 'blank.txt'), new File(['a'], 'notes.txt')]);
    expect(await screen.findByRole('button', { name: /^notes\.txt/ })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('blank.txt is empty.');
  });

  it('shows every failure of a pick, each naming its file', async () => {
    api.uploadFile.mockRejectedValue(new ApiError(413, 'Files up to 50 MB.'));
    const user = userEvent.setup();
    setup(detail());
    await user.upload(uploadInput(), [new File([], 'blank.txt'), new File(['x'], 'huge.mov')]);
    const alert = await screen.findByRole('alert');
    await waitFor(() => expect(within(alert).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['blank.txt is empty.', 'huge.mov: files up to 50 MB.']));
  });

  it('after a remove, focus moves to the next ✕, else the previous one, else Upload', async () => {
    const user = userEvent.setup();
    setup(detail({ myFiles: [ref('a', 'one.txt'), ref('b', 'two.txt'), ref('c', 'three.txt')] }));
    await user.click(screen.getByRole('button', { name: 'Remove two.txt' }));
    expect(screen.getByRole('button', { name: 'Remove three.txt' })).toHaveFocus();
    await user.click(screen.getByRole('button', { name: 'Remove three.txt' }));
    expect(screen.getByRole('button', { name: 'Remove one.txt' })).toHaveFocus();
    await user.click(screen.getByRole('button', { name: 'Remove one.txt' }));
    expect(screen.getByRole('button', { name: 'Upload' })).toHaveFocus();
  });

  it('while submitting, Submit keeps focus (aria-disabled) and nothing can be added', async () => {
    let finish!: (v: { submittedAt: number }) => void;
    api.submit.mockReturnValue(new Promise((r) => (finish = r)));
    const user = userEvent.setup();
    setup(detail({ myFiles: [ref('a', 'one.txt')] }));
    await user.click(screen.getByRole('button', { name: 'Submit' }));
    const busy = screen.getByRole('button', { name: 'Submitting…' });
    expect(busy).toHaveFocus();
    expect(busy).toBeEnabled();
    expect(busy).toHaveAttribute('aria-disabled', 'true');
    await user.click(busy);
    expect(api.submit).toHaveBeenCalledOnce();
    for (const name of ['Record', 'Camera', 'Write', 'Upload']) expect(screen.getByRole('button', { name })).toBeDisabled();
    fireEvent.drop(screen.getByRole('heading', { name: 'Your work' }), { dataTransfer: { files: [new File(['a'], 'late.txt')], types: ['Files'] } });
    expect(api.uploadFile).not.toHaveBeenCalled();
    await act(async () => finish({ submittedAt: NOW }));
    expect(await screen.findByRole('button', { name: 'Update' })).toHaveFocus();
  });

  it('Submit does not flicker disabled while a draft saves', async () => {
    let saved!: () => void;
    api.saveDraft.mockReturnValue(new Promise<void>((r) => (saved = r)));
    const user = userEvent.setup();
    setup(detail({ myFiles: [ref('a', 'one.txt'), ref('b', 'two.txt')] }));
    await user.click(screen.getByRole('button', { name: 'Remove two.txt' }));
    expect(screen.getByRole('button', { name: 'Submit' })).toBeEnabled();
    await act(async () => saved());
  });

  it('keeps the files across a trip to the writer, including an upload that lands meanwhile', async () => {
    const user = userEvent.setup();
    const view = setup(detail());
    await user.upload(uploadInput(), new File(['a'], 'first.txt'));
    expect(await screen.findByRole('button', { name: /^first\.txt/ })).toBeInTheDocument();

    let land!: (f: FileRef) => void;
    api.uploadFile.mockReturnValueOnce(new Promise((r) => (land = r)));
    await user.upload(uploadInput(), new File(['b'], 'slow.txt'));
    view.writing(true);
    await act(async () => land(ref('id-slow.txt', 'slow.txt')));
    await user.click(screen.getByRole('button', { name: 'Done' }));
    view.writing(false);

    expect(await screen.findByRole('button', { name: /^first\.txt/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^slow\.txt/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^written\.pdf/ })).toBeInTheDocument();
    await waitFor(() => expect(api.saveDraft).toHaveBeenLastCalledWith(94616, ['id-first.txt', 'id-slow.txt', 'pdf']));
    await user.upload(uploadInput(), new File(['c'], 'next.txt'));
    await waitFor(() =>
      expect(api.saveDraft).toHaveBeenLastCalledWith(94616, ['id-first.txt', 'id-slow.txt', 'pdf', 'id-next.txt']),
    );
  });

  it('Submit hands in, then reads "Submitted" and offers Update', async () => {
    api.submit.mockResolvedValue({ submittedAt: NOW });
    const user = userEvent.setup();
    setup(detail({ myFiles: [ref('a', 'one.txt')] }));
    await user.click(screen.getByRole('button', { name: 'Submit' }));
    expect(await screen.findByRole('button', { name: 'Update' })).toBeInTheDocument();
    expect(screen.getByText('Submitted')).toBeInTheDocument();
    expect(screen.queryByText('Not submitted')).not.toBeInTheDocument();
    expect(api.submit).toHaveBeenCalledWith(94616, ['a']);
    expect(nav.refresh).toHaveBeenCalled();
    expect(refresh).toHaveBeenCalled();
  });

  it('a submit after the due time reads "Submitted late"', async () => {
    const d = detail({ myFiles: [ref('a', 'one.txt')] });
    api.submit.mockResolvedValue({ submittedAt: d.dueAt + HOUR });
    const user = userEvent.setup();
    setup(d);
    await user.click(screen.getByRole('button', { name: 'Submit' }));
    expect(await screen.findByText('Submitted late')).toBeInTheDocument();
  });

  it('already submitted work with nothing changed: Update is unavailable and says why', async () => {
    const user = userEvent.setup();
    setup(detail({ myFiles: [ref('a', 'one.txt')], submittedFileIds: ['a'], submitted: true, submittedAt: NOW }));
    expect(screen.getByText('Submitted')).toBeInTheDocument();
    const update = screen.getByRole('button', { name: 'Update' });
    expect(update).toHaveAttribute('aria-disabled', 'true');
    expect(update).toHaveAccessibleDescription('No changes to hand in');
    expect(screen.queryByText(NOT_HANDED_IN)).not.toBeInTheDocument();
    await user.click(update);
    expect(api.submit).not.toHaveBeenCalled();
  });

  it('an edit after a submit shows that it is not handed in and enables Update; Update hands it in', async () => {
    api.submit.mockImplementation(async () => ({ submittedAt: NOW }));
    const user = userEvent.setup();
    setup(detail({ myFiles: [ref('a', 'one.txt')] }));
    await user.click(screen.getByRole('button', { name: 'Submit' }));
    const update = await screen.findByRole('button', { name: 'Update' });
    expect(update).toHaveAttribute('aria-disabled', 'true');

    await user.upload(uploadInput(), new File(['b'], 'two.txt'));
    expect(await screen.findByRole('status')).toHaveTextContent(NOT_HANDED_IN);
    expect(screen.getByText('Submitted')).toBeInTheDocument();
    expect(update).not.toHaveAttribute('aria-disabled');
    expect(update).toBeEnabled();

    await user.click(update);
    await waitFor(() => expect(api.submit).toHaveBeenLastCalledWith(94616, ['a', 'id-two.txt']));
    await waitFor(() => expect(screen.queryByText(NOT_HANDED_IN)).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Update' })).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByText('Submitted')).toBeInTheDocument();
  });

  it('removing a handed-in file after a submit also counts as a change', async () => {
    const user = userEvent.setup();
    setup(detail({ myFiles: [ref('a', 'one.txt'), ref('b', 'two.txt')], submittedFileIds: ['a', 'b'], submitted: true, submittedAt: NOW }));
    await user.click(screen.getByRole('button', { name: 'Remove two.txt' }));
    expect(await screen.findByRole('status')).toHaveTextContent(NOT_HANDED_IN);
    expect(screen.getByRole('button', { name: 'Update' })).not.toHaveAttribute('aria-disabled');
  });

  it('on reopen, a saved draft that differs from what was handed in shows as not handed in', () => {
    setup(detail({ myFiles: [ref('a', 'one.txt'), ref('b', 'two.txt')], submittedFileIds: ['a'], submitted: true, submittedAt: NOW }));
    expect(screen.getByText('Submitted')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(NOT_HANDED_IN);
    expect(screen.getByRole('button', { name: 'Update' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Update' })).not.toHaveAttribute('aria-disabled');
  });

  describe('online documents', () => {
    const content = JSON.stringify({ ops: [{ insert: '反思' }, { insert: '\n', attributes: { header: 1 } }, { insert: '正文\n' }] });
    const doc = (id: string, extra: Partial<FileRef> = {}): FileRef => ({ ...ref(id, '课堂反思'), size: 0, online: true, content, ...extra });

    it('a document not handed in opens straight in the writer', async () => {
      const user = userEvent.setup();
      setup(detail({ myFiles: [doc('d1')] }));
      const row = screen.getByRole('button', { name: '课堂反思, Online document' });
      await user.click(row);
      expect(handlers.onWrite).toHaveBeenCalledWith('d1');
      expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('a handed-in document opens in the preview, whose Edit opens the writer for it', async () => {
      const user = userEvent.setup();
      setup(detail({ submitted: true, submittedAt: NOW, myFiles: [doc('d1')], submittedFileIds: ['d1'] }));
      await user.click(screen.getByRole('button', { name: '课堂反思, Online document' }));
      const viewer = await screen.findByRole('dialog', { name: '课堂反思' });
      expect(within(viewer).getByRole('heading', { level: 3, name: '反思' })).toBeInTheDocument();
      expect(handlers.onWrite).not.toHaveBeenCalled();
      await user.click(within(viewer).getByRole('button', { name: 'Edit' }));
      // The writer opens once the viewer has faded out.
      await waitFor(() => expect(handlers.onWrite).toHaveBeenCalledWith('d1'));
      expect(screen.queryByRole('dialog', { name: '课堂反思' })).toBeNull();
    });

    it('a document whose text cannot be read opens in the viewer, with nothing to edit', async () => {
      const user = userEvent.setup();
      setup(detail({ myFiles: [doc('d1', { content: undefined })] }));
      await user.click(screen.getByRole('button', { name: '课堂反思, Online document' }));
      const viewer = await screen.findByRole('dialog', { name: '课堂反思' });
      expect(within(viewer).getByText('Open this online document on Yungu.')).toBeInTheDocument();
      expect(within(viewer).queryByRole('button', { name: 'Edit' })).toBeNull();
      expect(handlers.onWrite).not.toHaveBeenCalled();
    });
  });

  describe('Mark as submitted', () => {
    const free = (extra: Partial<AssignmentDetail> = {}) => detail({ needsFiles: false, ...extra });

    it('reads "Mark as submitted" and is enabled only when files are optional, nothing is handed in and Your work is empty', () => {
      setup(free());
      const button = screen.getByRole('button', { name: 'Mark as submitted' });
      expect(button).toBeEnabled();
      expect(button).not.toHaveAttribute('aria-disabled');
      expect(screen.queryByRole('button', { name: 'Submit' })).not.toBeInTheDocument();
    });

    it('stays "Submit", disabled, when files are required', () => {
      setup(detail());
      expect(screen.queryByRole('button', { name: 'Mark as submitted' })).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Submit' })).toBeDisabled();
    });

    it('stays "Submit" (enabled) once Your work has a file, even when files are optional', () => {
      setup(free({ myFiles: [ref('a', 'one.txt')] }));
      expect(screen.queryByRole('button', { name: 'Mark as submitted' })).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Submit' })).toBeEnabled();
    });

    it('turns into "Submit" while a file is uploading, and back to "Mark as submitted" when it fails', async () => {
      let land!: (f: FileRef) => void;
      api.uploadFile.mockReturnValueOnce(new Promise((r) => (land = r)));
      const user = userEvent.setup();
      setup(free());
      await user.upload(uploadInput(), new File(['a'], 'slow.txt'));
      expect(screen.queryByRole('button', { name: 'Mark as submitted' })).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Submit' })).toBeDisabled();
      await act(async () => land(ref('id-slow.txt', 'slow.txt')));
      expect(await screen.findByRole('button', { name: 'Submit' })).toBeEnabled();
    });

    it('already submitted work never offers it, even with no files', () => {
      setup(free({ submitted: true, submittedAt: NOW }));
      expect(screen.queryByRole('button', { name: 'Mark as submitted' })).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Update' })).toBeInTheDocument();
    });

    it('one click hands in with no files; a double click sends one request', async () => {
      let finish!: (v: { submittedAt: number }) => void;
      api.submit.mockReturnValue(new Promise((r) => (finish = r)));
      const user = userEvent.setup();
      setup(free());
      const button = screen.getByRole('button', { name: 'Mark as submitted' });
      await user.dblClick(button);
      expect(api.submit).toHaveBeenCalledOnce();
      expect(api.submit).toHaveBeenCalledWith(94616, []);
      expect(screen.getByRole('button', { name: 'Submitting…' })).toHaveFocus();
      await act(async () => finish({ submittedAt: NOW }));
      expect(api.submit).toHaveBeenCalledOnce();
    });

    it('afterwards the assignment reads Submitted, with nothing to update, and focus stays on the button', async () => {
      api.submit.mockResolvedValue({ submittedAt: NOW });
      const user = userEvent.setup();
      setup(free());
      await user.click(screen.getByRole('button', { name: 'Mark as submitted' }));
      const update = await screen.findByRole('button', { name: 'Update' });
      expect(screen.getByText('Submitted')).toBeInTheDocument();
      expect(screen.queryByText('Not submitted')).not.toBeInTheDocument();
      expect(update).toHaveAttribute('aria-disabled', 'true');
      expect(update).toHaveFocus();
      expect(screen.getByText('No changes to hand in')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Mark as submitted' })).not.toBeInTheDocument();
      expect(nav.refresh).toHaveBeenCalled();
      expect(refresh).toHaveBeenCalled();
    });

    it('a failure shows the inline error and the assignment is not submitted; it can be tried again', async () => {
      api.submit.mockRejectedValueOnce(new ApiError(502, "Yungu didn't confirm the hand-in. Check on Yungu."));
      api.submit.mockResolvedValueOnce({ submittedAt: NOW });
      const user = userEvent.setup();
      setup(free());
      await user.click(screen.getByRole('button', { name: 'Mark as submitted' }));
      expect(await screen.findByRole('alert')).toHaveTextContent("Yungu didn't confirm the hand-in. Check on Yungu.");
      expect(screen.getByText('Not submitted')).toBeInTheDocument();
      expect(screen.queryByText('Submitted')).not.toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Mark as submitted' }));
      expect(await screen.findByText('Submitted')).toBeInTheDocument();
      expect(api.submit).toHaveBeenCalledTimes(2);
    });

    it('removing the last file while files are optional offers it again', async () => {
      const user = userEvent.setup();
      setup(free({ myFiles: [ref('a', 'one.txt')] }));
      await user.click(screen.getByRole('button', { name: 'Remove one.txt' }));
      expect(await screen.findByRole('button', { name: 'Mark as submitted' })).toBeEnabled();
    });
  });

  it('a 401 says the session ended, with a way to sign in', async () => {
    api.submit.mockRejectedValue(new ApiError(401, 'Sign in again.'));
    const user = userEvent.setup();
    setup(detail({ myFiles: [ref('a', 'one.txt')] }));
    await user.click(screen.getByRole('button', { name: 'Submit' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Your session ended — sign in again.');
    expect(within(alert).getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login');
  });
});
